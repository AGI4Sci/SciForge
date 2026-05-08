"""Summarize raw backend/tool/workspace events into user-readable progress.

The module intentionally keeps a small JSON-in/JSON-out surface so the
TypeScript runtime can consume it before the rest of the conversation policy
package exists.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import re
import sys
import types
from typing import Any, Iterable, Literal, Mapping, Sequence

ProgressPhase = Literal["read", "write", "execute", "wait", "plan", "complete", "error", "observe"]

if __name__ not in sys.modules:
    sys.modules[__name__] = types.ModuleType(__name__)
    sys.modules[__name__].__dict__.update(globals())

_PATH_RE = re.compile(
    r"(?P<path>(?:/|\.?/)?(?:[\w.@-]+/)+[\w.@-]+\.(?:py|ts|tsx|js|json|md|csv|tsv|txt|log|pdf|r|R|sh|yaml|yml))"
)


@dataclass(frozen=True)
class ProgressStep:
    id: str
    phase: ProgressPhase
    title: str
    detail: str
    reading: list[str] = field(default_factory=list)
    writing: list[str] = field(default_factory=list)
    waiting_for: str | None = None
    next_step: str | None = None
    source_event_type: str | None = None
    status: str = "running"

    def to_event(self) -> dict[str, Any]:
        payload = asdict(self)
        progress = {
            "phase": self.phase,
            "title": self.title,
            "detail": self.detail,
            "reading": self.reading,
            "writing": self.writing,
            "waitingFor": self.waiting_for,
            "nextStep": self.next_step,
            "status": self.status,
        }
        return {
            "type": "process-progress",
            "label": _label_for_phase(self.phase),
            "status": self.status,
            "message": self.title,
            "detail": self.detail,
            "progress": {key: value for key, value in progress.items() if value not in (None, [], "")},
            "raw": payload,
        }


def process_events(raw_events: Sequence[Mapping[str, Any]] | Mapping[str, Any]) -> dict[str, Any]:
    """Return a compact progress timeline for raw stream events.

    Input can be a plain list of events or ``{"events": [...]}``. The output is
    stable JSON containing ``timeline`` plus ``events`` entries that can be sent
    directly through SciForge's existing stream event normalizer.
    """

    events = _event_list(raw_events)
    steps: list[ProgressStep] = []
    seen: set[tuple[str, str, str]] = set()
    for index, raw in enumerate(events):
        step = summarize_event(raw, index=index)
        if not step:
            continue
        key = (step.phase, step.title, step.detail)
        if key in seen:
            continue
        seen.add(key)
        steps.append(step)

    current = _current_progress(steps)
    return {
        "schemaVersion": "sciforge.process-events.v1",
        "current": current.to_event()["progress"] if current else None,
        "summary": _summary_for_steps(steps, current),
        "timeline": [asdict(step) for step in steps],
        "events": [step.to_event() for step in steps],
    }


def summarize_event(raw: Mapping[str, Any], index: int = 0) -> ProgressStep | None:
    event_type = _text(raw.get("type")) or _text(raw.get("kind")) or "event"
    status = _text(raw.get("status")) or "running"
    tool_name = _text(raw.get("toolName")) or _text(raw.get("tool_name")) or ""
    detail = _first_text(raw, "detail", "message", "text", "output", "error") or _safe_json(raw)
    haystack = "\n".join(part for part in [event_type, status, tool_name, detail] if part)
    paths = _paths_from(raw, detail)
    lower = haystack.lower()

    if _looks_failed(lower):
        return _step(index, "error", "遇到阻断", _trim(detail or "后端返回失败事件。"), source_event_type=event_type, status="failed")

    if _looks_plan(lower) and event_type in {"stage-start", "current-plan", "plan"}:
        return _step(
            index,
            "plan",
            "正在规划下一步",
            _trim(detail or "正在整理计划。"),
            next_step=_trim(detail, 180) if detail else "生成可执行计划。",
            source_event_type=event_type,
            status=status,
        )

    if _looks_write(lower, tool_name):
        target = _pick_path(paths, raw, ("path", "outputRef", "output_ref", "artifactRef", "artifact_ref"))
        title = f"正在写入 {target}" if target else "正在写入工作文件"
        return _step(
            index,
            "write",
            title,
            _trim(detail or title),
            writing=[target] if target else paths[:3],
            next_step="写入完成后执行或校验生成内容。",
            source_event_type=event_type,
            status=status,
        )

    if _looks_read(lower, tool_name):
        target = _pick_path(paths, raw, ("path", "inputRef", "input_ref", "stdoutRef", "stderrRef", "outputRef"))
        title = f"正在读取 {target}" if target else "正在读取上下文或文件"
        return _step(
            index,
            "read",
            title,
            _trim(detail or title),
            reading=[target] if target else paths[:3],
            next_step="读取完成后归纳证据并决定下一步。",
            source_event_type=event_type,
            status=status,
        )

    if _looks_wait(lower):
        waiting_for = _waiting_target(detail, lower)
        return _step(
            index,
            "wait",
            f"正在等待 {waiting_for}",
            _trim(detail or f"等待 {waiting_for} 返回。"),
            waiting_for=waiting_for,
            next_step="收到新事件后继续执行，若超时会给出恢复建议。",
            source_event_type=event_type,
            status=status,
        )

    if _looks_execute(lower, tool_name):
        command = _trim(_first_text(raw, "command", "cmd") or detail or tool_name or "workspace task", 180)
        return _step(
            index,
            "execute",
            f"正在执行 {command}",
            _trim(detail or command),
            reading=paths[:2],
            next_step="执行完成后读取 stdout/stderr 和产物。",
            source_event_type=event_type,
            status=status,
        )

    if _looks_complete(lower):
        return _step(index, "complete", "阶段完成", _trim(detail or "当前阶段已完成。"), source_event_type=event_type, status="completed")

    if _looks_plan(lower):
        return _step(
            index,
            "plan",
            "正在规划下一步",
            _trim(detail or "正在整理计划。"),
            next_step=_trim(detail, 180) if detail else "生成可执行计划。",
            source_event_type=event_type,
            status=status,
        )

    if detail and len(detail) <= 360:
        return _step(index, "observe", "正在观察后端状态", _trim(detail), source_event_type=event_type, status=status)
    return None


def _event_list(raw_events: Sequence[Mapping[str, Any]] | Mapping[str, Any]) -> list[Mapping[str, Any]]:
    if isinstance(raw_events, Mapping):
        candidate = raw_events.get("events")
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, Mapping)]
        return [raw_events]
    return [item for item in raw_events if isinstance(item, Mapping)]


def _step(
    index: int,
    phase: ProgressPhase,
    title: str,
    detail: str,
    *,
    reading: Iterable[str] = (),
    writing: Iterable[str] = (),
    waiting_for: str | None = None,
    next_step: str | None = None,
    source_event_type: str | None = None,
    status: str = "running",
) -> ProgressStep:
    return ProgressStep(
        id=f"process-{index:04d}-{phase}",
        phase=phase,
        title=_trim(title, 160),
        detail=_trim(detail),
        reading=_unique(reading),
        writing=_unique(writing),
        waiting_for=waiting_for,
        next_step=next_step,
        source_event_type=source_event_type,
        status=_status(status, phase),
    )


def _current_progress(steps: Sequence[ProgressStep]) -> ProgressStep | None:
    for step in reversed(steps):
        if step.phase != "error" and step.status != "completed":
            return step
    return steps[-1] if steps else None


def _summary_for_steps(steps: Sequence[ProgressStep], current: ProgressStep | None) -> str:
    if not current:
        return "还没有收到可归纳的过程事件。"
    parts = [current.title]
    if current.reading:
        parts.append(f"读：{', '.join(current.reading[:2])}")
    if current.writing:
        parts.append(f"写：{', '.join(current.writing[:2])}")
    if current.waiting_for:
        parts.append(f"等待：{current.waiting_for}")
    if current.next_step:
        parts.append(f"下一步：{current.next_step}")
    return "；".join(parts)


def _paths_from(raw: Mapping[str, Any], detail: str) -> list[str]:
    values: list[str] = []
    for key in ("path", "inputRef", "input_ref", "outputRef", "output_ref", "stdoutRef", "stderrRef", "artifactRef", "artifact_ref"):
        value = _text(raw.get(key))
        if value:
            values.append(value)
    for match in _PATH_RE.finditer(detail):
        values.append(match.group("path"))
    nested = raw.get("raw")
    if isinstance(nested, Mapping):
        values.extend(_paths_from(nested, _safe_json(nested)))
    return _unique(values)


def _pick_path(paths: Sequence[str], raw: Mapping[str, Any], keys: Sequence[str]) -> str | None:
    for key in keys:
        value = _text(raw.get(key))
        if value:
            return value
    return paths[0] if paths else None


def _first_text(raw: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = _text(raw.get(key))
        if value:
            return value
    return None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _safe_json(value: Mapping[str, Any]) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return str(value)


def _trim(value: str, limit: int = 900) -> str:
    normalized = re.sub(r"[ \t]+", " ", value.replace("\\n", "\n")).strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized if len(normalized) <= limit else f"{normalized[: limit - 32].rstrip()} ... {normalized[-24:]}"


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        clean = value.strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def _status(value: str, phase: ProgressPhase) -> str:
    lowered = value.lower()
    if phase == "error" or "fail" in lowered or "error" in lowered:
        return "failed"
    if phase == "complete" or lowered in {"done", "completed", "success", "succeeded"}:
        return "completed"
    return "running"


def _label_for_phase(phase: ProgressPhase) -> str:
    return {
        "read": "读取",
        "write": "写入",
        "execute": "执行",
        "wait": "等待",
        "plan": "下一步",
        "complete": "完成",
        "error": "阻断",
        "observe": "状态",
    }[phase]


def _looks_failed(lower: str) -> bool:
    return bool(re.search(r"\b(error|failed|exception|traceback|timeout|interrupt)\b|失败|报错|中断", lower))


def _looks_write(lower: str, tool_name: str) -> bool:
    return "write_file" in tool_name.lower() or bool(re.search(r"write_file|wrote \d+ bytes|writing|write|保存|写入|生成.*(?:文件|脚本|artifact)", lower))


def _looks_read(lower: str, tool_name: str) -> bool:
    return "read_file" in tool_name.lower() or bool(re.search(r"read_file|reading|read |cat |sed |rg |grep |open|读取|正在读", lower))


def _looks_wait(lower: str) -> bool:
    return bool(re.search(r"silent|waiting|wait |rate.?limit|retry|poll|pending|等待|排队|配额", lower))


def _looks_execute(lower: str, tool_name: str) -> bool:
    return "run_command" in tool_name.lower() or bool(re.search(r"run_command|execute|executing|python3?|pytest|npm |tsx|bash|workspace task|执行|运行", lower))


def _looks_complete(lower: str) -> bool:
    return bool(re.search(r"\b(done|completed|success|succeeded)\b|完成|成功", lower))


def _looks_plan(lower: str) -> bool:
    return bool(re.search(r"plan|next step|stage-start|current-plan|规划|计划|下一步", lower))


def _waiting_target(detail: str, lower: str) -> str:
    if "rate" in lower or "配额" in lower:
        return "provider 配额或 retry budget"
    if "agentserver" in lower:
        return "AgentServer 返回"
    if "workspace" in lower:
        return "workspace task 返回"
    match = re.search(r"waiting(?: for)? ([^.;。]+)", detail, flags=re.IGNORECASE)
    return _trim(match.group(1), 80) if match else "后端返回新事件"
