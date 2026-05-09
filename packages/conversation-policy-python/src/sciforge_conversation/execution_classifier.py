"""Execution mode classifier for SciForge task routing.

The classifier is intentionally rule-based and compact. It should be easy for
students to edit: add or tune a signal, adjust a weight, and update the tests.
TypeScript callers should consume this module's decision instead of duplicating
complexity logic in the app shell.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import re
from typing import Any, Literal, Mapping, Sequence


ExecutionMode = Literal[
    "direct-context-answer",
    "thin-reproducible-adapter",
    "single-stage-task",
    "multi-stage-project",
    "repair-or-continue-project",
]
ReproducibilityLevel = Literal["none", "light", "full", "staged"]

REPAIR_HINTS = re.compile(r"\b(repair|fix|debug|failed|failure|error|retry|rerun|broken)\b|修复|失败|报错|重试|重跑|排查", re.I)
CONTINUE_HINTS = re.compile(r"\b(continue|follow[- ]?up|previous|prior|last|next stage|resume)\b|继续|接着|上一轮|刚才|前面|下一步|下一阶段", re.I)
GUIDANCE_HINTS = re.compile(r"\b(instead|change|adjust|only|exclude|include|while running|mid[- ]?run|constraint)\b|改成|调整|只要|不要|运行中|中途|追加|约束", re.I)
LIGHT_LOOKUP_HINTS = re.compile(r"\b(search|lookup|find|latest|recent|current|today|news|status|brief)\b|搜索|搜一下|查一下|查找|最新|最近|当前|今天|新闻|简要", re.I)
RESEARCH_HINTS = re.compile(r"\b(research|literature|paper|papers|scholar|sources|citations?)\b|调研|文献|论文|引用|来源", re.I)
SYSTEMATIC_RESEARCH_HINTS = re.compile(r"\b(systematic|survey|review|compare|evidence table|matrix|synthesis|meta[- ]?analysis)\b|系统性|综述|比较|证据表|矩阵|综合", re.I)
FULL_TEXT_HINTS = re.compile(r"\b(download|fetch|retrieve|full[- ]?text|pdf|crawl|read\s+the\s+whole|entire)\b|下载|抓取|全文|通读|阅读全文|整篇", re.I)
CODE_HINTS = re.compile(r"\b(code|modify|edit|patch|implement|refactor|test|bug|script|notebook)\b|代码|修改|实现|重构|测试|脚本|笔记本", re.I)
FILE_HINTS = re.compile(r"\b(file|path|folder|directory|repo|workspace|inspect|explore|read)\b|文件|路径|目录|仓库|工作区|探索|查看|读取", re.I)
ARTIFACT_HINTS = re.compile(r"\b(artifact|output|csv|table|figure|chart|json|markdown|dataset|report)\b|产物|输出|表格|图表|数据集|报告", re.I)
MULTI_STEP_HINTS = re.compile(r"\b(batch|pipeline|end[- ]?to[- ]?end|all|multiple|many|validate|then|and then)\b|批量|流程|全量|多个|全部|验证|然后", re.I)
LONG_OR_UNCERTAIN_HINTS = re.compile(r"\b(long|large|open[- ]?ended|uncertain|unknown|hard|complex|comprehensive|exhaustive)\b|长时间|大型|开放式|不确定|未知|复杂|全面|穷尽", re.I)
DIRECT_QUESTION_HINTS = re.compile(r"\b(what is|who is|explain|define|why|how does|summari[sz]e|answer)\b|是什么|解释|为什么|如何理解|总结|回答", re.I)


@dataclass(frozen=True)
class ExecutionClassifierInput:
    prompt: str = ""
    refs: Sequence[Any] = field(default_factory=tuple)
    artifacts: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    expected_artifact_types: Sequence[str] = field(default_factory=tuple)
    selected_capabilities: Sequence[Any] = field(default_factory=tuple)
    selected_tools: Sequence[Any] = field(default_factory=tuple)
    selected_senses: Sequence[Any] = field(default_factory=tuple)
    selected_verifiers: Sequence[Any] = field(default_factory=tuple)
    recent_failures: Sequence[Any] = field(default_factory=tuple)
    prior_attempts: Sequence[Any] = field(default_factory=tuple)
    user_guidance_queue: Sequence[Any] = field(default_factory=tuple)


@dataclass(frozen=True)
class ExecutionModeDecision:
    executionMode: ExecutionMode
    complexityScore: float
    uncertaintyScore: float
    reproducibilityLevel: ReproducibilityLevel
    stagePlanHint: list[str]
    reason: str
    riskFlags: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)


def classify_execution_mode(request: ExecutionClassifierInput | Mapping[str, Any] | Any) -> dict[str, Any]:
    """Classify a prompt into an execution mode decision.

    The function accepts a dataclass, a mapping with camelCase or snake_case
    keys, or a light object with matching attributes.
    """

    req = _coerce_input(request)
    text = req.prompt.strip().lower()
    action_items = _selected_action_items(req)

    signals = _collect_signals(req, action_items, text)
    complexity = _complexity_score(req, action_items, signals)
    uncertainty = _uncertainty_score(req, action_items, signals)
    mode = _select_mode(req, signals, complexity, uncertainty)
    reproducibility = _reproducibility_level(mode)
    stage_plan = _stage_plan_hint(mode, signals)
    risk_flags = _risk_flags(req, action_items, signals, complexity, uncertainty)
    reason = _reason(mode, signals, complexity, uncertainty, risk_flags)

    return asdict(
        ExecutionModeDecision(
            executionMode=mode,
            complexityScore=complexity,
            uncertaintyScore=uncertainty,
            reproducibilityLevel=reproducibility,
            stagePlanHint=stage_plan,
            reason=reason,
            riskFlags=risk_flags,
            signals=signals,
        )
    )


def _collect_signals(req: ExecutionClassifierInput, action_items: Sequence[Any], text: str) -> list[str]:
    signals: list[str] = []
    _add_if(signals, "repair", bool(req.recent_failures) or _has_failed_attempt(req.prior_attempts) or REPAIR_HINTS.search(text))
    _add_if(signals, "continuation", CONTINUE_HINTS.search(text) or _has_active_project_artifact(req.artifacts))
    _add_if(signals, "mid-run-guidance", bool(req.user_guidance_queue) or (GUIDANCE_HINTS.search(text) and (CONTINUE_HINTS.search(text) or req.artifacts)))
    _add_if(signals, "light-lookup", LIGHT_LOOKUP_HINTS.search(text))
    _add_if(signals, "research", RESEARCH_HINTS.search(text))
    _add_if(signals, "systematic-research", SYSTEMATIC_RESEARCH_HINTS.search(text))
    _add_if(signals, "full-text", FULL_TEXT_HINTS.search(text))
    _add_if(signals, "code-change", CODE_HINTS.search(text))
    _add_if(signals, "file-work", FILE_HINTS.search(text))
    _add_if(signals, "artifact-output", bool(req.expected_artifact_types) or ARTIFACT_HINTS.search(text))
    _add_if(signals, "multi-step", MULTI_STEP_HINTS.search(text))
    _add_if(signals, "long-or-uncertain", LONG_OR_UNCERTAIN_HINTS.search(text))
    _add_if(signals, "direct-question", DIRECT_QUESTION_HINTS.search(text))
    _add_if(signals, "has-refs", bool(req.refs))
    _add_if(signals, "has-artifacts", bool(req.artifacts))
    _add_if(signals, "selected-action", bool(action_items))
    _add_if(signals, "external-action", _has_external_action(action_items))
    _add_if(signals, "multi-provider", _external_action_count(action_items) > 1)
    _add_if(signals, "verifier", bool(req.selected_verifiers))
    _add_if(signals, "sense", bool(req.selected_senses))
    _add_if(signals, "multi-artifact", len(req.expected_artifact_types) > 1)
    return signals


def _complexity_score(req: ExecutionClassifierInput, action_items: Sequence[Any], signals: list[str]) -> float:
    score = 0.06
    weights = {
        "repair": 0.34,
        "continuation": 0.28,
        "mid-run-guidance": 0.18,
        "light-lookup": 0.12,
        "research": 0.18,
        "systematic-research": 0.24,
        "full-text": 0.24,
        "code-change": 0.24,
        "file-work": 0.16,
        "artifact-output": 0.16,
        "multi-step": 0.22,
        "long-or-uncertain": 0.24,
        "has-refs": 0.04,
        "has-artifacts": 0.06,
        "selected-action": 0.06,
        "external-action": 0.08,
        "multi-provider": 0.18,
        "verifier": 0.08,
        "sense": 0.06,
        "multi-artifact": 0.16,
    }
    for signal, weight in weights.items():
        if signal in signals:
            score += weight
    score += min(0.10, max(0, len(req.refs) - 3) * 0.025)
    score += min(0.10, max(0, len(action_items) - 2) * 0.035)
    score += min(0.10, max(0, len(req.prior_attempts) - 1) * 0.035)
    if "direct-question" in signals and not _requires_execution(signals):
        score -= 0.08
    return _clamp_unit(score)


def _uncertainty_score(req: ExecutionClassifierInput, action_items: Sequence[Any], signals: list[str]) -> float:
    score = 0.08
    weights = {
        "repair": 0.16,
        "continuation": 0.16,
        "mid-run-guidance": 0.16,
        "light-lookup": 0.14,
        "research": 0.18,
        "systematic-research": 0.18,
        "full-text": 0.14,
        "multi-step": 0.14,
        "long-or-uncertain": 0.24,
        "external-action": 0.12,
        "multi-provider": 0.12,
        "code-change": 0.06,
        "verifier": -0.04,
    }
    for signal, weight in weights.items():
        if signal in signals:
            score += weight
    if req.recent_failures:
        score += min(0.18, 0.08 + len(req.recent_failures) * 0.04)
    if _has_failed_attempt(req.prior_attempts):
        score += 0.10
    if "file-work" in signals and not req.refs and not req.artifacts:
        score += 0.12
    if "direct-question" in signals and not _requires_execution(signals):
        score -= 0.06
    return _clamp_unit(score)


def _select_mode(
    req: ExecutionClassifierInput,
    signals: list[str],
    complexity: float,
    uncertainty: float,
) -> ExecutionMode:
    if "repair" in signals or "continuation" in signals or "mid-run-guidance" in signals:
        return "repair-or-continue-project"
    if _is_direct_context_answer(req, signals):
        return "direct-context-answer"
    if _is_thin_adapter(signals, complexity):
        return "thin-reproducible-adapter"
    if _is_multi_stage(signals, complexity, uncertainty):
        return "multi-stage-project"
    return "single-stage-task"


def _is_direct_context_answer(req: ExecutionClassifierInput, signals: list[str]) -> bool:
    if _requires_execution(signals):
        return False
    if req.expected_artifact_types or _selected_action_items(req) or req.recent_failures or req.user_guidance_queue:
        return False
    return "direct-question" in signals or bool(req.refs or req.artifacts)


def _is_thin_adapter(signals: list[str], complexity: float) -> bool:
    if "light-lookup" not in signals and not ("research" in signals and "external-action" in signals):
        return False
    heavy = {
        "systematic-research",
        "full-text",
        "code-change",
        "file-work",
        "artifact-output",
        "multi-step",
        "multi-artifact",
        "multi-provider",
        "long-or-uncertain",
    }
    return complexity < 0.58 and not any(signal in signals for signal in heavy)


def _is_multi_stage(signals: list[str], complexity: float, uncertainty: float) -> bool:
    if complexity >= 0.66 or uncertainty >= 0.72:
        return True
    if "full-text" in signals:
        return True
    if "multi-provider" in signals or "multi-artifact" in signals or "long-or-uncertain" in signals:
        return True
    if "systematic-research" in signals and ("research" in signals or "external-action" in signals):
        return True
    if "research" in signals and "multi-step" in signals:
        return True
    return False


def _requires_execution(signals: list[str]) -> bool:
    execution_signals = {
        "light-lookup",
        "research",
        "systematic-research",
        "full-text",
        "code-change",
        "file-work",
        "artifact-output",
        "multi-step",
        "long-or-uncertain",
        "external-action",
        "multi-provider",
        "verifier",
        "sense",
    }
    return any(signal in signals for signal in execution_signals)


def _reproducibility_level(mode: ExecutionMode) -> ReproducibilityLevel:
    if mode == "direct-context-answer":
        return "none"
    if mode == "thin-reproducible-adapter":
        return "light"
    if mode == "single-stage-task":
        return "full"
    return "staged"


def _stage_plan_hint(mode: ExecutionMode, signals: list[str]) -> list[str]:
    if mode == "direct-context-answer":
        return []
    if mode == "thin-reproducible-adapter":
        if "research" in signals:
            return ["search", "emit"]
        return ["search", "fetch", "emit"]
    if mode == "single-stage-task":
        if "code-change" in signals:
            return ["analyze", "modify", "validate", "emit"]
        if "file-work" in signals:
            return ["fetch", "analyze", "emit"]
        if "full-text" in signals:
            return ["fetch", "emit"]
        return ["analyze", "emit"]
    if mode == "repair-or-continue-project":
        stages = ["fetch", "analyze"]
        if "repair" in signals:
            stages.append("repair")
        if "mid-run-guidance" in signals:
            stages.append("plan")
        stages.extend(["validate", "emit"])
        return _dedupe(stages)
    stages = ["plan"]
    if "research" in signals or "light-lookup" in signals:
        stages.append("search")
    if "full-text" in signals or "file-work" in signals:
        stages.append("fetch")
    stages.extend(["analyze", "emit"])
    if "verifier" in signals or "multi-step" in signals or "systematic-research" in signals:
        stages.append("validate")
    return _dedupe(stages)


def _risk_flags(
    req: ExecutionClassifierInput,
    action_items: Sequence[Any],
    signals: list[str],
    complexity: float,
    uncertainty: float,
) -> list[str]:
    flags: list[str] = []
    _add_if(flags, "external-information-required", "external-action" in signals or "light-lookup" in signals)
    _add_if(flags, "multi-provider-coordination", "multi-provider" in signals)
    _add_if(flags, "full-text-or-large-fetch", "full-text" in signals)
    _add_if(flags, "code-or-workspace-side-effect", "code-change" in signals or _has_side_effect_action(action_items))
    _add_if(flags, "multi-artifact-output", "multi-artifact" in signals)
    _add_if(flags, "recent-failure", bool(req.recent_failures) or _has_failed_attempt(req.prior_attempts))
    _add_if(flags, "mid-run-guidance", "mid-run-guidance" in signals)
    _add_if(flags, "long-running-or-open-ended", "long-or-uncertain" in signals or complexity >= 0.75)
    _add_if(flags, "high-uncertainty", uncertainty >= 0.70)
    _add_if(flags, "needs-workspace-discovery", "file-work" in signals and not req.refs and not req.artifacts)
    return flags


def _reason(
    mode: ExecutionMode,
    signals: list[str],
    complexity: float,
    uncertainty: float,
    risk_flags: list[str],
) -> str:
    signal_text = ", ".join(signals[:6]) if signals else "no execution-specific signals"
    if len(signals) > 6:
        signal_text += ", ..."
    risk_text = f"; risks: {', '.join(risk_flags[:3])}" if risk_flags else ""
    return f"{mode}: {signal_text}; complexity={complexity:.2f}, uncertainty={uncertainty:.2f}{risk_text}."


def _coerce_input(request: ExecutionClassifierInput | Mapping[str, Any] | Any) -> ExecutionClassifierInput:
    if isinstance(request, ExecutionClassifierInput):
        return request
    data = request if isinstance(request, Mapping) else _object_mapping(request)
    return ExecutionClassifierInput(
        prompt=_text(_first(data, "prompt", "rawPrompt", "message", "text")),
        refs=_sequence(_first(data, "refs", "references", "currentRefs", "currentReferences")),
        artifacts=_mapping_sequence(_first(data, "artifacts", "currentArtifacts")),
        expected_artifact_types=[
            str(item)
            for item in _sequence(_first(data, "expectedArtifactTypes", "expected_artifact_types", "requiredArtifacts"))
        ],
        selected_capabilities=_sequence(
            _first(data, "selectedCapabilities", "selected_capabilities", "selected", "capabilities")
        ),
        selected_tools=_sequence(_first(data, "selectedTools", "selected_tools", "tools")),
        selected_senses=_sequence(_first(data, "selectedSenses", "selected_senses", "senses")),
        selected_verifiers=_sequence(_first(data, "selectedVerifiers", "selected_verifiers", "verifiers")),
        recent_failures=_sequence(_first(data, "recentFailures", "recent_failures", "failures")),
        prior_attempts=_sequence(_first(data, "priorAttempts", "prior_attempts", "attempts")),
        user_guidance_queue=_sequence(_first(data, "userGuidanceQueue", "user_guidance_queue", "guidanceQueue")),
    )


def _selected_action_items(req: ExecutionClassifierInput) -> list[Any]:
    return [
        *list(req.selected_capabilities),
        *list(req.selected_tools),
        *list(req.selected_senses),
        *list(req.selected_verifiers),
    ]


def _has_external_action(actions: Sequence[Any]) -> bool:
    for action in actions:
        text = _action_text(action)
        if re.search(r"\b(search|fetch|download|browser|web|http|api|database|remote|scholar|literature)\b|搜索|下载|抓取|文献", text, re.I):
            return True
    return False


def _external_action_count(actions: Sequence[Any]) -> int:
    return sum(1 for action in actions if _has_external_action([action]))


def _has_side_effect_action(actions: Sequence[Any]) -> bool:
    for action in actions:
        text = _action_text(action)
        if re.search(r"\b(write|edit|delete|shell|command|patch|modify|filesystem)\b|写入|修改|删除|命令", text, re.I):
            return True
    return False


def _has_failed_attempt(attempts: Sequence[Any]) -> bool:
    for attempt in attempts:
        if isinstance(attempt, Mapping):
            status = _text(attempt.get("status") or attempt.get("state")).lower()
            if status in {"failed", "failure", "error", "timed-out", "timeout"}:
                return True
            if attempt.get("failure") or attempt.get("failureReason") or attempt.get("error"):
                return True
        elif re.search(r"\b(failed|failure|error|timeout)\b|失败|报错|超时", str(attempt), re.I):
            return True
    return False


def _has_active_project_artifact(artifacts: Sequence[Mapping[str, Any]]) -> bool:
    for artifact in artifacts:
        status = _text(artifact.get("status")).lower()
        kind = _text(artifact.get("kind") or artifact.get("artifactType") or artifact.get("type")).lower()
        if status in {"running", "in-progress", "failed", "paused"}:
            return True
        if "project" in kind or "stage" in kind or "execution" in kind:
            return True
    return False


def _action_text(value: Any) -> str:
    if isinstance(value, str):
        return value.lower()
    if isinstance(value, Mapping):
        fields = [
            value.get("id"),
            value.get("title"),
            value.get("kind"),
            value.get("summary"),
            value.get("description"),
            value.get("adapter"),
            " ".join(str(item) for item in _sequence(value.get("keywords"))),
            " ".join(str(item) for item in _sequence(value.get("triggers"))),
            " ".join(str(item) for item in _sequence(value.get("sideEffects"))),
        ]
        return " ".join(_text(item) for item in fields).lower()
    return str(value or "").lower()


def _first(data: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def _object_mapping(value: Any) -> Mapping[str, Any]:
    if value is None:
        return {}
    return {key: getattr(value, key) for key in dir(value) if not key.startswith("_")}


def _sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes)):
        return [value.decode() if isinstance(value, bytes) else value]
    if isinstance(value, Sequence):
        return list(value)
    return []


def _mapping_sequence(value: Any) -> list[Mapping[str, Any]]:
    return [item for item in _sequence(value) if isinstance(item, Mapping)]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _add_if(items: list[str], item: str, condition: Any) -> None:
    if condition:
        items.append(item)


def _dedupe(items: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            result.append(item)
            seen.add(item)
    return result


def _clamp_unit(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 2)
