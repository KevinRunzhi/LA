from __future__ import annotations

import io
import re
import sqlite3
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError
from .audit import AuditService
from .database import (
    SQLiteService,
    canonical_json,
    load_json,
    page_args,
    sha256_bytes,
    utc_now,
)


class ManualKnowledgeService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        storage_root: Path,
        audit: AuditService,
        *,
        max_bytes: int = 50 * 1024 * 1024,
        chunk_chars: int = 900,
    ):
        super().__init__(database_path)
        self.storage_root = storage_root
        self.audit = audit
        self.max_bytes = max_bytes
        self.chunk_chars = chunk_chars

    def import_pdf(
        self,
        content: bytes,
        filename: str,
        metadata: dict[str, Any],
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        if not content or len(content) > self.max_bytes:
            raise PlatformError(
                "manual_size_invalid",
                "手册为空或超过大小限制",
                413,
                {"maxBytes": self.max_bytes},
            )
        if not filename.lower().endswith(".pdf") or not content.startswith(b"%PDF-"):
            raise PlatformError("manual_type_invalid", "仅支持有效 PDF 手册", 415)
        title = self._required(metadata.get("title"), "title", 160)
        fault_domains = metadata.get("faultDomains") or []
        if (
            not isinstance(fault_domains, list)
            or not all(isinstance(item, str) and item.strip() for item in fault_domains)
        ):
            raise PlatformError(
                "validation_error",
                "faultDomains 必须是字符串数组",
                422,
            )
        file_hash = sha256_bytes(content)
        with self.connect() as db:
            duplicate = db.execute(
                "SELECT document_id,title FROM manual_documents WHERE file_sha256=?",
                (file_hash,),
            ).fetchone()
        if duplicate:
            raise PlatformError(
                "manual_duplicate",
                "该手册内容已经导入",
                409,
                {"documentId": duplicate["document_id"], "title": duplicate["title"]},
            )

        pages = self._extract_pages(content)
        chunks = [
            (page_number, ordinal, text)
            for page_number, page_text in pages
            for ordinal, text in enumerate(self._chunk(page_text))
        ]
        if not chunks:
            raise PlatformError(
                "manual_text_empty",
                "PDF 未提取到可检索文本",
                422,
            )

        document_id = f"MAN-{uuid.uuid4().hex.upper()}"
        storage_key = f"{document_id}.pdf"
        self.storage_root.mkdir(parents=True, exist_ok=True)
        target = self._safe_storage_path(storage_key)
        temporary = target.with_suffix(".pdf.tmp")
        temporary.write_bytes(content)
        temporary.replace(target)
        stamp = utc_now()
        try:
            with self.transaction() as db:
                db.execute(
                    """
                    INSERT INTO manual_documents
                    (document_id,source_id,title,vendor,equipment_type,
                     fault_domains_json,document_version,original_filename,
                     file_sha256,storage_key,page_count,status,imported_by,
                     created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)
                    """,
                    (
                        document_id,
                        self._optional(metadata.get("sourceId"), 80),
                        title,
                        self._optional(metadata.get("vendor"), 120),
                        self._optional(metadata.get("equipmentType"), 120),
                        canonical_json(sorted(set(item.strip() for item in fault_domains))),
                        self._optional(metadata.get("version"), 80),
                        Path(filename).name[:255],
                        file_hash,
                        storage_key,
                        len(pages),
                        actor["id"],
                        stamp,
                        stamp,
                    ),
                )
                self._insert_chunks(db, document_id, chunks, stamp)
                self.audit.record(
                    "manual.imported",
                    "manual_document",
                    actor_id=actor["id"],
                    actor_role=actor["role"],
                    resource_id=document_id,
                    metadata={
                        "title": title,
                        "sha256": file_hash,
                        "pageCount": len(pages),
                        "chunkCount": len(chunks),
                    },
                    request_id=request_id,
                    connection=db,
                )
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return self.get_document(document_id)

    def list_documents(
        self,
        *,
        status: str | None = "active",
        vendor: str | None = None,
        equipment_type: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        limit, offset = page_args(page, page_size)
        clauses: list[str] = []
        values: list[Any] = []
        for column, value in (
            ("status", status),
            ("vendor", vendor),
            ("equipment_type", equipment_type),
        ):
            if value:
                clauses.append(f"{column}=?")
                values.append(value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            total = db.execute(
                f"SELECT count(*) FROM manual_documents {where}",
                values,
            ).fetchone()[0]
            rows = db.execute(
                f"""
                SELECT d.*,
                       (SELECT count(*) FROM manual_chunks c
                        WHERE c.document_id=d.document_id) AS chunk_count
                FROM manual_documents d
                {where}
                ORDER BY d.created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*values, limit, offset],
            ).fetchall()
        return {
            "items": [self._project_document(row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }

    def get_document(self, document_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                """
                SELECT d.*,
                       (SELECT count(*) FROM manual_chunks c
                        WHERE c.document_id=d.document_id) AS chunk_count
                FROM manual_documents d WHERE d.document_id=?
                """,
                (document_id,),
            ).fetchone()
        if row is None:
            raise PlatformError("manual_not_found", "未找到手册", 404)
        return self._project_document(row)

    def search(
        self,
        query: str,
        *,
        document_id: str | None = None,
        vendor: str | None = None,
        equipment_type: str | None = None,
        fault_domain: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        normalized = self._normalize(query)
        if not normalized or len(normalized) > 200:
            raise PlatformError(
                "validation_error",
                "query 不能为空且长度不能超过 200",
                422,
            )
        if limit < 1 or limit > 50:
            raise PlatformError("validation_error", "limit 必须在 1 到 50 之间", 422)
        filters: list[str] = ["d.status='active'"]
        values: list[Any] = []
        for column, value in (
            ("d.document_id", document_id),
            ("d.vendor", vendor),
            ("d.equipment_type", equipment_type),
        ):
            if value:
                filters.append(f"{column}=?")
                values.append(value)
        if fault_domain:
            filters.append("d.fault_domains_json LIKE ?")
            values.append(f'%"{fault_domain}"%')
        where = " AND ".join(filters)
        rows: list[sqlite3.Row] = []
        fts_query = self._fts_query(query)
        if fts_query:
            with self.connect() as db:
                try:
                    rows = db.execute(
                        f"""
                        SELECT c.*,d.title,d.vendor,d.equipment_type,d.file_sha256,
                               bm25(manual_chunks_fts) AS rank
                        FROM manual_chunks_fts
                        JOIN manual_chunks c
                          ON c.chunk_id=manual_chunks_fts.chunk_id
                        JOIN manual_documents d
                          ON d.document_id=c.document_id
                        WHERE manual_chunks_fts MATCH ? AND {where}
                        ORDER BY rank, c.page_number, c.ordinal
                        LIMIT ?
                        """,
                        [fts_query, *values, limit * 3],
                    ).fetchall()
                except sqlite3.OperationalError:
                    rows = []
        provider = "sqlite-fts5"
        if not rows:
            provider = "sqlite-normalized-like"
            with self.connect() as db:
                rows = db.execute(
                    f"""
                    SELECT c.*,d.title,d.vendor,d.equipment_type,d.file_sha256,
                           0.0 AS rank
                    FROM manual_chunks c
                    JOIN manual_documents d ON d.document_id=c.document_id
                    WHERE c.normalized_content LIKE ? AND {where}
                    ORDER BY c.document_id,c.page_number,c.ordinal
                    LIMIT ?
                    """,
                    [f"%{normalized}%", *values, limit * 3],
                ).fetchall()
        seen_pages: set[tuple[str, int]] = set()
        items = []
        for row in rows:
            key = (row["document_id"], row["page_number"])
            if key in seen_pages:
                continue
            seen_pages.add(key)
            items.append(self._project_search_result(row, query, len(items)))
            if len(items) >= limit:
                break
        return {
            "query": query.strip(),
            "provider": provider,
            "items": items,
            "total": len(items),
        }

    def reindex(
        self,
        document_id: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        document = self.get_document(document_id)
        content = self._safe_storage_path(document["storageKey"]).read_bytes()
        pages = self._extract_pages(content)
        chunks = [
            (page_number, ordinal, text)
            for page_number, page_text in pages
            for ordinal, text in enumerate(self._chunk(page_text))
        ]
        if not chunks:
            raise PlatformError("manual_text_empty", "PDF 未提取到可检索文本", 422)
        stamp = utc_now()
        with self.transaction() as db:
            chunk_ids = [
                row[0]
                for row in db.execute(
                    "SELECT chunk_id FROM manual_chunks WHERE document_id=?",
                    (document_id,),
                )
            ]
            if chunk_ids:
                db.executemany(
                    "DELETE FROM manual_chunks_fts WHERE chunk_id=?",
                    [(item,) for item in chunk_ids],
                )
            db.execute("DELETE FROM manual_chunks WHERE document_id=?", (document_id,))
            self._insert_chunks(db, document_id, chunks, stamp)
            db.execute(
                """
                UPDATE manual_documents
                SET page_count=?,updated_at=? WHERE document_id=?
                """,
                (len(pages), stamp, document_id),
            )
            self.audit.record(
                "manual.reindexed",
                "manual_document",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=document_id,
                metadata={"pageCount": len(pages), "chunkCount": len(chunks)},
                request_id=request_id,
                connection=db,
            )
        return self.get_document(document_id)

    def delete(
        self,
        document_id: str,
        *,
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> None:
        document = self.get_document(document_id)
        with self.transaction() as db:
            chunk_ids = [
                row[0]
                for row in db.execute(
                    "SELECT chunk_id FROM manual_chunks WHERE document_id=?",
                    (document_id,),
                )
            ]
            db.executemany(
                "DELETE FROM manual_chunks_fts WHERE chunk_id=?",
                [(item,) for item in chunk_ids],
            )
            db.execute("DELETE FROM manual_documents WHERE document_id=?", (document_id,))
            self.audit.record(
                "manual.deleted",
                "manual_document",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=document_id,
                metadata={"title": document["title"], "sha256": document["sha256"]},
                request_id=request_id,
                connection=db,
            )
        self._safe_storage_path(document["storageKey"]).unlink(missing_ok=True)

    def _insert_chunks(
        self,
        db: sqlite3.Connection,
        document_id: str,
        chunks: list[tuple[int, int, str]],
        stamp: str,
    ) -> None:
        for page_number, ordinal, text in chunks:
            chunk_id = f"CHK-{uuid.uuid4().hex.upper()}"
            db.execute(
                """
                INSERT INTO manual_chunks
                (chunk_id,document_id,page_number,ordinal,content,
                 normalized_content,char_count,content_sha256,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    chunk_id,
                    document_id,
                    page_number,
                    ordinal,
                    text,
                    self._normalize(text),
                    len(text),
                    sha256_bytes(text.encode("utf-8")),
                    stamp,
                ),
            )
            db.execute(
                "INSERT INTO manual_chunks_fts(chunk_id,content) VALUES (?,?)",
                (chunk_id, text),
            )

    @staticmethod
    def _extract_pages(content: bytes) -> list[tuple[int, str]]:
        try:
            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted:
                try:
                    if reader.decrypt("") == 0:
                        raise PlatformError(
                            "manual_encrypted",
                            "加密 PDF 无法读取",
                            422,
                        )
                except Exception as exc:
                    if isinstance(exc, PlatformError):
                        raise
                    raise PlatformError("manual_encrypted", "加密 PDF 无法读取", 422) from exc
            return [
                (index, (page.extract_text() or "").strip())
                for index, page in enumerate(reader.pages, start=1)
            ]
        except (PdfReadError, OSError, ValueError) as exc:
            raise PlatformError("manual_pdf_invalid", "PDF 解析失败", 422) from exc

    def _chunk(self, text: str) -> list[str]:
        paragraphs = [
            re.sub(r"\s+", " ", item).strip()
            for item in re.split(r"\n\s*\n|\r\n\s*\r\n", text)
            if item.strip()
        ]
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            pieces = [
                paragraph[index : index + self.chunk_chars]
                for index in range(0, len(paragraph), self.chunk_chars)
            ]
            for piece in pieces:
                candidate = f"{current}\n{piece}".strip() if current else piece
                if len(candidate) <= self.chunk_chars:
                    current = candidate
                else:
                    chunks.append(current)
                    current = piece
        if current:
            chunks.append(current)
        return chunks

    def _safe_storage_path(self, storage_key: str) -> Path:
        root = self.storage_root.resolve()
        target = (root / storage_key).resolve()
        if target.parent != root:
            raise PlatformError("storage_key_invalid", "手册存储路径无效", 500)
        return target

    @staticmethod
    def _normalize(value: str) -> str:
        return re.sub(
            r"\s+",
            "",
            unicodedata.normalize("NFKC", value).lower(),
        )

    @staticmethod
    def _fts_query(value: str) -> str:
        terms = re.findall(r"[\w\u3400-\u9fff]+", value.lower())
        return " AND ".join(f'"{term.replace(chr(34), "")}"' for term in terms[:8])

    @staticmethod
    def _required(value: Any, field: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        result = value.strip()
        if len(result) > max_length:
            raise PlatformError("validation_error", f"{field} 过长", 422)
        return result

    @staticmethod
    def _optional(value: Any, max_length: int) -> str | None:
        if value is None or value == "":
            return None
        if not isinstance(value, str) or len(value.strip()) > max_length:
            raise PlatformError("validation_error", "手册元数据字段无效", 422)
        return value.strip()

    @staticmethod
    def _project_document(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["document_id"],
            "sourceId": row["source_id"],
            "title": row["title"],
            "vendor": row["vendor"],
            "equipmentType": row["equipment_type"],
            "faultDomains": load_json(row["fault_domains_json"], []),
            "version": row["document_version"],
            "originalFilename": row["original_filename"],
            "sha256": row["file_sha256"],
            "storageKey": row["storage_key"],
            "pageCount": row["page_count"],
            "chunkCount": row["chunk_count"] if "chunk_count" in row.keys() else None,
            "status": row["status"],
            "importedBy": row["imported_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _project_search_result(
        row: sqlite3.Row,
        query: str,
        index: int,
    ) -> dict[str, Any]:
        content = row["content"]
        normalized_query = query.strip().lower()
        position = content.lower().find(normalized_query)
        if position < 0:
            position = 0
        start = max(0, position - 90)
        end = min(len(content), position + max(160, len(query) + 90))
        return {
            "documentId": row["document_id"],
            "title": row["title"],
            "vendor": row["vendor"],
            "equipmentType": row["equipment_type"],
            "pageNumber": row["page_number"],
            "chunkId": row["chunk_id"],
            "excerpt": content[start:end],
            "score": round(max(0.05, 1.0 - index * 0.07), 3),
            "evidenceRef": f"manual:{row['document_id']}:page:{row['page_number']}",
            "documentSha256": row["file_sha256"],
        }
