from __future__ import annotations

import argparse
import json

from .app import create_app


def main() -> int:
    parser = argparse.ArgumentParser(description="LA platform data operations")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("integrity")
    subcommands.add_parser("backup")
    export = subcommands.add_parser("audit-export")
    export.add_argument("--format", choices=("csv", "jsonl"), default="csv")
    args = parser.parse_args()

    app = create_app()
    services = app.extensions["la_services"]
    actor = {"id": "operations-cli", "role": "admin"}
    if args.command == "integrity":
        result = services["operations"].integrity_run(actor)
    elif args.command == "backup":
        result = services["operations"].backup_assets()
    else:
        result = services["operations"].export_audit(args.format, {}, actor)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
