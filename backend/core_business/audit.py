from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .database import SQLiteService, canonical_json, load_json, page_args, utc_now


class AuditService(SQLiteService):
    SENSITIVE_KEYS = {
        "password",
        "newPassword",
        "token",
        "authorization",
        "passwordHash",
        "tokenHash",
    }

    def __init__(self, database_path: Path):
        super().__init__(database_path)

    def record(
        self,
        action: str,
        resource_type: str,
        *,
        actor_id: str | None = None,
        actor_role: str | None = None,
        resource_id: str | None = None,
        outcome: str = "success",
        metadata: dict[str, Any] | None = None,
        request_id: str | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if outcome not in {"success", "denied", "failed"}:
            raise ValueError(f"Unsupported audit outcome: {outcome}")
        cleaned = self._redact(metadata or {})
        values = (
            request_id,
            actor_id,
            actor_role,
            action,
            resource_type,
            resource_id,
            outcome,
            canonical_json(cleaned),
            utc_now(),
        )
        if connection is not None:
            cursor = connection.execute(
                """
                INSERT INTO audit_events
                (request_id,actor_id,actor_role,action,resource_type,
                 resource_id,outcome,metadata_json,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                values,
            )
            return int(cursor.lastrowid)
        with self.transaction() as db:
            cursor = db.execute(
                """
                INSERT INTO audit_events
                (request_id,actor_id,actor_role,action,resource_type,
                 resource_id,outcome,metadata_json,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                values,
            )
            return int(cursor.lastrowid)

    def query(
        self,
        *,
        actor_id: str | None = None,
        action: str | None = None,
        resource_type: str | None = None,
        outcome: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        limit, offset = page_args(page, page_size)
        clauses: list[str] = []
        values: list[Any] = []
        for column, value in (
            ("actor_id", actor_id),
            ("action", action),
            ("resource_type", resource_type),
            ("outcome", outcome),
        ):
            if value:
                clauses.append(f"{column}=?")
                values.append(value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            total = db.execute(
                f"SELECT count(*) FROM audit_events {where}",
                values,
            ).fetchone()[0]
            rows = db.execute(
                f"""
                SELECT * FROM audit_events
                {where}
                ORDER BY audit_id DESC
                LIMIT ? OFFSET ?
                """,
                [*values, limit, offset],
            ).fetchall()
        return {
            "items": [self._project(row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    @classmethod
    def _redact(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: ("[REDACTED]" if key in cls.SENSITIVE_KEYS else cls._redact(item))
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [cls._redact(item) for item in value]
        return value

    @staticmethod
    def _project(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "auditId": row["audit_id"],
            "requestId": row["request_id"],
            "actorId": row["actor_id"],
            "actorRole": row["actor_role"],
            "action": row["action"],
            "resourceType": row["resource_type"],
            "resourceId": row["resource_id"],
            "outcome": row["outcome"],
            "metadata": load_json(row["metadata_json"], {}),
            "createdAt": row["created_at"],
        }
