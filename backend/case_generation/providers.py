from __future__ import annotations

import copy
import hashlib
import re
from typing import Any, Protocol


class CaseGenerationProvider(Protocol):
    provider_id: str
    agent_version: str

    def parse_documents(self, chunks: list[dict[str, Any]]) -> dict[str, Any]: ...
    def extract_evidence(self, sections: list[dict[str, Any]]) -> dict[str, Any]: ...
    def plan(self, template: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]: ...
    def generate_modules(
        self,
        template: dict[str, Any],
        draft: dict[str, Any],
        evidence: list[dict[str, Any]],
        job_id: str,
    ) -> dict[str, dict[str, Any]]: ...
    def repair_modules(
        self,
        template: dict[str, Any],
        draft: dict[str, Any],
        modules: dict[str, dict[str, Any]],
        errors: list[dict[str, Any]],
        attempt: int,
    ) -> dict[str, dict[str, Any]]: ...


class StructuredLocalGenerationProvider:
    provider_id = "structured-local"
    agent_version = "1.0.0"

    EVIDENCE_TERMS = {
        "alarm": ("告警", "报警", "alarm", "fault"),
        "symptom": ("异常", "失败", "中断", "不亮", "低速", "堵塞", "凝露"),
        "cause": ("原因", "导致", "故障", "损坏", "松动", "老化"),
        "check": ("检查", "确认", "inspect", "check"),
        "measurement": ("测量", "电压", "转速", "温度", "湿度", "measure"),
        "threshold": ("低于", "高于", "超过", "范围", "阈值", "rpm", "°c", "volt"),
        "procedure": ("步骤", "拆卸", "安装", "清理", "更换", "恢复"),
        "connector": ("接线", "端子", "connector", "pin", "接口"),
        "safety": ("断电", "防静电", "安全", "禁止", "警告", "caution"),
        "recovery": ("恢复", "重启", "更换后", "验证"),
        "verification": ("验证", "测试", "确认正常", "观察"),
    }

    def parse_documents(self, chunks: list[dict[str, Any]]) -> dict[str, Any]:
        sections = []
        seen = set()
        for chunk in chunks:
            text = re.sub(r"\s+", " ", str(chunk.get("text") or "")).strip()
            if not text:
                continue
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest in seen:
                continue
            seen.add(digest)
            sections.append(
                {
                    "sectionId": f"SEC-{digest[:16].upper()}",
                    "title": chunk.get("title") or f"第 {chunk.get('pageNumber', 0)} 页",
                    "pages": [int(chunk.get("pageNumber") or 1)],
                    "text": text[:5000],
                    "tags": self._tags(text),
                    "documentId": chunk.get("documentId"),
                    "chunkId": chunk.get("chunkId"),
                }
            )
        return {"sections": sections, "sectionCount": len(sections)}

    def extract_evidence(self, sections: list[dict[str, Any]]) -> dict[str, Any]:
        evidence = []
        seen = set()
        for section in sections:
            sentences = re.split(r"(?<=[。！？；.!?;])\s*", section["text"])
            for sentence in sentences:
                sentence = sentence.strip()
                if len(sentence) < 6:
                    continue
                types = self._tags(sentence)
                if not types:
                    continue
                digest = hashlib.sha256(sentence.encode()).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)
                evidence.append(
                    {
                        "evidenceId": f"EVG-{digest[:20].upper()}",
                        "type": types[0],
                        "claim": sentence[:800],
                        "documentId": section.get("documentId"),
                        "pages": section["pages"],
                        "locator": section["title"],
                        "excerptHash": digest,
                        "confidence": 0.9 if types[0] in {"threshold", "connector", "safety"} else 0.78,
                        "verification": "document_extracted",
                    }
                )
        return {"evidence": evidence[:200], "evidenceCount": min(len(evidence), 200)}

    def plan(self, template: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
        evidence_types = sorted({item["type"] for item in evidence})
        missing = sorted(set(template["requiredEvidence"]) - set(evidence_types))
        return {
            "faultDomain": template["faultDomain"],
            "templateId": template["id"],
            "templateVersion": template["version"],
            "title": template["title"],
            "intakeFields": template["intakeFields"],
            "causeCategories": template["causeCategories"],
            "steps": template["steps"],
            "assistantTopics": template["assistantTopics"],
            "outputFields": template["outputFields"],
            "graphTypes": template["graphTypes"],
            "routingTerms": template["keywords"],
            "exclusions": template["exclusions"],
            "evidenceTypes": evidence_types,
            "missingEvidenceTypes": missing,
            "requiresExpertInput": [
                f"缺少 {item} 类型证据，请补充资料或由专家确认"
                for item in missing
            ],
        }

    def generate_modules(
        self,
        template: dict[str, Any],
        draft: dict[str, Any],
        evidence: list[dict[str, Any]],
        job_id: str,
    ) -> dict[str, dict[str, Any]]:
        original = copy.deepcopy(draft["modules"])
        slug = re.sub(r"[^a-z0-9]+", "-", template["faultDomain"].lower()).strip("-")
        case_id = draft["caseId"]
        claim_id = f"claim-{slug}-generated"
        evidence_text = next((item["claim"] for item in evidence), "当前资料证据不足，需专家补充确认。")
        registry = original["registry"]
        registry.update(
            {
                "id": case_id,
                "package": f"{case_id}/manifest.json",
                "mode": "interactive_demo",
                "faultCode": f"industrial-computer-{slug}",
                "matchRules": {
                    "equipmentExact": registry.get("matchRules", {}).get("equipmentExact", [])[:10],
                    "equipmentGeneric": ["工控机"],
                    "alarms": template["keywords"][:2],
                    "symptoms": template["keywords"],
                    "measurements": [],
                    "contexts": [template["faultDomain"]],
                    "exclusions": template["exclusions"],
                },
            }
        )
        manifest = original["manifest"]
        manifest["identity"]["caseId"] = case_id
        manifest["identity"]["faultCode"] = registry["faultCode"]
        manifest["identity"]["title"] = f"{template['title']}检修"
        manifest["identity"]["shortTitle"] = template["title"]
        manifest["provenance"] = {
            "defaultVerificationLevel": "synthetic_demo",
            "reviewStatus": "unreviewed",
            "limitations": [
                f"由资料驱动生成任务 {job_id} 形成候选内容",
                "自动生成内容必须由专家核对证据后发布",
            ],
        }
        manifest["claims"] = [
            {
                "claimId": claim_id,
                "text": evidence_text[:500],
                "sourceType": "synthetic_demo",
                "verificationStatus": "internally_unverified",
                "reviewStatus": "unreviewed",
                "evidenceRefs": [],
            }
        ]
        field_ids = ["field-generated-equipment", "field-generated-alarm", "field-generated-context"]
        intake = {
            "schemaVersion": "1.1.0",
            "defaultDescription": f"{template['title']}，请补充设备、告警和现场状态。",
            "fields": [
                {"id": field_ids[0], "label": template["intakeFields"][0], "type": "text", "required": True, "routeFact": "equipment"},
                {"id": field_ids[1], "label": template["intakeFields"][1], "type": "text", "required": True, "routeFact": "alarm"},
                {"id": field_ids[2], "label": template["intakeFields"][2], "type": "text", "required": True, "routeFact": "context"},
            ],
        }
        diagnosis = {
            "schemaVersion": "1.1.0",
            "direction": template["title"],
            "riskLevel": "high",
            "summary": f"根据所选资料形成 {template['title']} 候选诊断，需结合现场值确认。",
            "evidence": [
                {"id": f"evidence-{slug}-generated", "label": evidence_text[:280], "claimId": claim_id, "intakeFieldIds": field_ids}
            ],
            "agents": [
                {"id": f"agent-{slug}-analysis", "name": f"{template['title']}诊断 Agent", "role": "汇总资料证据与现场事实", "stageSummary": "输出候选故障方向与待确认条件。"},
                {"id": f"agent-{slug}-safety", "name": "操作合规 Agent", "role": "检查安全边界", "stageSummary": "确认断电、防静电及资料依据。"}
            ],
        }
        steps = []
        topics = []
        for index, title in enumerate(template["steps"], 1):
            step_id = f"step-{slug}-{index}"
            check_id = f"check-{slug}-{index}"
            topic_id = f"topic-{slug}-{index}"
            steps.append(
                {
                    "id": step_id,
                    "title": title,
                    "description": f"按照资料和现场条件执行“{title}”，记录检查结果。",
                    "checks": [{"id": check_id, "label": f"{title}已执行并记录", "required": True, "locked": index == 1, "claimIds": [claim_id]}],
                    "measurements": [],
                    "claimIds": [claim_id],
                    "assistantTopicIds": [topic_id],
                    "completionCriteria": [{"refId": check_id, "condition": "已确认"}],
                }
            )
            topic_label = template["assistantTopics"][min(index - 1, len(template["assistantTopics"]) - 1)]
            topics.append(
                {
                    "id": topic_id,
                    "label": topic_label,
                    "intents": [topic_label, f"{topic_label}怎么做", "当前步骤怎么检查"],
                    "answer": f"当前步骤为“{title}”。参考资料提示：{evidence_text[:900]} 若现场条件或型号不一致，请停止并由专家确认。",
                    "allowedStepIds": [step_id],
                    "claimIds": [claim_id],
                }
            )
        guide = {"schemaVersion": "1.1.0", "planTitle": f"{template['title']}检修预方案", "steps": steps}
        assistant = {"schemaVersion": "1.1.0", "fallback": "请结合当前步骤、设备型号和已引用资料进行确认。", "topics": topics}
        result_fields = [
            {"id": f"result-{slug}-cause", "label": "最终原因", "type": "text", "required": True},
            {"id": f"result-{slug}-resolution", "label": "实际处理", "type": "text", "required": True},
            {"id": f"result-{slug}-recovery", "label": "恢复结果", "type": "text", "required": True},
            {"id": f"result-{slug}-observation", "label": "观察时长", "type": "number", "required": True, "unit": "min"},
        ]
        output = {
            "schemaVersion": "1.1.0",
            "engineerResultFields": result_fields,
            "jobCard": {
                "pageCount": 2,
                "sections": [
                    {"id": f"job-section-{slug}-summary", "title": "故障与原因摘要", "page": 1, "fieldIds": [result_fields[0]["id"]]},
                    {"id": f"job-section-{slug}-result", "title": "处理与恢复", "page": 2, "fieldIds": [item["id"] for item in result_fields[1:]]},
                ],
            },
        }
        knowledge_id = f"KB-GEN-{hashlib.sha1(case_id.encode()).hexdigest()[:8].upper()}"
        node_symptom = f"node-{slug}-symptom"
        node_cause = f"node-{slug}-cause"
        feedback = {
            "schemaVersion": "1.1.0",
            "knowledgeProposal": {
                "knowledgeId": knowledge_id,
                "title": f"{template['title']}检修候选知识",
                "verificationLevel": "synthetic_demo",
                "summary": f"由任务 {job_id} 根据资料生成，等待专家审核。",
            },
            "graphProposal": {
                "knowledgeId": knowledge_id,
                "nodes": [
                    {"id": node_symptom, "name": template["keywords"][0], "type": "symptom", "verificationLevel": "synthetic_demo"},
                    {"id": node_cause, "name": template["causeCategories"][0], "type": "cause", "verificationLevel": "synthetic_demo"},
                ],
                "relations": [
                    {"id": f"relation-{slug}-candidate", "source": node_symptom, "relation": "可能原因", "target": node_cause, "verificationLevel": "synthetic_demo"}
                ],
            },
        }
        return {
            "registry": registry,
            "manifest": manifest,
            "intake": intake,
            "diagnosis": diagnosis,
            "guide": guide,
            "assistant": assistant,
            "output": output,
            "feedbackAndGraph": feedback,
        }

    def repair_modules(
        self,
        template: dict[str, Any],
        draft: dict[str, Any],
        modules: dict[str, dict[str, Any]],
        errors: list[dict[str, Any]],
        attempt: int,
    ) -> dict[str, dict[str, Any]]:
        """Apply deterministic, bounded repairs without inventing new evidence."""
        repaired = copy.deepcopy(modules)
        original = draft["modules"]
        if attempt >= 3:
            return copy.deepcopy(original)
        for name, value in repaired.items():
            if not isinstance(value, dict):
                repaired[name] = copy.deepcopy(original[name])
                continue
            for key, fallback in original[name].items():
                if key not in value:
                    value[key] = copy.deepcopy(fallback)
        case_id = draft["caseId"]
        repaired["registry"]["id"] = case_id
        repaired["registry"]["package"] = f"{case_id}/manifest.json"
        repaired["manifest"]["identity"]["caseId"] = case_id
        repaired["manifest"]["identity"]["faultCode"] = repaired["registry"]["faultCode"]
        claims = {
            item["claimId"] for item in repaired["manifest"].get("claims", [])
            if isinstance(item, dict) and item.get("claimId")
        }
        if not claims:
            repaired["manifest"]["claims"] = copy.deepcopy(original["manifest"]["claims"])
            claims = {item["claimId"] for item in repaired["manifest"]["claims"]}
        step_ids = {
            item["id"] for item in repaired["guide"].get("steps", [])
            if isinstance(item, dict) and item.get("id")
        }
        for item in repaired["diagnosis"].get("evidence", []):
            if item.get("claimId") not in claims:
                item["claimId"] = next(iter(claims))
        for step in repaired["guide"].get("steps", []):
            step["claimIds"] = [item for item in step.get("claimIds", []) if item in claims]
            if not step["claimIds"]:
                step["claimIds"] = [next(iter(claims))]
        for topic in repaired["assistant"].get("topics", []):
            topic["allowedStepIds"] = [
                item for item in topic.get("allowedStepIds", []) if item in step_ids
            ]
            if not topic["allowedStepIds"] and step_ids:
                topic["allowedStepIds"] = [next(iter(step_ids))]
            topic["claimIds"] = [item for item in topic.get("claimIds", []) if item in claims]
        output_fields = {
            item["id"] for item in repaired["output"].get("engineerResultFields", [])
            if isinstance(item, dict) and item.get("id")
        }
        for section in repaired["output"].get("jobCard", {}).get("sections", []):
            section["fieldIds"] = [
                item for item in section.get("fieldIds", []) if item in output_fields
            ]
        return repaired

    def _tags(self, text: str) -> list[str]:
        lowered = text.lower()
        return [
            kind
            for kind, aliases in self.EVIDENCE_TERMS.items()
            if any(alias in lowered for alias in aliases)
        ]
