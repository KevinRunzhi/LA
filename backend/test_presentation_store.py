import sqlite3
import unittest

from backend.app import PRESENTATION_DB_FILE, create_app


class PresentationStoreFlowTest(unittest.TestCase):
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
        relations = [{"id": 1, "source": "风扇老化", "relation": "导致", "target": "风扇转速低于 500 rpm", "changeType": "新增"}]
        knowledge = {"equipment": "ACP-4000", "symptoms": "TEMP/FAN 告警", "conditions": "清理后仍低速", "causes": "风扇老化", "checks": "复测转速", "resolution": "更换老化风扇", "safety": "断电挂牌", "recovery": "告警解除", "exclusions": "接线故障"}
        draft = {"caseResult": {"finalCause": "风扇老化", "actualResolution": "更换风扇", "recoveryResult": "告警解除", "knowledgeValue": "可复用"}, "knowledge": knowledge, "relations": relations, "annotations": [], "reviewDecision": "修正后通过"}
        self.assertEqual(client.post("/api/admin/cases/CASE-ACP4000-001/expert-draft", json={"expertDraft": draft}).status_code, 200)
        self.assertEqual(client.post("/api/admin/cases/CASE-ACP4000-001/publish", json={"expertDraft": draft}).status_code, 200)

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
        self.assertEqual(after_sync["graphPath"], [{"source": "风扇老化", "relation": "导致", "target": "风扇转速低于 500 rpm"}])

        with sqlite3.connect(PRESENTATION_DB_FILE) as database:
            tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"cases", "expert_reviews", "knowledge_items", "knowledge_versions", "graph_relations", "engineer_sync_records", "presentation_state"} <= tables)
        reset_state = client.post("/api/presentation/reset").get_json()["data"]
        self.assertEqual(reset_state["caseStatus"], "awaiting_engineer_confirmation")
        self.assertIsNone(reset_state["feedbackPackage"])
        self.assertIsNone(reset_state["submittedAt"])


if __name__ == "__main__":
    unittest.main()
