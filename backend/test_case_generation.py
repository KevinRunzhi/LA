import io
import copy
import tempfile
import unittest
import urllib.error
from unittest import mock
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from backend.case_authoring.registry import CompositeCasePackageRegistry
from backend.case_authoring.service import CaseAuthoringService
from backend.case_generation.orchestrator import CaseGenerationService
from backend.case_generation.providers import (
    RemoteJsonGenerationProvider,
    StructuredLocalGenerationProvider,
)
from backend.case_platform.errors import PlatformError
from backend.case_generation.templates import CaseGenerationTemplateRegistry
from backend.case_package import CasePackageRegistry
from backend.case_platform.migrations import MigrationRunner
from backend.case_platform.routing import DeterministicCaseRouter
from backend.case_platform.case_runs import CaseRunStore
from backend.core_business.audit import AuditService
from backend.core_business.graph import GovernedGraphService
from backend.core_business.manuals import ManualKnowledgeService


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"
TEMPLATES_DIR = ROOT / "backend" / "data" / "case-generation-templates"


def sample_pdf(text: str) -> bytes:
    target = io.BytesIO()
    document = canvas.Canvas(target, pagesize=A4)
    document.drawString(40, 790, text)
    document.save()
    return target.getvalue()


class FlakyDocumentProvider(StructuredLocalGenerationProvider):
    def __init__(self):
        self.parse_attempts = 0

    def parse_documents(self, chunks):
        self.parse_attempts += 1
        if self.parse_attempts < 3:
            raise OSError("temporary provider failure")
        return super().parse_documents(chunks)


class UnrepairableGuideProvider(StructuredLocalGenerationProvider):
    def generate_module(self, module_name, template, draft, evidence, job_id):
        module = super().generate_module(
            module_name, template, draft, evidence, job_id
        )
        if module_name == "guide":
            module["steps"][0]["assistantTopicIds"] = ["topic-reference-that-does-not-exist"]
        return module

    def repair_modules(self, template, draft, modules, errors, attempt):
        return copy.deepcopy(modules)


class CaseGenerationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "platform.db"
        MigrationRunner(self.database).migrate()
        self.audit = AuditService(self.database)
        self.manuals = ManualKnowledgeService(
            self.database,
            self.root / "manuals",
            self.audit,
        )
        self.graph = GovernedGraphService(self.database, self.audit)
        self.graph.initialize_seed(
            {
                "nodes": [{"id": "device-root", "type": "device", "label": "工控机", "properties": {}}],
                "relations": [],
            }
        )
        bundled = CasePackageRegistry(CASES_DIR, SOURCES_FILE).load()
        composite = CompositeCasePackageRegistry(
            bundled,
            self.root / "authoring" / "active",
            shared_sources_file=SOURCES_FILE,
            schemas_dir=CASES_DIR / "schemas",
        ).load()
        self.authoring = CaseAuthoringService(
            self.database,
            bundled_registry=bundled,
            composite_registry=composite,
            shared_sources_file=SOURCES_FILE,
            schemas_dir=CASES_DIR / "schemas",
            release_root=self.root / "authoring" / "releases",
            active_root=self.root / "authoring" / "active",
            audit=self.audit,
        )
        self.generation = CaseGenerationService(
            self.database,
            authoring=self.authoring,
            manuals=self.manuals,
            graph=self.graph,
            templates=CaseGenerationTemplateRegistry(TEMPLATES_DIR).load(),
            audit=self.audit,
        )
        self.expert = {"id": "expert-generation", "role": "expert"}

    def test_document_to_outline_modules_patches_and_valid_draft(self):
        manual = self.manuals.import_pdf(
            sample_pdf(
                "Disk SMART alarm. Check storage connector and backup data before replacement."
            ),
            "storage-maintenance.pdf",
            {
                "title": "工控机存储检修手册",
                "faultDomains": ["storage"],
            },
            actor=self.expert,
        )
        draft = self.authoring.create_draft(
            {
                "baseCaseId": "CASE-ACP4000-001",
                "caseId": "CASE-STORAGE-GEN-003",
            },
            self.expert,
        )
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.storage",
                "query": "硬盘 SMART 告警和磁盘无法识别",
                "sources": [
                    {"type": "manual", "resourceId": manual["id"]},
                    {"type": "case", "resourceId": "CASE-ACP4000-001"},
                ],
            },
            self.expert,
        )
        outline = self.generation.process_once(job["id"])
        self.assertEqual("awaiting_outline_review", outline["status"], outline)
        self.assertGreaterEqual(len(outline["agentRuns"]), 5)
        self.generation.approve_outline(job["id"], self.expert)
        generated = self.generation.process_once(job["id"])
        self.assertEqual("awaiting_patch_review", generated["status"])
        self.assertEqual(8, len(generated["patches"]))
        module_artifacts = [
            item for item in self.generation.get_artifacts(job["id"])
            if item["type"] == "module_candidate"
        ]
        self.assertEqual(8, len(module_artifacts))
        with self.generation.connect() as db:
            pointers = [
                row["json_pointer"]
                for row in db.execute(
                    "SELECT json_pointer FROM case_generation_evidence_links"
                )
            ]
        self.assertTrue(pointers)
        self.assertTrue(all(pointer.startswith("/") and pointer != "" for pointer in pointers))

        for patch in generated["patches"]:
            self.generation.decide_patch(patch["id"], "accepted", self.expert)
            self.generation.apply_patch(patch["id"], self.expert)
        completed = self.generation.get_job(job["id"])
        self.assertEqual("completed", completed["status"])
        validation = self.authoring.validate(draft["id"], self.expert)
        self.assertEqual("passed", validation["status"])
        next_draft = self.authoring.get_draft(draft["id"])
        self.assertEqual(
            "industrial-computer-storage",
            next_draft["modules"]["registry"]["faultCode"],
        )
        admin = {"id": "admin-generation-review", "role": "admin"}
        self.authoring.submit(draft["id"], next_draft["revision"], self.expert)
        self.authoring.review(
            draft["id"], "approved", "证据、步骤和模块引用已核对", admin
        )
        first_release = self.authoring.publish(draft["id"], "1.0.0", admin)
        routed = DeterministicCaseRouter(self.authoring.registry).route(
            {
                "description": "工控机磁盘无法识别并出现 SMART 告警",
                "equipment": "工控机",
                "alarms": ["SMART 告警"],
            }
        )
        self.assertEqual("CASE-STORAGE-GEN-003", routed.candidates[0].case_id)
        run = CaseRunStore(self.database).create_run(
            self.authoring.registry.get("CASE-STORAGE-GEN-003"),
            "engineer-generation",
            "7fdaef75-654f-4b81-9226-7a201ffba8bd",
            {"description": "工控机磁盘无法识别并出现 SMART 告警"},
        )
        self.assertEqual("CASE-STORAGE-GEN-003", run.case_id)

        rollback_draft = self.authoring.create_draft(
            {"baseCaseId": "CASE-STORAGE-GEN-003"}, self.expert
        )
        validation = self.authoring.validate(rollback_draft["id"], self.expert)
        self.assertEqual("passed", validation["status"])
        self.authoring.submit(
            rollback_draft["id"], rollback_draft["revision"], self.expert
        )
        self.authoring.review(
            rollback_draft["id"], "approved", "历史版本回滚验收", admin
        )
        self.authoring.publish(rollback_draft["id"], "1.1.0", admin)
        activated = self.authoring.activate(first_release["id"], admin)
        self.assertEqual("active", activated["status"])

    def test_reject_outline_stops_generation(self):
        draft = self.authoring.create_draft(
            {"baseCaseId": "CASE-ACP4000-001"},
            self.expert,
        )
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.cooling",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.process_once(job["id"])
        rejected = self.generation.reject_outline(
            job["id"],
            "需要补充手册证据",
            self.expert,
        )
        self.assertEqual("failed", rejected["status"])
        self.assertEqual("outline_rejected", rejected["failureCode"])

    def test_rejecting_every_patch_completes_human_review(self):
        draft = self.authoring.create_draft(
            {"baseCaseId": "CASE-ACP4000-001"},
            self.expert,
        )
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.cooling",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.process_once(job["id"])
        self.generation.approve_outline(job["id"], self.expert)
        generated = self.generation.process_once(job["id"])
        for patch in generated["patches"]:
            self.generation.decide_patch(patch["id"], "rejected", self.expert)
        completed = self.generation.get_job(job["id"])
        self.assertEqual("completed", completed["status"])

    def test_agent_failure_is_persisted_and_retried_with_bounded_attempts(self):
        provider = FlakyDocumentProvider()
        self.generation.provider = provider
        draft = self.authoring.create_draft(
            {"baseCaseId": "CASE-ACP4000-001"},
            self.expert,
        )
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.cooling",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        result = self.generation.process_once(job["id"])
        self.assertEqual("awaiting_outline_review", result["status"])
        document_runs = [
            item for item in result["agentRuns"]
            if item["agentType"] == "document_understanding"
        ]
        self.assertEqual(["failed", "failed", "completed"], [item["status"] for item in document_runs])
        self.assertEqual(
            ["agent_provider_unavailable", "agent_provider_unavailable", None],
            [item["errorCode"] for item in document_runs],
        )
        metrics = self.generation.render_metrics()
        self.assertIn("case_generation_agent_runs_total", metrics)
        self.assertIn("case_generation_evidence_coverage_ratio", metrics)

    def test_low_confidence_domain_pauses_until_expert_confirmation(self):
        draft = self.authoring.create_draft({"baseCaseId": "CASE-ACP4000-001"}, self.expert)
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "query": "无法归类的现场现象",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        paused = self.generation.process_once(job["id"])
        self.assertEqual("awaiting_outline_review", paused["status"])
        self.assertEqual("awaiting_domain_review", paused["currentStage"])
        confirmed = self.generation.confirm_domain(
            job["id"], "industrial-computer.hardware", self.expert
        )
        self.assertEqual("planning", confirmed["status"])
        outlined = self.generation.process_once(job["id"])
        self.assertEqual("awaiting_outline_review", outlined["status"])
        self.assertEqual("hardware", outlined["faultDomain"])

    def test_cancelled_and_leased_jobs_are_not_processed(self):
        draft = self.authoring.create_draft({"baseCaseId": "CASE-ACP4000-001"}, self.expert)
        cancelled_job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.cooling",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.cancel(cancelled_job["id"], self.expert)
        self.assertIsNone(self.generation.process_once(cancelled_job["id"]))
        leased_job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.cooling",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        with self.generation.transaction() as db:
            db.execute(
                "UPDATE case_generation_jobs SET lease_expires_at='2999-01-01T00:00:00+00:00' WHERE job_id=?",
                (leased_job["id"],),
            )
        self.assertIsNone(self.generation.process_once(leased_job["id"]))
        with self.generation.transaction() as db:
            db.execute(
                "UPDATE case_generation_jobs SET lease_expires_at='2000-01-01T00:00:00+00:00' WHERE job_id=?",
                (leased_job["id"],),
            )
        self.assertEqual(
            "awaiting_outline_review",
            self.generation.process_once(leased_job["id"])["status"],
        )

    def test_patch_detects_manual_revision_change(self):
        draft = self.authoring.create_draft({"baseCaseId": "CASE-ACP4000-001"}, self.expert)
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.storage",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.process_once(job["id"])
        self.generation.approve_outline(job["id"], self.expert)
        generated = self.generation.process_once(job["id"])
        patch = generated["patches"][0]
        self.generation.decide_patch(patch["id"], "accepted", self.expert, [0])
        current = self.authoring.get_draft(draft["id"])
        module = current["modules"]["registry"]
        module["mode"] = "recorded_demo"
        self.authoring.update_module(
            draft["id"], "registry", module, current["revision"], self.expert
        )
        with self.assertRaises(PlatformError) as captured:
            self.generation.apply_patch(patch["id"], self.expert)
        self.assertEqual("revision_conflict", captured.exception.code)

    def test_partial_field_application_runs_final_validation_and_blocks_publish(self):
        draft = self.authoring.create_draft({"baseCaseId": "CASE-ACP4000-001"}, self.expert)
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.storage",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.process_once(job["id"])
        self.generation.approve_outline(job["id"], self.expert)
        generated = self.generation.process_once(job["id"])
        registry_patch = next(
            item for item in generated["patches"] if item["moduleName"] == "registry"
        )
        self.generation.decide_patch(
            registry_patch["id"], "accepted", self.expert, [0]
        )
        self.generation.apply_patch(registry_patch["id"], self.expert)
        for patch in generated["patches"]:
            if patch["id"] != registry_patch["id"]:
                self.generation.decide_patch(patch["id"], "rejected", self.expert)
        finalized = self.generation.get_job(job["id"])
        final_checks = [
            item for item in finalized["evaluations"]
            if item["ruleId"] == "post_patch_case_validation"
        ]
        self.assertEqual(1, len(final_checks))
        if finalized["status"] == "failed":
            self.assertEqual("post_patch_validation_failed", finalized["failureCode"])
        with self.assertRaises(PlatformError):
            self.authoring.publish(draft["id"], "9.9.9", self.expert)

    def test_unchanged_repair_error_stops_and_never_modifies_draft(self):
        self.generation.provider = UnrepairableGuideProvider()
        draft = self.authoring.create_draft({"baseCaseId": "CASE-ACP4000-001"}, self.expert)
        initial_revision = draft["revision"]
        job = self.generation.create_job(
            {
                "draftId": draft["id"],
                "templateId": "industrial-computer.storage",
                "sources": [{"type": "case", "resourceId": "CASE-ACP4000-001"}],
            },
            self.expert,
        )
        self.generation.process_once(job["id"])
        self.generation.approve_outline(job["id"], self.expert)
        failed = self.generation.process_once(job["id"])
        self.assertEqual("failed", failed["status"])
        repairs = [
            item for item in failed["agentRuns"]
            if item["agentType"] == "targeted_repair"
        ]
        self.assertGreaterEqual(len(repairs), 1)
        self.assertLessEqual(len(repairs), 3)
        self.assertEqual(
            initial_revision,
            self.authoring.get_draft(draft["id"])["revision"],
        )
        self.assertEqual([], failed["patches"])


class ProviderBoundaryTest(unittest.TestCase):
    def test_document_contract_preserves_page_negation_and_units(self):
        provider = StructuredLocalGenerationProvider()
        parsed = provider.parse_documents([
            {
                "documentId": "DOC-1",
                "chunkId": "CHK-1",
                "pageNumber": 24,
                "title": "Fan Connector",
                "text": "Fan Connector\n不得在转速低于 900 rpm 时直接更换接线。\nPage 24",
            }
        ])
        evidence = provider.extract_evidence(parsed["sections"])["evidence"]
        self.assertTrue(evidence)
        self.assertEqual([24], evidence[0]["pages"])
        self.assertEqual("negative", evidence[0]["polarity"])
        self.assertIn("900 rpm", evidence[0]["quantities"])

    def test_remote_provider_rejects_invalid_json_and_timeout(self):
        provider = RemoteJsonGenerationProvider(
            "http://provider.invalid/generate", "structured-model", timeout_seconds=1
        )
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"not-json"
        with mock.patch("urllib.request.urlopen", return_value=response):
            with self.assertRaises(ValueError):
                provider.parse_documents([])
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError("timeout"),
        ):
            with self.assertRaises(OSError):
                provider.parse_documents([])
        valid = mock.MagicMock()
        valid.__enter__.return_value.read.return_value = (
            b'{"output":{"sections":[],"sectionCount":0},'
            b'"usage":{"inputTokens":12,"outputTokens":4}}'
        )
        with mock.patch("urllib.request.urlopen", return_value=valid):
            result = provider.parse_documents([])
        self.assertEqual(0, result["sectionCount"])
        self.assertEqual(12, provider.consume_usage()["inputTokens"])
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaises(TimeoutError):
                provider.parse_documents([])


if __name__ == "__main__":
    unittest.main()
