from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any

try:
    from ..case_package import CasePackageRegistry
    from ..case_platform.errors import PlatformError
    from ..core_business.database import SQLiteService, canonical_json, load_json, utc_now
    from ..core_business.graph import GovernedGraphService
    from ..core_business.manuals import ManualKnowledgeService
except ImportError:
    from case_package import CasePackageRegistry
    from case_platform.errors import PlatformError
    from core_business.database import SQLiteService, canonical_json, load_json, utc_now
    from core_business.graph import GovernedGraphService
    from core_business.manuals import ManualKnowledgeService


SOURCE_WEIGHTS = {"manual": 1.0, "case": 0.92, "graph": 0.78, "field": 0.96}


class UnifiedKnowledgeSearchService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        manuals: ManualKnowledgeService,
        graph: GovernedGraphService,
        registry: CasePackageRegistry,
    ):
        super().__init__(database_path)
        self.manuals = manuals
        self.graph = graph
        self.registry = registry

    def search(
        self,
        query: str,
        scope: dict[str, Any],
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
        limit: int = 12,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        normalized = self._normalize(query)
        if not normalized or len(query) > 300:
            raise PlatformError("validation_error", "query 不能为空且不超过 300 字", 422)
        if not isinstance(scope, dict):
            raise PlatformError("validation_error", "scope 必须是对象", 422)
        providers: dict[str, list[dict[str, Any]]] = {}
        providers["manual"] = self._manual(query, scope)
        providers["case"] = self._cases(normalized, scope)
        providers["graph"] = self._graph(normalized, scope)
        providers["field"] = self._field(normalized, scope)
        merged = self._merge(normalized, providers, min(max(limit, 1), 30))
        duration_ms = int((time.perf_counter() - started) * 1000)
        search_run_id = f"SRCH-{uuid.uuid4().hex.upper()}"
        stats = {
            name: {"candidates": len(items), "returned": sum(item["provider"] == name for item in merged)}
            for name, items in providers.items()
        }
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO knowledge_search_runs
                (search_run_id,request_id,actor_id,actor_role,query_hash,
                 scope_json,provider_stats_json,result_ids_json,duration_ms,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    search_run_id,
                    request_id,
                    actor["id"],
                    actor["role"],
                    hashlib.sha256(normalized.encode()).hexdigest(),
                    canonical_json(scope),
                    canonical_json(stats),
                    canonical_json([item["id"] for item in merged]),
                    duration_ms,
                    utc_now(),
                ),
            )
        return {
            "searchRunId": search_run_id,
            "query": query.strip(),
            "scope": scope,
            "items": merged,
            "providers": stats,
            "durationMs": duration_ms,
        }

    def list_runs(self, actor: dict[str, Any], limit: int = 50) -> list[dict[str, Any]]:
        clauses = "" if actor["role"] == "admin" else "WHERE actor_id=?"
        values = [] if actor["role"] == "admin" else [actor["id"]]
        with self.connect() as db:
            rows = db.execute(
                f"""
                SELECT * FROM knowledge_search_runs {clauses}
                ORDER BY created_at DESC LIMIT ?
                """,
                [*values, min(max(limit, 1), 200)],
            ).fetchall()
        return [self._project_run(row) for row in rows]

    def get_run(self, search_run_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM knowledge_search_runs WHERE search_run_id=?",
                (search_run_id,),
            ).fetchone()
        if row is None:
            raise PlatformError("search_run_not_found", "未找到检索记录", 404)
        if actor["role"] != "admin" and row["actor_id"] != actor["id"]:
            raise PlatformError("role_forbidden", "不能查看其他用户的检索记录", 403)
        return self._project_run(row)

    def _manual(self, query: str, scope: dict[str, Any]) -> list[dict[str, Any]]:
        result = self.manuals.search(
            query,
            document_id=scope.get("documentId"),
            fault_domain=scope.get("faultDomain"),
            limit=8,
        )
        return [
            {
                "id": f"manual:{item['chunkId']}",
                "provider": "manual",
                "title": item["title"],
                "excerpt": item["excerpt"],
                "baseScore": item["score"],
                "citation": {
                    "type": "manual_page",
                    "documentId": item["documentId"],
                    "page": item["pageNumber"],
                    "sha256": item["documentSha256"],
                },
                "metadata": {"chunkId": item["chunkId"]},
            }
            for item in result["items"]
        ]

    def _cases(self, normalized: str, scope: dict[str, Any]) -> list[dict[str, Any]]:
        items = []
        case_id = scope.get("caseId")
        packages = (
            [self.registry.get(case_id)]
            if case_id
            else self.registry.list_packages()
        )
        for package in packages:
            for claim in package.claims:
                score = self._coverage(normalized, claim["text"])
                if score <= 0:
                    continue
                items.append(
                    {
                        "id": f"case:{package.case_id}:{claim['claimId']}",
                        "provider": "case",
                        "title": f"{package.identity['title']} · 案例知识",
                        "excerpt": claim["text"],
                        "baseScore": score,
                        "citation": {
                            "type": "case_claim",
                            "caseId": package.case_id,
                            "claimId": claim["claimId"],
                            "evidenceRefs": claim["evidenceRefs"],
                        },
                        "metadata": {
                            "verificationStatus": claim["verificationStatus"],
                            "sourceType": claim["sourceType"],
                        },
                    }
                )
        return items

    def _graph(self, normalized: str, scope: dict[str, Any]) -> list[dict[str, Any]]:
        graph = self.graph.current_graph()
        items = []
        for node in graph["nodes"]:
            text = " ".join(
                [node["label"], node["type"], canonical_json(node.get("properties", {}))]
            )
            score = self._coverage(normalized, text)
            if score > 0:
                items.append(
                    {
                        "id": f"graph:node:{node['id']}",
                        "provider": "graph",
                        "title": node["label"],
                        "excerpt": text,
                        "baseScore": score,
                        "citation": {
                            "type": "graph_node",
                            "versionId": graph["versionId"],
                            "nodeId": node["id"],
                        },
                        "metadata": {"nodeType": node["type"]},
                    }
                )
        return items

    def _field(self, normalized: str, scope: dict[str, Any]) -> list[dict[str, Any]]:
        run_id = scope.get("runId")
        if not run_id:
            return []
        with self.connect() as db:
            row = db.execute("SELECT * FROM case_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise PlatformError("case_run_not_found", "未找到现场运行", 404)
        payload = load_json(row["payload"], {})
        sections = {
            "现场输入": payload.get("initialInput"),
            "接诊事实": payload.get("intakeFacts"),
            "步骤执行": payload.get("stepExecution"),
            "检修与审核": payload.get("snapshots"),
        }
        items = []
        for label, value in sections.items():
            text = canonical_json(value or {})
            score = self._coverage(normalized, text)
            if score > 0:
                items.append(
                    {
                        "id": f"field:{run_id}:{hashlib.sha1(label.encode()).hexdigest()[:8]}",
                        "provider": "field",
                        "title": f"{label} · {run_id}",
                        "excerpt": text[:900],
                        "baseScore": score,
                        "citation": {"type": "case_run", "runId": run_id, "section": label},
                        "metadata": {"caseId": row["case_id"], "revision": row["revision"]},
                    }
                )
        return items

    def _merge(
        self,
        normalized: str,
        providers: dict[str, list[dict[str, Any]]],
        limit: int,
    ) -> list[dict[str, Any]]:
        deduplicated: dict[str, dict[str, Any]] = {}
        for provider, items in providers.items():
            for item in items:
                fingerprint = hashlib.sha256(
                    self._normalize(item["excerpt"]).encode()
                ).hexdigest()
                score = min(
                    1.0,
                    SOURCE_WEIGHTS[provider] * 0.55
                    + float(item["baseScore"]) * 0.35
                    + self._coverage(normalized, item["title"]) * 0.1,
                )
                projected = {**item, "score": round(score, 4)}
                projected.pop("baseScore", None)
                previous = deduplicated.get(fingerprint)
                if previous is None or projected["score"] > previous["score"]:
                    deduplicated[fingerprint] = projected
        ranked = sorted(
            deduplicated.values(),
            key=lambda item: (-item["score"], item["provider"], item["id"]),
        )
        result = []
        quotas = {"manual": 5, "case": 4, "graph": 3, "field": 3}
        used = {name: 0 for name in quotas}
        for item in ranked:
            if used[item["provider"]] >= quotas[item["provider"]]:
                continue
            used[item["provider"]] += 1
            result.append(item)
            if len(result) >= limit:
                break
        return result

    @classmethod
    def _coverage(cls, normalized_query: str, text: str) -> float:
        haystack = cls._normalize(text)
        tokens = cls._tokens(normalized_query)
        if not tokens:
            return 0
        matched = sum(token in haystack for token in tokens)
        return matched / len(tokens)

    @staticmethod
    def _tokens(value: str) -> list[str]:
        words = re.findall(r"[a-z0-9_.-]+|[\u3400-\u9fff]{2,}", value)
        return words[:12]

    @staticmethod
    def _normalize(value: str) -> str:
        return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value)).lower())

    @staticmethod
    def _project_run(row) -> dict[str, Any]:
        return {
            "id": row["search_run_id"],
            "requestId": row["request_id"],
            "actorId": row["actor_id"],
            "actorRole": row["actor_role"],
            "queryHash": row["query_hash"],
            "scope": load_json(row["scope_json"], {}),
            "providerStats": load_json(row["provider_stats_json"], {}),
            "resultIds": load_json(row["result_ids_json"], []),
            "durationMs": row["duration_ms"],
            "createdAt": row["created_at"],
        }
