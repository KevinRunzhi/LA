from __future__ import annotations

import argparse
import time

from .app import create_app


def main() -> int:
    parser = argparse.ArgumentParser(description="Process durable manual ingestion jobs")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--job-id")
    parser.add_argument("--poll-seconds", type=float, default=3.0)
    args = parser.parse_args()
    app = create_app()
    service = app.extensions["la_services"]["ingestion"]
    while True:
        result = service.process_once(args.job_id)
        if result:
            print(
                f"{result['id']} status={result['status']} "
                f"imported={result['counts']['imported']} "
                f"failed={result['counts']['failed']}",
                flush=True,
            )
        if args.once:
            return 0
        if result is None:
            time.sleep(max(0.5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
