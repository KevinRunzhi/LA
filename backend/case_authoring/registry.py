from __future__ import annotations

import hashlib
import threading
from pathlib import Path
from typing import Any

try:
    from ..case_package import CasePackageError, CasePackageRegistry, LoadedCasePackage
except ImportError:
    from case_package import CasePackageError, CasePackageRegistry, LoadedCasePackage


class CompositeCasePackageRegistry:
    """Merges bundled packages with governed runtime releases.

    Runtime packages override bundled packages with the same case ID. Refresh
    swaps a complete in-memory snapshot so a request never observes half of a
    registry rebuild.
    """

    def __init__(
        self,
        bundled: CasePackageRegistry,
        runtime_root: Path,
        *,
        shared_sources_file: Path | None,
        schemas_dir: Path,
    ):
        self.bundled = bundled
        self.runtime_root = runtime_root
        self.shared_sources_file = shared_sources_file
        self.schemas_dir = schemas_dir
        self._lock = threading.RLock()
        self._runtime: CasePackageRegistry | None = None

    def load(self) -> "CompositeCasePackageRegistry":
        self.bundled.load()
        self.refresh_runtime()
        return self

    def refresh_runtime(self) -> None:
        candidate = None
        registry_file = self.runtime_root / "case_registry.json"
        if registry_file.is_file():
            candidate = CasePackageRegistry(
                self.runtime_root,
                self.shared_sources_file,
                self.schemas_dir,
            ).load()
        with self._lock:
            self._runtime = candidate

    @property
    def registry_version(self) -> str:
        with self._lock:
            suffix = self._runtime.registry_version if self._runtime else "none"
            digest = hashlib.sha256(
                f"{self.bundled.registry_version}:{suffix}".encode()
            ).hexdigest()[:8]
            return f"{self.bundled.registry_version}+{digest}"

    @property
    def routing_config(self) -> dict[str, Any]:
        return self.bundled.routing_config

    @property
    def load_errors(self) -> dict[str, CasePackageError]:
        with self._lock:
            values = dict(self.bundled.load_errors)
            if self._runtime:
                values.update(self._runtime.load_errors)
            return values

    def runnable_items(self) -> list[dict[str, Any]]:
        with self._lock:
            items = {item["id"]: item for item in self.bundled.runnable_items()}
            if self._runtime:
                items.update({item["id"]: item for item in self._runtime.runnable_items()})
            return list(items.values())

    def list_packages(self) -> list[LoadedCasePackage]:
        with self._lock:
            values = {item.case_id: item for item in self.bundled.list_packages()}
            if self._runtime:
                values.update({item.case_id: item for item in self._runtime.list_packages()})
            order = [item["id"] for item in self.runnable_items()]
            return [values[case_id] for case_id in order if case_id in values]

    def get(self, case_id: str) -> LoadedCasePackage:
        with self._lock:
            if self._runtime:
                try:
                    return self._runtime.get(case_id)
                except CasePackageError as exc:
                    if exc.code != "case_not_found":
                        raise
            return self.bundled.get(case_id)

    def registry_item(self, case_id: str) -> dict[str, Any]:
        with self._lock:
            if self._runtime:
                try:
                    return self._runtime.registry_item(case_id)
                except CasePackageError as exc:
                    if exc.code != "case_not_found":
                        raise
            return self.bundled.registry_item(case_id)
