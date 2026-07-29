from __future__ import annotations

import json
import sqlite3
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, jsonify, request, send_file, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
try:
    from .case_package import CasePackageRegistry
    from .case_platform.api import create_platform_blueprint
    from .case_platform.case_runs import CaseRunStore
    from .case_platform.errors import PlatformError
    from .case_platform.migrations import MigrationRunner
    from .case_platform.knowledge import KnowledgeLifecycleService
    from .case_platform.providers import (
        CatalogKnowledgeSearchProvider,
        LocalAttachmentStore,
    )
    from .case_platform.routing import DeterministicCaseRouter
    from .runtime.config import RuntimeSettings
    from .runtime.observability import install_observability
    from .runtime.provider_factory import (
        build_diagnosis_provider,
        build_telemetry_provider,
    )
    from .core_business.api import create_core_business_blueprint
    from .core_business.audit import AuditService
    from .core_business.auth import IdentityService
    from .core_business.graph import GovernedGraphService
    from .core_business.manuals import ManualKnowledgeService
    from .core_business.work_orders import WorkOrderService
    from .presentation_store import PresentationStore
except ImportError:
    from case_package import CasePackageRegistry
    from case_platform.api import create_platform_blueprint
    from case_platform.case_runs import CaseRunStore
    from case_platform.errors import PlatformError
    from case_platform.migrations import MigrationRunner
    from case_platform.knowledge import KnowledgeLifecycleService
    from case_platform.providers import (
        CatalogKnowledgeSearchProvider,
        LocalAttachmentStore,
    )
    from case_platform.routing import DeterministicCaseRouter
    from runtime.config import RuntimeSettings
    from runtime.observability import install_observability
    from runtime.provider_factory import (
        build_diagnosis_provider,
        build_telemetry_provider,
    )
    from core_business.api import create_core_business_blueprint
    from core_business.audit import AuditService
    from core_business.auth import IdentityService
    from core_business.graph import GovernedGraphService
    from core_business.manuals import ManualKnowledgeService
    from core_business.work_orders import WorkOrderService
    from presentation_store import PresentationStore


BASE_DIR = Path(__file__).resolve().parent
REPOSITORY_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
PRESENTATION_DIR = DATA_DIR / "presentation"
PRESENTATION_INITIAL_STATE_FILE = PRESENTATION_DIR / "initial_state.json"
PRESENTATION_DB_FILE = PRESENTATION_DIR / "presentation.db"
CASES_DIR = DATA_DIR / "cases"


def load_json(name: str):
    with (DATA_DIR / name).open("r", encoding="utf-8") as file:
        return json.load(file)


def load_path(path: Path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def api_ok(data=None, message=""):
    return jsonify({"ok": True, "data": data, "message": message})


def api_error(error: str, message: str, status=400):
    return jsonify({"ok": False, "error": error, "message": message}), status


def create_app(
    database_path: Path | None = None,
    runtime_settings: RuntimeSettings | None = None,
) -> Flask:
    app = Flask(__name__)
    settings = runtime_settings or RuntimeSettings.from_environment(REPOSITORY_DIR)
    if database_path is not None:
        settings = settings.with_database(database_path)
    app.config["RUNTIME_SETTINGS"] = settings
    app.config["MAX_CONTENT_LENGTH"] = settings.attachment_max_bytes + 1024 * 1024
    if settings.trust_proxy_headers:
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=1,
            x_proto=1,
            x_host=1,
        )

    case_registry = CasePackageRegistry(
        CASES_DIR,
        PRESENTATION_DIR / "manual_sources.json",
    ).load()
    scenario = load_json("demo_scenario.json")
    guide_steps = load_json("guide_steps.json")
    knowledge_items = load_json("knowledge_items.json")
    graph_relations = load_json("graph_relations.json")
    expert_reviews = load_json("expert_reviews.json")
    presentation_users = load_path(PRESENTATION_DIR / "users.json")
    presentation_cases = load_path(PRESENTATION_DIR / "cases.json")
    presentation_case = load_path(PRESENTATION_DIR / "case_full_001.json")
    presentation_knowledge = load_path(PRESENTATION_DIR / "knowledge_base.json")
    manual_sources = load_path(PRESENTATION_DIR / "manual_sources.json")
    presentation_graph = load_path(PRESENTATION_DIR / "graph_seed.json")
    industrial_computer_graph = load_path(PRESENTATION_DIR / "industrial_computer_graph.json")
    verification_scenario = load_path(PRESENTATION_DIR / "verification_scenario.json")
    active_database_path = settings.database_path
    store = PresentationStore(active_database_path)
    initial_state = load_path(PRESENTATION_INITIAL_STATE_FILE)
    store.initialize(initial_state, presentation_case, presentation_knowledge, industrial_computer_graph)
    MigrationRunner(active_database_path).migrate()
    case_run_store = CaseRunStore(active_database_path)
    knowledge_service = KnowledgeLifecycleService(active_database_path)
    case_router = DeterministicCaseRouter(case_registry)
    app.register_blueprint(
        create_platform_blueprint(
            case_registry,
            case_run_store,
            case_router,
            build_diagnosis_provider(settings),
            knowledge_service,
            build_telemetry_provider(settings),
            CatalogKnowledgeSearchProvider(),
            LocalAttachmentStore(
                settings.attachment_root,
                max_bytes=settings.attachment_max_bytes,
            ),
        )
    )
    audit_service = AuditService(active_database_path)
    identity_service = IdentityService(
        active_database_path,
        audit_service,
        session_ttl_seconds=settings.session_ttl_seconds,
        max_failures=settings.login_max_failures,
        lock_seconds=settings.login_lock_seconds,
    )
    if settings.bootstrap_admin_account:
        identity_service.bootstrap_admin(
            settings.bootstrap_admin_account,
            settings.bootstrap_admin_password,
        )
    graph_service = GovernedGraphService(active_database_path, audit_service)
    graph_service.initialize_seed(industrial_computer_graph)
    manual_service = ManualKnowledgeService(
        active_database_path,
        settings.manual_storage_root,
        audit_service,
        max_bytes=settings.manual_max_bytes,
    )
    work_order_service = WorkOrderService(
        active_database_path,
        settings.job_card_storage_root,
        audit_service,
    )
    app.register_blueprint(
        create_core_business_blueprint(
            identity_service,
            audit_service,
            manual_service,
            graph_service,
            work_order_service,
        )
    )

    @app.before_request
    def enforce_platform_identity():
        if request.blueprint != "case_platform":
            return None
        if request.endpoint in {
            "case_platform.list_cases",
            "case_platform.platform_capabilities",
            "case_platform.route_case",
        }:
            return None
        header = request.headers.get("Authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not token:
            if settings.auth_mode == "enforced":
                raise PlatformError(
                    "authentication_required",
                    "当前部署要求登录后访问业务接口",
                    401,
                )
            return None
        actor = identity_service.authenticate_token(token)
        g.platform_actor = actor
        supplied_id = None
        supplied_role = None
        if request.is_json:
            body = request.get_json(silent=True) or {}
            supplied = body.get("actor") if isinstance(body, dict) else None
            if isinstance(supplied, dict):
                supplied_id = supplied.get("id")
                supplied_role = supplied.get("role")
        elif request.form:
            supplied_id = request.form.get("actorId")
            supplied_role = request.form.get("actorRole")
        if supplied_id and supplied_id != actor["id"]:
            raise PlatformError(
                "actor_mismatch",
                "请求 actor 与登录会话不一致",
                403,
            )
        if supplied_role and supplied_role != actor["role"]:
            raise PlatformError(
                "actor_mismatch",
                "请求角色与登录会话不一致",
                403,
            )
        return None

    def readiness_check():
        checks: dict[str, object] = {}
        ready = True
        active_user_count = 0
        try:
            with sqlite3.connect(active_database_path) as connection:
                connection.execute("SELECT 1").fetchone()
                migration_count = connection.execute(
                    "SELECT count(*) FROM schema_migrations"
                ).fetchone()[0]
                active_user_count = connection.execute(
                    "SELECT count(*) FROM platform_users WHERE status='active'"
                ).fetchone()[0]
            checks["database"] = {
                "status": "ok",
                "migrationCount": migration_count,
            }
        except (OSError, sqlite3.Error) as exc:
            ready = False
            checks["database"] = {"status": "error", "reason": str(exc)}
        runnable_cases = len(case_registry.runnable_items())
        checks["caseRegistry"] = {
            "status": "ok" if runnable_cases else "error",
            "runnableCases": runnable_cases,
            "loadErrors": len(case_registry.load_errors),
        }
        ready = ready and runnable_cases > 0
        identity_ready = settings.auth_mode == "compat" or active_user_count > 0
        checks["identity"] = {
            "status": "ok" if identity_ready else "error",
            "authMode": settings.auth_mode,
            "activeUserCount": active_user_count,
        }
        ready = ready and identity_ready
        try:
            storage_checks = {}
            for name, root in (
                ("attachments", settings.attachment_root),
                ("manuals", settings.manual_storage_root),
                ("jobCards", settings.job_card_storage_root),
            ):
                root.mkdir(parents=True, exist_ok=True)
                probe = root / f".write-probe-{uuid.uuid4().hex}"
                probe.write_bytes(b"ready")
                probe.unlink()
                storage_checks[name] = {"status": "ok", "path": str(root)}
            checks["storage"] = storage_checks
            checks["attachmentStorage"] = storage_checks["attachments"]
        except OSError as exc:
            ready = False
            checks["storage"] = {
                "status": "error",
                "reason": str(exc),
            }
            checks["attachmentStorage"] = checks["storage"]
        frontend_exists = (settings.frontend_dist / "index.html").is_file()
        checks["frontend"] = {
            "status": "ok" if frontend_exists else "missing",
            "required": settings.readiness_requires_frontend,
        }
        if settings.readiness_requires_frontend and not frontend_exists:
            ready = False
        return ready, checks

    install_observability(
        app,
        service_name=settings.service_name,
        log_level=settings.log_level,
        json_access_log=settings.json_access_log,
        readiness_check=readiness_check,
    )

    def load_presentation_state():
        return store.load_state()

    completed_steps: set[str] = set()
    expert_approved = False

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin", "")
        allowed = settings.cors_allowed_origins
        if "*" in allowed:
            response.headers["Access-Control-Allow-Origin"] = "*"
        elif origin and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers.add("Vary", "Origin")
        response.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type, X-Request-ID"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET,POST,PATCH,DELETE,OPTIONS"
        )
        return response

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify(
            {
                "status": "ok",
                "service": settings.service_name,
                "environment": settings.environment,
            }
        )

    @app.route("/api/demo/scenario", methods=["GET"])
    def demo_scenario():
        return jsonify(scenario)

    @app.route("/api/diagnosis/start", methods=["POST"])
    def start_diagnosis():
        payload = request.get_json(silent=True) or {}
        user_input = payload.get("input") or scenario["default_input"]
        result = deepcopy(scenario["diagnosis"])
        result["input"] = user_input
        result["expert_review_applied"] = expert_approved
        if expert_approved:
            result["expert_review"] = expert_reviews[0]
        return jsonify(result)

    @app.route("/api/guide/steps", methods=["GET"])
    def steps():
        result = deepcopy(guide_steps)
        for step in result:
            step["completed"] = step["id"] in completed_steps
        return jsonify(result)

    @app.route("/api/guide/steps/<step_id>/complete", methods=["POST", "OPTIONS"])
    def complete_step(step_id: str):
        if request.method == "OPTIONS":
            return ("", 204)
        valid_ids = {step["id"] for step in guide_steps}
        if step_id not in valid_ids:
            return jsonify({"error": "unknown step"}), 404
        completed_steps.add(step_id)
        return jsonify({"step_id": step_id, "completed": True})

    @app.route("/api/records/generate", methods=["POST"])
    def generate_record():
        completed = [
            step for step in guide_steps if step["id"] in completed_steps
        ]
        return jsonify(
            {
                "record_id": "REC-ACP4000-001",
                "equipment": scenario["equipment"],
                "fault": scenario["fault"],
                "completed_steps": completed,
                "thresholds": scenario["thresholds"],
                "safety_confirmed": "step-02-safety" in completed_steps,
                "conclusion": "疑似风道堵塞、滤网积尘或风扇低速导致散热异常，建议完成清理、接线核对和恢复观察。",
                "expert_status": "已审核" if expert_approved else "尚未上传",
            }
        )

    @app.route("/api/knowledge/evidence", methods=["GET"])
    def evidence():
        return jsonify(knowledge_items)

    @app.route("/api/knowledge/graph", methods=["GET"])
    def graph():
        state = load_presentation_state()
        result = deepcopy(graph_relations)
        if state.get("knowledgePublished") and state.get("graphDecision") == "accepted":
            for relation in state.get("publishedRelations") or presentation_case["graphChanges"]:
                result.append({**relation, "new": True, "sourceCaseId": presentation_case["id"]})
        return jsonify(result)

    @app.route("/api/expert/review", methods=["POST"])
    def expert_review():
        nonlocal expert_approved
        expert_approved = True
        review = deepcopy(expert_reviews[0])
        review["status"] = "approved"
        return jsonify(review)

    @app.route("/api/presentation/state", methods=["GET"])
    def presentation_state():
        return api_ok(load_presentation_state())

    @app.route("/api/presentation/reset", methods=["POST"])
    def presentation_reset():
        state = store.reset(initial_state, presentation_case, presentation_knowledge, industrial_computer_graph)
        return api_ok(state, "演示状态已重置")

    @app.route("/api/presentation/role", methods=["POST"])
    def presentation_role():
        payload = request.get_json(silent=True) or {}
        role = payload.get("role")
        if role not in {"engineer", "expert", "admin"}:
            return api_error("invalid_role", "不支持的演示角色")
        state = load_presentation_state()
        state["activeRole"] = role
        return api_ok(store.save_state(state), "角色已切换")

    @app.route("/api/admin/users", methods=["GET"])
    def admin_users():
        return api_ok(presentation_users["items"])

    def merged_case_items(state):
        result = deepcopy(presentation_cases["items"])
        for item in result:
            if item["id"] == presentation_cases["interactiveCaseId"]:
                item["status"] = state["caseStatus"]
                item["result"] = (state.get("engineerResult") or {}).get("recoveryResult", item["result"])
        return result

    @app.route("/api/admin/cases", methods=["GET"])
    def admin_cases():
        state = load_presentation_state()
        items = merged_case_items(state)
        query = request.args.get("query", "").strip().lower()
        status = request.args.get("status", "").strip()
        fault_type = request.args.get("faultType", "").strip()
        if query:
            items = [item for item in items if query in f'{item["id"]} {item["title"]} {item["equipment"]}'.lower()]
        if status:
            items = [item for item in items if item.get("status") == status]
        if fault_type:
            items = [item for item in items if item.get("faultType") == fault_type]
        return api_ok(items)

    @app.route("/api/admin/cases/<case_id>", methods=["GET"])
    def admin_case_detail(case_id: str):
        state = load_presentation_state()
        if case_id == presentation_case["id"]:
            return api_ok({**deepcopy(presentation_case), "runtime": state})
        item = next((item for item in presentation_cases["items"] if item["id"] == case_id), None)
        if not item:
            return api_error("case_not_found", "未找到案例", 404)
        return api_ok(item)

    @app.route("/api/admin/cases/<case_id>/adopt-engineer-result", methods=["POST"])
    def adopt_engineer_result(case_id: str):
        if case_id != presentation_case["id"]:
            return api_error("readonly_case", "历史摘要案例仅支持查看")
        return api_ok(presentation_case["engineerResultTemplate"])

    @app.route("/api/admin/cases/<case_id>/submit", methods=["POST"])
    def submit_case(case_id: str):
        if case_id != presentation_case["id"]:
            return api_error("readonly_case", "历史摘要案例不能提交")
        state = load_presentation_state()
        if state["activeRole"] != "engineer":
            return api_error("role_forbidden", "只有工程师可以提交案例", 403)
        payload = request.get_json(silent=True) or {}
        feedback_package = payload.get("feedbackPackage") or {}
        result = payload.get("engineerResult") or feedback_package.get("maintenanceResult") or {}
        record_id = feedback_package.get("recordId") or presentation_case["recordId"]
        if state["caseStatus"] != "awaiting_engineer_confirmation":
            submitted = state.get("feedbackPackage") or {}
            if state.get("engineerSubmitted") and submitted.get("recordId") == record_id:
                return api_ok(state, f'案例 {case_id} 已在专家待审核库中')
            return api_error("invalid_case_state", "当前案例不能重复提交")
        required = ["finalCause", "actualResolution", "recoveryResult", "fanSpeedRpm", "systemTemperatureC", "cpuTemperatureC", "observationMinutes"]
        if any(result.get(field) in (None, "") for field in required):
            return api_error("incomplete_engineer_result", "请完成必要的实际检修结果")
        if not feedback_package:
            feedback_package = {
                "caseId": case_id,
                "recordId": record_id,
                "engineerId": "lishifu",
                "maintenanceResult": result,
                "completedSteps": presentation_case["execution"]["steps"],
                "materials": [],
                "targetKnowledgeIds": [presentation_case["knowledgeProposal"]["knowledgeId"]],
            }
        submitted_at = datetime.now(timezone.utc).isoformat()
        feedback_package = {**feedback_package, "caseId": case_id, "recordId": record_id, "submittedAt": submitted_at}
        state.update({
            "engineerResult": result,
            "feedbackPackage": feedback_package,
            "submittedAt": submitted_at,
            "engineerSubmitted": True,
            "caseStatus": "pending_expert_review",
        })
        store.save_engineer_result(case_id, state["caseStatus"], result)
        return api_ok(store.save_state(state), f'案例 {case_id} 已进入专家待审核库')

    @app.route("/api/admin/cases/<case_id>/adopt-expert-conclusion", methods=["POST"])
    def adopt_expert_conclusion(case_id: str):
        if case_id != presentation_case["id"]:
            return api_error("readonly_case", "历史摘要案例仅支持查看")
        return api_ok({"expertConclusion": presentation_case["expertReviewTemplate"]["expertConclusion"]})

    @app.route("/api/admin/cases/<case_id>/graph-decision", methods=["POST"])
    def graph_decision(case_id: str):
        state = load_presentation_state()
        if state["activeRole"] != "expert":
            return api_error("role_forbidden", "只有专家可以处理图谱建议", 403)
        if state["caseStatus"] != "pending_expert_review":
            return api_error("invalid_case_state", "当前案例尚未进入专家审核")
        decision = (request.get_json(silent=True) or {}).get("decision")
        if decision not in {"accepted", "rejected"}:
            return api_error("invalid_graph_decision", "请选择接受或不采用")
        state["graphDecision"] = decision
        return api_ok(store.save_state(state), "图谱建议已处理")

    @app.route("/api/admin/cases/<case_id>/expert-draft", methods=["POST"])
    def save_expert_draft(case_id: str):
        if case_id != presentation_case["id"]:
            return api_error("readonly_case", "历史摘要案例仅支持查看")
        state = load_presentation_state()
        if state["activeRole"] != "expert":
            return api_error("role_forbidden", "只有专家可以保存审核草稿", 403)
        if state["caseStatus"] != "pending_expert_review":
            return api_error("invalid_case_state", "当前案例尚未进入专家审核")
        draft = (request.get_json(silent=True) or {}).get("expertDraft")
        if not isinstance(draft, dict) or not isinstance(draft.get("caseResult"), dict) or not isinstance(draft.get("knowledge"), dict):
            return api_error("invalid_expert_draft", "专家审核草稿不完整")
        state["expertDraft"] = draft
        state["expertAnnotations"] = draft.get("annotations", [])
        store.save_expert_draft(case_id, draft)
        return api_ok(store.save_state(state), "专家修改草稿已保存")

    @app.route("/api/admin/cases/<case_id>/publish", methods=["POST"])
    def publish_case(case_id: str):
        state = load_presentation_state()
        if state["activeRole"] != "expert":
            return api_error("role_forbidden", "只有专家可以发布知识", 403)
        if state["caseStatus"] != "pending_expert_review":
            return api_error("invalid_case_state", "当前案例不能发布")
        draft = (request.get_json(silent=True) or {}).get("expertDraft") or state.get("expertDraft") or {}
        case_result = draft.get("caseResult") or {}
        knowledge = draft.get("knowledge") or {}
        relations = draft.get("relations") or []
        conclusion = str(case_result.get("finalCause", "")).strip()
        if not conclusion:
            return api_error("expert_conclusion_required", "请填写专家结论")
        required_knowledge = ["equipment", "symptoms", "conditions", "causes", "checks", "resolution", "safety", "recovery", "exclusions"]
        if any(not str(knowledge.get(field, "")).strip() for field in required_knowledge):
            return api_error("incomplete_knowledge", "请完成结构化知识字段")
        if not relations:
            return api_error("graph_relation_required", "请至少保留一条知识图谱关系")
        state = store.publish(state, case_id, presentation_knowledge["dynamicKnowledgeId"], draft, industrial_computer_graph)
        return api_ok(state, "案例已通过，知识 V1.1 已发布")

    def build_industrial_graph(state: dict, view: str):
        base_nodes = deepcopy(industrial_computer_graph["nodes"])
        base_relations = deepcopy(industrial_computer_graph["relations"])
        template = industrial_computer_graph["changeTemplate"]
        published = bool(state.get("knowledgePublished"))
        candidate = bool(state.get("engineerSubmitted") or state.get("expertDraft"))
        change_status = "published" if published else "candidate" if candidate else "proposed"
        change_type = "added" if published else "candidate"
        change_nodes = [
            {
                **deepcopy(node),
                "status": change_status,
                "changeType": change_type,
                "knowledgeId": presentation_knowledge["dynamicKnowledgeId"],
                "knowledgeVersion": state.get("knowledgeVersion", "1.0"),
                "sourceCaseIds": node.get("sourceCaseIds") or [presentation_case["id"]],
                "proposedBy": "李师傅",
                "reviewedBy": "专家账号" if published else None,
                "publishedAt": state.get("publishedAt"),
            }
            for node in template["nodes"]
        ]
        all_nodes = [*base_nodes, *change_nodes]
        ids_by_name = {node["name"]: node["id"] for node in all_nodes}
        raw_changes = (
            state.get("publishedRelations")
            if published
            else (state.get("expertDraft") or {}).get("relations")
        ) or presentation_case["graphChanges"]
        template_by_signature = {
            (relation["source"], relation["relation"], relation["target"]): relation
            for relation in template["relations"]
        }
        change_relations = []
        for index, relation in enumerate(raw_changes):
            template_relation = template_by_signature.get((relation["source"], relation["relation"], relation["target"]), {})
            source_id = relation.get("sourceNodeId") or template_relation.get("source") or ids_by_name.get(relation["source"])
            target_id = relation.get("targetNodeId") or template_relation.get("target") or ids_by_name.get(relation["target"])
            if not source_id or not target_id:
                continue
            change_relations.append({
                "id": str(relation.get("id") or template_relation.get("id") or f"change-{index + 1}"),
                "source": source_id,
                "relation": relation["relation"],
                "target": target_id,
                "status": change_status,
                "changeType": relation.get("changeType", change_type),
                "sourceCaseId": presentation_case["id"],
                "knowledgeId": presentation_knowledge["dynamicKnowledgeId"],
                "knowledgeVersion": state.get("knowledgeVersion", "1.0"),
            })
        include_changes = published or view == "changes"
        nodes = all_nodes if include_changes else base_nodes
        relations = [*base_relations, *change_relations] if include_changes else base_relations
        case_ids = {case["id"] for case in presentation_cases["items"]}
        return {
            "view": view,
            "centerNodeId": industrial_computer_graph["centerNodeId"],
            "nodes": nodes,
            "relations": relations,
            "changeNodeIds": [node["id"] for node in change_nodes],
            "changeRelationIds": [relation["id"] for relation in change_relations],
            "published": published,
            "changeStatus": change_status,
            "knowledgeVersion": state.get("knowledgeVersion", "1.0"),
            "sourceCaseId": presentation_case["id"],
            "publishedAt": state.get("publishedAt"),
            "statistics": {
                "nodeCount": len(nodes),
                "relationCount": len(relations),
                "domainCount": 5,
                "knowledgeCount": len(presentation_knowledge["items"]),
                "caseCount": len(case_ids),
            },
        }

    @app.route("/api/admin/knowledge-graph", methods=["GET"])
    def admin_knowledge_graph():
        view = request.args.get("view", "overview").strip()
        if view not in {"overview", "changes"}:
            return api_error("invalid_graph_view", "不支持的知识图谱视图")
        return api_ok(build_industrial_graph(load_presentation_state(), view))

    def merged_knowledge_items(state):
        items = deepcopy(presentation_knowledge["items"])
        for item in items:
            if item["id"] == presentation_knowledge["dynamicKnowledgeId"]:
                published = state.get("knowledgePublished")
                item["version"] = state.get("knowledgeVersion", "1.0")
                item["content"] = item["publishedContentV11"] if published else item["baseContent"]
                item["sourceCaseIds"] = [presentation_case["id"]] if published else []
                item["publishedBy"] = "专家账号" if published else None
                item["publishedAt"] = state.get("publishedAt")
        return items

    def manual_catalog_items():
        knowledge = merged_knowledge_items(load_presentation_state())
        result = []
        for manual in manual_sources["items"]:
            related_ids = [
                item["id"]
                for item in knowledge
                if any(ref.get("documentId") == manual["id"] for ref in item.get("sourceRefs", []))
            ]
            result.append({
                **deepcopy(manual),
                "relatedKnowledgeIds": related_ids,
                "relatedKnowledgeCount": len(related_ids),
                "fileUrl": f'/api/admin/manuals/{manual["id"]}/file',
            })
        return result

    def manual_file_path(manual: dict) -> Path | None:
        path = (REPOSITORY_DIR / manual["file"]).resolve()
        if not path.is_relative_to(REPOSITORY_DIR.resolve()) or not path.is_file():
            return None
        return path

    @app.route("/api/admin/knowledge", methods=["GET"])
    def admin_knowledge():
        return api_ok(merged_knowledge_items(load_presentation_state()))

    @app.route("/api/admin/knowledge/<knowledge_id>", methods=["GET"])
    def admin_knowledge_detail(knowledge_id: str):
        item = next((item for item in merged_knowledge_items(load_presentation_state()) if item["id"] == knowledge_id), None)
        if not item:
            return api_error("knowledge_not_found", "未找到知识", 404)
        return api_ok(item)

    @app.route("/api/admin/knowledge/<knowledge_id>/diff", methods=["GET"])
    def admin_knowledge_diff(knowledge_id: str):
        if knowledge_id != presentation_knowledge["dynamicKnowledgeId"]:
            return api_error("diff_unavailable", "预置知识没有演示版本差异", 404)
        item = presentation_knowledge["items"][0]
        state = load_presentation_state()
        relations = state.get("publishedRelations") or presentation_case["graphChanges"]
        return api_ok({"knowledgeId": knowledge_id, "beforeVersion": "1.0", "afterVersion": "1.1", "before": item["baseContent"], "after": item["publishedContentV11"], "graphChanges": relations})

    @app.route("/api/admin/manuals", methods=["GET"])
    def admin_manuals():
        items = manual_catalog_items()
        query = request.args.get("query", "").strip().lower()
        manufacturer = request.args.get("manufacturer", "").strip()
        domain = request.args.get("domain", "").strip()
        if query:
            items = [
                item for item in items
                if query in " ".join([
                    item["id"], item["title"], item["manufacturer"],
                    item.get("publication", ""), *item.get("productScope", []),
                ]).lower()
            ]
        if manufacturer:
            items = [item for item in items if item["manufacturer"] == manufacturer]
        if domain:
            items = [item for item in items if domain in item.get("faultDomains", [])]
        return api_ok(items)

    @app.route("/api/admin/manuals/<manual_id>", methods=["GET"])
    def admin_manual_detail(manual_id: str):
        item = next((item for item in manual_catalog_items() if item["id"] == manual_id), None)
        if not item:
            return api_error("manual_not_found", "未找到检修手册", 404)
        return api_ok(item)

    @app.route("/api/admin/manuals/<manual_id>/file", methods=["GET"])
    def admin_manual_file(manual_id: str):
        manual = next((item for item in manual_sources["items"] if item["id"] == manual_id), None)
        if not manual:
            return api_error("manual_not_found", "未找到检修手册", 404)
        path = manual_file_path(manual)
        if not path:
            return api_error("manual_file_missing", "检修手册文件不存在", 404)
        return send_file(path, mimetype="application/pdf", as_attachment=False, conditional=True)

    @app.route("/api/knowledge/verify-feedback", methods=["POST"])
    def verify_feedback():
        state = load_presentation_state()
        payload = request.get_json(silent=True) or {}
        if not state.get("knowledgePublished"):
            return api_ok({"matched": False, "version": "1.0", "message": "当前知识尚未包含本次案例反馈"})
        snapshot = store.engineer_snapshot("lishifu", presentation_knowledge["dynamicKnowledgeId"])
        if snapshot["syncStatus"] != "current" or snapshot["version"] != snapshot["latestVersion"]:
            return api_ok({"matched": False, "version": snapshot["version"], "latestVersion": snapshot["latestVersion"], "syncRequired": True, "message": f'工程师本地知识仍为 V{snapshot["version"]}，请先同步专家发布的 V{snapshot["latestVersion"]}'})
        knowledge = snapshot.get("knowledge") or {}
        relations = snapshot.get("relations") or []
        causes = knowledge.get("causes") or verification_scenario["assessment"]
        conditions = knowledge.get("conditions") or "符合已发布知识的判断条件"
        resolution = knowledge.get("resolution") or verification_scenario["recommendation"]
        state["feedbackVerified"] = True
        store.save_state(state)
        return api_ok({
            "matched": True,
            "input": payload.get("input") or verification_scenario["input"],
            "knowledgeId": "KB-008",
            "version": snapshot["version"],
            "sourceCaseId": snapshot.get("sourceCaseId") or presentation_case["id"],
            "matchedSymptoms": knowledge.get("symptoms"),
            "matchedConditions": conditions,
            "assessment": f"{causes}（命中条件：{conditions}）",
            "recommendation": resolution,
            "safety": knowledge.get("safety"),
            "recovery": knowledge.get("recovery"),
            "exclusions": knowledge.get("exclusions"),
            "graphPath": relations,
        })

    @app.route("/api/engineer/knowledge-sync", methods=["GET"])
    def engineer_sync_status():
        return api_ok(store.sync_status("lishifu", presentation_knowledge["dynamicKnowledgeId"]))

    @app.route("/api/engineer/knowledge-sync", methods=["POST"])
    def engineer_sync_latest():
        return api_ok(store.sync_latest("lishifu", presentation_knowledge["dynamicKnowledgeId"]), "工程师本地知识已同步到最新版本")

    @app.route("/api/engineer/knowledge-snapshot", methods=["GET"])
    def engineer_knowledge_snapshot():
        return api_ok(store.engineer_snapshot("lishifu", presentation_knowledge["dynamicKnowledgeId"]))

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path: str):
        if not settings.frontend_dist.exists():
            return jsonify(
                {
                    "error": "frontend dist not found",
                    "hint": "run `npm run build` in frontend first",
                }
            ), 404

        requested = settings.frontend_dist / path
        if path and requested.is_file():
            return send_from_directory(settings.frontend_dist, path)
        return send_from_directory(settings.frontend_dist, "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    active_settings = app.config["RUNTIME_SETTINGS"]
    app.run(
        host=active_settings.host,
        port=active_settings.port,
        debug=False,
    )
