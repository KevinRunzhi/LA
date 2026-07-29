from __future__ import annotations

import json
import hashlib
import re
import copy
import logging
import sqlite3
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

try:
    from ..case_authoring.service import AUTHORING_MODULES, CaseAuthoringService
    from ..case_package import CasePackageError
    from ..case_platform.errors import PlatformError
    from ..case_platform.routing import DeterministicCaseRouter
    from ..core_business.audit import AuditService
    from ..core_business.database import (
        SQLiteService,
        canonical_json,
        json_hash,
        load_json,
        utc_now,
    )
    from ..core_business.graph import GovernedGraphService
    from ..core_business.manuals import ManualKnowledgeService
    from .providers import CaseGenerationProvider, StructuredLocalGenerationProvider
    from .patches import apply_patch as apply_json_patch, build_patch, select_operations
    from .templates import CaseGenerationTemplateRegistry
except ImportError:
    from case_authoring.service import AUTHORING_MODULES, CaseAuthoringService
    from case_package import CasePackageError
    from case_platform.errors import PlatformError
    from case_platform.routing import DeterministicCaseRouter
    from core_business.audit import AuditService
    from core_business.database import SQLiteService, canonical_json, json_hash, load_json, utc_now
    from core_business.graph import GovernedGraphService
    from core_business.manuals import ManualKnowledgeService
    from case_generation.providers import CaseGenerationProvider, StructuredLocalGenerationProvider
    from case_generation.patches import apply_patch as apply_json_patch, build_patch, select_operations
    from case_generation.templates import CaseGenerationTemplateRegistry


FINAL_JOB_STATES = {"completed", "failed", "cancelled"}
LOGGER = logging.getLogger("la.case_generation")
MAX_SOURCE_COUNT = 30
MAX_MANUAL_CHUNKS = 500
MAX_MANUAL_PAGES = 200
MAX_INPUT_CHARACTERS = 500_000
MAX_ARTIFACT_BYTES = 1_000_000
MAX_AGENT_ATTEMPTS = 3


class CaseGenerationService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        *,
        authoring: CaseAuthoringService,
        manuals: ManualKnowledgeService,
        graph: GovernedGraphService,
        templates: CaseGenerationTemplateRegistry,
        audit: AuditService,
        provider: CaseGenerationProvider | None = None,
        search_service=None,
    ):
        super().__init__(database_path)
        self.authoring = authoring
        self.manuals = manuals
        self.graph = graph
        self.templates = templates
        self.provider = provider or StructuredLocalGenerationProvider()
        self.audit = audit
        self.search_service = search_service

    def create_job(
        self,
        payload: dict[str, Any],
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        draft_id = self._required(payload.get("draftId"), "draftId")
        draft = self.authoring.get_draft(draft_id)
        if actor["role"] != "admin" and draft["createdBy"] != actor["id"]:
            raise PlatformError("role_forbidden", "不能为其他专家的草稿创建生成任务", 403)
        if draft["status"] not in {"draft", "rejected"}:
            raise PlatformError("case_draft_state_conflict", "只有可编辑草稿可以生成内容", 409)
        provider = str(payload.get("provider") or self.provider.provider_id)
        if provider != self.provider.provider_id:
            raise PlatformError("generation_provider_unavailable", "当前只启用了 structured-local provider", 503)
        template_id = str(payload.get("templateId") or "").strip() or None
        if template_id:
            template = self.templates.get(template_id)
        else:
            template = None
        sources = payload.get("sources") or []
        if not isinstance(sources, list) or not sources:
            raise PlatformError("generation_sources_required", "至少选择一项资料来源", 422)
        if len(sources) > MAX_SOURCE_COUNT:
            raise PlatformError(
                "generation_sources_limit",
                f"单任务最多选择 {MAX_SOURCE_COUNT} 项来源",
                422,
            )
        job_id = f"CGJ-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        options = {
            "query": str(payload.get("query") or draft["title"]).strip()[:300],
            "requestedFaultDomain": payload.get("faultDomain"),
            "createdByRole": actor["role"],
            "generationRange": payload.get("generationRange") or list(AUTHORING_MODULES),
        }
        if (
            not isinstance(options["generationRange"], list)
            or not options["generationRange"]
            or any(item not in AUTHORING_MODULES for item in options["generationRange"])
        ):
            raise PlatformError("generation_range_invalid", "生成范围必须是八模块的非空子集", 422)
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_generation_jobs
                (job_id,draft_id,provider,status,current_stage,progress,
                 fault_domain,template_id,template_version,options_json,
                 created_by,created_at,updated_at)
                VALUES (?,? ,?,'created','created',0,?,?,?,?,?,?,?)
                """,
                (
                    job_id,
                    draft_id,
                    provider,
                    template["faultDomain"] if template else payload.get("faultDomain"),
                    template_id,
                    template["version"] if template else None,
                    canonical_json(options),
                    actor["id"],
                    stamp,
                    stamp,
                ),
            )
            for source in sources:
                self._insert_source(db, job_id, source, actor)
            self._event_audit(
                db,
                "case_generation.job_created",
                job_id,
                actor,
                {"draftId": draft_id, "sources": len(sources), "templateId": template_id},
                request_id,
            )
        return self.get_job(job_id)

    def list_jobs(self, actor: dict[str, Any], limit: int = 100) -> list[dict[str, Any]]:
        where = "" if actor["role"] == "admin" else "WHERE created_by=?"
        values = [] if actor["role"] == "admin" else [actor["id"]]
        with self.connect() as db:
            rows = db.execute(
                f"SELECT * FROM case_generation_jobs {where} ORDER BY created_at DESC LIMIT ?",
                [*values, min(max(limit, 1), 200)],
            ).fetchall()
        return [self._project_job(row) for row in rows]

    def available_sources(self, actor: dict[str, Any]) -> dict[str, Any]:
        manuals = self.manuals.list_documents(page_size=100)["items"]
        graph = self.graph.current_graph()
        with self.connect() as db:
            clauses = "" if actor["role"] == "admin" else "WHERE created_by=?"
            values = [] if actor["role"] == "admin" else [actor["id"]]
            runs = [
                {
                    "id": row["run_id"],
                    "caseId": row["case_id"],
                    "packageVersion": row["package_version"],
                    "packageHash": row["package_hash"],
                    "status": row["status"],
                    "revision": row["revision"],
                    "updatedAt": row["updated_at"],
                }
                for row in db.execute(
                    f"""
                    SELECT run_id,case_id,package_version,package_hash,status,
                           revision,updated_at FROM case_runs {clauses}
                    ORDER BY updated_at DESC LIMIT 50
                    """,
                    values,
                )
            ]
        return {
            "manuals": manuals,
            "cases": [
                package.public_summary()
                for package in self.authoring.registry.list_packages()
            ],
            "graph": {
                "versionId": graph["versionId"],
                "sha256": graph["sha256"],
                "nodes": graph["nodes"][:300],
            },
            "caseRuns": runs,
        }

    def get_job(self, job_id: str, include_details: bool = True) -> dict[str, Any]:
        with self.connect() as db:
            row = self._job_row(db, job_id)
            value = self._project_job(row)
            if include_details:
                value["sources"] = [
                    self._project_source(item)
                    for item in db.execute(
                        "SELECT * FROM case_generation_sources WHERE job_id=? ORDER BY created_at",
                        (job_id,),
                    )
                ]
                value["agentRuns"] = [
                    self._project_run(item)
                    for item in db.execute(
                        "SELECT * FROM case_generation_agent_runs WHERE job_id=? ORDER BY started_at",
                        (job_id,),
                    )
                ]
                value["artifacts"] = [
                    self._project_artifact(item, include_content=False)
                    for item in db.execute(
                        "SELECT * FROM case_generation_artifacts WHERE job_id=? ORDER BY created_at",
                        (job_id,),
                    )
                ]
                value["patches"] = [
                    self._project_patch(item)
                    for item in db.execute(
                        "SELECT * FROM case_generation_patches WHERE job_id=? ORDER BY module_name",
                        (job_id,),
                    )
                ]
                value["evaluations"] = [
                    {
                        "id": item["evaluation_id"],
                        "artifactId": item["artifact_id"],
                        "evaluatorType": item["evaluator_type"],
                        "ruleId": item["rule_id"],
                        "severity": item["severity"],
                        "passed": bool(item["passed"]),
                        "details": load_json(item["details_json"], {}),
                        "createdAt": item["created_at"],
                    }
                    for item in db.execute(
                        "SELECT * FROM case_generation_evaluations WHERE job_id=? ORDER BY created_at",
                        (job_id,),
                    )
                ]
        return value

    def assert_job_access(self, job_id: str, actor: dict[str, Any]) -> None:
        with self.connect() as db:
            row = self._job_row(db, job_id)
            if actor["role"] != "admin" and row["created_by"] != actor["id"]:
                raise PlatformError("role_forbidden", "不能访问其他专家的生成任务", 403)

    def get_artifacts(self, job_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            self._job_row(db, job_id)
            rows = db.execute(
                "SELECT * FROM case_generation_artifacts WHERE job_id=? ORDER BY created_at",
                (job_id,),
            ).fetchall()
        return [self._project_artifact(row, include_content=True) for row in rows]

    def get_agent_runs(self, job_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            self._job_row(db, job_id)
            rows = db.execute(
                "SELECT * FROM case_generation_agent_runs WHERE job_id=? ORDER BY started_at",
                (job_id,),
            ).fetchall()
        return [self._project_run(row) for row in rows]

    def get_patches(self, job_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            self._job_row(db, job_id)
            rows = db.execute(
                "SELECT * FROM case_generation_patches WHERE job_id=? ORDER BY module_name",
                (job_id,),
            ).fetchall()
        return [self._project_patch(row) for row in rows]

    def process_once(self, job_id: str | None = None) -> dict[str, Any] | None:
        claimed = self._claim(job_id)
        if claimed is None:
            return None
        if claimed["provider"] != self.provider.provider_id:
            self._fail_job(
                claimed["job_id"],
                "agent_provider_unavailable",
                "任务绑定的 Provider 与当前 worker 配置不一致，请使用对应 worker 或创建新任务",
            )
            return self.get_job(claimed["job_id"])
        try:
            if claimed["status"] in {
                "created",
                "snapshotting",
                "parsing_documents",
                "extracting_evidence",
                "classifying_domain",
                "planning",
            }:
                self._run_pre_outline(claimed)
            elif claimed["status"] in {
                "generating_modules",
                "criticizing",
                "validating",
                "repairing",
            }:
                self._run_generation(claimed)
            else:
                return self.get_job(claimed["job_id"])
        except PlatformError as exc:
            if exc.code != "generation_cancelled":
                self._fail_job(claimed["job_id"], exc.code, exc.message)
        except (OSError, ValueError, sqlite3.Error) as exc:
            self._fail_job(claimed["job_id"], "generation_internal_error", str(exc))
        except Exception as exc:
            self._fail_job(claimed["job_id"], "generation_unexpected_error", str(exc))
        return self.get_job(claimed["job_id"])

    def request_run(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            self._assert_job_actor(db, job_id, actor)
            if row["status"] not in {
                "created", "snapshotting", "parsing_documents", "extracting_evidence",
                "classifying_domain", "planning", "generating_modules", "criticizing",
                "validating", "repairing",
            }:
                raise PlatformError("generation_job_not_runnable", "当前任务不处于可执行阶段", 409)
            self._event_audit(
                db,
                "case_generation.run_requested",
                job_id,
                actor,
                {"stage": row["current_stage"]},
            )
        return self.get_job(job_id)

    def confirm_domain(self, job_id: str, template_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        template = self.templates.get(template_id)
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            self._assert_job_actor(db, job_id, actor)
            if not (
                row["status"] == "awaiting_outline_review"
                and row["current_stage"] == "awaiting_domain_review"
            ):
                raise PlatformError("generation_state_conflict", "当前任务不在领域确认阶段", 409)
            options = load_json(row["options_json"], {})
            options["confirmedTemplateId"] = template_id
            db.execute(
                """
                UPDATE case_generation_jobs
                SET status='planning',current_stage='planning',progress=36,
                    fault_domain=?,template_id=?,template_version=?,options_json=?,
                    lease_expires_at=NULL,updated_at=? WHERE job_id=?
                """,
                (
                    template["faultDomain"],
                    template_id,
                    template["version"],
                    canonical_json(options),
                    utc_now(),
                    job_id,
                ),
            )
            self._event_audit(
                db,
                "case_generation.domain_confirmed",
                job_id,
                actor,
                {"templateId": template_id},
            )
        return self.get_job(job_id)

    def approve_outline(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            self._assert_job_actor(db, job_id, actor)
            if row["status"] != "awaiting_outline_review":
                raise PlatformError("generation_state_conflict", "当前任务不在大纲确认阶段", 409)
            db.execute(
                """
                UPDATE case_generation_jobs
                SET outline_status='approved',status='generating_modules',
                    current_stage='generating_modules',progress=45,updated_at=?
                WHERE job_id=?
                """,
                (utc_now(), job_id),
            )
            self._event_audit(db, "case_generation.outline_approved", job_id, actor, {})
        return self.get_job(job_id)

    def reject_outline(self, job_id: str, notes: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            self._assert_job_actor(db, job_id, actor)
            if row["status"] != "awaiting_outline_review":
                raise PlatformError("generation_state_conflict", "当前任务不在大纲确认阶段", 409)
            db.execute(
                """
                UPDATE case_generation_jobs
                SET outline_status='rejected',status='failed',current_stage='failed',
                    failure_code='outline_rejected',failure_summary=?,
                    progress=100,completed_at=?,updated_at=?
                WHERE job_id=?
                """,
                (str(notes or "")[:1000], utc_now(), utc_now(), job_id),
            )
            self._event_audit(db, "case_generation.outline_rejected", job_id, actor, {"notes": notes})
        return self.get_job(job_id)

    def cancel(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            self._assert_job_actor(db, job_id, actor)
            if row["status"] in FINAL_JOB_STATES:
                return self._project_job(row)
            db.execute(
                """
                UPDATE case_generation_jobs
                SET cancel_requested=1,status='cancelled',current_stage='cancelled',
                    progress=100,completed_at=?,updated_at=? WHERE job_id=?
                """,
                (utc_now(), utc_now(), job_id),
            )
            self._event_audit(db, "case_generation.cancelled", job_id, actor, {})
        return self.get_job(job_id)

    def decide_patch(
        self,
        patch_id: str,
        decision: str,
        actor: dict[str, Any],
        operation_indexes: list[int] | None = None,
    ) -> dict[str, Any]:
        if decision not in {"accepted", "rejected"}:
            raise PlatformError("validation_error", "patch decision 无效", 422)
        with self.transaction() as db:
            row = self._patch_row(db, patch_id)
            self._assert_job_actor(db, row["job_id"], actor)
            if row["status"] != "proposed":
                raise PlatformError("generation_patch_state_conflict", "当前 Patch 已处理", 409)
            selected = None
            if decision == "accepted":
                selected = select_operations(
                    load_json(row["operations_json"], []),
                    operation_indexes,
                )
            db.execute(
                """
                UPDATE case_generation_patches
                SET status=?,selected_operations_json=?,decided_by=?,decided_at=?
                WHERE patch_id=?
                """,
                (
                    decision,
                    canonical_json(selected) if selected is not None else None,
                    actor["id"],
                    utc_now(),
                    patch_id,
                ),
            )
            if decision == "rejected":
                db.execute(
                    """
                    UPDATE case_generation_evidence_links SET review_status='rejected'
                    WHERE artifact_id=?
                    """,
                    (row["candidate_artifact_id"],),
                )
            self._refresh_patch_job_state(db, row["job_id"])
            self._event_audit(
                db,
                f"case_generation.patch_{decision}",
                row["job_id"],
                actor,
                {"patchId": patch_id, "module": row["module_name"]},
            )
        if decision == "rejected":
            self._finalize_patch_review(row["job_id"], actor)
        return self.get_patch(patch_id)

    def apply_patch(self, patch_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            patch = self._patch_row(db, patch_id)
            self._assert_job_actor(db, patch["job_id"], actor)
            if patch["status"] != "accepted":
                raise PlatformError("generation_patch_state_conflict", "只有已接受 Patch 可以应用", 409)
            artifact = db.execute(
                "SELECT * FROM case_generation_artifacts WHERE artifact_id=?",
                (patch["candidate_artifact_id"],),
            ).fetchone()
        draft = self.authoring.get_draft(patch["draft_id"])
        current = draft["modules"][patch["module_name"]]
        with self.connect() as db:
            applied_before = db.execute(
                """
                SELECT count(*) FROM case_generation_patches
                WHERE job_id=? AND status='applied'
                """,
                (patch["job_id"],),
            ).fetchone()[0]
        expected_revision = patch["base_revision"] + applied_before
        if draft["revision"] != expected_revision:
            with self.transaction() as db:
                db.execute(
                    "UPDATE case_generation_patches SET status='conflicted' WHERE patch_id=?",
                    (patch_id,),
                )
            raise PlatformError(
                "revision_conflict",
                f"草稿 revision 已变化，期望 {expected_revision}，实际 {draft['revision']}",
                409,
            )
        if json_hash(current) != patch["base_content_sha256"]:
            with self.transaction() as db:
                db.execute(
                    "UPDATE case_generation_patches SET status='conflicted' WHERE patch_id=?",
                    (patch_id,),
                )
            raise PlatformError("revision_conflict", "目标模块在生成后已被修改", 409)
        selected_operations = load_json(
            patch["selected_operations_json"],
            load_json(patch["operations_json"], []),
        )
        patched_content = apply_json_patch(current, selected_operations)
        updated = self.authoring.update_module(
            patch["draft_id"],
            patch["module_name"],
            patched_content,
            draft["revision"],
            actor,
        )
        with self.transaction() as db:
            db.execute(
                """
                UPDATE case_generation_patches
                SET status='applied',applied_revision=?,decided_by=COALESCE(decided_by,?),
                    decided_at=COALESCE(decided_at,?) WHERE patch_id=?
                """,
                (updated["revision"], actor["id"], utc_now(), patch_id),
            )
            selected_paths = {
                item["path"] for item in selected_operations
            }
            for link in load_json(patch["evidence_links_json"], []):
                pointer = link.get("jsonPointer", "")
                if any(
                    path.startswith(pointer) or pointer.startswith(path)
                    for path in selected_paths
                ):
                    db.execute(
                        """
                        UPDATE case_generation_evidence_links
                        SET review_status='accepted' WHERE artifact_id=? AND evidence_id=?
                            AND json_pointer=?
                        """,
                        (
                            patch["candidate_artifact_id"],
                            link["evidenceId"],
                            pointer,
                        ),
                    )
            self._refresh_patch_job_state(db, patch["job_id"])
            self._event_audit(
                db,
                "case_generation.patch_applied",
                patch["job_id"],
                actor,
                {"patchId": patch_id, "revision": updated["revision"]},
            )
        self._finalize_patch_review(patch["job_id"], actor)
        return self.get_patch(patch_id)

    def get_patch(self, patch_id: str) -> dict[str, Any]:
        with self.connect() as db:
            return self._project_patch(self._patch_row(db, patch_id))

    def render_metrics(self) -> str:
        """Render bounded-cardinality Prometheus metrics from durable generation state."""
        with self.connect() as db:
            jobs = db.execute(
                """
                SELECT status,COALESCE(fault_domain,'unclassified') AS domain,
                       provider,count(*) AS count
                FROM case_generation_jobs GROUP BY status,domain,provider
                """
            ).fetchall()
            runs = db.execute(
                """
                SELECT agent_type,status,provider,count(*) AS count,
                       COALESCE(sum(duration_ms),0) AS duration_ms
                FROM case_generation_agent_runs
                GROUP BY agent_type,status,provider
                """
            ).fetchall()
            patches = db.execute(
                """
                SELECT status,module_name,count(*) AS count
                FROM case_generation_patches GROUP BY status,module_name
                """
            ).fetchall()
            repairs = db.execute(
                """
                SELECT COALESCE(error_code,'none') AS error_code,count(*) AS count
                FROM case_generation_agent_runs
                WHERE agent_type='targeted_repair'
                GROUP BY error_code
                """
            ).fetchall()
            coverage = db.execute(
                """
                SELECT
                  (SELECT count(DISTINCT artifact_id)
                   FROM case_generation_evidence_links) AS linked,
                  (SELECT count(*) FROM case_generation_artifacts
                   WHERE artifact_type='module_candidate') AS candidates
                """
            ).fetchone()
        lines = [
            "# HELP case_generation_jobs_total Durable generation jobs.",
            "# TYPE case_generation_jobs_total gauge",
        ]
        for row in jobs:
            lines.append(
                "case_generation_jobs_total"
                f'{{status="{self._metric_label(row["status"])}",'
                f'domain="{self._metric_label(row["domain"])}",'
                f'provider="{self._metric_label(row["provider"])}"}} {row["count"]}'
            )
        lines.extend(
            [
                "# HELP case_generation_agent_runs_total Durable agent attempts.",
                "# TYPE case_generation_agent_runs_total gauge",
                "# HELP case_generation_agent_duration_seconds Accumulated agent duration.",
                "# TYPE case_generation_agent_duration_seconds gauge",
            ]
        )
        for row in runs:
            labels = (
                f'agent="{self._metric_label(row["agent_type"])}",'
                f'status="{self._metric_label(row["status"])}",'
                f'provider="{self._metric_label(row["provider"])}"'
            )
            lines.append(f"case_generation_agent_runs_total{{{labels}}} {row['count']}")
            lines.append(
                f"case_generation_agent_duration_seconds{{{labels}}} "
                f"{row['duration_ms'] / 1000:.6f}"
            )
        lines.extend(
            [
                "# HELP case_generation_patches_total Reviewable generation patches.",
                "# TYPE case_generation_patches_total gauge",
            ]
        )
        for row in patches:
            lines.append(
                "case_generation_patches_total"
                f'{{status="{self._metric_label(row["status"])}",'
                f'module="{self._metric_label(row["module_name"])}"}} {row["count"]}'
            )
        lines.extend(
            [
                "# HELP case_generation_repairs_total Targeted repair agent attempts.",
                "# TYPE case_generation_repairs_total gauge",
            ]
        )
        for row in repairs:
            lines.append(
                "case_generation_repairs_total"
                f'{{agent="targeted_repair",'
                f'error_code="{self._metric_label(row["error_code"])}"}} {row["count"]}'
            )
        candidates = coverage["candidates"] or 0
        ratio = min(1.0, (coverage["linked"] or 0) / candidates) if candidates else 0.0
        lines.extend(
            [
                "# HELP case_generation_evidence_coverage_ratio Candidate modules with evidence links.",
                "# TYPE case_generation_evidence_coverage_ratio gauge",
                f"case_generation_evidence_coverage_ratio {ratio:.6f}",
            ]
        )
        return "\n".join(lines) + "\n"

    def _run_pre_outline(self, job: dict[str, Any]) -> None:
        job_id = job["job_id"]
        self._stage(job_id, "snapshotting", 5)
        sources = self._sources(job_id)
        snapshot = self._run_agent(
            job,
            "source_snapshot",
            [],
            [],
            lambda: {"sources": sources, "sourceCount": len(sources)},
            "source_snapshot",
        )
        chunks = self._manual_chunks(sources)
        self._stage(job_id, "parsing_documents", 15)
        parsed = self._run_agent(
            job,
            "document_understanding",
            [snapshot["id"]],
            [],
            lambda: self.provider.parse_documents(chunks),
            "document_sections",
        )
        self._stage(job_id, "extracting_evidence", 25)
        evidence_artifact = self._run_agent(
            job,
            "evidence_extraction",
            [parsed["id"]],
            [],
            lambda: self.provider.extract_evidence(parsed["content"]["sections"]),
            "evidence_catalog",
        )
        evidence = evidence_artifact["content"]["evidence"]
        evidence = self._merge_retrieved_evidence(
            evidence,
            self._snapshot_evidence_items(sources),
        )
        if self.search_service is not None:
            search_result = self._unified_search(job, sources)
            retrieval = self._run_agent(
                job,
                "evidence_retrieval",
                [snapshot["id"]],
                [],
                lambda: search_result,
                "unified_evidence_search",
            )
            evidence = self._merge_retrieved_evidence(
                evidence,
                [
                    item for item in retrieval["content"]["items"]
                    if item.get("provider") == "manual"
                ],
            )
        final_evidence_artifact = self._run_agent(
            job,
            "evidence_consolidation",
            [evidence_artifact["id"]],
            [item["evidenceId"] for item in evidence],
            lambda: {"evidence": evidence, "evidenceCount": len(evidence)},
            "evidence_catalog_final",
        )
        self._stage(job_id, "classifying_domain", 32)
        options = load_json(job["options_json"], {})
        requested = job.get("template_id")
        if requested:
            template = self.templates.get(requested)
            scores = {requested: len(template["keywords"])}
        else:
            corpus = " ".join(
                [options.get("query", ""), *[item["claim"] for item in evidence]]
            )
            template, scores = self.templates.match(corpus)
        ranked_domains = sorted(scores, key=scores.get, reverse=True)
        confidence = 1.0 if requested else self._domain_confidence(scores)
        support_ids = [
            item["evidenceId"]
            for item in evidence
            if any(keyword.lower() in item["claim"].lower() for keyword in template["keywords"])
        ][:20]
        classification = self._run_agent(
            job,
            "fault_domain",
            [final_evidence_artifact["id"]],
            [item["evidenceId"] for item in evidence],
            lambda: {
                "selectedTemplateId": template["id"],
                "primaryFaultDomain": template["faultDomain"],
                "secondaryDomains": [
                    self.templates.get(item)["faultDomain"]
                    for item in ranked_domains[1:3] if scores[item] > 0
                ],
                "equipmentCategory": "industrial-computer",
                "supportEvidenceIds": support_ids,
                "excludedDomains": [
                    self.templates.get(item)["faultDomain"]
                    for item in ranked_domains if scores[item] == 0
                ],
                "unresolvedQuestions": (
                    ["现有证据不足以稳定判断故障领域，请专家选择模板"]
                    if confidence < 0.35 else []
                ),
                "templateRecommendation": template["id"],
                "scores": scores,
                "confidence": confidence,
            },
            "domain_classification",
        )
        if not requested and confidence < 0.35:
            with self.transaction() as db:
                db.execute(
                    """
                    UPDATE case_generation_jobs
                    SET status='awaiting_outline_review',current_stage='awaiting_domain_review',
                        progress=35,fault_domain=?,template_id=?,template_version=?,
                        lease_expires_at=NULL,updated_at=? WHERE job_id=?
                    """,
                    (
                        template["faultDomain"],
                        template["id"],
                        template["version"],
                        utc_now(),
                        job_id,
                    ),
                )
            return
        self._stage(job_id, "planning", 38)
        outline = self._run_agent(
            job,
            "case_planning",
            [classification["id"], final_evidence_artifact["id"]],
            [item["evidenceId"] for item in evidence],
            lambda: self.provider.plan(template, evidence),
            "case_outline",
        )
        with self.transaction() as db:
            db.execute(
                """
                UPDATE case_generation_jobs
                SET status='awaiting_outline_review',current_stage='awaiting_outline_review',
                    progress=40,fault_domain=?,template_id=?,template_version=?,
                    outline_status='awaiting_review',outline_artifact_id=?,
                    lease_expires_at=NULL,updated_at=?
                WHERE job_id=?
                """,
                (
                    template["faultDomain"],
                    template["id"],
                    template["version"],
                    outline["id"],
                    utc_now(),
                    job_id,
                ),
            )

    def _run_generation(self, job: dict[str, Any]) -> None:
        job_id = job["job_id"]
        draft = self.authoring.get_draft(job["draft_id"])
        template = self.templates.get(job["template_id"])
        evidence_artifact = self._latest_artifact(job_id, "evidence_catalog_final")
        evidence = evidence_artifact["content"]["evidence"]
        self._stage(job_id, "generating_modules", 50)
        generated = copy.deepcopy(draft["modules"])
        module_artifacts = {}
        requested_modules = set(load_json(job["options_json"], {}).get("generationRange") or AUTHORING_MODULES)
        dependency_waves = [
            ["registry", "manifest", "intake"],
            ["diagnosis", "guide"],
            ["assistant", "output", "feedbackAndGraph"],
        ]
        module_dependencies = {
            "diagnosis": ["manifest", "intake"],
            "guide": ["manifest", "diagnosis"],
            "assistant": ["guide"],
            "output": ["guide", "diagnosis"],
            "feedbackAndGraph": ["manifest", "diagnosis"],
        }
        completed_count = 0
        for wave in dependency_waves:
            names = [name for name in wave if name in requested_modules]
            with ThreadPoolExecutor(max_workers=min(3, max(1, len(names)))) as executor:
                futures = {
                    executor.submit(
                        self._run_agent,
                        job,
                        f"{name}_generator",
                        [
                            evidence_artifact["id"],
                            job["outline_artifact_id"],
                            *[
                                module_artifacts[dependency]["id"]
                                for dependency in module_dependencies.get(name, [])
                                if dependency in module_artifacts
                            ],
                        ],
                        [item["evidenceId"] for item in evidence[:20]],
                        lambda module=name: self.provider.generate_module(
                            module,
                            template,
                            draft,
                            evidence,
                            job_id,
                        ),
                        "module_candidate",
                        module_name=name,
                        evidence=evidence[:20],
                    ): name
                    for name in names
                }
                for future in as_completed(futures):
                    name = futures[future]
                    artifact = future.result()
                    generated[name] = artifact["content"]
                    module_artifacts[name] = artifact
                    completed_count += 1
            self._stage(
                job_id,
                "generating_modules",
                50 + int(completed_count / max(1, len(requested_modules)) * 20),
            )
        for name in AUTHORING_MODULES:
            if name not in module_artifacts:
                module_artifacts[name] = self._run_agent(
                    job,
                    f"{name}_preserved",
                    [],
                    [],
                    lambda module=name: generated[module],
                    "module_candidate",
                    module_name=name,
                    evidence=[],
                )
        routing_analysis = self._run_agent(
            job,
            "routing_conflict_analysis",
            [module_artifacts["registry"]["id"]],
            [],
            lambda: self._routing_analysis(generated["registry"]),
            "routing_analysis",
        )
        graph_analysis = self._run_agent(
            job,
            "graph_merge_analysis",
            [module_artifacts["feedbackAndGraph"]["id"]],
            [],
            lambda: self._graph_merge_analysis(generated["feedbackAndGraph"]),
            "graph_merge_candidates",
        )
        assistant_tests = self._run_agent(
            job,
            "assistant_contract_tests",
            [module_artifacts["guide"]["id"], module_artifacts["assistant"]["id"]],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: self._assistant_test_set(generated["assistant"]),
            "assistant_test_set",
        )
        diagnosis_reasoning = self._run_agent(
            job,
            "diagnosis_reasoning",
            [module_artifacts["diagnosis"]["id"], evidence_artifact["id"]],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: self._diagnosis_reasoning(generated, template, evidence),
            "diagnosis_reasoning",
        )
        output_trace = self._run_agent(
            job,
            "output_guide_trace",
            [module_artifacts["guide"]["id"], module_artifacts["output"]["id"]],
            [],
            lambda: self._output_guide_trace(generated),
            "output_guide_trace",
        )
        graph_claim_map = self._run_agent(
            job,
            "graph_claim_mapping",
            [module_artifacts["manifest"]["id"], module_artifacts["feedbackAndGraph"]["id"]],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: self._graph_claim_mapping(generated, evidence),
            "graph_claim_mapping",
        )
        self._stage(job_id, "criticizing", 73)
        critic = self._run_agent(
            job,
            "cross_module_critic",
            [
                *[item["id"] for item in module_artifacts.values()],
                routing_analysis["id"],
                graph_analysis["id"],
                assistant_tests["id"],
                diagnosis_reasoning["id"],
                output_trace["id"],
                graph_claim_map["id"],
            ],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: self._critic(generated, template, evidence),
            "critic_report",
        )
        self._persist_critic_evaluations(job_id, critic)
        self._stage(job_id, "validating", 78)
        validation_errors = [
            {
                "errorCode": item["ruleId"],
                "message": f"Cross-module critic: {item['ruleId']}",
                "module": None,
                "pointer": "",
                "allowedModules": list(AUTHORING_MODULES),
            }
            for item in critic["content"]["issues"]
            if item["severity"] == "error"
        ]
        package_hash = None
        try:
            package = self.authoring._validate_modules(generated)
            package_hash = package.package_hash
        except (CasePackageError, PlatformError) as exc:
            validation_errors.append(self._validation_error(exc))
        attempts = 0
        previous_error_fingerprint = None
        unchanged_error_rounds = 0
        while validation_errors and attempts < 3:
            attempts += 1
            self._stage(job_id, "repairing", 80 + attempts * 3)
            repair = self._run_agent(
                job,
                "targeted_repair",
                [critic["id"]],
                [],
                lambda current_attempt=attempts: self._repair_payload(
                    template,
                    draft,
                    generated,
                    validation_errors,
                    current_attempt,
                ),
                "repair_report",
                attempt=attempts,
            )
            generated = repair["content"]["modules"]
            for module_name in AUTHORING_MODULES:
                if generated[module_name] == module_artifacts[module_name]["content"]:
                    continue
                module_artifacts[module_name] = self._run_agent(
                    job,
                    f"targeted_repair_{module_name}",
                    [repair["id"], module_artifacts[module_name]["id"]],
                    [item["evidenceId"] for item in evidence[:20]],
                    lambda name=module_name: generated[name],
                    "module_candidate",
                    module_name=module_name,
                    evidence=evidence[:20],
                    attempt=attempts,
                )
            validation_errors = []
            try:
                package = self.authoring._validate_modules(generated)
                package_hash = package.package_hash
            except (CasePackageError, PlatformError) as exc:
                validation_errors.append(self._validation_error(exc))
            fingerprint = json_hash(validation_errors)
            if fingerprint == previous_error_fingerprint:
                unchanged_error_rounds += 1
            else:
                unchanged_error_rounds = 0
            previous_error_fingerprint = fingerprint
            if unchanged_error_rounds >= 1:
                break
        if validation_errors:
            with self.transaction() as db:
                for artifact in module_artifacts.values():
                    db.execute(
                        "UPDATE case_generation_artifacts SET schema_status='failed' WHERE artifact_id=?",
                        (artifact["id"],),
                    )
            raise PlatformError(
                "agent_output_schema_failed",
                validation_errors[0]["message"],
                422,
                {"errors": validation_errors},
            )
        patch_plan = self._run_agent(
            job,
            "patch_assembly",
            [item["id"] for item in module_artifacts.values()],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: {
                "baseRevision": draft["revision"],
                "patches": [
                    {
                        "module": module_name,
                        "candidateArtifactId": artifact["id"],
                        "operations": build_patch(
                            draft["modules"][module_name],
                            artifact["content"],
                        ),
                        "evidenceLinks": artifact.get("evidenceLinks", []),
                        "risk": (
                            "high"
                            if module_name in {"registry", "guide", "assistant"}
                            else "medium"
                        ),
                    }
                    for module_name, artifact in module_artifacts.items()
                    if build_patch(
                        draft["modules"][module_name],
                        artifact["content"],
                    )
                ],
            },
            "patch_plan",
        )
        with self.transaction() as db:
            for artifact in module_artifacts.values():
                db.execute(
                    "UPDATE case_generation_artifacts SET schema_status='passed' WHERE artifact_id=?",
                    (artifact["id"],),
                )
            db.execute(
                """
                INSERT INTO case_generation_evaluations
                (evaluation_id,job_id,evaluator_type,rule_id,severity,passed,
                 details_json,created_at)
                VALUES (?,?,'deterministic','case_package_registry','info',1,?,?)
                """,
                (
                    f"CGE-{uuid.uuid4().hex.upper()}",
                    job_id,
                    canonical_json({"packageSha256": package_hash}),
                    utc_now(),
                ),
            )
            patch_count = 0
            artifacts_by_id = {
                artifact["id"]: artifact for artifact in module_artifacts.values()
            }
            for planned in patch_plan["content"]["patches"]:
                module_name = planned["module"]
                artifact = artifacts_by_id[planned["candidateArtifactId"]]
                base_content = draft["modules"][module_name]
                operations = planned["operations"]
                db.execute(
                    """
                    INSERT INTO case_generation_patches
                    (patch_id,job_id,draft_id,module_name,base_revision,
                     base_content_sha256,candidate_artifact_id,operations_json,
                     evidence_links_json,risk,status,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,'proposed',?)
                    """,
                    (
                        f"CGP-{uuid.uuid4().hex.upper()}",
                        job_id,
                        draft["id"],
                        module_name,
                        draft["revision"],
                        json_hash(base_content),
                        artifact["id"],
                        canonical_json(operations),
                        canonical_json(planned["evidenceLinks"]),
                        planned["risk"],
                        utc_now(),
                    ),
                )
                patch_count += 1
            next_status = "awaiting_patch_review" if patch_count else "completed"
            db.execute(
                """
                UPDATE case_generation_jobs
                SET status=?,current_stage=?,
                    progress=?,lease_expires_at=NULL,completed_at=?,updated_at=?
                WHERE job_id=?
                """,
                (
                    next_status,
                    next_status,
                    90 if patch_count else 100,
                    None if patch_count else utc_now(),
                    utc_now(),
                    job_id,
                ),
            )

    def _run_agent(
        self,
        job: dict[str, Any],
        agent_type: str,
        input_artifact_ids: list[str],
        evidence_ids: list[str],
        callback: Callable[[], dict[str, Any]],
        artifact_type: str,
        *,
        module_name: str | None = None,
        evidence: list[dict[str, Any]] | None = None,
        attempt: int = 1,
    ) -> dict[str, Any]:
        for current_attempt in range(attempt, MAX_AGENT_ATTEMPTS + 1):
            try:
                return self._run_agent_attempt(
                    job,
                    agent_type,
                    input_artifact_ids,
                    evidence_ids,
                    callback,
                    artifact_type,
                    module_name=module_name,
                    evidence=evidence,
                    attempt=current_attempt,
                )
            except Exception as exc:
                if isinstance(exc, PlatformError) and exc.code == "generation_cancelled":
                    raise
                if current_attempt >= MAX_AGENT_ATTEMPTS:
                    with self.transaction() as db:
                        db.execute(
                            """
                            UPDATE case_generation_agent_runs
                            SET error_code='agent_attempt_exhausted',
                                error_message=substr(
                                  'attempt limit reached; ' || COALESCE(error_message,''),
                                  1,1000
                                )
                            WHERE agent_run_id=(
                              SELECT agent_run_id FROM case_generation_agent_runs
                              WHERE job_id=? AND agent_type=?
                              ORDER BY started_at DESC LIMIT 1
                            )
                            """,
                            (job["job_id"], agent_type),
                        )
                    raise
        raise AssertionError("agent retry loop exhausted without result")

    def _run_agent_attempt(
        self,
        job: dict[str, Any],
        agent_type: str,
        input_artifact_ids: list[str],
        evidence_ids: list[str],
        callback: Callable[[], dict[str, Any]],
        artifact_type: str,
        *,
        module_name: str | None = None,
        evidence: list[dict[str, Any]] | None = None,
        attempt: int = 1,
    ) -> dict[str, Any]:
        run_id = f"AGR-{uuid.uuid4().hex.upper()}"
        started = time.perf_counter()
        stamp = utc_now()
        input_sha256 = json_hash(
            {
                "inputArtifactIds": input_artifact_ids,
                "evidenceIds": evidence_ids,
                "templateId": job.get("template_id"),
                "templateVersion": job.get("template_version"),
            }
        )
        run_template_id = (
            f"{job.get('template_id')}.{module_name}"
            if job.get("template_id") and module_name
            else job.get("template_id")
        )
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_generation_agent_runs
                (agent_run_id,job_id,agent_type,agent_version,provider,
                 template_id,template_version,attempt,status,
                 input_artifact_ids_json,evidence_ids_json,warnings_json,
                 requires_expert_input_json,input_sha256,started_at)
                VALUES (?,?,?,?,?,?,?,?, 'running',?,?,?,?,?,?)
                """,
                (
                    run_id,
                    job["job_id"],
                    agent_type,
                    self.provider.agent_version,
                    self.provider.provider_id,
                    run_template_id,
                    job.get("template_version"),
                    attempt,
                    canonical_json(input_artifact_ids),
                    canonical_json(evidence_ids),
                    "[]",
                    "[]",
                    input_sha256,
                    stamp,
                ),
            )
        try:
            self._ensure_not_cancelled(job["job_id"])
            content = callback()
            self._ensure_not_cancelled(job["job_id"])
            usage = (
                self.provider.consume_usage()
                if hasattr(self.provider, "consume_usage")
                else None
            )
            if not isinstance(content, dict):
                raise ValueError("Agent output must be an object")
            self.templates.validate_artifact(artifact_type, content)
            if module_name and job.get("template_id"):
                forbidden = set(
                    self.templates.get(job["template_id"])["forbiddenAutomaticFields"]
                )
                generated_keys = self._nested_keys(content)
                violations = sorted(forbidden & generated_keys)
                if violations:
                    raise PlatformError(
                        "agent_output_schema_failed",
                        f"{module_name} 包含禁止自动生成字段：{violations}",
                        422,
                    )
            serialized = canonical_json(content)
            if len(serialized.encode("utf-8")) > MAX_ARTIFACT_BYTES:
                raise PlatformError(
                    "agent_output_too_large",
                    f"Agent 输出超过 {MAX_ARTIFACT_BYTES} 字节限制",
                    422,
                )
            artifact_id = f"ART-{uuid.uuid4().hex.upper()}"
            digest = json_hash(content)
            warnings = content.get("warnings") if isinstance(content.get("warnings"), list) else []
            expert = content.get("requiresExpertInput") if isinstance(content.get("requiresExpertInput"), list) else []
            links = []
            with self.transaction() as db:
                db.execute(
                    """
                    INSERT INTO case_generation_artifacts
                    (artifact_id,job_id,agent_run_id,artifact_type,module_name,
                     content_json,content_sha256,schema_status,created_at)
                    VALUES (?,?,?,?,?,?,?,'not_checked',?)
                    """,
                    (
                        artifact_id,
                        job["job_id"],
                        run_id,
                        artifact_type,
                        module_name,
                        serialized,
                        digest,
                        utc_now(),
                    ),
                )
                json_pointers = (
                    self._leaf_pointers(content)[:500]
                    if module_name
                    else self._evidence_pointers(module_name, artifact_type, content)
                )
                available_evidence = evidence or []
                for index, json_pointer in enumerate(json_pointers if module_name else []):
                    item = available_evidence[index % len(available_evidence)] if available_evidence else None
                    pending_id = f"pending:expert:{module_name}:{index + 1}"
                    link = {
                        "evidenceId": item["evidenceId"] if item else pending_id,
                        "jsonPointer": json_pointer,
                        "confidence": item["confidence"] if item else 0.0,
                        "reviewStatus": "pending",
                    }
                    links.append(link)
                    db.execute(
                        """
                        INSERT INTO case_generation_evidence_links
                        (link_id,artifact_id,module_name,json_pointer,evidence_id,
                         confidence,review_status,created_at)
                        VALUES (?,?,?,?,?,?,'pending',?)
                        """,
                        (
                            f"CGL-{uuid.uuid4().hex.upper()}",
                            artifact_id,
                            module_name or artifact_type,
                            json_pointer,
                            link["evidenceId"],
                            link["confidence"],
                            utc_now(),
                        ),
                    )
                if module_name and not available_evidence:
                    expert.append(f"{module_name} 缺少可引用证据，全部候选字段等待专家补充")
                duration = int((time.perf_counter() - started) * 1000)
                db.execute(
                    """
                    UPDATE case_generation_agent_runs
                    SET status='completed',output_artifact_id=?,output_sha256=?,
                        warnings_json=?,requires_expert_input_json=?,usage_json=?,duration_ms=?,
                        completed_at=? WHERE agent_run_id=?
                    """,
                    (
                        artifact_id,
                        digest,
                        canonical_json(warnings),
                        canonical_json(expert),
                        canonical_json(usage) if usage else None,
                        duration,
                        utc_now(),
                        run_id,
                    ),
                )
            LOGGER.info(
                json.dumps(
                    {
                        "event": "case_generation_agent_completed",
                        "jobId": job["job_id"],
                        "agentRunId": run_id,
                        "agent": agent_type,
                        "provider": self.provider.provider_id,
                        "attempt": attempt,
                        "durationMs": duration,
                        "outputSha256": digest,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            return {"id": artifact_id, "content": content, "sha256": digest, "evidenceLinks": links}
        except Exception as exc:
            error_code = self._agent_error_code(exc)
            with self.transaction() as db:
                db.execute(
                    """
                    UPDATE case_generation_agent_runs
                    SET status=?,error_code=?,
                        error_message=?,duration_ms=?,completed_at=?
                    WHERE agent_run_id=?
                    """,
                    (
                        "cancelled" if error_code == "generation_cancelled" else "failed",
                        error_code,
                        str(exc)[:1000],
                        int((time.perf_counter() - started) * 1000),
                        utc_now(),
                        run_id,
                    ),
                )
            LOGGER.warning(
                json.dumps(
                    {
                        "event": "case_generation_agent_failed",
                        "jobId": job["job_id"],
                        "agentRunId": run_id,
                        "agent": agent_type,
                        "provider": self.provider.provider_id,
                        "attempt": attempt,
                        "errorCode": error_code,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            raise

    def _ensure_not_cancelled(self, job_id):
        with self.connect() as db:
            row = self._job_row(db, job_id)
        if row["cancel_requested"] or row["status"] == "cancelled":
            raise PlatformError("generation_cancelled", "生成任务已取消", 409)

    def _insert_source(self, db, job_id: str, source: dict[str, Any], actor: dict[str, Any]) -> None:
        if not isinstance(source, dict):
            raise PlatformError("generation_source_invalid", "资料来源必须是对象", 422)
        source_type = source.get("type")
        resource_id = str(source.get("resourceId") or "").strip()
        if source_type not in {"manual", "case", "graph", "field"} or not resource_id:
            raise PlatformError("generation_source_invalid", "资料来源类型或 ID 无效", 422)
        snapshot, version, digest = self._source_snapshot(source_type, resource_id, source, actor)
        db.execute(
            """
            INSERT INTO case_generation_sources
            (source_id,job_id,source_type,resource_id,version,content_sha256,
             snapshot_json,created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                f"CGS-{uuid.uuid4().hex.upper()}",
                job_id,
                source_type,
                resource_id,
                version,
                digest,
                canonical_json(snapshot),
                utc_now(),
            ),
        )

    def _source_snapshot(
        self,
        source_type: str,
        resource_id: str,
        selection: dict[str, Any],
        actor: dict[str, Any],
    ):
        if source_type == "manual":
            document = self.manuals.get_document(resource_id)
            selected_pages = selection.get("pages") or []
            selected_chunks = selection.get("chunkIds") or []
            if not isinstance(selected_pages, list) or not all(
                isinstance(item, int) and 1 <= item <= document["pageCount"]
                for item in selected_pages
            ):
                raise PlatformError("generation_source_invalid", "手册页码选择无效", 422)
            if not isinstance(selected_chunks, list) or not all(
                isinstance(item, str) for item in selected_chunks
            ):
                raise PlatformError("generation_source_invalid", "手册 chunk 选择无效", 422)
            with self.connect() as db:
                available = [
                    dict(row)
                    for row in db.execute(
                        """
                        SELECT chunk_id,page_number,ordinal,content_sha256
                        FROM manual_chunks WHERE document_id=?
                        ORDER BY page_number,ordinal
                        """,
                        (resource_id,),
                    )
                ]
            available_ids = {item["chunk_id"] for item in available}
            if any(item not in available_ids for item in selected_chunks):
                raise PlatformError("generation_source_invalid", "手册 chunk 不属于所选文档", 422)
            if len(set(selected_pages)) > MAX_MANUAL_PAGES:
                raise PlatformError(
                    "generation_sources_limit",
                    f"单任务单文档最多选择 {MAX_MANUAL_PAGES} 页",
                    422,
                )
            included = [
                item for item in available
                if (not selected_pages or item["page_number"] in selected_pages)
                and (not selected_chunks or item["chunk_id"] in selected_chunks)
            ]
            allowed_pages = sorted({item["page_number"] for item in included})[:MAX_MANUAL_PAGES]
            included = [item for item in included if item["page_number"] in allowed_pages]
            snapshot = {
                "document": document,
                "selectedPages": sorted(set(selected_pages)) or sorted(
                    {item["page_number"] for item in included}
                ),
                "chunkIds": [item["chunk_id"] for item in included[:MAX_MANUAL_CHUNKS]],
                "chunkHashes": {
                    item["chunk_id"]: item["content_sha256"]
                    for item in included[:MAX_MANUAL_CHUNKS]
                },
            }
            return snapshot, str(document.get("version") or ""), document["sha256"]
        if source_type == "case":
            package = self.authoring.registry.get(resource_id)
            return {
                **package.public_summary(),
                "claims": copy.deepcopy(package.claims),
            }, package.package_version, package.package_hash
        if source_type == "graph":
            graph = self.graph.current_graph()
            if resource_id not in {"current", graph["versionId"]}:
                raise PlatformError("generation_source_not_found", "未找到图谱版本", 404)
            selected_nodes = selection.get("nodeIds") or []
            if not isinstance(selected_nodes, list):
                raise PlatformError("generation_source_invalid", "图谱节点选择无效", 422)
            node_ids = {item["id"] for item in graph["nodes"]}
            if any(item not in node_ids for item in selected_nodes):
                raise PlatformError("generation_source_invalid", "图谱节点不属于当前版本", 422)
            selected_node_values = [
                item for item in graph["nodes"]
                if not selected_nodes or item["id"] in selected_nodes
            ][:300]
            selected_node_ids = {item["id"] for item in selected_node_values}
            return {
                "versionId": graph["versionId"],
                "nodes": len(graph["nodes"]),
                "relations": len(graph["relations"]),
                "selectedNodeIds": selected_nodes,
                "selectedNodes": selected_node_values,
                "selectedRelations": [
                    item for item in graph["relations"]
                    if item["source"] in selected_node_ids or item["target"] in selected_node_ids
                ][:500],
            }, graph["versionId"], graph["sha256"]
        with self.connect() as db:
            row = db.execute("SELECT * FROM case_runs WHERE run_id=?", (resource_id,)).fetchone()
        if row is None:
            raise PlatformError("generation_source_not_found", "未找到现场运行", 404)
        if actor["role"] != "admin" and row["created_by"] != actor["id"]:
            raise PlatformError("role_forbidden", "不能读取其他用户的现场运行", 403)
        payload = load_json(row["payload"], {})
        facts = {
            "initialInput": payload.get("initialInput"),
            "intakeFacts": payload.get("intakeFacts"),
            "stepExecution": payload.get("stepExecution"),
            "snapshots": payload.get("snapshots"),
        }
        facts = self._redact_snapshot(facts)
        return {
            "runId": resource_id,
            "caseId": row["case_id"],
            "revision": row["revision"],
            "payloadHash": json_hash(payload),
            "facts": facts,
        }, str(row["revision"]), json_hash(payload)

    def _manual_chunks(self, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        manual_sources = [item for item in sources if item["type"] == "manual"]
        document_ids = [item["resourceId"] for item in manual_sources]
        if not document_ids:
            return []
        placeholders = ",".join("?" for _ in document_ids)
        with self.connect() as db:
            rows = db.execute(
                f"""
                SELECT c.chunk_id,c.document_id,c.page_number,c.content,
                       c.content_sha256,d.title
                FROM manual_chunks c JOIN manual_documents d ON d.document_id=c.document_id
                WHERE c.document_id IN ({placeholders})
                ORDER BY c.document_id,c.page_number,c.ordinal LIMIT ?
                """,
                [*document_ids, MAX_MANUAL_CHUNKS],
            ).fetchall()
        selections = {
            item["resourceId"]: set(item["snapshot"].get("chunkIds") or [])
            for item in manual_sources
        }
        expected_hashes = {
            item["resourceId"]: item["snapshot"].get("chunkHashes") or {}
            for item in manual_sources
        }
        rows = [
            row for row in rows
            if not selections[row["document_id"]]
            or row["chunk_id"] in selections[row["document_id"]]
        ]
        for row in rows:
            expected = expected_hashes[row["document_id"]].get(row["chunk_id"])
            if expected and expected != row["content_sha256"]:
                raise PlatformError(
                    "generation_source_changed",
                    "手册 chunk 在任务创建后发生变化，请创建新任务",
                    409,
                )
        chunks = []
        characters = 0
        for row in rows:
            text = str(row["content"] or "")
            remaining = MAX_INPUT_CHARACTERS - characters
            if remaining <= 0:
                break
            text = text[:remaining]
            chunks.append({
                "chunkId": row["chunk_id"],
                "documentId": row["document_id"],
                "pageNumber": row["page_number"],
                "text": text,
                "title": row["title"],
            })
            characters += len(text)
        return chunks

    def _claim(self, job_id: str | None):
        with self.transaction() as db:
            now = datetime.now(timezone.utc)
            clauses = [
                "cancel_requested=0",
                """status IN (
                    'created','snapshotting','parsing_documents',
                    'extracting_evidence','classifying_domain','planning',
                    'generating_modules','criticizing','validating','repairing'
                )""",
                "(lease_expires_at IS NULL OR lease_expires_at<?)",
            ]
            values: list[Any] = [now.isoformat()]
            if job_id:
                clauses.append("job_id=?")
                values.append(job_id)
            row = db.execute(
                f"SELECT * FROM case_generation_jobs WHERE {' AND '.join(clauses)} ORDER BY created_at LIMIT 1",
                values,
            ).fetchone()
            if row is None:
                return None
            db.execute(
                """
                UPDATE case_generation_jobs
                SET lease_expires_at=?,attempt=attempt+1,
                    started_at=COALESCE(started_at,?),updated_at=?
                WHERE job_id=?
                """,
                (
                    (now + timedelta(minutes=15)).isoformat(),
                    now.isoformat(),
                    now.isoformat(),
                    row["job_id"],
                ),
            )
        return dict(row)

    def _stage(self, job_id: str, stage: str, progress: int):
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            if row["cancel_requested"]:
                raise PlatformError("generation_cancelled", "生成任务已取消", 409)
            db.execute(
                """
                UPDATE case_generation_jobs SET status=?,current_stage=?,
                    progress=?,updated_at=? WHERE job_id=?
                """,
                (stage, stage, progress, utc_now(), job_id),
            )

    def _fail_job(self, job_id: str, code: str, message: str):
        with self.transaction() as db:
            db.execute(
                """
                UPDATE case_generation_jobs
                SET status='failed',current_stage='failed',progress=100,
                    failure_code=?,failure_summary=?,lease_expires_at=NULL,
                    completed_at=?,updated_at=? WHERE job_id=?
                """,
                (code, str(message)[:1000], utc_now(), utc_now(), job_id),
            )

    def _critic(self, modules, template, evidence):
        step_ids = {item["id"] for item in modules["guide"]["steps"]}
        topic_steps = {
            value
            for topic in modules["assistant"]["topics"]
            for value in topic["allowedStepIds"]
        }
        missing_steps = sorted(step_ids - topic_steps)
        issues = []
        if missing_steps:
            issues.append({"ruleId": "assistant_step_coverage", "severity": "error", "details": {"stepIds": missing_steps}})
        evidence_types = {item["type"] for item in evidence}
        for required in template["requiredEvidence"]:
            if required not in evidence_types:
                issues.append({"ruleId": "required_evidence", "severity": "warning", "details": {"type": required}})
        routing_terms = {
            str(value).lower()
            for values in modules["registry"]["matchRules"].values()
            if isinstance(values, list)
            for value in values
        }
        intake_text = canonical_json(modules["intake"]).lower()
        diagnosis_text = canonical_json(modules["diagnosis"]).lower()
        if not any(term in intake_text or term in diagnosis_text for term in routing_terms):
            issues.append({"ruleId": "routing_intake_diagnosis_alignment", "severity": "error", "details": {}})
        guide_claims = {
            claim for step in modules["guide"]["steps"] for claim in step["claimIds"]
        }
        diagnosis_claims = {
            item["claimId"] for item in modules["diagnosis"]["evidence"]
        }
        if not diagnosis_claims <= guide_claims:
            issues.append({
                "ruleId": "diagnosis_guide_coverage",
                "severity": "error",
                "details": {"missingClaimIds": sorted(diagnosis_claims - guide_claims)},
            })
        result_ids = {
            item["id"] for item in modules["output"]["engineerResultFields"]
        }
        referenced_result_ids = {
            field
            for section in modules["output"]["jobCard"]["sections"]
            for field in section["fieldIds"]
        }
        if result_ids != referenced_result_ids:
            issues.append({
                "ruleId": "output_field_coverage",
                "severity": "error",
                "details": {"unreferenced": sorted(result_ids - referenced_result_ids)},
            })
        relations = modules["feedbackAndGraph"]["graphProposal"]["relations"]
        allowed_relations = set(self.templates.contracts["relations"]["relations"])
        invalid_relations = sorted({
            item["relation"] for item in relations if item["relation"] not in allowed_relations
        })
        if invalid_relations:
            issues.append({
                "ruleId": "graph_relation_vocabulary",
                "severity": "error",
                "details": {"relations": invalid_relations},
            })
        if not evidence:
            issues.append({
                "ruleId": "claim_evidence_coverage",
                "severity": "warning",
                "details": {"requiresExpertInput": True},
            })
        return {"issues": issues, "passed": not any(item["severity"] == "error" for item in issues)}

    def _repair_payload(self, template, draft, modules, errors, attempt):
        repaired = self.provider.repair_modules(
            template,
            draft,
            modules,
            errors,
            attempt,
        )
        patches = {
            name: build_patch(modules[name], repaired[name])
            for name in AUTHORING_MODULES
            if modules[name] != repaired[name]
        }
        return {
            "attempt": attempt,
            "errors": errors,
            "allowedModules": sorted({
                module
                for item in errors
                for module in item.get("allowedModules", AUTHORING_MODULES)
            }),
            "patches": patches,
            "modules": repaired,
            "result": "repaired_without_new_evidence",
        }

    @staticmethod
    def _validation_error(error):
        code = getattr(error, "code", "case_validation_failed")
        message = getattr(error, "message", str(error))
        lowered = message.lower()
        module = next(
            (name for name in AUTHORING_MODULES if name.lower() in lowered),
            None,
        )
        pointer_match = re.search(r"(/[A-Za-z0-9_~./-]+)", message)
        pointer = pointer_match.group(1) if pointer_match else ""
        allowed = [module] if module else list(AUTHORING_MODULES)
        if code == "broken_reference":
            allowed = ["guide", "assistant", "manifest"]
        return {
            "errorCode": code,
            "message": message,
            "module": module,
            "pointer": pointer,
            "allowedModules": allowed,
        }

    def _routing_analysis(self, candidate):
        fields = ("equipmentExact", "equipmentGeneric", "alarms", "symptoms", "measurements", "contexts")
        candidate_terms = {
            self._normalize_term(item)
            for field in fields
            for item in candidate["matchRules"].get(field, [])
            if self._normalize_term(item)
        }
        overlaps = []
        router = DeterministicCaseRouter(self.authoring.registry)
        normalized_probe = router.normalize(" ".join(sorted(candidate_terms)))
        candidate_score = router._score_item(candidate, normalized_probe).score
        for package in self.authoring.registry.list_packages():
            if package.case_id == candidate["id"]:
                continue
            item = self.authoring.registry.registry_item(package.case_id)
            rules = item.get("matchRules") or {}
            terms = {
                self._normalize_term(value)
                for field in fields
                for value in rules.get(field, [])
                if self._normalize_term(value)
            }
            shared = sorted(candidate_terms & terms)
            union = candidate_terms | terms
            overlaps.append({
                "caseId": package.case_id,
                "sharedTerms": shared,
                "overlap": round(len(shared) / len(union), 4) if union else 0,
                "routeScore": router._score_item(item, normalized_probe).score,
            })
        overlaps.sort(key=lambda item: (-item["routeScore"], -item["overlap"], item["caseId"]))
        strongest_existing = overlaps[0]["routeScore"] if overlaps else 0
        return {
            "candidateTerms": sorted(candidate_terms),
            "candidateRouteScore": candidate_score,
            "cases": overlaps,
            "margin": candidate_score - strongest_existing,
            "routingAlgorithmVersion": router.algorithm_version,
            "globalWeightsModified": False,
        }

    def _graph_merge_analysis(self, module):
        current = self.graph.current_graph()
        existing = {
            self._normalize_term(item["label"]): item["id"]
            for item in current["nodes"]
        }
        candidates = []
        for node in module["graphProposal"]["nodes"]:
            normalized = self._normalize_term(node["name"])
            if normalized in existing:
                candidates.append({
                    "candidateNodeId": node["id"],
                    "existingNodeId": existing[normalized],
                    "reason": "normalized_label_equal",
                    "confidence": 1.0,
                })
        return {
            "baseGraphVersion": current["versionId"],
            "mergeCandidates": candidates,
            "candidateOnly": True,
        }

    @staticmethod
    def _assistant_test_set(module):
        tests = []
        for topic in module["topics"]:
            intents = topic["intents"]
            tests.extend(
                {
                    "topicId": topic["id"],
                    "stepId": step_id,
                    "utterance": utterance,
                    "expected": "match",
                }
                for step_id in topic["allowedStepIds"]
                for utterance in intents
            )
            tests.append({
                "topicId": topic["id"],
                "stepId": "other-step",
                "utterance": intents[0],
                "expected": "boundary_response",
            })
        return {
            "tests": tests,
            "coverage": {
                "positive": sum(item["expected"] == "match" for item in tests),
                "boundary": sum(item["expected"] == "boundary_response" for item in tests),
            },
        }

    @staticmethod
    def _diagnosis_reasoning(modules, template, evidence):
        causes = []
        for index, category in enumerate(template["causeCategories"]):
            supporting = evidence[index::len(template["causeCategories"])]
            causes.append({
                "category": category,
                "supportEvidenceIds": [item["evidenceId"] for item in supporting[:5]],
                "supportScore": round(
                    sum(float(item["confidence"]) for item in supporting[:5])
                    / max(1, len(supporting[:5])),
                    4,
                ),
                "expertHypothesis": not bool(supporting),
            })
        causes.sort(key=lambda item: (-item["supportScore"], item["category"]))
        conflicts = {}
        for item in evidence:
            if item.get("conflictGroup"):
                conflicts.setdefault(item["conflictGroup"], []).append(item["evidenceId"])
        telemetry = [
            {
                "fieldId": item["id"],
                "label": item["label"],
                "unit": item.get("unit"),
            }
            for item in modules["intake"]["fields"]
            if item["type"] == "number"
        ]
        return {
            "causeCandidates": causes,
            "requestedTelemetry": telemetry,
            "contradictoryEvidence": conflicts,
            "confidenceExplanation": "原因仅按来源证据置信度排序；无证据项保留为专家假设。",
            "finalConclusionAllowed": False,
        }

    @staticmethod
    def _output_guide_trace(modules):
        step_ids = [item["id"] for item in modules["guide"]["steps"]]
        return {
            "fieldMappings": [
                {
                    "resultFieldId": field["id"],
                    "producedByStepIds": step_ids,
                }
                for field in modules["output"]["engineerResultFields"]
            ],
            "pageCount": modules["output"]["jobCard"]["pageCount"],
            "operationInstructionsRepeated": False,
        }

    @staticmethod
    def _graph_claim_mapping(modules, evidence):
        claim_ids = [item["claimId"] for item in modules["manifest"]["claims"]]
        evidence_ids = [item["evidenceId"] for item in evidence[:20]]
        graph = modules["feedbackAndGraph"]["graphProposal"]
        return {
            "nodes": [
                {
                    "nodeId": item["id"],
                    "claimIds": claim_ids,
                    "evidenceIds": evidence_ids,
                }
                for item in graph["nodes"]
            ],
            "relations": [
                {
                    "relationId": item["id"],
                    "claimIds": claim_ids,
                    "evidenceIds": evidence_ids,
                }
                for item in graph["relations"]
            ],
        }

    @staticmethod
    def _normalize_term(value):
        return re.sub(r"\s+", "", str(value).strip().lower())

    def _persist_critic_evaluations(self, job_id, artifact):
        with self.transaction() as db:
            for item in artifact["content"]["issues"]:
                db.execute(
                    """
                    INSERT INTO case_generation_evaluations
                    (evaluation_id,job_id,artifact_id,evaluator_type,rule_id,
                     severity,passed,details_json,created_at)
                    VALUES (?,?,?,'agent_critic',?,?,0,?,?)
                    """,
                    (
                        f"CGE-{uuid.uuid4().hex.upper()}",
                        job_id,
                        artifact["id"],
                        item["ruleId"],
                        item["severity"],
                        canonical_json(item["details"]),
                        utc_now(),
                    ),
                )

    def _latest_artifact(self, job_id: str, artifact_type: str):
        with self.connect() as db:
            row = db.execute(
                """
                SELECT * FROM case_generation_artifacts
                WHERE job_id=? AND artifact_type=? ORDER BY created_at DESC LIMIT 1
                """,
                (job_id, artifact_type),
            ).fetchone()
        if row is None:
            raise PlatformError("generation_artifact_missing", "生成任务缺少必需 artifact", 500)
        return self._project_artifact(row, include_content=True)

    def _sources(self, job_id):
        with self.connect() as db:
            return [
                self._project_source(row)
                for row in db.execute(
                    "SELECT * FROM case_generation_sources WHERE job_id=? ORDER BY created_at",
                    (job_id,),
                )
            ]

    def _unified_search(self, job, sources):
        options = load_json(job["options_json"], {})
        scope = {"faultDomain": job.get("fault_domain")}
        for item in sources:
            if item["type"] == "manual" and "documentId" not in scope:
                scope["documentId"] = item["resourceId"]
            elif item["type"] == "case" and "caseId" not in scope:
                scope["caseId"] = item["resourceId"]
            elif item["type"] == "field" and "runId" not in scope:
                scope["runId"] = item["resourceId"]
        return self.search_service.search(
            options.get("query") or "工控机故障检修",
            scope,
            actor={
                "id": job["created_by"],
                "role": options.get("createdByRole") or "expert",
            },
            request_id=f"generation:{job['job_id']}",
            limit=30,
        )

    @staticmethod
    def _merge_retrieved_evidence(extracted, retrieved):
        merged = {item["excerptHash"]: item for item in extracted}
        for item in retrieved:
            excerpt = str(item.get("excerpt") or "").strip()
            if not excerpt:
                continue
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            if digest in merged:
                continue
            citation = item.get("citation") or {}
            provider = item.get("provider")
            merged[digest] = {
                "evidenceId": f"EVG-{digest[:20].upper()}",
                "type": "check" if provider in {"manual", "case"} else "verification",
                "claim": excerpt[:800],
                "documentId": citation.get("documentId"),
                "pages": [citation["page"]] if citation.get("page") else [],
                "locator": item.get("title"),
                "excerptHash": digest,
                "confidence": float(item.get("score") or 0.5),
                "verification": f"{provider}_retrieved",
                "citation": citation,
            }
        return list(merged.values())[:200]

    @staticmethod
    def _snapshot_evidence_items(sources):
        items = []
        for source in sources:
            snapshot = source["snapshot"]
            if source["type"] == "case":
                for claim in snapshot.get("claims") or []:
                    items.append({
                        "id": f"case:{source['resourceId']}:{claim['claimId']}",
                        "provider": "case",
                        "title": snapshot["identity"]["title"],
                        "excerpt": claim["text"],
                        "score": 0.9,
                        "citation": {
                            "type": "case_claim",
                            "caseId": source["resourceId"],
                            "claimId": claim["claimId"],
                            "packageHash": source["contentSha256"],
                        },
                    })
            elif source["type"] == "graph":
                for node in snapshot.get("selectedNodes") or []:
                    items.append({
                        "id": f"graph:node:{node['id']}",
                        "provider": "graph",
                        "title": node["label"],
                        "excerpt": canonical_json(node),
                        "score": 0.75,
                        "citation": {
                            "type": "graph_node",
                            "versionId": snapshot["versionId"],
                            "nodeId": node["id"],
                        },
                    })
            elif source["type"] == "field":
                for section, value in (snapshot.get("facts") or {}).items():
                    if value in (None, {}, []):
                        continue
                    items.append({
                        "id": f"field:{source['resourceId']}:{section}",
                        "provider": "field",
                        "title": f"{section} · {source['resourceId']}",
                        "excerpt": canonical_json(value)[:900],
                        "score": 0.9,
                        "citation": {
                            "type": "case_run",
                            "runId": source["resourceId"],
                            "section": section,
                            "revision": source["version"],
                        },
                    })
        return items

    @classmethod
    def _redact_snapshot(cls, value):
        blocked = {"password", "token", "authorization", "secret", "apikey", "api_key"}
        if isinstance(value, dict):
            return {
                key: cls._redact_snapshot(item)
                for key, item in value.items()
                if str(key).replace("_", "").lower() not in blocked
            }
        if isinstance(value, list):
            return [cls._redact_snapshot(item) for item in value[:200]]
        if isinstance(value, str):
            return value[:2000]
        return value

    def _refresh_patch_job_state(self, db, job_id):
        counts = {
            row["status"]: row["count"]
            for row in db.execute(
                "SELECT status,count(*) AS count FROM case_generation_patches WHERE job_id=? GROUP BY status",
                (job_id,),
            )
        }
        undecided = counts.get("proposed", 0) + counts.get("accepted", 0)
        if undecided == 0:
            status = "completed"
            progress = 100
            completed = utc_now()
        elif counts.get("applied", 0):
            status = "partially_applied"
            progress = 95
            completed = None
        else:
            status = "awaiting_patch_review"
            progress = 90
            completed = None
        db.execute(
            """
            UPDATE case_generation_jobs SET status=?,current_stage=?,progress=?,
                completed_at=?,updated_at=? WHERE job_id=?
            """,
            (status, status, progress, completed, utc_now(), job_id),
        )

    def _finalize_patch_review(self, job_id, actor):
        job = self.get_job(job_id, include_details=False)
        if job["status"] != "completed":
            return
        validation = self.authoring.validate(job["draftId"], actor)
        passed = validation["status"] == "passed"
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_generation_evaluations
                (evaluation_id,job_id,evaluator_type,rule_id,severity,passed,
                 details_json,created_at)
                VALUES (?,?,'deterministic','post_patch_case_validation',?,?,?,?)
                """,
                (
                    f"CGE-{uuid.uuid4().hex.upper()}",
                    job_id,
                    "info" if passed else "error",
                    1 if passed else 0,
                    canonical_json({
                        "validationId": validation["id"],
                        "status": validation["status"],
                        "errors": validation["errors"],
                        "packageSha256": validation.get("packageSha256"),
                    }),
                    utc_now(),
                ),
            )
            if not passed:
                db.execute(
                    """
                    UPDATE case_generation_jobs SET status='failed',current_stage='failed',
                        failure_code='post_patch_validation_failed',
                        failure_summary='选择性应用后的草稿未通过生产校验',
                        updated_at=? WHERE job_id=?
                    """,
                    (utc_now(), job_id),
                )

    @staticmethod
    def _evidence_pointers(module_name, artifact_type, content):
        """Return concrete claim-bearing JSON pointers for field-level provenance."""
        candidates = {
            "registry": ["/matchRules/alarms/0", "/matchRules/symptoms/0", "/matchRules/contexts/0"],
            "manifest": ["/claims/0/text", "/provenance/limitations/0"],
            "intake": ["/defaultDescription", "/fields/0/label", "/fields/1/label"],
            "diagnosis": ["/evidence/0/label", "/summary", "/direction"],
            "guide": ["/steps/0/description", "/steps/0/checks/0/label", "/steps/1/description"],
            "assistant": ["/topics/0/answer", "/topics/0/intents/0", "/fallback"],
            "output": ["/jobCard/sections/0/title", "/engineerResultFields/0/label"],
            "feedbackAndGraph": ["/knowledgeProposal/summary", "/graphProposal/nodes/0/name", "/graphProposal/relations/0/relation"],
        }
        valid_pointers = []
        for pointer in candidates.get(module_name, ["/summary"]):
            current = content
            valid = True
            for token in pointer.lstrip("/").split("/"):
                if isinstance(current, list) and token.isdigit() and int(token) < len(current):
                    current = current[int(token)]
                elif isinstance(current, dict) and token in current:
                    current = current[token]
                else:
                    valid = False
                    break
            if valid:
                valid_pointers.append(pointer)
        return valid_pointers or [""]

    @classmethod
    def _leaf_pointers(cls, value, pointer=""):
        if isinstance(value, dict):
            result = []
            for key in sorted(value):
                token = str(key).replace("~", "~0").replace("/", "~1")
                result.extend(cls._leaf_pointers(value[key], f"{pointer}/{token}"))
            return result
        if isinstance(value, list):
            result = []
            for index, item in enumerate(value):
                result.extend(cls._leaf_pointers(item, f"{pointer}/{index}"))
            return result
        return [pointer]

    @classmethod
    def _nested_keys(cls, value):
        if isinstance(value, dict):
            return set(value) | {
                nested
                for item in value.values()
                for nested in cls._nested_keys(item)
            }
        if isinstance(value, list):
            return {
                nested
                for item in value
                for nested in cls._nested_keys(item)
            }
        return set()

    @staticmethod
    def _domain_confidence(scores):
        ordered = sorted(scores.values(), reverse=True)
        if not ordered or ordered[0] == 0:
            return 0.0
        second = ordered[1] if len(ordered) > 1 else 0
        return round((ordered[0] - second + 1) / (ordered[0] + 1), 3)

    @staticmethod
    def _agent_error_code(error):
        if isinstance(error, PlatformError):
            allowed = {
                "agent_input_invalid",
                "agent_provider_unavailable",
                "agent_output_invalid_json",
                "agent_output_schema_failed",
                "agent_evidence_missing",
                "agent_timeout",
                "agent_attempt_exhausted",
                "generation_cancelled",
            }
            return error.code if error.code in allowed else "agent_output_schema_failed"
        if isinstance(error, TimeoutError):
            return "agent_timeout"
        if isinstance(error, OSError):
            return "agent_provider_unavailable"
        if isinstance(error, (ValueError, TypeError, json.JSONDecodeError)):
            return "agent_output_invalid_json"
        return "agent_output_invalid"

    @staticmethod
    def _metric_label(value):
        return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')

    @staticmethod
    def _job_row(db, job_id):
        row = db.execute("SELECT * FROM case_generation_jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise PlatformError("generation_job_not_found", "未找到案例生成任务", 404)
        return row

    @staticmethod
    def _patch_row(db, patch_id):
        row = db.execute("SELECT * FROM case_generation_patches WHERE patch_id=?", (patch_id,)).fetchone()
        if row is None:
            raise PlatformError("generation_patch_not_found", "未找到生成 Patch", 404)
        return row

    @staticmethod
    def _assert_job_actor(db, job_id, actor):
        row = db.execute(
            "SELECT created_by FROM case_generation_jobs WHERE job_id=?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise PlatformError("generation_job_not_found", "未找到案例生成任务", 404)
        if actor["role"] != "admin" and row["created_by"] != actor["id"]:
            raise PlatformError("role_forbidden", "不能操作其他专家的生成任务", 403)

    @staticmethod
    def _project_job(row):
        return {
            "id": row["job_id"],
            "draftId": row["draft_id"],
            "provider": row["provider"],
            "status": row["status"],
            "currentStage": row["current_stage"],
            "progress": row["progress"],
            "faultDomain": row["fault_domain"],
            "templateId": row["template_id"],
            "templateVersion": row["template_version"],
            "outlineStatus": row["outline_status"],
            "outlineArtifactId": row["outline_artifact_id"],
            "options": load_json(row["options_json"], {}),
            "cancelRequested": bool(row["cancel_requested"]),
            "attempt": row["attempt"],
            "failureCode": row["failure_code"],
            "failureSummary": row["failure_summary"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _project_source(row):
        return {
            "id": row["source_id"],
            "type": row["source_type"],
            "resourceId": row["resource_id"],
            "version": row["version"],
            "contentSha256": row["content_sha256"],
            "snapshot": load_json(row["snapshot_json"], {}),
            "createdAt": row["created_at"],
        }

    @staticmethod
    def _project_run(row):
        return {
            "id": row["agent_run_id"],
            "agentType": row["agent_type"],
            "agentVersion": row["agent_version"],
            "provider": row["provider"],
            "templateId": row["template_id"],
            "attempt": row["attempt"],
            "status": row["status"],
            "inputArtifactIds": load_json(row["input_artifact_ids_json"], []),
            "evidenceIds": load_json(row["evidence_ids_json"], []),
            "outputArtifactId": row["output_artifact_id"],
            "warnings": load_json(row["warnings_json"], []),
            "requiresExpertInput": load_json(row["requires_expert_input_json"], []),
            "inputSha256": row["input_sha256"],
            "outputSha256": row["output_sha256"],
            "tokenUsage": load_json(row["usage_json"], None),
            "durationMs": row["duration_ms"],
            "errorCode": row["error_code"],
            "errorMessage": row["error_message"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
        }

    @staticmethod
    def _project_artifact(row, include_content):
        value = {
            "id": row["artifact_id"],
            "agentRunId": row["agent_run_id"],
            "type": row["artifact_type"],
            "moduleName": row["module_name"],
            "contentSha256": row["content_sha256"],
            "schemaStatus": row["schema_status"],
            "createdAt": row["created_at"],
        }
        if include_content:
            value["content"] = load_json(row["content_json"], {})
        return value

    @staticmethod
    def _project_patch(row):
        return {
            "id": row["patch_id"],
            "jobId": row["job_id"],
            "draftId": row["draft_id"],
            "moduleName": row["module_name"],
            "baseRevision": row["base_revision"],
            "baseContentSha256": row["base_content_sha256"],
            "candidateArtifactId": row["candidate_artifact_id"],
            "operations": load_json(row["operations_json"], []),
            "selectedOperations": load_json(row["selected_operations_json"], None),
            "evidenceLinks": load_json(row["evidence_links_json"], []),
            "risk": row["risk"],
            "status": row["status"],
            "appliedRevision": row["applied_revision"],
            "decidedBy": row["decided_by"],
            "decidedAt": row["decided_at"],
            "createdAt": row["created_at"],
        }

    def _event_audit(self, db, action, job_id, actor, metadata, request_id=None):
        self.audit.record(
            action,
            "case_generation_job",
            actor_id=actor["id"],
            actor_role=actor["role"],
            resource_id=job_id,
            metadata=metadata,
            request_id=request_id,
            connection=db,
        )

    @staticmethod
    def _required(value, field):
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        return value.strip()
