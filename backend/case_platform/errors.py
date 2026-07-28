from __future__ import annotations

from typing import Any


class PlatformError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


def validation_error(message: str, field: str | None = None) -> PlatformError:
    details = {"field": field} if field else {}
    return PlatformError("validation_error", message, 400, details)
