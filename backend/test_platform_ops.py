import io
import tempfile
import unittest
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from backend.case_package import CasePackageRegistry
from backend.case_platform.errors import PlatformError
from backend.case_platform.migrations import MigrationRunner
from backend.core_business.audit import AuditService
from backend.core_business.graph import GovernedGraphService
from backend.core_business.manuals import ManualKnowledgeService
from backend.platform_ops.ingestion import IngestionService
from backend.platform_ops.operations import PlatformOperationsService
from backend.platform_ops.search import UnifiedKnowledgeSearchService


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"


def sample_pdf(text: str) -> bytes:
    target = io.BytesIO()
    document = canvas.Canvas(target, pagesize=A4)
    document.drawString(50, 790, text)
    document.save()
    return target.getvalue()


class PlatformOperationsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "platform.db"
        MigrationRunner(self.database).migrate()
        self.audit = AuditService(self.database)
        self.actor = {"id": "expert-test", "role": "expert"}
        self.admin = {"id": "admin-test", "role": "admin"}
        self.info = self.root / "Info"
        self.info.mkdir()
        self.manual_root = self.root / "manuals"
        self.manuals = ManualKnowledgeService(
            self.database,
            self.manual_root,
            self.audit,
        )
        self.graph = GovernedGraphService(self.database, self.audit)
        self.graph.initialize_seed(
            {
                "nodes": [
                    {
                        "id": "device-root",
                        "type": "device",
                        "label": "工控机",
                        "properties": {},
                    }
                ],
                "relations": [],
            }
        )
        self.ingestion = IngestionService(
            self.database,
            [self.info],
            self.manuals,
            self.audit,
        )
        self.operations = PlatformOperationsService(
            self.database,
            attachment_root=self.root / "attachments",
            manual_root=self.manual_root,
            job_card_root=self.root / "job-cards",
            export_root=self.root / "exports",
            backup_root=self.root / "backups",
            audit=self.audit,
        )

    def test_durable_ingestion_and_duplicate_skip(self):
        (self.info / "fan-maintenance.pdf").write_bytes(
            sample_pdf("FAN1 connector before FAN2 connector.")
        )
        job = self.ingestion.create_job("Info", actor=self.actor)
        self.assertEqual("pending", job["status"])
        completed = self.ingestion.process_once(job["id"])
        self.assertEqual("completed", completed["status"])
        self.assertEqual(1, completed["counts"]["imported"])

        duplicate = self.ingestion.create_job("Info", actor=self.actor)
        self.assertEqual("completed", duplicate["status"])
        self.assertEqual(1, duplicate["counts"]["skipped"])
        with self.assertRaises(PlatformError) as forbidden:
            self.ingestion.create_job(str(self.root.parent), actor=self.actor)
        self.assertEqual("ingestion_root_forbidden", forbidden.exception.code)

    def test_unified_search_persists_trace(self):
        self.manuals.import_pdf(
            sample_pdf("FAN1 connector before FAN2 connector."),
            "fan-order.pdf",
            {"title": "工控机风扇接线手册", "faultDomains": ["cooling"]},
            actor=self.actor,
        )
        service = UnifiedKnowledgeSearchService(
            self.database,
            self.manuals,
            self.graph,
            CasePackageRegistry(CASES_DIR, SOURCES_FILE).load(),
        )
        result = service.search(
            "FAN1 connector",
            {"faultDomain": "cooling"},
            actor=self.actor,
            request_id="req-test-search",
        )
        self.assertTrue(result["items"])
        self.assertEqual("manual", result["items"][0]["provider"])
        trace = service.get_run(result["searchRunId"], self.actor)
        self.assertEqual("req-test-search", trace["requestId"])
        self.assertGreaterEqual(
            trace["providerStats"]["manual"]["candidates"],
            1,
        )

    def test_integrity_export_and_asset_backup(self):
        for index in range(105):
            self.audit.record(
                "test.bulk",
                "test_resource",
                actor_id="admin-test",
                actor_role="admin",
                resource_id=str(index),
            )
        integrity = self.operations.integrity_run(self.admin)
        self.assertEqual("passed", integrity["status"])

        exported = self.operations.export_audit(
            "jsonl",
            {"action": "test.bulk"},
            self.admin,
        )
        self.assertEqual(105, exported["recordCount"])
        export_path, _ = self.operations.export_path(exported["id"])
        self.assertTrue(export_path.is_file())

        backup = self.operations.backup_assets()
        self.assertGreater(backup["fileCount"], 1)
        self.assertTrue(Path(backup["path"]).is_file())


if __name__ == "__main__":
    unittest.main()
