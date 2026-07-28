from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Mapping


class ConfigurationError(ValueError):
    """Raised before service startup when deployment configuration is invalid."""


VALID_LOG_LEVELS = {
    "CRITICAL",
    "ERROR",
    "WARNING",
    "INFO",
    "DEBUG",
    "NOTSET",
}


def _integer(
    environment: Mapping[str, str],
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    raw = environment.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} 必须是整数") from exc
    if not minimum <= value <= maximum:
        raise ConfigurationError(
            f"{name} 必须位于 {minimum} 到 {maximum} 之间"
        )
    return value


def _boolean(
    environment: Mapping[str, str],
    name: str,
    default: bool,
) -> bool:
    raw = environment.get(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} 必须是 true 或 false")


def _path(repository_root: Path, raw: str) -> Path:
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = repository_root / candidate
    return candidate.resolve()


@dataclass(frozen=True)
class RuntimeSettings:
    repository_root: Path
    environment: str
    host: str
    port: int
    database_path: Path
    attachment_root: Path
    attachment_max_bytes: int
    frontend_dist: Path
    log_level: str
    json_access_log: bool
    readiness_requires_frontend: bool
    trust_proxy_headers: bool
    cors_allowed_origins: tuple[str, ...]
    diagnosis_provider: str
    remote_model_base_url: str
    remote_model_name: str
    remote_model_api_key: str
    telemetry_provider: str
    service_name: str = "la-industrial-case-platform"

    @classmethod
    def from_environment(
        cls,
        repository_root: Path,
        environment: Mapping[str, str] | None = None,
    ) -> "RuntimeSettings":
        values = environment if environment is not None else os.environ
        root = repository_root.resolve()
        deployment_environment = values.get("LA_ENV", "development").strip().lower()
        if deployment_environment not in {"development", "test", "production"}:
            raise ConfigurationError(
                "LA_ENV 必须是 development、test 或 production"
            )
        log_level = values.get("LOG_LEVEL", "INFO").strip().upper()
        if log_level not in VALID_LOG_LEVELS:
            raise ConfigurationError(f"LOG_LEVEL 不受支持：{log_level}")
        diagnosis_provider = values.get(
            "DIAGNOSIS_PROVIDER",
            "rule-based",
        ).strip()
        if diagnosis_provider not in {"rule-based", "remote-http"}:
            raise ConfigurationError(
                "DIAGNOSIS_PROVIDER 必须是 rule-based 或 remote-http"
            )
        remote_model_base_url = values.get("REMOTE_MODEL_BASE_URL", "").strip()
        remote_model_name = values.get("REMOTE_MODEL_NAME", "").strip()
        remote_model_api_key = values.get("REMOTE_MODEL_API_KEY", "").strip()
        if diagnosis_provider == "remote-http" and (
            not remote_model_base_url or not remote_model_name
        ):
            raise ConfigurationError(
                "remote-http 诊断需要 REMOTE_MODEL_BASE_URL 和 REMOTE_MODEL_NAME"
            )
        telemetry_provider = values.get(
            "TELEMETRY_PROVIDER",
            "submitted-facts",
        ).strip()
        if telemetry_provider != "submitted-facts":
            raise ConfigurationError(
                "当前部署只支持 TELEMETRY_PROVIDER=submitted-facts"
            )
        cors_default = "*" if deployment_environment == "development" else ""
        cors_allowed_origins = tuple(
            item.strip()
            for item in values.get(
                "CORS_ALLOWED_ORIGINS",
                cors_default,
            ).split(",")
            if item.strip()
        )
        return cls(
            repository_root=root,
            environment=deployment_environment,
            host=values.get("APP_HOST", "0.0.0.0").strip() or "0.0.0.0",
            port=_integer(
                values,
                "APP_PORT",
                8080,
                minimum=1,
                maximum=65535,
            ),
            database_path=_path(
                root,
                values.get(
                    "PRESENTATION_DATABASE_PATH",
                    "backend/data/presentation/presentation.db",
                ),
            ),
            attachment_root=_path(
                root,
                values.get("ATTACHMENT_STORAGE_ROOT", "run/attachments"),
            ),
            attachment_max_bytes=_integer(
                values,
                "ATTACHMENT_MAX_BYTES",
                20 * 1024 * 1024,
                minimum=1024,
                maximum=1024 * 1024 * 1024,
            ),
            frontend_dist=_path(
                root,
                values.get("FRONTEND_DIST_PATH", "frontend/dist"),
            ),
            log_level=log_level,
            json_access_log=_boolean(values, "JSON_ACCESS_LOG", True),
            readiness_requires_frontend=_boolean(
                values,
                "READINESS_REQUIRES_FRONTEND",
                deployment_environment == "production",
            ),
            trust_proxy_headers=_boolean(
                values,
                "TRUST_PROXY_HEADERS",
                False,
            ),
            cors_allowed_origins=cors_allowed_origins,
            diagnosis_provider=diagnosis_provider,
            remote_model_base_url=remote_model_base_url,
            remote_model_name=remote_model_name,
            remote_model_api_key=remote_model_api_key,
            telemetry_provider=telemetry_provider,
        )

    def with_database(self, database_path: Path) -> "RuntimeSettings":
        database = database_path.resolve()
        return replace(
            self,
            database_path=database,
            attachment_root=database.parent / "attachments",
            environment="test",
            readiness_requires_frontend=False,
        )

    def public_summary(self) -> dict[str, object]:
        return {
            "service": self.service_name,
            "environment": self.environment,
            "host": self.host,
            "port": self.port,
            "databasePath": str(self.database_path),
            "attachmentRoot": str(self.attachment_root),
            "attachmentMaxBytes": self.attachment_max_bytes,
            "frontendDist": str(self.frontend_dist),
            "logLevel": self.log_level,
            "jsonAccessLog": self.json_access_log,
            "readinessRequiresFrontend": self.readiness_requires_frontend,
            "trustProxyHeaders": self.trust_proxy_headers,
            "corsAllowedOrigins": list(self.cors_allowed_origins),
            "diagnosisProvider": self.diagnosis_provider,
            "telemetryProvider": self.telemetry_provider,
        }
