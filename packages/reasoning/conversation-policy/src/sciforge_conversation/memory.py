from __future__ import annotations

import re
from typing import Any, Mapping


INLINE_IMAGE_PAYLOAD = re.compile(r"data:image|;base64,", re.I)


def build_memory_plan(request: Mapping[str, Any] | Any) -> dict[str, Any]:
    """Select bounded conversation memory with stale-history protection."""

    session = _mapping(_get(request, "session") or {})
    policy = _mapping(_get(request, "contextPolicy") or _get(request, "context_policy") or {})
    snapshot = _mapping(_get(request, "goalSnapshot") or _get(request, "goal_snapshot") or {})
    explicit_refs = _string_list(_get(request, "references") or _get(request, "refs") or snapshot.get("requiredReferences") or [])
    messages = _list(session.get("messages"))
    runs = _list(session.get("runs"))
    mode = str(policy.get("mode") or "isolate")

    ledger = build_conversation_ledger(messages, runs)
    selected_messages = _select_messages(messages, mode, explicit_refs)
    selected_runs = _select_runs(runs, mode, explicit_refs)
    excluded = _excluded_history(messages, runs, selected_messages, selected_runs, mode, explicit_refs)

    return {
        "schemaVersion": "sciforge.conversation.memory-plan.v1",
        "mode": mode,
        "recentConversation": selected_messages,
        "recentRuns": selected_runs,
        "conversationLedger": ledger,
        "currentReferenceFocus": explicit_refs,
        "pollutionGuard": {
            "fileRefOnly": True,
            "explicitReferencesFirst": bool(explicit_refs),
            "excludedHistory": excluded,
        },
    }


def build_conversation_ledger(messages: list[Any], runs: list[Any] | None = None) -> list[dict[str, Any]]:
    ledger: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        item = _mapping(message)
        content = _sanitize_text(_text(item.get("content")))
        refs = _refs_from_item(item)
        ledger.append(
            {
                "kind": "message",
                "id": _text(item.get("id") or f"message-{index + 1}"),
                "role": _text(item.get("role") or "unknown"),
                "summary": _clip(content, 220),
                "refs": refs,
            }
        )
    for index, run in enumerate(runs or []):
        item = _mapping(run)
        ledger.append(
            {
                "kind": "run",
                "id": _text(item.get("id") or item.get("runId") or f"run-{index + 1}"),
                "status": _text(item.get("status") or "unknown"),
                "summary": _clip(_sanitize_text(_text(item.get("summary") or item.get("message") or item.get("error"))), 220),
                "refs": _refs_from_item(item),
            }
        )
    return ledger[-30:]


def _select_messages(messages: list[Any], mode: str, explicit_refs: list[str]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for message in messages:
        item = _mapping(message)
        if mode == "isolate" and not _item_mentions_refs(item, explicit_refs):
            continue
        if explicit_refs and not _item_mentions_refs(item, explicit_refs):
            continue
        if mode in {"continue", "repair"} or _item_mentions_refs(item, explicit_refs):
            selected.append(_compact_message(item))
    return selected[-8:]


def _select_runs(runs: list[Any], mode: str, explicit_refs: list[str]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for run in runs:
        item = _mapping(run)
        if explicit_refs and not _item_mentions_refs(item, explicit_refs):
            continue
        if mode == "repair":
            status = _text(item.get("status")).lower()
            if status in {"failed", "failed-with-reason", "error"} or _item_mentions_refs(item, explicit_refs):
                selected.append(_compact_run(item))
            continue
        if mode == "continue":
            selected.append(_compact_run(item))
        elif _item_mentions_refs(item, explicit_refs):
            selected.append(_compact_run(item))
    return selected[-5:]


def _excluded_history(
    messages: list[Any],
    runs: list[Any],
    selected_messages: list[dict[str, Any]],
    selected_runs: list[dict[str, Any]],
    mode: str,
    explicit_refs: list[str],
) -> list[dict[str, str]]:
    selected_ids = {str(item.get("id")) for item in [*selected_messages, *selected_runs]}
    excluded: list[dict[str, str]] = []
    reason = "not-current-reference-grounded" if explicit_refs else "isolated-new-task"
    if mode in {"continue", "repair"} and not explicit_refs:
        return []
    for item in [*_list(messages), *_list(runs)]:
        mapped = _mapping(item)
        item_id = _text(mapped.get("id") or mapped.get("runId"))
        if item_id and item_id not in selected_ids:
            excluded.append({"id": item_id, "reason": reason})
    return excluded[-20:]


def _compact_message(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id")),
        "role": _text(item.get("role") or "unknown"),
        "content": _clip(_sanitize_text(_text(item.get("content"))), 900),
        "refs": _refs_from_item(item),
    }


def _compact_run(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id") or item.get("runId")),
        "status": _text(item.get("status") or "unknown"),
        "summary": _clip(_sanitize_text(_text(item.get("summary") or item.get("message") or item.get("error"))), 900),
        "refs": _refs_from_item(item),
    }


def _item_mentions_refs(item: Mapping[str, Any], refs: list[str]) -> bool:
    if not refs:
        return False
    haystack = "\n".join([_text(item.get("content")), _text(item.get("summary")), _text(item.get("message")), _text(item.get("error")), *_refs_from_item(item)]).lower()
    return any(ref.lower() in haystack for ref in refs)


def _refs_from_item(item: Mapping[str, Any]) -> list[str]:
    refs: list[str] = []
    for key in ("refs", "references", "artifactRefs", "traceRefs", "resultRefs"):
        refs.extend(_string_list(item.get(key)))
    object_refs = item.get("objectReferences")
    if isinstance(object_refs, list):
        refs.extend(_string_list(object_refs))
    return _dedupe(refs)


def _sanitize_text(text: str) -> str:
    if not INLINE_IMAGE_PAYLOAD.search(text):
        return text
    return INLINE_IMAGE_PAYLOAD.sub("[inline-image-payload-removed]", text)


def _clip(text: str, limit: int) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 24)].rstrip() + " [truncated]"


def _get(value: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    refs: list[str] = []
    for item in value:
        if isinstance(item, str):
            refs.append(item)
        elif isinstance(item, Mapping):
            ref = item.get("ref") or item.get("path") or item.get("id") or item.get("uri")
            if ref:
                refs.append(str(ref))
    return _dedupe(refs)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        key = normalized.lower()
        if normalized and key not in seen:
            seen.add(key)
            result.append(normalized)
    return result
