from __future__ import annotations

import re
from typing import Any, Mapping


REPORT_HINTS = re.compile(r"\b(report|memo|summary|summari[sz]e|markdown|md)\b|综述|报告|总结|备忘录", re.I)
VISUAL_HINTS = re.compile(r"\b(plot|chart|figure|visuali[sz]e|image|diagram)\b|图|可视化|绘图", re.I)
WORKFLOW_HINTS = re.compile(r"\b(run|execute|workflow|pipeline|notebook|script)\b|复现|运行|执行|流程|分析", re.I)
REPAIR_HINTS = re.compile(r"\b(repair|fix|debug|failed|failure|error|log|rerun)\b|修复|失败|报错|日志|重跑|排查", re.I)
CONTINUE_HINTS = re.compile(r"\b(continue|follow[- ]?up|previous|prior|last round)\b|接着|继续|上一轮|刚才|前面", re.I)
NEW_TASK_HINTS = re.compile(r"\b(new task|start over|ignore previous|unrelated)\b|另一个任务|新任务|重新开始|不要沿用|别用上一轮", re.I)
LATEST_HINTS = re.compile(r"\b(latest|current|today|up to date)\b|最新|当前|今天|现在", re.I)
LOCATION_HINTS = re.compile(r"\b(where is|where are|location|path|file refs?|artifact refs?)\b|文件在哪|文件在哪里|位置|路径", re.I)
NO_EXECUTION_HINTS = re.compile(
    r"\b(?:do\s+not|don't|without|no)\s+(?:re-?run|run|execute|dispatch|call|invoke|browse|search|retrieve|fetch|read)\b"
    r"|不要(?:重跑|运行|执行|调用|派发|检索|搜索|浏览|读取|访问)"
    r"|不(?:重跑|运行|执行|调用|派发|检索|搜索|浏览)",
    re.I,
)
CONTEXT_ONLY_HINTS = re.compile(
    r"\b(?:current|existing|provided)\s+(?:context|refs?|references?|digests?|artifacts?)\s+only\b"
    r"|\b(?:from|using|based on)\s+(?:current|existing|provided)\s+(?:context|refs?|references?|digests?|artifacts?)\b"
    r"|只(?:基于|使用|用)(?:当前|已有|提供的)?(?:上下文|引用|refs?|digest|摘要|产物)",
    re.I,
)
AGENTSERVER_HINTS = re.compile(r"\bagent\s*server\b|\bagentserver\b|AgentServer", re.I)

REF_PATTERN = re.compile(
    r"(?P<ref>"
    r"(?:[A-Za-z]:)?[/~.]?[A-Za-z0-9_ .\-/]+?\.(?:md|txt|json|csv|tsv|pdf|png|jpg|jpeg|svg|html|ipynb|py|ts|tsx|js|log)"
    r"|(?:artifact|trace|run|ref|file)[:#][\w./:-]+"
    r")",
    re.I,
)


def build_goal_snapshot(request: Mapping[str, Any] | Any) -> dict[str, Any]:
    """Infer a compact current-turn goal snapshot without requiring contracts.py.

    Local compatibility note: T093 asked not to edit contracts.py. This function
    therefore accepts either mapping-style inputs or light objects and treats
    absent contract fields as empty values.
    """

    prompt = _text(_get(request, "prompt") or _get(request, "rawPrompt") or _get(request, "message"))
    turn_id = _text(_get(request, "turnId") or _get(request, "turn_id") or "current-turn")
    provided_refs = _string_list(_get(request, "references") or _get(request, "refs") or [])
    explicit_refs = _dedupe([*provided_refs, *_extract_refs(prompt)])

    goal_type = _infer_goal_type(prompt, explicit_refs)
    required_formats = _infer_formats(prompt, goal_type)
    required_artifacts = _infer_artifacts(prompt, goal_type)
    task_relation = _infer_task_relation(prompt, bool(explicit_refs), _has_prior_context(request))

    snapshot: dict[str, Any] = {
        "schemaVersion": "sciforge.conversation.goal-snapshot.v1",
        "turnId": turn_id,
        "rawPrompt": prompt,
        "normalizedPrompt": _compact(prompt),
        "goalType": goal_type,
        "taskRelation": task_relation,
        "requiredFormats": required_formats,
        "requiredArtifacts": required_artifacts,
        "requiredReferences": explicit_refs,
        "referencePolicy": {
            "explicitReferencesFirst": bool(explicit_refs),
            "allowHistoryFallback": task_relation in {"continue", "repair"} and not explicit_refs,
            "pollutionGuard": "do-not-answer-from-stale-history-when-current-refs-exist",
        },
        "uiExpectations": _infer_ui_expectations(prompt),
        "acceptanceCriteria": _acceptance_criteria(prompt, explicit_refs, task_relation),
    }
    turn_execution_constraints = _turn_execution_constraints(prompt, explicit_refs, request)
    if turn_execution_constraints:
        snapshot["turnExecutionConstraints"] = turn_execution_constraints
    freshness = _infer_freshness(prompt, task_relation)
    if freshness:
        snapshot["freshness"] = freshness
    return snapshot


def _infer_goal_type(prompt: str, refs: list[str]) -> str:
    if REPAIR_HINTS.search(prompt):
        return "repair"
    if VISUAL_HINTS.search(prompt):
        return "visualization"
    if REPORT_HINTS.search(prompt):
        return "report"
    if WORKFLOW_HINTS.search(prompt) or any(ref.lower().endswith((".py", ".ipynb", ".ts", ".tsx", ".js")) for ref in refs):
        return "workflow"
    return "analysis"


def _infer_task_relation(prompt: str, has_explicit_refs: bool, has_prior_context: bool) -> str:
    if NEW_TASK_HINTS.search(prompt):
        return "new-task"
    if REPAIR_HINTS.search(prompt) and CONTINUE_HINTS.search(prompt):
        return "repair"
    if REPAIR_HINTS.search(prompt):
        return "repair"
    if CONTINUE_HINTS.search(prompt):
        return "continue"
    if has_prior_context and LOCATION_HINTS.search(prompt):
        return "continue"
    if has_explicit_refs:
        return "new-task"
    return "new-task"


def _infer_formats(prompt: str, goal_type: str) -> list[str]:
    formats: list[str] = []
    if re.search(r"\b(markdown|md)\b|Markdown|报告|总结", prompt, re.I):
        formats.append("markdown")
    if re.search(r"\b(csv|tsv|table|matrix|表格)\b", prompt, re.I):
        formats.append("table")
    if goal_type == "visualization":
        formats.append("figure")
    if not formats and goal_type == "report":
        formats.append("markdown")
    return _dedupe(formats)


def _infer_artifacts(prompt: str, goal_type: str) -> list[str]:
    artifacts: list[str] = []
    if goal_type == "report":
        artifacts.append("research-report")
    if goal_type == "visualization":
        artifacts.append("figure")
    if re.search(r"\b(notebook|ipynb|notebook)\b|笔记本", prompt, re.I):
        artifacts.append("notebook")
    if re.search(r"\b(csv|tsv|matrix)\b|矩阵|表格", prompt, re.I):
        artifacts.append("evidence-table")
    if goal_type == "repair":
        artifacts.append("repair-summary")
    return _dedupe(artifacts)


def _infer_ui_expectations(prompt: str) -> list[str]:
    expectations: list[str] = []
    if VISUAL_HINTS.search(prompt):
        expectations.append("render-figure-or-preview")
    if re.search(r"\btable|matrix|csv|tsv\b|表格|矩阵", prompt, re.I):
        expectations.append("render-table")
    return expectations


def _acceptance_criteria(prompt: str, refs: list[str], task_relation: str) -> list[str]:
    criteria = ["answer-current-user-goal"]
    if refs:
        criteria.append("use-explicit-references-before-history")
    if task_relation == "new-task":
        criteria.append("do-not-import-stale-prior-task-assumptions")
    if task_relation == "continue":
        criteria.append("continue-from-relevant-prior-state")
    if task_relation == "repair":
        criteria.append("identify-and-repair-prior-failure")
    if re.search(r"\bdo not fabricate|不要伪造|不要编造\b", prompt, re.I):
        criteria.append("missing-evidence-must-be-reported")
    return criteria


def _infer_freshness(prompt: str, task_relation: str) -> dict[str, str] | None:
    if LATEST_HINTS.search(prompt):
        return {"kind": "latest"}
    if task_relation == "continue":
        return {"kind": "current-session"}
    if task_relation == "repair":
        return {"kind": "prior-run"}
    return None


def _turn_execution_constraints(prompt: str, explicit_refs: list[str], request: Mapping[str, Any] | Any) -> dict[str, Any] | None:
    no_execution = bool(NO_EXECUTION_HINTS.search(prompt))
    context_only = bool(CONTEXT_ONLY_HINTS.search(prompt))
    if not no_execution and not context_only:
        return None
    forbidden = no_execution or context_only
    agentserver_forbidden = forbidden and (AGENTSERVER_HINTS.search(prompt) is not None or context_only)
    session = _get(request, "session")
    artifacts = _get(session, "artifacts") if isinstance(session, Mapping) else []
    execution_units = _get(session, "executionUnits") if isinstance(session, Mapping) else []
    runs = _get(session, "runs") if isinstance(session, Mapping) else []
    return {
        "schemaVersion": "sciforge.turn-execution-constraints.v1",
        "policyId": "sciforge.current-turn-execution-constraints.v1",
        "source": "runtime-contract.turn-constraints",
        "contextOnly": context_only or no_execution,
        "agentServerForbidden": bool(agentserver_forbidden),
        "workspaceExecutionForbidden": bool(forbidden),
        "externalIoForbidden": bool(forbidden),
        "codeExecutionForbidden": bool(forbidden),
        "preferredCapabilityIds": ["runtime.direct-context-answer"],
        "executionModeHint": "direct-context-answer",
        "initialResponseModeHint": "direct-context-answer",
        "reasons": [
            "current turn requested context-only or no-execution handling",
            *(
                ["AgentServer dispatch forbidden by current turn"]
                if agentserver_forbidden
                else []
            ),
        ],
        "evidence": {
            "hasPriorContext": bool(explicit_refs or artifacts or execution_units or runs),
            "referenceCount": len(explicit_refs),
            "artifactCount": len(artifacts) if isinstance(artifacts, list) else 0,
            "executionRefCount": len(execution_units) if isinstance(execution_units, list) else 0,
            "runCount": len(runs) if isinstance(runs, list) else 0,
        },
    }


def _extract_refs(prompt: str) -> list[str]:
    refs = []
    for match in REF_PATTERN.finditer(prompt):
        ref = match.group("ref").strip("`'\".,，。)）]")
        if ref:
            refs.append(ref)
    return _dedupe(refs)


def _get(value: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _has_prior_context(request: Mapping[str, Any] | Any) -> bool:
    session = _get(request, "session")
    if not isinstance(session, Mapping):
        return False
    for key in ("artifacts", "executionUnits", "runs", "messages"):
        value = session.get(key)
        if isinstance(value, list) and value:
            return True
    return False


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


def _compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


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
