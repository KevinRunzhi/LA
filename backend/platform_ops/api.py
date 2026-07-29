from __future__ import annotations

from typing import Any

from flask import Blueprint, g, jsonify, request, send_file

try:
    from ..case_platform.errors import PlatformError
    from ..core_business.auth import IdentityService
    from .ingestion import IngestionService
    from .operations import PlatformOperationsService
    from .search import UnifiedKnowledgeSearchService
except ImportError:
    from case_platform.errors import PlatformError
    from core_business.auth import IdentityService
    from platform_ops.ingestion import IngestionService
    from platform_ops.operations import PlatformOperationsService
    from platform_ops.search import UnifiedKnowledgeSearchService


def create_platform_operations_blueprint(
    identity: IdentityService,
    ingestion: IngestionService,
    search: UnifiedKnowledgeSearchService,
    operations: PlatformOperationsService,
) -> Blueprint:
    blueprint = Blueprint("platform_operations", __name__, url_prefix="/api/platform")

    @blueprint.errorhandler(PlatformError)
    def handle_error(error):
        return jsonify(error.to_dict()), error.status

    @blueprint.get("/ingestion/jobs")
    def list_ingestion_jobs():
        _actor(identity, {"expert", "admin"})
        return _ok({"items": ingestion.list_jobs(_int_arg("limit", 50))})

    @blueprint.post("/ingestion/jobs")
    def create_ingestion_job():
        actor = _actor(identity, {"expert", "admin"})
        payload = _json()
        return _ok(
            ingestion.create_job(
                payload.get("sourceRoot", "Info"),
                actor=actor,
                dry_run=bool(payload.get("dryRun", False)),
                request_id=_request_id(),
            ),
            201,
        )

    @blueprint.get("/ingestion/jobs/<job_id>")
    def get_ingestion_job(job_id):
        _actor(identity, {"expert", "admin"})
        return _ok(ingestion.get_job(job_id))

    @blueprint.post("/ingestion/jobs/<job_id>/retry")
    def retry_ingestion_job(job_id):
        actor = _actor(identity, {"expert", "admin"})
        return _ok(ingestion.retry(job_id, actor))

    @blueprint.post("/ingestion/jobs/<job_id>/cancel")
    def cancel_ingestion_job(job_id):
        actor = _actor(identity, {"expert", "admin"})
        return _ok(ingestion.cancel(job_id, actor))

    @blueprint.post("/knowledge/search")
    def unified_search():
        actor = _actor(identity)
        payload = _json()
        return _ok(
            search.search(
                _required(payload, "query"),
                payload.get("scope") or {},
                actor=actor,
                request_id=_request_id(),
                limit=payload.get("limit", 12),
            )
        )

    @blueprint.get("/knowledge/search-runs")
    def search_runs():
        actor = _actor(identity)
        return _ok({"items": search.list_runs(actor, _int_arg("limit", 50))})

    @blueprint.get("/knowledge/search-runs/<search_run_id>")
    def search_run(search_run_id):
        actor = _actor(identity)
        return _ok(search.get_run(search_run_id, actor))

    @blueprint.post("/operations/integrity-runs")
    def run_integrity():
        actor = _actor(identity, {"admin"})
        return _ok(operations.integrity_run(actor), 201)

    @blueprint.get("/operations/integrity-runs")
    def integrity_runs():
        _actor(identity, {"admin"})
        return _ok({"items": operations.list_integrity_runs(_int_arg("limit", 50))})

    @blueprint.get("/operations/integrity-runs/<run_id>")
    def integrity_run(run_id):
        _actor(identity, {"admin"})
        return _ok(operations.get_integrity_run(run_id))

    @blueprint.post("/operations/audit-exports")
    def create_audit_export():
        actor = _actor(identity, {"admin"})
        payload = _json()
        return _ok(
            operations.export_audit(
                payload.get("format", "csv"),
                payload.get("filters") or {},
                actor,
            ),
            201,
        )

    @blueprint.get("/operations/audit-exports/<export_id>/download")
    def download_audit_export(export_id):
        _actor(identity, {"admin"})
        path, item = operations.export_path(export_id)
        return send_file(
            path,
            as_attachment=True,
            mimetype="text/csv" if item["format"] == "csv" else "application/x-ndjson",
            download_name=f"audit-{export_id}.{item['format']}",
            etag=item["sha256"],
        )

    return blueprint


def _actor(identity, roles=None):
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        raise PlatformError("authentication_required", "需要 Bearer 登录会话", 401)
    return identity.authenticate_token(
        header[7:].strip(),
        allowed_roles=set(roles) if roles else None,
    )


def _json():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise PlatformError("validation_error", "请求体必须是 JSON 对象", 422)
    return value


def _required(payload, field):
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise PlatformError("validation_error", f"{field} 不能为空", 422)
    return value.strip()


def _int_arg(name, default):
    try:
        return int(request.args.get(name, default))
    except ValueError as exc:
        raise PlatformError("validation_error", f"{name} 必须是整数", 422) from exc


def _request_id():
    return getattr(g, "request_id", None)


def _ok(data: Any, status=200):
    return jsonify({"ok": True, "data": data}), status
