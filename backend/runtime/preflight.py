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
        checks["database"] = {
            "status": "ok" if integrity == "ok" else "error",
            "path": str(settings.database_path),
            "integrity": integrity,
            "migrationCount": migration_count,
            "appliedMigrations": applied,
        }
        ready = ready and integrity == "ok"
    except (OSError, sqlite3.Error) as exc:
        ready = False
        checks["database"] = {"status": "error", "reason": str(exc)}

    try:
        settings.attachment_root.mkdir(parents=True, exist_ok=True)
        probe = settings.attachment_root / ".preflight-write-probe"
        probe.write_bytes(b"preflight")
        probe.unlink()
        checks["attachmentStorage"] = {
            "status": "ok",
            "path": str(settings.attachment_root),
        }
    except OSError as exc:
        ready = False
        checks["attachmentStorage"] = {"status": "error", "reason": str(exc)}

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
