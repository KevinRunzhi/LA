from __future__ import annotations

import copy
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .audit import AuditService
from .database import SQLiteService, canonical_json, json_hash, load_json, utc_now


ENTITY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$")


class GovernedGraphService(SQLiteService):
    def __init__(self, database_path: Path, audit: AuditService):
        super().__init__(database_path)
        self.audit = audit

    def initialize_seed(
        self,
        seed: dict[str, Any],
        *,
        published_by: str = "system-seed",
    ) -> dict[str, Any]:
        with self.transaction() as db:
            row = db.execute(
                "SELECT * FROM graph_versions ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
            if row:
                return self._project_version(row, include_snapshot=True)
            snapshot = self._normalize_seed(seed)
            self._validate_snapshot(snapshot)
            stamp = utc_now()
            version_id = "GRAPH-V0001"
            db.execute(
                """
                INSERT INTO graph_versions
                (version_id,sequence,parent_version_id,change_set_id,snapshot_json,
                 content_sha256,published_by,published_at)
                VALUES (?,1,NULL,NULL,?,?,?,?)
                """,
                (
                    version_id,
                    canonical_json(snapshot),
                    json_hash(snapshot),
                    published_by,
                    stamp,
                ),
            )
            row = db.execute(
                "SELECT * FROM graph_versions WHERE version_id=?",
                (version_id,),
            ).fetchone()
        return self._project_version(row, include_snapshot=True)

    def current_graph(self) -> dict[str, Any]:
        version = self._get_version(None)
        return {
            "versionId": version["versionId"],
            "sequence": version["sequence"],
            "sha256": version["sha256"],
            **version["snapshot"],
        }

    def versions(self, limit: int = 50) -> list[dict[str, Any]]:
        if limit < 1 or limit > 200:
            raise PlatformError("validation_error", "limit 必须在 1 到 200 之间", 422)
        with self.connect() as db:
            rows = db.execute(
                """
                SELECT * FROM graph_versions
                ORDER BY sequence DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._project_version(row) for row in rows]

    def get_version(self, version_id: str) -> dict[str, Any]:
        return self._get_version(version_id)

    def create_change_set(
        self,
        title: str,
        description: str,
        *,
        actor: dict[str, Any],
        case_run_id: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        title = self._required(title, "title", 160)
        if not isinstance(description, str) or len(description) > 2000:
            raise PlatformError("validation_error", "description 无效", 422)
        change_set_id = f"GCS-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        with self.transaction() as db:
            base = db.execute(
                "SELECT version_id FROM graph_versions ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
            if base is None:
                raise PlatformError("graph_not_initialized", "知识图谱尚未初始化", 409)
            if case_run_id:
                exists = db.execute(
                    "SELECT 1 FROM case_runs WHERE run_id=?",
                    (case_run_id,),
                ).fetchone()
                if exists is None:
                    raise PlatformError("case_run_not_found", "未找到案例运行", 404)
            db.execute(
                """
                INSERT INTO graph_change_sets
                (change_set_id,title,description,status,base_version_id,
                 case_run_id,created_by,created_at,updated_at)
                VALUES (?,?,?,'draft',?,?,?,?,?)
                """,
                (
                    change_set_id,
                    title,
                    description.strip(),
                    base["version_id"],
                    case_run_id,
                    actor["id"],
                    stamp,
                    stamp,
                ),
            )
            self.audit.record(
                "graph.change_set_created",
                "graph_change_set",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=change_set_id,
                metadata={"baseVersionId": base["version_id"], "caseRunId": case_run_id},
                request_id=request_id,
                connection=db,
            )
        return self.get_change_set(change_set_id)

    def upsert_change_item(
        self,
        change_set_id: str,
        operation: str,
        entity_type: str,
        entity_id: str,
        payload: dict[str, Any] | None,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        if operation not in {"upsert", "delete"}:
            raise PlatformError("validation_error", "operation 不受支持", 422)
        if entity_type not in {"node", "edge"}:
            raise PlatformError("validation_error", "entityType 不受支持", 422)
        self._validate_id(entity_id, "entityId")
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise PlatformError("validation_error", "payload 必须是对象", 422)
        if operation == "upsert":
            self._validate_entity(entity_type, entity_id, payload)
        item_id = f"GCI-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        with self.transaction() as db:
            change_set = self._change_set_row(db, change_set_id)
            if change_set["created_by"] != actor["id"] and actor["role"] != "admin":
                raise PlatformError("role_forbidden", "只有创建者可以编辑变更集", 403)
            if change_set["status"] not in {"draft", "rejected"}:
                raise PlatformError(
                    "graph_state_conflict",
                    "当前状态不允许编辑图谱变更",
                    409,
                    {"status": change_set["status"]},
                )
            existing = db.execute(
                """
                SELECT item_id FROM graph_change_items
                WHERE change_set_id=? AND entity_type=? AND entity_id=?
                """,
                (change_set_id, entity_type, entity_id),
            ).fetchone()
            if existing:
                item_id = existing["item_id"]
                db.execute(
                    """
                    UPDATE graph_change_items
                    SET operation=?,payload_json=?,created_at=?
                    WHERE item_id=?
                    """,
                    (operation, canonical_json(payload), stamp, item_id),
                )
            else:
                db.execute(
                    """
                    INSERT INTO graph_change_items
                    (item_id,change_set_id,operation,entity_type,entity_id,
                     payload_json,created_at)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        item_id,
                        change_set_id,
                        operation,
                        entity_type,
                        entity_id,
                        canonical_json(payload),
                        stamp,
                    ),
                )
            db.execute(
                """
                UPDATE graph_change_sets
                SET status='draft',reviewed_by=NULL,review_notes=NULL,updated_at=?
                WHERE change_set_id=?
                """,
                (stamp, change_set_id),
            )
            self.audit.record(
                "graph.change_item_saved",
                "graph_change_set",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=change_set_id,
                metadata={
                    "operation": operation,
                    "entityType": entity_type,
                    "entityId": entity_id,
                },
                request_id=request_id,
                connection=db,
            )
        return self.get_change_set(change_set_id)

    def submit(
        self,
        change_set_id: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._change_set_row(db, change_set_id)
            if row["created_by"] != actor["id"] and actor["role"] != "admin":
                raise PlatformError("role_forbidden", "只有创建者可以提交变更集", 403)
            if row["status"] not in {"draft", "rejected"}:
                raise PlatformError("graph_state_conflict", "变更集不能重复提交", 409)
            count = db.execute(
                "SELECT count(*) FROM graph_change_items WHERE change_set_id=?",
                (change_set_id,),
            ).fetchone()[0]
            if count == 0:
                raise PlatformError("graph_change_empty", "图谱变更集不能为空", 422)
            self._preview_in_transaction(db, row)
            db.execute(
                """
                UPDATE graph_change_sets
                SET status='submitted',updated_at=? WHERE change_set_id=?
                """,
                (utc_now(), change_set_id),
            )
            self.audit.record(
                "graph.change_set_submitted",
                "graph_change_set",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=change_set_id,
                metadata={"itemCount": count},
                request_id=request_id,
                connection=db,
            )
        return self.get_change_set(change_set_id)

    def review(
        self,
        change_set_id: str,
        decision: str,
        notes: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        if decision not in {"approved", "rejected"}:
            raise PlatformError("validation_error", "decision 不受支持", 422)
        if not isinstance(notes, str) or len(notes) > 4000:
            raise PlatformError("validation_error", "notes 无效", 422)
        with self.transaction() as db:
            row = self._change_set_row(db, change_set_id)
            if row["status"] != "submitted":
                raise PlatformError("graph_state_conflict", "只有已提交变更可审核", 409)
            db.execute(
                """
                UPDATE graph_change_sets
                SET status=?,reviewed_by=?,review_notes=?,updated_at=?
                WHERE change_set_id=?
                """,
                (decision, actor["id"], notes.strip(), utc_now(), change_set_id),
            )
            self.audit.record(
                f"graph.change_set_{decision}",
                "graph_change_set",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=change_set_id,
                metadata={"notes": notes.strip()},
                request_id=request_id,
                connection=db,
            )
        return self.get_change_set(change_set_id)

    def publish(
        self,
        change_set_id: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._change_set_row(db, change_set_id)
            if row["status"] != "approved":
                raise PlatformError("graph_state_conflict", "只有已批准变更可以发布", 409)
            current = db.execute(
                "SELECT * FROM graph_versions ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
            if current is None:
                raise PlatformError("graph_not_initialized", "知识图谱尚未初始化", 409)
            if row["base_version_id"] != current["version_id"]:
                raise PlatformError(
                    "graph_base_conflict",
                    "全局图谱版本已经变化，请重新基于最新版本创建变更",
                    409,
                    {
                        "baseVersionId": row["base_version_id"],
                        "currentVersionId": current["version_id"],
                    },
                )
            snapshot = self._preview_in_transaction(db, row)
            sequence = int(current["sequence"]) + 1
            version_id = f"GRAPH-V{sequence:04d}"
            stamp = utc_now()
            digest = json_hash(snapshot)
            db.execute(
                """
                INSERT INTO graph_versions
                (version_id,sequence,parent_version_id,change_set_id,snapshot_json,
                 content_sha256,published_by,published_at)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    version_id,
                    sequence,
                    current["version_id"],
                    change_set_id,
                    canonical_json(snapshot),
                    digest,
                    actor["id"],
                    stamp,
                ),
            )
            db.execute(
                """
                UPDATE graph_change_sets
                SET status='published',published_version_id=?,updated_at=?
                WHERE change_set_id=?
                """,
                (version_id, stamp, change_set_id),
            )
            self.audit.record(
                "graph.version_published",
                "graph_version",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=version_id,
                metadata={
                    "changeSetId": change_set_id,
                    "parentVersionId": current["version_id"],
                    "sha256": digest,
                },
                request_id=request_id,
                connection=db,
            )
            version = db.execute(
                "SELECT * FROM graph_versions WHERE version_id=?",
                (version_id,),
            ).fetchone()
        return self._project_version(version, include_snapshot=True)

    def get_change_set(self, change_set_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = self._change_set_row(db, change_set_id)
            items = db.execute(
                """
                SELECT * FROM graph_change_items
                WHERE change_set_id=?
                ORDER BY entity_type,entity_id
                """,
                (change_set_id,),
            ).fetchall()
        return self._project_change_set(row, items)

    def list_change_sets(
        self,
        *,
        status: str | None = None,
        created_by: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses = []
        values: list[Any] = []
        if status:
            clauses.append("status=?")
            values.append(status)
        if created_by:
            clauses.append("created_by=?")
            values.append(created_by)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            rows = db.execute(
                f"""
                SELECT c.*,
                       (SELECT count(*) FROM graph_change_items i
                        WHERE i.change_set_id=c.change_set_id) AS item_count
                FROM graph_change_sets c {where}
                ORDER BY updated_at DESC LIMIT ?
                """,
                [*values, min(max(limit, 1), 200)],
            ).fetchall()
        return [self._project_change_set(row) for row in rows]

    def diff(
        self,
        from_version_id: str,
        to_version_id: str | None = None,
    ) -> dict[str, Any]:
        before = self._get_version(from_version_id)
        after = self._get_version(to_version_id)
        result = {
            "fromVersionId": before["versionId"],
            "toVersionId": after["versionId"],
            "nodes": self._entity_diff(
                before["snapshot"]["nodes"],
                after["snapshot"]["nodes"],
            ),
            "edges": self._entity_diff(
                before["snapshot"]["edges"],
                after["snapshot"]["edges"],
            ),
        }
        return result

    def subgraph(
        self,
        center_id: str,
        *,
        depth: int = 1,
        node_types: set[str] | None = None,
    ) -> dict[str, Any]:
        if depth < 0 or depth > 4:
            raise PlatformError("validation_error", "depth 必须在 0 到 4 之间", 422)
        graph = self.current_graph()
        nodes = {node["id"]: node for node in graph["nodes"]}
        if center_id not in nodes:
            raise PlatformError("graph_node_not_found", "未找到中心节点", 404)
        edges = graph["edges"]
        selected = {center_id}
        frontier = {center_id}
        for _ in range(depth):
            next_frontier: set[str] = set()
            for edge in edges:
                if edge["source"] in frontier:
                    next_frontier.add(edge["target"])
                if edge["target"] in frontier:
                    next_frontier.add(edge["source"])
            next_frontier -= selected
            selected.update(next_frontier)
            frontier = next_frontier
        projected_nodes = [
            node
            for node_id, node in nodes.items()
            if node_id in selected and (not node_types or node["type"] in node_types)
        ]
        projected_ids = {node["id"] for node in projected_nodes}
        return {
            "versionId": graph["versionId"],
            "centerNodeId": center_id,
            "depth": depth,
            "nodes": projected_nodes,
            "edges": [
                edge
                for edge in edges
                if edge["source"] in projected_ids and edge["target"] in projected_ids
            ],
        }

    def _preview_in_transaction(
        self,
        db: sqlite3.Connection,
        change_set: sqlite3.Row,
    ) -> dict[str, Any]:
        base = db.execute(
            "SELECT snapshot_json FROM graph_versions WHERE version_id=?",
            (change_set["base_version_id"],),
        ).fetchone()
        if base is None:
            raise PlatformError("graph_version_not_found", "基础图谱版本不存在", 409)
        snapshot = copy.deepcopy(load_json(base["snapshot_json"], {}))
        node_map = {item["id"]: item for item in snapshot.get("nodes", [])}
        edge_map = {item["id"]: item for item in snapshot.get("edges", [])}
        items = db.execute(
            """
            SELECT * FROM graph_change_items
            WHERE change_set_id=?
            ORDER BY CASE entity_type WHEN 'edge' THEN 0 ELSE 1 END,
                     operation,entity_id
            """,
            (change_set["change_set_id"],),
        ).fetchall()
        for item in items:
            target = node_map if item["entity_type"] == "node" else edge_map
            if item["operation"] == "delete":
                target.pop(item["entity_id"], None)
            else:
                target[item["entity_id"]] = load_json(item["payload_json"], {})
        result = {
            "schemaVersion": 1,
            "nodes": sorted(node_map.values(), key=lambda item: item["id"]),
            "edges": sorted(edge_map.values(), key=lambda item: item["id"]),
        }
        self._validate_snapshot(result)
        return result

    def _get_version(self, version_id: str | None) -> dict[str, Any]:
        with self.connect() as db:
            if version_id:
                row = db.execute(
                    "SELECT * FROM graph_versions WHERE version_id=?",
                    (version_id,),
                ).fetchone()
            else:
                row = db.execute(
                    "SELECT * FROM graph_versions ORDER BY sequence DESC LIMIT 1"
                ).fetchone()
        if row is None:
            raise PlatformError("graph_version_not_found", "未找到图谱版本", 404)
        return self._project_version(row, include_snapshot=True)

    @staticmethod
    def _change_set_row(db: sqlite3.Connection, change_set_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM graph_change_sets WHERE change_set_id=?",
            (change_set_id,),
        ).fetchone()
        if row is None:
            raise PlatformError("graph_change_set_not_found", "未找到图谱变更集", 404)
        return row

    @classmethod
    def _validate_snapshot(cls, snapshot: dict[str, Any]) -> None:
        nodes = snapshot.get("nodes")
        edges = snapshot.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise PlatformError("graph_invalid", "图谱节点和关系必须是数组", 422)
        node_ids: set[str] = set()
        edge_ids: set[str] = set()
        for node in nodes:
            cls._validate_entity("node", node.get("id") if isinstance(node, dict) else "", node)
            if node["id"] in node_ids:
                raise PlatformError("graph_duplicate_id", "存在重复节点 ID", 422)
            node_ids.add(node["id"])
        for edge in edges:
            cls._validate_entity("edge", edge.get("id") if isinstance(edge, dict) else "", edge)
            if edge["id"] in edge_ids:
                raise PlatformError("graph_duplicate_id", "存在重复关系 ID", 422)
            edge_ids.add(edge["id"])
            if edge["source"] not in node_ids or edge["target"] not in node_ids:
                raise PlatformError(
                    "graph_dangling_edge",
                    "关系引用了不存在的节点",
                    422,
                    {"edgeId": edge["id"]},
                )

    @classmethod
    def _validate_entity(
        cls,
        entity_type: str,
        entity_id: str,
        payload: Any,
    ) -> None:
        if not isinstance(payload, dict):
            raise PlatformError("validation_error", "图谱实体必须是对象", 422)
        cls._validate_id(entity_id, "entityId")
        if payload.get("id") != entity_id:
            raise PlatformError("validation_error", "payload.id 必须与 entityId 一致", 422)
        if entity_type == "node":
            for field in ("type", "label"):
                cls._required(payload.get(field), field, 160)
        else:
            for field in ("source", "target"):
                cls._validate_id(payload.get(field), field)
            cls._required(payload.get("relation"), "relation", 160)
        properties = payload.get("properties", {})
        if not isinstance(properties, dict):
            raise PlatformError("validation_error", "properties 必须是对象", 422)

    @staticmethod
    def _normalize_seed(seed: dict[str, Any]) -> dict[str, Any]:
        nodes = []
        for item in seed.get("nodes", []):
            properties = {
                key: value
                for key, value in item.items()
                if key not in {"id", "type", "name", "label"}
            }
            nodes.append(
                {
                    "id": item["id"],
                    "type": item["type"],
                    "label": item.get("label") or item.get("name") or item["id"],
                    "properties": properties,
                }
            )
        edges = []
        for item in seed.get("relations", seed.get("edges", [])):
            edges.append(
                {
                    "id": item["id"],
                    "source": item["source"],
                    "target": item["target"],
                    "relation": item["relation"],
                    "properties": {
                        key: value
                        for key, value in item.items()
                        if key not in {"id", "source", "target", "relation"}
                    },
                }
            )
        return {"schemaVersion": 1, "nodes": nodes, "edges": edges}

    @staticmethod
    def _entity_diff(before: list[dict[str, Any]], after: list[dict[str, Any]]):
        left = {item["id"]: item for item in before}
        right = {item["id"]: item for item in after}
        return {
            "added": [right[item] for item in sorted(right.keys() - left.keys())],
            "removed": [left[item] for item in sorted(left.keys() - right.keys())],
            "updated": [
                {"before": left[item], "after": right[item]}
                for item in sorted(left.keys() & right.keys())
                if left[item] != right[item]
            ],
        }

    @staticmethod
    def _project_version(
        row: sqlite3.Row,
        *,
        include_snapshot: bool = False,
    ) -> dict[str, Any]:
        value = {
            "versionId": row["version_id"],
            "sequence": row["sequence"],
            "parentVersionId": row["parent_version_id"],
            "changeSetId": row["change_set_id"],
            "sha256": row["content_sha256"],
            "publishedBy": row["published_by"],
            "publishedAt": row["published_at"],
        }
        if include_snapshot:
            value["snapshot"] = load_json(row["snapshot_json"], {})
        return value

    @staticmethod
    def _project_change_set(
        row: sqlite3.Row,
        items: list[sqlite3.Row] | None = None,
    ) -> dict[str, Any]:
        value = {
            "id": row["change_set_id"],
            "title": row["title"],
            "description": row["description"],
            "status": row["status"],
            "baseVersionId": row["base_version_id"],
            "caseRunId": row["case_run_id"],
            "createdBy": row["created_by"],
            "reviewedBy": row["reviewed_by"],
            "reviewNotes": row["review_notes"],
            "publishedVersionId": row["published_version_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        if items is not None:
            value["items"] = [
                {
                    "id": item["item_id"],
                    "operation": item["operation"],
                    "entityType": item["entity_type"],
                    "entityId": item["entity_id"],
                    "payload": load_json(item["payload_json"], {}),
                    "createdAt": item["created_at"],
                }
                for item in items
            ]
        elif "item_count" in row.keys():
            value["itemCount"] = row["item_count"]
        return value

    @staticmethod
    def _validate_id(value: Any, field: str) -> None:
        if not isinstance(value, str) or not ENTITY_ID_PATTERN.fullmatch(value):
            raise PlatformError("validation_error", f"{field} 格式无效", 422)

    @staticmethod
    def _required(value: Any, field: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        result = value.strip()
        if len(result) > max_length:
            raise PlatformError("validation_error", f"{field} 过长", 422)
        return result
