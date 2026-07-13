from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
try:
    from .presentation_store import PresentationStore
except ImportError:
    from presentation_store import PresentationStore


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"
PRESENTATION_DIR = DATA_DIR / "presentation"
PRESENTATION_INITIAL_STATE_FILE = PRESENTATION_DIR / "initial_state.json"
PRESENTATION_DB_FILE = PRESENTATION_DIR / "presentation.db"


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


def create_app() -> Flask:
    app = Flask(__name__)

    scenario = load_json("demo_scenario.json")
    guide_steps = load_json("guide_steps.json")
    knowledge_items = load_json("knowledge_items.json")
    graph_relations = load_json("graph_relations.json")
    expert_reviews = load_json("expert_reviews.json")
    presentation_users = load_path(PRESENTATION_DIR / "users.json")
    presentation_cases = load_path(PRESENTATION_DIR / "cases.json")
    presentation_case = load_path(PRESENTATION_DIR / "case_full_001.json")
    presentation_knowledge = load_path(PRESENTATION_DIR / "knowledge_base.json")
    presentation_graph = load_path(PRESENTATION_DIR / "graph_seed.json")
    verification_scenario = load_path(PRESENTATION_DIR / "verification_scenario.json")
    store = PresentationStore(PRESENTATION_DB_FILE)
    initial_state = load_path(PRESENTATION_INITIAL_STATE_FILE)
    store.initialize(initial_state, presentation_case, presentation_knowledge)

    def load_presentation_state():
        return store.load_state()

    completed_steps: set[str] = set()
    expert_approved = False

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return response

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "service": "la-mvp-backend"})

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
        state = store.reset(initial_state, presentation_case, presentation_knowledge)
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
        state = store.publish(state, case_id, presentation_knowledge["dynamicKnowledgeId"], draft)
        return api_ok(state, "案例已通过，知识 V1.1 已发布")

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
        if not FRONTEND_DIST.exists():
            return jsonify(
                {
                    "error": "frontend dist not found",
                    "hint": "run `npm run build` in frontend first",
                }
            ), 404

        requested = FRONTEND_DIST / path
        if path and requested.is_file():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
