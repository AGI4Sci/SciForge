from __future__ import annotations

import re
from typing import Any, Mapping

DEFAULT_INTENT_KEYWORD_MAP: dict[str, list[dict[str, Any]]] = {
    "report": [{"pattern": r"\b(report|memo|summary|summari[sz]e|markdown|md)\b|综述|报告|总结|备忘录", "weight": 1}],
    "visual": [{"pattern": r"\b(plot|chart|figure|visuali[sz]e|image|diagram)\b|图|可视化|绘图", "weight": 1}],
    "workflow": [{"pattern": r"\b(run|execute|workflow|pipeline|notebook|script)\b|复现|运行|执行|流程|分析", "weight": 1}],
    "repair-action": [{"pattern": r"\b(repair|fix|debug|log|rerun)\b|修复|修正|报错|日志|重跑|排查", "weight": 1}],
    "failure-report": [{"pattern": r"\b(failed|failure|error)\b|失败", "weight": 1}],
    "continue": [{"pattern": r"\b(continue|follow[- ]?up|previous|prior|last round|remember|recall|what did i ask|what was my first)\b|接着|继续|上一轮|刚才|前面|还记得|记得.*(?:一开始|最开始|开始|之前)|一开始.*(?:问题|问|说)|最开始.*(?:问题|问|说)", "weight": 1}],
    "new-task": [{"pattern": r"\b(new task|start over|ignore previous|unrelated)\b|另一个任务|新任务|重新开始|不要沿用|别用上一轮", "weight": 1}],
    "latest": [{"pattern": r"\b(latest|current|today|up to date)\b|最新|当前|今天|现在", "weight": 1}],
    "location": [{"pattern": r"\b(where is|where are|location|path|file refs?|artifact refs?)\b|文件在哪|文件在哪里|位置|路径", "weight": 1}],
    "no-execution": [{"pattern": r"\b(?:do\s+not|don't|without|no)\s+(?:re-?run|run|execute|dispatch|call|invoke|browse|search|retrieve|fetch|read|workspace\s+tools?|tools?)\b|不要(?:重跑|运行|执行|调用|派发|检索|搜索|浏览|读取|访问|使用工具)|不(?:重跑|运行|执行|调用|派发|检索|搜索|浏览|使用工具)", "weight": 1}],
    "context-only": [{"pattern": r"\b(?:current|existing|provided|selected)\s+(?:context|refs?|references?|digests?|artifacts?)\s+only\b|\b(?:current|existing|provided|selected)\s+[\w -]{0,80}?\s(?:context|refs?|references?|digests?|artifacts?)\s+only\b|\b(?:from|using|based on)\s+only\s+(?:the\s+)?(?:current|existing|provided|selected|visible|above|previous|prior|last(?:\s+round)?)\s+[\w -]{0,80}?\s(?:context|refs?|references?|digests?|artifacts?|reports?|tables?|figures?|plots?)\b|\b(?:from|using|based on)\s+(?:the\s+)?(?:current|existing|provided|selected|visible|above|previous|prior|last(?:\s+round)?)\s+(?:context|refs?|references?|digests?|artifacts?|reports?|tables?|figures?|plots?)\b|\b(?:from|using|based on)\s+(?:the\s+)?(?:current|existing|provided|selected|visible|above|previous|prior|last(?:\s+round)?)\s+[\w -]{0,80}?\s(?:context|refs?|references?|digests?|artifacts?|reports?|tables?|figures?|plots?)\b|只(?:基于|使用|用)(?:当前|已有|提供的|选中|已选|可见的|上一轮)?(?:上下文|引用|refs?|digest|摘要|产物|报告|表格|图)", "weight": 1}],
    "answer-only-transform": [{"pattern": r"\banswer[- ]?only\b|\b(?:compress|condense|shorten|summari[sz]e|rewrite|rephrase|convert|turn)\b.{0,80}\b(?:previous|prior|last|existing|above|answer|conclusion|points?|checklist|bullets?|risk\s+register|unresolved\s+risks?)\b|\b(?:previous|prior|last|existing|above|selected|current|reload|reopen|final)\b.{0,100}\b(?:answer|conclusion|points?|checklist|bullets?|summary|risk\s+register|unresolved\s+risks?)\b|(?:压缩|浓缩|改写|重写|总结|归纳|整理).{0,40}(?:上一轮|之前|刚才|已有|答案|结论|要点|清单|风险)", "weight": 1}],
    "no-new-external-io": [{"pattern": r"\b(?:no|without|do\s+not|don't)\s+(?:new\s+)?(?:search|browse|fetch|retrieve|web|external)\b|不要(?:新|重新)?(?:搜索|检索|浏览|访问|抓取|外部)|不(?:新|重新)?(?:搜索|检索|浏览|访问|抓取|外部)", "weight": 1}],
    "no-code": [{"pattern": r"\b(?:no|without|do\s+not|don't)\s+(?:new\s+)?(?:code|coding|script|execution|execute|run)\b|不要(?:新|重新)?(?:代码|编码|脚本|执行|运行)|不(?:新|重新)?(?:代码|编码|脚本|执行|运行)", "weight": 1}],
    "agentserver": [{"pattern": r"\bagent\s*server\b|\bagentserver\b|AgentServer", "weight": 1}],
    "scoped-no-rerun": [{"pattern": r"\b(?:do\s+not|don't|without|no)\s+re-?run\s+(?:unrelated|irrelevant|unnecessary|unchanged|completed|same|duplicate)\b|不要重跑(?:无关|不相关|不必要|已完成|相同|重复)(?:的)?(?:步骤|任务|工作|部分|路径)?|不要(?:重复|重新)(?:执行|运行)(?:无关|不相关|不必要|已完成|相同|重复)(?:的)?(?:步骤|任务|工作|部分|路径)?", "weight": 1}],
    "execution-continuation": [{"pattern": r"\b(?:continue|complete|finish|repair|fix|resume|use|invoke|call|run|execute)\b|继续|完成|修正|修复|恢复|使用|调用|执行|运行|检索|搜索|fetch|provider\s+route|provider", "weight": 1}],
}

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
    keywords = _compile_intent_keywords(request)
    turn_id = _text(_get(request, "turnId") or _get(request, "turn_id") or "current-turn")
    provided_refs = _string_list(_get(request, "references") or _get(request, "refs") or [])
    explicit_refs = _dedupe([*provided_refs, *_extract_refs(prompt)])

    has_prior_context = _has_prior_context(request)
    goal_type = _infer_goal_type(prompt, explicit_refs, has_prior_context, keywords)
    required_formats = _infer_formats(prompt, goal_type)
    task_relation = _infer_task_relation(prompt, bool(explicit_refs), has_prior_context, keywords)
    turn_execution_constraints = _turn_execution_constraints(prompt, explicit_refs, request, keywords)
    required_artifacts = [] if _constraints_context_only(turn_execution_constraints) else _infer_artifacts(prompt, goal_type)

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
        "uiExpectations": _infer_ui_expectations(prompt, keywords),
        "acceptanceCriteria": _acceptance_criteria(prompt, explicit_refs, task_relation),
    }
    if turn_execution_constraints:
        snapshot["turnExecutionConstraints"] = turn_execution_constraints
    freshness = _infer_freshness(prompt, task_relation, keywords)
    if freshness:
        snapshot["freshness"] = freshness
    return snapshot


def _infer_goal_type(prompt: str, refs: list[str], has_prior_context: bool, keywords: Mapping[str, re.Pattern[str]]) -> str:
    if _has_repair_intent(prompt, bool(refs), has_prior_context, keywords):
        return "repair"
    if _matches(keywords, "visual", prompt):
        return "visualization"
    if _matches(keywords, "report", prompt):
        return "report"
    if _matches(keywords, "workflow", prompt) or any(ref.lower().endswith((".py", ".ipynb", ".ts", ".tsx", ".js")) for ref in refs):
        return "workflow"
    return "analysis"


def _infer_task_relation(prompt: str, has_explicit_refs: bool, has_prior_context: bool, keywords: Mapping[str, re.Pattern[str]]) -> str:
    if _matches(keywords, "new-task", prompt):
        return "new-task"
    if _has_repair_intent(prompt, has_explicit_refs, has_prior_context, keywords):
        return "repair"
    if _matches(keywords, "continue", prompt):
        return "continue"
    if has_prior_context and _matches(keywords, "location", prompt):
        return "continue"
    # When there are explicit refs and prior context, the user is scoping to specific
    # artifacts from the current session — treat as continuation with explicit scope.
    if has_explicit_refs:
        return "continue" if has_prior_context else "new-task"
    # Default: when prior session context exists and there is no explicit new-task
    # signal, treat as continuation. This is the primary fix for MultiturnContinuity=false:
    # previously both branches returned "new-task", causing the TypeScript context policy
    # to return mode='isolate' even on natural second-turn follow-ups.
    return "continue" if has_prior_context else "new-task"


def _has_repair_intent(prompt: str, has_explicit_refs: bool, has_prior_context: bool, keywords: Mapping[str, re.Pattern[str]]) -> bool:
    if not _matches(keywords, "repair-action", prompt):
        return False
    if has_prior_context or has_explicit_refs or _matches(keywords, "continue", prompt):
        return True
    return False


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


def _infer_ui_expectations(prompt: str, keywords: Mapping[str, re.Pattern[str]]) -> list[str]:
    expectations: list[str] = []
    if _matches(keywords, "visual", prompt):
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


def _infer_freshness(prompt: str, task_relation: str, keywords: Mapping[str, re.Pattern[str]]) -> dict[str, str] | None:
    if _matches(keywords, "latest", prompt):
        return {"kind": "latest"}
    if task_relation == "continue":
        return {"kind": "current-session"}
    if task_relation == "repair":
        return {"kind": "prior-run"}
    return None


def _turn_execution_constraints(prompt: str, explicit_refs: list[str], request: Mapping[str, Any] | Any, keywords: Mapping[str, re.Pattern[str]]) -> dict[str, Any] | None:
    no_execution = _has_global_no_execution_directive(prompt, keywords)
    context_only = _matches(keywords, "context-only", prompt)
    answer_only_transform = _is_answer_only_transform(prompt, request, keywords)
    if not no_execution and not context_only and not answer_only_transform:
        return None
    forbidden = no_execution or context_only or answer_only_transform
    agentserver_forbidden = forbidden and (
        _matches(keywords, "agentserver", prompt)
        or context_only
        or answer_only_transform
    )
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
                ["answer-only continuation transform can be satisfied from prior Projection/refs"]
                if answer_only_transform
                else []
            ),
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


def _constraints_context_only(constraints: dict[str, Any] | None) -> bool:
    if not constraints:
        return False
    return bool(
        constraints.get("contextOnly") is True
        or constraints.get("agentServerForbidden") is True
        or constraints.get("workspaceExecutionForbidden") is True
        or constraints.get("executionModeHint") == "direct-context-answer"
    )


def _has_global_no_execution_directive(prompt: str, keywords: Mapping[str, re.Pattern[str]]) -> bool:
    if not _matches(keywords, "no-execution", prompt):
        return False
    if _matches(keywords, "scoped-no-rerun", prompt) and _matches(keywords, "execution-continuation", prompt):
        return False
    return True


def _is_answer_only_transform(prompt: str, request: Mapping[str, Any] | Any, keywords: Mapping[str, re.Pattern[str]]) -> bool:
    if not _has_prior_context(request):
        return False
    if not _matches(keywords, "answer-only-transform", prompt):
        return False
    # Transforming the prior answer is direct-context only when the user excludes
    # new IO/code side effects. This keeps fresh/provider/tool work on the normal route.
    return bool(
        _matches(keywords, "no-new-external-io", prompt)
        or _matches(keywords, "no-code", prompt)
        or _matches(keywords, "context-only", prompt)
        or _matches(keywords, "no-execution", prompt)
    )


def _extract_refs(prompt: str) -> list[str]:
    refs = []
    for match in REF_PATTERN.finditer(prompt):
        ref = match.group("ref").strip("`'\".,，。)）]")
        if ref:
            refs.append(ref)
    return _dedupe(refs)


def _compile_intent_keywords(request: Mapping[str, Any] | Any) -> dict[str, re.Pattern[str]]:
    configured = _intent_keyword_map_from_request(request)
    source = configured if configured is not None else DEFAULT_INTENT_KEYWORD_MAP
    compiled: dict[str, re.Pattern[str]] = {}
    for intent, entries in source.items():
        patterns = _keyword_patterns(entries)
        if patterns:
            compiled[intent] = re.compile("|".join(f"(?:{pattern})" for pattern in patterns), re.I)
    return compiled


def _intent_keyword_map_from_request(request: Mapping[str, Any] | Any) -> Mapping[str, Any] | None:
    direct = _get(request, "intentKeywordMap")
    if isinstance(direct, Mapping):
        return direct
    profile = _get(request, "profile")
    if isinstance(profile, Mapping) and isinstance(profile.get("intentKeywordMap"), Mapping):
        return profile["intentKeywordMap"]
    policy_hints = _get(request, "policyHints")
    if isinstance(policy_hints, Mapping) and isinstance(policy_hints.get("intentKeywordMap"), Mapping):
        return policy_hints["intentKeywordMap"]
    metadata = _get(request, "metadata")
    if isinstance(metadata, Mapping) and isinstance(metadata.get("intentKeywordMap"), Mapping):
        return metadata["intentKeywordMap"]
    return None


def _keyword_patterns(entries: Any) -> list[str]:
    if isinstance(entries, str):
        return [entries]
    if not isinstance(entries, list):
        return []
    patterns: list[str] = []
    for entry in entries:
        if isinstance(entry, str):
            patterns.append(entry)
        elif isinstance(entry, Mapping):
            pattern = entry.get("pattern")
            keywords = entry.get("keywords")
            if isinstance(pattern, str):
                patterns.append(pattern)
            elif isinstance(keywords, list):
                words = [re.escape(str(item)) for item in keywords if str(item).strip()]
                if words:
                    patterns.append("|".join(words))
    return patterns


def _matches(keywords: Mapping[str, re.Pattern[str]], intent: str, prompt: str) -> bool:
    pattern = keywords.get(intent)
    return bool(pattern and pattern.search(prompt))


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
