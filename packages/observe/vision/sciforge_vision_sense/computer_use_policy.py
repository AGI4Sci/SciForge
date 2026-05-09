"""Generic Computer Use policy helpers for vision-sense consumers.

The long-task pool owns scenarios and reports. This module owns reusable policy
decisions that should behave the same for any Computer Use caller.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import Any, Mapping


PLANNER_ONLY_EVIDENCE_PATTERN = re.compile(
    r"trace refs?|trace paths?|image memory|artifact|action ledger|failure diagnostics|"
    r"sha256|displayId|尺寸|文件引用|截图引用|复盘|总结|汇总|回答|报告|handoff|refs?|summary|report",
    re.IGNORECASE,
)

GUI_ACTION_INTENT_PATTERN = re.compile(
    r"执行一次|点击|click|scroll|滚动|press_key|hotkey|type_text|输入|drag|拖拽|打开|open_app|"
    r"切换窗口|切换.*窗口|移动到|恢复|回到|启动|创建|保存|重命名|移动|定位|文件管理器|"
    r"文字处理|演示应用|幻灯片|文档|Alt\+Tab|Command\+Tab",
    re.IGNORECASE,
)

HIGH_RISK_GUI_PATTERN = re.compile(
    r"delete|send|pay|authorize|publish|submit|删除|发送|支付|授权|发布|提交|登录授权|外部表单",
    re.IGNORECASE,
)

NEGATED_HIGH_RISK_BOUNDARY_PATTERN = re.compile(
    r"do not\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|"
    r"don't\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|"
    r"without\s+(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|"
    r"不要[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|"
    r"不能[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|"
    r"不(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)",
    re.IGNORECASE,
)

SETTINGS_FORM_INTENT_PATTERN = re.compile(
    r"settings|preferences|preference|form|controls?|field|input|search|dropdown|menu|checkbox|toggle|button|"
    r"设置|偏好|表单|控件|字段|输入框|搜索框|下拉|菜单|复选|开关|按钮",
    re.IGNORECASE,
)

LOW_RISK_BOUNDARY_PATTERN = re.compile(
    r"low[- ]?risk|cancel|close|do not submit|do not save|不要提交|不要保存|低风险|取消|关闭",
    re.IGNORECASE,
)

FILE_MANAGER_INTENT_PATTERN = re.compile(
    r"file manager|finder|file explorer|files?|folders?|directory|rename|move|locate|"
    r"文件管理器|访达|文件|文件夹|目录|重命名|移动|定位",
    re.IGNORECASE,
)

DESTRUCTIVE_FILE_PATTERN = re.compile(r"delete|trash|remove|erase|删除|废纸篓|移除|清空", re.IGNORECASE)

CREATION_INTENT_PATTERN = re.compile(
    r"create|write|draft|compose|make|insert|add|document|slide|presentation|text box|shape|"
    r"创建|撰写|编写|制作|插入|添加|文档|幻灯片|演示|文本框|图形|三栏|结构",
    re.IGNORECASE,
)

VISIBLE_ARTIFACT_INTENT_PATTERN = re.compile(
    r"document|slide|presentation|page|text box|shape|title|body|文档|幻灯片|演示|页面|文本框|图形|标题|正文|结构",
    re.IGNORECASE,
)

VALIDATION_RECOVERY_INTENT_PATTERN = re.compile(
    r"validation|invalid|no[- ]?result|empty result|error state|clear|correct|校验|无效|无结果|空结果|错误状态|清除|修正",
    re.IGNORECASE,
)

VALIDATION_LOW_RISK_BOUNDARY_PATTERN = re.compile(
    r"low[- ]?risk|do not submit|do not save|do not authorize|不要提交|不要保存|不要授权|低风险",
    re.IGNORECASE,
)

EXPECTED_FAILURE_INTENT_PATTERN = re.compile(
    r"expected failure|failed-with-reason|non.?existent|unavailable|missing refs?|预期失败|不存在|不可用|失败",
    re.IGNORECASE,
)

WINDOW_RECOVERY_INTENT_PATTERN = re.compile(
    r"window|display|monitor|screen|occlusion|restore|recover|migration|move.*window|窗口|显示器|屏幕|遮挡|恢复|迁移|移动目标窗口",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class MatrixExecutionPlan:
    mode: str
    maxConcurrency: int
    realGuiSerialized: bool
    reason: str


def is_planner_only_evidence_task(text: str) -> bool:
    """Return true when a task can be answered from trace/file refs only."""

    value = text or ""
    primary = _primary_task_text(value)
    if PLANNER_ONLY_EVIDENCE_PATTERN.search(primary) and not GUI_ACTION_INTENT_PATTERN.search(primary):
        return True
    if GUI_ACTION_INTENT_PATTERN.search(value):
        return False
    return bool(PLANNER_ONLY_EVIDENCE_PATTERN.search(value))


def _primary_task_text(text: str) -> str:
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return text or ""


def _compact_route_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


def _action_route_target(action: Mapping[str, Any]) -> str:
    values = [
        action.get("targetDescription"),
        action.get("targetRegionDescription"),
        action.get("fromTargetDescription") if action.get("type") == "drag" else None,
        action.get("toTargetDescription") if action.get("type") == "drag" else None,
    ]
    return _compact_route_text(" ".join(str(value) for value in values if value))


def _step_action(step: Mapping[str, Any]) -> Mapping[str, Any] | None:
    action = step.get("plannedAction")
    return action if isinstance(action, Mapping) else None


def _done_gui_steps(steps: list[Mapping[str, Any]], *, require_effect: bool = False) -> list[Mapping[str, Any]]:
    return [
        step
        for step in steps
        if step.get("kind") == "gui-execution"
        and step.get("status") == "done"
        and (not require_effect or not is_no_visible_effect_step(step))
    ]


def _effective_actions(steps: list[Mapping[str, Any]], *, require_effect: bool = False, include_wait: bool = False) -> list[Mapping[str, Any]]:
    actions: list[Mapping[str, Any]] = []
    for step in _done_gui_steps(steps, require_effect=require_effect):
        action = _step_action(step)
        if action and (include_wait or action.get("type") != "wait"):
            actions.append(action)
    return actions


def is_no_visible_effect_step(step: Mapping[str, Any]) -> bool:
    verifier = step.get("verifier")
    pixel_diff = verifier.get("pixelDiff") if isinstance(verifier, Mapping) else None
    return isinstance(pixel_diff, Mapping) and pixel_diff.get("possiblyNoEffect") is True


def is_high_risk_gui_request(text: str) -> bool:
    return bool(HIGH_RISK_GUI_PATTERN.search(_primary_task_text(text)))


def has_negated_high_risk_boundary(text: str) -> bool:
    return bool(NEGATED_HIGH_RISK_BOUNDARY_PATTERN.search(text or ""))


def is_low_risk_settings_form_task(task: str) -> bool:
    primary = _primary_task_text(task)
    if is_high_risk_gui_request(primary) and not has_negated_high_risk_boundary(primary):
        return False
    return bool(SETTINGS_FORM_INTENT_PATTERN.search(primary) and LOW_RISK_BOUNDARY_PATTERN.search(primary))


def is_low_risk_file_manager_task(task: str) -> bool:
    primary = _primary_task_text(task)
    if is_high_risk_gui_request(primary) and not has_negated_high_risk_boundary(primary):
        return False
    destructive = DESTRUCTIVE_FILE_PATTERN.search(primary)
    return bool(FILE_MANAGER_INTENT_PATTERN.search(primary) and (not destructive or has_negated_high_risk_boundary(primary)))


def is_low_risk_creation_task(task: str) -> bool:
    primary = _primary_task_text(task)
    if is_high_risk_gui_request(primary) and not has_negated_high_risk_boundary(primary):
        return False
    return bool(CREATION_INTENT_PATTERN.search(primary) and VISIBLE_ARTIFACT_INTENT_PATTERN.search(primary))


def is_low_risk_validation_recovery_task(task: str) -> bool:
    primary = _primary_task_text(task)
    if is_high_risk_gui_request(primary) and not has_negated_high_risk_boundary(primary):
        return False
    return bool(VALIDATION_RECOVERY_INTENT_PATTERN.search(primary) and VALIDATION_LOW_RISK_BOUNDARY_PATTERN.search(primary))


def is_low_risk_expected_failure_task(task: str) -> bool:
    primary = _primary_task_text(task)
    if is_high_risk_gui_request(primary) and not has_negated_high_risk_boundary(primary):
        return False
    return bool(EXPECTED_FAILURE_INTENT_PATTERN.search(primary) and re.search(r"low[- ]?risk|低风险|failed-with-reason", primary, re.IGNORECASE))


def is_window_recovery_task(task: str) -> bool:
    primary = _primary_task_text(task)
    return not is_high_risk_gui_request(primary) and bool(WINDOW_RECOVERY_INTENT_PATTERN.search(primary))


def _step_observed_app_matches(step: Mapping[str, Any], pattern: re.Pattern[str]) -> bool:
    direct = step.get("windowTarget") if isinstance(step.get("windowTarget"), Mapping) else {}
    execution = step.get("execution") if isinstance(step.get("execution"), Mapping) else {}
    execution_target = execution.get("windowTarget") if isinstance(execution.get("windowTarget"), Mapping) else {}
    names = [
        direct.get("appName"),
        direct.get("bundleId"),
        execution_target.get("appName"),
        execution_target.get("bundleId"),
    ]
    return any(pattern.search(str(name)) for name in names if isinstance(name, str))


def _settings_form_completion_action_count(task: str) -> int:
    if re.search(r"至少\s*8\s*个|at least\s*8", task, re.IGNORECASE):
        return 12
    if re.search(r"(?:^|[^\d])3\s*个|three\s+(?:low-risk\s+)?controls?", task, re.IGNORECASE):
        return 3
    return 8


def should_complete_from_candidate_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not re.search(r"候选证据|candidate evidence|screening|筛选", task, re.IGNORECASE):
        return False
    targets = [
        _action_route_target(action)
        for action in _effective_actions(steps, require_effect=True)
        if action.get("type") in {"click", "double_click"}
    ]
    matching = [
        _compact_route_text(target)
        for target in targets
        if re.search(r"result|link|title|candidate|evidence|article|结果|链接|标题|候选|证据|文章", target, re.IGNORECASE)
    ]
    return len(set(matching)) >= 3


def should_complete_from_creation_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_low_risk_creation_task(task):
        return False
    effective_steps = _done_gui_steps(steps, require_effect=True)
    effective_actions = _effective_actions(steps, require_effect=True)
    typed_text = [
        str(action.get("text") or "").strip()
        for action in effective_actions
        if action.get("type") == "type_text" and len(str(action.get("text") or "").strip()) >= 4
    ]
    total_typed_chars = len("\n".join(typed_text))
    distinct_typed_chunks = len({_compact_route_text(text) for text in typed_text})
    structural_targets = [
        _compact_route_text(target)
        for target in (_action_route_target(action) for action in effective_actions)
        if re.search(
            r"placeholder|text box|textbox|shape|rectangle|canvas|slide|document|body|title|insert|"
            r"占位符|文本框|图形|矩形|画布|幻灯片|文档|正文|标题|插入",
            target,
            re.IGNORECASE,
        )
    ]
    has_structure_edit = any(action.get("type") == "drag" for action in effective_actions) or any(
        re.search(r"shape|rectangle|text box|textbox|canvas|图形|矩形|文本框|画布", target, re.IGNORECASE)
        for target in structural_targets
    )
    opened_editor = any(
        action.get("type") == "open_app"
        and re.search(r"powerpoint|word|presentation|document|演示|文档", str(action.get("appName") or ""), re.IGNORECASE)
        for action in effective_actions
    )
    observed_editor = any(_step_observed_app_matches(step, re.compile(r"powerpoint|word|presentation|document|演示|文档", re.IGNORECASE)) for step in effective_steps)
    has_app_or_canvas_setup = any(action.get("type") in {"open_app", "click", "double_click"} for action in effective_actions) or observed_editor or opened_editor
    if not has_app_or_canvas_setup:
        return False
    if typed_text:
        return len(effective_actions) >= 6 and total_typed_chars >= 8 and distinct_typed_chunks >= 1 and len(structural_targets) >= 2
    return len(effective_actions) >= 5 and len(structural_targets) >= 2 and has_structure_edit


def should_complete_from_file_manager_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_low_risk_file_manager_task(task):
        return False
    actions = _effective_actions(steps, require_effect=True)
    opened_file_manager = any(
        action.get("type") == "open_app"
        and re.search(r"finder|file explorer|文件管理器|访达", str(action.get("appName") or ""), re.IGNORECASE)
        for action in actions
    )
    file_list_interactions = [
        _action_route_target(action)
        for action in actions
        if re.search(r"file|folder|list|finder|explorer|directory|row|entry|文件|文件夹|列表|目录|访达", _action_route_target(action), re.IGNORECASE)
    ]
    navigation_actions = [action for action in actions if action.get("type") in {"scroll", "click", "double_click", "drag"}]
    return opened_file_manager and len(actions) >= 4 and len(navigation_actions) >= 2 and len(file_list_interactions) >= 2


def should_complete_from_settings_form_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_low_risk_settings_form_task(task):
        return False
    actions = _effective_actions(steps)
    required_count = _settings_form_completion_action_count(task)
    if len(actions) < required_count:
        return False
    targets = [_compact_route_text(_action_route_target(action)) for action in actions]
    targets = [target for target in targets if target]
    control_kinds: set[str] = set()
    for action in actions:
        target = _action_route_target(action)
        if re.search(r"text|input|field|search|textbox|prompt|placeholder|输入|文本|字段|搜索|输入框|文本框", target, re.IGNORECASE) or action.get("type") == "type_text":
            control_kinds.add("text")
        if re.search(r"menu|dropdown|select|popover|popup|picker|菜单|下拉|弹出|选择器", target, re.IGNORECASE):
            control_kinds.add("menu")
        if re.search(r"checkbox|check box|toggle|switch|radio|复选|勾选|开关|切换|单选", target, re.IGNORECASE):
            control_kinds.add("choice")
        if re.search(r"button|tab|toolbar|cancel|close|按钮|标签|工具栏|取消|关闭", target, re.IGNORECASE) or action.get("type") in {"click", "double_click"}:
            control_kinds.add("button")
        if action.get("type") == "scroll":
            control_kinds.add("scroll")
    has_text_interaction = any(action.get("type") == "type_text" for action in actions) or any(
        re.search(r"text|input|field|search|输入|文本|字段|搜索", target, re.IGNORECASE) for target in targets
    )
    requires_text_interaction = bool(re.search(r"text|input|field|search|文本|字段|搜索|输入框|搜索框", task, re.IGNORECASE))
    return (
        len(set(targets)) >= min(6, required_count)
        and len(control_kinds) >= (2 if required_count <= 3 else 3)
        and (not requires_text_interaction or has_text_interaction)
    )


def should_complete_from_validation_recovery_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_low_risk_validation_recovery_task(task):
        return False
    actions = _effective_actions(steps)
    if len(actions) < 4:
        return False
    targets = [_action_route_target(action) for action in actions]
    has_invalid_input = any(action.get("type") == "type_text" for action in actions) or any(
        re.search(r"invalid|nonexistent|no result|search|field|input|无效|不存在|无结果|搜索|字段|输入", target, re.IGNORECASE)
        for target in targets
    )
    has_recovery_action = False
    for action in actions:
        if action.get("type") == "press_key":
            has_recovery_action = bool(re.search(r"escape|esc|backspace|delete|enter", str(action.get("key") or ""), re.IGNORECASE))
        elif action.get("type") == "type_text":
            has_recovery_action = bool(re.search(r"clear|correct|reset|valid|empty|清除|修正|恢复|有效|空", _action_route_target(action), re.IGNORECASE))
        else:
            has_recovery_action = bool(re.search(r"clear|correct|reset|cancel|close|dismiss|清除|修正|恢复|取消|关闭", _action_route_target(action), re.IGNORECASE))
        if has_recovery_action:
            break
    has_observation_action = any(action.get("type") in {"scroll", "click", "double_click"} for action in actions)
    return has_invalid_input and has_observation_action and (has_recovery_action or len(actions) >= 6)


def should_complete_from_expected_failure_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_low_risk_expected_failure_task(task):
        return False
    actions = _effective_actions(steps, include_wait=True)
    typed_failure_request = any(
        action.get("type") == "type_text"
        and re.search(r"non.?existent|unavailable|missing|refs?|failed|不存在|不可用|失败", str(action.get("text") or ""), re.IGNORECASE)
        for action in actions
    )
    submitted_request = any(
        action.get("type") == "press_key" and re.search(r"enter|return", str(action.get("key") or ""), re.IGNORECASE)
        for action in actions
    ) or any(
        action.get("type") in {"click", "double_click"}
        and re.search(r"send|submit|run|发送|提交|运行", _action_route_target(action), re.IGNORECASE)
        for action in actions
    )
    return typed_failure_request and submitted_request


def should_complete_from_window_recovery_action_ledger(task: str, steps: list[Mapping[str, Any]]) -> bool:
    if not is_window_recovery_task(task):
        return False
    effective_steps = _done_gui_steps(steps, require_effect=True)
    actions = _effective_actions(steps, require_effect=True)
    migration_drags = []
    for step in effective_steps:
        action = _step_action(step)
        grounding = step.get("grounding") if isinstance(step.get("grounding"), Mapping) else {}
        if (
            action
            and action.get("type") == "drag"
            and (
                grounding.get("provider") == "window-cross-display-drag"
                or re.search(r"display|monitor|screen|显示器|屏幕", _action_route_target(action), re.IGNORECASE)
            )
        ):
            migration_drags.append(step)
    recovery_actions = [action for action in actions if action.get("type") in {"hotkey", "open_app", "drag", "click"}]
    return len(migration_drags) >= 1 or len(recovery_actions) >= 2


ACTION_LEDGER_COMPLETION_REASONS = {
    "candidate-evidence-screening": "action-ledger completion policy satisfied for multi-candidate evidence screening",
    "visible-artifact-creation": "action-ledger completion policy satisfied for a low-risk document/slide creation task",
    "file-manager": "action-ledger completion policy satisfied for a low-risk file-manager workflow",
    "settings-form": "action-ledger completion policy satisfied for a low-risk settings/form control workflow",
    "validation-recovery": "action-ledger completion policy satisfied for a low-risk validation/no-result recovery workflow",
    "expected-failure": "action-ledger completion policy satisfied for a low-risk expected-failure chat/run workflow",
    "window-recovery": "action-ledger completion policy satisfied for a window recovery or migration workflow",
}


def action_ledger_completion(task: str, steps: list[Mapping[str, Any]]) -> dict[str, Any]:
    checks = [
        ("candidate-evidence-screening", should_complete_from_candidate_action_ledger),
        ("visible-artifact-creation", should_complete_from_creation_action_ledger),
        ("file-manager", should_complete_from_file_manager_action_ledger),
        ("settings-form", should_complete_from_settings_form_action_ledger),
        ("validation-recovery", should_complete_from_validation_recovery_action_ledger),
        ("expected-failure", should_complete_from_expected_failure_action_ledger),
        ("window-recovery", should_complete_from_window_recovery_action_ledger),
    ]
    for kind, check in checks:
        if check(task, steps):
            return {"complete": True, "kind": kind, "reason": ACTION_LEDGER_COMPLETION_REASONS[kind]}
    return {"complete": False}


def visible_artifact_completion_gap(task: str, steps: list[Mapping[str, Any]]) -> str:
    if not is_low_risk_creation_task(task) or should_complete_from_creation_action_ledger(task, steps):
        return ""
    actions = _effective_actions(steps, require_effect=True)
    action_summary = ", ".join(str(action.get("type") or "unknown") for action in actions) or "none"
    return " ".join(
        [
            "Visible artifact task did not satisfy completion acceptance.",
            "Opening an editor, switching windows, or producing only generic navigation actions is not enough for create/write/slide/document requests.",
            "The trace must show visible content entry or structure-edit actions that match the requested artifact before the runtime can report done.",
            f"Observed effective actions: {action_summary}.",
        ]
    )


def should_tolerate_dense_ui_no_effect_action(task: str, steps: list[Mapping[str, Any]], action: Mapping[str, Any]) -> bool:
    if not is_low_risk_settings_form_task(task) and not is_low_risk_file_manager_task(task):
        return False
    if action.get("type") not in {"click", "double_click", "type_text", "press_key", "scroll"}:
        return False
    current_route = _compact_route_text(_action_route_target(action))
    if not current_route:
        return False
    prior_steps = [
        step
        for step in steps[:-1]
        if step.get("kind") == "gui-execution" and step.get("status") == "done" and is_no_visible_effect_step(step)
    ][-5:]
    prior_actions = [action for action in (_step_action(step) for step in prior_steps) if action]
    return not any(
        prior.get("type") == action.get("type") and _compact_route_text(_action_route_target(prior)) == current_route
        for prior in prior_actions
    )


def _target_route_overlap(next_action: Mapping[str, Any], prior_action: Mapping[str, Any]) -> bool:
    next_target = _action_route_target(next_action)
    prior_target = _action_route_target(prior_action)
    if not next_target or not prior_target:
        return True
    if next_target == prior_target:
        return True
    next_tokens = _route_tokens(next_target)
    prior_tokens = _route_tokens(prior_target)
    if not next_tokens or not prior_tokens:
        return False
    shared = len([token for token in next_tokens if token in prior_tokens])
    return shared / max(len(next_tokens), len(prior_tokens)) >= 0.5


def _route_tokens(value: str) -> list[str]:
    stop_words = {"the", "and", "for", "with", "main", "content", "area", "visible", "target", "window"}
    return [
        token.strip()
        for token in re.split(r"[^a-z0-9\u4e00-\u9fff]+", value, flags=re.IGNORECASE)
        if len(token.strip()) >= 2 and token.strip() not in stop_words
    ]


def _text_entry_after_no_effect_field_click(steps: list[Mapping[str, Any]], task: str) -> dict[str, Any] | None:
    if not is_low_risk_settings_form_task(task):
        return None
    recent_actions = [
        action
        for action in (_step_action(step) for step in _done_gui_steps(steps)[-4:])
        if action
    ]
    if any(action.get("type") == "type_text" for action in recent_actions):
        return None
    last_step = _done_gui_steps(steps)[-1] if _done_gui_steps(steps) else None
    last_action = _step_action(last_step) if last_step else None
    if not last_step or not last_action or last_action.get("type") not in {"click", "double_click"}:
        return None
    if not is_no_visible_effect_step(last_step):
        return None
    target = _action_route_target(last_action)
    if not re.search(r"search|text|input|field|box|搜索|文本|输入|字段|表单", target, re.IGNORECASE):
        return None
    return {
        "type": "type_text",
        "text": "sciforge-test",
        "targetDescription": target,
        "riskLevel": "low",
        "requiresConfirmation": False,
    }


def _app_name_from_switch_target(target: str, desktop_platform: str) -> str | None:
    if re.search(r"finder|file manager|文件管理器|访达", target, re.IGNORECASE):
        return "Finder" if "darwin" in (desktop_platform or "").lower() else "File Explorer"
    if re.search(r"file explorer", target, re.IGNORECASE):
        return "File Explorer"
    if re.search(r"powerpoint|presentation|演示", target, re.IGNORECASE):
        return "Microsoft PowerPoint"
    if re.search(r"\bword\b|文字处理|文档", target, re.IGNORECASE):
        return "Microsoft Word"
    return None


def _rewrite_app_switch_action(action: Mapping[str, Any], desktop_platform: str, steps: list[Mapping[str, Any]]) -> dict[str, Any]:
    if action.get("type") != "hotkey":
        return dict(action)
    keys = [str(key).strip().lower() for key in action.get("keys") or []]
    is_app_switcher = "tab" in keys and any(key in {"command", "cmd", "meta", "alt"} for key in keys)
    if not is_app_switcher:
        return dict(action)
    target = _action_route_target(action)
    recent_switches = 0
    for step in _done_gui_steps(steps)[-4:]:
        prior = _step_action(step)
        prior_keys = [str(key).strip().lower() for key in (prior.get("keys") if prior else []) or []]
        if prior and prior.get("type") == "hotkey" and "tab" in prior_keys and any(key in {"command", "cmd", "meta", "alt"} for key in prior_keys):
            recent_switches += 1
    app_name = _app_name_from_switch_target(target, desktop_platform)
    if not app_name:
        return dict(action)
    if recent_switches >= 1 or re.search(r"finder|file manager|file explorer|文件管理器|访达", target, re.IGNORECASE):
        rewritten = {
            "type": "open_app",
            "appName": app_name,
            "targetDescription": action.get("targetDescription"),
            "targetRegionDescription": action.get("targetRegionDescription"),
            "riskLevel": action.get("riskLevel"),
            "requiresConfirmation": action.get("requiresConfirmation"),
            "confirmationText": action.get("confirmationText"),
        }
        return {key: value for key, value in rewritten.items() if value is not None}
    return dict(action)


def _should_rewrite_repeated_chat_text_to_submit(action: Mapping[str, Any], steps: list[Mapping[str, Any]], task: str) -> bool:
    if action.get("type") != "type_text":
        return False
    if not re.search(r"chat|message|input|send|trigger|failed-with-reason|expected failure|预期失败|触发|发送|输入框|任务", task, re.IGNORECASE):
        return False
    target = _action_route_target(action)
    if not re.search(r"chat|message|input|prompt|输入框|聊天|消息", target, re.IGNORECASE):
        return False
    recent_text_entries = [
        prior
        for prior in (_step_action(step) for step in _done_gui_steps(steps)[-3:])
        if prior and prior.get("type") == "type_text" and _target_route_overlap(action, prior)
    ]
    return len(recent_text_entries) >= 1


def rewrite_planner_action(
    action: Mapping[str, Any],
    *,
    desktop_platform: str,
    steps: list[Mapping[str, Any]],
    task: str,
) -> dict[str, Any]:
    rewritten = _rewrite_app_switch_action(action, desktop_platform, steps)
    field_text = _text_entry_after_no_effect_field_click(steps, task)
    if field_text and rewritten.get("type") != "type_text":
        return field_text
    if _should_rewrite_repeated_chat_text_to_submit(rewritten, steps, task):
        return {
            "type": "press_key",
            "key": "Enter",
            "targetDescription": rewritten.get("targetDescription"),
            "targetRegionDescription": rewritten.get("targetRegionDescription"),
            "riskLevel": "low",
            "requiresConfirmation": False,
        }
    return rewritten


def build_matrix_execution_plan(
    *,
    dry_run: bool,
    scenario_count: int,
    requested_max_concurrency: int | None = None,
) -> MatrixExecutionPlan:
    """Choose a generic execution plan without scenario-specific knowledge."""

    if not dry_run:
        return MatrixExecutionPlan(
            mode="serialized-real-gui",
            maxConcurrency=1,
            realGuiSerialized=True,
            reason="Real GUI execution may share displays and input devices, so scenarios run one at a time behind window locks.",
        )
    count = max(1, scenario_count or 1)
    requested = requested_max_concurrency if requested_max_concurrency is not None else min(4, count)
    max_concurrency = max(1, min(count, requested))
    return MatrixExecutionPlan(
        mode="parallel-analysis",
        maxConcurrency=max_concurrency,
        realGuiSerialized=True,
        reason="Dry-run scenarios produce file-ref evidence without touching real GUI input, so planner/grounder/verifier analysis can run concurrently.",
    )


def build_default_window_target(
    *,
    scenario_id: str,
    run_id: str,
    round_number: int,
    dry_run: bool,
    app_name: str | None = None,
    title: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Build the reusable target-window contract for real or dry-run execution."""

    if not dry_run:
        return {
            "enabled": True,
            "required": True,
            "mode": mode or ("app-window" if app_name or title else "active-window"),
            "appName": app_name,
            "title": title,
            "coordinateSpace": "window",
            "inputIsolation": "require-focused-target",
        }
    return {
        "enabled": True,
        "required": True,
        "mode": "window-id",
        "windowId": 84000 + int(round_number),
        "appName": "SciForge T084 Harness",
        "title": f"{scenario_id} {run_id} round {round_number}",
        "bounds": {"x": 0, "y": 0, "width": 1280, "height": 800},
        "coordinateSpace": "window",
        "inputIsolation": "require-focused-target",
    }


def build_policy_result_from_request(request: Mapping[str, Any]) -> Any:
    mode = str(request.get("mode") or "")
    if mode == "planner-only-evidence-task":
        return {"plannerOnly": is_planner_only_evidence_task(str(request.get("text") or ""))}
    if mode == "rewrite-planner-action":
        return {
            "action": rewrite_planner_action(
                request.get("action") if isinstance(request.get("action"), Mapping) else {},
                desktop_platform=str(request.get("desktopPlatform") or ""),
                steps=[step for step in request.get("steps", []) if isinstance(step, Mapping)],
                task=str(request.get("task") or ""),
            )
        }
    if mode == "action-ledger-completion":
        return action_ledger_completion(
            str(request.get("task") or ""),
            [step for step in request.get("steps", []) if isinstance(step, Mapping)],
        )
    if mode == "visible-output-completion-gap":
        return {
            "gap": visible_artifact_completion_gap(
                str(request.get("task") or ""),
                [step for step in request.get("steps", []) if isinstance(step, Mapping)],
            )
        }
    if mode == "dense-ui-no-effect-tolerance":
        return {
            "tolerate": should_tolerate_dense_ui_no_effect_action(
                str(request.get("task") or ""),
                [step for step in request.get("steps", []) if isinstance(step, Mapping)],
                request.get("action") if isinstance(request.get("action"), Mapping) else {},
            )
        }
    if mode == "matrix-execution-plan":
        return asdict(
            build_matrix_execution_plan(
                dry_run=bool(request.get("dryRun")),
                scenario_count=int(request.get("scenarioCount") or 0),
                requested_max_concurrency=(
                    int(request["requestedMaxConcurrency"])
                    if request.get("requestedMaxConcurrency") is not None
                    else None
                ),
            )
        )
    if mode == "default-window-target":
        return build_default_window_target(
            scenario_id=str(request.get("scenarioId") or ""),
            run_id=str(request.get("runId") or ""),
            round_number=int(request.get("round") or 0),
            dry_run=bool(request.get("dryRun")),
            app_name=str(request.get("appName")) if request.get("appName") else None,
            title=str(request.get("title")) if request.get("title") else None,
            mode=str(request.get("targetMode")) if request.get("targetMode") else None,
        )
    raise ValueError(f"unsupported computer_use_policy mode: {mode}")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("expected JSON request", file=sys.stderr)
        return 2
    request = json.loads(args[0])
    result = build_policy_result_from_request(request)
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
