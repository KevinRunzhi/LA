from __future__ import annotations

from flask import Blueprint, jsonify, request

try:
    from ..case_platform.errors import PlatformError
    from ..core_business.auth import IdentityService
    from .orchestrator import CaseGenerationService
    from .templates import CaseGenerationTemplateRegistry
except ImportError:
    from case_platform.errors import PlatformError
    from core_business.auth import IdentityService
    from case_generation.orchestrator import CaseGenerationService
    from case_generation.templates import CaseGenerationTemplateRegistry


def create_case_generation_blueprint(
    identity: IdentityService,
    service: CaseGenerationService,
    templates: CaseGenerationTemplateRegistry,
) -> Blueprint:
    blueprint = Blueprint("case_generation", __name__, url_prefix="/api/platform/case-generation")

    @blueprint.errorhandler(PlatformError)
    def handle_error(error):
        return jsonify(error.to_dict()), error.status

    @blueprint.get("/templates")
    def list_templates():
        _actor(identity)
        return _ok({
            "registryVersion": templates.registry_version,
            "agentContractVersion": templates.contracts["agent"]["schemaVersion"],
            "items": templates.list(),
        })

    @blueprint.get("/jobs")
    def list_jobs():
        actor = _actor(identity)
        return _ok({"items": service.list_jobs(actor, _int_arg("limit", 100))})

    @blueprint.post("/jobs")
    def create_job():
        actor = _actor(identity)
        return _ok(service.create_job(_json(), actor), 201)

    @blueprint.get("/jobs/<job_id>")
    def get_job(job_id):
        _actor(identity)
        return _ok(service.get_job(job_id))

    @blueprint.post("/jobs/<job_id>/run")
    def run_job(job_id):
        _actor(identity)
        result = service.process_once(job_id)
        if result is None:
            raise PlatformError("generation_job_not_runnable", "当前任务无需 worker 处理", 409)
        return _ok(result)

    @blueprint.post("/jobs/<job_id>/cancel")
    def cancel_job(job_id):
        return _ok(service.cancel(job_id, _actor(identity)))

    @blueprint.post("/jobs/<job_id>/outline/approve")
    def approve_outline(job_id):
        return _ok(service.approve_outline(job_id, _actor(identity)))

    @blueprint.post("/jobs/<job_id>/outline/reject")
    def reject_outline(job_id):
        payload = _json()
        return _ok(service.reject_outline(job_id, str(payload.get("notes") or ""), _actor(identity)))

    @blueprint.get("/jobs/<job_id>/artifacts")
    def artifacts(job_id):
        _actor(identity)
        return _ok({"items": service.get_artifacts(job_id)})

    @blueprint.get("/jobs/<job_id>/agent-runs")
    def agent_runs(job_id):
        _actor(identity)
        return _ok({"items": service.get_agent_runs(job_id)})

    @blueprint.get("/jobs/<job_id>/patches")
    def patches(job_id):
        _actor(identity)
        return _ok({"items": service.get_patches(job_id)})

    @blueprint.post("/patches/<patch_id>/accept")
    def accept_patch(patch_id):
        return _ok(service.decide_patch(patch_id, "accepted", _actor(identity)))

    @blueprint.post("/patches/<patch_id>/reject")
    def reject_patch(patch_id):
        return _ok(service.decide_patch(patch_id, "rejected", _actor(identity)))

    @blueprint.post("/patches/<patch_id>/apply")
    def apply_patch(patch_id):
        return _ok(service.apply_patch(patch_id, _actor(identity)))

    return blueprint


def _actor(identity):
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        raise PlatformError("authentication_required", "需要 Bearer 登录会话", 401)
    return identity.authenticate_token(
        header[7:].strip(),
        allowed_roles={"expert", "admin"},
    )


def _json():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise PlatformError("validation_error", "请求体必须是 JSON 对象", 422)
    return value


def _int_arg(name, default):
    try:
        return int(request.args.get(name, default))
    except ValueError as exc:
        raise PlatformError("validation_error", f"{name} 必须是整数", 422) from exc


def _ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status
