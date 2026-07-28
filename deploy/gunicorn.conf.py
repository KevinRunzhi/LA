from __future__ import annotations

import multiprocessing
import os
from pathlib import Path


def integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


bind = f"{os.getenv('APP_HOST', '0.0.0.0')}:{integer('APP_PORT', 8080, 1, 65535)}"

# The legacy presentation path still has a small amount of process-local state.
# One worker preserves deterministic demonstrations; threads provide concurrent
# request handling while SQLite serializes writes with BEGIN IMMEDIATE.
workers = integer("GUNICORN_WORKERS", 1, 1, max(1, multiprocessing.cpu_count()))
threads = integer("GUNICORN_THREADS", 8, 1, 64)
worker_class = "gthread"

timeout = integer("GUNICORN_TIMEOUT", 60, 5, 600)
graceful_timeout = integer("GUNICORN_GRACEFUL_TIMEOUT", 30, 5, 300)
keepalive = integer("GUNICORN_KEEPALIVE", 5, 1, 120)
max_requests = integer("GUNICORN_MAX_REQUESTS", 2000, 0, 1_000_000)
max_requests_jitter = integer("GUNICORN_MAX_REQUESTS_JITTER", 200, 0, 100_000)

accesslog = None
errorlog = "-"
capture_output = True
loglevel = os.getenv("LOG_LEVEL", "INFO").lower()
preload_app = False

tmp_candidate = Path(os.getenv("GUNICORN_WORKER_TMP_DIR", "/dev/shm"))
worker_tmp_dir = str(tmp_candidate if tmp_candidate.is_dir() else Path("/tmp"))

proc_name = "la-industrial-case-platform"
umask = 0o027
