from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

from flask import Flask, Response, g, request


@dataclass
class RequestMetric:
    count: int = 0
    duration_seconds: float = 0.0


class ServiceMetrics:
    def __init__(self):
        self._lock = threading.Lock()
        self._started_at = time.time()
        self._in_flight = 0
        self._requests: dict[tuple[str, str, int], RequestMetric] = defaultdict(
            RequestMetric
        )

    def request_started(self) -> None:
        with self._lock:
            self._in_flight += 1

    def request_finished(
        self,
        method: str,
        route: str,
        status: int,
        duration_seconds: float,
    ) -> None:
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            metric = self._requests[(method, route, status)]
            metric.count += 1
            metric.duration_seconds += duration_seconds

    def render(self, service_name: str) -> str:
        with self._lock:
            in_flight = self._in_flight
            uptime = max(0.0, time.time() - self._started_at)
            requests = [
                (key, RequestMetric(value.count, value.duration_seconds))
                for key, value in self._requests.items()
            ]
        lines = [
            "# HELP la_service_info Static service identity.",
            "# TYPE la_service_info gauge",
            f'la_service_info{{service="{_label(service_name)}"}} 1',
            "# HELP la_service_uptime_seconds Process uptime in seconds.",
            "# TYPE la_service_uptime_seconds gauge",
            f"la_service_uptime_seconds {uptime:.6f}",
            "# HELP la_http_requests_in_flight Current HTTP requests being handled.",
            "# TYPE la_http_requests_in_flight gauge",
            f"la_http_requests_in_flight {in_flight}",
            "# HELP la_http_requests_total Completed HTTP requests.",
            "# TYPE la_http_requests_total counter",
        ]
        for (method, route, status), metric in sorted(requests):
            labels = (
                f'method="{_label(method)}",'
                f'route="{_label(route)}",'
                f'status="{status}"'
            )
            lines.append(f"la_http_requests_total{{{labels}}} {metric.count}")
        lines.extend(
            [
                "# HELP la_http_request_duration_seconds_total "
                "Accumulated HTTP request duration.",
                "# TYPE la_http_request_duration_seconds_total counter",
            ]
        )
        for (method, route, status), metric in sorted(requests):
            labels = (
                f'method="{_label(method)}",'
                f'route="{_label(route)}",'
                f'status="{status}"'
            )
            lines.append(
                "la_http_request_duration_seconds_total"
                f"{{{labels}}} {metric.duration_seconds:.6f}"
            )
        return "\n".join(lines) + "\n"


def install_observability(
    app: Flask,
    *,
    service_name: str,
    log_level: str,
    json_access_log: bool,
    readiness_check: Callable[[], tuple[bool, dict[str, object]]],
) -> ServiceMetrics:
    metrics = ServiceMetrics()
    logger = logging.getLogger("la.access")
    logger.setLevel(log_level)

    @app.before_request
    def begin_request():
        supplied = request.headers.get("X-Request-ID", "").strip()
        g.request_id = supplied[:128] if supplied else str(uuid.uuid4())
        g.request_started_at = time.perf_counter()
        metrics.request_started()

    @app.after_request
    def finish_request(response):
        duration = max(
            0.0,
            time.perf_counter() - getattr(g, "request_started_at", time.perf_counter()),
        )
        route = request.url_rule.rule if request.url_rule else "unmatched"
        metrics.request_finished(request.method, route, response.status_code, duration)
        response.headers["X-Request-ID"] = getattr(g, "request_id", "")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if json_access_log:
            logger.info(
                json.dumps(
                    {
                        "event": "http_request",
                        "service": service_name,
                        "requestId": getattr(g, "request_id", ""),
                        "method": request.method,
                        "route": route,
                        "path": request.path,
                        "status": response.status_code,
                        "durationMs": round(duration * 1000, 3),
                        "remoteAddress": request.remote_addr,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        return response

    @app.get("/api/health/live")
    def health_live():
        return {
            "status": "ok",
            "service": service_name,
            "check": "liveness",
        }

    @app.get("/api/health/ready")
    def health_ready():
        ready, checks = readiness_check()
        return (
            {
                "status": "ready" if ready else "not_ready",
                "service": service_name,
                "check": "readiness",
                "checks": checks,
            },
            200 if ready else 503,
        )

    @app.get("/api/metrics")
    def service_metrics():
        return Response(
            metrics.render(service_name),
            content_type="text/plain; version=0.0.4; charset=utf-8",
        )

    return metrics


def _label(value: object) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace('"', '\\"')
    )
