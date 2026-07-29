from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from werkzeug.security import check_password_hash, generate_password_hash

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .audit import AuditService
from .database import SQLiteService, canonical_json, load_json, page_args, utc_now


ACCOUNT_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_.-]{2,31}$")
USER_ROLES = {"engineer", "expert", "admin"}
USER_STATUSES = {"active", "disabled", "locked"}


class IdentityService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        audit: AuditService,
        *,
        session_ttl_seconds: int = 28_800,
        max_failures: int = 5,
        lock_seconds: int = 900,
    ):
        super().__init__(database_path)
        self.audit = audit
        self.session_ttl_seconds = session_ttl_seconds
        self.max_failures = max_failures
        self.lock_seconds = lock_seconds

    def create_user(
        self,
        *,
        account: str,
        display_name: str,
        role: str,
        password: str,
        profile: dict[str, Any] | None,
        created_by: str,
        request_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        account = self._validate_account(account)
        display_name = self._required(display_name, "displayName", 80)
        role = self._validate_choice(role, USER_ROLES, "role")
        self._validate_password(password)
        if profile is not None and not isinstance(profile, dict):
            raise PlatformError("validation_error", "profile 必须是对象", 422)
        stamp = utc_now()
        user_id = user_id or f"USR-{uuid.uuid4().hex.upper()}"
        with self.transaction() as db:
            try:
                db.execute(
                    """
                    INSERT INTO platform_users
                    (user_id,account,display_name,role,profile_json,password_hash,
                     status,failed_login_count,token_version,created_at,updated_at)
                    VALUES (?,?,?,?,?,?, 'active',0,1,?,?)
                    """,
                    (
                        user_id,
                        account,
                        display_name,
                        role,
                        canonical_json(profile or {}),
                        generate_password_hash(password),
                        stamp,
                        stamp,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise PlatformError(
                    "account_conflict",
                    "登录账号已经存在",
                    409,
                    {"account": account},
                ) from exc
            self.audit.record(
                "user.created",
                "platform_user",
                actor_id=created_by,
                actor_role="admin",
                resource_id=user_id,
                metadata={"account": account, "role": role},
                request_id=request_id,
                connection=db,
            )
            row = db.execute(
                "SELECT * FROM platform_users WHERE user_id=?",
                (user_id,),
            ).fetchone()
        return self._project_user(row)

    def bootstrap_admin(self, account: str, password: str) -> dict[str, Any]:
        normalized = self._validate_account(account)
        with self.connect() as db:
            existing = db.execute(
                "SELECT * FROM platform_users WHERE account=? COLLATE NOCASE",
                (normalized,),
            ).fetchone()
        if existing:
            return self._project_user(existing)
        return self.create_user(
            account=normalized,
            display_name="平台管理员",
            role="admin",
            password=password,
            profile={"bootstrap": True},
            created_by="system-bootstrap",
            user_id=f"ADM-{uuid.uuid4().hex[:12].upper()}",
        )

    def login(
        self,
        account: str,
        password: str,
        *,
        client_ip: str | None = None,
        user_agent: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        normalized = account.strip().lower()
        now = datetime.now(timezone.utc)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM platform_users WHERE account=? COLLATE NOCASE",
                (normalized,),
            ).fetchone()
            if row is None:
                self.audit.record(
                    "auth.login",
                    "session",
                    outcome="denied",
                    metadata={"account": normalized, "reason": "invalid_credentials"},
                    request_id=request_id,
                    connection=db,
                )
                db.commit()
                raise PlatformError(
                    "invalid_credentials",
                    "账号或密码不正确",
                    401,
                )
            locked_until = self._parse_time(row["locked_until"])
            if row["status"] == "disabled":
                self._audit_login_denied(db, row, "user_disabled", request_id)
                db.commit()
                raise PlatformError("user_disabled", "账号已停用", 403)
            if locked_until and locked_until > now:
                self._audit_login_denied(db, row, "account_locked", request_id)
                db.commit()
                raise PlatformError(
                    "account_locked",
                    "登录失败次数过多，请稍后重试",
                    423,
                    {"lockedUntil": row["locked_until"]},
                )
            if not check_password_hash(row["password_hash"], password):
                failures = int(row["failed_login_count"]) + 1
                new_lock = None
                status = row["status"]
                if failures >= self.max_failures:
                    new_lock = (now + timedelta(seconds=self.lock_seconds)).isoformat()
                    status = "locked"
                db.execute(
                    """
                    UPDATE platform_users
                    SET failed_login_count=?, locked_until=?, status=?, updated_at=?
                    WHERE user_id=?
                    """,
                    (failures, new_lock, status, utc_now(), row["user_id"]),
                )
                self._audit_login_denied(db, row, "invalid_credentials", request_id)
                db.commit()
                raise PlatformError(
                    "invalid_credentials",
                    "账号或密码不正确",
                    401,
                )

            if row["status"] == "locked":
                db.execute(
                    """
                    UPDATE platform_users
                    SET status='active', failed_login_count=0,
                        locked_until=NULL, updated_at=?
                    WHERE user_id=?
                    """,
                    (utc_now(), row["user_id"]),
                )
            else:
                db.execute(
                    """
                    UPDATE platform_users
                    SET failed_login_count=0, locked_until=NULL, updated_at=?
                    WHERE user_id=?
                    """,
                    (utc_now(), row["user_id"]),
                )
            token = secrets.token_urlsafe(48)
            token_hash = self._token_hash(token)
            session_id = f"SES-{uuid.uuid4().hex.upper()}"
            expires = now + timedelta(seconds=self.session_ttl_seconds)
            db.execute(
                """
                INSERT INTO auth_sessions
                (session_id,user_id,token_hash,token_version,created_at,
                 expires_at,last_seen_at,client_ip,user_agent_hash)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    session_id,
                    row["user_id"],
                    token_hash,
                    row["token_version"],
                    now.isoformat(),
                    expires.isoformat(),
                    now.isoformat(),
                    client_ip,
                    hashlib.sha256((user_agent or "").encode("utf-8")).hexdigest()
                    if user_agent
                    else None,
                ),
            )
            self.audit.record(
                "auth.login",
                "session",
                actor_id=row["user_id"],
                actor_role=row["role"],
                resource_id=session_id,
                metadata={"account": row["account"]},
                request_id=request_id,
                connection=db,
            )
            fresh = db.execute(
                "SELECT * FROM platform_users WHERE user_id=?",
                (row["user_id"],),
            ).fetchone()
            db.commit()
        return {
            "accessToken": token,
            "tokenType": "Bearer",
            "expiresAt": expires.isoformat(),
            "sessionId": session_id,
            "user": self._project_user(fresh),
        }

    def authenticate_token(
        self,
        token: str,
        *,
        allowed_roles: Iterable[str] | None = None,
        touch: bool = True,
    ) -> dict[str, Any]:
        if not token:
            raise PlatformError("authentication_required", "需要登录", 401)
        now = datetime.now(timezone.utc)
        with self.transaction() as db:
            row = db.execute(
                """
                SELECT s.*,u.account,u.display_name,u.role,u.profile_json,
                       u.status AS user_status,u.token_version AS current_token_version
                FROM auth_sessions s
                JOIN platform_users u ON u.user_id=s.user_id
                WHERE s.token_hash=?
                """,
                (self._token_hash(token),),
            ).fetchone()
            if row is None or row["revoked_at"] is not None:
                raise PlatformError("session_invalid", "登录会话无效", 401)
            if self._parse_time(row["expires_at"]) <= now:
                raise PlatformError("session_expired", "登录会话已过期", 401)
            if row["user_status"] != "active":
                raise PlatformError("user_disabled", "账号不可用", 403)
            if row["token_version"] != row["current_token_version"]:
                raise PlatformError("session_invalid", "登录会话已失效", 401)
            if allowed_roles is not None and row["role"] not in set(allowed_roles):
                raise PlatformError("role_forbidden", "当前角色无权执行该操作", 403)
            if touch:
                db.execute(
                    "UPDATE auth_sessions SET last_seen_at=? WHERE session_id=?",
                    (now.isoformat(), row["session_id"]),
                )
        return {
            "id": row["user_id"],
            "account": row["account"],
            "displayName": row["display_name"],
            "role": row["role"],
            "profile": load_json(row["profile_json"], {}),
            "sessionId": row["session_id"],
            "expiresAt": row["expires_at"],
        }

    def logout(
        self,
        token: str,
        actor: dict[str, Any],
        *,
        request_id: str | None = None,
    ) -> None:
        with self.transaction() as db:
            db.execute(
                """
                UPDATE auth_sessions
                SET revoked_at=COALESCE(revoked_at, ?)
                WHERE token_hash=?
                """,
                (utc_now(), self._token_hash(token)),
            )
            self.audit.record(
                "auth.logout",
                "session",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=actor["sessionId"],
                request_id=request_id,
                connection=db,
            )

    def list_users(
        self,
        *,
        role: str | None = None,
        status: str | None = None,
        query: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        limit, offset = page_args(page, page_size)
        clauses: list[str] = []
        values: list[Any] = []
        if role:
            clauses.append("role=?")
            values.append(self._validate_choice(role, USER_ROLES, "role"))
        if status:
            clauses.append("status=?")
            values.append(self._validate_choice(status, USER_STATUSES, "status"))
        if query:
            clauses.append("(account LIKE ? OR display_name LIKE ?)")
            needle = f"%{query.strip()}%"
            values.extend((needle, needle))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            total = db.execute(
                f"SELECT count(*) FROM platform_users {where}",
                values,
            ).fetchone()[0]
            rows = db.execute(
                f"""
                SELECT * FROM platform_users {where}
                ORDER BY created_at, user_id
                LIMIT ? OFFSET ?
                """,
                [*values, limit, offset],
            ).fetchall()
        return {
            "items": [self._project_user(row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def update_user(
        self,
        user_id: str,
        changes: dict[str, Any],
        *,
        actor_id: str,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        allowed = {"displayName", "role", "status", "profile"}
        unknown = sorted(set(changes) - allowed)
        if unknown:
            raise PlatformError(
                "validation_error",
                "包含不支持的用户字段",
                422,
                {"fields": unknown},
            )
        assignments: list[str] = []
        values: list[Any] = []
        mapping = {
            "displayName": ("display_name", lambda value: self._required(value, "displayName", 80)),
            "role": ("role", lambda value: self._validate_choice(value, USER_ROLES, "role")),
            "status": ("status", lambda value: self._validate_choice(value, USER_STATUSES, "status")),
            "profile": (
                "profile_json",
                lambda value: canonical_json(value)
                if isinstance(value, dict)
                else self._invalid("profile 必须是对象"),
            ),
        }
        for field, value in changes.items():
            column, validator = mapping[field]
            assignments.append(f"{column}=?")
            values.append(validator(value))
        if not assignments:
            raise PlatformError("validation_error", "没有可更新的用户字段", 422)
        assignments.append("updated_at=?")
        values.extend((utc_now(), user_id))
        with self.transaction() as db:
            current = db.execute(
                "SELECT * FROM platform_users WHERE user_id=?",
                (user_id,),
            ).fetchone()
            if current is None:
                raise PlatformError("user_not_found", "未找到用户", 404)
            db.execute(
                f"UPDATE platform_users SET {','.join(assignments)} WHERE user_id=?",
                values,
            )
            if changes.get("status") in {"disabled", "locked"}:
                db.execute(
                    """
                    UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, ?)
                    WHERE user_id=?
                    """,
                    (utc_now(), user_id),
                )
            self.audit.record(
                "user.updated",
                "platform_user",
                actor_id=actor_id,
                actor_role="admin",
                resource_id=user_id,
                metadata={"fields": sorted(changes)},
                request_id=request_id,
                connection=db,
            )
            row = db.execute(
                "SELECT * FROM platform_users WHERE user_id=?",
                (user_id,),
            ).fetchone()
        return self._project_user(row)

    def reset_password(
        self,
        user_id: str,
        password: str,
        *,
        actor_id: str,
        request_id: str | None = None,
    ) -> None:
        self._validate_password(password)
        with self.transaction() as db:
            exists = db.execute(
                "SELECT role FROM platform_users WHERE user_id=?",
                (user_id,),
            ).fetchone()
            if exists is None:
                raise PlatformError("user_not_found", "未找到用户", 404)
            db.execute(
                """
                UPDATE platform_users
                SET password_hash=?, token_version=token_version+1,
                    failed_login_count=0, locked_until=NULL,
                    status=CASE WHEN status='locked' THEN 'active' ELSE status END,
                    updated_at=?
                WHERE user_id=?
                """,
                (generate_password_hash(password), utc_now(), user_id),
            )
            db.execute(
                """
                UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, ?)
                WHERE user_id=?
                """,
                (utc_now(), user_id),
            )
            self.audit.record(
                "user.password_reset",
                "platform_user",
                actor_id=actor_id,
                actor_role="admin",
                resource_id=user_id,
                request_id=request_id,
                connection=db,
            )

    def _audit_login_denied(
        self,
        db: sqlite3.Connection,
        row: sqlite3.Row,
        reason: str,
        request_id: str | None,
    ) -> None:
        self.audit.record(
            "auth.login",
            "session",
            actor_id=row["user_id"],
            actor_role=row["role"],
            outcome="denied",
            metadata={"account": row["account"], "reason": reason},
            request_id=request_id,
            connection=db,
        )

    @staticmethod
    def _project_user(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["user_id"],
            "account": row["account"],
            "displayName": row["display_name"],
            "role": row["role"],
            "profile": load_json(row["profile_json"], {}),
            "status": row["status"],
            "lockedUntil": row["locked_until"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_time(value: str | None) -> datetime | None:
        return datetime.fromisoformat(value) if value else None

    @staticmethod
    def _validate_account(value: str) -> str:
        normalized = value.strip().lower()
        if not ACCOUNT_PATTERN.fullmatch(normalized):
            raise PlatformError(
                "validation_error",
                "账号需以字母开头，并使用 3 到 32 位字母、数字、点、横线或下划线",
                422,
            )
        return normalized

    @staticmethod
    def _validate_password(value: str) -> None:
        if (
            not isinstance(value, str)
            or len(value) < 10
            or len(value) > 128
            or not re.search(r"[A-Za-z]", value)
            or not re.search(r"\d", value)
        ):
            raise PlatformError(
                "validation_error",
                "密码需为 10 到 128 位并同时包含字母和数字",
                422,
            )

    @staticmethod
    def _validate_choice(value: str, allowed: set[str], field: str) -> str:
        if value not in allowed:
            raise PlatformError(
                "validation_error",
                f"{field} 不受支持",
                422,
                {"allowed": sorted(allowed)},
            )
        return value

    @staticmethod
    def _required(value: Any, field: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        result = value.strip()
        if len(result) > max_length:
            raise PlatformError(
                "validation_error",
                f"{field} 长度不能超过 {max_length}",
                422,
            )
        return result

    @staticmethod
    def _invalid(message: str):
        raise PlatformError("validation_error", message, 422)
