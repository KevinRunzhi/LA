from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

try:
    from ..case_package import LoadedCasePackage
except ImportError:
    from case_package import LoadedCasePackage

from .contracts import (
    ALLOWED_TRANSITIONS,
    CaseRunStatus,
    CaseRunView,
    UserRole,
)
from .errors import PlatformError, validation_error
from .migrations import utc_now


MAX_PAYLOAD_BYTES = 1_000_000


class CaseRunStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            connection.close()

    def create_run(
        self,
        package: LoadedCasePackage,
        created_by: str,
        idempotency_key: str,
        initial_input: dict[str, Any],
    ) -> CaseRunView:
        self._validate_idempotency_key(idempotency_key)
        self._validate_payload(initial_input)
        endpoint = "case-runs:create"
        request_hash = self._hash_json(
            {
                "caseId": package.case_id,
                "createdBy": created_by,
                "input": initial_input,
            }
        )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                replay = self._idempotent_replay(
                    db,
                    endpoint,
                    idempotency_key,
                    request_hash,
                )
                if replay is not None:
                    db.commit()
                    return self._view_from_dict(replay)

                stamp = utc_now()
                run_id = f"RUN-{uuid.uuid4().hex.upper()}"
                payload = {
                    "initialInput": initial_input,
                    "intakeFacts": {},
                    "resolvedPlanSnapshot": None,
                    "stepExecution": {},
                    "snapshots": {},
                }
                db.execute(
                    """
                    INSERT INTO case_runs
                    (run_id, case_id, package_version, package_hash, status,
                     revision, payload, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        package.case_id,
                        package.package_version,
                        package.package_hash,
                        CaseRunStatus.CREATED,
                        self._dump(payload),
                        created_by,
                        stamp,
                        stamp,
                    ),
                )
                self._append_event(
                    db,
                    run_id,
                    "run_created",
                    None,
                    CaseRunStatus.CREATED,
                    1,
                    UserRole.ENGINEER,
                    created_by,
                    {"packageHash": package.package_hash},
                )
                view = self._get_in_transaction(db, run_id)
                self._store_idempotency(
                    db,
                    endpoint,
                    idempotency_key,
                    run_id,
                    request_hash,
                    view.to_dict(),
                )
                db.commit()
                return view
            except Exception:
                db.rollback()
                raise

    def get(self, run_id: str) -> CaseRunView:
        with self.connect() as db:
            return self._get_in_transaction(db, run_id)

    def transition(
        self,
        run_id: str,
        target_status: CaseRunStatus,
        role: UserRole,
        actor_id: str,
        expected_revision: int,
        idempotency_key: str,
        event_type: str,
        request_payload: dict[str, Any],
        payload_update: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
        transaction_effect: Callable[[sqlite3.Connection, CaseRunView], None] | None = None,
    ) -> CaseRunView:
        self._validate_write_contract(expected_revision, idempotency_key)
        self._validate_payload(request_payload)
        endpoint = f"case-runs:{event_type}"
        request_hash = self._hash_json(
            {
                "runId": run_id,
                "targetStatus": target_status,
                "role": role,
                "expectedRevision": expected_revision,
                "payload": request_payload,
            }
        )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                replay = self._idempotent_replay(
                    db,
                    endpoint,
                    idempotency_key,
                    request_hash,
                )
                if replay is not None:
                    db.commit()
                    return self._view_from_dict(replay)

                current = self._get_in_transaction(db, run_id)
                if current.revision != expected_revision:
                    raise PlatformError(
                        "state_conflict",
                        "运行版本已变化，请刷新后重试",
                        409,
                        {
                            "runId": run_id,
                            "expectedRevision": expected_revision,
                            "currentRevision": current.revision,
                            "currentStatus": current.status,
                        },
                    )
                roles = ALLOWED_TRANSITIONS.get(current.status, {}).get(target_status)
                if not roles:
                    raise PlatformError(
                        "state_conflict",
                        "当前状态不允许执行该操作",
                        409,
                        {
                            "runId": run_id,
                            "currentStatus": current.status,
                            "targetStatus": target_status,
                        },
                    )
                if role not in roles:
                    raise PlatformError(
                        "role_forbidden",
                        "当前角色无权执行该状态转换",
                        403,
                    )

                payload = json.loads(json.dumps(current.payload, ensure_ascii=False))
                if payload_update is not None:
                    payload = payload_update(payload)
                self._validate_payload(payload)
                next_revision = current.revision + 1
                stamp = utc_now()
                db.execute(
                    """
                    UPDATE case_runs
                    SET status=?, revision=?, payload=?, updated_at=?
                    WHERE run_id=?
                    """,
                    (
                        target_status,
                        next_revision,
                        self._dump(payload),
                        stamp,
                        run_id,
                    ),
                )
                self._append_event(
                    db,
                    run_id,
                    event_type,
                    current.status,
                    target_status,
                    next_revision,
                    role,
                    actor_id,
                    request_payload,
                )
                view = self._get_in_transaction(db, run_id)
                if transaction_effect is not None:
                    transaction_effect(db, view)
                self._store_idempotency(
                    db,
                    endpoint,
                    idempotency_key,
                    run_id,
                    request_hash,
                    view.to_dict(),
                )
                db.commit()
                return view
            except Exception:
                db.rollback()
                raise

    def update_in_progress(
        self,
        run_id: str,
        role: UserRole,
        actor_id: str,
        expected_revision: int,
        idempotency_key: str,
        event_type: str,
        request_payload: dict[str, Any],
        payload_update: Callable[[dict[str, Any]], dict[str, Any]],
        transaction_effect: Callable[[sqlite3.Connection, CaseRunView], None] | None = None,
    ) -> CaseRunView:
        self._validate_write_contract(expected_revision, idempotency_key)
        self._validate_payload(request_payload)
        endpoint = f"case-runs:{event_type}"
        request_hash = self._hash_json(
            {
                "runId": run_id,
                "role": role,
                "expectedRevision": expected_revision,
                "payload": request_payload,
            }
        )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                replay = self._idempotent_replay(
                    db,
                    endpoint,
                    idempotency_key,
                    request_hash,
                )
                if replay is not None:
                    db.commit()
                    return self._view_from_dict(replay)
                current = self._get_in_transaction(db, run_id)
                if current.status != CaseRunStatus.IN_PROGRESS:
                    raise PlatformError(
                        "state_conflict",
                        "只有检修执行中的运行可以写入步骤结果",
                        409,
                        {"currentStatus": current.status},
                    )
                if role != UserRole.ENGINEER:
                    raise PlatformError("role_forbidden", "只有工程师可以记录检修执行", 403)
                if current.revision != expected_revision:
                    raise PlatformError(
                        "state_conflict",
                        "运行版本已变化，请刷新后重试",
                        409,
                        {"currentRevision": current.revision},
                    )
                payload = payload_update(
                    json.loads(json.dumps(current.payload, ensure_ascii=False))
                )
                self._validate_payload(payload)
                revision = current.revision + 1
                db.execute(
                    "UPDATE case_runs SET revision=?, payload=?, updated_at=? WHERE run_id=?",
                    (revision, self._dump(payload), utc_now(), run_id),
                )
                self._append_event(
                    db,
                    run_id,
                    event_type,
                    current.status,
                    current.status,
                    revision,
                    role,
                    actor_id,
                    request_payload,
                )
                view = self._get_in_transaction(db, run_id)
                if transaction_effect is not None:
                    transaction_effect(db, view)
                self._store_idempotency(
                    db,
                    endpoint,
                    idempotency_key,
                    run_id,
                    request_hash,
                    view.to_dict(),
                )
                db.commit()
                return view
            except Exception:
                db.rollback()
                raise

    def reset_run(
        self,
        run_id: str,
        actor_id: str,
        expected_revision: int,
        idempotency_key: str,
    ) -> CaseRunView:
        current = self.get(run_id)
        if current.status in {CaseRunStatus.PUBLISHED, CaseRunStatus.SYNCED}:
            raise PlatformError(
                "state_conflict",
                "已发布运行不可重置，请创建新的运行",
                409,
            )

        def reset_payload(payload: dict[str, Any]) -> dict[str, Any]:
            return {
                "initialInput": payload.get("initialInput", {}),
                "intakeFacts": {},
                "resolvedPlanSnapshot": None,
                "stepExecution": {},
                "snapshots": {},
            }

        return self._force_reset(
            run_id,
            actor_id,
            expected_revision,
            idempotency_key,
            reset_payload,
        )

    def events(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            self._get_in_transaction(db, run_id)
            rows = db.execute(
                """
                SELECT event_id,event_type,from_status,to_status,revision,
                       actor_role,actor_id,payload,created_at
                FROM case_run_events WHERE run_id=? ORDER BY event_id
                """,
                (run_id,),
            ).fetchall()
        return [
            {
                **dict(row),
                "payload": json.loads(row["payload"]),
            }
            for row in rows
        ]

    def register_attachment(
        self,
        run_id: str,
        actor_id: str,
        media_type: str,
        storage: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        self._validate_payload(metadata)
        storage_key = storage.get("storageKey")
        sha256 = storage.get("sha256")
        if not isinstance(storage_key, str) or not storage_key:
            raise validation_error("附件存储信息缺少 storageKey", "storageKey")
        if not isinstance(sha256, str) or len(sha256) != 64:
            raise validation_error("附件存储信息缺少有效 sha256", "sha256")
        attachment_id = f"ATT-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                run = self._get_in_transaction(db, run_id)
                if run.status in {CaseRunStatus.PUBLISHED, CaseRunStatus.SYNCED}:
                    raise PlatformError(
                        "state_conflict",
                        "已发布运行不可继续追加附件",
                        409,
                        {"currentStatus": run.status},
                    )
                db.execute(
                    """
                    INSERT INTO case_run_attachments
                    (attachment_id,run_id,media_type,storage_key,sha256,
                     metadata,created_at)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        attachment_id,
                        run_id,
                        media_type,
                        storage_key,
                        sha256,
                        self._dump(metadata),
                        stamp,
                    ),
                )
                self._append_event(
                    db,
                    run_id,
                    "attachment_added",
                    run.status,
                    run.status,
                    run.revision,
                    UserRole.ENGINEER,
                    actor_id,
                    {
                        "attachmentId": attachment_id,
                        "mediaType": media_type,
                        "sha256": sha256,
                    },
                )
                db.commit()
            except Exception:
                db.rollback()
                raise
        return {
            "attachmentId": attachment_id,
            "runId": run_id,
            "mediaType": media_type,
            "storageKey": storage_key,
            "sha256": sha256,
            "size": storage.get("size"),
            "metadata": metadata,
            "createdAt": stamp,
        }

    def attachments(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            self._get_in_transaction(db, run_id)
            rows = db.execute(
                """
                SELECT attachment_id,run_id,media_type,storage_key,sha256,
                       metadata,created_at
                FROM case_run_attachments
                WHERE run_id=?
                ORDER BY created_at,attachment_id
                """,
                (run_id,),
            ).fetchall()
        return [
            {
                "attachmentId": row["attachment_id"],
                "runId": row["run_id"],
                "mediaType": row["media_type"],
                "storageKey": row["storage_key"],
                "sha256": row["sha256"],
                "metadata": json.loads(row["metadata"]),
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

    def snapshot_effect(
        self,
        snapshot_type: str,
        payload: dict[str, Any],
        *,
        reviewer_id: str | None = None,
        decision: str | None = None,
        verification_level: str | None = None,
    ) -> Callable[[sqlite3.Connection, CaseRunView], None]:
        self._validate_payload(payload)
        supported = {"job_card", "engineer_submission", "expert_review"}
        if snapshot_type not in supported:
            raise ValueError(f"unsupported snapshot type: {snapshot_type}")

        def write(db: sqlite3.Connection, run: CaseRunView):
            stamp = utc_now()
            content_hash = self._hash_json(payload)
            snapshot_id = f"SNAP-{uuid.uuid4().hex.upper()}"
            if snapshot_type == "job_card":
                db.execute(
                    """
                    INSERT INTO job_card_snapshots
                    (snapshot_id,run_id,revision,content_hash,payload,created_at)
                    VALUES (?,?,?,?,?,?)
                    """,
                    (
                        snapshot_id,
                        run.run_id,
                        run.revision,
                        content_hash,
                        self._dump(payload),
                        stamp,
                    ),
                )
                return
            if snapshot_type == "engineer_submission":
                db.execute(
                    """
                    INSERT INTO engineer_submission_snapshots
                    (snapshot_id,run_id,revision,case_id,package_hash,
                     content_hash,payload,created_at)
                    VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        snapshot_id,
                        run.run_id,
                        run.revision,
                        run.case_id,
                        run.package_hash,
                        content_hash,
                        self._dump(payload),
                        stamp,
                    ),
                )
                return
            if not reviewer_id or not decision or not verification_level:
                raise ValueError("expert review snapshot metadata is incomplete")
            db.execute(
                """
                INSERT INTO expert_review_snapshots
                (snapshot_id,run_id,revision,reviewer_id,decision,
                 verification_level,content_hash,payload,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    snapshot_id,
                    run.run_id,
                    run.revision,
                    reviewer_id,
                    decision,
                    verification_level,
                    content_hash,
                    self._dump(payload),
                    stamp,
                ),
            )

        return write

    def _force_reset(
        self,
        run_id: str,
        actor_id: str,
        expected_revision: int,
        idempotency_key: str,
        payload_update: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> CaseRunView:
        self._validate_write_contract(expected_revision, idempotency_key)
        endpoint = "case-runs:reset"
        request_payload = {"runId": run_id, "expectedRevision": expected_revision}
        request_hash = self._hash_json(request_payload)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                replay = self._idempotent_replay(
                    db,
                    endpoint,
                    idempotency_key,
                    request_hash,
                )
                if replay is not None:
                    db.commit()
                    return self._view_from_dict(replay)
                current = self._get_in_transaction(db, run_id)
                if current.revision != expected_revision:
                    raise PlatformError(
                        "state_conflict",
                        "运行版本已变化，请刷新后重试",
                        409,
                        {"currentRevision": current.revision},
                    )
                if current.status in {CaseRunStatus.PUBLISHED, CaseRunStatus.SYNCED}:
                    raise PlatformError(
                        "state_conflict",
                        "已发布运行不可重置，请创建新的运行",
                        409,
                    )
                payload = payload_update(current.payload)
                revision = current.revision + 1
                db.execute(
                    """
                    UPDATE case_runs
                    SET status=?, revision=?, payload=?, updated_at=?
                    WHERE run_id=?
                    """,
                    (
                        CaseRunStatus.CREATED,
                        revision,
                        self._dump(payload),
                        utc_now(),
                        run_id,
                    ),
                )
                self._append_event(
                    db,
                    run_id,
                    "run_reset",
                    current.status,
                    CaseRunStatus.CREATED,
                    revision,
                    UserRole.ENGINEER,
                    actor_id,
                    request_payload,
                )
                view = self._get_in_transaction(db, run_id)
                self._store_idempotency(
                    db,
                    endpoint,
                    idempotency_key,
                    run_id,
                    request_hash,
                    view.to_dict(),
                )
                db.commit()
                return view
            except Exception:
                db.rollback()
                raise

    def _get_in_transaction(
        self,
        db: sqlite3.Connection,
        run_id: str,
    ) -> CaseRunView:
        row = db.execute(
            "SELECT * FROM case_runs WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise PlatformError("run_not_found", "未找到检修运行", 404)
        return self._view_from_row(row)

    @staticmethod
    def _view_from_row(row: sqlite3.Row) -> CaseRunView:
        return CaseRunView(
            run_id=row["run_id"],
            case_id=row["case_id"],
            package_version=row["package_version"],
            package_hash=row["package_hash"],
            status=CaseRunStatus(row["status"]),
            revision=int(row["revision"]),
            payload=json.loads(row["payload"]),
            created_by=row["created_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _view_from_dict(value: dict[str, Any]) -> CaseRunView:
        return CaseRunView(
            run_id=value["runId"],
            case_id=value["caseId"],
            package_version=value["packageVersion"],
            package_hash=value["packageHash"],
            status=CaseRunStatus(value["status"]),
            revision=int(value["revision"]),
            payload=value["payload"],
            created_by=value["createdBy"],
            created_at=value["createdAt"],
            updated_at=value["updatedAt"],
        )

    @staticmethod
    def _append_event(
        db: sqlite3.Connection,
        run_id: str,
        event_type: str,
        from_status: CaseRunStatus | None,
        to_status: CaseRunStatus,
        revision: int,
        role: UserRole,
        actor_id: str,
        payload: dict[str, Any],
    ):
        db.execute(
            """
            INSERT INTO case_run_events
            (run_id,event_type,from_status,to_status,revision,actor_role,
             actor_id,payload,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id,
                event_type,
                from_status,
                to_status,
                revision,
                role,
                actor_id,
                CaseRunStore._dump(payload),
                utc_now(),
            ),
        )

    @staticmethod
    def _idempotent_replay(
        db: sqlite3.Connection,
        endpoint: str,
        key: str,
        request_hash: str,
    ) -> dict[str, Any] | None:
        row = db.execute(
            """
            SELECT request_hash,response_json FROM case_run_idempotency
            WHERE endpoint=? AND idempotency_key=?
            """,
            (endpoint, key),
        ).fetchone()
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise PlatformError(
                "idempotency_conflict",
                "同一幂等键不能用于不同请求",
                409,
            )
        return json.loads(row["response_json"])

    @staticmethod
    def _store_idempotency(
        db: sqlite3.Connection,
        endpoint: str,
        key: str,
        run_id: str,
        request_hash: str,
        response: dict[str, Any],
    ):
        db.execute(
            """
            INSERT INTO case_run_idempotency
            (endpoint,idempotency_key,run_id,request_hash,response_json,created_at)
            VALUES (?,?,?,?,?,?)
            """,
            (
                endpoint,
                key,
                run_id,
                request_hash,
                CaseRunStore._dump(response),
                utc_now(),
            ),
        )

    @staticmethod
    def _validate_write_contract(expected_revision: int, idempotency_key: str):
        if not isinstance(expected_revision, int) or expected_revision < 1:
            raise validation_error("expectedRevision 必须是正整数", "expectedRevision")
        CaseRunStore._validate_idempotency_key(idempotency_key)

    @staticmethod
    def _validate_idempotency_key(value: str):
        if not isinstance(value, str):
            raise validation_error("idempotencyKey 必须是 UUID", "idempotencyKey")
        try:
            uuid.UUID(value)
        except (ValueError, AttributeError) as exc:
            raise validation_error(
                "idempotencyKey 必须是有效 UUID",
                "idempotencyKey",
            ) from exc

    @staticmethod
    def _validate_payload(value: dict[str, Any]):
        try:
            encoded = CaseRunStore._dump(value).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise validation_error("请求内容必须可以序列化为 JSON") from exc
        if len(encoded) > MAX_PAYLOAD_BYTES:
            raise validation_error("运行数据超过允许大小")

    @staticmethod
    def _hash_json(value: Any) -> str:
        return hashlib.sha256(CaseRunStore._dump(value).encode("utf-8")).hexdigest()

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
