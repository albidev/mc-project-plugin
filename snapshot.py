"""Bounded snapshot helpers and capability projection."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import uuid


MAX_STALE_SECONDS = 300


def observed_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def capability(status: str, source: str, value: object, error_code: str | None = None,
               *, generation: int = 0, stale_since: str | None = None) -> dict[str, object]:
    return {
        "status": status,
        "stale": status == "stale",
        "source": source,
        "observedAt": observed_at(),
        "generation": generation,
        "errorCode": error_code,
        "staleSince": stale_since,
        "value": value,
    }
