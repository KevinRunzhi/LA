from __future__ import annotations

from flask import Blueprint, g, jsonify, request

try:
    from ..case_platform.errors import PlatformError
    from ..core_business.auth import IdentityService
    from .service import CaseAuthoringService
except ImportError:
    from case_platform.errors import PlatformError
    from core_business.auth import IdentityService
    from case_authoring.service import CaseAuthoringService


def create_case_authoring_blueprint(
    identity: IdentityService,
    service: CaseAuthoringService,
) -> Blueprint:
    blueprint = Blueprint("case_authoring", __name__, url_prefix="/api/platform/case-authoring")

    @blueprint.errorhandler(PlatformError)
    def handle_error(error):
        return jsonify(error.to_dict()), error.status

    @blueprint.get("/catalog")
    def catalog():
        _actor(identity)
        return _ok(service.catalog())

    @blueprint.get("/drafts")
    def drafts():
        _actor(identity)
        return _ok({"items": service.list_drafts(_int_arg("limit", 100))})

    @blueprint.post("/drafts")
    def create_draft():
        actor = _actor(identity)
        return _ok(service.create_draft(_json(), actor, _request_id()), 201)

    @blueprint.get("/drafts/<draft_id>")
    def get_draft(draft_id):
        _actor(identity)
        return _ok(service.get_draft(draft_id))

    @blueprint.patch("/drafts/<draft_id>/modules/<module_name>")
    def update_module(draft_id, module_name):
        actor = _actor(identity)
        payload = _json()
        return _ok(
            service.update_module(
                draft_id,
                module_name,
                payload.get("content"),
                _required_int(payload, "revision"),
                actor,
            )
        )

    @blueprint.post("/drafts/<draft_id>/validate")
    def validate(draft_id):
        return _ok(service.validate(draft_id, _actor(identity)), 201)

    @blueprint.post("/drafts/<draft_id>/submit")
    def submit(draft_id):
        actor = _actor(identity)
        return _ok(service.submit(draft_id, _required_int(_json(), "revision"), actor))

    @blueprint.post("/drafts/<draft_id>/review")
    def review(draft_id):
        actor = _actor(identity)
        payload = _json()
        return _ok(
            service.review(
                draft_id,
                _required_string(payload, "decision"),
                str(payload.get("notes") or ""),
                actor,
            )
        )

    @blueprint.post("/drafts/<draft_id>/publish")
    def publish(draft_id):
        actor = _actor(identity)
        return _ok(
            service.publish(draft_id, _required_string(_json(), "version"), actor),
            201,
        )

    @blueprint.post("/drafts/<draft_id>/suggestions")
    def suggestion(draft_id):
        actor = _actor(identity)
        payload = _json()
        return _ok(
            service.create_suggestion(
                draft_id,
                _required_string(payload, "targetModule"),
                _required_string(payload, "query"),
                actor,
            ),
            201,
        )

    @blueprint.get("/releases")
    def releases():
        _actor(identity)
        return _ok({"items": service.list_releases(_int_arg("limit", 100))})

    @blueprint.post("/releases/<release_id>/activate")
    def activate(release_id):
        return _ok(service.activate(release_id, _actor(identity)))

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


def _required_string(payload, field):
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise PlatformError("validation_error", f"{field} 不能为空", 422)
    return value.strip()


def _required_int(payload, field):
    value = payload.get(field)
    if not isinstance(value, int):
        raise PlatformError("validation_error", f"{field} 必须是整数", 422)
    return value


def _int_arg(name, default):
    try:
        return int(request.args.get(name, default))
    except ValueError as exc:
        raise PlatformError("validation_error", f"{name} 必须是整数", 422) from exc


def _request_id():
    return getattr(g, "request_id", None)


def _ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status
