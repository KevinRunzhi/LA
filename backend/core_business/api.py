from __future__ import annotations

import json
from typing import Any, Iterable

from flask import Blueprint, g, jsonify, request, send_file

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .audit import AuditService
from .auth import IdentityService
from .graph import GovernedGraphService
from .manuals import ManualKnowledgeService
from .work_orders import WorkOrderService


def create_core_business_blueprint(
    identity: IdentityService,
    audit: AuditService,
    manuals: ManualKnowledgeService,
    graph: GovernedGraphService,
    work_orders: WorkOrderService,
) -> Blueprint:
    blueprint = Blueprint(
        "core_business",
        __name__,
        url_prefix="/api/platform",
    )

    @blueprint.errorhandler(PlatformError)
    def handle_platform_error(error: PlatformError):
        return jsonify(error.to_dict()), error.status

    @blueprint.post("/auth/login")
    def login():
        payload = _json()
        result = identity.login(
            _required(payload, "account"),
            _required(payload, "password"),
            client_ip=request.remote_addr,
            user_agent=request.headers.get("User-Agent"),
            request_id=_request_id(),
        )
        return _ok(result)

    @blueprint.get("/auth/me")
    def me():
        return _ok(_actor(identity))

    @blueprint.post("/auth/logout")
    def logout():
        token = _bearer_token()
        actor = identity.authenticate_token(token)
        identity.logout(token, actor, request_id=_request_id())
        return _ok({"loggedOut": True})

    @blueprint.get("/admin/users")
    def list_users():
        _actor(identity, {"admin"})
        return _ok(
            identity.list_users(
                role=request.args.get("role"),
                status=request.args.get("status"),
                query=request.args.get("query"),
                page=_query_int("page", 1),
                page_size=_query_int("pageSize", 50),
            )
        )

    @blueprint.post("/admin/users")
    def create_user():
        actor = _actor(identity, {"admin"})
        payload = _json()
        result = identity.create_user(
            account=_required(payload, "account"),
            display_name=_required(payload, "displayName"),
            role=_required(payload, "role"),
            password=_required(payload, "password"),
            profile=payload.get("profile"),
            created_by=actor["id"],
            request_id=_request_id(),
        )
        return _ok(result, 201)

    @blueprint.patch("/admin/users/<user_id>")
    def update_user(user_id: str):
        actor = _actor(identity, {"admin"})
        return _ok(
            identity.update_user(
                user_id,
                _json(),
                actor_id=actor["id"],
                request_id=_request_id(),
            )
        )

    @blueprint.post("/admin/users/<user_id>/password")
    def reset_password(user_id: str):
        actor = _actor(identity, {"admin"})
        payload = _json()
        identity.reset_password(
            user_id,
            _required(payload, "newPassword"),
            actor_id=actor["id"],
            request_id=_request_id(),
        )
        return _ok({"userId": user_id, "sessionsRevoked": True})

    @blueprint.get("/admin/audit-events")
    def audit_events():
        _actor(identity, {"admin"})
        return _ok(
            audit.query(
                actor_id=request.args.get("actorId"),
                action=request.args.get("action"),
                resource_type=request.args.get("resourceType"),
                outcome=request.args.get("outcome"),
                page=_query_int("page", 1),
                page_size=_query_int("pageSize", 50),
            )
        )

    @blueprint.get("/manuals")
    def list_manuals():
        _actor(identity)
        return _ok(
            manuals.list_documents(
                status=request.args.get("status", "active"),
                vendor=request.args.get("vendor"),
                equipment_type=request.args.get("equipmentType"),
                page=_query_int("page", 1),
                page_size=_query_int("pageSize", 50),
            )
        )

    @blueprint.post("/manuals/import")
    def import_manual():
        actor = _actor(identity, {"expert", "admin"})
        upload = request.files.get("file")
        if upload is None:
            raise PlatformError("validation_error", "缺少 file PDF", 422)
        metadata = _form_json("metadata")
        return _ok(
            manuals.import_pdf(
                upload.read(),
                upload.filename or "manual.pdf",
                metadata,
                actor=actor,
                request_id=_request_id(),
            ),
            201,
        )

    @blueprint.get("/manuals/<document_id>")
    def get_manual(document_id: str):
        _actor(identity)
        return _ok(manuals.get_document(document_id))

    @blueprint.post("/manuals/search")
    def search_manuals():
        _actor(identity)
        payload = _json()
        return _ok(
            manuals.search(
                _required(payload, "query"),
                document_id=payload.get("documentId"),
                vendor=payload.get("vendor"),
                equipment_type=payload.get("equipmentType"),
                fault_domain=payload.get("faultDomain"),
                limit=payload.get("limit", 10),
            )
        )

    @blueprint.delete("/manuals/<document_id>")
    def delete_manual(document_id: str):
        actor = _actor(identity, {"expert", "admin"})
        manuals.delete(document_id, actor=actor, request_id=_request_id())
        return _ok({"documentId": document_id, "deleted": True})

    @blueprint.post("/manuals/<document_id>/reindex")
    def reindex_manual(document_id: str):
        actor = _actor(identity, {"expert", "admin"})
        return _ok(
            manuals.reindex(
                document_id,
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.get("/graph")
    def current_graph():
        _actor(identity)
        return _ok(graph.current_graph())

    @blueprint.get("/graph/subgraph")
    def graph_subgraph():
        _actor(identity)
        types = {
            item.strip()
            for item in request.args.get("nodeTypes", "").split(",")
            if item.strip()
        }
        return _ok(
            graph.subgraph(
                request.args.get("centerId", ""),
                depth=_query_int("depth", 1),
                node_types=types or None,
            )
        )

    @blueprint.get("/graph/versions")
    def graph_versions():
        _actor(identity)
        return _ok({"items": graph.versions(_query_int("limit", 50))})

    @blueprint.get("/graph/versions/<version_id>")
    def graph_version(version_id: str):
        _actor(identity)
        return _ok(graph.get_version(version_id))

    @blueprint.get("/graph/diff")
    def graph_diff():
        _actor(identity)
        return _ok(
            graph.diff(
                request.args.get("fromVersionId", ""),
                request.args.get("toVersionId") or None,
            )
        )

    @blueprint.get("/graph/change-sets")
    def graph_change_sets():
        actor = _actor(identity)
        created_by = request.args.get("createdBy")
        if actor["role"] == "engineer":
            created_by = actor["id"]
        return _ok(
            {
                "items": graph.list_change_sets(
                    status=request.args.get("status"),
                    created_by=created_by,
                    limit=_query_int("limit", 100),
                )
            }
        )

    @blueprint.post("/graph/change-sets")
    def create_graph_change_set():
        actor = _actor(identity)
        payload = _json()
        return _ok(
            graph.create_change_set(
                _required(payload, "title"),
                payload.get("description", ""),
                actor=actor,
                case_run_id=payload.get("caseRunId"),
                request_id=_request_id(),
            ),
            201,
        )

    @blueprint.get("/graph/change-sets/<change_set_id>")
    def get_graph_change_set(change_set_id: str):
        actor = _actor(identity)
        result = graph.get_change_set(change_set_id)
        if actor["role"] == "engineer" and result["createdBy"] != actor["id"]:
            raise PlatformError("role_forbidden", "不能查看其他工程师的草稿", 403)
        return _ok(result)

    @blueprint.post("/graph/change-sets/<change_set_id>/items")
    def save_graph_change_item(change_set_id: str):
        actor = _actor(identity)
        payload = _json()
        return _ok(
            graph.upsert_change_item(
                change_set_id,
                _required(payload, "operation"),
                _required(payload, "entityType"),
                _required(payload, "entityId"),
                payload.get("payload"),
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.post("/graph/change-sets/<change_set_id>/submit")
    def submit_graph_change_set(change_set_id: str):
        actor = _actor(identity)
        return _ok(
            graph.submit(
                change_set_id,
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.post("/graph/change-sets/<change_set_id>/review")
    def review_graph_change_set(change_set_id: str):
        actor = _actor(identity, {"expert", "admin"})
        payload = _json()
        return _ok(
            graph.review(
                change_set_id,
                _required(payload, "decision"),
                payload.get("notes", ""),
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.post("/graph/change-sets/<change_set_id>/publish")
    def publish_graph_change_set(change_set_id: str):
        actor = _actor(identity, {"expert", "admin"})
        return _ok(
            graph.publish(
                change_set_id,
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.get("/work-orders")
    def list_work_orders():
        actor = _actor(identity)
        assigned_to = request.args.get("assignedTo")
        if actor["role"] == "engineer":
            assigned_to = actor["id"]
        return _ok(
            work_orders.list(
                status=request.args.get("status"),
                assigned_to=assigned_to,
                page=_query_int("page", 1),
                page_size=_query_int("pageSize", 50),
            )
        )

    @blueprint.post("/work-orders")
    def create_work_order():
        actor = _actor(identity, {"engineer", "admin"})
        payload = _json()
        assigned_to = payload.get("assignedTo")
        if actor["role"] == "engineer":
            assigned_to = actor["id"]
        return _ok(
            work_orders.create(
                _required(payload, "runId"),
                _required(payload, "title"),
                actor=actor,
                summary=payload.get("summary", ""),
                priority=payload.get("priority", "normal"),
                assigned_to=assigned_to,
                due_at=payload.get("dueAt"),
                request_id=_request_id(),
            ),
            201,
        )

    @blueprint.get("/work-orders/<order_id>")
    def get_work_order(order_id: str):
        actor = _actor(identity)
        result = work_orders.get(order_id)
        _check_order_access(actor, result)
        return _ok(result)

    @blueprint.patch("/work-orders/<order_id>")
    def update_work_order(order_id: str):
        actor = _actor(identity, {"engineer", "admin"})
        current = work_orders.get(order_id)
        _check_order_access(actor, current)
        payload = _json()
        expected_revision = payload.pop("expectedRevision", None)
        return _ok(
            work_orders.update(
                order_id,
                expected_revision,
                payload,
                actor=actor,
                request_id=_request_id(),
            )
        )

    @blueprint.post("/work-orders/<order_id>/job-cards")
    def generate_job_card(order_id: str):
        actor = _actor(identity, {"engineer", "expert", "admin"})
        current = work_orders.get(order_id)
        _check_order_access(actor, current)
        return _ok(
            work_orders.generate_job_card(
                order_id,
                actor=actor,
                request_id=_request_id(),
            ),
            201,
        )

    @blueprint.get("/work-orders/<order_id>/job-cards")
    def list_job_cards(order_id: str):
        actor = _actor(identity)
        current = work_orders.get(order_id)
        _check_order_access(actor, current)
        return _ok({"items": work_orders.list_job_cards(order_id)})

    @blueprint.get("/job-cards/<document_id>")
    def get_job_card(document_id: str):
        actor = _actor(identity)
        result = work_orders.get_job_card(document_id, include_payload=True)
        _check_order_access(actor, work_orders.get(result["orderId"]))
        return _ok(result)

    @blueprint.get("/job-cards/<document_id>/download")
    def download_job_card(document_id: str):
        actor = _actor(identity)
        path, document = work_orders.download_path(document_id)
        order = work_orders.get(document["orderId"])
        _check_order_access(actor, order)
        return send_file(
            path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"{order['orderNumber']}-作业卡-v{document['version']}.pdf",
            conditional=True,
            etag=document["pdfSha256"],
        )

    return blueprint


def _actor(
    identity: IdentityService,
    roles: Iterable[str] | None = None,
) -> dict[str, Any]:
    return identity.authenticate_token(
        _bearer_token(),
        allowed_roles=set(roles) if roles is not None else None,
    )


def _bearer_token() -> str:
    value = request.headers.get("Authorization", "")
    scheme, separator, token = value.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise PlatformError("authentication_required", "需要 Bearer 登录会话", 401)
    return token.strip()


def _check_order_access(actor: dict[str, Any], order: dict[str, Any]) -> None:
    if actor["role"] == "engineer" and order["assignedTo"] != actor["id"]:
        raise PlatformError("role_forbidden", "不能访问其他工程师的工单", 403)


def _json() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise PlatformError("validation_error", "请求体必须是 JSON 对象", 422)
    return payload


def _form_json(field: str) -> dict[str, Any]:
    raw = request.form.get(field, "{}")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PlatformError("validation_error", f"{field} 必须是 JSON 对象", 422) from exc
    if not isinstance(value, dict):
        raise PlatformError("validation_error", f"{field} 必须是 JSON 对象", 422)
    return value


def _required(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise PlatformError("validation_error", f"{field} 不能为空", 422)
    return value.strip()


def _query_int(name: str, default: int) -> int:
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise PlatformError("validation_error", f"{name} 必须是整数", 422) from exc


def _request_id() -> str | None:
    return getattr(g, "request_id", None) or request.headers.get("X-Request-ID")


def _ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status
