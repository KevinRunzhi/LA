from __future__ import annotations

from copy import deepcopy
import json
from typing import Any
import uuid

from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

try:
    from ..case_package import CasePackageError, CasePackageRegistry
except ImportError:
    from case_package import CasePackageError, CasePackageRegistry

from .case_runs import CaseRunStore
from .contracts import CaseRunStatus, UserRole
from .errors import PlatformError, validation_error
from .knowledge import KnowledgeLifecycleService
from .providers import (
    AttachmentStore,
    DiagnosisProvider,
    KnowledgeSearchProvider,
    TelemetryProvider,
)
from .routing import DeterministicCaseRouter


def create_platform_blueprint(
    registry: CasePackageRegistry,
    run_store: CaseRunStore,
    router: DeterministicCaseRouter,
    diagnosis_provider: DiagnosisProvider,
    knowledge_service: KnowledgeLifecycleService,
    telemetry_provider: TelemetryProvider,
    knowledge_search_provider: KnowledgeSearchProvider,
    attachment_store: AttachmentStore,
) -> Blueprint:
    blueprint = Blueprint("case_platform", __name__, url_prefix="/api/platform")

    @blueprint.errorhandler(PlatformError)
    def handle_platform_error(error: PlatformError):
        return jsonify(error.to_dict()), error.status

    @blueprint.route("/cases", methods=["GET"])
    def list_cases():
        items = []
        registry_items = {item["id"]: item for item in registry.runnable_items()}
        for package in registry.list_packages():
            item = registry_items[package.case_id]
            items.append(
                {
                    **package.public_summary(),
                    "mode": item["mode"],
                    "faultCode": item["faultCode"],
                }
            )
        return _ok(
            {
                "registryVersion": registry.registry_version,
                "items": items,
                "loadErrors": [
                    {"caseId": case_id, "code": error.code}
                    for case_id, error in sorted(registry.load_errors.items())
                ],
            }
        )

    @blueprint.route("/system/capabilities", methods=["GET"])
    def platform_capabilities():
        return _ok(
            {
                "apiVersion": "1.2.0",
                "registryVersion": registry.registry_version,
                "runnableCaseCount": len(registry.runnable_items()),
                "providers": {
                    "diagnosis": diagnosis_provider.provider_id,
                    "telemetry": telemetry_provider.provider_id,
                    "knowledgeSearch": knowledge_search_provider.provider_id,
                    "attachment": attachment_store.provider_id,
                },
                "persistence": {
                    "engine": "sqlite",
                    "revisionControl": True,
                    "idempotency": True,
                    "eventLog": True,
                    "immutableSnapshots": True,
                },
                "knowledgeLifecycle": {
                    "expertReview": True,
                    "versionedKnowledge": True,
                    "graphVersionDelta": True,
                    "engineerSync": True,
                },
                "coreBusiness": {
                    "identitySessions": True,
                    "roleAuthorization": True,
                    "auditTrail": True,
                    "manualPdfIngestion": True,
                    "fullTextEvidenceSearch": True,
                    "governedGraphVersions": True,
                    "workOrders": True,
                    "serverSideJobCardPdf": True,
                },
                "platformOperations": {
                    "durableManualIngestion": True,
                    "multiSourceEvidenceSearch": True,
                    "searchTracePersistence": True,
                    "dataIntegrityRuns": True,
                    "auditExports": ["csv", "jsonl"],
                    "assetBackupCli": True,
                },
            }
        )

    @blueprint.route("/case-routing", methods=["POST"])
    def route_case():
        payload = _json_body()
        return _ok(router.route(payload).to_dict())

    @blueprint.route("/case-runs", methods=["POST"])
    def create_case_run():
        payload = _json_body()
        case_id = _required_string(payload, "caseId")
        idempotency_key = _required_string(payload, "idempotencyKey")
        actor = _actor(payload, UserRole.ENGINEER)
        try:
            package = registry.get(case_id)
        except CasePackageError as exc:
            status = 404 if exc.code == "case_not_found" else 422
            raise PlatformError(exc.code, exc.message, status) from exc
        initial_input = payload.get("input") or {}
        if not isinstance(initial_input, dict):
            raise validation_error("input 必须是对象", "input")
        run = run_store.create_run(
            package,
            actor["id"],
            idempotency_key,
            initial_input,
        )
        return _ok(_project_run(run.to_dict()), status=201)

    @blueprint.route("/case-runs/<run_id>", methods=["GET"])
    def get_case_run(run_id: str):
        role = _query_role()
        run = run_store.get(run_id)
        return _ok(_project_run(run.to_dict(), role))

    @blueprint.route("/case-runs/<run_id>/events", methods=["GET"])
    def get_case_run_events(run_id: str):
        _query_role()
        return _ok({"runId": run_id, "items": run_store.events(run_id)})

    @blueprint.route("/case-runs/<run_id>/intake/confirm", methods=["POST"])
    def confirm_intake(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        facts = payload.get("intakeFacts")
        if not isinstance(facts, dict) or not facts:
            raise validation_error("intakeFacts 必须是非空对象", "intakeFacts")

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["intakeFacts"] = facts
            return value

        run = run_store.transition(
            run_id,
            CaseRunStatus.INTAKE_CONFIRMED,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "intake_confirmed",
            {"intakeFacts": facts},
            update,
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/diagnosis", methods=["POST"])
    def diagnose(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        diagnosis = diagnosis_provider.diagnose(package, current.payload, payload)

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["snapshots"]["diagnosis"] = diagnosis
            return value

        run = run_store.transition(
            run_id,
            CaseRunStatus.DIAGNOSED,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "diagnosis_completed",
            {"provider": diagnosis["provider"]},
            update,
        )
        return _ok(
            {
                "run": _project_run(run.to_dict(), UserRole.ENGINEER),
                "diagnosis": diagnosis,
            }
        )

    @blueprint.route("/case-runs/<run_id>/plan/confirm", methods=["POST"])
    def confirm_plan(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        requested_plan = payload.get("plan")
        if requested_plan is not None and not isinstance(requested_plan, dict):
            raise validation_error("plan 必须是对象", "plan")
        plan = requested_plan or deepcopy(package.modules["guide"])

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["resolvedPlanSnapshot"] = {
                "packageHash": package.package_hash,
                "confirmedBy": actor["id"],
                "plan": plan,
            }
            return value

        run = run_store.transition(
            run_id,
            CaseRunStatus.PLAN_CONFIRMED,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "plan_confirmed",
            {"customized": requested_plan is not None},
            update,
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/guide/start", methods=["POST"])
    def start_guide(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        run = run_store.transition(
            run_id,
            CaseRunStatus.IN_PROGRESS,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "guide_started",
            {},
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/guide/steps", methods=["GET"])
    def guide_steps(run_id: str):
        role = _query_role()
        run = run_store.get(run_id)
        if run.status not in {
            CaseRunStatus.PLAN_CONFIRMED,
            CaseRunStatus.IN_PROGRESS,
            CaseRunStatus.ENGINEER_SUBMITTED,
            CaseRunStatus.EXPERT_REVIEWING,
            CaseRunStatus.APPROVED,
            CaseRunStatus.REJECTED,
            CaseRunStatus.PUBLISHED,
            CaseRunStatus.SYNCED,
        }:
            raise PlatformError(
                "state_conflict",
                "检修方案尚未确认",
                409,
                {"currentStatus": run.status},
            )
        plan_snapshot = run.payload.get("resolvedPlanSnapshot") or {}
        plan = plan_snapshot.get("plan") or _package_for_run(
            registry,
            run.case_id,
        ).modules["guide"]
        completed = run.payload.get("stepExecution", {})
        steps = [
            {
                **deepcopy(step),
                "execution": completed.get(step["id"]),
                "completed": step["id"] in completed,
            }
            for step in plan["steps"]
        ]
        if role == UserRole.EXPERT:
            return _ok({"runId": run_id, "revision": run.revision, "steps": steps})
        return _ok(
            {
                "runId": run_id,
                "revision": run.revision,
                "activeStepId": next(
                    (step["id"] for step in steps if not step["completed"]),
                    None,
                ),
                "steps": steps,
            }
        )

    @blueprint.route(
        "/case-runs/<run_id>/guide/steps/<step_id>/complete",
        methods=["POST"],
    )
    def complete_guide_step(run_id: str, step_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        plan_snapshot = current.payload.get("resolvedPlanSnapshot") or {}
        plan = plan_snapshot.get("plan") or package.modules["guide"]
        step = next((item for item in plan["steps"] if item["id"] == step_id), None)
        if step is None:
            raise PlatformError("step_not_found", "未找到检修步骤", 404)
        execution = payload.get("execution")
        if not isinstance(execution, dict):
            raise validation_error("execution 必须是对象", "execution")
        _validate_step_execution(step, execution)

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["stepExecution"][step_id] = execution
            return value

        run = run_store.update_in_progress(
            run_id,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            f"step_completed:{step_id}",
            {"stepId": step_id, "execution": execution},
            update,
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/records/generate", methods=["POST"])
    def generate_record(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        engineer_result = payload.get("engineerResult")
        if not isinstance(engineer_result, dict):
            raise validation_error("engineerResult 必须是对象", "engineerResult")
        _validate_engineer_result(package.modules["output"], engineer_result)
        record = {
            "recordId": f"REC-{run_id[4:]}",
            "runId": run_id,
            "caseId": current.case_id,
            "packageHash": current.package_hash,
            "engineerResult": engineer_result,
            "completedSteps": sorted(current.payload.get("stepExecution", {})),
            "jobCard": package.modules["output"]["jobCard"],
        }

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["snapshots"]["maintenanceRecord"] = record
            return value

        run = run_store.update_in_progress(
            run_id,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "maintenance_record_generated",
            {"recordId": record["recordId"]},
            update,
            run_store.snapshot_effect("job_card", record),
        )
        return _ok(
            {
                "run": _project_run(run.to_dict(), UserRole.ENGINEER),
                "record": record,
            }
        )

    @blueprint.route("/case-runs/<run_id>/engineer-submit", methods=["POST"])
    def submit_engineer_result(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        current = run_store.get(run_id)
        record = current.payload.get("snapshots", {}).get("maintenanceRecord")
        if not record:
            raise PlatformError(
                "state_conflict",
                "请先生成检修记录",
                409,
            )

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["snapshots"]["engineerSubmission"] = {
                "record": record,
                "submittedBy": actor["id"],
            }
            return value

        run = run_store.transition(
            run_id,
            CaseRunStatus.ENGINEER_SUBMITTED,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "engineer_submitted",
            {"recordId": record["recordId"]},
            update,
            run_store.snapshot_effect(
                "engineer_submission",
                {
                    "record": record,
                    "submittedBy": actor["id"],
                    "caseId": current.case_id,
                    "packageHash": current.package_hash,
                },
            ),
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/expert/review/start", methods=["POST"])
    def start_expert_review(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.EXPERT)
        run = run_store.transition(
            run_id,
            CaseRunStatus.EXPERT_REVIEWING,
            UserRole.EXPERT,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "expert_review_started",
            {},
        )
        return _ok(_project_run(run.to_dict(), UserRole.EXPERT))

    @blueprint.route("/case-runs/<run_id>/expert/review/decision", methods=["POST"])
    def decide_expert_review(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.EXPERT)
        decision = payload.get("decision")
        if decision not in {"approved", "rejected"}:
            raise validation_error(
                "decision 必须是 approved 或 rejected",
                "decision",
            )
        notes = payload.get("expertNotes") or {}
        if not isinstance(notes, dict):
            raise validation_error("expertNotes 必须是对象", "expertNotes")
        target = (
            CaseRunStatus.APPROVED
            if decision == "approved"
            else CaseRunStatus.REJECTED
        )
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        verification_level = package.provenance["defaultVerificationLevel"]

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["snapshots"]["expertReview"] = {
                "decision": decision,
                "reviewedBy": actor["id"],
                "notes": notes,
            }
            return value

        run = run_store.transition(
            run_id,
            target,
            UserRole.EXPERT,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            f"expert_review_{decision}",
            {"decision": decision},
            update,
            run_store.snapshot_effect(
                "expert_review",
                {
                    "decision": decision,
                    "reviewedBy": actor["id"],
                    "notes": notes,
                    "verificationLevel": verification_level,
                },
                reviewer_id=actor["id"],
                decision=decision,
                verification_level=verification_level,
            ),
        )
        return _ok(_project_run(run.to_dict(), UserRole.EXPERT))

    @blueprint.route("/case-runs/<run_id>/engineer-rework/start", methods=["POST"])
    def start_engineer_rework(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)

        def update(value: dict[str, Any]) -> dict[str, Any]:
            value["snapshots"]["reworkStarted"] = {
                "startedBy": actor["id"],
                "reason": payload.get("reason", ""),
            }
            return value

        run = run_store.transition(
            run_id,
            CaseRunStatus.IN_PROGRESS,
            UserRole.ENGINEER,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            "engineer_rework_started",
            {"reason": payload.get("reason", "")},
            update,
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    @blueprint.route("/case-runs/<run_id>/knowledge/publish", methods=["POST"])
    def publish_knowledge(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.EXPERT)
        current = run_store.get(run_id)
        package = _package_for_run(registry, current.case_id)
        candidate = package.modules["feedbackAndGraph"]
        knowledge = payload.get("knowledge") or candidate["knowledgeProposal"]
        graph = payload.get("graph") or candidate["graphProposal"]
        notes = payload.get("expertNotes") or {}
        if not all(isinstance(value, dict) for value in (knowledge, graph, notes)):
            raise validation_error("知识、图谱和专家说明必须是对象")
        published = knowledge_service.publish(
            run_id,
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
            actor["id"],
            knowledge,
            graph,
            notes,
        )
        return _ok(published)

    @blueprint.route("/knowledge/<knowledge_id>/sync", methods=["POST"])
    def sync_knowledge(knowledge_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        return _ok(knowledge_service.sync_latest(actor["id"], knowledge_id))

    @blueprint.route("/case-runs/<run_id>/telemetry/resolve", methods=["POST"])
    def resolve_telemetry(run_id: str):
        payload = _json_body()
        _actor(payload, UserRole.ENGINEER)
        run = run_store.get(run_id)
        requested_fields = payload.get("requestedFields")
        if (
            not isinstance(requested_fields, list)
            or not requested_fields
            or not all(isinstance(field, str) and field for field in requested_fields)
        ):
            raise validation_error(
                "requestedFields 必须是非空字符串数组",
                "requestedFields",
            )
        submitted = payload.get("submittedFacts") or run.payload.get(
            "intakeFacts",
            {},
        )
        if not isinstance(submitted, dict):
            raise validation_error("submittedFacts 必须是对象", "submittedFacts")
        equipment_id = str(
            payload.get("equipmentId")
            or _package_for_run(registry, run.case_id).identity["equipment"]["model"]
        )
        return _ok(
            telemetry_provider.read_facts(
                equipment_id,
                requested_fields,
                submitted,
            )
        )

    @blueprint.route("/case-runs/<run_id>/assistant/search", methods=["POST"])
    def search_current_step_knowledge(run_id: str):
        payload = _json_body()
        _actor(payload, UserRole.ENGINEER)
        run = run_store.get(run_id)
        package = _package_for_run(registry, run.case_id)
        step_id = _required_string(payload, "stepId")
        query = _required_string(payload, "query")
        step = next(
            (
                item
                for item in package.modules["guide"]["steps"]
                if item["id"] == step_id
            ),
            None,
        )
        if step is None:
            raise PlatformError("step_not_found", "未找到检修步骤", 404)
        topics = {
            topic["id"]: topic
            for topic in package.modules["assistant"]["topics"]
        }
        allowed_claim_ids: set[str] = set()
        for topic_id in step["assistantTopicIds"]:
            topic = topics[topic_id]
            if step_id in topic["allowedStepIds"]:
                allowed_claim_ids.update(topic["claimIds"])
        results = knowledge_search_provider.search(
            package,
            query,
            allowed_claim_ids,
        )
        return _ok(
            {
                "runId": run_id,
                "caseId": run.case_id,
                "stepId": step_id,
                "provider": knowledge_search_provider.provider_id,
                "allowedClaimIds": sorted(allowed_claim_ids),
                "results": results,
            }
        )

    @blueprint.route("/case-runs/<run_id>/attachments", methods=["GET"])
    def list_run_attachments(run_id: str):
        _query_role()
        return _ok({"runId": run_id, "items": run_store.attachments(run_id)})

    @blueprint.route("/case-runs/<run_id>/attachments", methods=["POST"])
    def upload_run_attachment(run_id: str):
        actor_id = request.form.get("actorId", "").strip()
        actor_role = request.form.get("actorRole", "").strip()
        if not actor_id:
            raise validation_error("actorId 不能为空", "actorId")
        if actor_role != UserRole.ENGINEER:
            raise PlatformError("role_forbidden", "只有工程师可以上传附件", 403)
        upload = request.files.get("file")
        if upload is None:
            raise validation_error("缺少 file 附件", "file")
        original_filename = (upload.filename or "").strip()
        if not original_filename:
            raise validation_error("附件文件名无效", "file")
        filename = secure_filename(original_filename) or "attachment.bin"
        metadata_text = request.form.get("metadata", "{}")
        try:
            metadata = json.loads(metadata_text)
        except json.JSONDecodeError as exc:
            raise validation_error("metadata 必须是 JSON 对象", "metadata") from exc
        if not isinstance(metadata, dict):
            raise validation_error("metadata 必须是 JSON 对象", "metadata")
        metadata = {**metadata, "originalFilename": original_filename}
        storage_key = f"{run_id}/{uuid.uuid4().hex}-{filename}"
        stored = attachment_store.put(storage_key, upload.read())
        try:
            attachment = run_store.register_attachment(
                run_id,
                actor_id,
                upload.mimetype or "application/octet-stream",
                stored,
                metadata,
            )
        except Exception:
            attachment_store.delete(storage_key)
            raise
        return _ok(attachment, status=201)

    @blueprint.route("/case-runs/<run_id>/reset", methods=["POST"])
    def reset_run(run_id: str):
        payload = _json_body()
        actor = _actor(payload, UserRole.ENGINEER)
        run = run_store.reset_run(
            run_id,
            actor["id"],
            _expected_revision(payload),
            _required_string(payload, "idempotencyKey"),
        )
        return _ok(_project_run(run.to_dict(), UserRole.ENGINEER))

    return blueprint


def _ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _json_body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise validation_error("请求体必须是 JSON 对象")
    return payload


def _required_string(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise validation_error(f"{field} 不能为空", field)
    return value.strip()


def _expected_revision(payload: dict[str, Any]) -> int:
    value = payload.get("expectedRevision")
    if not isinstance(value, int) or value < 1:
        raise validation_error(
            "expectedRevision 必须是正整数",
            "expectedRevision",
        )
    return value


def _actor(payload: dict[str, Any], expected_role: UserRole) -> dict[str, str]:
    actor = payload.get("actor")
    if not isinstance(actor, dict):
        raise validation_error("actor 必须是对象", "actor")
    actor_id = actor.get("id")
    role_value = actor.get("role")
    if not isinstance(actor_id, str) or not actor_id.strip():
        raise validation_error("actor.id 不能为空", "actor.id")
    try:
        role = UserRole(role_value)
    except ValueError as exc:
        raise validation_error("actor.role 不受支持", "actor.role") from exc
    if role != expected_role:
        raise PlatformError("role_forbidden", "当前接口不允许该角色操作", 403)
    return {"id": actor_id.strip(), "role": role}


def _query_role() -> UserRole:
    value = request.args.get("role", UserRole.ENGINEER)
    try:
        return UserRole(value)
    except ValueError as exc:
        raise validation_error("查询角色不受支持", "role") from exc


def _package_for_run(
    registry: CasePackageRegistry,
    case_id: str,
):
    try:
        return registry.get(case_id)
    except CasePackageError as exc:
        raise PlatformError("case_package_invalid", "运行绑定的案例包不可用", 422) from exc


def _project_run(
    value: dict[str, Any],
    role: UserRole = UserRole.ENGINEER,
) -> dict[str, Any]:
    payload = value["payload"]
    status = CaseRunStatus(value["status"])
    visible_payload: dict[str, Any] = {
        "initialInput": payload.get("initialInput", {}),
        "intakeFacts": payload.get("intakeFacts", {}),
    }
    if status not in {CaseRunStatus.CREATED, CaseRunStatus.INTAKE_CONFIRMED}:
        visible_payload["diagnosis"] = payload.get("snapshots", {}).get("diagnosis")
    if status not in {
        CaseRunStatus.CREATED,
        CaseRunStatus.INTAKE_CONFIRMED,
        CaseRunStatus.DIAGNOSED,
    }:
        visible_payload["resolvedPlanSnapshot"] = payload.get("resolvedPlanSnapshot")
        visible_payload["stepExecution"] = payload.get("stepExecution", {})
    if role in {UserRole.EXPERT, UserRole.ADMIN} and status in {
        CaseRunStatus.ENGINEER_SUBMITTED,
        CaseRunStatus.EXPERT_REVIEWING,
        CaseRunStatus.APPROVED,
        CaseRunStatus.REJECTED,
        CaseRunStatus.PUBLISHED,
        CaseRunStatus.SYNCED,
    }:
        visible_payload["snapshots"] = payload.get("snapshots", {})
    return {**value, "payload": visible_payload}


def _validate_step_execution(
    step: dict[str, Any],
    execution: dict[str, Any],
):
    checks = execution.get("checks")
    measurements = execution.get("measurements")
    if not isinstance(checks, dict):
        raise validation_error("execution.checks 必须是对象", "execution.checks")
    if not isinstance(measurements, dict):
        raise validation_error(
            "execution.measurements 必须是对象",
            "execution.measurements",
        )
    for check in step["checks"]:
        if check["required"] and checks.get(check["id"]) is not True:
            raise validation_error(
                f"必需检查项未确认：{check['label']}",
                f"execution.checks.{check['id']}",
            )
    for measurement in step["measurements"]:
        if measurement["required"] and measurement["id"] not in measurements:
            raise validation_error(
                f"必需测量未记录：{measurement['label']}",
                f"execution.measurements.{measurement['id']}",
            )


def _validate_engineer_result(
    output: dict[str, Any],
    result: dict[str, Any],
):
    allowed = {field["id"]: field for field in output["engineerResultFields"]}
    unknown = sorted(set(result) - set(allowed))
    if unknown:
        raise validation_error("工程师结果包含未知字段", unknown[0])
    for field_id, field in allowed.items():
        if field["required"] and result.get(field_id) in (None, ""):
            raise validation_error(
                f"缺少工程师结果：{field['label']}",
                field_id,
            )
