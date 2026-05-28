"""Private helper validators for the isolated desktop L1 smoke evidence contract."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_contracts import (
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_TARGET_WINDOW_SCHEMAS,
)
from .trace import (
    _int_or_none,
    _list_of_mappings,
    _load_repair_mapping_with_ref,
    _looks_like_screenshot_ref,
    _mapping,
    _refs_from_explicit_list,
    _repair_replay_error,
    _string_or_none,
)

EXECUTOR_COMMAND_SIDE_EFFECT_FLAGS = (
    "sharedSystemInputUsed",
    "systemPointerMoved",
    "systemKeyboardEventsSent",
)

def _load_l1_payload_ref(
    ref: str | None,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
    kind: str,
    errors: list[dict[str, Any]],
) -> Mapping[str, Any] | None:
    if not ref:
        return None
    try:
        payload, _ = _load_repair_mapping_with_ref(ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        errors.append(_repair_replay_error(f"workflow_{kind}_ref_load_failed", f"L1 workflow {kind} ref could not be loaded: {exc}.", "$", actual=ref))
        return None
    return payload

def _steps_from_result_or_trace(
    result: Mapping[str, Any] | None,
    traces: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    if isinstance(result, Mapping) and isinstance(result.get("steps"), list):
        return _list_of_mappings(result.get("steps"))
    for trace in traces:
        if isinstance(trace.get("steps"), list):
            return _list_of_mappings(trace.get("steps"))
    return []

def _validate_final_visible_evidence_consistency(
    evidence: Mapping[str, Any],
    result: Mapping[str, Any] | None,
    traces: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    final_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    if not final_ref:
        return
    if result is not None:
        _validate_workflow_payload_final_visible_ref(
            result,
            errors,
            final_ref=final_ref,
            payload_label="result",
            payload_path="$.resultRef",
        )
    for index, trace in enumerate(traces):
        _validate_workflow_payload_final_visible_ref(
            trace,
            errors,
            final_ref=final_ref,
            payload_label="trace",
            payload_path=f"$.traceRefs[{index}]",
        )

def _validate_workflow_payload_final_visible_ref(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    final_ref: str,
    payload_label: str,
    payload_path: str,
) -> None:
    payload_final_ref = _payload_final_observation_ref(payload)
    if not payload_final_ref:
        errors.append(_repair_replay_error(
            f"{payload_label}_final_observation_ref_missing",
            f"L1 {payload_label} payload must expose finalObservationRef matching finalScreenshotRef.",
            f"{payload_path}.finalObservationRef",
            expected=final_ref,
            actual=None,
        ))
    elif payload_final_ref != final_ref:
        errors.append(_repair_replay_error(
            f"{payload_label}_final_observation_ref_mismatch",
            f"L1 {payload_label} finalObservationRef must match finalScreenshotRef.",
            f"{payload_path}.finalObservationRef",
            expected=final_ref,
            actual=payload_final_ref,
        ))

    steps = _list_of_mappings(payload.get("steps"))
    last_step = _last_state_changing_step(steps)
    if last_step is None:
        return
    after_ref = _step_after_ref(last_step)
    step_index = _int_or_none(last_step.get("index"))
    step_path = f"{payload_path}.steps"
    if step_index is not None:
        step_path = f"{step_path}[index={step_index}]"
    if not after_ref:
        errors.append(_repair_replay_error(
            "last_step_after_ref_missing",
            "The last state-changing L1 step must expose afterRef matching finalScreenshotRef.",
            f"{step_path}.afterRef",
            expected=final_ref,
            actual=None,
        ))
    elif after_ref != final_ref:
        errors.append(_repair_replay_error(
            "last_step_after_ref_mismatch",
            "The last state-changing L1 step afterRef must match finalScreenshotRef.",
            f"{step_path}.afterRef",
            expected=final_ref,
            actual=after_ref,
        ))

def _payload_final_observation_ref(payload: Mapping[str, Any]) -> str | None:
    for key in ("finalObservationRef", "finalScreenshotRef", "currentObservationRef", "currentScreenshotRef"):
        ref = _string_or_none(payload.get(key))
        if ref:
            return ref
    for key in ("finalObservation", "finalScreenshot", "currentObservation"):
        ref = _string_or_none(_mapping(payload.get(key)).get("ref"))
        if ref:
            return ref
    return None

def _last_state_changing_step(steps: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for step in reversed(steps):
        if _state_changing_step(step):
            return step
    return None

def _step_after_ref(step: Mapping[str, Any]) -> str | None:
    ref = _string_or_none(step.get("afterRef"))
    if ref:
        return ref
    return _string_or_none(_mapping(step.get("after")).get("ref"))

def _step_before_ref(step: Mapping[str, Any]) -> str | None:
    ref = _string_or_none(step.get("beforeRef"))
    if ref:
        return ref
    return _string_or_none(_mapping(step.get("before")).get("ref"))

def _state_changing_step(step: Mapping[str, Any]) -> bool:
    action = _mapping(step.get("action"))
    kind = (_string_or_none(action.get("kind")) or _string_or_none(action.get("type")) or "").lower()
    return kind in {
        "open_app",
        "click",
        "double_click",
        "drag",
        "type_text",
        "press_key",
        "hotkey",
        "scroll",
        "focus",
        "save",
    }

def _step_current_screenshot_refs(step: Mapping[str, Any]) -> list[str]:
    refs = []
    for key in ("afterRef", "currentObservationRef", "observationRef", "screenshotRef", "currentScreenshotRef"):
        ref = _string_or_none(step.get(key))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    refs.extend(ref for ref in _refs_from_explicit_list(step.get("screenshotRefs")) if _looks_like_screenshot_ref(ref))
    for key in ("observation", "currentObservation", "before", "after"):
        value = _mapping(step.get(key))
        ref = _string_or_none(value.get("ref"))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    return _unique_strings(refs)

def _l1_action_summary(steps: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    pointer_indexes: set[int] = set()
    keyboard_indexes: set[int] = set()
    open_app = False
    typed_text = False
    for fallback_index, step in enumerate(steps):
        action = _mapping(step.get("action"))
        kind = (_string_or_none(action.get("kind")) or _string_or_none(action.get("type")) or "").lower()
        step_index = _int_or_none(step.get("index"))
        index = fallback_index if step_index is None else step_index
        modalities = _modalities_for_action_kind(kind)
        if "pointer" in modalities:
            pointer_indexes.add(index)
        if "keyboard" in modalities:
            keyboard_indexes.add(index)
        if kind == "open_app":
            open_app = True
        if kind == "type_text":
            typed_text = True
    return {
        "openApp": open_app,
        "typedText": typed_text,
        "pointerActionIndexes": pointer_indexes,
        "keyboardActionIndexes": keyboard_indexes,
    }

def _modalities_for_action_kind(kind: str) -> set[str]:
    if kind in {"click", "double_click", "drag", "scroll", "focus"}:
        return {"pointer"}
    if kind in {"type_text", "press_key", "hotkey", "save"}:
        return {"keyboard"}
    return set()

def _workflow_screen_change_verified(steps: Sequence[Mapping[str, Any]], evidence: Mapping[str, Any]) -> bool:
    if _mapping(evidence.get("l1Smoke")).get("screenChanged") is True:
        return True
    for step in steps:
        verification = _mapping(step.get("verification"))
        if verification.get("changed") is True:
            return True
        reason = str(verification.get("reason") or "").lower()
        if "changed" in reason or "screen" in reason and "updated" in reason:
            return True
    return False

def _validate_screenshot_content_change(
    initial_screenshot_ref: str | None,
    final_screenshot_ref: str | None,
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    if not initial_screenshot_ref or not final_screenshot_ref or initial_screenshot_ref == final_screenshot_ref:
        return
    initial_hash = _screenshot_file_hash(initial_screenshot_ref, resolver=resolver)
    final_hash = _screenshot_file_hash(final_screenshot_ref, resolver=resolver)
    if initial_hash is None or final_hash is None:
        return
    if initial_hash == final_hash:
        errors.append(_repair_replay_error(
            "screenshot_content_not_changed",
            "Initial and final L1 screenshots must have different file content; l1Smoke.screenChanged cannot be accepted from identical screenshots.",
            "$",
            actual={"initialScreenshotRef": initial_screenshot_ref, "finalScreenshotRef": final_screenshot_ref, "sha256": final_hash},
        ))

def _validate_stepwise_screenshot_content_change(
    steps: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    for index, step in enumerate(steps):
        if not _state_changing_step(step):
            continue
        before_ref = _step_before_ref(step)
        after_ref = _step_after_ref(step)
        if not before_ref or not after_ref:
            continue
        step_index = _int_or_none(step.get("index"))
        step_path = "$.steps"
        if step_index is not None:
            step_path = f"{step_path}[index={step_index}]"
        else:
            step_path = f"{step_path}[{index}]"
        if before_ref == after_ref:
            errors.append(_repair_replay_error(
                "step_screenshot_refs_not_distinct",
                "Each state-changing L1 step must use distinct beforeRef and afterRef screenshot refs.",
                step_path,
                actual=after_ref,
            ))
            return
        before_hash = _screenshot_file_hash(before_ref, resolver=resolver)
        after_hash = _screenshot_file_hash(after_ref, resolver=resolver)
        if before_hash is None or after_hash is None:
            continue
        if before_hash == after_hash:
            errors.append(_repair_replay_error(
                "step_screenshot_content_not_changed",
                "Each state-changing L1 step must change screenshot content; opening the app alone cannot prove later input/button steps succeeded.",
                step_path,
                actual={"beforeRef": before_ref, "afterRef": after_ref, "sha256": after_hash},
            ))
            return

def _screenshot_file_hash(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    try:
        resolved = _resolve_ref_or_value(ref, resolver=resolver)
        if isinstance(resolved, Mapping):
            return None
        path = Path(resolved).expanduser()
        if not path.is_file() or path.stat().st_size <= 0:
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except (OSError, TypeError, ValueError):
        return None

def _l1_input_event_log_summary(
    payloads: Sequence[Mapping[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> dict[str, Any]:
    refs = _unique_strings([
        ref
        for payload in payloads
        for ref in _input_event_log_refs(payload)
    ])
    modalities: set[str] = set()
    action_indexes_by_modality: dict[str, set[int]] = {"pointer": set(), "keyboard": set()}
    errors: list[dict[str, Any]] = []
    for ref in refs:
        try:
            payload, _ = _load_repair_mapping_with_ref(ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
            errors.append(_repair_replay_error("input_event_log_ref_unreadable", f"L1 input event log ref could not be loaded: {exc}.", "$", actual=ref))
            continue
        schema = _string_or_none(payload.get("schemaVersion")) or ""
        schema_modality = _schema_log_modality(schema)
        events = _list_of_mappings(payload.get("events"))
        event_count = _int_or_none(payload.get("eventCount"))
        if event_count is not None and event_count != len(events):
            errors.append(_repair_replay_error("input_event_log_count_mismatch", "Input event log eventCount must match events length.", "$", expected=event_count, actual=len(events)))
        saw_schema_modality_event = False
        for event in events:
            modality = schema_modality or _normalize_modality(_string_or_none(event.get("modality")))
            if modality not in {"pointer", "keyboard"}:
                continue
            if schema_modality == modality:
                saw_schema_modality_event = True
            modalities.add(modality)
            action_index = _int_or_none(event.get("actionIndex"))
            if action_index is not None:
                action_indexes_by_modality[modality].add(action_index)
        if schema_modality and not saw_schema_modality_event:
            errors.append(_repair_replay_error("required_input_event_log_missing", "L1 modality-specific input event log must contain events.", "$", expected=schema_modality, actual=0))
    return {
        "modalities": modalities,
        "actionIndexesByModality": action_indexes_by_modality,
        "errors": errors,
    }

def _validate_input_command_provenance(
    evidence: Mapping[str, Any],
    payloads: Sequence[Mapping[str, Any]],
    *,
    action_summary: Mapping[str, Any],
    errors: list[dict[str, Any]],
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    log_refs = _executor_command_event_log_refs(payloads)
    if not log_refs:
        errors.append(_repair_replay_error(
            "command_event_log_ref_missing",
            "L1 input evidence must expose executorCommandEventLogRef for isolated input command provenance.",
            "$.executorCommandEventLogRef",
        ))
        return
    command_events_by_ref_id: dict[tuple[str, str], Mapping[str, Any]] = {}
    for ref in log_refs:
        try:
            payload = _load_json_mapping(ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
            errors.append(_repair_replay_error("command_event_log_ref_unreadable", f"L1 executor command event log could not be loaded: {exc}.", "$.executorCommandEventLogRef", actual=ref))
            continue
        if payload.get("schemaVersion") != EXECUTOR_COMMAND_EVENT_LOG_SCHEMA:
            errors.append(_repair_replay_error(
                "command_event_log_schema_invalid",
                "L1 executor command event log schemaVersion is invalid.",
                "$.executorCommandEventLogRef.schemaVersion",
                expected=EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
                actual=payload.get("schemaVersion"),
            ))
        _validate_executor_command_side_effect_flags(payload, errors, path="$.executorCommandEventLogRef")
        events = _list_of_mappings(payload.get("events"))
        event_count = _int_or_none(payload.get("eventCount"))
        if event_count is not None and event_count != len(events):
            errors.append(_repair_replay_error("command_event_log_count_mismatch", "Executor command event log eventCount must match events length.", "$.executorCommandEventLogRef.eventCount", expected=event_count, actual=len(events)))
        _validate_command_event_sequence(events, errors)
        for event in events:
            _validate_executor_command_side_effect_flags(event, errors, path="$.executorCommandEventLogRef.events")
            command_id = _string_or_none(event.get("id"))
            if command_id:
                command_events_by_ref_id[(ref, command_id)] = event
    if not command_events_by_ref_id:
        return

    expected_display = _expected_l1_display(evidence, resolver=resolver)
    known_command_log_refs = set(log_refs)
    pointer_context = _load_window_bound_pointer_context(
        evidence,
        errors,
        resolver=resolver,
        expected_display=expected_display,
    )
    expected_indexes_by_modality = {
        "pointer": set(action_summary.get("pointerActionIndexes") or set()),
        "keyboard": set(action_summary.get("keyboardActionIndexes") or set()),
    }
    covered_by_modality: dict[str, set[int]] = {"pointer": set(), "keyboard": set()}
    for input_ref in _unique_strings([ref for payload in payloads for ref in _input_event_log_refs(payload)]):
        try:
            input_payload = _load_json_mapping(input_ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError):
            continue
        schema_modality = _schema_log_modality(_string_or_none(input_payload.get("schemaVersion")) or "")
        for event in _list_of_mappings(input_payload.get("events")):
            modality = schema_modality or _normalize_modality(_string_or_none(event.get("modality")))
            if modality not in {"pointer", "keyboard"}:
                continue
            action_index = _int_or_none(event.get("actionIndex"))
            command_id = _input_event_command_id(event)
            if not command_id:
                errors.append(_repair_replay_error(
                    "input_event_command_provenance_missing",
                    "Every L1 input event must cite an executor command event.",
                    "$.inputEventLogRef.events",
                    actual={"inputEventRef": input_ref, "actionIndex": action_index, "modality": modality},
                ))
                continue
            command_log_ref = _string_or_none(event.get("commandEventLogRef"))
            if not command_log_ref:
                errors.append(_repair_replay_error(
                    "input_event_command_log_ref_missing",
                    "Every L1 input event must cite the executor command event log it uses.",
                    "$.inputEventLogRef.events.commandEventLogRef",
                    actual={"inputEventRef": input_ref, "commandEventId": command_id},
                ))
                continue
            if command_log_ref not in known_command_log_refs:
                errors.append(_repair_replay_error(
                    "input_event_command_log_ref_mismatch",
                    "L1 input event commandEventLogRef must match executorCommandEventLogRef.",
                    "$.inputEventLogRef.events.commandEventLogRef",
                    expected=sorted(known_command_log_refs),
                    actual=command_log_ref,
                ))
                continue
            expected_command_ref = f"{command_log_ref}#events/{command_id}"
            command_ref = _string_or_none(event.get("commandEventRef"))
            if command_ref != expected_command_ref:
                errors.append(_repair_replay_error(
                    "input_event_command_ref_mismatch",
                    "L1 input event commandEventRef must point to its commandEventId in executorCommandEventLogRef.",
                    "$.inputEventLogRef.events.commandEventRef",
                    expected=expected_command_ref,
                    actual=command_ref,
                ))
            command_event = command_events_by_ref_id.get((command_log_ref, command_id))
            if command_event is None:
                errors.append(_repair_replay_error(
                    "input_event_command_event_not_found",
                    "L1 input event commandEventId must resolve inside executorCommandEventLogRef.",
                    "$.inputEventLogRef.events.commandEventId",
                    actual={"inputEventRef": input_ref, "commandEventId": command_id},
                ))
                continue
            _validate_input_event_command_match(
                event,
                command_event,
                errors,
                input_event_ref=input_ref,
                modality=modality,
                action_index=action_index,
                expected_display=expected_display,
            )
            if modality == "pointer":
                _validate_pointer_event_window_binding(
                    event,
                    command_event,
                    errors,
                    pointer_context=pointer_context,
                    action_index=action_index,
                )
            if action_index is not None:
                covered_by_modality[modality].add(action_index)
    for modality, expected_indexes in expected_indexes_by_modality.items():
        missing_indexes = sorted(expected_indexes - covered_by_modality.get(modality, set()))
        if missing_indexes:
            errors.append(_repair_replay_error(
                "input_event_command_action_index_missing",
                "L1 command provenance must cover every workflow action index for each input modality.",
                "$.workflowRequirements.requiredInputModalities",
                expected=sorted(expected_indexes),
                actual=sorted(covered_by_modality.get(modality, set())),
            ))
            break

def _load_window_bound_pointer_context(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
    expected_display: str | None,
    allowed_target_window_schemas: Sequence[str] = ISOLATED_TARGET_WINDOW_SCHEMAS,
) -> dict[str, Any]:
    target_window_ref = _string_or_none(evidence.get("targetWindowRef"))
    proof_ref = _string_or_none(evidence.get("windowBoundPointerProofRef"))
    context: dict[str, Any] = {
        "targetWindowRef": target_window_ref,
        "proofRef": proof_ref,
        "actionsByIndex": {},
    }
    if not target_window_ref or not proof_ref:
        return context
    try:
        target_window = _load_json_mapping(target_window_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error("target_window_ref_unreadable", f"targetWindowRef could not be loaded: {exc}.", "$.targetWindowRef", actual=target_window_ref))
        target_window = {}
    try:
        proof = _load_json_mapping(proof_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error("window_bound_pointer_proof_unreadable", f"windowBoundPointerProofRef could not be loaded: {exc}.", "$.windowBoundPointerProofRef", actual=proof_ref))
        proof = {}
    context["targetWindow"] = target_window
    context["proof"] = proof
    allowed_schemas = tuple(allowed_target_window_schemas) or ISOLATED_TARGET_WINDOW_SCHEMAS
    if target_window:
        if target_window.get("schemaVersion") not in allowed_schemas or target_window.get("status") != "ready":
            errors.append(_repair_replay_error(
                "target_window_ref_invalid",
                "targetWindowRef must resolve to a ready isolated target window payload.",
                "$.targetWindowRef",
                expected={"schemaVersion": sorted(allowed_schemas), "status": "ready"},
                actual={"schemaVersion": target_window.get("schemaVersion"), "status": target_window.get("status")},
            ))
        if expected_display and _string_or_none(target_window.get("display")) != expected_display:
            errors.append(_repair_replay_error(
                "target_window_display_mismatch",
                "targetWindowRef display must match the isolated display.",
                "$.targetWindowRef.display",
                expected=expected_display,
                actual=target_window.get("display"),
            ))
        _validate_executor_command_side_effect_flags(
            target_window,
            errors,
            path="$.targetWindowRef",
            code="window_bound_pointer_side_effect_flag",
            subject="Window-bound pointer target proof",
        )
    if proof:
        if proof.get("schemaVersion") != "sciforge.computer-use.window-bound-pointer-proof.v1" or proof.get("status") != "completed":
            errors.append(_repair_replay_error(
                "window_bound_pointer_proof_invalid",
                "windowBoundPointerProofRef must resolve to completed window-bound pointer proof.",
                "$.windowBoundPointerProofRef",
                expected={"schemaVersion": "sciforge.computer-use.window-bound-pointer-proof.v1", "status": "completed"},
                actual={"schemaVersion": proof.get("schemaVersion"), "status": proof.get("status")},
            ))
        if proof.get("targetWindowRef") != target_window_ref:
            errors.append(_repair_replay_error(
                "window_bound_pointer_target_window_mismatch",
                "windowBoundPointerProofRef.targetWindowRef must match targetWindowRef.",
                "$.windowBoundPointerProofRef.targetWindowRef",
                expected=target_window_ref,
                actual=proof.get("targetWindowRef"),
            ))
        if expected_display and _string_or_none(proof.get("display")) != expected_display:
            errors.append(_repair_replay_error(
                "window_bound_pointer_display_mismatch",
                "windowBoundPointerProofRef display must match the isolated display.",
                "$.windowBoundPointerProofRef.display",
                expected=expected_display,
                actual=proof.get("display"),
            ))
        _validate_executor_command_side_effect_flags(
            proof,
            errors,
            path="$.windowBoundPointerProofRef",
            code="window_bound_pointer_side_effect_flag",
            subject="Window-bound pointer proof",
        )
        actions_by_index: dict[int, Mapping[str, Any]] = {}
        for action in _list_of_mappings(proof.get("pointerActions")):
            action_index = _int_or_none(action.get("actionIndex"))
            if action_index is None:
                continue
            actions_by_index[action_index] = action
            _validate_window_bound_pointer_action_geometry(action, errors)
        context["actionsByIndex"] = actions_by_index
    return context

def _validate_window_bound_pointer_action_geometry(action: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if action.get("coordinateSpace") != "window":
        errors.append(_repair_replay_error(
            "window_bound_pointer_coordinate_space_invalid",
            "Window-bound pointer proof actions must use window coordinate space.",
            "$.windowBoundPointerProofRef.pointerActions.coordinateSpace",
            expected="window",
            actual=action.get("coordinateSpace"),
        ))
    if action.get("pointInsideTargetBounds") is not True:
        errors.append(_repair_replay_error(
            "window_bound_pointer_target_hit_invalid",
            "Window-bound pointer proof action hit point must be inside target bounds.",
            "$.windowBoundPointerProofRef.pointerActions.pointInsideTargetBounds",
            expected=True,
            actual=action.get("pointInsideTargetBounds"),
        ))
    point = _mapping(action.get("hitPointInWindow"))
    bounds = _mapping(action.get("targetBoundsInWindow"))
    if not _point_inside_bounds(point, bounds):
        errors.append(_repair_replay_error(
            "window_bound_pointer_target_hit_invalid",
            "Window-bound pointer proof hitPointInWindow must be inside targetBoundsInWindow.",
            "$.windowBoundPointerProofRef.pointerActions",
            actual={"hitPointInWindow": point, "targetBoundsInWindow": bounds},
        ))
    window_bounds = _mapping(action.get("windowBoundsAtDispatch"))
    if not _string_or_none(window_bounds.get("windowId")) or _positive_int_or_none(window_bounds.get("width")) is None or _positive_int_or_none(window_bounds.get("height")) is None:
        errors.append(_repair_replay_error(
            "window_bound_pointer_window_bounds_invalid",
            "Window-bound pointer proof must record target window id and positive geometry at dispatch.",
            "$.windowBoundPointerProofRef.pointerActions.windowBoundsAtDispatch",
            actual=window_bounds,
        ))

def _validate_pointer_event_window_binding(
    event: Mapping[str, Any],
    command_event: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    pointer_context: Mapping[str, Any],
    action_index: int | None,
) -> None:
    proof_ref = _string_or_none(pointer_context.get("proofRef"))
    target_window_ref = _string_or_none(pointer_context.get("targetWindowRef"))
    if action_index is None:
        return
    proof_action = _mapping(_mapping(pointer_context.get("actionsByIndex")).get(action_index))
    if not proof_action:
        errors.append(_repair_replay_error(
            "window_bound_pointer_action_missing",
            "Every pointer input action must have a window-bound pointer proof action.",
            "$.windowBoundPointerProofRef.pointerActions",
            actual={"actionIndex": action_index},
        ))
        return
    if event.get("targetWindowRef") != target_window_ref or event.get("windowBoundPointerProofRef") != proof_ref:
        errors.append(_repair_replay_error(
            "input_event_window_bound_ref_missing",
            "Pointer input events must cite targetWindowRef and windowBoundPointerProofRef.",
            "$.inputEventLogRef.events",
            expected={"targetWindowRef": target_window_ref, "windowBoundPointerProofRef": proof_ref},
            actual={"targetWindowRef": event.get("targetWindowRef"), "windowBoundPointerProofRef": event.get("windowBoundPointerProofRef")},
        ))
    expected_target_ref = f"{proof_ref}#pointerActions/{action_index}" if proof_ref else None
    if event.get("targetProofRef") != expected_target_ref:
        errors.append(_repair_replay_error(
            "input_event_target_proof_ref_mismatch",
            "Pointer input event targetProofRef must point to its window-bound pointer proof action.",
            "$.inputEventLogRef.events.targetProofRef",
            expected=expected_target_ref,
            actual=event.get("targetProofRef"),
        ))
    if event.get("coordinateSpace") != "window":
        errors.append(_repair_replay_error(
            "input_event_coordinate_space_invalid",
            "Pointer input events must use window coordinate space.",
            "$.inputEventLogRef.events.coordinateSpace",
            expected="window",
            actual=event.get("coordinateSpace"),
        ))
    hit_point = _mapping(proof_action.get("hitPointInWindow"))
    if _int_or_none(event.get("windowX")) != _int_or_none(hit_point.get("x")) or _int_or_none(event.get("windowY")) != _int_or_none(hit_point.get("y")):
        errors.append(_repair_replay_error(
            "input_event_window_point_mismatch",
            "Pointer input event window point must match window-bound pointer proof.",
            "$.inputEventLogRef.events",
            expected=hit_point,
            actual={"windowX": event.get("windowX"), "windowY": event.get("windowY")},
        ))
    if proof_action.get("commandEventId") != command_event.get("id"):
        errors.append(_repair_replay_error(
            "window_bound_pointer_command_mismatch",
            "Window-bound pointer proof commandEventId must match the cited executor command event.",
            "$.windowBoundPointerProofRef.pointerActions.commandEventId",
            expected=command_event.get("id"),
            actual=proof_action.get("commandEventId"),
        ))
    _validate_pointer_command_args(command_event, proof_action, errors)

def _validate_pointer_command_args(
    command_event: Mapping[str, Any],
    proof_action: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    args = command_event.get("args")
    if not isinstance(args, list):
        return
    arg_text = [str(arg) for arg in args]
    window_bounds = _mapping(proof_action.get("windowBoundsAtDispatch"))
    window_id = _string_or_none(window_bounds.get("windowId"))
    hit_point = _mapping(proof_action.get("hitPointInWindow"))
    x = _int_or_none(hit_point.get("x"))
    y = _int_or_none(hit_point.get("y"))
    if len(arg_text) not in {8, 9} or len(arg_text) < 2 or Path(arg_text[0]).name != "xdotool" or arg_text[1] != "mousemove" or not window_id:
        errors.append(_repair_replay_error(
            "window_bound_pointer_command_not_window_bound",
            "Pointer executor command must be an xdotool window-bound mousemove/click.",
            "$.executorCommandEventLogRef.events.args",
            actual=arg_text,
        ))
        return
    argument_index = 2
    if arg_text[argument_index] == "--sync":
        argument_index += 1
    if argument_index + 5 >= len(arg_text) or arg_text[argument_index] != "--window" or arg_text[argument_index + 4:argument_index + 6] != ["click", "1"]:
        errors.append(_repair_replay_error(
            "window_bound_pointer_command_not_window_bound",
            "Pointer executor command must follow xdotool mousemove [--sync] --window <id> <x> <y> click 1.",
            "$.executorCommandEventLogRef.events.args",
            actual=arg_text,
        ))
        return
    if arg_text[argument_index + 1] != window_id:
        errors.append(_repair_replay_error(
            "window_bound_pointer_command_window_mismatch",
            "Pointer executor command --window id must match proof window id.",
            "$.executorCommandEventLogRef.events.args",
            expected=window_id,
            actual=arg_text[argument_index + 1],
        ))
    actual_x = _int_or_none(arg_text[argument_index + 2])
    actual_y = _int_or_none(arg_text[argument_index + 3])
    if x is not None and actual_x != x:
        errors.append(_repair_replay_error("window_bound_pointer_command_point_mismatch", "Pointer executor command mousemove x coordinate must match proof hit point.", "$.executorCommandEventLogRef.events.args", expected=x, actual=actual_x))
    if y is not None and actual_y != y:
        errors.append(_repair_replay_error("window_bound_pointer_command_point_mismatch", "Pointer executor command mousemove y coordinate must match proof hit point.", "$.executorCommandEventLogRef.events.args", expected=y, actual=actual_y))

def _validate_executor_command_side_effect_flags(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    path: str,
    code: str = "input_command_side_effect_flag",
    subject: str = "Executor command provenance",
) -> None:
    for key in EXECUTOR_COMMAND_SIDE_EFFECT_FLAGS:
        if payload.get(key) is not False:
            errors.append(_repair_replay_error(
                code,
                f"{subject} requires {key}=false.",
                f"{path}.{key}",
                expected=False,
                actual=payload.get(key),
            ))
            break

def _validate_command_event_sequence(
    events: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    sequences: list[int] = []
    timestamps: list[float] = []
    for event in events:
        sequence = _int_or_none(event.get("sequence"))
        if sequence is None:
            errors.append(_repair_replay_error("input_command_sequence_invalid", "Executor command events must include integer sequence values.", "$.executorCommandEventLogRef.events.sequence"))
            return
        sequences.append(sequence)
        timestamp = event.get("timestamp")
        if not isinstance(timestamp, (int, float)):
            errors.append(_repair_replay_error("input_command_timestamp_invalid", "Executor command events must include numeric timestamps.", "$.executorCommandEventLogRef.events.timestamp", actual=timestamp))
            return
        timestamps.append(float(timestamp))
    if len(set(sequences)) != len(sequences) or sequences != sorted(sequences):
        errors.append(_repair_replay_error("input_command_sequence_invalid", "Executor command event sequence values must be unique and increasing.", "$.executorCommandEventLogRef.events.sequence", actual=sequences))
    if timestamps != sorted(timestamps):
        errors.append(_repair_replay_error("input_command_timestamp_invalid", "Executor command event timestamps must not move backwards.", "$.executorCommandEventLogRef.events.timestamp", actual=timestamps))

def _validate_input_event_command_match(
    event: Mapping[str, Any],
    command_event: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    input_event_ref: str,
    modality: str,
    action_index: int | None,
    expected_display: str | None,
) -> None:
    command_action_index = _int_or_none(command_event.get("actionIndex"))
    if action_index is None or command_action_index != action_index:
        errors.append(_repair_replay_error(
            "input_event_command_action_index_mismatch",
            "Input event actionIndex must match the cited executor command event.",
            "$.inputEventLogRef.events.actionIndex",
            expected=action_index,
            actual=command_action_index,
        ))
    command_modality = _normalize_modality(_string_or_none(command_event.get("inputModality")))
    if command_modality != modality:
        errors.append(_repair_replay_error(
            "input_event_command_modality_mismatch",
            "Input event modality must match the cited executor command event modality.",
            "$.inputEventLogRef.events.modality",
            expected=modality,
            actual=command_modality,
        ))
    event_kind = _normalize_action_kind(_string_or_none(event.get("kind")))
    command_kind = _normalize_action_kind(_string_or_none(command_event.get("actionKind")) or _string_or_none(command_event.get("role")))
    if event_kind and command_kind and event_kind != command_kind:
        errors.append(_repair_replay_error(
            "input_event_command_kind_mismatch",
            "Input event kind must match the cited executor command event kind.",
            "$.inputEventLogRef.events.kind",
            expected=event_kind,
            actual=command_kind,
        ))
    if _int_or_none(command_event.get("returncode")) != 0:
        errors.append(_repair_replay_error(
            "input_command_returncode_nonzero",
            "Completed L1 input events must cite executor commands that returned zero.",
            "$.executorCommandEventLogRef.events.returncode",
            actual=command_event.get("returncode"),
        ))
    command_display = _string_or_none(command_event.get("display")) or _string_or_none(_mapping(command_event.get("env")).get("DISPLAY"))
    if expected_display and command_display != expected_display:
        errors.append(_repair_replay_error(
            "input_command_display_mismatch",
            "Executor command DISPLAY must match the isolated virtual display.",
            "$.executorCommandEventLogRef.events.display",
            expected=expected_display,
            actual=command_display,
        ))
    args = command_event.get("args")
    if not isinstance(args, list) or not args:
        errors.append(_repair_replay_error("input_command_args_missing", "Executor command event must include command args.", "$.executorCommandEventLogRef.events.args"))
    elif _executor_args_look_untrusted(args):
        errors.append(_repair_replay_error(
            "input_command_executor_untrusted",
            "Executor command event must reference a direct isolated input executor, not a shell or system input wrapper.",
            "$.executorCommandEventLogRef.events.args",
            actual=args[:3],
        ))
    if "stdout" in command_event or "stderr" in command_event:
        errors.append(_repair_replay_error(
            "input_command_raw_output_forbidden",
            "Executor command events may store stdoutSummary/stderrSummary, not raw stdout/stderr payloads.",
            "$.executorCommandEventLogRef.events",
            actual={"inputEventRef": input_event_ref},
        ))

def _executor_command_event_log_refs(payloads: Sequence[Mapping[str, Any]]) -> list[str]:
    refs = []
    for payload in payloads:
        ref = _string_or_none(payload.get("executorCommandEventLogRef"))
        if ref:
            refs.append(ref)
        diagnostics = _mapping(payload.get("failureDiagnostics"))
        diagnostic_ref = _string_or_none(diagnostics.get("executorCommandEventLogRef"))
        if diagnostic_ref:
            refs.append(diagnostic_ref)
        metadata_ref = _string_or_none(_mapping(payload.get("metadata")).get("executorCommandEventLogRef"))
        if metadata_ref:
            refs.append(metadata_ref)
    return _unique_strings(refs)

def _input_event_command_id(event: Mapping[str, Any]) -> str | None:
    command_id = _string_or_none(event.get("commandEventId"))
    if command_id:
        return command_id
    command_ref = _string_or_none(event.get("commandEventRef"))
    if not command_ref:
        return None
    marker = "#events/"
    if marker in command_ref:
        return command_ref.rsplit(marker, 1)[-1] or None
    return None

def _expected_l1_display(
    evidence: Mapping[str, Any],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    for key in ("virtualDisplayRef", "backendReadinessProofRef"):
        ref = _string_or_none(evidence.get(key))
        if not ref:
            continue
        try:
            payload = _load_json_mapping(ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError):
            continue
        display = _string_or_none(payload.get("display"))
        if display:
            return display
    return None

def _normalize_action_kind(value: str | None) -> str | None:
    text = (value or "").strip().replace("-", "_").lower()
    if text in {"click_input", "click_button", "click"}:
        return "click"
    if text in {"type", "type_text", "type_text_through_isolated_input"}:
        return "type_text"
    return text or None

def _executor_args_look_untrusted(args: Sequence[Any]) -> bool:
    if not args:
        return True
    executable = Path(str(args[0])).name.strip().lower()
    if executable in {"sh", "bash", "zsh", "osascript", "cliclick", "xdg-open"}:
        return True
    return any(str(arg).strip() in {";", "&&", "||", "|", "`"} for arg in args)

def _input_event_log_refs(payload: Mapping[str, Any]) -> list[str]:
    refs = []
    for key in ("inputEventLogRef", "pointerEventLogRef", "keyboardEventLogRef", "targetInputEventLogRef", "targetPointerStateRef", "targetKeyboardStateRef"):
        ref = _string_or_none(payload.get(key))
        if ref:
            refs.append(ref)
    refs.extend(ref for ref in _refs_from_explicit_list(payload.get("realWindowEvidenceRefs")) if ref.endswith(".json"))
    diagnostics = _mapping(payload.get("failureDiagnostics"))
    if diagnostics:
        refs.extend(_input_event_log_refs(diagnostics))
    return _unique_strings(refs)

def _schema_log_modality(schema: str) -> str | None:
    text = schema.lower()
    if text.endswith("pointer-state.v1") or text.endswith("pointer-event-log.v1"):
        return "pointer"
    if text.endswith("keyboard-state.v1") or text.endswith("keyboard-event-log.v1"):
        return "keyboard"
    return None

def _required_modalities(value: Any) -> list[str]:
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        candidates = [str(item) for item in value]
    else:
        candidates = []
    modalities = []
    for candidate in candidates:
        modality = _normalize_modality(candidate)
        if modality in {"pointer", "keyboard"} and modality not in modalities:
            modalities.append(modality)
    return modalities

def _normalize_modality(value: str | None) -> str | None:
    normalized = (value or "").strip().replace("_", "-").lower()
    if normalized in {"mouse", "pointer", "click", "drag", "scroll"}:
        return "pointer"
    if normalized in {"keyboard", "key", "typing", "text"}:
        return "keyboard"
    return normalized or None

def _load_evidence_records(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> list[Mapping[str, Any]]:
    path_or_payload = _resolve_ref_or_value(ref, resolver=resolver)
    if isinstance(path_or_payload, Mapping):
        records = path_or_payload.get("records")
        if isinstance(records, list):
            return [record for record in records if isinstance(record, Mapping)]
        return [path_or_payload]
    path = Path(path_or_payload)
    records: list[Mapping[str, Any]] = []
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        if isinstance(parsed, Mapping):
            records.append(parsed)
    return records

def _load_json_mapping(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any]:
    payload, _ = _load_repair_mapping_with_ref(_resolve_ref_or_value(ref, resolver=resolver), resolver=None)
    return payload

def _validate_session_ref_payload_schemas(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    expected_schemas = {
        "sessionManifestRef": "sciforge.computer-use.virtual-desktop-session.v1",
        "virtualDisplayRef": "sciforge.computer-use.virtual-display-ref.v1",
        "captureStreamRef": "sciforge.computer-use.capture-stream-ref.v1",
        "replayBundleRef": "sciforge.computer-use.replay-bundle-ref.v1",
        "noVncViewerRef": "sciforge.computer-use.novnc-viewer-ref.v1",
    }
    for key, expected_schema in expected_schemas.items():
        ref = _string_or_none(evidence.get(key))
        if not ref:
            continue
        try:
            payload = _load_json_mapping(ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
            errors.append(_repair_replay_error(
                "session_ref_payload_unreadable",
                f"{key} payload could not be loaded: {exc}.",
                f"$.{key}",
                actual=ref,
            ))
            continue
        if payload.get("schemaVersion") != expected_schema:
            errors.append(_repair_replay_error(
                "session_ref_schema_invalid",
                f"{key} payload schemaVersion is invalid.",
                f"$.{key}.schemaVersion",
                expected=expected_schema,
                actual=payload.get("schemaVersion"),
            ))
        if key == "captureStreamRef":
            _validate_capture_stream_frame_refs(evidence, payload, errors)

def _validate_capture_stream_frame_refs(
    evidence: Mapping[str, Any],
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    initial_ref = _string_or_none(evidence.get("initialScreenshotRef"))
    final_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    required_refs = [ref for ref in (initial_ref, final_ref) if ref]
    if not required_refs:
        return
    frame_refs = _refs_from_explicit_list(payload.get("frameRefs"))
    missing_refs = [ref for ref in required_refs if ref not in frame_refs]
    if missing_refs:
        errors.append(_repair_replay_error(
            "capture_stream_initial_final_frames_missing",
            "captureStreamRef.frameRefs must include the initial and final L1 screenshot refs.",
            "$.captureStreamRef.frameRefs",
            expected=required_refs,
            actual=frame_refs,
        ))

def _validate_backend_readiness_proof(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    ref = _string_or_none(evidence.get("backendReadinessProofRef"))
    if not ref:
        return
    try:
        payload = _load_json_mapping(ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error(
            "backend_readiness_proof_unreadable",
            f"backendReadinessProofRef payload could not be loaded: {exc}.",
            "$.backendReadinessProofRef",
            actual=ref,
        ))
        return
    if payload.get("schemaVersion") != BACKEND_READINESS_PROOF_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "backend_readiness_proof_schema_invalid",
            "backendReadinessProofRef must resolve to backend readiness proof.",
            "$.backendReadinessProofRef.schemaVersion",
            expected=BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            actual=payload.get("schemaVersion"),
        ))
    if payload.get("status") != "ready":
        errors.append(_repair_replay_error(
            "backend_readiness_proof_not_ready",
            "backendReadinessProofRef must prove the backend reached ready state during the run.",
            "$.backendReadinessProofRef.status",
            expected="ready",
            actual=payload.get("status"),
        ))
    if payload.get("backendKind") != evidence.get("backendKind"):
        errors.append(_repair_replay_error(
            "backend_readiness_proof_backend_mismatch",
            "backendReadinessProofRef backendKind must match the L1 evidence backendKind.",
            "$.backendReadinessProofRef.backendKind",
            expected=evidence.get("backendKind"),
            actual=payload.get("backendKind"),
        ))
    if payload.get("localhostOnly") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_proof_not_localhost_only",
            "backend readiness proof must expose only localhost VNC/noVNC endpoints.",
            "$.backendReadinessProofRef.localhostOnly",
            expected=True,
            actual=payload.get("localhostOnly"),
        ))
    _validate_backend_x_display_proof(payload, errors)
    _validate_backend_browser_window_page_proof(payload, errors)
    for key in ("vnc", "novnc"):
        endpoint = _mapping(payload.get(key))
        if endpoint.get("host") != "127.0.0.1" or endpoint.get("ready") is not True or _int_or_none(endpoint.get("port")) is None:
            errors.append(_repair_replay_error(
                "backend_readiness_endpoint_not_ready",
                f"backendReadinessProofRef.{key} must contain a ready localhost endpoint and port.",
                f"$.backendReadinessProofRef.{key}",
                expected={"host": "127.0.0.1", "ready": True, "port": "integer"},
                actual=endpoint,
            ))
            break
    _validate_backend_readiness_http_viewer(evidence, payload, errors, resolver=resolver)
    for key in ("sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent"):
        if payload.get(key) is not False:
            errors.append(_repair_replay_error(
                "backend_readiness_proof_side_effect_flag",
                f"backendReadinessProofRef requires {key}=false.",
                f"$.backendReadinessProofRef.{key}",
                expected=False,
                actual=payload.get(key),
            ))
            break

def _validate_backend_browser_window_page_proof(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    desktop_window = _mapping(payload.get("desktopWindow"))
    page = _mapping(payload.get("page"))
    if not desktop_window:
        errors.append(_repair_replay_error(
            "backend_readiness_desktop_window_missing",
            "backendReadinessProofRef.desktopWindow must prove the browser window was visible before L1 input.",
            "$.backendReadinessProofRef.desktopWindow",
            actual=payload.get("desktopWindow"),
        ))
        return
    if not page:
        errors.append(_repair_replay_error(
            "backend_readiness_page_missing",
            "backendReadinessProofRef.page must prove the smoke page reached its ready marker before L1 input.",
            "$.backendReadinessProofRef.page",
            actual=payload.get("page"),
        ))
        return
    if desktop_window.get("ready") is not True or desktop_window.get("visible") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_desktop_window_not_ready",
            "backendReadinessProofRef.desktopWindow must be ready and visible.",
            "$.backendReadinessProofRef.desktopWindow",
            expected={"ready": True, "visible": True},
            actual=desktop_window,
        ))
    if _string_or_none(desktop_window.get("display")) != _string_or_none(payload.get("display")):
        errors.append(_repair_replay_error(
            "backend_readiness_desktop_window_display_mismatch",
            "backendReadinessProofRef.desktopWindow.display must match backendReadinessProofRef.display.",
            "$.backendReadinessProofRef.desktopWindow.display",
            expected=payload.get("display"),
            actual=desktop_window.get("display"),
        ))
    if not _string_or_none(desktop_window.get("windowId")):
        errors.append(_repair_replay_error(
            "backend_readiness_desktop_window_id_missing",
            "backendReadinessProofRef.desktopWindow.windowId must identify the visible browser window.",
            "$.backendReadinessProofRef.desktopWindow.windowId",
            actual=desktop_window.get("windowId"),
        ))
    geometry = _mapping(desktop_window.get("geometry"))
    if _positive_int_or_none(geometry.get("width")) is None or _positive_int_or_none(geometry.get("height")) is None:
        errors.append(_repair_replay_error(
            "backend_readiness_desktop_window_geometry_invalid",
            "backendReadinessProofRef.desktopWindow.geometry must contain positive width and height.",
            "$.backendReadinessProofRef.desktopWindow.geometry",
            expected={"width": "positive integer", "height": "positive integer"},
            actual=geometry,
        ))
    if page.get("ready") is not True or page.get("titleMatched") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_page_not_ready",
            "backendReadinessProofRef.page must prove the browser page ready title was observed.",
            "$.backendReadinessProofRef.page",
            expected={"ready": True, "titleMatched": True},
            actual=page,
        ))
    ready_title = _string_or_none(page.get("readyTitle"))
    window_title = _string_or_none(desktop_window.get("title"))
    if not ready_title or window_title != ready_title:
        errors.append(_repair_replay_error(
            "backend_readiness_page_title_mismatch",
            "backendReadinessProofRef.page.readyTitle must match the observed desktopWindow.title.",
            "$.backendReadinessProofRef.page.readyTitle",
            expected=window_title,
            actual=ready_title,
        ))
    if page.get("readinessStrategy") != "window-title-marker":
        errors.append(_repair_replay_error(
            "backend_readiness_page_strategy_invalid",
            "backendReadinessProofRef.page.readinessStrategy must describe the non-DOM page readiness marker.",
            "$.backendReadinessProofRef.page.readinessStrategy",
            expected="window-title-marker",
            actual=page.get("readinessStrategy"),
        ))
    for proof_name, proof in (("desktopWindow", desktop_window), ("page", page)):
        for key in EXECUTOR_COMMAND_SIDE_EFFECT_FLAGS:
            if proof.get(key) is not False:
                errors.append(_repair_replay_error(
                    "backend_readiness_window_page_side_effect_flag",
                    f"backendReadinessProofRef.{proof_name} requires {key}=false.",
                    f"$.backendReadinessProofRef.{proof_name}.{key}",
                    expected=False,
                    actual=proof.get(key),
                ))
                return

def _validate_backend_x_display_proof(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    x_display = _mapping(payload.get("xDisplay"))
    if not x_display:
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_missing",
            "backendReadinessProofRef.xDisplay must prove the isolated X display was queryable.",
            "$.backendReadinessProofRef.xDisplay",
            actual=payload.get("xDisplay"),
        ))
        return
    if x_display.get("ready") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_not_ready",
            "backendReadinessProofRef.xDisplay.ready must be true.",
            "$.backendReadinessProofRef.xDisplay.ready",
            expected=True,
            actual=x_display.get("ready"),
        ))
    if _string_or_none(x_display.get("display")) != _string_or_none(payload.get("display")):
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_mismatch",
            "backendReadinessProofRef.xDisplay.display must match backendReadinessProofRef.display.",
            "$.backendReadinessProofRef.xDisplay.display",
            expected=payload.get("display"),
            actual=x_display.get("display"),
        ))
    width = _positive_int_or_none(x_display.get("width"))
    height = _positive_int_or_none(x_display.get("height"))
    if width is None or height is None:
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_geometry_invalid",
            "backendReadinessProofRef.xDisplay must contain positive width and height.",
            "$.backendReadinessProofRef.xDisplay",
            expected={"width": "positive integer", "height": "positive integer"},
            actual=x_display,
        ))
    if x_display.get("matchesRequestedViewport") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_viewport_mismatch",
            "backendReadinessProofRef.xDisplay must match the requested L1 viewport until dynamic target resolution is implemented.",
            "$.backendReadinessProofRef.xDisplay.matchesRequestedViewport",
            expected=True,
            actual=x_display.get("matchesRequestedViewport"),
        ))
    for key in EXECUTOR_COMMAND_SIDE_EFFECT_FLAGS:
        if x_display.get(key) is not False:
            errors.append(_repair_replay_error(
                "backend_readiness_x_display_side_effect_flag",
                f"backendReadinessProofRef.xDisplay requires {key}=false.",
                f"$.backendReadinessProofRef.xDisplay.{key}",
                expected=False,
                actual=x_display.get(key),
            ))
            break

def _validate_backend_readiness_http_viewer(
    evidence: Mapping[str, Any],
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    novnc = _mapping(payload.get("novnc"))
    http_viewer = _mapping(novnc.get("httpViewer"))
    if not http_viewer:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_missing",
            "backendReadinessProofRef.novnc.httpViewer must prove the noVNC viewer URL was served over localhost HTTP.",
            "$.backendReadinessProofRef.novnc.httpViewer",
            actual=novnc.get("httpViewer"),
        ))
        return
    status = _int_or_none(http_viewer.get("statusCode"))
    bytes_read = _positive_int_or_none(http_viewer.get("bytesRead"))
    expected_url = _expected_novnc_viewer_url(novnc)
    actual_url = _string_or_none(http_viewer.get("url"))
    if http_viewer.get("ready") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_not_ready",
            "backendReadinessProofRef.novnc.httpViewer.ready must be true.",
            "$.backendReadinessProofRef.novnc.httpViewer.ready",
            expected=True,
            actual=http_viewer.get("ready"),
        ))
    if str(http_viewer.get("method", "")).upper() != "GET":
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_method_invalid",
            "backendReadinessProofRef.novnc.httpViewer.method must be GET.",
            "$.backendReadinessProofRef.novnc.httpViewer.method",
            expected="GET",
            actual=http_viewer.get("method"),
        ))
    if http_viewer.get("localhostOnly") is not True or not actual_url or not _is_localhost_viewer_url(actual_url):
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_not_localhost",
            "backendReadinessProofRef.novnc.httpViewer.url must be a localhost noVNC viewer URL.",
            "$.backendReadinessProofRef.novnc.httpViewer",
            expected={"localhostOnly": True, "url": expected_url or "http://127.0.0.1:<port>/vnc.html"},
            actual=http_viewer,
        ))
    if expected_url and actual_url != expected_url:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_url_mismatch",
            "backendReadinessProofRef.novnc.httpViewer.url must match the noVNC endpoint and viewerPath.",
            "$.backendReadinessProofRef.novnc.httpViewer.url",
            expected=expected_url,
            actual=actual_url,
        ))
    if status is None or not (200 <= status < 400):
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_status_invalid",
            "backendReadinessProofRef.novnc.httpViewer.statusCode must be a 2xx/3xx HTTP status.",
            "$.backendReadinessProofRef.novnc.httpViewer.statusCode",
            expected="200..399",
            actual=http_viewer.get("statusCode"),
        ))
    if bytes_read is None:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_body_invalid",
            "backendReadinessProofRef.novnc.httpViewer must record a non-empty body hash without raw HTML.",
            "$.backendReadinessProofRef.novnc.httpViewer.bytesRead",
            expected="positive integer",
            actual=http_viewer.get("bytesRead"),
        ))
    sha = _string_or_none(http_viewer.get("sha256"))
    if sha is None or len(sha) != 64:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_body_invalid",
            "backendReadinessProofRef.novnc.httpViewer.sha256 must record the served viewer body hash.",
            "$.backendReadinessProofRef.novnc.httpViewer.sha256",
            expected="sha256 hex",
            actual=http_viewer.get("sha256"),
        ))
    if http_viewer.get("htmlDetected") is not True or http_viewer.get("noVncMarkerDetected") is not True:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_body_invalid",
            "backendReadinessProofRef.novnc.httpViewer must prove HTML and noVNC marker detection.",
            "$.backendReadinessProofRef.novnc.httpViewer",
            expected={"htmlDetected": True, "noVncMarkerDetected": True},
            actual=http_viewer,
        ))
    if http_viewer.get("rawPayloadWritten") is not False:
        errors.append(_repair_replay_error(
            "backend_readiness_http_viewer_raw_payload_forbidden",
            "backendReadinessProofRef.novnc.httpViewer must not store raw HTTP viewer payload.",
            "$.backendReadinessProofRef.novnc.httpViewer.rawPayloadWritten",
            expected=False,
            actual=http_viewer.get("rawPayloadWritten"),
        ))
    viewer_ref = _string_or_none(evidence.get("noVncViewerRef"))
    if viewer_ref and actual_url:
        try:
            viewer_payload = _load_json_mapping(viewer_ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError):
            return
        viewer_url = _string_or_none(viewer_payload.get("url"))
        if viewer_url and viewer_url != actual_url:
            errors.append(_repair_replay_error(
                "backend_readiness_http_viewer_ref_mismatch",
                "noVncViewerRef.url must match backendReadinessProofRef.novnc.httpViewer.url.",
                "$.noVncViewerRef.url",
                expected=actual_url,
                actual=viewer_url,
            ))

def _expected_novnc_viewer_url(novnc: Mapping[str, Any]) -> str | None:
    port = _int_or_none(novnc.get("port"))
    path = _string_or_none(novnc.get("viewerPath")) or "/vnc.html"
    if port is None:
        return None
    if not path.startswith("/"):
        path = f"/{path}"
    return f"http://127.0.0.1:{port}{path}"

def _is_localhost_viewer_url(url: str) -> bool:
    try:
        from urllib.parse import urlparse
    except ImportError:
        return False
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"} and parsed.path == "/vnc.html"

def _positive_int_or_none(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None

def _positive_or_zero_int_or_none(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None

def _point_inside_bounds(point: Mapping[str, Any], bounds: Mapping[str, Any]) -> bool:
    x = _positive_or_zero_int_or_none(point.get("x"))
    y = _positive_or_zero_int_or_none(point.get("y"))
    left = _positive_or_zero_int_or_none(bounds.get("x"))
    top = _positive_or_zero_int_or_none(bounds.get("y"))
    width = _positive_int_or_none(bounds.get("width"))
    height = _positive_int_or_none(bounds.get("height"))
    if None in (x, y, left, top, width, height):
        return False
    return bool(left <= x <= left + width and top <= y <= top + height)

def _viewer_screenshot_refs(viewer_payload: Mapping[str, Any]) -> list[str]:
    refs = [
        *[
            ref
            for ref in _refs_from_explicit_list(viewer_payload.get("screenshotRefs"))
            if _looks_like_screenshot_ref(ref)
        ],
    ]
    for frame in _list_of_mappings(viewer_payload.get("frames")):
        if str(frame.get("kind") or "").lower() == "placeholder":
            continue
        ref = _string_or_none(frame.get("screenshotRef"))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    return _unique_strings(refs)

def _resolve_ref_or_value(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any] | str | Path:
    if resolver is None:
        return ref
    resolved = resolver(ref)
    return ref if resolved is None else resolved

def _prior_round_completion_evidence_issues(payloads: Sequence[Mapping[str, Any]]) -> list[str]:
    issues: list[str] = []
    for index, payload in enumerate(payloads):
        _collect_prior_round_completion_evidence_issues(payload, issues, path=f"$[{index}]")
    return _unique_strings(issues)

def _collect_prior_round_completion_evidence_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if normalized in {
                "historicaldone",
                "ledgerdone",
                "priorrounddone",
                "priorroundcompletionevidence",
                "priorroundledgerdone",
            } and bool(item):
                issues.append(f"Prior-round completion key {key_text!r} is forbidden at {path}.")
            if normalized in {"completionevidencesource", "donesource"} and isinstance(item, str):
                compact = item.replace("_", "").replace("-", "").lower()
                if "prior" in compact or "ledger" in compact or "historical" in compact:
                    issues.append(f"Prior-round completion source {key_text!r} is forbidden at {path}.")
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}[{index}]")

def _target_environment_is_package_or_diagnostic(value: str) -> bool:
    compact = value.strip().replace("_", "").replace("-", "").lower()
    blocked_tokens = (
        "diagnostic",
        "dryrun",
        "fixture",
        "mock",
        "packageowned",
        "packagelocal",
        "scripted",
        "simulatedonly",
        "stateonly",
        "test",
        "virtual",
    )
    return any(token in compact for token in blocked_tokens)

def _unique_strings(values: Sequence[str | None]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result
