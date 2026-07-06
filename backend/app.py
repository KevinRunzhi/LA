from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"


def load_json(name: str):
    with (DATA_DIR / name).open("r", encoding="utf-8") as file:
        return json.load(file)


def create_app() -> Flask:
    app = Flask(__name__)

    scenario = load_json("demo_scenario.json")
    guide_steps = load_json("guide_steps.json")
    knowledge_items = load_json("knowledge_items.json")
    graph_relations = load_json("graph_relations.json")
    expert_reviews = load_json("expert_reviews.json")

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
                "expert_status": "已审核" if expert_approved else "待审核",
            }
        )

    @app.route("/api/knowledge/evidence", methods=["GET"])
    def evidence():
        return jsonify(knowledge_items)

    @app.route("/api/knowledge/graph", methods=["GET"])
    def graph():
        return jsonify(graph_relations)

    @app.route("/api/expert/review", methods=["POST"])
    def expert_review():
        nonlocal expert_approved
        expert_approved = True
        review = deepcopy(expert_reviews[0])
        review["status"] = "approved"
        return jsonify(review)

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
    app.run(host="0.0.0.0", port=5000, debug=False)
