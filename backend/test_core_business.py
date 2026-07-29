import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
import yaml

from backend.app import create_app
from backend.case_package import CasePackageRegistry
from backend.case_platform.case_runs import CaseRunStore
from backend.case_platform.errors import PlatformError
from backend.case_platform.migrations import MigrationRunner
from backend.core_business.audit import AuditService
from backend.core_business.auth import IdentityService
from backend.core_business.graph import GovernedGraphService
from backend.core_business.manuals import ManualKnowledgeService
from backend.core_business.work_orders import WorkOrderService
from backend.runtime.config import RuntimeSettings
from backend.runtime.preflight import run_preflight


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"


def sample_pdf(*lines: str) -> bytes:
    buffer = io.BytesIO()
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    document = canvas.Canvas(buffer, pagesize=A4)
    for line in lines:
        document.setFont("STSong-Light", 12)
        document.drawString(50, 790, line)
        document.showPage()
    document.save()
    return buffer.getvalue()


class CoreBusinessServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "platform.db"
        self.assertEqual(
            ["001", "002", "003", "004", "005"],
            MigrationRunner(self.database).migrate(),
        )
        self.audit = AuditService(self.database)
        self.identity = IdentityService(
            self.database,
            self.audit,
            session_ttl_seconds=3600,
            max_failures=3,
            lock_seconds=300,
        )
        self.admin = self.identity.create_user(
            account="admin.test",
            display_name="测试管理员",
            role="admin",
            password="AdminPass2026",
            profile={"team": "平台组"},
            created_by="test-bootstrap",
        )
        self.expert = self.identity.create_user(
            account="expert.test",
            display_name="测试专家",
            role="expert",
            password="ExpertPass2026",
            profile={"specialty": "工控设备"},
            created_by=self.admin["id"],
        )
        self.engineer = self.identity.create_user(
            account="engineer.test",
            display_name="测试工程师",
            role="engineer",
            password="EngineerPass2026",
            profile={"site": "测试站"},
            created_by=self.admin["id"],
        )

    def actor(self, user):
        return {"id": user["id"], "role": user["role"]}

    def test_identity_sessions_locking_revocation_and_redacted_audit(self):
        login = self.identity.login(
            "engineer.test",
            "EngineerPass2026",
            client_ip="127.0.0.1",
            user_agent="unittest",
        )
        actor = self.identity.authenticate_token(login["accessToken"])
        self.assertEqual(self.engineer["id"], actor["id"])
        with sqlite3.connect(self.database) as db:
            stored = db.execute(
                "SELECT token_hash FROM auth_sessions WHERE session_id=?",
                (login["sessionId"],),
            ).fetchone()[0]
        self.assertNotEqual(login["accessToken"], stored)

        for _ in range(3):
            with self.assertRaises(PlatformError):
                self.identity.login("expert.test", "wrong-password")
        with self.assertRaises(PlatformError) as locked:
            self.identity.login("expert.test", "ExpertPass2026")
        self.assertEqual("account_locked", locked.exception.code)

        self.identity.reset_password(
            self.engineer["id"],
            "EngineerNext2026",
            actor_id=self.admin["id"],
        )
        with self.assertRaises(PlatformError) as invalidated:
            self.identity.authenticate_token(login["accessToken"])
        self.assertEqual("session_invalid", invalidated.exception.code)

        self.audit.record(
            "test.secret",
            "test",
            metadata={"password": "plain", "nested": {"token": "secret"}},
        )
        events = self.audit.query(action="test.secret")
        self.assertEqual("[REDACTED]", events["items"][0]["metadata"]["password"])
        self.assertEqual(
            "[REDACTED]",
            events["items"][0]["metadata"]["nested"]["token"],
        )

    def test_manual_pdf_ingestion_search_reindex_and_delete(self):
        service = ManualKnowledgeService(
            self.database,
            self.root / "manuals",
            self.audit,
        )
        pdf = sample_pdf(
            "FAN1 connector must be connected before FAN2.",
            "检查滤网粉尘堵塞并记录风扇转速。",
        )
        document = service.import_pdf(
            pdf,
            "cooling-manual.pdf",
            {
                "title": "工控机散热检修手册",
                "vendor": "Test Vendor",
                "equipmentType": "industrial-computer",
                "faultDomains": ["cooling", "fan"],
                "version": "1.0",
            },
            actor=self.actor(self.expert),
        )
        self.assertEqual(2, document["pageCount"])
        self.assertGreaterEqual(document["chunkCount"], 2)
        result = service.search("FAN1 connector")
        self.assertEqual(document["id"], result["items"][0]["documentId"])
        self.assertEqual(1, result["items"][0]["pageNumber"])
        chinese = service.search("粉尘堵塞")
        self.assertEqual(2, chinese["items"][0]["pageNumber"])
        self.assertEqual(
            document["id"],
            service.reindex(
                document["id"],
                actor=self.actor(self.expert),
            )["id"],
        )
        with self.assertRaises(PlatformError) as duplicate:
            service.import_pdf(
                pdf,
                "duplicate.pdf",
                {"title": "重复"},
                actor=self.actor(self.expert),
            )
        self.assertEqual("manual_duplicate", duplicate.exception.code)
        service.delete(document["id"], actor=self.actor(self.admin))
        with self.assertRaises(PlatformError):
            service.get_document(document["id"])

    def test_governed_graph_review_publish_diff_and_base_conflict(self):
        graph = GovernedGraphService(self.database, self.audit)
        first = graph.initialize_seed(
            {
                "nodes": [
                    {"id": "device-root", "type": "device", "name": "工控机"},
                ],
                "relations": [],
            }
        )
        self.assertEqual("GRAPH-V0001", first["versionId"])
        change = graph.create_change_set(
            "新增供电异常",
            "从现场诊断记录补充",
            actor=self.actor(self.engineer),
        )
        change = graph.upsert_change_item(
            change["id"],
            "upsert",
            "node",
            "fault-power",
            {
                "id": "fault-power",
                "type": "fault",
                "label": "供电异常",
                "properties": {"verificationLevel": "field_case"},
            },
            actor=self.actor(self.engineer),
        )
        graph.upsert_change_item(
            change["id"],
            "upsert",
            "edge",
            "edge-root-power",
            {
                "id": "edge-root-power",
                "source": "device-root",
                "target": "fault-power",
                "relation": "包含故障",
                "properties": {},
            },
            actor=self.actor(self.engineer),
        )
        graph.submit(change["id"], actor=self.actor(self.engineer))
        graph.review(
            change["id"],
            "approved",
            "证据完整",
            actor=self.actor(self.expert),
        )
        published = graph.publish(change["id"], actor=self.actor(self.expert))
        self.assertEqual("GRAPH-V0002", published["versionId"])
        diff = graph.diff("GRAPH-V0001", "GRAPH-V0002")
        self.assertEqual("fault-power", diff["nodes"]["added"][0]["id"])
        subgraph = graph.subgraph("device-root", depth=1)
        self.assertEqual(2, len(subgraph["nodes"]))

        stale = graph.create_change_set(
            "并行草稿",
            "",
            actor=self.actor(self.engineer),
        )
        fresh = graph.create_change_set(
            "先发布草稿",
            "",
            actor=self.actor(self.engineer),
        )
        for item in (stale, fresh):
            graph.upsert_change_item(
                item["id"],
                "upsert",
                "node",
                f"node-{item['id'].lower()}",
                {
                    "id": f"node-{item['id'].lower()}",
                    "type": "symptom",
                    "label": item["title"],
                    "properties": {},
                },
                actor=self.actor(self.engineer),
            )
            graph.submit(item["id"], actor=self.actor(self.engineer))
            graph.review(
                item["id"],
                "approved",
                "",
                actor=self.actor(self.expert),
            )
        graph.publish(fresh["id"], actor=self.actor(self.expert))
        with self.assertRaises(PlatformError) as conflict:
            graph.publish(stale["id"], actor=self.actor(self.expert))
        self.assertEqual("graph_base_conflict", conflict.exception.code)

    def test_work_order_revision_and_immutable_pdf_versions(self):
        package = CasePackageRegistry(CASES_DIR, SOURCES_FILE).load().get(
            "CASE-ACP4000-001"
        )
        run = CaseRunStore(self.database).create_run(
            package,
            self.engineer["id"],
            "b4fe1901-eac8-4cd8-83e8-c4481ffcd992",
            {"description": "TEMP/FAN 告警，风扇转速低"},
        )
        service = WorkOrderService(
            self.database,
            self.root / "job-cards",
            self.audit,
        )
        order = service.create(
            run.run_id,
            "工控机散热异常检修",
            actor=self.actor(self.engineer),
            assigned_to=self.engineer["id"],
            priority="high",
        )
        self.assertTrue(order["orderNumber"].startswith("WO-"))
        with self.assertRaises(PlatformError) as stale:
            service.update(
                order["id"],
                99,
                {"summary": "过期写"},
                actor=self.actor(self.engineer),
            )
        self.assertEqual("state_conflict", stale.exception.code)
        first = service.generate_job_card(
            order["id"],
            actor=self.actor(self.engineer),
        )
        replay = service.generate_job_card(
            order["id"],
            actor=self.actor(self.engineer),
        )
        self.assertEqual(first["id"], replay["id"])
        path, verified = service.download_path(first["id"])
        self.assertTrue(path.read_bytes().startswith(b"%PDF-"))
        self.assertGreater(verified["byteCount"], 1000)

        updated = service.update(
            order["id"],
            order["revision"],
            {"summary": "完成滤网、风扇和接线检查"},
            actor=self.actor(self.engineer),
        )
        second = service.generate_job_card(
            updated["id"],
            actor=self.actor(self.engineer),
        )
        self.assertEqual(2, second["version"])
        self.assertNotEqual(first["pdfSha256"], second["pdfSha256"])
        self.assertEqual(2, len(service.list_job_cards(order["id"])))


class CoreBusinessApiTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.database = root / "api.db"
        settings = RuntimeSettings.from_environment(
            ROOT,
            {
                "LA_ENV": "test",
                "PRESENTATION_DATABASE_PATH": str(self.database),
                "LA_BOOTSTRAP_ADMIN_ACCOUNT": "platform.admin",
                "LA_BOOTSTRAP_ADMIN_PASSWORD": "PlatformAdmin2026",
                "LA_MANUAL_STORAGE_ROOT": str(root / "manuals"),
                "LA_JOB_CARD_STORAGE_ROOT": str(root / "job-cards"),
                "ATTACHMENT_STORAGE_ROOT": str(root / "attachments"),
            },
        )
        self.client = create_app(runtime_settings=settings).test_client()

    def login(self):
        response = self.client.post(
            "/api/platform/auth/login",
            json={
                "account": "platform.admin",
                "password": "PlatformAdmin2026",
            },
        )
        self.assertEqual(200, response.status_code)
        return response.get_json()["data"]["accessToken"]

    def test_authenticated_admin_api_and_request_actor_consistency(self):
        token = self.login()
        headers = {"Authorization": f"Bearer {token}"}
        created = self.client.post(
            "/api/platform/admin/users",
            headers=headers,
            json={
                "account": "api.engineer",
                "displayName": "接口工程师",
                "role": "engineer",
                "password": "EngineerApi2026",
                "profile": {"site": "API 测试站"},
            },
        )
        self.assertEqual(201, created.status_code)
        users = self.client.get("/api/platform/admin/users", headers=headers)
        self.assertEqual(2, users.get_json()["data"]["total"])
        audits = self.client.get(
            "/api/platform/admin/audit-events",
            headers=headers,
        )
        actions = {item["action"] for item in audits.get_json()["data"]["items"]}
        self.assertIn("user.created", actions)

        mismatch = self.client.post(
            "/api/platform/case-runs",
            headers=headers,
            json={
                "caseId": "CASE-ACP4000-001",
                "actor": {"id": "someone-else", "role": "admin"},
                "input": {"description": "TEMP/FAN 告警"},
                "idempotencyKey": "2066baaf-c696-41d0-9e60-a4cfca31c146",
            },
        )
        self.assertEqual(403, mismatch.status_code)

    def test_core_api_rejects_missing_session(self):
        response = self.client.get("/api/platform/admin/users")
        self.assertEqual(401, response.status_code)
        self.assertEqual(
            "authentication_required",
            response.get_json()["error"]["code"],
        )

    def test_openapi_declares_all_core_business_paths(self):
        specification = yaml.safe_load(
            (ROOT / "backend" / "openapi" / "case-platform.openapi.yaml").read_text(
                encoding="utf-8"
            )
        )
        paths = specification["paths"]
        expected = {
            "/api/platform/auth/login",
            "/api/platform/admin/users",
            "/api/platform/manuals/import",
            "/api/platform/manuals/search",
            "/api/platform/graph/change-sets",
            "/api/platform/graph/diff",
            "/api/platform/work-orders",
            "/api/platform/work-orders/{orderId}/job-cards",
            "/api/platform/job-cards/{documentId}/download",
        }
        self.assertFalse(expected - paths.keys())
        self.assertIn(
            "BearerAuth",
            specification["components"]["securitySchemes"],
        )

    def test_enforced_preflight_requires_user_or_bootstrap_identity(self):
        root = Path(self.temporary.name)
        settings = RuntimeSettings.from_environment(
            ROOT,
            {
                "LA_ENV": "test",
                "PRESENTATION_DATABASE_PATH": str(root / "empty-auth.db"),
                "ATTACHMENT_STORAGE_ROOT": str(root / "auth-attachments"),
                "LA_MANUAL_STORAGE_ROOT": str(root / "auth-manuals"),
                "LA_JOB_CARD_STORAGE_ROOT": str(root / "auth-job-cards"),
                "LA_AUTH_MODE": "enforced",
            },
        )
        ready, checks = run_preflight(settings)
        self.assertFalse(ready)
        self.assertEqual("error", checks["identity"]["status"])


if __name__ == "__main__":
    unittest.main()
