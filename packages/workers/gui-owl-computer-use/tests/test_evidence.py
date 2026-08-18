from __future__ import annotations

import json

from cua.evidence import build_concurrency_evidence


def test_evidence_is_deterministic_compact_and_content_free():
    secret = "bearer-secret-never-export"
    page_text = "private account page contents"
    spans = [
        {
            "childId": "child-b", "targetId": "target-b",
            "startedNs": 20, "finishedNs": 80, "verification": "verified",
            "token": secret, "pageText": page_text,
        },
        {
            "childId": "child-a", "targetId": "target-a",
            "startedNs": 10, "finishedNs": 70, "verification": "verified",
        },
    ]
    resources = {"sessions": 0, "requests": 0, "unknownSensitiveCount": 99}
    first = build_concurrency_evidence(
        run_id="run-1", child_spans=spans,
        resources_before=resources, resources_after=resources,
    )
    second = build_concurrency_evidence(
        run_id="run-1", child_spans=reversed(spans),
        resources_before=resources, resources_after=resources,
    )
    assert first == second
    assert len(first["sha256"]) == 64
    assert first["evidence"]["commonActionOverlapNs"] == 50
    serialized = json.dumps(first, sort_keys=True)
    assert secret not in serialized
    assert page_text not in serialized
    assert "unknownSensitiveCount" not in serialized
