from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from .app import create_app


def main() -> int:
    parser = argparse.ArgumentParser(description="Governed case authoring operations")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("draft_id")
    commands.add_parser("rebuild-registry")
    export = commands.add_parser("export-release")
    export.add_argument("release_id")
    export.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    app = create_app()
    service = app.extensions["la_services"]["caseAuthoring"]
    actor = {"id": "case-authoring-cli", "role": "admin"}
    if args.command == "validate":
        result = service.validate(args.draft_id, actor)
    elif args.command == "rebuild-registry":
        with service.transaction() as db:
            service._rebuild_active(db)
        service.registry.refresh_runtime()
        result = {"registryVersion": service.registry.registry_version}
    else:
        release = service.get_release(args.release_id)
        source = service.release_root / release["storageKey"]
        target = args.output_dir.resolve() / release["caseId"] / release["version"]
        if target.exists():
            raise FileExistsError(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target)
        result = {**release, "exportedTo": str(target)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
