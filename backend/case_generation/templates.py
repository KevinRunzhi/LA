from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError


class CaseGenerationTemplateRegistry:
    REQUIRED_TEMPLATE_FIELDS = {
        "id", "version", "faultDomain", "title", "keywords", "exclusions",
        "requiredEvidence", "intakeFields", "causeCategories", "steps",
        "assistantTopics", "outputFields", "graphTypes",
        "safetyChecks", "forbiddenAutomaticFields", "minSteps", "maxSteps",
    }

    def __init__(self, root: Path):
        self.root = root.resolve()
        self._templates: dict[str, dict[str, Any]] = {}
        self.contracts: dict[str, dict[str, Any]] = {}
        self.registry_version = ""

    def load(self) -> "CaseGenerationTemplateRegistry":
        registry = self._read(self.root / "template-registry.json")
        if registry.get("schemaVersion") != "1.0.0":
            raise PlatformError("generation_template_invalid", "生成模板注册表版本无效", 500)
        contracts = registry.get("contracts")
        if not isinstance(contracts, dict) or set(contracts) != {
            "agent", "schemas", "relations", "safety"
        }:
            raise PlatformError("generation_template_invalid", "生成模板公共合同不完整", 500)
        self.contracts = {
            name: self._read(self._safe(path))
            for name, path in contracts.items()
        }
        templates = {}
        for item in registry.get("items", []):
            path = self._safe(item["file"])
            template = self._read(path)
            if template.get("id") != item["id"] or template.get("version") != item["version"]:
                raise PlatformError("generation_template_invalid", "生成模板身份不一致", 500)
            missing = self.REQUIRED_TEMPLATE_FIELDS - set(template)
            arrays = self.REQUIRED_TEMPLATE_FIELDS - {
                "id", "version", "faultDomain", "title", "minSteps", "maxSteps"
            }
            if missing or any(not isinstance(template.get(name), list) or not template[name] for name in arrays):
                raise PlatformError(
                    "generation_template_invalid",
                    f"生成模板 {item['id']} 缺少必需字段或非空列表",
                    500,
                )
            if not (
                isinstance(template["minSteps"], int)
                and isinstance(template["maxSteps"], int)
                and 1 <= template["minSteps"] <= template["maxSteps"] <= 30
            ):
                raise PlatformError("generation_template_invalid", "生成模板步骤范围无效", 500)
            templates[item["id"]] = template
        if not templates:
            raise PlatformError("generation_template_empty", "没有可用案例生成模板", 500)
        self._templates = templates
        self.registry_version = str(registry["registryVersion"])
        return self

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": item["id"],
                "version": item["version"],
                "faultDomain": item["faultDomain"],
                "title": item["title"],
                "requiredEvidence": item["requiredEvidence"],
                "steps": item["steps"],
            }
            for item in self._templates.values()
        ]

    def get(self, template_id: str) -> dict[str, Any]:
        try:
            return json.loads(json.dumps(self._templates[template_id], ensure_ascii=False))
        except KeyError as exc:
            raise PlatformError("generation_template_not_found", "未找到案例生成模板", 404) from exc

    def match(self, text: str) -> tuple[dict[str, Any], dict[str, int]]:
        normalized = text.lower()
        scores = {
            template_id: sum(keyword.lower() in normalized for keyword in item["keywords"])
            for template_id, item in self._templates.items()
        }
        selected = max(scores, key=scores.get)
        return self.get(selected), scores

    def validate_artifact(self, artifact_type: str, content: dict[str, Any]) -> None:
        schemas = self.contracts["schemas"].get("artifactSchemas") or {}
        schema = schemas.get(artifact_type)
        if schema is None:
            raise PlatformError(
                "agent_output_schema_failed",
                f"未注册 Agent artifact Schema：{artifact_type}",
                500,
            )
        missing = set(schema.get("required") or []) - set(content)
        if missing:
            raise PlatformError(
                "agent_output_schema_failed",
                f"{artifact_type} 缺少字段：{sorted(missing)}",
                422,
            )

    def _safe(self, relative: str) -> Path:
        value = Path(relative)
        if value.is_absolute() or ".." in value.parts:
            raise PlatformError("generation_template_path_invalid", "生成模板路径无效", 500)
        candidate = (self.root / value).resolve()
        if self.root not in candidate.parents:
            raise PlatformError("generation_template_path_invalid", "生成模板路径越界", 500)
        return candidate

    @staticmethod
    def _read(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PlatformError("generation_template_invalid", "生成模板无法读取", 500) from exc
        if not isinstance(value, dict):
            raise PlatformError("generation_template_invalid", "生成模板必须是对象", 500)
        return value
