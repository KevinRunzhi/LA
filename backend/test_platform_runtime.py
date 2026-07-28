import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from backend.runtime.config import ConfigurationError, RuntimeSettings
from backend.runtime.database_ops import (
    assert_integrity,
    backup_database,
    restore_database,
    verify_checksum,
)
from backend.runtime.preflight import run_preflight
from backend.runtime.provider_factory import build_diagnosis_provider


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class RuntimeConfigurationTest(unittest.TestCase):
    def test_environment_values_are_parsed_and_paths_are_resolved(self):
        settings = RuntimeSettings.from_environment(
            REPOSITORY_ROOT,
            {
                "LA_ENV": "production",
                "APP_HOST": "127.0.0.1",
                "APP_PORT": "18080",
                "PRESENTATION_DATABASE_PATH": "run/test.db",
                "ATTACHMENT_STORAGE_ROOT": "run/evidence",
                "ATTACHMENT_MAX_BYTES": "4096",
                "FRONTEND_DIST_PATH": "frontend/dist",
                "LOG_LEVEL": "WARNING",
                "JSON_ACCESS_LOG": "false",
                "READINESS_REQUIRES_FRONTEND": "true",
                "TRUST_PROXY_HEADERS": "true",
                "CORS_ALLOWED_ORIGINS": "https://review.example,https://ops.example",
            },
        )
        self.assertEqual(18080, settings.port)
        self.assertEqual(REPOSITORY_ROOT / "run" / "test.db", settings.database_path)
        self.assertEqual(4096, settings.attachment_max_bytes)
        self.assertFalse(settings.json_access_log)
        self.assertTrue(settings.readiness_requires_frontend)
        self.assertTrue(settings.trust_proxy_headers)
        self.assertEqual(
            ("https://review.example", "https://ops.example"),
            settings.cors_allowed_origins,
        )

    def test_remote_provider_selection_is_configured_and_secret_is_redacted(self):
        settings = RuntimeSettings.from_environment(
            REPOSITORY_ROOT,
            {
                "DIAGNOSIS_PROVIDER": "remote-http",
                "REMOTE_MODEL_BASE_URL": "https://diagnosis.example/v1/run",
                "REMOTE_MODEL_NAME": "industrial-diagnosis-v1",
                "REMOTE_MODEL_API_KEY": "secret-value",
            },
        )
        provider = build_diagnosis_provider(settings)
        self.assertEqual("remote-model", provider.provider_id)
        self.assertNotIn("remoteModelApiKey", settings.public_summary())
        self.assertNotIn("secret-value", str(settings.public_summary()))

    def test_invalid_environment_fails_before_startup(self):
        with self.assertRaises(ConfigurationError):
            RuntimeSettings.from_environment(
                REPOSITORY_ROOT,
                {"LA_ENV": "production", "APP_PORT": "not-a-port"},
            )
        with self.assertRaises(ConfigurationError):
            RuntimeSettings.from_environment(
                REPOSITORY_ROOT,
                {"JSON_ACCESS_LOG": "sometimes"},
            )
        with self.assertRaises(ConfigurationError):
            RuntimeSettings.from_environment(
                REPOSITORY_ROOT,
                {"DIAGNOSIS_PROVIDER": "remote-http"},
            )


class OperationalEndpointTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "runtime.db"
        self.client = create_app(self.database).test_client()

    def test_liveness_readiness_request_id_and_metrics(self):
        liveness = self.client.get(
            "/api/health/live",
            headers={"X-Request-ID": "review-trace-001"},
        )
        self.assertEqual(200, liveness.status_code)
        self.assertEqual("review-trace-001", liveness.headers["X-Request-ID"])
        self.assertEqual("*", liveness.headers["Access-Control-Allow-Origin"])

        readiness = self.client.get("/api/health/ready")
        self.assertEqual(200, readiness.status_code)
        checks = readiness.get_json()["checks"]
        self.assertEqual("ok", checks["database"]["status"])
        self.assertGreaterEqual(checks["caseRegistry"]["runnableCases"], 2)
        self.assertEqual("ok", checks["attachmentStorage"]["status"])

        metrics = self.client.get("/api/metrics")
        self.assertEqual(200, metrics.status_code)
        text = metrics.get_data(as_text=True)
        self.assertIn("la_http_requests_total", text)
        self.assertIn('route="/api/health/live"', text)
        self.assertNotIn("review-trace-001", text)

        capabilities = self.client.get("/api/platform/system/capabilities")
        self.assertEqual(200, capabilities.status_code)
        manifest = capabilities.get_json()["data"]
        self.assertEqual("sqlite", manifest["persistence"]["engine"])
        self.assertEqual(
            "rule-based-case-package",
            manifest["providers"]["diagnosis"],
        )
        self.assertTrue(manifest["knowledgeLifecycle"]["graphVersionDelta"])

    def test_preflight_uses_real_registry_migrations_and_storage(self):
        settings = RuntimeSettings.from_environment(
            REPOSITORY_ROOT,
            {
                "LA_ENV": "test",
                "PRESENTATION_DATABASE_PATH": str(self.database),
                "ATTACHMENT_STORAGE_ROOT": str(
                    Path(self.temporary.name) / "attachments"
                ),
                "READINESS_REQUIRES_FRONTEND": "false",
            },
        )
        ready, checks = run_preflight(settings)
        self.assertTrue(ready)
        self.assertEqual("ok", checks["database"]["integrity"])
        self.assertIn(
            "CASE-ACP4000-001",
            checks["caseRegistry"]["runnableCaseIds"],
        )


class DatabaseOperationsTest(unittest.TestCase):
    def test_backup_checksum_integrity_and_restore(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "live.db"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE sample (value TEXT)")
                connection.execute("INSERT INTO sample VALUES ('before')")
            backup, checksum = backup_database(database, root / "backups")
            verify_checksum(backup, checksum)
            assert_integrity(backup)

            with sqlite3.connect(database) as connection:
                connection.execute("UPDATE sample SET value='after'")
            safety = restore_database(
                database,
                backup,
                checksum,
                root / "safety",
            )
            self.assertIsNotNone(safety)
            with sqlite3.connect(database) as connection:
                value = connection.execute("SELECT value FROM sample").fetchone()[0]
            self.assertEqual("before", value)
            self.assertTrue(safety.is_file())


if __name__ == "__main__":
    unittest.main()
