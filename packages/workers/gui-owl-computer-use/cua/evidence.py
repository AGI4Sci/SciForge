"""Deterministic, content-free Computer Use concurrency evidence."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable, Mapping


_RESOURCE_KEYS = (
    "sessions", "requests", "activeLeases", "activeChannels",
    "activeRequests", "cleanupPending", "waiters", "backendHandles",
    "activeChildControls", "activeBoundaries", "browserContexts", "pages",
    "browserProcesses", "ports", "profiles", "tempDirectories",
)


def build_concurrency_evidence(
    *,
    run_id: str,
    child_spans: Iterable[Mapping[str, Any]],
    resources_before: Mapping[str, int],
    resources_after: Mapping[str, int],
) -> dict[str, Any]:
    """Return compact evidence plus SHA-256 without prompts, page text, or secrets."""
    children = sorted(
        (
            {
                "childId": str(item["childId"]),
                "targetId": str(item["targetId"]),
                "startedNs": int(item["startedNs"]),
                "finishedNs": int(item["finishedNs"]),
                "verification": str(item["verification"]),
            }
            for item in child_spans
        ),
        key=lambda item: item["childId"],
    )
    if not children:
        raise ValueError("at least one child span is required")
    overlap_ns = max(
        0,
        min(item["finishedNs"] for item in children)
        - max(item["startedNs"] for item in children),
    )
    payload = {
        "schemaVersion": 1,
        "runId": str(run_id),
        "childCount": len(children),
        "children": children,
        "commonActionOverlapNs": overlap_ns,
        "resourcesBefore": _resources(resources_before),
        "resourcesAfter": _resources(resources_after),
    }
    canonical = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return {
        "evidence": payload,
        "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }


def _resources(values: Mapping[str, int]) -> dict[str, int]:
    return {key: int(values.get(key, 0)) for key in _RESOURCE_KEYS}
