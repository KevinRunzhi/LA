import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRESENTATION = ROOT / "backend" / "data" / "presentation"


def load_json(name):
    return json.loads((PRESENTATION / name).read_text(encoding="utf-8"))


class ContentCatalogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = load_json("manual_sources.json")["items"]
        cls.knowledge = load_json("knowledge_base.json")["items"]
        cls.graph = load_json("industrial_computer_graph.json")
        cls.sources_by_id = {item["id"]: item for item in cls.sources}

    def test_manual_sources_are_unique_and_files_exist(self):
        source_ids = [item["id"] for item in self.sources]
        self.assertEqual(15, len(source_ids))
        self.assertEqual(len(source_ids), len(set(source_ids)))
        for source in self.sources:
            path = ROOT / source["file"]
            self.assertTrue(path.is_file(), source["file"])
            with path.open("rb") as file:
                self.assertEqual(b"%PDF", file.read(4), source["file"])
            self.assertGreater(source["pageCount"], 0)
            self.assertIn(
                source["referencePriority"],
                {"exact_model", "same_series", "cross_brand_general"},
            )

    def test_advantech_cooling_source_package_is_complete(self):
        package = ROOT / "Info" / "acp4000_cooling_kb"
        expected_support_files = {
            "ACP4000_IPC610_cooling_fault_repair_guide.md",
            "document_inventory.md",
            "docs/ACP4000_IPC610_User_Manual_Ed6_cooling_extract.md",
            "docs/Datasheets_and_SAB2000_cooling_extract.md",
            "scripts/download_official_pdfs.sh",
        }
        for relative_path in expected_support_files:
            self.assertTrue((package / relative_path).is_file(), relative_path)
        advantech = [item for item in self.sources if item["manufacturer"] == "Advantech"]
        self.assertEqual(8, len(advantech))
        self.assertEqual(5, sum(item.get("editionStatus") == "current" for item in advantech))
        self.assertEqual(3, sum(item.get("editionStatus") == "historical" for item in advantech))
        self.assertTrue(all(item["file"].lower().endswith(".pdf") for item in advantech))

    def test_first_batch_knowledge_is_complete_and_traceable(self):
        knowledge_ids = [item["id"] for item in self.knowledge]
        self.assertEqual(17, len(knowledge_ids))
        self.assertEqual(len(knowledge_ids), len(set(knowledge_ids)))
        first_batch = {f"KB-{number:03d}" for number in range(10, 19)}
        self.assertTrue(first_batch <= set(knowledge_ids))
        required = {
            "summary", "symptoms", "causes", "checks", "actions", "safety",
            "recoveryCriteria", "exclusions", "sourceRefs",
        }
        for item in self.knowledge:
            if item["id"] not in first_batch:
                continue
            self.assertEqual("official_document", item["verificationLevel"])
            self.assertTrue(required <= set(item), item["id"])
            for field in required:
                self.assertTrue(item[field], f"{item['id']}:{field}")
            for reference in item["sourceRefs"]:
                source = self.sources_by_id[reference["documentId"]]
                self.assertTrue(reference["pages"])
                self.assertGreaterEqual(min(reference["pages"]), 1)
                self.assertLessEqual(max(reference["pages"]), source["pageCount"])

    def test_graph_ids_relations_and_sources_are_valid(self):
        nodes = self.graph["nodes"]
        relations = self.graph["relations"]
        node_ids = [node["id"] for node in nodes]
        relation_ids = [relation["id"] for relation in relations]
        self.assertEqual(56, len(nodes))
        self.assertEqual(70, len(relations))
        self.assertEqual(len(node_ids), len(set(node_ids)))
        self.assertEqual(len(relation_ids), len(set(relation_ids)))
        node_id_set = set(node_ids)
        knowledge_ids = {item["id"] for item in self.knowledge}
        for relation in relations:
            self.assertIn(relation["source"], node_id_set, relation["id"])
            self.assertIn(relation["target"], node_id_set, relation["id"])
        for node in nodes:
            if node.get("knowledgeId"):
                self.assertIn(node["knowledgeId"], knowledge_ids, node["id"])
            for reference in node.get("sourceRefs", []):
                source = self.sources_by_id[reference["documentId"]]
                self.assertLessEqual(max(reference["pages"]), source["pageCount"])

    def test_dynamic_change_template_is_unchanged(self):
        template = self.graph["changeTemplate"]
        self.assertEqual(5, len(template["nodes"]))
        self.assertEqual(6, len(template["relations"]))


class ManualCatalogApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from .app import create_app
        except ImportError:
            from app import create_app
        cls.client = create_app().test_client()

    def test_manual_catalog_exposes_registered_files_and_knowledge_links(self):
        response = self.client.get("/api/admin/manuals")
        self.assertEqual(200, response.status_code)
        items = response.get_json()["data"]
        self.assertEqual(15, len(items))
        self.assertTrue(all(item["fileUrl"].endswith("/file") for item in items))
        linked_ids = {knowledge_id for item in items for knowledge_id in item["relatedKnowledgeIds"]}
        self.assertTrue({f"KB-{number:03d}" for number in range(10, 19)} <= linked_ids)
        cooling_manuals = [item for item in items if item["manufacturer"] == "Advantech"]
        linked_cooling_ids = {knowledge_id for item in cooling_manuals for knowledge_id in item["relatedKnowledgeIds"]}
        self.assertTrue({"KB-001", "KB-002", "KB-003", "KB-004", "KB-006", "KB-007", "KB-008", "KB-009"} <= linked_cooling_ids)

    def test_manual_pdf_endpoint_supports_range_requests(self):
        response = self.client.get(
            "/api/admin/manuals/DOC-ROCKWELL-6177R-UM002F/file",
            headers={"Range": "bytes=0-3"},
        )
        self.assertEqual(206, response.status_code)
        self.assertEqual(b"%PDF", response.data)
        self.assertEqual("application/pdf", response.mimetype)
        response.close()

    def test_unknown_manual_is_not_exposed(self):
        response = self.client.get("/api/admin/manuals/DOC-NOT-REGISTERED/file")
        self.assertEqual(404, response.status_code)


if __name__ == "__main__":
    unittest.main()
