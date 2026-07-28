from __future__ import annotations

import logging
import sys

from .app import create_app
from .runtime.config import ConfigurationError


def build_application():
    try:
        application = create_app()
    except ConfigurationError as exc:
        print(f"LA platform configuration error: {exc}", file=sys.stderr)
        raise
    settings = application.config["RUNTIME_SETTINGS"]
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return application


application = build_application()
