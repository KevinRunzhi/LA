from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def json_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_json(value: str | None, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise PlatformError(
            "stored_data_invalid",
            "数据库中的 JSON 数据无法解析",
            500,
        ) from exc


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def page_args(
    page: int,
    page_size: int,
    *,
    max_page_size: int = 100,
) -> tuple[int, int]:
    if page < 1:
        raise PlatformError("validation_error", "page 必须大于等于 1", 422)
    if page_size < 1 or page_size > max_page_size:
        raise PlatformError(
            "validation_error",
            f"pageSize 必须在 1 到 {max_page_size} 之间",
            422,
        )
    return page_size, (page - 1) * page_size


class SQLiteService:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(
            self.database_path,
            isolation_level=None,
            timeout=15,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
