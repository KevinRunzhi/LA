from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .errors import PlatformError


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    statements: tuple[str, ...]

    @property
    def checksum(self) -> str:
        content = "\n".join(self.statements).encode("utf-8")
        return hashlib.sha256(content).hexdigest()


CASE_PLATFORM_MIGRATION = Migration(
    version="001",
    name="case platform foundation",
    statements=(
        """
        CREATE TABLE IF NOT EXISTS case_runs (
            run_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            package_version TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision >= 1),
            payload TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            revision INTEGER NOT NULL,
            actor_role TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_idempotency (
            endpoint TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            run_id TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(endpoint, idempotency_key),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_attachments (
            attachment_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            storage_key TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            metadata TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS engineer_submission_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL UNIQUE,
            case_id TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS job_card_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id, revision),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS expert_review_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            reviewer_id TEXT NOT NULL,
            decision TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id, revision),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_knowledge_versions (
            knowledge_id TEXT NOT NULL,
            version TEXT NOT NULL,
            run_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            published_by TEXT NOT NULL,
            published_at TEXT NOT NULL,
            PRIMARY KEY(knowledge_id, version),
            UNIQUE(run_id, knowledge_id),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_graph_version_deltas (
            delta_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            knowledge_version TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            payload TEXT NOT NULL,
            published_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT,
            FOREIGN KEY(knowledge_id, knowledge_version)
                REFERENCES case_knowledge_versions(knowledge_id, version)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS engineer_case_sync (
            engineer_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            local_version TEXT,
            latest_version TEXT NOT NULL,
            status TEXT NOT NULL,
            synced_at TEXT,
            PRIMARY KEY(engineer_id, knowledge_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_case_runs_case_status ON case_runs(case_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_case_run_events_run ON case_run_events(run_id, event_id)",
        "CREATE INDEX IF NOT EXISTS idx_case_run_attachments_run ON case_run_attachments(run_id)",
        "CREATE INDEX IF NOT EXISTS idx_case_graph_delta_version ON case_graph_version_deltas(knowledge_id, knowledge_version)",
    ),
)


DEFAULT_MIGRATIONS = (CASE_PLATFORM_MIGRATION,)


class MigrationRunner:
    def __init__(
        self,
        database_path: Path,
        backup_dir: Path | None = None,
        migrations: Iterable[Migration] = DEFAULT_MIGRATIONS,
    ):
        self.database_path = database_path
        self.backup_dir = backup_dir or database_path.parent / "backups"
        self.migrations = tuple(migrations)

    def migrate(self) -> list[str]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        existed = self.database_path.exists() and self.database_path.stat().st_size > 0
        pending = self._pending_migrations() if existed else self.migrations
        if not pending:
            return []
        if existed:
            self._backup()

        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        applied_now: list[str] = []
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL,
                    validation_result TEXT NOT NULL
                )
                """
            )
            applied = {
                row["version"]: row["checksum"]
                for row in connection.execute(
                    "SELECT version, checksum FROM schema_migrations"
                )
            }
            for migration in pending:
                if migration.version in applied:
                    if applied[migration.version] != migration.checksum:
                        raise PlatformError(
                            "migration_checksum_mismatch",
                            "已执行迁移的内容校验失败",
                            500,
                            {"version": migration.version},
                        )
                    continue
                for statement in migration.statements:
                    connection.execute(statement)
                self._validate(connection)
                connection.execute(
                    """
                    INSERT INTO schema_migrations
                    (version, name, checksum, applied_at, validation_result)
                    VALUES (?, ?, ?, ?, 'passed')
                    """,
                    (
                        migration.version,
                        migration.name,
                        migration.checksum,
                        utc_now(),
                    ),
                )
                applied_now.append(migration.version)
            connection.commit()
            return applied_now
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _pending_migrations(self) -> tuple[Migration, ...]:
        with sqlite3.connect(self.database_path) as connection:
            table = connection.execute(
                """
                SELECT 1 FROM sqlite_master
                WHERE type='table' AND name='schema_migrations'
                """
            ).fetchone()
            if table is None:
                return self.migrations
            applied = {
                row[0]: row[1]
                for row in connection.execute(
                    "SELECT version, checksum FROM schema_migrations"
                )
            }
        pending = []
        for migration in self.migrations:
            checksum = applied.get(migration.version)
            if checksum is None:
                pending.append(migration)
            elif checksum != migration.checksum:
                raise PlatformError(
                    "migration_checksum_mismatch",
                    "已执行迁移的内容校验失败",
                    500,
                    {"version": migration.version},
                )
        return tuple(pending)

    def _backup(self) -> Path:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = self.backup_dir / f"{self.database_path.stem}-{stamp}.db"
        source = sqlite3.connect(self.database_path)
        target = sqlite3.connect(backup_path)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        return backup_path

    @staticmethod
    def _validate(connection: sqlite3.Connection):
        required = {
            "case_runs",
            "case_run_events",
            "case_run_idempotency",
            "case_run_attachments",
            "engineer_submission_snapshots",
            "job_card_snapshots",
            "expert_review_snapshots",
            "case_knowledge_versions",
            "case_graph_version_deltas",
            "engineer_case_sync",
        }
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        missing = sorted(required - tables)
        if missing:
            raise PlatformError(
                "migration_validation_failed",
                "数据库迁移缺少必需表",
                500,
                {"tables": missing},
            )
        foreign_key_errors = list(connection.execute("PRAGMA foreign_key_check"))
        if foreign_key_errors:
            raise PlatformError(
                "migration_validation_failed",
                "数据库外键校验失败",
                500,
            )
