from __future__ import annotations

from typing import Any

from ._common import as_list, as_record, first_text, string_list

SCHEMA_VERSION = "sciforge.conversation.recovery-plan.v1"


def plan_recovery(failure: dict[str, Any] | None = None, digests: list[dict[str, Any]] | None = None, attempts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    failure = as_record(failure)
    digests = [as_record(item) for item in as_list(digests)]
    attempts = [as_record(item) for item in as_list(attempts)]
    code = _failure_code(failure)
    message = first_text(failure.get("message"), failure.get("detail"), failure.get("failureReason"), failure.get("reason")) or code
    retry_count = sum(1 for attempt in attempts if first_text(attempt.get("recoveryAction"), attempt.get("action")) in {"repair", "digest-recovery"})
    max_retries = int(failure.get("maxRecoveryAttempts", 2) or 2)
    usable_digests = [digest for digest in digests if _has_digest_ref(digest)]

    if retry_count >= max_retries:
        return _plan(
            "failed-with-reason",
            code,
            f"Recovery budget exhausted after {retry_count} attempt(s): {message}",
            next_actions=["Show the structured failure to the user.", "Keep logs, digest refs, and prior attempts for a manual follow-up."],
            evidence_refs=_evidence_refs(failure, usable_digests, attempts),
            retryable=False,
        )

    if code == "silent-stream":
        if usable_digests:
            return _plan(
                "digest-recovery",
                code,
                "Backend stream went silent; current-reference digests are available for bounded result recovery.",
                next_actions=["Generate a user-visible result from currentReferenceDigests.", "Mark recovered output as digest recovery and preserve original silent-stream evidence."],
                evidence_refs=_evidence_refs(failure, usable_digests, attempts),
            )
        return _plan(
            "repair",
            code,
            "Backend stream went silent and no digest refs are available.",
            next_actions=["Retry with compact context and explicit progress requirements.", "If the retry is silent, return failed-with-reason."],
            evidence_refs=_evidence_refs(failure, usable_digests, attempts),
        )

    if code in {"missing-output", "missing-required-artifact", "missing-markdown-report", "missing-artifact-ref", "acceptance-failed"}:
        return _plan(
            "repair",
            code,
            f"Output failed acceptance: {message}",
            next_actions=["Run acceptance repair with the failed artifact contract.", "Require structured artifacts/refs before marking success."],
            evidence_refs=_evidence_refs(failure, usable_digests, attempts),
        )

    if code in {"context-window", "payload-budget", "handoff-budget-exceeded"} and usable_digests:
        return _plan(
            "digest-recovery",
            code,
            f"Context or handoff budget failed, but digest refs can recover a bounded answer: {message}",
            next_actions=["Recover from digest refs instead of re-inlining raw context.", "Return report artifact refs generated from the digest recovery."],
            evidence_refs=_evidence_refs(failure, usable_digests, attempts),
        )

    if code in {"backend-failed", "http-429", "rate-limit", "timeout"}:
        return _plan(
            "repair",
            code,
            f"Backend failure is retryable with compact context: {message}",
            next_actions=["Retry once with compact handoff and preserved failure refs.", "Stop after retry budget and return failed-with-reason if still failing."],
            evidence_refs=_evidence_refs(failure, usable_digests, attempts),
        )

    return _plan(
        "failed-with-reason",
        code,
        f"No safe automated recovery is available: {message}",
        next_actions=["Return the structured failure to the user.", "Ask for missing inputs or manual rerun guidance."],
        evidence_refs=_evidence_refs(failure, usable_digests, attempts),
        retryable=False,
    )


def _failure_code(failure: dict[str, Any]) -> str:
    explicit = first_text(failure.get("code"), as_record(failure.get("reason")).get("code"), failure.get("kind"), failure.get("type"))
    text = " ".join(string_list([explicit, failure.get("message"), failure.get("detail"), failure.get("failureReason"), failure.get("reason")])).lower()
    if "silent" in text and "stream" in text:
        return "silent-stream"
    if "missing" in text and "output" in text:
        return "missing-output"
    if "markdown" in text and "report" in text:
        return "missing-markdown-report"
    if "required" in text and "artifact" in text:
        return "missing-required-artifact"
    if "artifact" in text and "ref" in text:
        return "missing-artifact-ref"
    if "context" in text and ("window" in text or "token" in text):
        return "context-window"
    if "429" in text:
        return "http-429"
    if "rate" in text and "limit" in text:
        return "rate-limit"
    if "timeout" in text:
        return "timeout"
    if "acceptance" in text:
        return "acceptance-failed"
    return explicit or "unknown-failure"


def _has_digest_ref(digest: dict[str, Any]) -> bool:
    return any(isinstance(digest.get(key), str) and digest[key].strip() for key in ("ref", "path", "digestRef", "dataRef", "sourceRef"))


def _evidence_refs(failure: dict[str, Any], digests: list[dict[str, Any]], attempts: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    refs.extend(string_list(failure.get("evidenceRefs")))
    for key in ("ref", "outputRef", "stdoutRef", "stderrRef", "traceRef"):
        value = failure.get(key)
        if isinstance(value, str) and value.strip():
            refs.append(value.strip())
    for digest in digests:
        for key in ("ref", "path", "digestRef", "dataRef", "sourceRef"):
            value = digest.get(key)
            if isinstance(value, str) and value.strip():
                refs.append(value.strip())
    for attempt in attempts[-3:]:
        for key in ("ref", "outputRef", "stdoutRef", "stderrRef", "traceRef"):
            value = attempt.get(key)
            if isinstance(value, str) and value.strip():
                refs.append(value.strip())
    return list(dict.fromkeys(refs))


def _plan(action: str, code: str, message: str, *, next_actions: list[str], evidence_refs: list[str], retryable: bool = True) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": action,
        "action": action,
        "ok": action != "failed-with-reason",
        "retryable": retryable,
        "reason": {"code": code, "message": message},
        "nextActions": next_actions,
        "evidenceRefs": evidence_refs,
    }
