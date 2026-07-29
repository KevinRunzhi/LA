import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from backend.app import create_app
from backend.case_package import CasePackageRegistry
from backend.case_platform.case_runs import CaseRunStore
from backend.case_platform.contracts import CaseRunStatus, RouteStatus, UserRole
from backend.case_platform.errors import PlatformError
from backend.case_platform.knowledge import KnowledgeLifecycleService
from backend.case_platform.migrations import (
    CASE_PLATFORM_MIGRATION,
    MigrationRunner,
)
from backend.case_platform.providers import RemoteModelDiagnosisProvider
from backend.case_platform.routing import DeterministicCaseRouter


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"


def registry():
    return CasePackageRegistry(CASES_DIR, SOURCES_FILE).load()


def key():
    return str(uuid.uuid4())


class DeterministicRoutingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.router = DeterministicCaseRouter(registry())

    def assert_route(self, text, status, case_id=None):
        decision = self.router.route({"description": text})
        self.assertEqual(status, decision.route_status)
        if case_id:
            self.assertEqual(case_id, decision.candidates[0].case_id)
        return decision

    def test_cooling_power_units_negation_and_unsupported(self):
        self.assert_route(
            "ACP-4000 出现 TEMP/FAN 告警，风扇只有420 rpm且温度高",
            RouteStatus.MATCHED,
            "CASE-ACP4000-001",
        )
        power = self.assert_route(
            "站控柜B02 Rockwell 6300B电源灯不亮，上游24V正常，设备端11600mV",
            RouteStatus.MATCHED,
            "CASE-ROCKWELL-6300-002",
        )
        measurements = [
            fact
            for fact in power.candidates[0].matched_facts
            if fact["category"] == "measurement"
        ]
        self.assertEqual(1, len(measurements))

        unsupported = self.assert_route(
            "工控机没有TEMP/FAN告警，是RTC电池异常",
            RouteStatus.UNSUPPORTED,
        )
        cooling = next(
            item
            for item in unsupported.candidates
            if item.case_id == "CASE-ACP4000-001"
        )
        self.assertTrue(
            any(item["term"] == "temp/fan" for item in cooling.negated_facts)
        )

    def test_insufficient_conflict_and_determinism(self):
        self.assert_route("工控机好像有问题", RouteStatus.INSUFFICIENT)
        conflict = self.assert_route(
            "工控机同时出现TEMP/FAN告警和Power LED不亮",
            RouteStatus.AMBIGUOUS,
        )
        repeated = self.router.route(
            {"description": "工控机同时出现TEMP/FAN告警和Power LED不亮"}
        )
        self.assertEqual(conflict.to_dict(), repeated.to_dict())

    def test_unknown_and_oversized_input_are_rejected(self):
        with self.assertRaises(PlatformError) as unknown:
            self.router.route({"description": "温度高", "caseId": "forced"})
        self.assertEqual("validation_error", unknown.exception.code)
        with self.assertRaises(PlatformError):
            self.router.route({"description": "x" * 2001})


class ProviderContractTest(unittest.TestCase):
    def test_remote_model_adapter_calls_client_and_validates_contract(self):
        captured = {}

        def remote_client(payload):
            captured.update(payload)
            return {
                "direction": "供电路径压降",
                "riskLevel": "medium",
                "summary": "设备端启动电压低于案例阈值",
                "evidence": [],
                "agents": [],
            }

        package = registry().get("CASE-ROCKWELL-6300-002")
        provider = RemoteModelDiagnosisProvider(remote_client, "diagnosis-v1")
        result = provider.diagnose(
            package,
            {"intakeFacts": {"field-power-device-voltage": 11.6}},
            {},
        )
        self.assertEqual("remote-model", result["provider"])
        self.assertEqual("diagnosis-v1", captured["model"])
        self.assertEqual(package.package_hash, captured["packageHash"])

        invalid = RemoteModelDiagnosisProvider(lambda _: {}, "diagnosis-v1")
        with self.assertRaises(PlatformError) as error:
            invalid.diagnose(package, {}, {})
        self.assertEqual("provider_invalid_response", error.exception.code)


class MigrationAndCaseRunTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.database = root / "presentation.db"
        self.backups = root / "backups"
        with sqlite3.connect(self.database) as db:
            db.execute("CREATE TABLE legacy_state (id INTEGER PRIMARY KEY, value TEXT)")
            db.execute("INSERT INTO legacy_state VALUES (1, 'keep-me')")
        self.runner = MigrationRunner(self.database, self.backups)
        self.assertEqual(["001", "002", "003", "004", "005", "006"], self.runner.migrate())
        self.store = CaseRunStore(self.database)
        self.registry = registry()

    def test_old_database_upgrade_is_idempotent_and_preserves_data(self):
        self.assertEqual([], self.runner.migrate())
        with sqlite3.connect(self.database) as db:
            self.assertEqual(
                "keep-me",
                db.execute("SELECT value FROM legacy_state WHERE id=1").fetchone()[0],
            )
            self.assertEqual(
                6,
                db.execute("SELECT count(*) FROM schema_migrations").fetchone()[0],
            )
        self.assertEqual(1, len(list(self.backups.glob("*.db"))))

    def test_revisioned_snapshot_migration_preserves_existing_submission(self):
        database = Path(self.temporary.name) / "version-one.db"
        first_runner = MigrationRunner(
            database,
            Path(self.temporary.name) / "v1-backups",
            migrations=(CASE_PLATFORM_MIGRATION,),
        )
        self.assertEqual(["001"], first_runner.migrate())
        package = self.registry.get("CASE-ACP4000-001")
        old_store = CaseRunStore(database)
        run = old_store.create_run(
            package,
            "worker001",
            key(),
            {"description": "TEMP/FAN告警"},
        )
        with sqlite3.connect(database) as db:
            db.execute(
                """
                INSERT INTO engineer_submission_snapshots
                (snapshot_id,run_id,case_id,package_hash,content_hash,payload,created_at)
                VALUES ('SNAP-OLD',?,?,?,?,?,?)
                """,
                (
                    run.run_id,
                    run.case_id,
                    run.package_hash,
                    "a" * 64,
                    '{"result":"preserved"}',
                    "2026-07-28T00:00:00+00:00",
                ),
            )
        upgraded = MigrationRunner(
            database,
            Path(self.temporary.name) / "v2-backups",
        )
        self.assertEqual(["002", "003", "004", "005", "006"], upgraded.migrate())
        with sqlite3.connect(database) as db:
            row = db.execute(
                """
                SELECT snapshot_id,revision,payload
                FROM engineer_submission_snapshots
                WHERE run_id=?
                """,
                (run.run_id,),
            ).fetchone()
        self.assertEqual(("SNAP-OLD", 1, '{"result":"preserved"}'), row)

    def test_revision_idempotency_parallel_runs_and_targeted_reset(self):
        package = self.registry.get("CASE-ACP4000-001")
        create_key = key()
        first = self.store.create_run(
            package,
            "worker001",
            create_key,
            {"description": "TEMP/FAN告警"},
        )
        replay = self.store.create_run(
            package,
            "worker001",
            create_key,
            {"description": "TEMP/FAN告警"},
        )
        self.assertEqual(first.run_id, replay.run_id)
        with self.assertRaises(PlatformError) as conflict:
            self.store.create_run(
                package,
                "worker001",
                create_key,
                {"description": "different"},
            )
        self.assertEqual("idempotency_conflict", conflict.exception.code)

        second = self.store.create_run(
            package,
            "worker001",
            key(),
            {"description": "另一次运行"},
        )
        transitioned = self.store.transition(
            first.run_id,
            CaseRunStatus.INTAKE_CONFIRMED,
            UserRole.ENGINEER,
            "worker001",
            1,
            key(),
            "intake_confirmed",
            {"intakeFacts": {"alarm": "TEMP/FAN"}},
            lambda payload: {
                **payload,
                "intakeFacts": {"alarm": "TEMP/FAN"},
            },
        )
        self.assertEqual(2, transitioned.revision)
        with self.assertRaises(PlatformError) as stale:
            self.store.transition(
                first.run_id,
                CaseRunStatus.DIAGNOSED,
                UserRole.ENGINEER,
                "worker001",
                1,
                key(),
                "diagnosis_completed",
                {},
            )
        self.assertEqual("state_conflict", stale.exception.code)
        reset = self.store.reset_run(first.run_id, "worker001", 2, key())
        self.assertEqual(CaseRunStatus.CREATED, reset.status)
        self.assertEqual(CaseRunStatus.CREATED, self.store.get(second.run_id).status)
        self.assertEqual(3, len(self.store.events(first.run_id)))

    def test_approved_run_publishes_one_version_and_graph_delta(self):
        package = self.registry.get("CASE-ROCKWELL-6300-002")
        run = self.store.create_run(
            package,
            "worker001",
            key(),
            {"description": "Power LED不亮，设备端11.6V"},
        )
        sequence = [
            (CaseRunStatus.INTAKE_CONFIRMED, UserRole.ENGINEER, "intake"),
            (CaseRunStatus.DIAGNOSED, UserRole.ENGINEER, "diagnosis"),
            (CaseRunStatus.PLAN_CONFIRMED, UserRole.ENGINEER, "plan"),
            (CaseRunStatus.IN_PROGRESS, UserRole.ENGINEER, "guide"),
            (CaseRunStatus.ENGINEER_SUBMITTED, UserRole.ENGINEER, "submit"),
            (CaseRunStatus.EXPERT_REVIEWING, UserRole.EXPERT, "review"),
            (CaseRunStatus.APPROVED, UserRole.EXPERT, "approved"),
        ]
        for target, role, event in sequence:
            run = self.store.transition(
                run.run_id,
                target,
                role,
                "expert001" if role == UserRole.EXPERT else "worker001",
                run.revision,
                key(),
                event,
                {},
            )
        candidate = package.modules["feedbackAndGraph"]
        service = KnowledgeLifecycleService(self.database)
        publish_key = key()
        published = service.publish(
            run.run_id,
            run.revision,
            publish_key,
            "expert001",
            candidate["knowledgeProposal"],
            candidate["graphProposal"],
            {"summary": "保留 synthetic_demo 可信等级"},
        )
        replay = service.publish(
            run.run_id,
            run.revision,
            publish_key,
            "expert001",
            candidate["knowledgeProposal"],
            candidate["graphProposal"],
            {"summary": "保留 synthetic_demo 可信等级"},
        )
        self.assertEqual(published, replay)
        self.assertEqual("1.1", published["version"])
        self.assertEqual("synthetic_demo", published["verificationLevel"])
        self.assertEqual(
            CaseRunStatus.PUBLISHED,
            self.store.get(run.run_id).status,
        )
        with sqlite3.connect(self.database) as db:
            self.assertEqual(
                1,
                db.execute(
                    "SELECT count(*) FROM case_knowledge_versions"
                ).fetchone()[0],
            )
            self.assertEqual(
                1,
                db.execute(
                    "SELECT count(*) FROM case_graph_version_deltas"
                ).fetchone()[0],
            )


class PlatformApiSmokeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "api.db"
        self.client = create_app(self.database).test_client()
        self.actor = {"id": "worker001", "role": "engineer"}
        self.expert = {"id": "expert001", "role": "expert"}

    def post_run(self, run_id, action, revision, actor=None, **fields):
        return self.client.post(
            f"/api/platform/case-runs/{run_id}/{action}",
            json={
                "expectedRevision": revision,
                "idempotencyKey": key(),
                "actor": actor or self.actor,
                **fields,
            },
        )

    def test_route_create_and_diagnose_without_default_case(self):
        missing = self.client.post(
            "/api/platform/case-runs",
            json={
                "idempotencyKey": key(),
                "actor": self.actor,
                "input": {"description": "工控机异常"},
            },
        )
        self.assertEqual(400, missing.status_code)

        routed = self.client.post(
            "/api/platform/case-routing",
            json={
                "description": "Rockwell 6300B Power LED不亮，设备端11.6V"
            },
        )
        self.assertEqual(200, routed.status_code)
        self.assertEqual(
            "CASE-ROCKWELL-6300-002",
            routed.get_json()["data"]["candidates"][0]["caseId"],
        )

        created = self.client.post(
            "/api/platform/case-runs",
            json={
                "caseId": "CASE-ROCKWELL-6300-002",
                "idempotencyKey": key(),
                "actor": self.actor,
                "input": {"description": "Power LED不亮"},
            },
        )
        self.assertEqual(201, created.status_code)
        run = created.get_json()["data"]
        self.assertEqual("created", run["status"])
        self.assertNotIn("diagnosis", run["payload"])

        intake = self.client.post(
            f"/api/platform/case-runs/{run['runId']}/intake/confirm",
            json={
                "expectedRevision": 1,
                "idempotencyKey": key(),
                "actor": self.actor,
                "intakeFacts": {
                    "field-power-device-voltage": 11.6,
                    "field-power-led": "OFF",
                },
            },
        )
        self.assertEqual(200, intake.status_code)
        diagnosed = self.client.post(
            f"/api/platform/case-runs/{run['runId']}/diagnosis",
            json={
                "expectedRevision": 2,
                "idempotencyKey": key(),
                "actor": self.actor,
            },
        )
        self.assertEqual(200, diagnosed.status_code)
        data = diagnosed.get_json()["data"]
        self.assertEqual("diagnosed", data["run"]["status"])
        self.assertIn("24V DC", data["diagnosis"]["direction"])

    def test_telemetry_and_step_scoped_knowledge_search(self):
        created = self.client.post(
            "/api/platform/case-runs",
            json={
                "caseId": "CASE-ROCKWELL-6300-002",
                "idempotencyKey": key(),
                "actor": self.actor,
                "input": {"description": "Power LED不亮"},
            },
        ).get_json()["data"]
        run_id = created["runId"]
        intake = self.post_run(
            run_id,
            "intake/confirm",
            1,
            intakeFacts={
                "field-power-device-voltage": 11.6,
                "field-power-led": "OFF",
            },
        )
        self.assertEqual(200, intake.status_code)

        telemetry = self.client.post(
            f"/api/platform/case-runs/{run_id}/telemetry/resolve",
            json={
                "actor": self.actor,
                "requestedFields": [
                    "field-power-device-voltage",
                    "field-power-upstream-voltage",
                ],
            },
        )
        self.assertEqual(200, telemetry.status_code)
        facts = telemetry.get_json()["data"]
        self.assertEqual("submitted-facts", facts["provider"])
        self.assertEqual(
            11.6,
            facts["values"]["field-power-device-voltage"],
        )
        self.assertEqual(
            ["field-power-upstream-voltage"],
            facts["missingFields"],
        )

        search = self.client.post(
            f"/api/platform/case-runs/{run_id}/assistant/search",
            json={
                "actor": self.actor,
                "stepId": "step-power-measure",
                "query": "24V 电压范围",
            },
        )
        self.assertEqual(200, search.status_code)
        knowledge = search.get_json()["data"]
        self.assertEqual(
            ["claim-power-input-range"],
            knowledge["allowedClaimIds"],
        )
        self.assertEqual(
            ["claim-power-input-range"],
            [item["claimId"] for item in knowledge["results"]],
        )

    def test_attachment_is_stored_hashed_registered_and_listed(self):
        created = self.client.post(
            "/api/platform/case-runs",
            json={
                "caseId": "CASE-ROCKWELL-6300-002",
                "idempotencyKey": key(),
                "actor": self.actor,
                "input": {"description": "Power LED不亮"},
            },
        ).get_json()["data"]
        run_id = created["runId"]
        content = b"field-evidence-voltage=11.6V"
        uploaded = self.client.post(
            f"/api/platform/case-runs/{run_id}/attachments",
            data={
                "actorId": "worker001",
                "actorRole": "engineer",
                "metadata": json.dumps(
                    {"category": "measurement", "stepId": "step-power-measure"}
                ),
                "file": (io.BytesIO(content), "startup-voltage.txt"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(201, uploaded.status_code)
        attachment = uploaded.get_json()["data"]
        self.assertEqual(hashlib.sha256(content).hexdigest(), attachment["sha256"])
        stored_file = (
            self.database.parent / "attachments" / attachment["storageKey"]
        )
        self.assertEqual(content, stored_file.read_bytes())

        listed = self.client.get(
            f"/api/platform/case-runs/{run_id}/attachments?role=expert"
        )
        self.assertEqual(200, listed.status_code)
        items = listed.get_json()["data"]["items"]
        self.assertEqual(1, len(items))
        self.assertEqual("startup-voltage.txt", items[0]["metadata"]["originalFilename"])
        with sqlite3.connect(self.database) as db:
            self.assertEqual(
                1,
                db.execute(
                    "SELECT count(*) FROM case_run_attachments WHERE run_id=?",
                    (run_id,),
                ).fetchone()[0],
            )
            self.assertEqual(
                1,
                db.execute(
                    """
                    SELECT count(*) FROM case_run_events
                    WHERE run_id=? AND event_type='attachment_added'
                    """,
                    (run_id,),
                ).fetchone()[0],
            )

    def test_full_submission_writes_immutable_snapshots(self):
        created = self.client.post(
            "/api/platform/case-runs",
            json={
                "caseId": "CASE-ROCKWELL-6300-002",
                "idempotencyKey": key(),
                "actor": self.actor,
                "input": {"description": "Power LED不亮，设备端11.6V"},
            },
        ).get_json()["data"]
        run_id = created["runId"]

        response = self.post_run(
            run_id,
            "intake/confirm",
            1,
            intakeFacts={"field-power-device-voltage": 11.6},
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual(
            200,
            self.post_run(run_id, "diagnosis", 2).status_code,
        )
        self.assertEqual(
            200,
            self.post_run(run_id, "plan/confirm", 3).status_code,
        )
        self.assertEqual(
            200,
            self.post_run(run_id, "guide/start", 4).status_code,
        )
        first_step = self.post_run(
            run_id,
            "guide/steps/step-power-measure/complete",
            5,
            execution={
                "checks": {"check-power-qualified-person": True},
                "measurements": {"measurement-power-device-startup": 11.6},
            },
        )
        self.assertEqual(200, first_step.status_code)
        second_step = self.post_run(
            run_id,
            "guide/steps/step-power-terminal/complete",
            6,
            execution={
                "checks": {"check-power-off-before-terminal": True},
                "measurements": {},
            },
        )
        self.assertEqual(200, second_step.status_code)
        record = self.post_run(
            run_id,
            "records/generate",
            7,
            engineerResult={
                "result-power-final-cause": "DC 端子松动",
                "result-power-actual-resolution": "断电后重新紧固端子",
                "result-power-recovery": "连续冷启动恢复正常",
                "result-power-observation-minutes": 30,
                "result-power-device-voltage-after": 24.1,
                "result-power-startup-minimum-after": 23.8,
            },
        )
        self.assertEqual(200, record.status_code)
        self.assertEqual(
            200,
            self.post_run(run_id, "engineer-submit", 8).status_code,
        )
        self.assertEqual(
            200,
            self.post_run(
                run_id,
                "expert/review/start",
                9,
                actor=self.expert,
            ).status_code,
        )
        rejection = self.post_run(
            run_id,
            "expert/review/decision",
            10,
            actor=self.expert,
            decision="rejected",
            expertNotes={"summary": "请补充恢复后的复测结果"},
        )
        self.assertEqual(200, rejection.status_code)
        rework = self.post_run(
            run_id,
            "engineer-rework/start",
            11,
            reason="补充恢复复测",
        )
        self.assertEqual(200, rework.status_code)
        revised_record = self.post_run(
            run_id,
            "records/generate",
            12,
            engineerResult={
                "result-power-final-cause": "DC 端子松动",
                "result-power-actual-resolution": "断电后重新紧固并完成复测",
                "result-power-recovery": "连续三次冷启动恢复正常",
                "result-power-observation-minutes": 45,
                "result-power-device-voltage-after": 24.1,
                "result-power-startup-minimum-after": 23.8,
            },
        )
        self.assertEqual(200, revised_record.status_code)
        self.assertEqual(
            200,
            self.post_run(run_id, "engineer-submit", 13).status_code,
        )
        self.assertEqual(
            200,
            self.post_run(
                run_id,
                "expert/review/start",
                14,
                actor=self.expert,
            ).status_code,
        )
        decision = self.post_run(
            run_id,
            "expert/review/decision",
            15,
            actor=self.expert,
            decision="approved",
            expertNotes={"summary": "补充复测后材料完整"},
        )
        self.assertEqual(200, decision.status_code)

        with sqlite3.connect(self.database) as db:
            counts = {
                table: db.execute(
                    f"SELECT count(*) FROM {table} WHERE run_id=?",
                    (run_id,),
                ).fetchone()[0]
                for table in (
                    "job_card_snapshots",
                    "engineer_submission_snapshots",
                    "expert_review_snapshots",
                )
            }
            reviews = db.execute(
                """
                SELECT reviewer_id,decision,verification_level
                FROM expert_review_snapshots WHERE run_id=?
                ORDER BY revision
                """,
                (run_id,),
            ).fetchall()
        self.assertEqual(
            {
                "job_card_snapshots": 2,
                "engineer_submission_snapshots": 2,
                "expert_review_snapshots": 2,
            },
            counts,
        )
        self.assertEqual(
            [
                ("expert001", "rejected", "synthetic_demo"),
                ("expert001", "approved", "synthetic_demo"),
            ],
            reviews,
        )


if __name__ == "__main__":
    unittest.main()
