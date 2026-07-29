import io
import tempfile
import unittest
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from backend.case_authoring.registry import CompositeCasePackageRegistry
from backend.case_authoring.service import CaseAuthoringService
from backend.case_generation.orchestrator import CaseGenerationService
from backend.case_generation.providers import StructuredLocalGenerationProvider
from backend.case_generation.templates import CaseGenerationTemplateRegistry
from backend.case_package import CasePackageRegistry
from backend.case_platform.migrations import MigrationRunner
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


if __name__ == "__main__":
    unittest.main()
