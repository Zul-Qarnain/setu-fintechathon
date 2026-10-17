"""structlog setup with PII redaction: account numbers, emails and phones never reach logs."""

from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

from app.domain.tokenize import redact_obj

_configured = False


def _redact_processor(_logger: Any, _method: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    cleaned: Any = redact_obj(dict(event_dict))
    return dict(cleaned)


class RedactingFilter(logging.Filter):
    """Redacts stdlib log records too (uvicorn, sqlalchemy, third-party)."""

    def filter(self, record: logging.LogRecord) -> bool:
        from app.domain.tokenize import redact_pii

        record.msg = redact_pii(record.getMessage())
        record.args = ()
        return True


def configure_logging(level: int = logging.INFO) -> None:
    global _configured
    if _configured:
        return
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=False,
    )
    root = logging.getLogger()
    root.addFilter(RedactingFilter())
    for h in root.handlers:
        h.addFilter(RedactingFilter())
    _configured = True


def get_logger(name: str = "setu") -> Any:
    return structlog.get_logger(name)
