"""Native multi-screen / multi-actor Computer Use demo evidence harness."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .browser_runtime_dom_ax_observation import (
    BROWSER_RUNTIME_PAGE_QUERY_SCHEMA,
    BROWSER_RUNTIME_STABLE_REF_SCHEMA,
    build_browser_runtime_dom_ax_observation,
    validate_browser_runtime_dom_ax_observation,
)


NATIVE_MULTI_SCREEN_DEMO_SCHEMA = "sciforge.computer-use.native-multi-screen-demo.v1"
NATIVE_MULTI_SCREEN_DEMO_VALIDATION_SCHEMA = "sciforge.computer-use.native-multi-screen-demo-validation.v1"

_FORBIDDEN_BACKEND_MARKERS = ("docker", "novnc", "vnc", "rdp", "container")
_READ_ONLY_CURSOR_EVENTS = {"move", "point", "annotate"}


def build_native_multi_screen_demo_bundle(
    root_dir: str | Path,
    *,
    run_id: str = "native-multi-screen-demo",
    observed_at: str | None = None,
) -> dict[str, Any]:
    """Write a deterministic native multi-screen demo evidence bundle."""

    root = Path(root_dir)
    root.mkdir(parents=True, exist_ok=True)
    observed = observed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    display_group_id = "display-group-native-demo"
    screens = [
        {
            "displayGroupId": display_group_id,
            "screenId": "screen-source",
            "bounds": {"x": 0, "y": 0, "width": 1440, "height": 900},
            "beforeCaptureRef": _write_json(root / "captures" / "screen-source-before.json", {
                "schemaVersion": "sciforge.computer-use.capture-ref.v1",
                "screenId": "screen-source",
                "phase": "before",
                "observedAt": observed,
            }),
            "afterCaptureRef": _write_json(root / "captures" / "screen-source-after.json", {
                "schemaVersion": "sciforge.computer-use.capture-ref.v1",
                "screenId": "screen-source",
                "phase": "after",
                "observedAt": observed,
            }),
        },
        {
            "displayGroupId": display_group_id,
            "screenId": "screen-preview",
            "bounds": {"x": 1440, "y": 0, "width": 1280, "height": 800},
            "beforeCaptureRef": _write_json(root / "captures" / "screen-preview-before.json", {
                "schemaVersion": "sciforge.computer-use.capture-ref.v1",
                "screenId": "screen-preview",
                "phase": "before",
                "observedAt": observed,
            }),
            "afterCaptureRef": _write_json(root / "captures" / "screen-preview-after.json", {
                "schemaVersion": "sciforge.computer-use.capture-ref.v1",
                "screenId": "screen-preview",
                "phase": "after",
                "observedAt": observed,
            }),
        },
    ]
    actor_cursors = [
        {"actorId": "actor-source", "cursorId": "cursor-source", "screenId": "screen-source", "windowId": "window-source"},
        {"actorId": "actor-writer", "cursorId": "cursor-writer", "screenId": "screen-source", "windowId": "window-writer"},
        {"actorId": "actor-preview", "cursorId": "cursor-preview", "screenId": "screen-preview", "windowId": "window-preview"},
    ]
    cursor_events = [
        _cursor_event("cursor-event-001", "presence", actor_cursors[0], display_group_id, observed),
        _cursor_event("cursor-event-002", "presence", actor_cursors[1], display_group_id, observed),
        _cursor_event("cursor-event-003", "presence", actor_cursors[2], display_group_id, observed),
        _cursor_event("cursor-event-004", "move", actor_cursors[0], display_group_id, observed, position={"x": 140, "y": 220}),
        _cursor_event("cursor-event-005", "point", actor_cursors[1], display_group_id, observed, targetRef="stable-ref:writer-body"),
        _cursor_event("cursor-event-006", "annotate", actor_cursors[2], display_group_id, observed, annotationRef="annotation:preview-ready"),
    ]
    cursor_event_log_ref = _write_jsonl(root / "cursor-events.jsonl", cursor_events)
    proposals = [
        {
            "proposalId": "proposal-source-copy",
            "actorId": "actor-source",
            "cursorId": "cursor-source",
            "actionType": "click",
            "leaseScope": {"kind": "window-local", "displayGroupId": display_group_id, "screenId": "screen-source", "windowId": "window-source"},
            "observeBeforeMutateRef": str(root / "captures" / "screen-source-before.json"),
        },
        {
            "proposalId": "proposal-writer-type",
            "actorId": "actor-writer",
            "cursorId": "cursor-writer",
            "actionType": "type_text",
            "leaseScope": {"kind": "window-local", "displayGroupId": display_group_id, "screenId": "screen-source", "windowId": "window-writer"},
            "observeBeforeMutateRef": str(root / "captures" / "screen-source-before.json"),
        },
        {
            "proposalId": "proposal-preview-refresh",
            "actorId": "actor-preview",
            "cursorId": "cursor-preview",
            "actionType": "hotkey",
            "leaseScope": {"kind": "screen-global", "displayGroupId": display_group_id, "screenId": "screen-preview"},
            "observeBeforeMutateRef": str(root / "captures" / "screen-preview-before.json"),
        },
    ]
    lease_queues = [
        {
            "queueId": "queue-screen-source-window-local",
            "screenId": "screen-source",
            "scopeKind": "window-local",
            "schedulerPolicy": "native-screen-serial",
            "serialExecutorLease": True,
            "proposalIds": ["proposal-source-copy", "proposal-writer-type"],
            "decisionStatuses": ["ready", "queued"],
            "reason": "same-screen native executor lane is serial even when actor cursors differ",
        },
        {
            "queueId": "queue-screen-preview-global",
            "screenId": "screen-preview",
            "scopeKind": "screen-global",
            "schedulerPolicy": "native-screen-serial",
            "serialExecutorLease": True,
            "proposalIds": ["proposal-preview-refresh"],
            "decisionStatuses": ["ready"],
        },
    ]
    browser_observation = build_browser_runtime_dom_ax_observation(
        observation_id="browser-observation-source",
        observation_ref=str(root / "browser" / "dom-ax-observation.json"),
        display_group_id=display_group_id,
        screen_id="screen-source",
        window_id="window-source",
        browser_session_ref=str(root / "browser" / "session.json"),
        browser_tab_ref=str(root / "browser" / "tab.json"),
        source_snapshot_ref=str(root / "browser" / "snapshot.json"),
        page_query={
            "schemaVersion": BROWSER_RUNTIME_PAGE_QUERY_SCHEMA,
            "select": {"role": "button", "name": "Copy", "visible": True},
            "fields": ["role", "ariaLabel", "bbox", "isVisible"],
            "limit": 5,
        },
        stable_refs=[{
            "schemaVersion": BROWSER_RUNTIME_STABLE_REF_SCHEMA,
            "primary": "button:Copy",
            "resolveStrategy": "best-match",
            "signals": {"role": "button", "accessibleName": "Copy", "domPath": "main button:nth-of-type(1)"},
        }],
        visible_dom_ref=str(root / "browser" / "visible-dom.json"),
        accessibility_snapshot_ref=str(root / "browser" / "accessibility.json"),
        playwright_evaluate_ref=str(root / "browser" / "evaluate.json"),
        screenshot_ref=str(root / "captures" / "screen-source-before.json"),
        observed_at=observed,
    )
    _write_json(root / "browser" / "session.json", {"schemaVersion": "sciforge.browser-runtime.session-ref.v1", "runId": run_id})
    _write_json(root / "browser" / "tab.json", {"schemaVersion": "sciforge.browser-runtime.tab-ref.v1", "runId": run_id})
    _write_json(root / "browser" / "snapshot.json", {"schemaVersion": "sciforge.browser-runtime.snapshot.v1", "runId": run_id})
    _write_json(root / "browser" / "visible-dom.json", {"role": "button", "name": "Copy"})
    _write_json(root / "browser" / "accessibility.json", {"role": "button", "name": "Copy"})
    _write_json(root / "browser" / "evaluate.json", {"matches": 1})
    _write_json(root / "browser" / "dom-ax-observation.json", browser_observation)

    executor_events = [
        {
            "eventId": "executor-event-001",
            "leaseId": "lease-source-copy",
            "proposalId": "proposal-source-copy",
            "actorId": "actor-source",
            "cursorId": "cursor-source",
            "leaseScope": proposals[0]["leaseScope"],
            "beforeEvidenceRefs": [str(root / "captures" / "screen-source-before.json"), browser_observation["observationRef"]],
            "afterEvidenceRefs": [str(root / "captures" / "screen-source-after.json")],
            "executorLeaseAcquired": True,
            "guiActionCausalityRef": str(root / "executor-events.jsonl"),
        },
        {
            "eventId": "executor-event-002",
            "leaseId": "lease-preview-refresh",
            "proposalId": "proposal-preview-refresh",
            "actorId": "actor-preview",
            "cursorId": "cursor-preview",
            "leaseScope": proposals[2]["leaseScope"],
            "beforeEvidenceRefs": [str(root / "captures" / "screen-preview-before.json")],
            "afterEvidenceRefs": [str(root / "captures" / "screen-preview-after.json")],
            "executorLeaseAcquired": True,
            "guiActionCausalityRef": str(root / "executor-events.jsonl"),
        },
    ]
    executor_event_log_ref = _write_jsonl(root / "executor-events.jsonl", executor_events)
    replay = {
        "schemaVersion": "sciforge.computer-use.native-multi-screen-replay.v1",
        "replayRef": str(root / "replay" / "manifest.json"),
        "frames": [
            {"frameId": "frame-source-before", "screenId": "screen-source", "captureRef": str(root / "captures" / "screen-source-before.json")},
            {"frameId": "frame-preview-before", "screenId": "screen-preview", "captureRef": str(root / "captures" / "screen-preview-before.json")},
            {"frameId": "frame-source-after", "screenId": "screen-source", "captureRef": str(root / "captures" / "screen-source-after.json")},
            {"frameId": "frame-preview-after", "screenId": "screen-preview", "captureRef": str(root / "captures" / "screen-preview-after.json")},
        ],
        "overlayRefs": [
            str(root / "replay" / "overlay-screen-source.json"),
            str(root / "replay" / "overlay-screen-preview.json"),
        ],
    }
    _write_json(root / "replay" / "overlay-screen-source.json", {"screenId": "screen-source", "cursorIds": ["cursor-source", "cursor-writer"]})
    _write_json(root / "replay" / "overlay-screen-preview.json", {"screenId": "screen-preview", "cursorIds": ["cursor-preview"]})
    replay_ref = _write_json(root / "replay" / "manifest.json", replay)
    current_bundle = {
        "schemaVersion": "sciforge.computer-use.current-bundle.v1",
        "runId": run_id,
        "rootRef": str(root),
        "refs": [
            cursor_event_log_ref,
            executor_event_log_ref,
            replay_ref,
            browser_observation["observationRef"],
            *[screen["beforeCaptureRef"] for screen in screens],
            *[screen["afterCaptureRef"] for screen in screens],
        ],
    }
    current_bundle_ref = _write_json(root / "current-bundle.json", current_bundle)
    manifest = {
        "schemaVersion": NATIVE_MULTI_SCREEN_DEMO_SCHEMA,
        "runId": run_id,
        "backendKind": "native-multi-screen-sidecar",
        "productGate": "native-multi-screen-multi-actor-cursor",
        "dockerNovncRequired": False,
        "displayGroupId": display_group_id,
        "screens": screens,
        "actorCursors": actor_cursors,
        "cursorEvents": cursor_events,
        "cursorEventLogRef": cursor_event_log_ref,
        "proposals": proposals,
        "leaseQueues": lease_queues,
        "executorEvents": executor_events,
        "executorEventLogRef": executor_event_log_ref,
        "browserRuntimeObservation": browser_observation,
        "replay": {**replay, "replayRef": replay_ref},
        "currentBundleRef": current_bundle_ref,
        "currentBundle": current_bundle,
        "platformSidecar": {
            "backendKind": "native-multi-screen-sidecar",
            "l0Only": True,
            "captureStateInputPreflightOnly": True,
            "planning": False,
            "completion": False,
            "artifactValidation": False,
        },
        "observedAt": observed,
    }
    manifest_ref = _write_json(root / "native-multi-screen-demo-manifest.json", manifest)
    manifest["manifestRef"] = manifest_ref
    _write_json(root / "native-multi-screen-demo-manifest.json", manifest)
    return manifest


def validate_native_multi_screen_demo_bundle(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    try:
        manifest = _load_mapping(manifest_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result([_issue("payload_load_failed", f"Native multi-screen demo bundle could not be loaded: {exc}.", "$")], [])

    errors: list[dict[str, Any]] = []
    refs = _collect_refs(manifest)
    if manifest.get("schemaVersion") != NATIVE_MULTI_SCREEN_DEMO_SCHEMA:
        errors.append(_issue("unsupported_schema_version", "Native multi-screen demo schemaVersion is invalid.", "$.schemaVersion"))
    _reject_forbidden_markers(manifest.get("backendKind"), "$.backendKind", errors)
    _reject_forbidden_markers(manifest.get("productGate"), "$.productGate", errors)
    screens = _mapping_list(manifest.get("screens"))
    screen_ids = {_string(screen.get("screenId")) for screen in screens if _string(screen.get("screenId"))}
    if len(screen_ids) < 2:
        errors.append(_issue("multi_screen_required", "Native demo evidence must include at least two screens.", "$.screens"))
    actor_cursors = _mapping_list(manifest.get("actorCursors"))
    actor_ids = {_string(cursor.get("actorId")) for cursor in actor_cursors if _string(cursor.get("actorId"))}
    cursor_ids = {_string(cursor.get("cursorId")) for cursor in actor_cursors if _string(cursor.get("cursorId"))}
    if len(actor_ids) < 3 or len(cursor_ids) < 3:
        errors.append(_issue("multi_actor_cursor_required", "Native demo evidence must include at least three actor cursors.", "$.actorCursors"))
    _validate_read_only_cursor_events(_mapping_list(manifest.get("cursorEvents")), errors)
    _validate_proposals(_mapping_list(manifest.get("proposals")), errors)
    _validate_lease_queues(_mapping_list(manifest.get("leaseQueues")), errors)
    _validate_executor_events(_mapping_list(manifest.get("executorEvents")), errors)
    _validate_replay(_mapping(manifest.get("replay")), screen_ids, errors)
    _validate_current_bundle(_mapping(manifest.get("currentBundle")), refs, errors)
    _validate_platform_sidecar(_mapping(manifest.get("platformSidecar")), errors)
    root = _bundle_root(manifest)
    browser_observation = _mapping(manifest.get("browserRuntimeObservation"))
    if not browser_observation:
        errors.append(_issue("browser_runtime_observation_missing", "DOM/AX observation hint is required for DOM-aware native smoke.", "$.browserRuntimeObservation"))
    else:
        browser_validation = validate_browser_runtime_dom_ax_observation(browser_observation, bundle_root=root)
        if not browser_validation["ok"]:
            errors.append(_issue("browser_runtime_observation_invalid", "BrowserRuntime DOM/AX observation must be refs-first hints only.", "$.browserRuntimeObservation", details=browser_validation["errors"]))
    if require_existing_refs:
        for ref in refs:
            if _looks_like_path(ref) and not Path(ref).exists():
                errors.append(_issue("ref_missing", f"Referenced file does not exist: {ref}", "$.refs"))
            if root and _looks_like_path(ref) and not _is_under(Path(ref), root):
                errors.append(_issue("ref_outside_current_bundle", f"Reference is outside current bundle root: {ref}", "$.currentBundle.refs"))
    return _validation_result(errors, refs)


def _cursor_event(
    event_id: str,
    event_type: str,
    cursor: Mapping[str, Any],
    display_group_id: str,
    observed_at: str,
    **extra: Any,
) -> dict[str, Any]:
    read_only = event_type in _READ_ONLY_CURSOR_EVENTS
    return {
        "eventId": event_id,
        "eventType": event_type,
        "displayGroupId": display_group_id,
        "screenId": cursor["screenId"],
        "windowId": cursor["windowId"],
        "actorId": cursor["actorId"],
        "cursorId": cursor["cursorId"],
        "readOnlyCursorEvent": read_only,
        "mutatingGuiAction": False,
        "observedAt": observed_at,
        **extra,
    }


def _validate_read_only_cursor_events(events: list[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    event_types = {_string(event.get("eventType")) for event in events if _string(event.get("eventType"))}
    missing = _READ_ONLY_CURSOR_EVENTS - event_types
    if missing:
        errors.append(_issue("read_only_cursor_events_missing", f"Missing read-only cursor event types: {sorted(missing)}.", "$.cursorEvents"))
    for index, event in enumerate(events):
        if event.get("eventType") in _READ_ONLY_CURSOR_EVENTS:
            if event.get("readOnlyCursorEvent") is not True or event.get("mutatingGuiAction") is not False:
                errors.append(_issue("cursor_event_not_read_only", "move/point/annotate cursor events must be read-only.", f"$.cursorEvents[{index}]"))
            if _string(event.get("executorEventRef")):
                errors.append(_issue("cursor_event_executor_projection_forbidden", "Read-only cursor events must not project into executor events.", f"$.cursorEvents[{index}].executorEventRef"))


def _validate_proposals(proposals: list[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    scopes = [_mapping(proposal.get("leaseScope")) for proposal in proposals]
    window_local = [scope for scope in scopes if scope.get("kind") == "window-local"]
    screen_global = [scope for scope in scopes if scope.get("kind") == "screen-global"]
    if not window_local:
        errors.append(_issue("window_local_proposal_missing", "At least one window-local proposal is required.", "$.proposals"))
    if not screen_global:
        errors.append(_issue("screen_global_proposal_missing", "At least one screen-global proposal is required.", "$.proposals"))
    same_screen_windows = {}
    for scope in window_local:
        same_screen_windows.setdefault(_string(scope.get("screenId")), set()).add(_string(scope.get("windowId")))
    if not any(screen and len({window for window in windows if window}) >= 2 for screen, windows in same_screen_windows.items()):
        errors.append(_issue("same_screen_window_local_queue_missing", "Native demo must show multiple same-screen window-local proposals queued by the serial executor lane.", "$.proposals"))


def _validate_lease_queues(queues: list[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    has_window_queue = False
    has_screen_queue = False
    for index, queue in enumerate(queues):
        if queue.get("schedulerPolicy") != "native-screen-serial" or queue.get("serialExecutorLease") is not True:
            errors.append(_issue("serial_executor_lease_required", "Lease queues must use native-screen-serial executor policy.", f"$.leaseQueues[{index}]"))
        has_window_queue = has_window_queue or queue.get("scopeKind") == "window-local"
        has_screen_queue = has_screen_queue or queue.get("scopeKind") == "screen-global"
    if not has_window_queue:
        errors.append(_issue("window_local_queue_missing", "A window-local queue is required.", "$.leaseQueues"))
    if not has_screen_queue:
        errors.append(_issue("screen_global_queue_missing", "A screen-global queue is required.", "$.leaseQueues"))


def _validate_executor_events(events: list[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    if not events:
        errors.append(_issue("executor_events_missing", "At least one executor event is required.", "$.executorEvents"))
    for index, event in enumerate(events):
        for key in ("leaseId", "proposalId", "beforeEvidenceRefs", "afterEvidenceRefs"):
            if key.endswith("Refs"):
                if not event.get(key):
                    errors.append(_issue("executor_evidence_refs_missing", f"{key} is required.", f"$.executorEvents[{index}].{key}"))
            elif not _string(event.get(key)):
                errors.append(_issue("executor_event_field_missing", f"{key} is required.", f"$.executorEvents[{index}].{key}"))
        if event.get("executorLeaseAcquired") is not True:
            errors.append(_issue("executor_lease_missing", "Executor events must bind a scoped lease.", f"$.executorEvents[{index}].executorLeaseAcquired"))


def _validate_replay(replay: Mapping[str, Any], screen_ids: set[str | None], errors: list[dict[str, Any]]) -> None:
    frames = _mapping_list(replay.get("frames"))
    frame_screens = {_string(frame.get("screenId")) for frame in frames if _string(frame.get("screenId"))}
    if not screen_ids.issubset(frame_screens):
        errors.append(_issue("replay_frames_missing_screen", "Replay frames must cover every screen.", "$.replay.frames"))
    overlay_refs = [ref for ref in replay.get("overlayRefs", []) if isinstance(ref, str)] if isinstance(replay.get("overlayRefs"), list) else []
    if len(overlay_refs) < len(screen_ids):
        errors.append(_issue("replay_overlay_refs_missing", "Replay overlay refs must cover every screen.", "$.replay.overlayRefs"))
    if any("placeholder" in ref.lower() or "todo" in ref.lower() for ref in overlay_refs):
        errors.append(_issue("placeholder_replay_ref_forbidden", "Replay overlay refs must be real current-bundle refs.", "$.replay.overlayRefs"))


def _validate_current_bundle(bundle: Mapping[str, Any], refs: list[str], errors: list[dict[str, Any]]) -> None:
    if bundle.get("schemaVersion") != "sciforge.computer-use.current-bundle.v1":
        errors.append(_issue("current_bundle_missing", "Current bundle metadata is required.", "$.currentBundle"))
    bundle_refs = [ref for ref in bundle.get("refs", []) if isinstance(ref, str)] if isinstance(bundle.get("refs"), list) else []
    if not bundle_refs:
        errors.append(_issue("current_bundle_refs_missing", "Current bundle refs are required.", "$.currentBundle.refs"))
    for required_key in ("cursorEventLogRef", "executorEventLogRef", "currentBundleRef"):
        required_ref = next((ref for ref in refs if required_key.replace("Ref", "").replace("Log", "-").lower() in ref.lower()), None)
        if required_ref and required_ref not in bundle_refs and required_key != "currentBundleRef":
            errors.append(_issue("current_bundle_ref_missing", f"{required_key} must be included in current bundle refs.", "$.currentBundle.refs"))


def _validate_platform_sidecar(sidecar: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    _reject_forbidden_markers(sidecar.get("backendKind"), "$.platformSidecar.backendKind", errors)
    if sidecar.get("l0Only") is not True or sidecar.get("captureStateInputPreflightOnly") is not True:
        errors.append(_issue("platform_sidecar_l0_only_required", "Platform sidecar must be limited to L0 capture/state/input/preflight.", "$.platformSidecar"))
    for key in ("planning", "completion", "artifactValidation"):
        if sidecar.get(key) is not False:
            errors.append(_issue("platform_sidecar_boundary_invalid", f"platformSidecar.{key} must be false.", f"$.platformSidecar.{key}"))


def _reject_forbidden_markers(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    text = str(value or "").lower()
    marker = next((item for item in _FORBIDDEN_BACKEND_MARKERS if item in text), None)
    if marker:
        errors.append(_issue("legacy_docker_novnc_backend_forbidden", f"Legacy Docker/noVNC/RDP backend marker is not allowed in native product gate: {marker}.", path))


def _write_json(path: Path, payload: Mapping[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")
    return str(path)


def _write_jsonl(path: Path, records: list[Mapping[str, Any]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{json.dumps(record, sort_keys=True)}\n" for record in records), encoding="utf8")
    return str(path)


def _load_mapping(value: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return copy.deepcopy(dict(value))
    parsed = json.loads(Path(value).read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("payload root is not an object")
    return parsed


def _collect_refs(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            if str(key).lower().endswith("ref") and isinstance(item, str) and item.strip():
                refs.append(item.strip())
            elif str(key).lower().endswith("refs") and isinstance(item, list):
                refs.extend(entry.strip() for entry in item if isinstance(entry, str) and entry.strip())
            else:
                refs.extend(_collect_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.extend(_collect_refs(item))
    return sorted(set(refs))


def _validation_result(errors: list[dict[str, Any]], refs: list[str]) -> dict[str, Any]:
    return {
        "schemaVersion": NATIVE_MULTI_SCREEN_DEMO_VALIDATION_SCHEMA,
        "ok": not errors,
        "status": "accepted" if not errors else "blocked",
        "errors": errors,
        "errorCount": len(errors),
        "refs": refs,
        "dockerNovncRequired": False,
    }


def _issue(code: str, message: str, path: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path, **extra}


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _mapping_list(value: Any) -> list[Mapping[str, Any]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _looks_like_path(ref: str) -> bool:
    return ref.startswith("/") or ref.startswith(".") or "/" in ref


def _bundle_root(manifest: Mapping[str, Any]) -> Path | None:
    bundle = _mapping(manifest.get("currentBundle"))
    root_ref = _string(bundle.get("rootRef"))
    return Path(root_ref).resolve() if root_ref else None


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root)
        return True
    except ValueError:
        return False


__all__ = [
    "NATIVE_MULTI_SCREEN_DEMO_SCHEMA",
    "NATIVE_MULTI_SCREEN_DEMO_VALIDATION_SCHEMA",
    "build_native_multi_screen_demo_bundle",
    "validate_native_multi_screen_demo_bundle",
]
