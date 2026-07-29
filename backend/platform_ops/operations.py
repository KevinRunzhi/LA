from __future__ import annotations

import csv
import io
import json
import sqlite3
import tarfile
import tempfile
import uuid
from pathlib import Path
from typing import Any

try:
    from ..case_platform.errors import PlatformError
    from ..core_business.audit import AuditService
    from ..core_business.database import (
        SQLiteService,
        canonical_json,
        json_hash,
        load_json,
        sha256_bytes,
        utc_now,
    )
    from ..runtime.database_ops import backup_database
except ImportError:
    from case_platform.errors import PlatformError
    from core_business.audit import AuditService
    from core_business.database import (
        SQLiteService,
        canonical_json,
        json_hash,
        load_json,
        sha256_bytes,
        utc_now,
    )
    from runtime.database_ops import backup_database


class PlatformOperationsService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        *,
        attachment_root: Path,
        manual_root: Path,
        job_card_root: Path,
        export_root: Path,
        backup_root: Path,
        audit: AuditService,
    ):
        super().__init__(database_path)
        self.asset_roots = {
            "attachments": attachment_root,
            "manuals": manual_root,
            "job-cards": job_card_root,
        }
        self.export_root = export_root
        self.backup_root = backup_root
        self.audit = audit

    def integrity_run(self, actor: dict[str, Any]) -> dict[str, Any]:
        run_id = f"INT-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO data_integrity_runs
                (run_id,status,checked_by,summary_json,started_at)
                VALUES (?,'running',?,'{}',?)
                """,
                (run_id, actor["id"], stamp),
            )
        findings: list[dict[str, Any]] = []
        with self.connect() as db:
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                findings.append(self._finding("error", "database", None, "sqlite_integrity", integrity))
            for row in db.execute("PRAGMA foreign_key_check"):
                findings.append(
                    self._finding("error", "database", str(row[1]), "foreign_key", str(tuple(row)))
                )
            self._check_files(
                findings,
                db,
                "case_run_attachments",
                "attachment_id",
                "storage_key",
                "sha256",
                self.asset_roots["attachments"],
                "attachment",
            )
            self._check_files(
                findings,
                db,
                "manual_documents",
                "document_id",
                "storage_key",
                "file_sha256",
                self.asset_roots["manuals"],
                "manual",
            )
            self._check_files(
                findings,
                db,
                "job_card_documents",
                "document_id",
                "storage_key",
                "pdf_sha256",
                self.asset_roots["job-cards"],
                "job_card",
            )
            chunk_count = db.execute("SELECT count(*) FROM manual_chunks").fetchone()[0]
            fts_count = db.execute("SELECT count(*) FROM manual_chunks_fts").fetchone()[0]
            if chunk_count != fts_count:
                findings.append(
                    self._finding(
                        "error",
                        "search_index",
                        None,
                        "fts_count_mismatch",
                        f"manual_chunks={chunk_count}, fts={fts_count}",
                    )
                )
            for row in db.execute("SELECT version_id,snapshot_json,content_sha256 FROM graph_versions"):
                if json_hash(load_json(row["snapshot_json"], {})) != row["content_sha256"]:
                    findings.append(
                        self._finding(
                            "error",
                            "graph",
                            row["version_id"],
                            "graph_hash_mismatch",
                            "图谱快照摘要不一致",
                        )
                    )
        status = "failed" if any(item["severity"] == "error" for item in findings) else (
            "warning" if findings else "passed"
        )
        summary = {
            "status": status,
            "findingCount": len(findings),
            "errors": sum(item["severity"] == "error" for item in findings),
            "warnings": sum(item["severity"] == "warning" for item in findings),
        }
        with self.transaction() as db:
            for item in findings:
                db.execute(
                    """
                    INSERT INTO data_integrity_findings
                    (finding_id,run_id,severity,category,resource_id,code,
                     message,details_json,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        f"FND-{uuid.uuid4().hex.upper()}",
                        run_id,
                        item["severity"],
                        item["category"],
                        item["resourceId"],
                        item["code"],
                        item["message"],
                        canonical_json(item.get("details", {})),
                        utc_now(),
                    ),
                )
            db.execute(
                """
                UPDATE data_integrity_runs
                SET status=?,summary_json=?,completed_at=? WHERE run_id=?
                """,
                (status, canonical_json(summary), utc_now(), run_id),
            )
            self.audit.record(
                "operations.integrity_completed",
                "integrity_run",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=run_id,
                metadata=summary,
                connection=db,
            )
        return self.get_integrity_run(run_id)

    def list_integrity_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM data_integrity_runs ORDER BY started_at DESC LIMIT ?",
                (min(max(limit, 1), 200),),
            ).fetchall()
        return [self._project_integrity(row) for row in rows]

    def get_integrity_run(self, run_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM data_integrity_runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise PlatformError("integrity_run_not_found", "未找到巡检记录", 404)
            findings = db.execute(
                "SELECT * FROM data_integrity_findings WHERE run_id=? ORDER BY severity,category",
                (run_id,),
            ).fetchall()
        value = self._project_integrity(row)
        value["findings"] = [
            {
                "id": item["finding_id"],
                "severity": item["severity"],
                "category": item["category"],
                "resourceId": item["resource_id"],
                "code": item["code"],
                "message": item["message"],
                "details": load_json(item["details_json"], {}),
            }
            for item in findings
        ]
        return value

    def export_audit(
        self,
        export_format: str,
        filters: dict[str, Any],
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        if export_format not in {"csv", "jsonl"}:
            raise PlatformError("validation_error", "format 必须是 csv 或 jsonl", 422)
        items = self._audit_records(filters)
        content = self._audit_bytes(items, export_format)
        export_id = f"AEX-{uuid.uuid4().hex.upper()}"
        storage_key = f"{export_id}.{export_format}"
        self.export_root.mkdir(parents=True, exist_ok=True)
        target = (self.export_root / storage_key).resolve()
        if target.parent != self.export_root.resolve():
            raise PlatformError("storage_key_invalid", "导出路径无效", 500)
        target.write_bytes(content)
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO audit_exports
                (export_id,format,filter_json,record_count,storage_key,
                 file_sha256,byte_count,created_by,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    export_id,
                    export_format,
                    canonical_json(filters),
                    len(items),
                    storage_key,
                    sha256_bytes(content),
                    len(content),
                    actor["id"],
                    utc_now(),
                ),
            )
            self.audit.record(
                "operations.audit_exported",
                "audit_export",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=export_id,
                metadata={"format": export_format, "records": len(items)},
                connection=db,
            )
        return self.get_export(export_id)

    def get_export(self, export_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM audit_exports WHERE export_id=?", (export_id,)).fetchone()
        if row is None:
            raise PlatformError("audit_export_not_found", "未找到审计导出", 404)
        return {
            "id": row["export_id"],
            "format": row["format"],
            "filters": load_json(row["filter_json"], {}),
            "recordCount": row["record_count"],
            "storageKey": row["storage_key"],
            "sha256": row["file_sha256"],
            "byteCount": row["byte_count"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
        }

    def export_path(self, export_id: str) -> tuple[Path, dict[str, Any]]:
        item = self.get_export(export_id)
        path = (self.export_root / item["storageKey"]).resolve()
        if path.parent != self.export_root.resolve() or not path.is_file():
            raise PlatformError("audit_export_missing", "审计导出文件缺失", 500)
        if sha256_bytes(path.read_bytes()) != item["sha256"]:
            raise PlatformError("audit_export_integrity_failed", "审计导出摘要不一致", 500)
        return path, item

    def backup_assets(self) -> dict[str, Any]:
        self.backup_root.mkdir(parents=True, exist_ok=True)
        backup_id = f"BKP-{uuid.uuid4().hex.upper()}"
        archive = self.backup_root / f"{backup_id}.tar.gz"
        with tempfile.TemporaryDirectory() as temporary:
            stage = Path(temporary) / backup_id
            stage.mkdir()
            database_backup, checksum_sidecar = backup_database(
                self.database_path,
                stage,
            )
            manifest = {"backupId": backup_id, "createdAt": utc_now(), "files": []}
            manifest["files"].append(self._manifest_file(database_backup, stage))
            if checksum_sidecar.exists():
                manifest["files"].append(self._manifest_file(checksum_sidecar, stage))
            for name, root in self.asset_roots.items():
                if not root.exists():
                    continue
                for source in sorted(path for path in root.rglob("*") if path.is_file()):
                    relative = Path("assets") / name / source.relative_to(root)
                    target = stage / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read_bytes())
                    manifest["files"].append(self._manifest_file(target, stage))
            (stage / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(stage, arcname=backup_id, recursive=True)
        return {
            "backupId": backup_id,
            "path": str(archive),
            "sha256": sha256_bytes(archive.read_bytes()),
            "byteCount": archive.stat().st_size,
            "fileCount": len(manifest["files"]),
        }

    def _check_files(self, findings, db, table, id_column, key_column, hash_column, root, category):
        referenced = set()
        for row in db.execute(
            f"SELECT {id_column} AS id,{key_column} AS storage_key,{hash_column} AS digest FROM {table}"
        ):
            path = (root / row["storage_key"]).resolve()
            referenced.add(path)
            if root.resolve() not in path.parents or not path.is_file():
                findings.append(self._finding("error", category, row["id"], "file_missing", str(path)))
            elif sha256_bytes(path.read_bytes()) != row["digest"]:
                findings.append(self._finding("error", category, row["id"], "file_hash_mismatch", str(path)))
        if root.exists():
            for path in root.rglob("*"):
                if path.is_file() and path.resolve() not in referenced:
                    findings.append(self._finding("warning", category, None, "orphan_file", str(path)))

    def _audit_records(self, filters: dict[str, Any]) -> list[dict[str, Any]]:
        allowed = {
            "actorId": "actor_id",
            "action": "action",
            "resourceType": "resource_type",
            "outcome": "outcome",
        }
        clauses: list[str] = []
        values: list[Any] = []
        for field, column in allowed.items():
            value = filters.get(field)
            if value:
                clauses.append(f"{column}=?")
                values.append(value)
        if filters.get("createdFrom"):
            clauses.append("created_at>=?")
            values.append(filters["createdFrom"])
        if filters.get("createdTo"):
            clauses.append("created_at<=?")
            values.append(filters["createdTo"])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as db:
            rows = db.execute(
                f"SELECT * FROM audit_events {where} ORDER BY audit_id",
                values,
            ).fetchall()
        return [self.audit._project(row) for row in rows]

    @staticmethod
    def _finding(severity, category, resource_id, code, message):
        return {
            "severity": severity,
            "category": category,
            "resourceId": resource_id,
            "code": code,
            "message": message[:1000],
            "details": {},
        }

    @staticmethod
    def _audit_bytes(items, export_format):
        if export_format == "jsonl":
            return "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items).encode()
        output = io.StringIO()
        fields = ["auditId", "requestId", "actorId", "actorRole", "action", "resourceType", "resourceId", "outcome", "createdAt", "metadata"]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for item in items:
            writer.writerow({**item, "metadata": canonical_json(item["metadata"])})
        return output.getvalue().encode("utf-8-sig")

    @staticmethod
    def _manifest_file(path: Path, root: Path):
        return {
            "path": path.relative_to(root).as_posix(),
            "sha256": sha256_bytes(path.read_bytes()),
            "bytes": path.stat().st_size,
        }

    @staticmethod
    def _project_integrity(row):
        return {
            "id": row["run_id"],
            "status": row["status"],
            "checkedBy": row["checked_by"],
            "summary": load_json(row["summary_json"], {}),
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
        }
