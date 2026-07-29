from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

try:
    from ..case_package import (
        MODULE_NAMES,
        CasePackageError,
        CasePackageRegistry,
    )
    from ..case_platform.errors import PlatformError
    from ..core_business.audit import AuditService
    from ..core_business.database import (
        SQLiteService,
        canonical_json,
        json_hash,
        load_json,
        utc_now,
    )
    from .registry import CompositeCasePackageRegistry
except ImportError:
    from case_package import MODULE_NAMES, CasePackageError, CasePackageRegistry
    from case_platform.errors import PlatformError
    from core_business.audit import AuditService
    from core_business.database import (
        SQLiteService,
        canonical_json,
        json_hash,
        load_json,
        utc_now,
    )
    from case_authoring.registry import CompositeCasePackageRegistry


AUTHORING_MODULES = ("registry", "manifest", *MODULE_NAMES)
FILE_NAMES = {
    "manifest": "manifest.json",
    "intake": "intake.json",
    "diagnosis": "diagnosis.json",
    "guide": "guide.json",
    "assistant": "assistant.json",
    "output": "output.json",
    "feedbackAndGraph": "feedback-and-graph.json",
}
CASE_ID = re.compile(r"^CASE-[A-Z0-9-]{3,64}$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


class CaseAuthoringService(SQLiteService):
    def __init__(
        self,
        database_path: Path,
        *,
        bundled_registry: CasePackageRegistry,
        composite_registry: CompositeCasePackageRegistry,
        shared_sources_file: Path,
        schemas_dir: Path,
        release_root: Path,
        active_root: Path,
        audit: AuditService,
        search_service=None,
    ):
        super().__init__(database_path)
        self.bundled_registry = bundled_registry
        self.registry = composite_registry
        self.shared_sources_file = shared_sources_file
        self.schemas_dir = schemas_dir
        self.release_root = release_root
        self.active_root = active_root
        self.audit = audit
        self.search_service = search_service

    def catalog(self) -> dict[str, Any]:
        return {
            "agentContract": ["manifest", *MODULE_NAMES],
            "items": [
                {
                    **package.public_summary(),
                    "registryItem": self.registry.registry_item(package.case_id),
                }
                for package in self.registry.list_packages()
            ],
            "registryVersion": self.registry.registry_version,
        }

    def create_draft(
        self,
        payload: dict[str, Any],
        actor: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        base_case_id = self._required(payload.get("baseCaseId"), "baseCaseId")
        source = self.registry.get(base_case_id)
        source_item = self.registry.registry_item(base_case_id)
        source_root = self._package_root(base_case_id, source.package_version)
        manifest = self._read_json(source_root / "manifest.json")
        modules = {
            name: self._read_json(source_root / FILE_NAMES[name])
            for name in MODULE_NAMES
        }
        case_id = str(payload.get("caseId") or base_case_id).strip().upper()
        if not CASE_ID.fullmatch(case_id):
            raise PlatformError("validation_error", "caseId 格式无效", 422)
        manifest["identity"]["caseId"] = case_id
        if payload.get("title"):
            manifest["identity"]["title"] = str(payload["title"]).strip()[:160]
        source_item["id"] = case_id
        source_item["package"] = f"{case_id}/manifest.json"
        title = manifest["identity"]["title"]
        draft_id = f"CDR-{uuid.uuid4().hex.upper()}"
        stamp = utc_now()
        all_modules = {"registry": source_item, "manifest": manifest, **modules}
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_authoring_drafts
                (draft_id,case_id,title,status,base_case_id,revision,created_by,
                 created_at,updated_at)
                VALUES (?,?,?,'draft',?,1,?,?,?)
                """,
                (draft_id, case_id, title, base_case_id, actor["id"], stamp, stamp),
            )
            for name, content in all_modules.items():
                db.execute(
                    """
                    INSERT INTO case_authoring_modules
                    (draft_id,module_name,content_json,updated_at)
                    VALUES (?,?,?,?)
                    """,
                    (draft_id, name, canonical_json(content), stamp),
                )
            self._event(db, draft_id, None, "draft.created", actor, {"baseCaseId": base_case_id})
            self.audit.record(
                "case_authoring.draft_created",
                "case_draft",
                actor_id=actor["id"],
                actor_role=actor["role"],
                resource_id=draft_id,
                metadata={"caseId": case_id, "baseCaseId": base_case_id},
                request_id=request_id,
                connection=db,
            )
        return self.get_draft(draft_id)

    def list_drafts(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM case_authoring_drafts ORDER BY updated_at DESC LIMIT ?",
                (min(max(limit, 1), 200),),
            ).fetchall()
        return [self._project_draft(row) for row in rows]

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = self._draft_row(db, draft_id)
            modules = db.execute(
                "SELECT * FROM case_authoring_modules WHERE draft_id=?",
                (draft_id,),
            ).fetchall()
            validation = db.execute(
                """
                SELECT * FROM case_validation_runs WHERE draft_id=?
                ORDER BY created_at DESC LIMIT 1
                """,
                (draft_id,),
            ).fetchone()
            reviews = db.execute(
                "SELECT * FROM case_review_records WHERE draft_id=? ORDER BY created_at",
                (draft_id,),
            ).fetchall()
        value = self._project_draft(row)
        value["modules"] = {
            item["module_name"]: load_json(item["content_json"], {})
            for item in modules
        }
        value["latestValidation"] = self._project_validation(validation) if validation else None
        value["reviews"] = [
            {
                "id": item["review_id"],
                "decision": item["decision"],
                "notes": item["notes"],
                "reviewedBy": item["reviewed_by"],
                "revision": item["revision"],
                "createdAt": item["created_at"],
            }
            for item in reviews
        ]
        return value

    def update_module(
        self,
        draft_id: str,
        module_name: str,
        content: dict[str, Any],
        expected_revision: int,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        if module_name not in AUTHORING_MODULES:
            raise PlatformError("validation_error", "不支持的案例模块", 422)
        if not isinstance(content, dict):
            raise PlatformError("validation_error", "模块内容必须是对象", 422)
        with self.transaction() as db:
            row = self._draft_row(db, draft_id)
            if row["status"] not in {"draft", "rejected"}:
                raise PlatformError("case_draft_state_conflict", "当前状态不允许修改", 409)
            if row["revision"] != expected_revision:
                raise PlatformError(
                    "revision_conflict",
                    "案例草稿已被其他操作修改",
                    409,
                    {"currentRevision": row["revision"]},
                )
            stamp = utc_now()
            db.execute(
                """
                UPDATE case_authoring_modules SET content_json=?,updated_at=?
                WHERE draft_id=? AND module_name=?
                """,
                (canonical_json(content), stamp, draft_id, module_name),
            )
            if db.execute("SELECT changes()").fetchone()[0] != 1:
                raise PlatformError("case_module_not_found", "未找到案例模块", 404)
            db.execute(
                """
                UPDATE case_authoring_drafts
                SET revision=revision+1,status='draft',updated_at=?
                WHERE draft_id=?
                """,
                (stamp, draft_id),
            )
            self._event(db, draft_id, None, "module.updated", actor, {"module": module_name})
        return self.get_draft(draft_id)

    def validate(self, draft_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        draft = self.get_draft(draft_id)
        content_hash = json_hash(draft["modules"])
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        package_hash = None
        try:
            package = self._validate_modules(draft["modules"])
            package_hash = package.package_hash
            warnings.extend(self._routing_warnings(draft["modules"]["registry"], draft["caseId"]))
        except (CasePackageError, OSError, ValueError) as exc:
            errors.append(
                {
                    "code": getattr(exc, "code", "case_compile_failed"),
                    "message": getattr(exc, "message", str(exc)),
                }
            )
        validation_id = f"CVA-{uuid.uuid4().hex.upper()}"
        status = "failed" if errors else "passed"
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_validation_runs
                (validation_id,draft_id,revision,content_sha256,status,errors_json,
                 warnings_json,package_sha256,validated_by,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    validation_id,
                    draft_id,
                    draft["revision"],
                    content_hash,
                    status,
                    canonical_json(errors),
                    canonical_json(warnings),
                    package_hash,
                    actor["id"],
                    utc_now(),
                ),
            )
            self._event(db, draft_id, None, f"validation.{status}", actor, {"errors": len(errors)})
        return self._validation_by_id(validation_id)

    def submit(self, draft_id: str, expected_revision: int, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = self._draft_row(db, draft_id)
            if row["status"] not in {"draft", "rejected"} or row["revision"] != expected_revision:
                raise PlatformError("case_draft_state_conflict", "草稿状态或 revision 不允许提交", 409)
            self._require_current_validation(db, row)
            stamp = utc_now()
            db.execute(
                """
                UPDATE case_authoring_drafts
                SET status='ready_for_review',submitted_at=?,updated_at=?
                WHERE draft_id=?
                """,
                (stamp, stamp, draft_id),
            )
            self._event(db, draft_id, None, "draft.submitted", actor, {})
        return self.get_draft(draft_id)

    def review(
        self,
        draft_id: str,
        decision: str,
        notes: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        if decision not in {"approved", "rejected"}:
            raise PlatformError("validation_error", "decision 必须是 approved 或 rejected", 422)
        with self.transaction() as db:
            row = self._draft_row(db, draft_id)
            if row["status"] != "ready_for_review":
                raise PlatformError("case_draft_state_conflict", "当前草稿不在待审核状态", 409)
            if row["created_by"] == actor["id"] and actor["role"] != "admin":
                raise PlatformError("case_review_self_forbidden", "创建者不能审核自己的草稿", 403)
            validation = self._require_current_validation(db, row)
            db.execute(
                """
                INSERT INTO case_review_records
                (review_id,draft_id,revision,decision,notes,reviewed_by,
                 content_sha256,created_at)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    f"CRV-{uuid.uuid4().hex.upper()}",
                    draft_id,
                    row["revision"],
                    decision,
                    str(notes or "")[:2000],
                    actor["id"],
                    validation["content_sha256"],
                    utc_now(),
                ),
            )
            db.execute(
                "UPDATE case_authoring_drafts SET status=?,updated_at=? WHERE draft_id=?",
                (decision, utc_now(), draft_id),
            )
            self._event(db, draft_id, None, f"review.{decision}", actor, {"notes": notes})
        return self.get_draft(draft_id)

    def publish(
        self,
        draft_id: str,
        version: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        if not SEMVER.fullmatch(version):
            raise PlatformError("validation_error", "version 必须是语义版本，例如 1.2.0", 422)
        draft = self.get_draft(draft_id)
        if draft["status"] != "approved":
            raise PlatformError("case_draft_state_conflict", "只有已批准草稿可以发布", 409)
        modules = json.loads(canonical_json(draft["modules"]))
        modules["manifest"]["packageVersion"] = version
        package = self._validate_modules(modules)
        case_id = draft["caseId"]
        destination = (self.release_root / case_id / version).resolve()
        if self.release_root.resolve() not in destination.parents:
            raise PlatformError("storage_key_invalid", "发布路径无效", 500)
        if destination.exists():
            raise PlatformError("case_release_conflict", "该案例版本已经存在", 409)
        destination.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".case-release-", dir=destination.parent))
        try:
            self._write_package_files(stage, modules)
            os.replace(stage, destination)
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        release_id = f"CRL-{uuid.uuid4().hex.upper()}"
        storage_key = f"{case_id}/{version}"
        with self.transaction() as db:
            try:
                db.execute(
                    "UPDATE case_releases SET status='superseded' WHERE case_id=? AND status='active'",
                    (case_id,),
                )
                db.execute(
                    """
                    INSERT INTO case_releases
                    (release_id,case_id,version,package_sha256,storage_key,
                     registry_item_json,manifest_json,status,source_draft_id,
                     published_by,published_at,activated_at)
                    VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)
                    """,
                    (
                        release_id,
                        case_id,
                        version,
                        package.package_hash,
                        storage_key,
                        canonical_json(modules["registry"]),
                        canonical_json(modules["manifest"]),
                        draft_id,
                        actor["id"],
                        utc_now(),
                        utc_now(),
                    ),
                )
                self._rebuild_active(db)
                db.execute(
                    """
                    UPDATE case_authoring_drafts
                    SET status='published',published_at=?,updated_at=?
                    WHERE draft_id=?
                    """,
                    (utc_now(), utc_now(), draft_id),
                )
                self._event(db, draft_id, release_id, "release.published", actor, {"version": version})
            except Exception:
                shutil.rmtree(destination, ignore_errors=True)
                raise
        self.registry.refresh_runtime()
        return self.get_release(release_id)

    def list_releases(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM case_releases ORDER BY published_at DESC LIMIT ?",
                (min(max(limit, 1), 200),),
            ).fetchall()
        return [self._project_release(row) for row in rows]

    def get_release(self, release_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM case_releases WHERE release_id=?", (release_id,)).fetchone()
        if row is None:
            raise PlatformError("case_release_not_found", "未找到案例发布版本", 404)
        return self._project_release(row)

    def activate(self, release_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as db:
            row = db.execute("SELECT * FROM case_releases WHERE release_id=?", (release_id,)).fetchone()
            if row is None:
                raise PlatformError("case_release_not_found", "未找到案例发布版本", 404)
            db.execute(
                "UPDATE case_releases SET status='superseded' WHERE case_id=? AND status='active'",
                (row["case_id"],),
            )
            db.execute(
                "UPDATE case_releases SET status='active',activated_at=? WHERE release_id=?",
                (utc_now(), release_id),
            )
            self._rebuild_active(db)
            self._event(db, None, release_id, "release.activated", actor, {"caseId": row["case_id"]})
        self.registry.refresh_runtime()
        return self.get_release(release_id)

    def create_suggestion(
        self,
        draft_id: str,
        target_module: str,
        query: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        if target_module not in MODULE_NAMES:
            raise PlatformError("validation_error", "建议目标模块无效", 422)
        self.get_draft(draft_id)
        evidence = []
        if self.search_service:
            result = self.search_service.search(query, {}, actor=actor, limit=8)
            evidence = result["items"]
        suggestion = {
            "summary": f"围绕“{query.strip()}”补充 {target_module} 模块",
            "recommendedAction": "由专家根据证据逐项写入案例模块，保存后重新校验",
            "evidenceIds": [item["id"] for item in evidence],
        }
        suggestion_id = f"CSG-{uuid.uuid4().hex.upper()}"
        with self.transaction() as db:
            db.execute(
                """
                INSERT INTO case_agent_suggestions
                (suggestion_id,draft_id,target_module,query,suggestion_json,
                 evidence_json,status,created_by,created_at)
                VALUES (?,?,?,?,?,?,'proposed',?,?)
                """,
                (
                    suggestion_id,
                    draft_id,
                    target_module,
                    query.strip(),
                    canonical_json(suggestion),
                    canonical_json(evidence),
                    actor["id"],
                    utc_now(),
                ),
            )
            self._event(db, draft_id, None, "suggestion.created", actor, {"suggestionId": suggestion_id})
        return {"id": suggestion_id, "targetModule": target_module, "query": query, "suggestion": suggestion, "evidence": evidence, "status": "proposed"}

    def _package_root(self, case_id: str, version: str) -> Path:
        with self.connect() as db:
            row = db.execute(
                """
                SELECT storage_key FROM case_releases
                WHERE case_id=? AND version=? ORDER BY published_at DESC LIMIT 1
                """,
                (case_id, version),
            ).fetchone()
        if row:
            return (self.release_root / row["storage_key"]).resolve()
        item = self.bundled_registry.registry_item(case_id)
        return (self.bundled_registry.cases_dir / item["package"]).resolve().parent

    def _validate_modules(self, modules: dict[str, Any]):
        missing = [name for name in AUTHORING_MODULES if name not in modules]
        if missing:
            raise PlatformError("case_modules_missing", "案例模块不完整", 422, {"modules": missing})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._write_compilation_root(root, modules)
            registry = CasePackageRegistry(
                root,
                self.shared_sources_file,
                self.schemas_dir,
            ).load()
            case_id = modules["registry"]["id"]
            if case_id in registry.load_errors:
                raise registry.load_errors[case_id]
            return registry.get(case_id)

    def _write_compilation_root(self, root: Path, modules: dict[str, Any]) -> None:
        case_id = modules["registry"]["id"]
        registry = {
            "schemaVersion": "1.1.0",
            "registryVersion": "1.0",
            "routing": self.bundled_registry.routing_config,
            "items": [{**modules["registry"], "package": f"{case_id}/manifest.json"}],
        }
        self._write_json(root / "case_registry.json", registry)
        self._write_package_files(root / case_id, modules)

    def _write_package_files(self, root: Path, modules: dict[str, Any]) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self._write_json(root / "manifest.json", modules["manifest"])
        for name in MODULE_NAMES:
            self._write_json(root / FILE_NAMES[name], modules[name])

    def _rebuild_active(self, db) -> None:
        rows = db.execute(
            "SELECT * FROM case_releases WHERE status='active' ORDER BY case_id"
        ).fetchall()
        if not rows:
            raise PlatformError("case_registry_empty", "运行时注册表没有活动版本", 409)
        parent = self.active_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".active-registry-", dir=parent))
        backup = parent / f".active-backup-{uuid.uuid4().hex}"
        try:
            items = []
            for row in rows:
                source = (self.release_root / row["storage_key"]).resolve()
                target = stage / row["case_id"]
                shutil.copytree(source, target)
                item = load_json(row["registry_item_json"], {})
                item["package"] = f"{row['case_id']}/manifest.json"
                items.append(item)
            self._write_json(
                stage / "case_registry.json",
                {
                    "schemaVersion": "1.1.0",
                    "registryVersion": f"1.{uuid.uuid4().int % 999999999}",
                    "routing": self.bundled_registry.routing_config,
                    "items": items,
                },
            )
            CasePackageRegistry(stage, self.shared_sources_file, self.schemas_dir).load()
            if self.active_root.exists():
                os.replace(self.active_root, backup)
            os.replace(stage, self.active_root)
            shutil.rmtree(backup, ignore_errors=True)
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            if backup.exists() and not self.active_root.exists():
                os.replace(backup, self.active_root)
            raise

    def _routing_warnings(self, item: dict[str, Any], case_id: str) -> list[dict[str, Any]]:
        candidate_terms = {
            term.lower()
            for values in item.get("matchRules", {}).values()
            for term in values
        }
        warnings = []
        for existing in self.registry.runnable_items():
            if existing["id"] == case_id:
                continue
            terms = {
                term.lower()
                for values in existing.get("matchRules", {}).values()
                for term in values
            }
            overlap = sorted(candidate_terms & terms)
            if len(overlap) >= 2:
                warnings.append({"code": "routing_term_overlap", "caseId": existing["id"], "terms": overlap[:10]})
        return warnings

    def _require_current_validation(self, db, draft_row):
        modules = {
            row["module_name"]: load_json(row["content_json"], {})
            for row in db.execute(
                "SELECT * FROM case_authoring_modules WHERE draft_id=?",
                (draft_row["draft_id"],),
            )
        }
        content_hash = json_hash(modules)
        validation = db.execute(
            """
            SELECT * FROM case_validation_runs
            WHERE draft_id=? AND revision=? AND content_sha256=? AND status='passed'
            ORDER BY created_at DESC LIMIT 1
            """,
            (draft_row["draft_id"], draft_row["revision"], content_hash),
        ).fetchone()
        if validation is None:
            raise PlatformError("case_validation_required", "当前 revision 尚未通过校验", 409)
        return validation

    def _validation_by_id(self, validation_id: str) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM case_validation_runs WHERE validation_id=?",
                (validation_id,),
            ).fetchone()
        return self._project_validation(row)

    @staticmethod
    def _project_validation(row) -> dict[str, Any]:
        return {
            "id": row["validation_id"],
            "draftId": row["draft_id"],
            "revision": row["revision"],
            "contentSha256": row["content_sha256"],
            "status": row["status"],
            "errors": load_json(row["errors_json"], []),
            "warnings": load_json(row["warnings_json"], []),
            "packageSha256": row["package_sha256"],
            "validatedBy": row["validated_by"],
            "createdAt": row["created_at"],
        }

    @staticmethod
    def _project_draft(row) -> dict[str, Any]:
        return {
            "id": row["draft_id"],
            "caseId": row["case_id"],
            "title": row["title"],
            "status": row["status"],
            "baseCaseId": row["base_case_id"],
            "baseReleaseId": row["base_release_id"],
            "revision": row["revision"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "submittedAt": row["submitted_at"],
            "publishedAt": row["published_at"],
        }

    @staticmethod
    def _project_release(row) -> dict[str, Any]:
        return {
            "id": row["release_id"],
            "caseId": row["case_id"],
            "version": row["version"],
            "packageSha256": row["package_sha256"],
            "storageKey": row["storage_key"],
            "registryItem": load_json(row["registry_item_json"], {}),
            "manifest": load_json(row["manifest_json"], {}),
            "status": row["status"],
            "sourceDraftId": row["source_draft_id"],
            "publishedBy": row["published_by"],
            "publishedAt": row["published_at"],
            "activatedAt": row["activated_at"],
        }

    @staticmethod
    def _draft_row(db, draft_id):
        row = db.execute(
            "SELECT * FROM case_authoring_drafts WHERE draft_id=?",
            (draft_id,),
        ).fetchone()
        if row is None:
            raise PlatformError("case_draft_not_found", "未找到案例草稿", 404)
        return row

    @staticmethod
    def _event(db, draft_id, release_id, event_type, actor, payload):
        db.execute(
            """
            INSERT INTO case_authoring_events
            (draft_id,release_id,event_type,actor_id,payload_json,created_at)
            VALUES (?,?,?,?,?,?)
            """,
            (draft_id, release_id, event_type, actor["id"], canonical_json(payload), utc_now()),
        )

    @staticmethod
    def _required(value, field):
        if not isinstance(value, str) or not value.strip():
            raise PlatformError("validation_error", f"{field} 不能为空", 422)
        return value.strip()

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
