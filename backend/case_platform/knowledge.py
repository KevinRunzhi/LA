from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from .contracts import CaseRunStatus
from .errors import PlatformError, validation_error
from .migrations import utc_now


class KnowledgeLifecycleService:
    """Atomically publish one approved run as knowledge and graph delta."""

    def __init__(self, database_path: Path):
        self.database_path = database_path

    def publish(
        self,
        run_id: str,
        expected_revision: int,
        idempotency_key: str,
        expert_id: str,
        knowledge_proposal: dict[str, Any],
        graph_proposal: dict[str, Any],
        expert_notes: dict[str, Any],
    ) -> dict[str, Any]:
        if not isinstance(expected_revision, int) or expected_revision < 1:
            raise validation_error(
                "expectedRevision 必须是正整数",
                "expectedRevision",
            )
        try:
            uuid.UUID(idempotency_key)
        except (ValueError, AttributeError) as exc:
            raise validation_error(
                "idempotencyKey 必须是有效 UUID",
                "idempotencyKey",
            ) from exc
        knowledge_id = knowledge_proposal.get("knowledgeId")
        if not isinstance(knowledge_id, str) or not knowledge_id:
            raise validation_error("knowledgeId 不能为空", "knowledgeId")
        if graph_proposal.get("knowledgeId") != knowledge_id:
            raise validation_error("知识与图谱候选的 knowledgeId 不一致")

        request_value = {
            "runId": run_id,
            "expectedRevision": expected_revision,
            "expertId": expert_id,
            "knowledge": knowledge_proposal,
            "graph": graph_proposal,
            "notes": expert_notes,
        }
        request_hash = self._hash(request_value)
        endpoint = "knowledge:publish"
        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            connection.execute("BEGIN IMMEDIATE")
            replay = connection.execute(
                """
                SELECT request_hash,response_json FROM case_run_idempotency
                WHERE endpoint=? AND idempotency_key=?
                """,
                (endpoint, idempotency_key),
            ).fetchone()
            if replay is not None:
                if replay["request_hash"] != request_hash:
                    raise PlatformError(
                        "idempotency_conflict",
                        "同一幂等键不能用于不同发布请求",
                        409,
                    )
                connection.commit()
                return json.loads(replay["response_json"])

            run = connection.execute(
                "SELECT * FROM case_runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise PlatformError("run_not_found", "未找到检修运行", 404)
            if run["status"] != CaseRunStatus.APPROVED:
                raise PlatformError(
                    "state_conflict",
                    "只有已批准的运行可以发布知识",
                    409,
                    {"currentStatus": run["status"]},
                )
            if int(run["revision"]) != expected_revision:
                raise PlatformError(
                    "state_conflict",
                    "运行版本已变化，请刷新后重试",
                    409,
                    {"currentRevision": int(run["revision"])},
                )

            verification_level = knowledge_proposal.get(
                "verificationLevel",
                "synthetic_demo",
            )
            if verification_level == "verified_case" and not expert_notes.get(
                "fieldEvidenceIds"
            ):
                raise PlatformError(
                    "verification_evidence_required",
                    "升级为真实核验案例必须绑定现场证据",
                    422,
                )
            version = self._next_version(connection, knowledge_id)
            stamp = utc_now()
            knowledge_hash = self._hash(knowledge_proposal)
            graph_delta_id = f"DELTA-{uuid.uuid4().hex.upper()}"
            connection.execute(
                """
                INSERT INTO case_knowledge_versions
                (knowledge_id,version,run_id,case_id,verification_level,
                 content_hash,payload,published_by,published_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    knowledge_id,
                    version,
                    run_id,
                    run["case_id"],
                    verification_level,
                    knowledge_hash,
                    self._dump(knowledge_proposal),
                    expert_id,
                    stamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO case_graph_version_deltas
                (delta_id,run_id,case_id,knowledge_id,knowledge_version,
                 verification_level,payload,published_at)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    graph_delta_id,
                    run_id,
                    run["case_id"],
                    knowledge_id,
                    version,
                    verification_level,
                    self._dump(graph_proposal),
                    stamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO engineer_case_sync
                (engineer_id,knowledge_id,local_version,latest_version,status,synced_at)
                VALUES (?, ?, NULL, ?, 'update_available', NULL)
                ON CONFLICT(engineer_id,knowledge_id) DO UPDATE SET
                    latest_version=excluded.latest_version,
                    status=CASE
                        WHEN engineer_case_sync.local_version=excluded.latest_version
                        THEN 'current'
                        ELSE 'update_available'
                    END
                """,
                (run["created_by"], knowledge_id, version),
            )
            next_revision = expected_revision + 1
            payload = json.loads(run["payload"])
            payload.setdefault("snapshots", {})["knowledgePublication"] = {
                "knowledgeId": knowledge_id,
                "version": version,
                "knowledgeHash": knowledge_hash,
                "graphDeltaId": graph_delta_id,
                "verificationLevel": verification_level,
                "publishedAt": stamp,
            }
            connection.execute(
                """
                UPDATE case_runs
                SET status=?,revision=?,payload=?,updated_at=?
                WHERE run_id=?
                """,
                (
                    CaseRunStatus.PUBLISHED,
                    next_revision,
                    self._dump(payload),
                    stamp,
                    run_id,
                ),
            )
            connection.execute(
                """
                INSERT INTO case_run_events
                (run_id,event_type,from_status,to_status,revision,actor_role,
                 actor_id,payload,created_at)
                VALUES (?,?,?,?,?,'expert',?,?,?)
                """,
                (
                    run_id,
                    "knowledge_published",
                    CaseRunStatus.APPROVED,
                    CaseRunStatus.PUBLISHED,
                    next_revision,
                    expert_id,
                    self._dump(
                        {
                            "knowledgeId": knowledge_id,
                            "version": version,
                            "graphDeltaId": graph_delta_id,
                        }
                    ),
                    stamp,
                ),
            )
            response = {
                "runId": run_id,
                "caseId": run["case_id"],
                "revision": next_revision,
                "status": CaseRunStatus.PUBLISHED,
                "knowledgeId": knowledge_id,
                "version": version,
                "verificationLevel": verification_level,
                "contentHash": knowledge_hash,
                "graphDeltaId": graph_delta_id,
                "publishedAt": stamp,
            }
            connection.execute(
                """
                INSERT INTO case_run_idempotency
                (endpoint,idempotency_key,run_id,request_hash,response_json,created_at)
                VALUES (?,?,?,?,?,?)
                """,
                (
                    endpoint,
                    idempotency_key,
                    run_id,
                    request_hash,
                    self._dump(response),
                    stamp,
                ),
            )
            connection.commit()
            return response
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def sync_latest(self, engineer_id: str, knowledge_id: str) -> dict[str, Any]:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        try:
            row = connection.execute(
                """
                SELECT * FROM engineer_case_sync
                WHERE engineer_id=? AND knowledge_id=?
                """,
                (engineer_id, knowledge_id),
            ).fetchone()
            if row is None:
                raise PlatformError(
                    "knowledge_sync_not_found",
                    "没有可同步的知识版本",
                    404,
                )
            stamp = utc_now()
            connection.execute(
                """
                UPDATE engineer_case_sync
                SET local_version=latest_version,status='current',synced_at=?
                WHERE engineer_id=? AND knowledge_id=?
                """,
                (stamp, engineer_id, knowledge_id),
            )
            connection.commit()
            return {
                "engineerId": engineer_id,
                "knowledgeId": knowledge_id,
                "localVersion": row["latest_version"],
                "latestVersion": row["latest_version"],
                "status": "current",
                "syncedAt": stamp,
            }
        finally:
            connection.close()

    @staticmethod
    def _next_version(connection: sqlite3.Connection, knowledge_id: str) -> str:
        versions = [
            row[0]
            for row in connection.execute(
                """
                SELECT version FROM case_knowledge_versions
                WHERE knowledge_id=?
                """,
                (knowledge_id,),
            )
        ]
        if not versions:
            return "1.1"
        parsed = []
        for version in versions:
            try:
                major, minor = (int(part) for part in version.split(".", 1))
            except (TypeError, ValueError) as exc:
                raise PlatformError(
                    "knowledge_version_invalid",
                    "已有知识版本格式无效",
                    500,
                ) from exc
            parsed.append((major, minor))
        major, minor = max(parsed)
        return f"{major}.{minor + 1}"

    @staticmethod
    def _hash(value: Any) -> str:
        return hashlib.sha256(
            KnowledgeLifecycleService._dump(value).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
