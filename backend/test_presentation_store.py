import sqlite3
import unittest

from backend.app import PRESENTATION_DB_FILE, create_app


class PresentationStoreFlowTest(unittest.TestCase):
    def test_industrial_graph_views(self):
        client = create_app().test_client()
        client.post("/api/presentation/reset")

        overview_response = client.get("/api/admin/knowledge-graph?view=overview")
        self.assertEqual(overview_response.status_code, 200)
        overview = overview_response.get_json()["data"]
        self.assertEqual(overview["centerNodeId"], "device-industrial-computer")
        self.assertEqual(overview["view"], "overview")
        self.assertGreaterEqual(len(overview["nodes"]), 35)
        self.assertGreaterEqual(len(overview["relations"]), 35)
        self.assertEqual(overview["statistics"]["domainCount"], 5)
        self.assertNotIn("cause-fan-aging", {node["id"] for node in overview["nodes"]})
        overview_node_ids = {node["id"] for node in overview["nodes"]}
        self.assertTrue(all(relation["source"] in overview_node_ids and relation["target"] in overview_node_ids for relation in overview["relations"]))

        changes_response = client.get("/api/admin/knowledge-graph?view=changes")
        self.assertEqual(changes_response.status_code, 200)
        changes = changes_response.get_json()["data"]
        self.assertEqual(changes["view"], "changes")
        self.assertEqual(changes["changeStatus"], "proposed")
        self.assertIn("cause-fan-aging", changes["changeNodeIds"])
        self.assertGreater(len(changes["nodes"]), len(overview["nodes"]))
        changes_node_ids = {node["id"] for node in changes["nodes"]}
        self.assertTrue(set(changes["changeNodeIds"]) <= changes_node_ids)
        self.assertTrue(all(relation["source"] in changes_node_ids and relation["target"] in changes_node_ids for relation in changes["relations"]))
        self.assertEqual(client.get("/api/admin/knowledge-graph?view=unknown").status_code, 400)

    def test_publish_and_engineer_sync(self):
        client = create_app().test_client()
        self.assertEqual(client.post("/api/presentation/reset").status_code, 200)
        initial = client.get("/api/engineer/knowledge-sync").get_json()["data"]
        self.assertEqual((initial["local_version"], initial["status"]), ("1.0", "current"))

        client.post("/api/presentation/role", json={"role": "engineer"})
        case = client.get("/api/admin/cases/CASE-ACP4000-001").get_json()["data"]
        feedback_package = {
            "caseId": "CASE-ACP4000-001",
            "recordId": "REC-ACP4000-001",
            "engineerId": "lishifu",
            "maintenanceResult": case["engineerResultTemplate"],
            "completedSteps": case["execution"]["steps"],
            "materials": [{"id": "material-1", "type": "image", "name": "fault.jpg", "size": 1024}],
            "targetKnowledgeIds": ["KB-008"],
        }
        submit = client.post("/api/admin/cases/CASE-ACP4000-001/submit", json={"feedbackPackage": feedback_package})
        self.assertEqual(submit.status_code, 200)
        submitted_state = submit.get_json()["data"]
        self.assertEqual(submitted_state["caseStatus"], "pending_expert_review")
        self.assertEqual(submitted_state["feedbackPackage"]["materials"][0]["name"], "fault.jpg")
        self.assertIsNotNone(submitted_state["submittedAt"])
        duplicate = client.post("/api/admin/cases/CASE-ACP4000-001/submit", json={"feedbackPackage": feedback_package})
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.get_json()["data"]["feedbackPackage"]["recordId"], "REC-ACP4000-001")
        client.post("/api/presentation/role", json={"role": "expert"})
        relations = case["graphChanges"]
        knowledge = {"equipment": "ACP-4000", "symptoms": "TEMP/FAN 告警", "conditions": "清理后仍低速", "causes": "风扇老化", "checks": "复测转速", "resolution": "更换老化风扇", "safety": "断电挂牌", "recovery": "告警解除", "exclusions": "接线故障"}
        draft = {"caseResult": {"finalCause": "风扇老化", "actualResolution": "更换风扇", "recoveryResult": "告警解除", "knowledgeValue": "可复用"}, "knowledge": knowledge, "relations": relations, "annotations": [], "reviewDecision": "修正后通过"}
        self.assertEqual(client.post("/api/admin/cases/CASE-ACP4000-001/expert-draft", json={"expertDraft": draft}).status_code, 200)
        self.assertEqual(client.post("/api/admin/cases/CASE-ACP4000-001/publish", json={"expertDraft": draft}).status_code, 200)

        published_graph = client.get("/api/admin/knowledge-graph?view=changes").get_json()["data"]
        self.assertTrue(published_graph["published"])
        self.assertEqual(published_graph["changeStatus"], "published")
        self.assertIn("cause-fan-aging", {node["id"] for node in published_graph["nodes"]})
        self.assertTrue(any(relation["status"] == "published" for relation in published_graph["relations"] if relation.get("changeType")))
        published_overview = client.get("/api/admin/knowledge-graph?view=overview").get_json()["data"]
        self.assertIn("cause-fan-aging", {node["id"] for node in published_overview["nodes"]})
        self.assertEqual(len([relation for relation in published_overview["relations"] if relation.get("changeType")]), 6)

        pending = client.get("/api/engineer/knowledge-sync").get_json()["data"]
        self.assertEqual((pending["local_version"], pending["latest_version"], pending["status"]), ("1.0", "1.1", "update_available"))
        before_sync = client.post("/api/knowledge/verify-feedback", json={"input": "清理后仍低速"}).get_json()["data"]
        self.assertFalse(before_sync["matched"])
        self.assertTrue(before_sync["syncRequired"])
        restarted_client = create_app().test_client()
        persisted = restarted_client.get("/api/presentation/state").get_json()["data"]
        self.assertEqual((persisted["knowledgePublished"], persisted["knowledgeVersion"]), (True, "1.1"))
        self.assertEqual(persisted["feedbackPackage"]["recordId"], "REC-ACP4000-001")
        self.assertEqual(client.get("/api/engineer/knowledge-snapshot").get_json()["data"]["relations"], [])
        self.assertEqual(client.post("/api/engineer/knowledge-sync").status_code, 200)
        snapshot = client.get("/api/engineer/knowledge-snapshot").get_json()["data"]
        self.assertEqual(snapshot["version"], "1.1")
        self.assertEqual(snapshot["knowledge"]["causes"], "风扇老化")
        self.assertEqual(snapshot["relations"][0]["source"], "风扇老化")
        after_sync = client.post("/api/knowledge/verify-feedback", json={"input": "清理后仍低速"}).get_json()["data"]
        self.assertTrue(after_sync["matched"])
        self.assertEqual(after_sync["recommendation"], "更换老化风扇")
        self.assertEqual(len(after_sync["graphPath"]), 6)
        self.assertIn({"source": "风扇老化", "relation": "导致", "target": "风扇转速低于 500 rpm"}, after_sync["graphPath"])

        with sqlite3.connect(PRESENTATION_DB_FILE) as database:
            tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"cases", "expert_reviews", "knowledge_items", "knowledge_versions", "graph_nodes", "graph_relations", "engineer_sync_records", "presentation_state"} <= tables)
        with sqlite3.connect(PRESENTATION_DB_FILE) as database:
            published_nodes = database.execute("SELECT COUNT(*) FROM graph_nodes WHERE version='1.1'").fetchone()[0]
        self.assertGreater(published_nodes, 0)
        reset_state = client.post("/api/presentation/reset").get_json()["data"]
        self.assertEqual(reset_state["caseStatus"], "awaiting_engineer_confirmation")
        self.assertIsNone(reset_state["feedbackPackage"])
        self.assertIsNone(reset_state["submittedAt"])


if __name__ == "__main__":
    unittest.main()
