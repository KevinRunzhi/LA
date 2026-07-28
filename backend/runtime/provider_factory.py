from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from backend.case_platform.providers import (
    RemoteModelDiagnosisProvider,
    RuleBasedDiagnosisProvider,
    SubmittedFactsTelemetryProvider,
)
from backend.runtime.config import ConfigurationError, RuntimeSettings


class JsonHttpDiagnosisClient:
    def __init__(
        self,
        endpoint: str,
        api_key: str = "",
        timeout_seconds: int = 45,
    ):
        parsed = urlparse(endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigurationError(
                "REMOTE_MODEL_BASE_URL 必须是有效的 http/https URL"
            )
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def diagnose(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "la-industrial-case-platform/1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = Request(
            self.endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except HTTPError as exc:
            raise RuntimeError(f"remote provider returned HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError(f"remote provider unavailable: {exc.reason}") from exc
        try:
            result = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("remote provider returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise RuntimeError("remote provider response must be a JSON object")
        return result


def build_diagnosis_provider(settings: RuntimeSettings):
    if settings.diagnosis_provider == "rule-based":
        return RuleBasedDiagnosisProvider()
    client = JsonHttpDiagnosisClient(
        settings.remote_model_base_url,
        settings.remote_model_api_key,
    )
    return RemoteModelDiagnosisProvider(client, settings.remote_model_name)


def build_telemetry_provider(settings: RuntimeSettings):
    if settings.telemetry_provider == "submitted-facts":
        return SubmittedFactsTelemetryProvider()
    raise ConfigurationError(
        f"unsupported telemetry provider: {settings.telemetry_provider}"
    )
