from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PresentationStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _ensure_column(db, table: str, column: str, definition: str):
        columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def initialize(self, initial_state: dict, case_seed: dict, knowledge_seed: dict, graph_seed: dict | None = None):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS presentation_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, engineer_result TEXT, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS expert_reviews (case_id TEXT PRIMARY KEY, status TEXT NOT NULL, draft TEXT NOT NULL, annotations TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS knowledge_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, current_version TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS knowledge_versions (knowledge_id TEXT NOT NULL, version TEXT NOT NULL, content TEXT NOT NULL, source_case_id TEXT, published_by TEXT, published_at TEXT, PRIMARY KEY(knowledge_id, version));
                CREATE TABLE IF NOT EXISTS graph_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, knowledge_id TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL, source_case_id TEXT, published_by TEXT, published_at TEXT);
                CREATE TABLE IF NOT EXISTS graph_nodes (id TEXT NOT NULL, version TEXT NOT NULL, name TEXT NOT NULL, node_type TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL, change_type TEXT, verification_level TEXT NOT NULL, knowledge_id TEXT, source_case_id TEXT, payload TEXT NOT NULL, published_by TEXT, published_at TEXT, PRIMARY KEY(id, version));
                CREATE TABLE IF NOT EXISTS engineer_sync_records (engineer_id TEXT NOT NULL, knowledge_id TEXT NOT NULL, local_version TEXT NOT NULL, latest_version TEXT NOT NULL, status TEXT NOT NULL, synced_at TEXT, PRIMARY KEY(engineer_id, knowledge_id));
            """)
            self._ensure_column(db, "graph_relations", "relation_id", "TEXT")
            self._ensure_column(db, "graph_relations", "source_node_id", "TEXT")
            self._ensure_column(db, "graph_relations", "target_node_id", "TEXT")
            self._ensure_column(db, "graph_relations", "status", "TEXT")
            self._ensure_column(db, "graph_relations", "change_type", "TEXT")
            self._ensure_column(db, "graph_relations", "verification_level", "TEXT")
            self._ensure_column(db, "graph_relations", "payload", "TEXT")
            exists = db.execute("SELECT 1 FROM presentation_state WHERE id=1").fetchone()
        if not exists:
            self.reset(initial_state, case_seed, knowledge_seed, graph_seed)

    def reset(self, state: dict, case_seed: dict, knowledge_seed: dict, graph_seed: dict | None = None) -> dict:
        stamp = now_iso()
        state = {**state, "updatedAt": stamp}
        dynamic = next(item for item in knowledge_seed["items"] if item["id"] == knowledge_seed["dynamicKnowledgeId"])
        with self.connect() as db:
            for table in ("presentation_state", "cases", "expert_reviews", "knowledge_items", "knowledge_versions", "graph_nodes", "graph_relations", "engineer_sync_records"):
                db.execute(f"DELETE FROM {table}")
            db.execute("INSERT INTO presentation_state VALUES (1, ?, ?)", (json.dumps(state, ensure_ascii=False), stamp))
            db.execute("INSERT INTO cases VALUES (?, ?, ?, NULL, ?)", (case_seed["id"], state["caseStatus"], json.dumps(case_seed, ensure_ascii=False), stamp))
            db.execute("INSERT INTO knowledge_items VALUES (?, ?, '1.0', ?)", (dynamic["id"], dynamic["title"], stamp))
            db.execute("INSERT INTO knowledge_versions VALUES (?, '1.0', ?, NULL, '系统预置', ?)", (dynamic["id"], json.dumps({"content": dynamic["baseContent"]}, ensure_ascii=False), stamp))
            db.execute("INSERT INTO engineer_sync_records VALUES ('lishifu', ?, '1.0', '1.0', 'current', ?)", (dynamic["id"], stamp))
            for node in (graph_seed or {}).get("nodes", []):
                db.execute(
                    "INSERT INTO graph_nodes VALUES (?,?,?,?,?,'published',NULL,?,?,NULL,?,'系统预置',?)",
                    (
                        node["id"], "seed", node["name"], node["type"], node["domain"],
                        node.get("verificationLevel", "presentation_seed"), None,
                        json.dumps(node, ensure_ascii=False), stamp,
                    ),
                )
        return state

    def load_state(self) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT payload FROM presentation_state WHERE id=1").fetchone()
        return json.loads(row["payload"])

    def save_state(self, state: dict) -> dict:
        stamp = now_iso()
        state = {**state, "updatedAt": stamp}
        with self.connect() as db:
            db.execute("UPDATE presentation_state SET payload=?, updated_at=? WHERE id=1", (json.dumps(state, ensure_ascii=False), stamp))
        return state

    def save_engineer_result(self, case_id: str, status: str, result: dict):
        with self.connect() as db:
            db.execute("UPDATE cases SET status=?, engineer_result=?, updated_at=? WHERE id=?", (status, json.dumps(result, ensure_ascii=False), now_iso(), case_id))

    def save_expert_draft(self, case_id: str, draft: dict):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO expert_reviews VALUES (?, 'draft', ?, ?, ?)", (case_id, json.dumps(draft, ensure_ascii=False), json.dumps(draft.get("annotations", []), ensure_ascii=False), now_iso()))

    def publish(self, state: dict, case_id: str, knowledge_id: str, draft: dict, graph_seed: dict | None = None) -> dict:
        stamp = now_iso()
        version = "1.1"
        next_state = {**state, "expertDraft": draft, "expertConclusion": draft["caseResult"]["finalCause"], "expertAnnotations": draft.get("annotations", []), "expertApproved": True, "graphDecision": "accepted", "caseStatus": "archived_with_knowledge", "knowledgePublished": True, "knowledgeVersion": version, "publishedKnowledge": draft["knowledge"], "publishedRelations": draft["relations"], "publishedAt": stamp, "updatedAt": stamp}
        with self.connect() as db:
            db.execute("UPDATE cases SET status=?, updated_at=? WHERE id=?", (next_state["caseStatus"], stamp, case_id))
            db.execute("INSERT OR REPLACE INTO expert_reviews VALUES (?, 'published', ?, ?, ?)", (case_id, json.dumps(draft, ensure_ascii=False), json.dumps(draft.get("annotations", []), ensure_ascii=False), stamp))
            db.execute("INSERT OR REPLACE INTO knowledge_versions VALUES (?, ?, ?, ?, '专家账号', ?)", (knowledge_id, version, json.dumps(draft["knowledge"], ensure_ascii=False), case_id, stamp))
            db.execute("UPDATE knowledge_items SET current_version=?, updated_at=? WHERE id=?", (version, stamp, knowledge_id))
            db.execute("DELETE FROM graph_nodes WHERE knowledge_id=? AND version=?", (knowledge_id, version))
            db.execute("DELETE FROM graph_relations WHERE knowledge_id=? AND version=?", (knowledge_id, version))
            proposal = draft.get("graphProposal") or {}
            change_nodes = proposal.get("nodes") or (graph_seed or {}).get("changeTemplate", {}).get("nodes", [])
            seed_nodes = (graph_seed or {}).get("nodes", [])
            node_ids_by_name = {node["name"]: node["id"] for node in [*seed_nodes, *change_nodes]}
            for node in change_nodes:
                db.execute(
                    "INSERT INTO graph_nodes VALUES (?,?,?,?,?,'published',?,?,?, ?,?,'专家账号',?)",
                    (
                        node["id"], version, node["name"], node["type"], node["domain"],
                        node.get("changeType", "added"), node.get("verificationLevel", "verified_case"),
                        knowledge_id, case_id, json.dumps({**node, "status": "published"}, ensure_ascii=False), stamp,
                    ),
                )
            for index, relation in enumerate(draft["relations"]):
                relation_id = str(relation.get("id") or f"published-{index + 1}")
                db.execute(
                    """INSERT INTO graph_relations
                    (knowledge_id,version,source,relation,target,source_case_id,published_by,published_at,relation_id,source_node_id,target_node_id,status,change_type,verification_level,payload)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        knowledge_id, version, relation["source"], relation["relation"], relation["target"],
                        case_id, "专家账号", stamp, relation_id,
                        node_ids_by_name.get(relation["source"]), node_ids_by_name.get(relation["target"]),
                        "published", relation.get("changeType", "added"), "verified_case",
                        json.dumps(relation, ensure_ascii=False),
                    ),
                )
            db.execute("UPDATE engineer_sync_records SET latest_version=?, status='update_available' WHERE knowledge_id=?", (version, knowledge_id))
            db.execute("UPDATE presentation_state SET payload=?, updated_at=? WHERE id=1", (json.dumps(next_state, ensure_ascii=False), stamp))
        return next_state

    def published_graph(self, knowledge_id: str, version: str) -> dict:
        with self.connect() as db:
            nodes = db.execute(
                "SELECT payload FROM graph_nodes WHERE knowledge_id=? AND version=? ORDER BY id",
                (knowledge_id, version),
            ).fetchall()
            relations = db.execute(
                """SELECT relation_id,source_node_id,target_node_id,source,relation,target,status,change_type,verification_level,source_case_id
                FROM graph_relations WHERE knowledge_id=? AND version=? ORDER BY id""",
                (knowledge_id, version),
            ).fetchall()
        return {
            "nodes": [json.loads(row["payload"]) for row in nodes],
            "relations": [dict(row) for row in relations],
        }

    def sync_status(self, engineer_id: str, knowledge_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT * FROM engineer_sync_records WHERE engineer_id=? AND knowledge_id=?", (engineer_id, knowledge_id)).fetchone()
        return dict(row)

    def sync_latest(self, engineer_id: str, knowledge_id: str) -> dict:
        stamp = now_iso()
        with self.connect() as db:
            latest = db.execute("SELECT current_version FROM knowledge_items WHERE id=?", (knowledge_id,)).fetchone()["current_version"]
            db.execute("UPDATE engineer_sync_records SET local_version=?, latest_version=?, status='current', synced_at=? WHERE engineer_id=? AND knowledge_id=?", (latest, latest, stamp, engineer_id, knowledge_id))
        return self.sync_status(engineer_id, knowledge_id)

    def engineer_snapshot(self, engineer_id: str, knowledge_id: str) -> dict:
        sync = self.sync_status(engineer_id, knowledge_id)
        with self.connect() as db:
            version = db.execute("SELECT * FROM knowledge_versions WHERE knowledge_id=? AND version=?", (knowledge_id, sync["local_version"])).fetchone()
            relations = db.execute("SELECT source,relation,target FROM graph_relations WHERE knowledge_id=? AND version=? ORDER BY id", (knowledge_id, sync["local_version"])).fetchall()
        return {"knowledgeId": knowledge_id, "version": sync["local_version"], "latestVersion": sync["latest_version"], "syncStatus": sync["status"], "syncedAt": sync["synced_at"], "knowledge": json.loads(version["content"]), "relations": [dict(row) for row in relations], "sourceCaseId": version["source_case_id"], "publishedBy": version["published_by"], "publishedAt": version["published_at"]}
