from __future__ import annotations

import io
from html import escape
from typing import Any

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


class JobCardPdfRenderer:
    TEMPLATE_VERSION = "job-card-v2"

    def __init__(self):
        self.font_name = "STSong-Light"
        try:
            pdfmetrics.getFont(self.font_name)
        except KeyError:
            pdfmetrics.registerFont(UnicodeCIDFont(self.font_name))
        self.styles = self._styles()

    def render(self, payload: dict[str, Any]) -> tuple[bytes, int]:
        buffer = io.BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=16 * mm,
            rightMargin=16 * mm,
            topMargin=15 * mm,
            bottomMargin=16 * mm,
            title=f"检修作业卡 {payload['workOrder']['orderNumber']}",
            author="LA 工业设备智能接诊系统",
        )
        story = []
        story.append(Paragraph("工业设备检修作业卡", self.styles["title"]))
        story.append(
            Paragraph(
                f"工单编号：{escape(self._text(payload['workOrder']['orderNumber']))}",
                self.styles["subtitle"],
            )
        )
        story.append(Spacer(1, 5 * mm))
        story.append(self._basic_table(payload))
        story.append(Spacer(1, 5 * mm))
        story.extend(self._summary_section(payload))
        story.extend(self._steps_section(payload))
        story.extend(self._evidence_section(payload))
        story.extend(self._conclusion_section(payload))
        story.append(Spacer(1, 8 * mm))
        story.append(self._signature_table())
        document.build(
            story,
            onFirstPage=self._page_footer,
            onLaterPages=self._page_footer,
        )
        pdf = buffer.getvalue()
        page_count = len(PdfReader(io.BytesIO(pdf)).pages)
        return pdf, page_count

    def _basic_table(self, payload: dict[str, Any]) -> Table:
        order = payload["workOrder"]
        run = payload["caseRun"]
        rows = [
            ["案例编号", run["caseId"], "运行编号", run["runId"]],
            ["工单状态", order["status"], "优先级", order["priority"]],
            ["负责人", order.get("assignedTo") or "待分配", "生成版本", payload["documentVersion"]],
            ["CaseRun 版本", run["revision"], "生成时间", payload["generatedAt"]],
        ]
        table = Table(rows, colWidths=[25 * mm, 61 * mm, 27 * mm, 61 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), self.font_name),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EAF2FA")),
                    ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EAF2FA")),
                    ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#17324D")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9EB6CC")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        return table

    def _summary_section(self, payload: dict[str, Any]) -> list[Any]:
        run = payload["caseRun"]
        diagnosis = run.get("diagnosis") or {}
        return [
            Paragraph("一、故障与诊断摘要", self.styles["heading"]),
            self._label_value("工单标题", payload["workOrder"]["title"]),
            self._label_value("现场描述", run.get("initialDescription") or "未记录"),
            self._label_value("诊断方向", diagnosis.get("direction") or "未形成"),
            self._label_value("诊断摘要", diagnosis.get("summary") or "未形成"),
            self._label_value("风险等级", diagnosis.get("riskLevel") or "未标注"),
            Spacer(1, 3 * mm),
        ]

    def _steps_section(self, payload: dict[str, Any]) -> list[Any]:
        items = [
            Paragraph("二、检修步骤执行情况", self.styles["heading"]),
        ]
        steps = payload.get("stepExecution") or []
        if not steps:
            items.append(Paragraph("尚未记录已完成步骤。", self.styles["body"]))
            return items
        rows = [["步骤", "执行结果", "测量与检查"]]
        for step in steps:
            execution = step.get("execution") or {}
            details = []
            for key, value in execution.items():
                if key not in {"notes", "result"}:
                    details.append(f"{key}: {self._text(value)}")
            rows.append(
                [
                    Paragraph(escape(self._text(step["stepId"])), self.styles["cell"]),
                    Paragraph(
                        escape(self._text(execution.get("result") or execution.get("notes") or "已完成")),
                        self.styles["cell"],
                    ),
                    Paragraph(escape("；".join(details) or "—"), self.styles["cell"]),
                ]
            )
        table = Table(rows, colWidths=[38 * mm, 70 * mm, 66 * mm], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), self.font_name),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173D5E")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#A8B7C5")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        items.extend((table, Spacer(1, 4 * mm)))
        return items

    def _evidence_section(self, payload: dict[str, Any]) -> list[Any]:
        attachments = payload.get("attachments") or []
        items = [Paragraph("三、现场证据与附件", self.styles["heading"])]
        if not attachments:
            items.append(Paragraph("本版本未关联附件。", self.styles["body"]))
            return items
        rows = [["文件", "类型", "SHA-256"]]
        for attachment in attachments:
            rows.append(
                [
                    attachment.get("originalFilename") or attachment["attachmentId"],
                    attachment["mediaType"],
                    attachment["sha256"][:24] + "…",
                ]
            )
        table = Table(rows, colWidths=[70 * mm, 45 * mm, 59 * mm], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), self.font_name),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173D5E")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#A8B7C5")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        items.extend((table, Spacer(1, 4 * mm)))
        return items

    def _conclusion_section(self, payload: dict[str, Any]) -> list[Any]:
        record = payload.get("maintenanceRecord") or {}
        expert = payload.get("expertReview") or {}
        engineer_result = record.get("engineerResult") or {}
        return [
            Paragraph("四、结论与审核", self.styles["heading"]),
            self._label_value(
                "工程师结论",
                engineer_result.get("conclusion")
                or engineer_result.get("summary")
                or self._text(engineer_result)
                or "未形成",
            ),
            self._label_value(
                "专家决定",
                expert.get("decision") or "尚未审核",
            ),
            self._label_value(
                "专家说明",
                self._text(expert.get("notes")) or "—",
            ),
        ]

    def _label_value(self, label: str, value: Any) -> KeepTogether:
        return KeepTogether(
            [
                Paragraph(
                    f"<b>{escape(label)}：</b>{escape(self._text(value))}",
                    self.styles["body"],
                ),
                Spacer(1, 1.5 * mm),
            ]
        )

    def _signature_table(self) -> Table:
        table = Table(
            [
                ["执行工程师签字", "", "审核专家签字", ""],
                ["日期", "", "日期", ""],
            ],
            colWidths=[31 * mm, 56 * mm, 31 * mm, 56 * mm],
            rowHeights=[14 * mm, 10 * mm],
        )
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), self.font_name),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#7890A6")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EFF4F8")),
                    ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EFF4F8")),
                ]
            )
        )
        return table

    def _styles(self) -> dict[str, ParagraphStyle]:
        base = getSampleStyleSheet()
        return {
            "title": ParagraphStyle(
                "CNTitle",
                parent=base["Title"],
                fontName=self.font_name,
                fontSize=18,
                leading=24,
                alignment=TA_CENTER,
                textColor=colors.HexColor("#102C46"),
            ),
            "subtitle": ParagraphStyle(
                "CNSubtitle",
                parent=base["Normal"],
                fontName=self.font_name,
                fontSize=9,
                leading=13,
                alignment=TA_CENTER,
                textColor=colors.HexColor("#49647D"),
            ),
            "heading": ParagraphStyle(
                "CNHeading",
                parent=base["Heading2"],
                fontName=self.font_name,
                fontSize=12,
                leading=17,
                spaceBefore=4 * mm,
                spaceAfter=2 * mm,
                textColor=colors.HexColor("#0D6EA8"),
            ),
            "body": ParagraphStyle(
                "CNBody",
                parent=base["BodyText"],
                fontName=self.font_name,
                fontSize=9,
                leading=15,
                alignment=TA_LEFT,
                textColor=colors.HexColor("#20384D"),
            ),
            "cell": ParagraphStyle(
                "CNCell",
                parent=base["BodyText"],
                fontName=self.font_name,
                fontSize=8,
                leading=12,
                textColor=colors.HexColor("#20384D"),
            ),
        }

    def _page_footer(self, canvas, document) -> None:
        canvas.saveState()
        canvas.setFont(self.font_name, 7.5)
        canvas.setFillColor(colors.HexColor("#657D91"))
        canvas.drawString(16 * mm, 9 * mm, "LA 工业设备智能接诊系统")
        canvas.drawRightString(
            A4[0] - 16 * mm,
            9 * mm,
            f"第 {document.page} 页",
        )
        canvas.restoreState()

    @staticmethod
    def _text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "是" if value else "否"
        if isinstance(value, dict):
            return "；".join(f"{key}: {JobCardPdfRenderer._text(item)}" for key, item in value.items())
        if isinstance(value, list):
            return "；".join(JobCardPdfRenderer._text(item) for item in value)
        return str(value)
