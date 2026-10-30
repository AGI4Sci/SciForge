#!/usr/bin/env python3
"""Real-app acceptance for reasoning-level discovery.

Drives the running SciForge dev instance through its own dev bridge, so the
checks go through the same IPC surface the settings UI uses. Cases that need a
declaration which only exists in fixtures (unsupported / partial declarations)
are covered by unit tests instead — this script only asserts what the shipped
build can honestly answer.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BRIDGE = "http://127.0.0.1:5174/invoke"
CLIENT = "sciforge-renderer"
RENDERER_ORIGIN = "http://127.0.0.1:5173"
INSTANCE = "model-reasoning-verify"

SHIPPED = {"provider": "intern", "model": "deepseek-v4-flash-0731", "protocol": "chat-completions"}
NEARLY = {"provider": "intern", "model": "deepseek-v4-flash", "protocol": "chat-completions"}


def invoke(channel: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{BRIDGE}?devInstanceId={INSTANCE}",
        data=json.dumps({"channel": channel, "payload": payload}).encode(),
        headers={
            "Content-Type": "application/json",
            "X-SciForge-Client": CLIENT,
            "X-SciForge-Dev-Instance": INSTANCE,
            "Origin": RENDERER_ORIGIN,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            envelope = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{channel}: HTTP {error.code} {error.read()[:300]!r}") from error
    if not envelope.get("ok"):
        raise SystemExit(f"{channel}: {envelope.get('message')}")
    return envelope["payload"]


def main() -> int:
    steps: list[tuple[str, dict]] = []
    failures: list[str] = []

    def check(label: str, condition: bool, detail: object) -> None:
        steps.append((label, detail if isinstance(detail, dict) else {"detail": detail}))
        if not condition:
            failures.append(label)

    shipped = invoke("modelReasoning:discover", SHIPPED)
    check(
        "shipped evidence resolves as known + partial",
        shipped["state"] == "known" and shipped["completeness"] == "partial" and shipped["levels"] == ["high"],
        shipped,
    )
    check("shipped evidence reports its source and date", shipped["source"] == "vocabulary" and shipped["verifiedAt"] == "2026-10-23", shipped)
    check("known evidence attaches an effort only when the user asked", shipped["attachEffort"] is True, shipped)

    nearly = invoke("modelReasoning:discover", NEARLY)
    check(
        "a model that only looks like the verified one stays unknown",
        nearly["state"] == "unknown" and nearly["levels"] == [] and nearly["attachEffort"] is False,
        nearly,
    )

    scoped = invoke("modelReasoning:discover", {**SHIPPED, "endpoint": "https://api.example.com/v1"})
    check("endpoint-scoped lookup still matches the shipped entry", scoped["state"] == "known", scoped)

    forced = invoke("modelReasoning:discover", {**SHIPPED, "force": True})
    check("force refresh re-resolves instead of serving the cache", forced["source"] == "vocabulary" and forced["state"] == "known", forced)

    cached = invoke("modelReasoning:discover", SHIPPED)
    check("a second lookup within the TTL is served from cache", cached["source"] == "cache", cached)

    probe = invoke(
        "modelReasoning:probe",
        {"requestId": "verify-probe-1", "query": SHIPPED, "levels": ["low", "high"]},
    )
    check(
        "probing without a configured runner says so instead of pretending",
        probe["acceptedLevels"] == [] and "not configured" in " ".join(probe["errors"]),
        probe,
    )

    cancel = invoke("modelReasoning:cancel", {"requestId": "verify-probe-1"})
    check("cancelling an unknown probe reports false rather than throwing", cancel == {"cancelled": False}, cancel)

    print(json.dumps({"ok": not failures, "steps": [{"step": s, "detail": d} for s, d in steps], "failures": failures}, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())