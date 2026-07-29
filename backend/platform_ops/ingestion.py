from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
    from ..core_business.audit import AuditService
    from ..core_business.database import SQLiteService, canonical_json, load_json, utc_now
    from ..core_business.manuals import ManualKnowledgeService
except ImportError:
    from case_platform.errors import PlatformError
    from core_business.audit import AuditService
    from core_business.database import SQLiteService, canonical_json, load_json, utc_now
    from core_business.manuals import ManualKnowledgeService


FINAL_ITEM_STATES = {"imported", "skipped", "failed", "cancelled"}


class IngestionService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        allowed_roots: list[Path],
        manuals: ManualKnowledgeService,
        audit: AuditService,
    ):
        super().__init__(database_path)
        self.allowed_roots = [root.resolve() for root in allowed_roots]
        self.manuals = manuals
        self.audit = audit

    def create_job(
        self,
        source_root: str,
        *,
        actor: dict[str, Any],
        dry_run: bool = False,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        root = self._resolve_root(source_root)
        files = []
        for path in sorted(root.rglob("*.pdf")):
            resolved = path.resolve()
            if path.is_symlink() or not resolved.is_file() or root not in resolved.parents:
                continue
            files.append((resolved, resolved.relative_to(root).as_posix()))
        if not files:
            raise PlatformError("ingestion_empty", "目录中没有可入库 PDF", 422)
        job_id = f"ING-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        options = {"dryRun": bool(dry_run)}
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO knowledge_ingestion_jobs
                (job_id,source_root,status,options_json,discovered_count,
                 created_by,created_at,updated_at)
                VALUES (?,?, 'pending',?,?,?,?,?)
                """,
                (
                    job_id,
                    str(root),
                    canonical_json(options),
                    len(files),
                    actor["id"],
                    stamp,
                    stamp,
                ),
            )
            known = {
                row[0]: row[1]
                for row in db.execute(
                    "SELECT file_sha256,document_id FROM manual_documents"
                )
            }
            skipped = 0
            for path, relative in files:
                digest = self._file_hash(path)
                document_id = known.get(digest)
                status = "skipped" if document_id or dry_run else "pending"
                skipped += int(status == "skipped")
                db.execute(
                    """
                    INSERT INTO knowledge_ingestion_items
                    (item_id,job_id,relative_path,file_sha256,status,document_id,
                     attempt,completed_at,updated_at)
                    VALUES (?,?,?,?,?,?,0,?,?)
                    """,
                    (
                        f"INI-{uuid.uuid4().hex.upper()}",
                        job_id,
                        relative,
                        digest,
                        status,
                        document_id,
                        stamp if status == "skipped" else None,
                        stamp,
                    ),
                )
            if dry_run or skipped == len(files):
                db.execute(
                    """
                    UPDATE knowledge_ingestion_jobs
                    SET status='completed',skipped_count=?,completed_at=?,updated_at=?
                    WHERE job_id=?
                    """,
                    (len(files), stamp, stamp, job_id),
                )
            else:
                db.execute(
                    "UPDATE knowledge_ingestion_jobs SET skipped_count=? WHERE job_id=?",
                    (skipped, job_id),
                )
            self.audit.record(
                "ingestion.job_created",
                "ingestion_job",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=job_id,
                metadata={"sourceRoot": str(root), "files": len(files), **options},
                request_id=request_id,
                connection=db,
            )
        return self.get_job(job_id)

    def process_once(self, job_id: str | None = None) -> dict[str, Any] | None:
        claimed = self._claim(job_id)
        if claimed is None:
            return None
        path = Path(claimed["source_root"]) / claimed["relative_path"]
        actor = {"id": claimed["created_by"], "role": "admin"}
        try:
            document = self.manuals.import_pdf(
                path.read_bytes(),
                path.name,
                {
                    "title": path.stem.replace("_", " ").replace("-", " "),
                    "sourceId": claimed["relative_path"],
                    "vendor": path.parent.name if path.parent != Path(claimed["source_root"]) else None,
                    "faultDomains": self._infer_domains(path),
                },
                actor=actor,
            )
            self._finish_item(claimed, "imported", document_id=document["id"])
        except PlatformError as exc:
            if exc.code == "manual_duplicate":
                self._finish_item(
                    claimed,
                    "skipped",
                    document_id=exc.details.get("documentId"),
                    error_code=exc.code,
                    error_message=exc.message,
                )
            else:
                self._finish_item(
                    claimed,
                    "failed",
                    error_code=exc.code,
                    error_message=exc.message,
                )
        except (OSError, ValueError) as exc:
            self._finish_item(
                claimed,
                "failed",
                error_code="ingestion_io_error",
                error_message=str(exc)[:500],
            )
        return self.get_job(claimed["job_id"])

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM knowledge_ingestion_jobs WHERE job_id=?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise PlatformError("ingestion_job_not_found", "未找到入库任务", 404)
            items = db.execute(
                """
                SELECT * FROM knowledge_ingestion_items
                WHERE job_id=? ORDER BY relative_path
                """,
                (job_id,),
            ).fetchall()
        return self._project_job(row, items)

    def list_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                """
                SELECT * FROM knowledge_ingestion_jobs
                ORDER BY created_at DESC LIMIT ?
                """,
                (min(max(limit, 1), 200),),
            ).fetchall()
        return [self._project_job(row) for row in rows]

    def cancel(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._job_row(db, job_id)
            if row["status"] in {"completed", "completed_with_errors", "cancelled"}:
                return self._project_job(row)
            stamp = utc_now()
            db.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET cancel_requested=1,status='cancelled',completed_at=?,updated_at=?
                WHERE job_id=?
                """,
                (stamp, stamp, job_id),
            )
            db.execute(
                """
                UPDATE knowledge_ingestion_items
                SET status='cancelled',completed_at=?,updated_at=?
                WHERE job_id=? AND status='pending'
                """,
                (stamp, stamp, job_id),
            )
            self.audit.record(
                "ingestion.job_cancelled",
                "ingestion_job",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=job_id,
                connection=db,
            )
        return self.get_job(job_id)

    def retry(self, job_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            self._job_row(db, job_id)
            stamp = utc_now()
            db.execute(
                """
                UPDATE knowledge_ingestion_items
                SET status='pending',error_code=NULL,error_message=NULL,
                    completed_at=NULL,lease_expires_at=NULL,updated_at=?
                WHERE job_id=? AND status='failed' AND attempt < 3
                """,
                (stamp, job_id),
            )
            changed = db.execute("SELECT changes()").fetchone()[0]
            if not changed:
                raise PlatformError("ingestion_retry_empty", "没有可重试项目", 409)
            db.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET status='pending',cancel_requested=0,completed_at=NULL,
                    error_summary=NULL,updated_at=? WHERE job_id=?
                """,
                (stamp, job_id),
            )
            self._aggregate(db, job_id)
            self.audit.record(
                "ingestion.job_retried",
                "ingestion_job",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=job_id,
                metadata={"items": changed},
                connection=db,
            )
        return self.get_job(job_id)

    def _claim(self, job_id: str | None) -> dict[str, Any] | None:
        with self.transaction() as db:
            stamp = datetime.now(timezone.utc)
            clauses = ["j.cancel_requested=0", "(i.status='pending' OR (i.status='running' AND i.lease_expires_at<?))"]
            values: list[Any] = [stamp.isoformat()]
            if job_id:
                clauses.append("j.job_id=?")
                values.append(job_id)
            row = db.execute(
                f"""
                SELECT i.*,j.source_root,j.created_by
                FROM knowledge_ingestion_items i
                JOIN knowledge_ingestion_jobs j ON j.job_id=i.job_id
                WHERE {' AND '.join(clauses)}
                ORDER BY j.created_at,i.relative_path LIMIT 1
                """,
                values,
            ).fetchone()
            if row is None:
                return None
            lease = (stamp + timedelta(minutes=10)).isoformat()
            db.execute(
                """
                UPDATE knowledge_ingestion_items
                SET status='running',attempt=attempt+1,lease_expires_at=?,
                    started_at=COALESCE(started_at,?),updated_at=?
                WHERE item_id=?
                """,
                (lease, stamp.isoformat(), stamp.isoformat(), row["item_id"]),
            )
            db.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET status='running',started_at=COALESCE(started_at,?),updated_at=?
                WHERE job_id=?
                """,
                (stamp.isoformat(), stamp.isoformat(), row["job_id"]),
            )
        return dict(row)

    def _finish_item(
        self,
        item: dict[str, Any],
        status: str,
        *,
        document_id: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        stamp = utc_now()
        with self.transaction() as db:
            db.execute(
                """
                UPDATE knowledge_ingestion_items
                SET status=?,document_id=?,error_code=?,error_message=?,
                    lease_expires_at=NULL,completed_at=?,updated_at=?
                WHERE item_id=?
                """,
                (
                    status,
                    document_id,
                    error_code,
                    (error_message or "")[:500] or None,
                    stamp,
                    stamp,
                    item["item_id"],
                ),
            )
            self._aggregate(db, item["job_id"])

    def _aggregate(self, db: sqlite3.Connection, job_id: str) -> None:
        counts = {
            row["status"]: row["count"]
            for row in db.execute(
                """
                SELECT status,count(*) AS count
                FROM knowledge_ingestion_items WHERE job_id=? GROUP BY status
                """,
                (job_id,),
            )
        }
        pending = counts.get("pending", 0) + counts.get("running", 0)
        final_status = "running"
        completed_at = None
        if pending == 0:
            final_status = "completed_with_errors" if counts.get("failed", 0) else "completed"
            completed_at = utc_now()
        db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status=?,imported_count=?,skipped_count=?,failed_count=?,
                completed_at=?,updated_at=?
            WHERE job_id=?
            """,
            (
                final_status,
                counts.get("imported", 0),
                counts.get("skipped", 0),
                counts.get("failed", 0),
                completed_at,
                utc_now(),
                job_id,
            ),
        )

    def _resolve_root(self, value: str) -> Path:
        requested = Path(value).expanduser()
        candidate = (
            requested.resolve()
            if requested.is_absolute()
            else (self.allowed_roots[0].parent / requested).resolve()
        )
        for root in self.allowed_roots:
            if candidate == root or root in candidate.parents:
                if not candidate.is_dir():
                    raise PlatformError("ingestion_root_invalid", "入库目录不存在", 422)
                return candidate
        raise PlatformError("ingestion_root_forbidden", "入库目录不在允许范围内", 403)

    @staticmethod
    def _file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _infer_domains(path: Path) -> list[str]:
        text = path.as_posix().lower()
        terms = {
            "cooling": ("cool", "fan", "thermal", "散热", "风扇"),
            "power": ("power", "电源", "供电"),
            "storage": ("disk", "storage", "硬盘", "存储"),
            "network": ("network", "ethernet", "网络", "通信"),
        }
        return [domain for domain, aliases in terms.items() if any(alias in text for alias in aliases)]

    @staticmethod
    def _job_row(db: sqlite3.Connection, job_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM knowledge_ingestion_jobs WHERE job_id=?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise PlatformError("ingestion_job_not_found", "未找到入库任务", 404)
        return row

    @staticmethod
    def _project_job(row: sqlite3.Row, items=None) -> dict[str, Any]:
        value = {
            "id": row["job_id"],
            "sourceRoot": row["source_root"],
            "status": row["status"],
            "options": load_json(row["options_json"], {}),
            "counts": {
                "discovered": row["discovered_count"],
                "imported": row["imported_count"],
                "skipped": row["skipped_count"],
                "failed": row["failed_count"],
            },
            "cancelRequested": bool(row["cancel_requested"]),
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "updatedAt": row["updated_at"],
        }
        if items is not None:
            value["items"] = [
                {
                    "id": item["item_id"],
                    "path": item["relative_path"],
                    "sha256": item["file_sha256"],
                    "status": item["status"],
                    "documentId": item["document_id"],
                    "attempt": item["attempt"],
                    "error": (
                        {"code": item["error_code"], "message": item["error_message"]}
                        if item["error_code"]
                        else None
                    ),
                }
                for item in items
            ]
        return value
