import tempfile
import unittest
from pathlib import Path

from backend.case_authoring.registry import CompositeCasePackageRegistry
from backend.case_authoring.service import CaseAuthoringService
from backend.case_package import CasePackageRegistry
from backend.case_platform.migrations import MigrationRunner
from backend.core_business.audit import AuditService


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"


class CaseAuthoringTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "platform.db"
        MigrationRunner(self.database).migrate()
        self.bundled = CasePackageRegistry(CASES_DIR, SOURCES_FILE).load()
        self.composite = CompositeCasePackageRegistry(
            self.bundled,
            self.root / "authoring" / "active",
            shared_sources_file=SOURCES_FILE,
            schemas_dir=CASES_DIR / "schemas",
        ).load()
        self.service = CaseAuthoringService(
            self.database,
            bundled_registry=self.bundled,
            composite_registry=self.composite,
            shared_sources_file=SOURCES_FILE,
            schemas_dir=CASES_DIR / "schemas",
            release_root=self.root / "authoring" / "releases",
            active_root=self.root / "authoring" / "active",
            audit=AuditService(self.database),
        )
        self.expert = {"id": "expert-author", "role": "expert"}
        self.admin = {"id": "admin-reviewer", "role": "admin"}

    def test_clone_validate_review_publish_and_runtime_override(self):
        draft = self.service.create_draft(
            {"baseCaseId": "CASE-ACP4000-001"},
            self.expert,
        )
        self.assertEqual(8, len(draft["modules"]))
        validation = self.service.validate(draft["id"], self.expert)
        self.assertEqual("passed", validation["status"])
        submitted = self.service.submit(
            draft["id"],
            draft["revision"],
            self.expert,
        )
        self.assertEqual("ready_for_review", submitted["status"])
        approved = self.service.review(
            draft["id"],
            "approved",
            "模块、证据和检修步骤已核对",
            self.admin,
        )
        self.assertEqual("approved", approved["status"])
        release = self.service.publish(draft["id"], "1.1.0", self.admin)
        self.assertEqual("active", release["status"])
        self.assertEqual(
            "1.1.0",
            self.composite.get("CASE-ACP4000-001").package_version,
        )
        self.assertTrue(
            (self.root / "authoring" / "active" / "case_registry.json").is_file()
        )

    def test_invalid_cross_reference_blocks_submission(self):
        draft = self.service.create_draft(
            {"baseCaseId": "CASE-ACP4000-001"},
            self.expert,
        )
        guide = draft["modules"]["guide"]
        guide["steps"][0]["assistantTopicIds"] = ["topic-does-not-exist"]
        changed = self.service.update_module(
            draft["id"],
            "guide",
            guide,
            draft["revision"],
            self.expert,
        )
        validation = self.service.validate(changed["id"], self.expert)
        self.assertEqual("failed", validation["status"])
        self.assertEqual("broken_reference", validation["errors"][0]["code"])


if __name__ == "__main__":
    unittest.main()
