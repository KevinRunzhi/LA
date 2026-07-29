from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .errors import PlatformError


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    statements: tuple[str, ...]

    @property
    def checksum(self) -> str:
        content = "\n".join(self.statements).encode("utf-8")
        return hashlib.sha256(content).hexdigest()


CASE_PLATFORM_MIGRATION = Migration(
    version="001",
    name="case platform foundation",
    statements=(
        """
        CREATE TABLE IF NOT EXISTS case_runs (
            run_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            package_version TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision >= 1),
            payload TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            revision INTEGER NOT NULL,
            actor_role TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_idempotency (
            endpoint TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            run_id TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(endpoint, idempotency_key),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_run_attachments (
            attachment_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            storage_key TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            metadata TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS engineer_submission_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL UNIQUE,
            case_id TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS job_card_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id, revision),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS expert_review_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            reviewer_id TEXT NOT NULL,
            decision TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id, revision),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_knowledge_versions (
            knowledge_id TEXT NOT NULL,
            version TEXT NOT NULL,
            run_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            published_by TEXT NOT NULL,
            published_at TEXT NOT NULL,
            PRIMARY KEY(knowledge_id, version),
            UNIQUE(run_id, knowledge_id),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS case_graph_version_deltas (
            delta_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            knowledge_version TEXT NOT NULL,
            verification_level TEXT NOT NULL,
            payload TEXT NOT NULL,
            published_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT,
            FOREIGN KEY(knowledge_id, knowledge_version)
                REFERENCES case_knowledge_versions(knowledge_id, version)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS engineer_case_sync (
            engineer_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            local_version TEXT,
            latest_version TEXT NOT NULL,
            status TEXT NOT NULL,
            synced_at TEXT,
            PRIMARY KEY(engineer_id, knowledge_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_case_runs_case_status ON case_runs(case_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_case_run_events_run ON case_run_events(run_id, event_id)",
        "CREATE INDEX IF NOT EXISTS idx_case_run_attachments_run ON case_run_attachments(run_id)",
        "CREATE INDEX IF NOT EXISTS idx_case_graph_delta_version ON case_graph_version_deltas(knowledge_id, knowledge_version)",
    ),
)

ENGINEER_SNAPSHOT_HISTORY_MIGRATION = Migration(
    version="002",
    name="allow revisioned engineer submission history",
    statements=(
        """
        CREATE TABLE engineer_submission_snapshots_v2 (
            snapshot_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            case_id TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id, revision),
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id) ON DELETE RESTRICT
        )
        """,
        """
        INSERT INTO engineer_submission_snapshots_v2
        (snapshot_id,run_id,revision,case_id,package_hash,content_hash,payload,created_at)
        SELECT snapshot_id,s.run_id,
               COALESCE(
                   (SELECT MAX(e.revision) FROM case_run_events e
                    WHERE e.run_id=s.run_id
                      AND e.event_type='engineer_submitted'),
                   (SELECT revision FROM case_runs r WHERE r.run_id=s.run_id)
               ),
               case_id,package_hash,content_hash,payload,created_at
        FROM engineer_submission_snapshots s
        """,
        "DROP TABLE engineer_submission_snapshots",
        """
        ALTER TABLE engineer_submission_snapshots_v2
        RENAME TO engineer_submission_snapshots
        """,
        """
        CREATE INDEX idx_engineer_submission_run
        ON engineer_submission_snapshots(run_id, revision)
        """,
    ),
)

CORE_BUSINESS_MIGRATION = Migration(
    version="003",
    name="identity manuals governed graph and work orders",
    statements=(
        """
        CREATE TABLE platform_users (
            user_id TEXT PRIMARY KEY,
            account TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('engineer','expert','admin')),
            profile_json TEXT NOT NULL DEFAULT '{}',
            password_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','disabled','locked')),
            failed_login_count INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            token_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE auth_sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            token_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            revoked_at TEXT,
            client_ip TEXT,
            user_agent_hash TEXT,
            FOREIGN KEY(user_id) REFERENCES platform_users(user_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE audit_events (
            audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT,
            actor_id TEXT,
            actor_role TEXT,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            outcome TEXT NOT NULL
                CHECK(outcome IN ('success','denied','failed')),
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE manual_documents (
            document_id TEXT PRIMARY KEY,
            source_id TEXT,
            title TEXT NOT NULL,
            vendor TEXT,
            equipment_type TEXT,
            fault_domains_json TEXT NOT NULL DEFAULT '[]',
            document_version TEXT,
            original_filename TEXT NOT NULL,
            file_sha256 TEXT NOT NULL UNIQUE,
            storage_key TEXT NOT NULL UNIQUE,
            page_count INTEGER NOT NULL CHECK(page_count >= 1),
            status TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','archived')),
            imported_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE manual_chunks (
            chunk_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            page_number INTEGER NOT NULL CHECK(page_number >= 1),
            ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
            content TEXT NOT NULL,
            normalized_content TEXT NOT NULL,
            char_count INTEGER NOT NULL CHECK(char_count > 0),
            content_sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(document_id, page_number, ordinal),
            FOREIGN KEY(document_id) REFERENCES manual_documents(document_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE VIRTUAL TABLE manual_chunks_fts USING fts5(
            chunk_id UNINDEXED,
            content,
            tokenize='unicode61'
        )
        """,
        """
        CREATE TABLE graph_change_sets (
            change_set_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL
                CHECK(status IN ('draft','submitted','approved','rejected','published')),
            base_version_id TEXT,
            case_run_id TEXT,
            created_by TEXT NOT NULL,
            reviewed_by TEXT,
            review_notes TEXT,
            published_version_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(case_run_id) REFERENCES case_runs(run_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE graph_change_items (
            item_id TEXT PRIMARY KEY,
            change_set_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
            entity_type TEXT NOT NULL CHECK(entity_type IN ('node','edge')),
            entity_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(change_set_id, entity_type, entity_id),
            FOREIGN KEY(change_set_id) REFERENCES graph_change_sets(change_set_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE graph_versions (
            version_id TEXT PRIMARY KEY,
            sequence INTEGER NOT NULL UNIQUE,
            parent_version_id TEXT,
            change_set_id TEXT UNIQUE,
            snapshot_json TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            published_by TEXT NOT NULL,
            published_at TEXT NOT NULL,
            FOREIGN KEY(change_set_id) REFERENCES graph_change_sets(change_set_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE maintenance_work_orders (
            order_id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL UNIQUE,
            run_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
            status TEXT NOT NULL
                CHECK(status IN ('draft','assigned','in_progress','completed','archived')),
            revision INTEGER NOT NULL CHECK(revision >= 1),
            assigned_to TEXT,
            due_at TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE job_card_documents (
            document_id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            document_version INTEGER NOT NULL CHECK(document_version >= 1),
            run_revision INTEGER NOT NULL CHECK(run_revision >= 1),
            template_version TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            storage_key TEXT NOT NULL UNIQUE,
            pdf_sha256 TEXT NOT NULL,
            page_count INTEGER NOT NULL CHECK(page_count >= 1),
            byte_count INTEGER NOT NULL CHECK(byte_count > 0),
            generated_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(order_id, document_version),
            UNIQUE(order_id, content_sha256),
            FOREIGN KEY(order_id) REFERENCES maintenance_work_orders(order_id)
                ON DELETE RESTRICT,
            FOREIGN KEY(run_id) REFERENCES case_runs(run_id)
                ON DELETE RESTRICT
        )
        """,
        "CREATE INDEX idx_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at)",
        "CREATE INDEX idx_audit_actor_created ON audit_events(actor_id, created_at)",
        "CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id, created_at)",
        "CREATE INDEX idx_manual_chunks_document ON manual_chunks(document_id, page_number)",
        "CREATE INDEX idx_graph_change_status ON graph_change_sets(status, updated_at)",
        "CREATE INDEX idx_graph_versions_sequence ON graph_versions(sequence DESC)",
        "CREATE INDEX idx_work_orders_status ON maintenance_work_orders(status, updated_at)",
        "CREATE INDEX idx_job_cards_order ON job_card_documents(order_id, document_version DESC)",
    ),
)

PLATFORM_OPERATIONS_MIGRATION = Migration(
    version="004",
    name="durable ingestion search traces and data operations",
    statements=(
        """
        CREATE TABLE knowledge_ingestion_jobs (
            job_id TEXT PRIMARY KEY,
            source_root TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN
                ('pending','running','completed','completed_with_errors','cancelled')),
            options_json TEXT NOT NULL,
            discovered_count INTEGER NOT NULL DEFAULT 0,
            imported_count INTEGER NOT NULL DEFAULT 0,
            skipped_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
            error_summary TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE knowledge_ingestion_items (
            item_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            file_sha256 TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN
                ('pending','running','imported','skipped','failed','cancelled')),
            document_id TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            lease_expires_at TEXT,
            error_code TEXT,
            error_message TEXT,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(job_id, relative_path),
            FOREIGN KEY(job_id) REFERENCES knowledge_ingestion_jobs(job_id)
                ON DELETE CASCADE,
            FOREIGN KEY(document_id) REFERENCES manual_documents(document_id)
                ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE knowledge_search_runs (
            search_run_id TEXT PRIMARY KEY,
            request_id TEXT,
            actor_id TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            query_hash TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            provider_stats_json TEXT NOT NULL,
            result_ids_json TEXT NOT NULL,
            duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE data_integrity_runs (
            run_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('running','passed','warning','failed')),
            checked_by TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT
        )
        """,
        """
        CREATE TABLE data_integrity_findings (
            finding_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')),
            category TEXT NOT NULL,
            resource_id TEXT,
            code TEXT NOT NULL,
            message TEXT NOT NULL,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES data_integrity_runs(run_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE audit_exports (
            export_id TEXT PRIMARY KEY,
            format TEXT NOT NULL CHECK(format IN ('csv','jsonl')),
            filter_json TEXT NOT NULL,
            record_count INTEGER NOT NULL CHECK(record_count >= 0),
            storage_key TEXT NOT NULL UNIQUE,
            file_sha256 TEXT NOT NULL,
            byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX idx_ingestion_jobs_status ON knowledge_ingestion_jobs(status,created_at)",
        "CREATE INDEX idx_ingestion_items_claim ON knowledge_ingestion_items(status,lease_expires_at,updated_at)",
        "CREATE INDEX idx_search_runs_actor ON knowledge_search_runs(actor_id,created_at DESC)",
        "CREATE INDEX idx_integrity_runs_started ON data_integrity_runs(started_at DESC)",
        "CREATE INDEX idx_integrity_findings_run ON data_integrity_findings(run_id,severity)",
        "CREATE INDEX idx_audit_exports_created ON audit_exports(created_at DESC)",
    ),
)

CASE_AUTHORING_MIGRATION = Migration(
    version="005",
    name="case authoring review and immutable releases",
    statements=(
        """
        CREATE TABLE case_authoring_drafts (
            draft_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN
                ('draft','ready_for_review','approved','rejected','published')),
            base_case_id TEXT,
            base_release_id TEXT,
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            submitted_at TEXT,
            published_at TEXT
        )
        """,
        """
        CREATE TABLE case_authoring_modules (
            draft_id TEXT NOT NULL,
            module_name TEXT NOT NULL,
            content_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(draft_id,module_name),
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_validation_runs (
            validation_id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            content_sha256 TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('passed','failed')),
            errors_json TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            package_sha256 TEXT,
            validated_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_review_records (
            review_id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
            notes TEXT NOT NULL,
            reviewed_by TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_releases (
            release_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            version TEXT NOT NULL,
            package_sha256 TEXT NOT NULL,
            storage_key TEXT NOT NULL UNIQUE,
            registry_item_json TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','superseded','disabled')),
            source_draft_id TEXT NOT NULL,
            published_by TEXT NOT NULL,
            published_at TEXT NOT NULL,
            activated_at TEXT NOT NULL,
            UNIQUE(case_id,version),
            FOREIGN KEY(source_draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE case_authoring_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id TEXT,
            release_id TEXT,
            event_type TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE case_agent_suggestions (
            suggestion_id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            target_module TEXT NOT NULL,
            query TEXT NOT NULL,
            suggestion_json TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('proposed','accepted','rejected')),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            decided_by TEXT,
            decided_at TEXT,
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE CASCADE
        )
        """,
        "CREATE INDEX idx_case_drafts_status ON case_authoring_drafts(status,updated_at DESC)",
        "CREATE INDEX idx_case_validations_draft ON case_validation_runs(draft_id,created_at DESC)",
        "CREATE INDEX idx_case_reviews_draft ON case_review_records(draft_id,created_at DESC)",
        "CREATE INDEX idx_case_releases_active ON case_releases(case_id,status,published_at DESC)",
        "CREATE INDEX idx_case_authoring_events_draft ON case_authoring_events(draft_id,created_at)",
    ),
)

CASE_GENERATION_MIGRATION = Migration(
    version="006",
    name="document driven multi agent case generation",
    statements=(
        """
        CREATE TABLE case_generation_jobs (
            job_id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN
                ('created','snapshotting','parsing_documents','extracting_evidence',
                 'classifying_domain','planning','awaiting_outline_review',
                 'generating_modules','criticizing','validating','repairing',
                 'awaiting_patch_review','partially_applied','applied',
                 'completed','failed','cancelled')),
            current_stage TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
            fault_domain TEXT,
            template_id TEXT,
            template_version TEXT,
            outline_status TEXT NOT NULL DEFAULT 'pending' CHECK(outline_status IN
                ('pending','awaiting_review','approved','rejected')),
            outline_artifact_id TEXT,
            options_json TEXT NOT NULL,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
            lease_expires_at TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            failure_code TEXT,
            failure_summary TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE case_generation_sources (
            source_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK(source_type IN
                ('manual','case','graph','field')),
            resource_id TEXT NOT NULL,
            version TEXT,
            content_sha256 TEXT,
            snapshot_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(job_id,source_type,resource_id),
            FOREIGN KEY(job_id) REFERENCES case_generation_jobs(job_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_generation_agent_runs (
            agent_run_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            agent_type TEXT NOT NULL,
            agent_version TEXT NOT NULL,
            provider TEXT NOT NULL,
            template_id TEXT,
            template_version TEXT,
            attempt INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN
                ('pending','running','completed','failed','cancelled')),
            input_artifact_ids_json TEXT NOT NULL,
            evidence_ids_json TEXT NOT NULL,
            input_sha256 TEXT,
            output_artifact_id TEXT,
            output_sha256 TEXT,
            warnings_json TEXT NOT NULL,
            requires_expert_input_json TEXT NOT NULL,
            usage_json TEXT,
            duration_ms INTEGER,
            error_code TEXT,
            error_message TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY(job_id) REFERENCES case_generation_jobs(job_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_generation_artifacts (
            artifact_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            agent_run_id TEXT,
            artifact_type TEXT NOT NULL,
            module_name TEXT,
            content_json TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            schema_status TEXT NOT NULL CHECK(schema_status IN
                ('not_checked','passed','failed')),
            created_at TEXT NOT NULL,
            FOREIGN KEY(job_id) REFERENCES case_generation_jobs(job_id)
                ON DELETE CASCADE,
            FOREIGN KEY(agent_run_id) REFERENCES case_generation_agent_runs(agent_run_id)
                ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE case_generation_evidence_links (
            link_id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            module_name TEXT NOT NULL,
            json_pointer TEXT NOT NULL,
            evidence_id TEXT NOT NULL,
            confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
            review_status TEXT NOT NULL CHECK(review_status IN
                ('pending','accepted','rejected')),
            created_at TEXT NOT NULL,
            FOREIGN KEY(artifact_id) REFERENCES case_generation_artifacts(artifact_id)
                ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE case_generation_patches (
            patch_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            draft_id TEXT NOT NULL,
            module_name TEXT NOT NULL,
            base_revision INTEGER NOT NULL,
            base_content_sha256 TEXT NOT NULL,
            candidate_artifact_id TEXT NOT NULL,
            operations_json TEXT NOT NULL,
            evidence_links_json TEXT NOT NULL,
            risk TEXT NOT NULL CHECK(risk IN ('low','medium','high')),
            status TEXT NOT NULL CHECK(status IN
                ('proposed','accepted','rejected','applied','conflicted')),
            applied_revision INTEGER,
            decided_by TEXT,
            decided_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(job_id) REFERENCES case_generation_jobs(job_id)
                ON DELETE CASCADE,
            FOREIGN KEY(draft_id) REFERENCES case_authoring_drafts(draft_id)
                ON DELETE RESTRICT,
            FOREIGN KEY(candidate_artifact_id) REFERENCES case_generation_artifacts(artifact_id)
                ON DELETE RESTRICT
        )
        """,
        """
        CREATE TABLE case_generation_evaluations (
            evaluation_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            artifact_id TEXT,
            evaluator_type TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')),
            passed INTEGER NOT NULL CHECK(passed IN (0,1)),
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(job_id) REFERENCES case_generation_jobs(job_id)
                ON DELETE CASCADE,
            FOREIGN KEY(artifact_id) REFERENCES case_generation_artifacts(artifact_id)
                ON DELETE CASCADE
        )
        """,
        "CREATE INDEX idx_generation_jobs_claim ON case_generation_jobs(status,lease_expires_at,updated_at)",
        "CREATE INDEX idx_generation_sources_job ON case_generation_sources(job_id,source_type)",
        "CREATE INDEX idx_generation_runs_job ON case_generation_agent_runs(job_id,started_at)",
        "CREATE INDEX idx_generation_artifacts_job ON case_generation_artifacts(job_id,artifact_type)",
        "CREATE INDEX idx_generation_patches_job ON case_generation_patches(job_id,status,module_name)",
        "CREATE INDEX idx_generation_evaluations_job ON case_generation_evaluations(job_id,severity)",
    ),
)

CASE_GENERATION_FIELD_PATCH_MIGRATION = Migration(
    version="007",
    name="case generation field patch selection",
    statements=(
        """
        ALTER TABLE case_generation_patches
        ADD COLUMN selected_operations_json TEXT
        """,
    ),
)

DEFAULT_MIGRATIONS = (
    CASE_PLATFORM_MIGRATION,
    ENGINEER_SNAPSHOT_HISTORY_MIGRATION,
    CORE_BUSINESS_MIGRATION,
    PLATFORM_OPERATIONS_MIGRATION,
    CASE_AUTHORING_MIGRATION,
    CASE_GENERATION_MIGRATION,
    CASE_GENERATION_FIELD_PATCH_MIGRATION,
)


class MigrationRunner:
    def __init__(
        self,
        database_path: Path,
        backup_dir: Path | None = None,
        migrations: Iterable[Migration] = DEFAULT_MIGRATIONS,
    ):
        self.database_path = database_path
        self.backup_dir = backup_dir or database_path.parent / "backups"
        self.migrations = tuple(migrations)

    def migrate(self) -> list[str]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        existed = self.database_path.exists() and self.database_path.stat().st_size > 0
        pending = self._pending_migrations() if existed else self.migrations
        if not pending:
            return []
        if existed:
            self._backup()

        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        applied_now: list[str] = []
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL,
                    validation_result TEXT NOT NULL
                )
                """
            )
            applied = {
                row["version"]: row["checksum"]
                for row in connection.execute(
                    "SELECT version, checksum FROM schema_migrations"
                )
            }
            for migration in pending:
                if migration.version in applied:
                    if applied[migration.version] != migration.checksum:
                        raise PlatformError(
                            "migration_checksum_mismatch",
                            "已执行迁移的内容校验失败",
                            500,
                            {"version": migration.version},
                        )
                    continue
                for statement in migration.statements:
                    connection.execute(statement)
                self._validate(connection)
                connection.execute(
                    """
                    INSERT INTO schema_migrations
                    (version, name, checksum, applied_at, validation_result)
                    VALUES (?, ?, ?, ?, 'passed')
                    """,
                    (
                        migration.version,
                        migration.name,
                        migration.checksum,
                        utc_now(),
                    ),
                )
                applied_now.append(migration.version)
            connection.commit()
            return applied_now
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _pending_migrations(self) -> tuple[Migration, ...]:
        with sqlite3.connect(self.database_path) as connection:
            table = connection.execute(
                """
                SELECT 1 FROM sqlite_master
                WHERE type='table' AND name='schema_migrations'
                """
            ).fetchone()
            if table is None:
                return self.migrations
            applied = {
                row[0]: row[1]
                for row in connection.execute(
                    "SELECT version, checksum FROM schema_migrations"
                )
            }
        pending = []
        for migration in self.migrations:
            checksum = applied.get(migration.version)
            if checksum is None:
                pending.append(migration)
            elif checksum != migration.checksum:
                raise PlatformError(
                    "migration_checksum_mismatch",
                    "已执行迁移的内容校验失败",
                    500,
                    {"version": migration.version},
                )
        return tuple(pending)

    def _backup(self) -> Path:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = self.backup_dir / f"{self.database_path.stem}-{stamp}.db"
        source = sqlite3.connect(self.database_path)
        target = sqlite3.connect(backup_path)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        return backup_path

    @staticmethod
    def _validate(connection: sqlite3.Connection):
        required = {
            "case_runs",
            "case_run_events",
            "case_run_idempotency",
            "case_run_attachments",
            "engineer_submission_snapshots",
            "job_card_snapshots",
            "expert_review_snapshots",
            "case_knowledge_versions",
            "case_graph_version_deltas",
            "engineer_case_sync",
        }
        core_required = {
            "platform_users",
            "auth_sessions",
            "audit_events",
            "manual_documents",
            "manual_chunks",
            "manual_chunks_fts",
            "graph_change_sets",
            "graph_change_items",
            "graph_versions",
            "maintenance_work_orders",
            "job_card_documents",
        }
        operations_required = {
            "knowledge_ingestion_jobs",
            "knowledge_ingestion_items",
            "knowledge_search_runs",
            "data_integrity_runs",
            "data_integrity_findings",
            "audit_exports",
        }
        authoring_required = {
            "case_authoring_drafts",
            "case_authoring_modules",
            "case_validation_runs",
            "case_review_records",
            "case_releases",
            "case_authoring_events",
            "case_agent_suggestions",
        }
        generation_required = {
            "case_generation_jobs",
            "case_generation_sources",
            "case_generation_agent_runs",
            "case_generation_artifacts",
            "case_generation_evidence_links",
            "case_generation_patches",
            "case_generation_evaluations",
        }
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if tables & core_required:
            required.update(core_required)
        if tables & operations_required:
            required.update(operations_required)
        if tables & authoring_required:
            required.update(authoring_required)
        if tables & generation_required:
            required.update(generation_required)
        missing = sorted(required - tables)
        if missing:
            raise PlatformError(
                "migration_validation_failed",
                "数据库迁移缺少必需表",
                500,
                {"tables": missing},
            )
        foreign_key_errors = list(connection.execute("PRAGMA foreign_key_check"))
        if foreign_key_errors:
            raise PlatformError(
                "migration_validation_failed",
                "数据库外键校验失败",
                500,
            )
