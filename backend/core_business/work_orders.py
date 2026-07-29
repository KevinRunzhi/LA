from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .audit import AuditService
from .database import (
    SQLiteService,
    canonical_json,
    json_hash,
    load_json,
    page_args,
    sha256_bytes,
    utc_now,
)
from .pdf import JobCardPdfRenderer


WORK_ORDER_STATUSES = {"draft", "assigned", "in_progress", "completed", "archived"}
WORK_ORDER_PRIORITIES = {"low", "normal", "high", "urgent"}
STATUS_TRANSITIONS = {
    "draft": {"assigned", "in_progress", "archived"},
    "assigned": {"in_progress", "archived"},
    "in_progress": {"completed", "archived"},
    "completed": {"archived"},
    "archived": set(),
}


class WorkOrderService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        storage_root: Path,
        audit: AuditService,
        renderer: JobCardPdfRenderer | None = None,
    ):
        super().__init__(database_path)
        self.storage_root = storage_root
        self.audit = audit
        self.renderer = renderer or JobCardPdfRenderer()

    def create(
        self,
        run_id: str,
        title: str,
        *,
        actor: dict[str, Any],
        summary: str = "",
        priority: str = "normal",
        assigned_to: str | None = None,
        due_at: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        title = self._required(title, "title", 160)
        summary = self._optional(summary, "summary", 4000) or ""
        if priority not in WORK_ORDER_PRIORITIES:
            raise PlatformError("validation_error", "priority 不受支持", 422)
        self._validate_due_at(due_at)
        order_id = f"ORD-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        with self.transaction() as db:
            run = db.execute(
                "SELECT run_id FROM case_runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise PlatformError("case_run_not_found", "未找到案例运行", 404)
            existing = db.execute(
                "SELECT order_id,order_number FROM maintenance_work_orders WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if existing:
                raise PlatformError(
                    "work_order_conflict",
                    "该案例运行已经创建工单",
                    409,
                    {
                        "orderId": existing["order_id"],
                        "orderNumber": existing["order_number"],
                    },
                )
            order_number = self._allocate_number(db)
            status = "assigned" if assigned_to else "draft"
            db.execute(
                """
                INSERT INTO maintenance_work_orders
                (order_id,order_number,run_id,title,summary,priority,status,
                 revision,assigned_to,due_at,created_by,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?)
                """,
                (
                    order_id,
                    order_number,
                    run_id,
                    title,
                    summary,
                    priority,
                    status,
                    assigned_to,
                    due_at,
                    actor["id"],
                    stamp,
                    stamp,
                ),
            )
            self.audit.record(
                "work_order.created",
                "work_order",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=order_id,
                metadata={"runId": run_id, "orderNumber": order_number},
                request_id=request_id,
                connection=db,
            )
            row = db.execute(
                "SELECT * FROM maintenance_work_orders WHERE order_id=?",
                (order_id,),
            ).fetchone()
        return self._project_order(row)

    def get(self, order_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM maintenance_work_orders WHERE order_id=?",
                (order_id,),
            ).fetchone()
        if row is None:
            raise PlatformError("work_order_not_found", "未找到工单", 404)
        return self._project_order(row)

    def list(
        self,
        *,
        status: str | None = None,
        assigned_to: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        limit, offset = page_args(page, page_size)
        clauses: list[str] = []
        values: list[Any] = []
        if status:
            if status not in WORK_ORDER_STATUSES:
                raise PlatformError("validation_error", "status 不受支持", 422)
            clauses.append("status=?")
            values.append(status)
        if assigned_to:
            clauses.append("assigned_to=?")
            values.append(assigned_to)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            total = db.execute(
                f"SELECT count(*) FROM maintenance_work_orders {where}",
                values,
            ).fetchone()[0]
            rows = db.execute(
                f"""
                SELECT * FROM maintenance_work_orders {where}
                ORDER BY updated_at DESC LIMIT ? OFFSET ?
                """,
                [*values, limit, offset],
            ).fetchall()
        return {
            "items": [self._project_order(row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def update(
        self,
        order_id: str,
        expected_revision: int,
        changes: dict[str, Any],
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(expected_revision, int) or expected_revision < 1:
            raise PlatformError("validation_error", "expectedRevision 无效", 422)
        allowed = {"title", "summary", "priority", "status", "assignedTo", "dueAt"}
        unknown = sorted(set(changes) - allowed)
        if unknown or not changes:
            raise PlatformError(
                "validation_error",
                "工单更新字段无效",
                422,
                {"fields": unknown},
            )
        with self.transaction() as db:
            row = db.execute(
                "SELECT * FROM maintenance_work_orders WHERE order_id=?",
                (order_id,),
            ).fetchone()
            if row is None:
                raise PlatformError("work_order_not_found", "未找到工单", 404)
            if row["revision"] != expected_revision:
                raise PlatformError(
                    "state_conflict",
                    "工单版本已经变化",
                    409,
                    {"currentRevision": row["revision"]},
                )
            normalized = self._normalize_changes(row, changes)
            assignments = [f"{column}=?" for column in normalized]
            next_revision = expected_revision + 1
            values = [
                *normalized.values(),
                next_revision,
                utc_now(),
                order_id,
            ]
            db.execute(
                f"""
                UPDATE maintenance_work_orders
                SET {','.join(assignments)},revision=?,updated_at=?
                WHERE order_id=?
                """,
                values,
            )
            self.audit.record(
                "work_order.updated",
                "work_order",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=order_id,
                metadata={"fields": sorted(changes), "revision": next_revision},
                request_id=request_id,
                connection=db,
            )
            updated = db.execute(
                "SELECT * FROM maintenance_work_orders WHERE order_id=?",
                (order_id,),
            ).fetchone()
        return self._project_order(updated)

    def generate_job_card(
        self,
        order_id: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        with self.connect() as db:
            order = db.execute(
                "SELECT * FROM maintenance_work_orders WHERE order_id=?",
                (order_id,),
            ).fetchone()
            if order is None:
                raise PlatformError("work_order_not_found", "未找到工单", 404)
            run = db.execute(
                "SELECT * FROM case_runs WHERE run_id=?",
                (order["run_id"],),
            ).fetchone()
            attachments = db.execute(
                """
                SELECT * FROM case_run_attachments
                WHERE run_id=? ORDER BY created_at
                """,
                (order["run_id"],),
            ).fetchall()
            existing_count = db.execute(
                "SELECT count(*) FROM job_card_documents WHERE order_id=?",
                (order_id,),
            ).fetchone()[0]
        payload = self._build_payload(order, run, attachments, existing_count + 1)
        content_hash = json_hash(
            {
                key: value
                for key, value in payload.items()
                if key not in {"documentVersion", "generatedAt"}
            }
        )
        with self.connect() as db:
            existing = db.execute(
                """
                SELECT * FROM job_card_documents
                WHERE order_id=? AND content_sha256=?
                """,
                (order_id, content_hash),
            ).fetchone()
        if existing:
            return self._project_document(existing)

        pdf, page_count = self.renderer.render(payload)
        pdf_hash = sha256_bytes(pdf)
        document_id = f"JCD-{uuid.uuid4().hex.upper()}"
        version = existing_count + 1
        storage_key = f"{order['order_number']}/v{version:03d}-{document_id}.pdf"
        target = self._storage_path(storage_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".pdf.tmp")
        temporary.write_bytes(pdf)
        temporary.replace(target)
        try:
            with self.transaction() as db:
                db.execute(
                    """
                    INSERT INTO job_card_documents
                    (document_id,order_id,run_id,document_version,run_revision,
                     template_version,content_sha256,payload_json,storage_key,
                     pdf_sha256,page_count,byte_count,generated_by,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        document_id,
                        order_id,
                        order["run_id"],
                        version,
                        run["revision"],
                        self.renderer.TEMPLATE_VERSION,
                        content_hash,
                        canonical_json(payload),
                        storage_key,
                        pdf_hash,
                        page_count,
                        len(pdf),
                        actor["id"],
                        utc_now(),
                    ),
                )
                self.audit.record(
                    "job_card.generated",
                    "job_card_document",
                    actor_id=actor["id"],
                    actor_role=actor["role"],
                    resource_id=document_id,
                    metadata={
                        "orderId": order_id,
                        "version": version,
                        "pdfSha256": pdf_hash,
                        "pageCount": page_count,
                    },
                    request_id=request_id,
                    connection=db,
                )
                row = db.execute(
                    "SELECT * FROM job_card_documents WHERE document_id=?",
                    (document_id,),
                ).fetchone()
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return self._project_document(row)

    def list_job_cards(self, order_id: str) -> list[dict[str, Any]]:
        self.get(order_id)
        with self.connect() as db:
            rows = db.execute(
                """
                SELECT * FROM job_card_documents
                WHERE order_id=? ORDER BY document_version DESC
                """,
                (order_id,),
            ).fetchall()
        return [self._project_document(row) for row in rows]

    def get_job_card(self, document_id: str, *, include_payload: bool = True):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM job_card_documents WHERE document_id=?",
                (document_id,),
            ).fetchone()
        if row is None:
            raise PlatformError("job_card_not_found", "未找到作业卡文档", 404)
        return self._project_document(row, include_payload=include_payload)

    def download_path(self, document_id: str) -> tuple[Path, dict[str, Any]]:
        document = self.get_job_card(document_id, include_payload=False)
        path = self._storage_path(document["storageKey"])
        if not path.is_file():
            raise PlatformError("job_card_file_missing", "作业卡 PDF 文件缺失", 500)
        digest = sha256_bytes(path.read_bytes())
        if digest != document["pdfSha256"]:
            raise PlatformError("job_card_integrity_failed", "作业卡 PDF 校验失败", 500)
        return path, document

    def _build_payload(
        self,
        order: sqlite3.Row,
        run: sqlite3.Row,
        attachments: list[sqlite3.Row],
        document_version: int,
    ) -> dict[str, Any]:
        run_payload = load_json(run["payload"], {})
        snapshots = run_payload.get("snapshots") or {}
        return {
            "templateVersion": self.renderer.TEMPLATE_VERSION,
            "documentVersion": document_version,
            "generatedAt": utc_now(),
            "workOrder": self._project_order(order),
            "caseRun": {
                "runId": run["run_id"],
                "caseId": run["case_id"],
                "status": run["status"],
                "revision": run["revision"],
                "packageVersion": run["package_version"],
                "packageHash": run["package_hash"],
                "initialDescription": (run_payload.get("initialInput") or {}).get("description"),
                "intakeFacts": run_payload.get("intakeFacts") or {},
                "diagnosis": snapshots.get("diagnosis") or {},
            },
            "stepExecution": [
                {"stepId": step_id, "execution": execution}
                for step_id, execution in sorted(
                    (run_payload.get("stepExecution") or {}).items()
                )
            ],
            "maintenanceRecord": snapshots.get("maintenanceRecord") or {},
            "expertReview": snapshots.get("expertReview") or {},
            "attachments": [
                {
                    "attachmentId": row["attachment_id"],
                    "mediaType": row["media_type"],
                    "sha256": row["sha256"],
                    "originalFilename": (
                        load_json(row["metadata"], {}).get("originalFilename")
                    ),
                }
                for row in attachments
            ],
        }

    def _normalize_changes(
        self,
        row: sqlite3.Row,
        changes: dict[str, Any],
    ) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        if "title" in changes:
            normalized["title"] = self._required(changes["title"], "title", 160)
        if "summary" in changes:
            normalized["summary"] = self._optional(changes["summary"], "summary", 4000) or ""
        if "priority" in changes:
            if changes["priority"] not in WORK_ORDER_PRIORITIES:
                raise PlatformError("validation_error", "priority 不受支持", 422)
            normalized["priority"] = changes["priority"]
        if "status" in changes:
            target = changes["status"]
            if target not in WORK_ORDER_STATUSES:
                raise PlatformError("validation_error", "status 不受支持", 422)
            if target != row["status"] and target not in STATUS_TRANSITIONS[row["status"]]:
                raise PlatformError(
                    "work_order_state_conflict",
                    "不允许该工单状态转换",
                    409,
                    {"currentStatus": row["status"], "targetStatus": target},
                )
            normalized["status"] = target
        if "assignedTo" in changes:
            normalized["assigned_to"] = self._optional(
                changes["assignedTo"],
                "assignedTo",
                80,
            )
        if "dueAt" in changes:
            self._validate_due_at(changes["dueAt"])
            normalized["due_at"] = changes["dueAt"]
        return normalized

    @staticmethod
    def _allocate_number(db: sqlite3.Connection) -> str:
        date = datetime.now(timezone.utc).strftime("%Y%m%d")
        prefix = f"WO-{date}-"
        row = db.execute(
            """
            SELECT order_number FROM maintenance_work_orders
            WHERE order_number LIKE ?
            ORDER BY order_number DESC LIMIT 1
            """,
            (f"{prefix}%",),
        ).fetchone()
        sequence = int(row["order_number"].split("-")[-1]) + 1 if row else 1
        return f"{prefix}{sequence:04d}"

    def _storage_path(self, storage_key: str) -> Path:
        root = self.storage_root.resolve()
        target = (root / storage_key).resolve()
        if root not in target.parents:
            raise PlatformError("storage_key_invalid", "作业卡存储路径无效", 500)
        return target

    @staticmethod
    def _project_order(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["order_id"],
            "orderNumber": row["order_number"],
            "runId": row["run_id"],
            "title": row["title"],
            "summary": row["summary"],
            "priority": row["priority"],
            "status": row["status"],
            "revision": row["revision"],
            "assignedTo": row["assigned_to"],
            "dueAt": row["due_at"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _project_document(
        row: sqlite3.Row,
        *,
        include_payload: bool = False,
    ) -> dict[str, Any]:
        value = {
            "id": row["document_id"],
            "orderId": row["order_id"],
            "runId": row["run_id"],
            "version": row["document_version"],
            "runRevision": row["run_revision"],
            "templateVersion": row["template_version"],
            "contentSha256": row["content_sha256"],
            "storageKey": row["storage_key"],
            "pdfSha256": row["pdf_sha256"],
            "pageCount": row["page_count"],
            "byteCount": row["byte_count"],
            "generatedBy": row["generated_by"],
            "createdAt": row["created_at"],
        }
        if include_payload:
            value["payload"] = load_json(row["payload_json"], {})
        return value

    @staticmethod
    def _required(value: Any, field: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        result = value.strip()
        if len(result) > max_length:
            raise PlatformError("validation_error", f"{field} 过长", 422)
        return result

    @staticmethod
    def _optional(value: Any, field: str, max_length: int) -> str | None:
        if value is None or value == "":
            return None
        if not isinstance(value, str) or len(value.strip()) > max_length:
            raise PlatformError("validation_error", f"{field} 无效", 422)
        return value.strip()

    @staticmethod
    def _validate_due_at(value: str | None) -> None:
        if value is None or value == "":
            return
        if not isinstance(value, str):
            raise PlatformError("validation_error", "dueAt 必须是 ISO 时间", 422)
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise PlatformError("validation_error", "dueAt 必须是 ISO 时间", 422) from exc
        if parsed.tzinfo is None:
            raise PlatformError("validation_error", "dueAt 必须包含时区", 422)
