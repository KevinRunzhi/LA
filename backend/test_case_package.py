import json
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.case_package import CasePackageRegistry


ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "backend" / "data" / "cases"
SOURCES_FILE = ROOT / "backend" / "data" / "presentation" / "manual_sources.json"


class CasePackageRegistryTest(unittest.TestCase):
    def load_registry(self, cases_dir: Path = CASES_DIR):
        return CasePackageRegistry(cases_dir, SOURCES_FILE).load()

    def copy_cases(self) -> tuple[tempfile.TemporaryDirectory, Path]:
        temporary = tempfile.TemporaryDirectory()
        copied = Path(temporary.name) / "cases"
        shutil.copytree(CASES_DIR, copied)
        return temporary, copied

    @staticmethod
    def update_json(path: Path, update):
        value = json.loads(path.read_text(encoding="utf-8"))
        update(value)
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def test_official_packages_load_with_stable_hashes(self):
        first = self.load_registry()
        second = self.load_registry()
        self.assertEqual("1.1", first.registry_version)
        self.assertEqual({}, first.load_errors)
        self.assertEqual(
            ["CASE-ACP4000-001", "CASE-ROCKWELL-6300-002"],
            [package.case_id for package in first.list_packages()],
        )
        self.assertEqual(
            [package.package_hash for package in first.list_packages()],
            [package.package_hash for package in second.list_packages()],
        )
        self.assertTrue(
            all(len(package.package_hash) == 64 for package in first.list_packages())
        )

    def test_unknown_module_field_fails_closed(self):
        temporary, copied = self.copy_cases()
        self.addCleanup(temporary.cleanup)
        path = copied / "CASE-ACP4000-001" / "intake.json"
        self.update_json(path, lambda value: value.update({"unexpected": True}))
        registry = self.load_registry(copied)
        self.assertNotIn(
            "CASE-ACP4000-001",
            [package.case_id for package in registry.list_packages()],
        )
        self.assertEqual(
            "schema_validation_error",
            registry.load_errors["CASE-ACP4000-001"].code,
        )

    def test_duplicate_and_broken_references_fail_closed(self):
        temporary, copied = self.copy_cases()
        self.addCleanup(temporary.cleanup)
        path = copied / "CASE-ACP4000-001" / "guide.json"

        def duplicate_check(value):
            value["steps"][1]["checks"][0]["id"] = value["steps"][0]["checks"][0]["id"]

        self.update_json(path, duplicate_check)
        registry = self.load_registry(copied)
        self.assertEqual(
            "duplicate_id",
            registry.load_errors["CASE-ACP4000-001"].code,
        )

        temporary_two, copied_two = self.copy_cases()
        self.addCleanup(temporary_two.cleanup)
        assistant_path = copied_two / "CASE-ROCKWELL-6300-002" / "assistant.json"
        self.update_json(
            assistant_path,
            lambda value: value["topics"][0]["allowedStepIds"].append("step-missing"),
        )
        registry_two = self.load_registry(copied_two)
        self.assertEqual(
            "broken_reference",
            registry_two.load_errors["CASE-ROCKWELL-6300-002"].code,
        )

    def test_unsupported_schema_version_fails_closed(self):
        temporary, copied = self.copy_cases()
        self.addCleanup(temporary.cleanup)
        path = copied / "CASE-ACP4000-001" / "manifest.json"
        self.update_json(path, lambda value: value.update({"schemaVersion": "2.0.0"}))
        registry = self.load_registry(copied)
        self.assertEqual(
            "unsupported_schema_version",
            registry.load_errors["CASE-ACP4000-001"].code,
        )

    def test_parent_absolute_and_symlink_paths_are_rejected(self):
        for unsafe in ("../outside.json", "/tmp/outside.json"):
            with self.subTest(path=unsafe):
                temporary, copied = self.copy_cases()
                self.addCleanup(temporary.cleanup)
                registry_path = copied / "case_registry.json"
                self.update_json(
                    registry_path,
                    lambda value, unsafe=unsafe: value["items"][0].update(
                        {"package": unsafe}
                    ),
                )
                with self.assertRaises(Exception) as raised:
                    self.load_registry(copied)
                self.assertIn(
                    getattr(raised.exception, "code", ""),
                    {"schema_validation_error", "unsafe_package_path"},
                )

        temporary, copied = self.copy_cases()
        self.addCleanup(temporary.cleanup)
        target = copied / "CASE-ACP4000-001" / "intake.json"
        target.unlink()
        target.symlink_to(copied / "CASE-ROCKWELL-6300-002" / "intake.json")
        registry = self.load_registry(copied)
        self.assertEqual(
            "unsafe_package_path",
            registry.load_errors["CASE-ACP4000-001"].code,
        )


if __name__ == "__main__":
    unittest.main()
