from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

from backend.case_package import CasePackageRegistry
from backend.case_platform.migrations import MigrationRunner
from backend.runtime.config import ConfigurationError, RuntimeSettings


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def run_preflight(
    settings: RuntimeSettings,
    *,
    apply_migrations: bool = True,
) -> tuple[bool, dict[str, object]]:
    checks: dict[str, object] = {}
    ready = True

    required_files = [
        settings.repository_root / "backend" / "app.py",
        settings.repository_root / "backend" / "wsgi.py",
        settings.repository_root / "backend" / "requirements.txt",
        settings.repository_root / "backend" / "data" / "cases" / "case_registry.json",
    ]
    missing = [str(path) for path in required_files if not path.is_file()]
    checks["sourceFiles"] = {
        "status": "ok" if not missing else "error",
        "missing": missing,
    }
    ready = ready and not missing

    registry = CasePackageRegistry(
        settings.repository_root / "backend" / "data" / "cases",
        settings.repository_root
        / "backend"
        / "data"
        / "presentation"
        / "manual_sources.json",
    ).load()
    runnable = registry.runnable_items()
    checks["caseRegistry"] = {
        "status": "ok" if runnable else "error",
        "registryVersion": registry.registry_version,
        "runnableCaseIds": [item["id"] for item in runnable],
        "loadErrors": {
            case_id: error.code
            for case_id, error in sorted(registry.load_errors.items())
        },
    }
    ready = ready and bool(runnable)

    user_count = 0
    try:
        if apply_migrations:
            applied = MigrationRunner(settings.database_path).migrate()
        else:
            applied = []
        with sqlite3.connect(settings.database_path) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            migration_count = connection.execute(
                "SELECT count(*) FROM schema_migrations"
            ).fetchone()[0]
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
                )
            }
            required_core_tables = {
                "platform_users",
                "auth_sessions",
                "audit_events",
                "manual_documents",
                "manual_chunks",
                "manual_chunks_fts",
                "graph_change_sets",
                "graph_change_items",
                "graph_versions",
                "maintenance_work_orders",
                "job_card_documents",
                "knowledge_ingestion_jobs",
                "knowledge_ingestion_items",
                "knowledge_search_runs",
                "data_integrity_runs",
                "data_integrity_findings",
                "audit_exports",
                "case_authoring_drafts",
                "case_authoring_modules",
                "case_validation_runs",
                "case_review_records",
                "case_releases",
                "case_authoring_events",
                "case_agent_suggestions",
            }
            missing_core_tables = sorted(required_core_tables - tables)
            fts5 = "ENABLE_FTS5" in {
                row[0]
                for row in connection.execute("PRAGMA compile_options")
            }
            if not fts5:
                try:
                    connection.execute(
                        "CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(value)"
                    )
                    fts5 = True
                except sqlite3.OperationalError:
                    fts5 = False
            user_count = connection.execute(
                "SELECT count(*) FROM platform_users WHERE status='active'"
            ).fetchone()[0]
        checks["database"] = {
            "status": (
                "ok"
                if integrity == "ok" and not missing_core_tables and fts5
                else "error"
            ),
            "path": str(settings.database_path),
            "integrity": integrity,
            "migrationCount": migration_count,
            "appliedMigrations": applied,
            "missingCoreTables": missing_core_tables,
            "fts5": fts5,
        }
        ready = (
            ready
            and integrity == "ok"
            and not missing_core_tables
            and fts5
        )
    except (OSError, sqlite3.Error) as exc:
        ready = False
        checks["database"] = {"status": "error", "reason": str(exc)}

    storage_checks = {}
    for name, root in (
        ("attachments", settings.attachment_root),
        ("manuals", settings.manual_storage_root),
        ("jobCards", settings.job_card_storage_root),
        ("exports", settings.export_storage_root),
        ("platformBackups", settings.platform_backup_root),
        ("caseAuthoring", settings.case_authoring_root),
    ):
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".preflight-write-probe"
            probe.write_bytes(b"preflight")
            probe.unlink()
            storage_checks[name] = {"status": "ok", "path": str(root)}
        except OSError as exc:
            ready = False
            storage_checks[name] = {"status": "error", "reason": str(exc)}
    checks["storage"] = storage_checks
    checks["attachmentStorage"] = storage_checks["attachments"]
    checks["identity"] = {
        "status": (
            "ok"
            if (
                settings.auth_mode == "compat"
                or user_count > 0
                or bool(settings.bootstrap_admin_account)
            )
            else "error"
        ),
        "authMode": settings.auth_mode,
        "activeUserCount": user_count,
        "bootstrapAdminConfigured": bool(settings.bootstrap_admin_account),
        "bootstrapRecommendation": (
            None
            if settings.bootstrap_admin_account
            else "首次生产部署前配置 bootstrap 管理员，创建正式管理员后移除配置"
        ),
    }
    if checks["identity"]["status"] == "error":
        ready = False

    frontend_exists = (settings.frontend_dist / "index.html").is_file()
    checks["frontend"] = {
        "status": "ok" if frontend_exists else "missing",
        "path": str(settings.frontend_dist),
        "required": settings.readiness_requires_frontend,
    }
    if settings.readiness_requires_frontend and not frontend_exists:
        ready = False

    disk = os.statvfs(settings.repository_root)
    available_bytes = disk.f_bavail * disk.f_frsize
    checks["disk"] = {
        "status": "ok" if available_bytes >= 256 * 1024 * 1024 else "warning",
        "availableBytes": available_bytes,
    }
    return ready, checks


def main() -> int:
    try:
        settings = RuntimeSettings.from_environment(REPOSITORY_ROOT)
        ready, checks = run_preflight(settings)
    except ConfigurationError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "configuration_error",
                    "message": str(exc),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 2
    print(
        json.dumps(
            {
                "ok": ready,
                "configuration": settings.public_summary(),
                "checks": checks,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if ready else 1


if __name__ == "__main__":
    sys.exit(main())
