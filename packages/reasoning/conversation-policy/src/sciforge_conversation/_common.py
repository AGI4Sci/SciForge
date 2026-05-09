from __future__ import annotations

from collections.abc import Mapping, Sequence
from hashlib import sha1
from json import dumps
from typing import Any


def is_record(value: Any) -> bool:
    return isinstance(value, Mapping)


def as_record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def string_list(value: Any) -> list[str]:
    out: list[str] = []
    for item in as_list(value):
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


def first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def stable_json(value: Any) -> str:
    return dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def estimate_bytes(value: Any) -> int:
    return len(stable_json(value).encode("utf-8"))


def digest_text(value: str) -> str:
    return sha1(value.encode("utf-8")).hexdigest()


def failure(code: str, detail: str, *, next_actions: Sequence[str], severity: str = "repairable", evidence_refs: Sequence[str] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "detail": detail,
        "severity": severity,
        "reason": {"code": code, "message": detail},
        "nextActions": list(next_actions),
        "evidenceRefs": list(evidence_refs or []),
    }


def failed_result(schema_version: str, code: str, detail: str, *, next_actions: Sequence[str], evidence_refs: Sequence[str] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": schema_version,
        "status": "failed-with-reason",
        "ok": False,
        "reason": {"code": code, "message": detail},
        "nextActions": list(next_actions),
        "evidenceRefs": list(evidence_refs or []),
    }
