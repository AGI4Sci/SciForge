from __future__ import annotations

import re
from typing import Any, Mapping


REPAIR_HINTS = re.compile(r"\b(repair|fix|debug|failed|failure|error|log|rerun)\b|修复|失败|报错|日志|重跑|排查", re.I)
CONTINUE_HINTS = re.compile(r"\b(continue|follow[- ]?up|previous|prior|last round)\b|接着|继续|上一轮|刚才|前面", re.I)
LOCATION_HINTS = re.compile(
    r"\b(where\s+(is|are)|location|path|file\s+refs?|artifact\s+refs?)\b|文件.*(在哪|哪里|在.*哪里|位置)|在哪.*(文件|报告|图表)|哪里.*(文件|报告|图表)|路径|位置",
    re.I,
)
NEW_TASK_HINTS = re.compile(r"\b(new task|start over|ignore previous|unrelated)\b|另一个任务|新任务|重新开始|不要沿用|别用上一轮", re.I)


def build_context_policy(request: Mapping[str, Any] | Any) -> dict[str, Any]:
    """Choose whether this turn may reuse, repair, or must isolate history.

    The function avoids importing contracts.py on purpose. Missing fields are
    interpreted as empty compatibility values until the contract catches up.
    """

    prompt = _text(_get(request, "prompt") or _get(request, "rawPrompt") or _get(request, "message"))
    snapshot = _mapping(_get(request, "goalSnapshot") or _get(request, "goal_snapshot"))
    explicit_refs = _string_list(_get(request, "references") or _get(request, "refs") or snapshot.get("requiredReferences") or [])
    session = _mapping(_get(request, "session") or {})
    prior_goal = _last_prior_goal(session)
    relation = _text(snapshot.get("taskRelation"))

    mode = _infer_mode(prompt, relation, bool(explicit_refs))
    allow_history = mode in {"continue", "repair"} and not (mode == "isolate" or (explicit_refs and mode == "isolate"))
    if explicit_refs and mode == "continue" and not CONTINUE_HINTS.search(prompt):
        allow_history = False

    policy = {
        "schemaVersion": "sciforge.conversation.context-policy.v1",
        "mode": mode,
        "historyReuse": {
            "allowed": allow_history,
            "scope": _history_scope(mode, explicit_refs),
            "maxPriorTurns": 8 if mode in {"continue", "repair"} else 0,
        },
        "referencePriority": {
            "explicitReferences": explicit_refs,
            "explicitReferencesFirst": bool(explicit_refs),
            "historyFallbackAllowed": allow_history and not explicit_refs,
        },
        "pollutionGuard": {
            "dropStaleHistory": mode == "isolate" or bool(explicit_refs),
            "requireCurrentReferenceGrounding": bool(explicit_refs),
            "previousGoal": prior_goal,
            "reason": _reason(mode, prompt, explicit_refs, prior_goal),
        },
    }
    if mode == "repair":
        policy["repairPolicy"] = {
            "target": "previous-run",
            "includeFailureEvidence": True,
            "doNotDeclareSuccessWithoutEvidence": True,
        }
    return policy


def should_isolate_history(request: Mapping[str, Any] | Any) -> bool:
    return build_context_policy(request)["mode"] == "isolate"


def _infer_mode(prompt: str, relation: str, has_explicit_refs: bool) -> str:
    if relation == "repair" or REPAIR_HINTS.search(prompt):
        return "repair"
    if NEW_TASK_HINTS.search(prompt):
        return "isolate"
    if relation == "continue" or CONTINUE_HINTS.search(prompt) or LOCATION_HINTS.search(prompt):
        return "continue"
    if relation == "new-task":
        return "isolate"
    if has_explicit_refs:
        return "isolate"
    return "isolate"


def _history_scope(mode: str, explicit_refs: list[str]) -> str:
    if mode == "repair":
        return "previous-run-and-failure-evidence"
    if mode == "continue":
        return "same-task-recent-turns"
    if explicit_refs:
        return "current-explicit-references-only"
    return "none"


def _reason(mode: str, prompt: str, explicit_refs: list[str], prior_goal: str) -> str:
    if mode == "repair":
        return "repair intent detected; include only prior failure context and current refs"
    if mode == "continue":
        return "continuation intent detected; reuse same-task recent context"
    if explicit_refs:
        return "explicit current references outrank old session memory"
    if prior_goal:
        return "new task defaults to isolation from previous goal"
    return "no continuation or repair signal"


def _last_prior_goal(session: Mapping[str, Any]) -> str:
    messages = session.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if not isinstance(message, Mapping):
            continue
        snapshot = _mapping(message.get("goalSnapshot") or message.get("goal_snapshot"))
        raw = snapshot.get("rawPrompt") or snapshot.get("normalizedPrompt")
        if raw:
            return str(raw)
    return ""


def _get(value: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


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
