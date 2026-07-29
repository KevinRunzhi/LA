from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

try:
    from ..case_authoring.service import AUTHORING_MODULES, CaseAuthoringService
    from ..case_package import CasePackageError
    from ..case_platform.errors import PlatformError
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
    from .providers import StructuredLocalGenerationProvider
    from .templates import CaseGenerationTemplateRegistry
except ImportError:
    from case_authoring.service import AUTHORING_MODULES, CaseAuthoringService
    from case_package import CasePackageError
    from case_platform.errors import PlatformError
    from core_business.audit import AuditService
    from core_business.database import SQLiteService, canonical_json, json_hash, load_json, utc_now
    from core_business.graph import GovernedGraphService
    from core_business.manuals import ManualKnowledgeService
    from case_generation.providers import StructuredLocalGenerationProvider
    from case_generation.templates import CaseGenerationTemplateRegistry


FINAL_JOB_STATES = {"completed", "failed", "cancelled"}
MAX_SOURCE_COUNT = 30
MAX_MANUAL_CHUNKS = 500
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
        provider: StructuredLocalGenerationProvider | None = None,
    ):
        super().__init__(database_path)
        self.authoring = authoring
        self.manuals = manuals
        self.graph = graph
        self.templates = templates
        self.provider = provider or StructuredLocalGenerationProvider()
        self.audit = audit

    def create_job(
        self,
        payload: dict[str, Any],
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        draft_id = self._required(payload.get("draftId"), "draftId")
        draft = self.authoring.get_draft(draft_id)
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
        }
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
                self._insert_source(db, job_id, source)
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
        return value

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
            self._fail_job(claimed["job_id"], exc.code, exc.message)
        except (OSError, ValueError, sqlite3.Error) as exc:
            self._fail_job(claimed["job_id"], "generation_internal_error", str(exc))
        except Exception as exc:
            self._fail_job(claimed["job_id"], "generation_unexpected_error", str(exc))
        return self.get_job(claimed["job_id"])

    def approve_outline(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
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

    def decide_patch(self, patch_id: str, decision: str, actor: dict[str, Any]) -> dict[str, Any]:
        if decision not in {"accepted", "rejected"}:
            raise PlatformError("validation_error", "patch decision 无效", 422)
        with self.transaction() as db:
            row = self._patch_row(db, patch_id)
            if row["status"] != "proposed":
                raise PlatformError("generation_patch_state_conflict", "当前 Patch 已处理", 409)
            db.execute(
                """
                UPDATE case_generation_patches
                SET status=?,decided_by=?,decided_at=? WHERE patch_id=?
                """,
                (decision, actor["id"], utc_now(), patch_id),
            )
            self._refresh_patch_job_state(db, row["job_id"])
            self._event_audit(
                db,
                f"case_generation.patch_{decision}",
                row["job_id"],
                actor,
                {"patchId": patch_id, "module": row["module_name"]},
            )
        return self.get_patch(patch_id)

    def apply_patch(self, patch_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            patch = self._patch_row(db, patch_id)
            if patch["status"] != "accepted":
                raise PlatformError("generation_patch_state_conflict", "只有已接受 Patch 可以应用", 409)
            artifact = db.execute(
                "SELECT * FROM case_generation_artifacts WHERE artifact_id=?",
                (patch["candidate_artifact_id"],),
            ).fetchone()
        draft = self.authoring.get_draft(patch["draft_id"])
        current = draft["modules"][patch["module_name"]]
        if json_hash(current) != patch["base_content_sha256"]:
            with self.transaction() as db:
                db.execute(
                    "UPDATE case_generation_patches SET status='conflicted' WHERE patch_id=?",
                    (patch_id,),
                )
            raise PlatformError("revision_conflict", "目标模块在生成后已被修改", 409)
        updated = self.authoring.update_module(
            patch["draft_id"],
            patch["module_name"],
            load_json(artifact["content_json"], {}),
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
            self._refresh_patch_job_state(db, patch["job_id"])
            self._event_audit(
                db,
                "case_generation.patch_applied",
                patch["job_id"],
                actor,
                {"patchId": patch_id, "revision": updated["revision"]},
            )
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
        classification = self._run_agent(
            job,
            "fault_domain",
            [evidence_artifact["id"]],
            [item["evidenceId"] for item in evidence],
            lambda: {
                "selectedTemplateId": template["id"],
                "faultDomain": template["faultDomain"],
                "scores": scores,
                "confidence": self._domain_confidence(scores),
            },
            "domain_classification",
        )
        self._stage(job_id, "planning", 38)
        outline = self._run_agent(
            job,
            "case_planning",
            [classification["id"], evidence_artifact["id"]],
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
        evidence_artifact = self._latest_artifact(job_id, "evidence_catalog")
        evidence = evidence_artifact["content"]["evidence"]
        self._stage(job_id, "generating_modules", 50)
        generated = self.provider.generate_modules(template, draft, evidence, job_id)
        module_artifacts = {}
        for index, module_name in enumerate(AUTHORING_MODULES):
            artifact = self._run_agent(
                job,
                f"{module_name}_generator",
                [evidence_artifact["id"], job["outline_artifact_id"]],
                [item["evidenceId"] for item in evidence[:20]],
                lambda name=module_name: generated[name],
                "module_candidate",
                module_name=module_name,
                evidence=evidence[:20],
            )
            module_artifacts[module_name] = artifact
            self._stage(job_id, "generating_modules", 50 + int((index + 1) / 8 * 20))
        self._stage(job_id, "criticizing", 73)
        critic = self._run_agent(
            job,
            "cross_module_critic",
            [item["id"] for item in module_artifacts.values()],
            [item["evidenceId"] for item in evidence[:20]],
            lambda: self._critic(generated, template, evidence),
            "critic_report",
        )
        self._persist_critic_evaluations(job_id, critic)
        self._stage(job_id, "validating", 78)
        validation_errors = []
        package_hash = None
        try:
            package = self.authoring._validate_modules(generated)
            package_hash = package.package_hash
        except (CasePackageError, PlatformError) as exc:
            validation_errors.append(
                {"code": getattr(exc, "code", "case_validation_failed"), "message": getattr(exc, "message", str(exc))}
            )
        attempts = 0
        while validation_errors and attempts < 3:
            attempts += 1
            self._stage(job_id, "repairing", 80 + attempts * 3)
            repair = self._run_agent(
                job,
                "targeted_repair",
                [critic["id"]],
                [],
                lambda current_attempt=attempts: {
                    "attempt": attempts,
                    "errors": validation_errors,
                    "modules": self.provider.repair_modules(
                        template,
                        draft,
                        generated,
                        validation_errors,
                        current_attempt,
                    ),
                    "result": "repaired_without_new_evidence",
                },
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
                validation_errors.append(
                    {
                        "code": getattr(exc, "code", "case_validation_failed"),
                        "message": getattr(exc, "message", str(exc)),
                    }
                )
        if validation_errors:
            raise PlatformError(
                "agent_output_schema_failed",
                validation_errors[0]["message"],
                422,
                {"errors": validation_errors},
            )
        with self.transaction() as db:
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
            for module_name, artifact in module_artifacts.items():
                base_content = draft["modules"][module_name]
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
                        canonical_json([{"op": "replace", "path": "", "value": artifact["content"]}]),
                        canonical_json(artifact.get("evidenceLinks", [])),
                        "high" if module_name in {"registry", "guide", "assistant"} else "medium",
                        utc_now(),
                    ),
                )
            db.execute(
                """
                UPDATE case_generation_jobs
                SET status='awaiting_patch_review',current_stage='awaiting_patch_review',
                    progress=90,lease_expires_at=NULL,updated_at=?
                WHERE job_id=?
                """,
                (utc_now(), job_id),
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
            except Exception:
                if current_attempt >= MAX_AGENT_ATTEMPTS:
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
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_generation_agent_runs
                (agent_run_id,job_id,agent_type,agent_version,provider,
                 template_id,template_version,attempt,status,
                 input_artifact_ids_json,evidence_ids_json,warnings_json,
                 requires_expert_input_json,started_at)
                VALUES (?,?,?,?,?,?,?,?, 'running',?,?,?,?,?)
                """,
                (
                    run_id,
                    job["job_id"],
                    agent_type,
                    self.provider.agent_version,
                    self.provider.provider_id,
                    job.get("template_id"),
                    job.get("template_version"),
                    attempt,
                    canonical_json(input_artifact_ids),
                    canonical_json(evidence_ids),
                    "[]",
                    "[]",
                    stamp,
                ),
            )
        try:
            content = callback()
            if not isinstance(content, dict):
                raise ValueError("Agent output must be an object")
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
                json_pointer = self._evidence_pointer(module_name, artifact_type, content)
                for item in evidence or []:
                    link = {
                        "evidenceId": item["evidenceId"],
                        "jsonPointer": json_pointer,
                        "confidence": item["confidence"],
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
                            item["evidenceId"],
                            item["confidence"],
                            utc_now(),
                        ),
                    )
                duration = int((time.perf_counter() - started) * 1000)
                db.execute(
                    """
                    UPDATE case_generation_agent_runs
                    SET status='completed',output_artifact_id=?,output_sha256=?,
                        warnings_json=?,requires_expert_input_json=?,duration_ms=?,
                        completed_at=? WHERE agent_run_id=?
                    """,
                    (
                        artifact_id,
                        digest,
                        canonical_json(warnings),
                        canonical_json(expert),
                        duration,
                        utc_now(),
                        run_id,
                    ),
                )
            return {"id": artifact_id, "content": content, "sha256": digest, "evidenceLinks": links}
        except Exception as exc:
            error_code = self._agent_error_code(exc)
            with self.transaction() as db:
                db.execute(
                    """
                    UPDATE case_generation_agent_runs
                    SET status='failed',error_code=?,
                        error_message=?,duration_ms=?,completed_at=?
                    WHERE agent_run_id=?
                    """,
                    (
                        error_code,
                        str(exc)[:1000],
                        int((time.perf_counter() - started) * 1000),
                        utc_now(),
                        run_id,
                    ),
                )
            raise

    def _insert_source(self, db, job_id: str, source: dict[str, Any]) -> None:
        if not isinstance(source, dict):
            raise PlatformError("generation_source_invalid", "资料来源必须是对象", 422)
        source_type = source.get("type")
        resource_id = str(source.get("resourceId") or "").strip()
        if source_type not in {"manual", "case", "graph", "field"} or not resource_id:
            raise PlatformError("generation_source_invalid", "资料来源类型或 ID 无效", 422)
        snapshot, version, digest = self._source_snapshot(source_type, resource_id)
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

    def _source_snapshot(self, source_type: str, resource_id: str):
        if source_type == "manual":
            document = self.manuals.get_document(resource_id)
            return document, str(document.get("version") or ""), document["sha256"]
        if source_type == "case":
            package = self.authoring.registry.get(resource_id)
            return package.public_summary(), package.package_version, package.package_hash
        if source_type == "graph":
            graph = self.graph.current_graph()
            if resource_id not in {"current", graph["versionId"]}:
                raise PlatformError("generation_source_not_found", "未找到图谱版本", 404)
            return {"versionId": graph["versionId"], "nodes": len(graph["nodes"]), "relations": len(graph["relations"])}, graph["versionId"], graph["sha256"]
        with self.connect() as db:
            row = db.execute("SELECT * FROM case_runs WHERE run_id=?", (resource_id,)).fetchone()
        if row is None:
            raise PlatformError("generation_source_not_found", "未找到现场运行", 404)
        payload = load_json(row["payload"], {})
        return {"runId": resource_id, "caseId": row["case_id"], "revision": row["revision"], "payloadHash": json_hash(payload)}, str(row["revision"]), json_hash(payload)

    def _manual_chunks(self, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        document_ids = [item["resourceId"] for item in sources if item["type"] == "manual"]
        if not document_ids:
            return []
        placeholders = ",".join("?" for _ in document_ids)
        with self.connect() as db:
            rows = db.execute(
                f"""
                SELECT c.chunk_id,c.document_id,c.page_number,c.content,d.title
                FROM manual_chunks c JOIN manual_documents d ON d.document_id=c.document_id
                WHERE c.document_id IN ({placeholders})
                ORDER BY c.document_id,c.page_number,c.ordinal LIMIT ?
                """,
                [*document_ids, MAX_MANUAL_CHUNKS],
            ).fetchall()
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
        return {"issues": issues, "passed": not any(item["severity"] == "error" for item in issues)}

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

    @staticmethod
    def _evidence_pointer(module_name, artifact_type, content):
        """Point evidence at the first generated claim-bearing field, not the document root."""
        candidates = {
            "registry": ["/matchRules/symptoms/0", "/faultCode"],
            "manifest": ["/claims/0/text", "/identity/description"],
            "intake": ["/defaultDescription", "/fields/0"],
            "diagnosis": ["/evidence/0/label", "/rootCauses/0"],
            "guide": ["/steps/0/description", "/steps/0/title"],
            "assistant": ["/topics/0/answer", "/topics/0/title"],
            "output": ["/jobCard/sections/0", "/recordFields/0"],
            "feedbackAndGraph": ["/knowledgeProposal/summary", "/graphProposal/nodes/0"],
        }
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
                return pointer
        return f"/{artifact_type}"

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
            return error.code
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
