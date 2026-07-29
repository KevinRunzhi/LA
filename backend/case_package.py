from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


SUPPORTED_SCHEMA_PREFIX = "1.1."
MODULE_NAMES = (
    "intake",
    "diagnosis",
    "guide",
    "assistant",
    "output",
    "feedbackAndGraph",
)
MODULE_SCHEMA_FILES = {
    "intake": "intake.schema.json",
    "diagnosis": "diagnosis.schema.json",
    "guide": "guide.schema.json",
    "assistant": "assistant.schema.json",
    "output": "output.schema.json",
    "feedbackAndGraph": "feedback-and-graph.schema.json",
}


class CasePackageError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class LoadedCasePackage:
    case_id: str
    package_version: str
    package_hash: str
    identity: dict[str, Any]
    provenance: dict[str, Any]
    capabilities: list[str]
    claims: list[dict[str, Any]]
    modules: dict[str, dict[str, Any]]

    def public_summary(self) -> dict[str, Any]:
        return {
            "caseId": self.case_id,
            "packageVersion": self.package_version,
            "packageHash": self.package_hash,
            "identity": self.identity,
            "capabilities": self.capabilities,
        }


class CasePackageRegistry:
    def __init__(
        self,
        cases_dir: Path,
        shared_sources_file: Path | None = None,
        schemas_dir: Path | None = None,
    ):
        self.cases_dir = cases_dir.resolve()
        self.schemas_dir = (schemas_dir or (self.cases_dir / "schemas")).resolve()
        self.registry_file = self.cases_dir / "case_registry.json"
        self.shared_sources_file = shared_sources_file
        self._schema_cache: dict[str, dict[str, Any]] = {}
        self._registry: dict[str, Any] | None = None
        self._packages: dict[str, LoadedCasePackage] = {}
        self._errors: dict[str, CasePackageError] = {}

    def load(self) -> "CasePackageRegistry":
        registry = self._load_json(self.registry_file, self.cases_dir)
        self._validate("registry.schema.json", registry, "案例注册表")
        self._assert_supported_version(registry["schemaVersion"], "案例注册表")

        packages: dict[str, LoadedCasePackage] = {}
        errors: dict[str, CasePackageError] = {}
        seen_ids: set[str] = set()
        for item in registry["items"]:
            case_id = item["id"]
            if case_id in seen_ids:
                raise CasePackageError("duplicate_case_id", "案例注册表包含重复案例 ID")
            seen_ids.add(case_id)
            try:
                package = self._load_package(item)
            except CasePackageError as exc:
                errors[case_id] = exc
                continue
            packages[case_id] = package

        self._registry = registry
        self._packages = packages
        self._errors = errors
        return self

    @property
    def registry_version(self) -> str:
        self._require_loaded()
        return str(self._registry["registryVersion"])

    @property
    def routing_config(self) -> dict[str, Any]:
        self._require_loaded()
        return dict(self._registry["routing"])

    @property
    def load_errors(self) -> dict[str, CasePackageError]:
        self._require_loaded()
        return dict(self._errors)

    def runnable_items(self) -> list[dict[str, Any]]:
        self._require_loaded()
        return [
            dict(item)
            for item in self._registry["items"]
            if item["id"] in self._packages
        ]

    def list_packages(self) -> list[LoadedCasePackage]:
        self._require_loaded()
        return [
            self._packages[item["id"]]
            for item in self._registry["items"]
            if item["id"] in self._packages
        ]

    def get(self, case_id: str) -> LoadedCasePackage:
        self._require_loaded()
        if case_id in self._errors:
            raise CasePackageError("case_package_invalid", "案例包未通过校验")
        try:
            return self._packages[case_id]
        except KeyError as exc:
            raise CasePackageError("case_not_found", "未找到案例") from exc

    def registry_item(self, case_id: str) -> dict[str, Any]:
        self._require_loaded()
        item = next(
            (entry for entry in self._registry["items"] if entry["id"] == case_id),
            None,
        )
        if item is None:
            raise CasePackageError("case_not_found", "未找到案例")
        return dict(item)

    def _require_loaded(self):
        if self._registry is None:
            raise RuntimeError("案例注册表尚未加载")

    def _load_package(self, registry_item: dict[str, Any]) -> LoadedCasePackage:
        manifest_path = self._safe_path(self.cases_dir, registry_item["package"])
        package_dir = manifest_path.parent.resolve()
        if package_dir.name != registry_item["id"]:
            raise CasePackageError("case_identity_mismatch", "案例目录与注册表 ID 不一致")

        manifest = self._load_json(manifest_path, package_dir)
        self._validate("manifest.schema.json", manifest, "案例 manifest")
        self._assert_supported_version(manifest["schemaVersion"], "案例 manifest")
        case_id = manifest["identity"]["caseId"]
        if case_id != registry_item["id"] or case_id != package_dir.name:
            raise CasePackageError("case_identity_mismatch", "案例 ID 在注册表、目录和 manifest 中不一致")
        if manifest["identity"]["faultCode"] != registry_item["faultCode"]:
            raise CasePackageError("case_identity_mismatch", "案例故障编码与注册表不一致")

        modules: dict[str, dict[str, Any]] = {}
        for module_name in MODULE_NAMES:
            module_path = self._safe_path(package_dir, manifest["modules"][module_name])
            module = self._load_json(module_path, package_dir)
            self._validate(
                MODULE_SCHEMA_FILES[module_name],
                module,
                f"{module_name} 模块",
            )
            self._assert_supported_version(module["schemaVersion"], f"{module_name} 模块")
            modules[module_name] = module

        self._validate_references(manifest, modules)
        package_hash = self._content_hash(manifest, modules)
        return LoadedCasePackage(
            case_id=case_id,
            package_version=manifest["packageVersion"],
            package_hash=package_hash,
            identity=manifest["identity"],
            provenance=manifest["provenance"],
            capabilities=list(manifest["capabilities"]),
            claims=list(manifest["claims"]),
            modules=modules,
        )

    def _schema(self, filename: str) -> dict[str, Any]:
        if filename not in self._schema_cache:
            self._schema_cache[filename] = self._load_json(
                self.schemas_dir / filename,
                self.schemas_dir,
            )
        return self._schema_cache[filename]

    def _validate(self, schema_file: str, value: Any, label: str):
        errors = sorted(
            Draft202012Validator(self._schema(schema_file)).iter_errors(value),
            key=lambda item: tuple(str(part) for part in item.absolute_path),
        )
        if errors:
            first = errors[0]
            location = ".".join(str(part) for part in first.absolute_path) or "$"
            raise CasePackageError(
                "schema_validation_error",
                f"{label}未通过 Schema 校验：{location} {first.message}",
            )

    @staticmethod
    def _assert_supported_version(version: str, label: str):
        if not version.startswith(SUPPORTED_SCHEMA_PREFIX):
            raise CasePackageError(
                "unsupported_schema_version",
                f"{label}使用了不支持的 Schema 版本",
            )

    @staticmethod
    def _content_hash(
        manifest: dict[str, Any],
        modules: dict[str, dict[str, Any]],
    ) -> str:
        canonical = json.dumps(
            {"manifest": manifest, "modules": modules},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    def _safe_path(self, root: Path, relative_path: str) -> Path:
        candidate_input = Path(relative_path)
        if candidate_input.is_absolute() or ".." in candidate_input.parts:
            raise CasePackageError("unsafe_package_path", "案例包引用路径不安全")
        root = root.resolve()
        candidate = (root / candidate_input).resolve()
        if not candidate.is_relative_to(root):
            raise CasePackageError("unsafe_package_path", "案例包引用路径越界")
        cursor = root
        for part in candidate_input.parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise CasePackageError("unsafe_package_path", "案例包不允许使用符号链接")
        return candidate

    def _load_json(self, path: Path, allowed_root: Path) -> dict[str, Any]:
        safe_path = self._safe_path(allowed_root, str(path.resolve().relative_to(allowed_root.resolve())))
        if not safe_path.is_file():
            raise CasePackageError("case_package_missing", "案例包缺少必需文件")
        try:
            with safe_path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise CasePackageError("invalid_json", "案例包 JSON 无法解析") from exc
        if not isinstance(value, dict):
            raise CasePackageError("invalid_json", "案例包 JSON 顶层必须是对象")
        return value

    def _shared_source_pages(self) -> dict[str, int]:
        if self.shared_sources_file is None:
            return {}
        with self.shared_sources_file.open("r", encoding="utf-8") as handle:
            catalog = json.load(handle)
        return {
            item["id"]: int(item["pageCount"])
            for item in catalog.get("items", [])
        }

    def _validate_references(
        self,
        manifest: dict[str, Any],
        modules: dict[str, dict[str, Any]],
    ):
        claims = manifest["claims"]
        claim_ids = self._unique_ids(claims, "claimId", "claim")
        source_pages = self._shared_source_pages()
        for claim in claims:
            for reference in claim["evidenceRefs"]:
                document_id = reference["documentId"]
                if source_pages and document_id not in source_pages:
                    raise CasePackageError("broken_reference", "claim 引用了不存在的手册")
                if source_pages and max(reference["pages"]) > source_pages[document_id]:
                    raise CasePackageError("broken_reference", "claim 引用了超出手册范围的页码")

        intake_field_ids = self._unique_ids(
            modules["intake"]["fields"],
            "id",
            "intake field",
        )
        diagnosis_evidence_ids = self._unique_ids(
            modules["diagnosis"]["evidence"],
            "id",
            "diagnosis evidence",
        )
        step_ids = self._unique_ids(modules["guide"]["steps"], "id", "guide step")
        check_ids: set[str] = set()
        measurement_ids: set[str] = set()
        for step in modules["guide"]["steps"]:
            step_check_ids = self._unique_ids(step["checks"], "id", "guide check")
            if check_ids & step_check_ids:
                raise CasePackageError("duplicate_id", "guide check ID 重复")
            check_ids |= step_check_ids
            step_measurement_ids = self._unique_ids(
                step["measurements"],
                "id",
                "guide measurement",
            )
            if measurement_ids & step_measurement_ids:
                raise CasePackageError("duplicate_id", "guide measurement ID 重复")
            measurement_ids |= step_measurement_ids
            for claim_id in step["claimIds"]:
                self._require_reference(claim_id, claim_ids, "guide claim")

        for evidence in modules["diagnosis"]["evidence"]:
            self._require_reference(evidence["claimId"], claim_ids, "diagnosis claim")
            for field_id in evidence["intakeFieldIds"]:
                self._require_reference(field_id, intake_field_ids, "diagnosis intake field")

        topic_ids = self._unique_ids(
            modules["assistant"]["topics"],
            "id",
            "assistant topic",
        )
        for topic in modules["assistant"]["topics"]:
            for step_id in topic["allowedStepIds"]:
                self._require_reference(step_id, step_ids, "assistant step")
            for claim_id in topic["claimIds"]:
                self._require_reference(claim_id, claim_ids, "assistant claim")

        for step in modules["guide"]["steps"]:
            for topic_id in step["assistantTopicIds"]:
                self._require_reference(topic_id, topic_ids, "guide assistant topic")
            for criterion in step["completionCriteria"]:
                allowed = check_ids | measurement_ids
                self._require_reference(criterion["refId"], allowed, "completion criterion")

        result_field_ids = self._unique_ids(
            modules["output"]["engineerResultFields"],
            "id",
            "engineer result field",
        )
        for section in modules["output"]["jobCard"]["sections"]:
            for field_id in section["fieldIds"]:
                self._require_reference(field_id, result_field_ids, "job card field")

        feedback = modules["feedbackAndGraph"]
        if feedback["knowledgeProposal"]["knowledgeId"] != feedback["graphProposal"]["knowledgeId"]:
            raise CasePackageError("broken_reference", "知识候选与图谱候选的 knowledgeId 不一致")
        node_ids = self._unique_ids(
            feedback["graphProposal"]["nodes"],
            "id",
            "graph node",
        )
        self._unique_ids(
            feedback["graphProposal"]["relations"],
            "id",
            "graph relation",
        )
        for relation in feedback["graphProposal"]["relations"]:
            self._require_reference(relation["source"], node_ids, "graph source")
            self._require_reference(relation["target"], node_ids, "graph target")

    @staticmethod
    def _unique_ids(items: list[dict[str, Any]], key: str, label: str) -> set[str]:
        values = [item[key] for item in items]
        if len(values) != len(set(values)):
            raise CasePackageError("duplicate_id", f"{label} ID 重复")
        return set(values)

    @staticmethod
    def _require_reference(value: str, allowed: set[str], label: str):
        if value not in allowed:
            raise CasePackageError("broken_reference", f"{label} 引用了不存在的 ID")
