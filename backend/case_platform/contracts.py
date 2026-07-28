from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class StringEnum(str, Enum):
    def __str__(self) -> str:
        return self.value


class UserRole(StringEnum):
    ENGINEER = "engineer"
    EXPERT = "expert"
    ADMIN = "admin"


class RouteStatus(StringEnum):
    MATCHED = "matched"
    AMBIGUOUS = "ambiguous"
    INSUFFICIENT = "insufficient"
    UNSUPPORTED = "unsupported"


class CaseRunStatus(StringEnum):
    CREATED = "created"
    INTAKE_CONFIRMED = "intake_confirmed"
    DIAGNOSED = "diagnosed"
    PLAN_CONFIRMED = "plan_confirmed"
    IN_PROGRESS = "in_progress"
    ENGINEER_SUBMITTED = "engineer_submitted"
    EXPERT_REVIEWING = "expert_reviewing"
    APPROVED = "approved"
    REJECTED = "rejected"
    PUBLISHED = "published"
    SYNCED = "synced"


ALLOWED_TRANSITIONS: dict[CaseRunStatus, dict[CaseRunStatus, set[UserRole]]] = {
    CaseRunStatus.CREATED: {
        CaseRunStatus.INTAKE_CONFIRMED: {UserRole.ENGINEER},
    },
    CaseRunStatus.INTAKE_CONFIRMED: {
        CaseRunStatus.DIAGNOSED: {UserRole.ENGINEER},
    },
    CaseRunStatus.DIAGNOSED: {
        CaseRunStatus.PLAN_CONFIRMED: {UserRole.ENGINEER},
    },
    CaseRunStatus.PLAN_CONFIRMED: {
        CaseRunStatus.IN_PROGRESS: {UserRole.ENGINEER},
    },
    CaseRunStatus.IN_PROGRESS: {
        CaseRunStatus.ENGINEER_SUBMITTED: {UserRole.ENGINEER},
    },
    CaseRunStatus.ENGINEER_SUBMITTED: {
        CaseRunStatus.EXPERT_REVIEWING: {UserRole.EXPERT},
    },
    CaseRunStatus.EXPERT_REVIEWING: {
        CaseRunStatus.APPROVED: {UserRole.EXPERT},
        CaseRunStatus.REJECTED: {UserRole.EXPERT},
    },
    CaseRunStatus.REJECTED: {
        CaseRunStatus.IN_PROGRESS: {UserRole.ENGINEER},
    },
    CaseRunStatus.APPROVED: {
        CaseRunStatus.PUBLISHED: {UserRole.EXPERT},
    },
    CaseRunStatus.PUBLISHED: {
        CaseRunStatus.SYNCED: {UserRole.ENGINEER},
    },
}


@dataclass(frozen=True)
class RouteCandidate:
    case_id: str
    fault_code: str
    score: int
    matched_facts: list[dict[str, Any]] = field(default_factory=list)
    excluded_facts: list[dict[str, Any]] = field(default_factory=list)
    negated_facts: list[dict[str, Any]] = field(default_factory=list)
    missing_facts: list[str] = field(default_factory=list)
    hard_excluded: bool = False

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        return {
            "caseId": result["case_id"],
            "faultCode": result["fault_code"],
            "score": result["score"],
            "matchedFacts": result["matched_facts"],
            "excludedFacts": result["excluded_facts"],
            "negatedFacts": result["negated_facts"],
            "missingFacts": result["missing_facts"],
            "hardExcluded": result["hard_excluded"],
        }


@dataclass(frozen=True)
class RoutingDecision:
    route_status: RouteStatus
    routing_algorithm_version: str
    registry_version: str
    normalized_input: str
    candidates: list[RouteCandidate]
    next_question: str | None = None
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "routeStatus": self.route_status,
            "routingAlgorithmVersion": self.routing_algorithm_version,
            "registryVersion": self.registry_version,
            "normalizedInput": self.normalized_input,
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "nextQuestion": self.next_question,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class CaseRunView:
    run_id: str
    case_id: str
    package_version: str
    package_hash: str
    status: CaseRunStatus
    revision: int
    payload: dict[str, Any]
    created_by: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "caseId": self.case_id,
            "packageVersion": self.package_version,
            "packageHash": self.package_hash,
            "status": self.status,
            "revision": self.revision,
            "payload": self.payload,
            "createdBy": self.created_by,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }
