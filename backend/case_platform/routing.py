from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

try:
    from ..case_package import CasePackageRegistry
except ImportError:
    from case_package import CasePackageRegistry

from .contracts import RouteCandidate, RouteStatus, RoutingDecision
from .errors import validation_error


ALLOWED_ROUTING_FIELDS = {
    "intakeSessionId",
    "description",
    "equipment",
    "alarms",
    "confirmedTags",
    "measurements",
    "location",
}
NEGATION_PREFIXES = (
    "没有",
    "无",
    "未出现",
    "未发现",
    "不存在",
    "不是",
    "并非",
    "未",
)
UNSUPPORTED_TERMS = (
    "rtc电池",
    "rtc 电池",
    "硬盘损坏",
    "ssd损坏",
    "ssd 损坏",
    "通信中断",
    "显示器故障",
    "温度凝露",
    "凝露",
)
CATEGORY_QUESTIONS = {
    "equipment": "请补充工控机品牌或具体型号。",
    "alarm": "请补充面板指示灯或系统告警信息。",
    "symptom": "请补充无法上电、温升、异响等现场现象。",
    "measurement": "请补充风扇转速、温度或设备端电压等关键测量。",
}


class DeterministicCaseRouter:
    def __init__(self, registry: CasePackageRegistry):
        self.registry = registry
        config = registry.routing_config
        self.algorithm_version = config["algorithmVersion"]
        self.min_score = int(config["minScore"])
        self.min_margin = int(config["minMargin"])
        self.max_input_length = int(config["maxInputLength"])
        self.weights = config["weights"]

    def route(self, payload: dict[str, Any]) -> RoutingDecision:
        if not isinstance(payload, dict):
            raise validation_error("路由请求必须是 JSON 对象")
        unknown = sorted(set(payload) - ALLOWED_ROUTING_FIELDS)
        if unknown:
            raise validation_error("路由请求包含未知字段", unknown[0])

        raw_text = self._collect_text(payload)
        if not raw_text.strip():
            raise validation_error("请填写现场故障描述", "description")
        if len(raw_text) > self.max_input_length:
            raise validation_error(
                f"路由输入不得超过 {self.max_input_length} 个字符",
                "description",
            )
        normalized = self.normalize(raw_text)
        candidates = [
            self._score_item(item, normalized)
            for item in self.registry.runnable_items()
            if item["mode"] in {"interactive", "interactive_demo"}
        ]
        candidates.sort(key=lambda candidate: (-candidate.score, candidate.case_id))
        visible = candidates[:2]

        conflicted = [
            candidate
            for candidate in candidates
            if candidate.hard_excluded and candidate.matched_facts
        ]
        if len(conflicted) >= 2:
            return RoutingDecision(
                route_status=RouteStatus.AMBIGUOUS,
                routing_algorithm_version=self.algorithm_version,
                registry_version=self.registry.registry_version,
                normalized_input=normalized,
                candidates=visible,
                next_question="输入同时包含供电与散热核心信号，请确认当前设备型号和主告警。",
                reason="多个故障域同时出现核心命中与相互排除信号。",
            )

        available = [candidate for candidate in candidates if not candidate.hard_excluded]
        top = available[0] if available else None
        second = available[1] if len(available) > 1 else None
        margin = top.score - second.score if top and second else top.score if top else 0

        if top and top.score >= self.min_score:
            if second and second.score >= self.min_score and margin < self.min_margin:
                return RoutingDecision(
                    route_status=RouteStatus.AMBIGUOUS,
                    routing_algorithm_version=self.algorithm_version,
                    registry_version=self.registry.registry_version,
                    normalized_input=normalized,
                    candidates=visible,
                    next_question="检测到多个接近的故障方向，请确认设备型号或核心告警。",
                    reason="多个案例达到最低分，但领先差值不足。",
                )
            return RoutingDecision(
                route_status=RouteStatus.MATCHED,
                routing_algorithm_version=self.algorithm_version,
                registry_version=self.registry.registry_version,
                normalized_input=normalized,
                candidates=visible,
                reason="最高分案例达到最低分并满足领先差值。",
            )

        if any(term in normalized for term in UNSUPPORTED_TERMS):
            return RoutingDecision(
                route_status=RouteStatus.UNSUPPORTED,
                routing_algorithm_version=self.algorithm_version,
                registry_version=self.registry.registry_version,
                normalized_input=normalized,
                candidates=visible,
                reason="输入明确属于当前完整案例库尚未覆盖的故障。",
            )

        missing = top.missing_facts if top else ["equipment", "alarm", "symptom"]
        next_category = missing[0] if missing else "equipment"
        return RoutingDecision(
            route_status=RouteStatus.INSUFFICIENT,
            routing_algorithm_version=self.algorithm_version,
            registry_version=self.registry.registry_version,
            normalized_input=normalized,
            candidates=visible,
            next_question=CATEGORY_QUESTIONS.get(
                next_category,
                "请补充设备、告警或关键测量信息。",
            ),
            reason="现有信息不足以安全进入完整案例。",
        )

    def _score_item(
        self,
        item: dict[str, Any],
        normalized: str,
    ) -> RouteCandidate:
        rules = item["matchRules"]
        matched: list[dict[str, Any]] = []
        negated: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        matched_categories: set[str] = set()
        score = 0

        categories = (
            ("equipmentExact", "equipment", self.weights["equipmentExact"], False),
            ("equipmentGeneric", "equipment", self.weights["equipmentGeneric"], False),
            ("alarms", "alarm", self.weights["alarm"], False),
            ("symptoms", "symptom", self.weights["symptom"], True),
            ("measurements", "measurement", self.weights["measurement"], True),
            ("contexts", "context", self.weights["context"], True),
        )
        for rule_name, category, weight, score_each in categories:
            matches = self._match_terms(normalized, rules[rule_name])
            positive = [term for term, is_negated in matches if not is_negated]
            negative = [term for term, is_negated in matches if is_negated]
            if positive:
                matched_categories.add(category)
                applied = weight * len(positive) if score_each else weight
                score += applied
                for term in positive:
                    matched.append(
                        {"category": category, "term": term, "weight": weight}
                    )
            for term in negative:
                negated.append({"category": category, "term": term})

        exclusion_matches = [
            term
            for term, is_negated in self._match_terms(normalized, rules["exclusions"])
            if not is_negated
        ]
        hard_excluded = bool(exclusion_matches)
        for term in exclusion_matches:
            score += self.weights["exclusion"]
            excluded.append(
                {
                    "category": "exclusion",
                    "term": term,
                    "weight": self.weights["exclusion"],
                }
            )

        missing = [
            category
            for category in ("equipment", "alarm", "symptom", "measurement")
            if category not in matched_categories
        ]
        return RouteCandidate(
            case_id=item["id"],
            fault_code=item["faultCode"],
            score=score,
            matched_facts=matched,
            excluded_facts=excluded,
            negated_facts=negated,
            missing_facts=missing,
            hard_excluded=hard_excluded,
        )

    @classmethod
    def _match_terms(
        cls,
        normalized: str,
        terms: Iterable[str],
    ) -> list[tuple[str, bool]]:
        result: list[tuple[str, bool]] = []
        seen: set[str] = set()
        for raw_term in terms:
            term = cls.normalize(raw_term)
            if term in seen:
                continue
            seen.add(term)
            start = normalized.find(term)
            if start < 0:
                continue
            prefix = normalized[max(0, start - 8):start]
            is_negated = any(prefix.endswith(marker) for marker in NEGATION_PREFIXES)
            result.append((raw_term, is_negated))
        return result

    @staticmethod
    def _collect_text(payload: dict[str, Any]) -> str:
        values: list[str] = []

        def collect(value: Any):
            if value is None:
                return
            if isinstance(value, dict):
                for key in sorted(value):
                    collect(value[key])
                return
            if isinstance(value, (list, tuple)):
                for item in value:
                    collect(item)
                return
            values.append(str(value))

        for key in (
            "description",
            "equipment",
            "alarms",
            "confirmedTags",
            "measurements",
            "location",
        ):
            collect(payload.get(key))
        return " ".join(values)

    @staticmethod
    def normalize(value: str) -> str:
        text = unicodedata.normalize("NFKC", value).lower()
        text = text.replace("摄氏度", "℃").replace("°c", "℃")
        text = re.sub(
            r"(?<!\d)(\d+(?:\.\d+)?)\s*mv\b",
            lambda match: f"{float(match.group(1)) / 1000:g}v",
            text,
        )
        text = re.sub(r"(\d+(?:\.\d+)?)\s*v\b", r"\1v", text)
        text = re.sub(r"(\d+(?:\.\d+)?)\s*rpm\b", r"\1rpm", text)
        text = re.sub(r"[\s,，。；;：:、_]+", "", text)
        return text
