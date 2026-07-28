from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

try:
    from ..case_package import LoadedCasePackage
except ImportError:
    from case_package import LoadedCasePackage

from .errors import PlatformError


class DiagnosisProvider(Protocol):
    provider_id: str

    def diagnose(
        self,
        package: LoadedCasePackage,
        run_payload: dict[str, Any],
        request_payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Return a diagnosis DTO without mutating the run."""


class TelemetryProvider(Protocol):
    provider_id: str

    def read_facts(
        self,
        equipment_id: str,
        requested_fields: list[str],
        submitted_facts: dict[str, Any],
    ) -> dict[str, Any]:
        """Resolve telemetry facts and record their provenance."""


class KnowledgeSearchProvider(Protocol):
    provider_id: str

    def search(
        self,
        package: LoadedCasePackage,
        query: str,
        allowed_claim_ids: set[str],
    ) -> list[dict[str, Any]]:
        """Return only claims allowed by the current case and stage."""


class AttachmentStore(Protocol):
    provider_id: str

    def put(self, storage_key: str, content: bytes) -> dict[str, Any]:
        """Persist one attachment and return storage metadata."""

    def delete(self, storage_key: str) -> None:
        """Remove an attachment when the database transaction cannot commit."""


class RuleBasedDiagnosisProvider:
    provider_id = "rule-based-case-package"

    def diagnose(
        self,
        package: LoadedCasePackage,
        run_payload: dict[str, Any],
        request_payload: dict[str, Any],
    ) -> dict[str, Any]:
        diagnosis = package.modules["diagnosis"]
        submitted_facts = {
            **run_payload.get("intakeFacts", {}),
            **request_payload.get("intakeFacts", {}),
        }
        return {
            "provider": self.provider_id,
            "caseId": package.case_id,
            "packageHash": package.package_hash,
            "direction": diagnosis["direction"],
            "riskLevel": diagnosis["riskLevel"],
            "summary": diagnosis["summary"],
            "evidence": diagnosis["evidence"],
            "agents": diagnosis["agents"],
            "submittedFacts": submitted_facts,
        }


class RemoteModelDiagnosisProvider:
    """Deployment-neutral adapter for a configured remote diagnosis client."""

    provider_id = "remote-model"

    def __init__(self, client: Any | None = None, model: str | None = None):
        self.client = client
        self.model = model

    def diagnose(
        self,
        package: LoadedCasePackage,
        run_payload: dict[str, Any],
        request_payload: dict[str, Any],
    ) -> dict[str, Any]:
        if self.client is None or not self.model:
            raise PlatformError(
                "provider_not_configured",
                "远程诊断提供方尚未配置",
                503,
                {"provider": self.provider_id},
            )
        remote_request = {
            "model": self.model,
            "case": package.public_summary(),
            "packageHash": package.package_hash,
            "intakeFacts": {
                **run_payload.get("intakeFacts", {}),
                **request_payload.get("intakeFacts", {}),
            },
            "diagnosisContract": package.modules["diagnosis"],
        }
        try:
            if hasattr(self.client, "diagnose"):
                result = self.client.diagnose(remote_request)
            elif callable(self.client):
                result = self.client(remote_request)
            else:
                raise TypeError("client must be callable or expose diagnose()")
        except PlatformError:
            raise
        except Exception as exc:
            raise PlatformError(
                "provider_failed",
                "远程诊断提供方调用失败",
                502,
                {"provider": self.provider_id, "reason": str(exc)},
            ) from exc
        if not isinstance(result, dict):
            raise PlatformError(
                "provider_invalid_response",
                "远程诊断提供方返回格式无效",
                502,
                {"provider": self.provider_id},
            )
        required = {"direction", "riskLevel", "summary", "evidence", "agents"}
        missing = sorted(required - set(result))
        if missing:
            raise PlatformError(
                "provider_invalid_response",
                "远程诊断结果缺少必需字段",
                502,
                {"provider": self.provider_id, "missingFields": missing},
            )
        return {
            **result,
            "provider": self.provider_id,
            "model": self.model,
            "caseId": package.case_id,
            "packageHash": package.package_hash,
        }


class SubmittedFactsTelemetryProvider:
    provider_id = "submitted-facts"

    def read_facts(
        self,
        equipment_id: str,
        requested_fields: list[str],
        submitted_facts: dict[str, Any],
    ) -> dict[str, Any]:
        values = {
            field: submitted_facts[field]
            for field in requested_fields
            if field in submitted_facts
        }
        return {
            "provider": self.provider_id,
            "equipmentId": equipment_id,
            "values": values,
            "missingFields": sorted(set(requested_fields) - set(values)),
            "provenance": "engineer_submitted",
        }


class CatalogKnowledgeSearchProvider:
    provider_id = "case-package-claims"

    def search(
        self,
        package: LoadedCasePackage,
        query: str,
        allowed_claim_ids: set[str],
    ) -> list[dict[str, Any]]:
        normalized = query.strip().lower()
        results = []
        for claim in package.claims:
            if claim["claimId"] not in allowed_claim_ids:
                continue
            text = claim["text"]
            score = sum(
                1
                for token in normalized.replace("，", " ").split()
                if token and token in text.lower()
            )
            results.append(
                {
                    "claimId": claim["claimId"],
                    "text": text,
                    "sourceType": claim["sourceType"],
                    "verificationStatus": claim["verificationStatus"],
                    "evidenceRefs": claim["evidenceRefs"],
                    "score": score,
                }
            )
        return sorted(results, key=lambda item: (-item["score"], item["claimId"]))


@dataclass
class LocalAttachmentStore:
    root: Path
    max_bytes: int = 20 * 1024 * 1024
    provider_id: str = "local-attachment-store"

    def put(self, storage_key: str, content: bytes) -> dict[str, Any]:
        if not content:
            raise PlatformError("empty_attachment", "附件内容不能为空", 400)
        if len(content) > self.max_bytes:
            raise PlatformError(
                "attachment_too_large",
                "附件超过允许大小",
                413,
                {"maxBytes": self.max_bytes},
            )
        candidate = (self.root / storage_key).resolve()
        root = self.root.resolve()
        if not candidate.is_relative_to(root):
            raise PlatformError("invalid_storage_key", "附件存储路径不安全", 400)
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(content)
        return {
            "provider": self.provider_id,
            "storageKey": storage_key,
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }

    def delete(self, storage_key: str) -> None:
        candidate = (self.root / storage_key).resolve()
        root = self.root.resolve()
        if not candidate.is_relative_to(root):
            raise PlatformError("invalid_storage_key", "附件存储路径不安全", 400)
        candidate.unlink(missing_ok=True)
