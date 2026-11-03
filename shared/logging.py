import json
import logging
import re
from datetime import UTC, datetime

_URL_AUTH = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^\s/@]+(?::[^\s/@]*)?@", re.I)
_SECRETS = re.compile(
    r"(?i)(\b(?:authorization|password|passwd|token|api[_-]?key|secret)\b"
    r"[\s\"']*[:=][\s\"']*)(?:Bearer\s+)?[^\s,;\"'}]+"
)


def redact(value: str) -> str:
    return _SECRETS.sub(r"\1[REDACTED]", _URL_AUTH.sub(r"\1[REDACTED]@", value))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Exception text and messages pass through the same redactor.
        message = record.getMessage()
        if record.exc_info:
            message += "\n" + self.formatException(record.exc_info)
        return json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": redact(message),
                "request_id": getattr(record, "request_id", None),
            },
            ensure_ascii=False,
        )


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
