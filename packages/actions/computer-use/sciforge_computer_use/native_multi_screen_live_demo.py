"""Opt-in native multi-screen / multi-actor live demo runner.

The runner is deliberately stricter than the package-local evidence harness:
it only marks a run completed when a real native sidecar returns completed,
non-diagnostic preflight/capture/state/execute calls. The bundled diagnostic
sidecar writes refs-first blocked evidence instead of pretending to be live.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .platform_sidecar import PLATFORM_SIDECAR_RESULT_SCHEMA, dispatch_platform_sidecar_tool


NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA = "sciforge.computer-use.native-multi-screen-live-demo-run.v1"
NATIVE_MULTI_SCREEN_LIVE_DEMO_VALIDATION_SCHEMA = "sciforge.computer-use.native-multi-screen-live-demo-validation.v1"
NATIVE_MULTI_SCREEN_EVIDENCE_INDEX_SCHEMA = "sciforge.computer-use.native-multi-screen-evidence-index.v1"
NATIVE_MULTI_SCREEN_RETENTION_REDACTION_SCHEMA = "sciforge.computer-use.native-multi-screen-retention-redaction.v1"
NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA = "sciforge.computer-use.native-multi-screen-sidecar-binding.v1"
NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA = "sciforge.computer-use.native-sidecar-dispatch-call.v1"
NATIVE_SIDECAR_CAPABILITIES_SCHEMA = "sciforge.computer-use.native-sidecar-capabilities.v1"
NATIVE_SIDECAR_DISCOVERY_SCHEMA = "sciforge.computer-use.native-sidecar-discovery.v1"

SidecarDispatcher = Callable[..., dict[str, Any]]
_FORBIDDEN_BACKEND_MARKERS = ("docker", "novnc", "vnc", "rdp", "container")
_FORBIDDEN_EVIDENCE_FIELD_NAMES = {
    "base64",
    "imagebase64",
    "inlineimage",
    "inlineimagepayload",
    "providerrawpayload",
    "rawimage",
    "rawpayload",
    "rawproviderpayload",
    "rawscreenshot",
    "rawscreenshotdata",
    "rawtrace",
    "rawtracedump",
    "screenshotbase64",
    "screenshotdataurl",
}
_SENSITIVE_EVIDENCE_FIELD_NAMES = {
    "accesstoken",
    "apikey",
    "authorization",
    "credential",
    "password",
    "refreshtoken",
    "secret",
    "token",
}
_WINDOW_TITLE_OWNER_FIELD_NAMES = {
    "appowner",
    "applicationowner",
    "owner",
    "ownername",
    "processtitle",
    "title",
    "windowowner",
    "windowtitle",
}
_FORBIDDEN_EVIDENCE_VALUE_MARKERS = (
    "data:image/",
    ";base64,",
    "authorization:",
    "password=",
    "secret=",
    "token=",
)


def run_native_multi_screen_live_demo(
    output_dir: str | Path,
    *,
    run_id: str = "native-multi-screen-live-run",
    observed_at: str | None = None,
    platform: str | None = None,
    sidecar_dispatcher: SidecarDispatcher | None = None,
    sidecar_command: Sequence[str] | str | None = None,
    sidecar_timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Attempt the M6 live demo and write accepted blocked/completed evidence."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    observed = observed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if sidecar_dispatcher is not None and sidecar_command is not None:
        raise ValueError("sidecar_dispatcher and sidecar_command are mutually exclusive")
    dispatcher = (
        sidecar_dispatcher
        or (make_native_sidecar_command_dispatcher(sidecar_command, timeout_seconds=sidecar_timeout_seconds) if sidecar_command else dispatch_platform_sidecar_tool)
    )
    display_group_id = f"{run_id}-display-group"
    sidecar_binding = _sidecar_binding_record(
        run_id,
        sidecar_command=sidecar_command,
        custom_dispatcher=sidecar_dispatcher is not None,
        timeout_seconds=sidecar_timeout_seconds,
    )
    sidecar_binding_ref = _bundle_local_ref(_write_json(root / "sidecar-binding.json", sidecar_binding), root)
    sidecar_dir = root / "sidecar"
    calls: list[dict[str, Any]] = []
    sidecar_capabilities, sidecar_capabilities_ref, sidecar_discovery, sidecar_discovery_ref = _collect_sidecar_capabilities_and_discovery(
        dispatcher,
        root,
        sidecar_dir,
        platform,
        run_id=run_id,
        display_group_id=display_group_id,
        sidecar_binding_ref=sidecar_binding_ref,
        observed=observed,
        calls=calls,
    )
    screens = _screens_from_discovery(sidecar_discovery, run_id, display_group_id)
    actor_cursors = _actor_cursors_from_discovery(sidecar_discovery, run_id, display_group_id, screens)
    user_control_refs = _localize_bundle_refs(_write_user_control_refs(root, run_id, display_group_id, screens, actor_cursors), root)
    allowlisted_window_refs = set(_discovery_window_refs_for_screen(actor_cursors, None))

    preflight_refs: dict[str, str] = {}
    for screen in screens:
        allowed_windows = [
            window_ref
            for window_ref in _discovery_window_refs_for_screen(actor_cursors, str(screen["screenId"]))
            if window_ref in allowlisted_window_refs
        ]
        payload = {
            "displayGroupId": display_group_id,
            "screenId": screen["screenId"],
            "sessionPermissionRef": user_control_refs["sessionPermissionRef"],
            "appWindowAllowlistRef": user_control_refs["appWindowAllowlistRef"],
            "allowedWindowRefs": allowed_windows,
            "riskPreviewRef": user_control_refs["riskPreviewRef"],
            "dataVisibilityRef": user_control_refs["dataVisibilityRef"],
            "stopRef": user_control_refs["stopRef"],
            "inputModalityPolicy": {
                "allowed": ["pointer", "keyboard", "scroll", "hotkey"],
                "sharedSystemInputAllowed": False,
            },
            "backendKind": "native-multi-screen-sidecar",
            "sidecarBindingRef": sidecar_binding_ref,
            "metadata": {"runId": run_id, "observedAt": observed},
        }
        call = _sidecar_call(dispatcher, "preflight", payload, root, sidecar_dir, platform)
        calls.append(call)
        preflight_refs[screen["screenId"]] = _value_ref(call["result"], "permissionPreflightRef") or call["resultRef"]

    capture_refs: dict[str, str] = {}
    capture_frame_refs: dict[str, str] = {}
    state_refs: dict[str, str] = {}
    for screen in screens:
        capture_payload = {
            "displayGroupId": display_group_id,
            "screenId": screen["screenId"],
            "permissionPreflightRef": preflight_refs[screen["screenId"]],
            "sidecarBindingRef": sidecar_binding_ref,
            "captureKind": "screen",
            "metadata": {"runId": run_id, "phase": "before"},
        }
        capture_call = _sidecar_call(dispatcher, "capture", capture_payload, root, sidecar_dir, platform)
        calls.append(capture_call)
        capture_refs[screen["screenId"]] = _value_ref(capture_call["result"], "captureRef") or _first_ref(capture_call["result"]) or capture_call["resultRef"]
        capture_frame_refs[screen["screenId"]] = _capture_screenshot_ref(capture_call["result"], capture_refs[screen["screenId"]], root) or capture_refs[screen["screenId"]]

        state_payload = {
            "displayGroupId": display_group_id,
            "screenId": screen["screenId"],
            "permissionPreflightRef": preflight_refs[screen["screenId"]],
            "sidecarBindingRef": sidecar_binding_ref,
            "stateKind": "app-state",
            "metadata": {"runId": run_id, "phase": "before"},
        }
        state_call = _sidecar_call(dispatcher, "state", state_payload, root, sidecar_dir, platform)
        calls.append(state_call)
        state_refs[screen["screenId"]] = _value_ref(state_call["result"], "stateRef") or _first_ref(state_call["result"]) or state_call["resultRef"]

    cursor_events = _write_cursor_events(root, run_id, actor_cursors, observed)

    proposals = [
        _proposal(f"{run_id}-proposal-source-copy", actor_cursors[0], "click", display_group_id, "window-local"),
        _proposal(f"{run_id}-proposal-writer-type", actor_cursors[1], "type_text", display_group_id, "window-local"),
        _proposal(f"{run_id}-proposal-preview-refresh", actor_cursors[2], "hotkey", display_group_id, "screen-global"),
    ]
    proposal_refs: dict[str, str] = {}
    for proposal in proposals:
        proposal_ref = _bundle_local_ref(_write_json(root / "proposals" / f"{proposal['proposalId']}.json", proposal), root)
        proposal["proposalRef"] = proposal_ref
        proposal_refs[str(proposal["proposalId"])] = proposal_ref
    lease_queues = [
        {
            "queueId": f"{run_id}-queue-source-window-local",
            "screenId": screens[0]["screenId"],
            "scopeKind": "window-local",
            "schedulerPolicy": "native-screen-serial",
            "serialExecutorLease": True,
            "proposalIds": [proposals[0]["proposalId"], proposals[1]["proposalId"]],
            "decisionStatuses": ["ready", "queued"],
        },
        {
            "queueId": f"{run_id}-queue-preview-screen-global",
            "screenId": screens[1]["screenId"],
            "scopeKind": "screen-global",
            "schedulerPolicy": "native-screen-serial",
            "serialExecutorLease": True,
            "proposalIds": [proposals[2]["proposalId"]],
            "decisionStatuses": ["ready"],
        },
    ]

    executor_event_refs: list[str] = []
    scheduler_lease_refs: list[str] = []
    target_refs: list[str] = []
    for index, proposal in enumerate(proposals):
        scope = _mapping(proposal["leaseScope"])
        screen_id = str(scope["screenId"])
        cursor = actor_cursors[index]
        action_kind = str(proposal["actionType"])
        target_record = _target_record_for_scope(
            run_id,
            index + 1,
            display_group_id,
            scope,
            screens,
            sidecar_discovery,
            sidecar_discovery_ref,
            state_refs[screen_id],
            capture_refs[screen_id],
        )
        target_ref = _bundle_local_ref(_write_json(root / "targets" / f"target-{index + 1}.json", target_record), root)
        target_refs.append(target_ref)
        scheduler_lease_ref = _bundle_local_ref(_write_json(root / "leases" / f"lease-{index + 1}.json", {
            "schemaVersion": "sciforge.computer-use.scheduler-lease.v1",
            "displayGroupId": display_group_id,
            "screenId": screen_id,
            "windowId": scope.get("windowId"),
            "leaseScope": scope,
            "leaseId": f"{run_id}-lease-{index + 1}",
            "proposalId": proposal["proposalId"],
            "proposalRef": proposal.get("proposalRef"),
            "actorId": cursor["actorId"],
            "cursorId": cursor["cursorId"],
            "observedAt": observed,
        }), root)
        scheduler_lease_refs.append(scheduler_lease_ref)
        execute_payload = {
            "displayGroupId": display_group_id,
            "screenId": screen_id,
            "windowId": scope.get("windowId"),
            "actorId": cursor["actorId"],
            "cursorId": cursor["cursorId"],
            "leaseId": f"{run_id}-lease-{index + 1}",
            "schedulerLeaseRef": scheduler_lease_ref,
            "leaseScope": scope,
            "permissionPreflightRef": preflight_refs[screen_id],
            "sidecarBindingRef": sidecar_binding_ref,
            "beforeEvidenceRefs": [capture_refs[screen_id], state_refs[screen_id]],
            "groundingRefs": [state_refs[screen_id], target_ref],
            "action": {"kind": action_kind},
            "actionKind": action_kind,
            "target": _target_from_record(target_record, target_ref),
            "metadata": {"runId": run_id, "proposalId": proposal["proposalId"]},
        }
        call = _sidecar_call(dispatcher, "execute", execute_payload, root, sidecar_dir, platform)
        calls.append(call)
        executor_event_refs.extend(_refs(call["result"]) or [call["resultRef"]])

    after_capture_refs: dict[str, str] = {}
    after_capture_frame_refs: dict[str, str] = {}
    after_state_refs: dict[str, str] = {}
    for screen in screens:
        capture_payload = {
            "displayGroupId": display_group_id,
            "screenId": screen["screenId"],
            "permissionPreflightRef": preflight_refs[screen["screenId"]],
            "sidecarBindingRef": sidecar_binding_ref,
            "captureKind": "screen",
            "metadata": {"runId": run_id, "phase": "after"},
        }
        capture_call = _sidecar_call(dispatcher, "capture", capture_payload, root, sidecar_dir, platform)
        calls.append(capture_call)
        after_capture_refs[screen["screenId"]] = _value_ref(capture_call["result"], "captureRef") or _first_ref(capture_call["result"]) or capture_call["resultRef"]
        after_capture_frame_refs[screen["screenId"]] = _capture_screenshot_ref(capture_call["result"], after_capture_refs[screen["screenId"]], root) or after_capture_refs[screen["screenId"]]

        state_payload = {
            "displayGroupId": display_group_id,
            "screenId": screen["screenId"],
            "permissionPreflightRef": preflight_refs[screen["screenId"]],
            "sidecarBindingRef": sidecar_binding_ref,
            "stateKind": "app-state",
            "metadata": {"runId": run_id, "phase": "after"},
        }
        state_call = _sidecar_call(dispatcher, "state", state_payload, root, sidecar_dir, platform)
        calls.append(state_call)
        after_state_refs[screen["screenId"]] = _value_ref(state_call["result"], "stateRef") or _first_ref(state_call["result"]) or state_call["resultRef"]

    discovery_supports_live = _capabilities_and_discovery_support_m6(sidecar_capabilities, sidecar_discovery, screens, actor_cursors)
    sidecar_binding_kind = _string(sidecar_binding.get("bindingKind")) or ""
    live_sidecar_completed = (
        sidecar_binding_kind == "external-command"
        and _all_sidecar_calls_completed(calls)
        and _all_sidecar_calls_from_native_command(calls)
        and discovery_supports_live
    )
    status = "completed" if live_sidecar_completed else "blocked"
    overlay_by_screen = {
        screens[0]["screenId"]: _bundle_local_ref(_write_json(root / "replay" / "overlay-source.json", {
            "screenId": screens[0]["screenId"],
            "cursorIds": [actor_cursors[0]["cursorId"], actor_cursors[1]["cursorId"]],
            "observedAt": observed,
        }), root),
        screens[1]["screenId"]: _bundle_local_ref(_write_json(root / "replay" / "overlay-preview.json", {
            "screenId": screens[1]["screenId"],
            "cursorIds": [actor_cursors[2]["cursorId"]],
            "observedAt": observed,
        }), root),
    }
    overlay_refs = list(overlay_by_screen.values())
    replay_bundle = {
        "schemaVersion": "sciforge.computer-use.native-multi-screen-live-replay.v1",
        "status": status,
        "displayGroupId": display_group_id,
        "frames": [
            {
                "screenId": screen["screenId"],
                "screenshotRef": after_capture_frame_refs.get(screen["screenId"], capture_frame_refs.get(screen["screenId"])),
                "beforeEvidenceRefs": [capture_refs.get(screen["screenId"]), state_refs.get(screen["screenId"])],
                "afterEvidenceRefs": [after_capture_refs.get(screen["screenId"]), after_capture_frame_refs.get(screen["screenId"]), after_state_refs.get(screen["screenId"])],
                "cursorOverlayRef": overlay_by_screen.get(screen["screenId"]),
                "leaseOwnerRefs": scheduler_lease_refs,
                "placeholder": False,
            }
            for screen in screens
        ],
        "overlayRefs": overlay_refs,
        "executorEventRefs": executor_event_refs,
        "cursorEventRefs": [event["cursorEventRef"] for event in cursor_events],
    }
    replay_ref = _bundle_local_ref(_write_json(root / "replay" / "manifest.json", replay_bundle), root)
    manifest_ref_path = _bundle_local_ref(root / "native-multi-screen-live-demo-run.json", root)
    validation_ref = _bundle_local_ref(root / "m6-live-demo-validation.json", root)
    current_bundle_ref_path = root / "current-bundle.json"
    current_bundle_ref_text = _bundle_local_ref(current_bundle_ref_path, root)
    evidence_index_ref_path = root / "evidence-index.json"
    evidence_index_ref_text = _bundle_local_ref(evidence_index_ref_path, root)
    current_refs = sorted(set(
        list(user_control_refs.values())
        + [sidecar_binding_ref]
        + ([sidecar_capabilities_ref] if sidecar_capabilities_ref else [])
        + ([sidecar_discovery_ref] if sidecar_discovery_ref else [])
        + [event["cursorEventRef"] for event in cursor_events]
        + list(proposal_refs.values())
        + scheduler_lease_refs
        + target_refs
        + [call["payloadRef"] for call in calls]
        + [call["resultRef"] for call in calls]
        + [ref for call in calls for ref in _refs(call["result"])]
        + list(capture_refs.values())
        + list(capture_frame_refs.values())
        + list(state_refs.values())
        + list(after_capture_refs.values())
        + list(after_capture_frame_refs.values())
        + list(after_state_refs.values())
        + executor_event_refs
        + overlay_refs
        + [replay_ref]
        + [manifest_ref_path, validation_ref, current_bundle_ref_text, evidence_index_ref_text]
    ))
    current_bundle_ref = _bundle_local_ref(_write_json(current_bundle_ref_path, {
        "schemaVersion": "sciforge.computer-use.current-bundle.v1",
        "runId": run_id,
        "rootRef": str(root),
        "refs": current_refs,
    }), root)
    evidence_index = _build_evidence_index(
        root=root,
        run_id=run_id,
        observed=observed,
        status=status,
        platform=platform,
        sidecar_binding=sidecar_binding,
        sidecar_binding_ref=sidecar_binding_ref,
        sidecar_capabilities_ref=sidecar_capabilities_ref,
        sidecar_discovery=sidecar_discovery,
        sidecar_discovery_ref=sidecar_discovery_ref,
        screens=screens,
        actor_cursors=actor_cursors,
        replay_bundle=replay_bundle,
        replay_ref=replay_ref,
        overlay_refs=overlay_refs,
        cursor_events=cursor_events,
        scheduler_lease_refs=scheduler_lease_refs,
        target_refs=target_refs,
        executor_event_refs=executor_event_refs,
        current_refs=current_refs,
        current_bundle_ref=current_bundle_ref,
        manifest_ref=manifest_ref_path,
        validation_ref=validation_ref,
        evidence_index_ref=evidence_index_ref_text,
    )
    evidence_index_ref = _bundle_local_ref(_write_json(evidence_index_ref_path, evidence_index), root)
    manifest = {
        "schemaVersion": NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA,
        "runId": run_id,
        "status": status,
        "completionEligible": live_sidecar_completed,
        "realNativeSidecarExecuted": live_sidecar_completed,
        "diagnosticOnly": not live_sidecar_completed,
        "packageHarnessOnly": False,
        "fixture": False,
        "dryRun": False,
        "dockerNovncRequired": False,
        "backendKind": "native-multi-screen-sidecar",
        "productGate": "multi-screen-live-demo",
        "sidecarBinding": sidecar_binding,
        "sidecarBindingRef": sidecar_binding_ref,
        "sidecarCapabilities": sidecar_capabilities,
        "sidecarCapabilitiesRef": sidecar_capabilities_ref,
        "sidecarDiscovery": sidecar_discovery,
        "sidecarDiscoveryRef": sidecar_discovery_ref,
        "displayGroupId": display_group_id,
        "screens": screens,
        "actorCursors": actor_cursors,
        "cursorEvents": cursor_events,
        "proposals": proposals,
        "leaseQueues": lease_queues,
        "schedulerLeaseRefs": scheduler_lease_refs,
        "targetRefs": target_refs,
        "sidecarCalls": calls,
        "preflightRefs": list(preflight_refs.values()),
        "captureRefs": list(capture_refs.values()),
        "stateRefs": list(state_refs.values()),
        "afterCaptureRefs": list(after_capture_refs.values()),
        "afterStateRefs": list(after_state_refs.values()),
        "executorEventRefs": executor_event_refs,
        "replayRef": replay_ref,
        "replayBundle": replay_bundle,
        "runSummary": _native_summary({
            "realNativeSidecarExecuted": live_sidecar_completed,
            "completionEligible": live_sidecar_completed,
            "screens": screens,
            "actorCursors": actor_cursors,
            "cursorEvents": cursor_events,
            "leaseQueues": lease_queues,
            "replayBundle": replay_bundle,
            "sidecarBinding": sidecar_binding,
        }),
        "overlayRefs": overlay_refs,
        "currentBundleRef": current_bundle_ref,
        "currentBundle": {"schemaVersion": "sciforge.computer-use.current-bundle.v1", "runId": run_id, "rootRef": str(root), "refs": current_refs},
        "evidenceIndexRef": evidence_index_ref,
        "evidenceIndex": evidence_index,
        "retentionRedaction": evidence_index["retentionRedaction"],
        "validationRef": validation_ref,
        "blockedReason": "" if live_sidecar_completed else _blocked_reason(calls, discovery_supports_live),
        "observedAt": observed,
    }
    manifest["manifestRef"] = manifest_ref_path
    manifest["runSummary"] = _native_summary(manifest)
    _write_json(root / "native-multi-screen-live-demo-run.json", manifest)
    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=False)
    _write_json(_resolve_bundle_ref(validation_ref, root), validation)
    return manifest


def make_native_sidecar_command_dispatcher(
    sidecar_command: Sequence[str] | str,
    *,
    timeout_seconds: float = 30.0,
) -> SidecarDispatcher:
    """Return a dispatcher that speaks the native sidecar stdin/stdout JSON protocol."""

    argv = _normalize_sidecar_command(sidecar_command)

    def _dispatch(
        tool: str,
        payload: Mapping[str, Any],
        *,
        output_dir: str | Path | None = None,
        platform: str | None = None,
    ) -> dict[str, Any]:
        output_path = Path(output_dir).expanduser().resolve() if output_dir else None
        if output_path:
            output_path.mkdir(parents=True, exist_ok=True)
        request = {
            "schemaVersion": NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA,
            "tool": tool,
            "payload": dict(payload),
            "outputDir": str(output_path) if output_path else None,
            "platform": platform,
        }
        try:
            completed = subprocess.run(
                argv,
                input=json.dumps(request, sort_keys=True),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return _sidecar_command_failed(tool, "native_sidecar_command_timeout", argv)
        except OSError as exc:
            return _sidecar_command_failed(tool, f"native_sidecar_command_os_error:{exc.__class__.__name__}", argv)
        if completed.returncode != 0:
            return _sidecar_command_failed(tool, f"native_sidecar_command_exit_{completed.returncode}", argv)
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return _sidecar_command_failed(tool, "native_sidecar_command_stdout_not_json", argv)
        if not isinstance(result, Mapping):
            return _sidecar_command_failed(tool, "native_sidecar_command_result_not_object", argv)
        return dict(result)

    return _dispatch


def validate_native_multi_screen_live_demo_run(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    try:
        manifest = _load_mapping(manifest_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result([_issue("payload_load_failed", f"Native multi-screen live demo run could not be loaded: {exc}.", "$")], [])

    errors: list[dict[str, Any]] = []
    refs = _collect_refs(manifest)
    _validate_no_forbidden_inline_evidence(manifest, "$", errors)
    if manifest.get("schemaVersion") != NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA:
        errors.append(_issue("unsupported_schema_version", "Native multi-screen live demo schemaVersion is invalid.", "$.schemaVersion"))
    status = manifest.get("status")
    if status not in {"blocked", "completed"}:
        errors.append(_issue("invalid_status", "status must be blocked or completed.", "$.status"))
    _reject_forbidden_markers(manifest.get("backendKind"), "$.backendKind", errors)
    if manifest.get("dockerNovncRequired") is not False:
        errors.append(_issue("docker_novnc_must_not_be_required", "M6 native live demo must not require Docker/noVNC.", "$.dockerNovncRequired"))
    screens = _mapping_list(manifest.get("screens"))
    screen_ids = {_string(screen.get("screenId")) for screen in screens if _string(screen.get("screenId"))}
    if len(screen_ids) < 2:
        errors.append(_issue("multi_screen_required", "M6 live demo requires at least two screens.", "$.screens"))
    actor_cursors = _mapping_list(manifest.get("actorCursors"))
    actor_ids = {_string(cursor.get("actorId")) for cursor in actor_cursors if _string(cursor.get("actorId"))}
    cursor_ids = {_string(cursor.get("cursorId")) for cursor in actor_cursors if _string(cursor.get("cursorId"))}
    cursor_screens = {_string(cursor.get("screenId")) for cursor in actor_cursors if _string(cursor.get("screenId"))}
    if len(actor_ids) < 3 or len(cursor_ids) < 3 or len(cursor_screens) < 2:
        errors.append(_issue("multi_actor_cursor_required", "M6 live demo requires at least three actor cursors spanning at least two screens.", "$.actorCursors"))
    _validate_cursor_events(_mapping_list(manifest.get("cursorEvents")), actor_ids, cursor_ids, screen_ids, errors)
    _validate_proposals_and_queues(_mapping_list(manifest.get("proposals")), _mapping_list(manifest.get("leaseQueues")), errors)
    _validate_sidecar_binding(_mapping(manifest.get("sidecarBinding")), _string(manifest.get("sidecarBindingRef")), status == "completed", errors)
    _validate_capabilities_and_discovery(
        _mapping(manifest.get("sidecarCapabilities")),
        _string(manifest.get("sidecarCapabilitiesRef")),
        _mapping(manifest.get("sidecarDiscovery")),
        _string(manifest.get("sidecarDiscoveryRef")),
        screen_ids,
        _mapping_list(manifest.get("actorCursors")),
        status == "completed",
        errors,
    )
    _validate_sidecar_calls(
        _mapping_list(manifest.get("sidecarCalls")),
        status == "completed",
        errors,
        _mapping(manifest.get("sidecarDiscovery")),
        _string(manifest.get("sidecarDiscoveryRef")),
        _mapping_list(manifest.get("actorCursors")),
        _string(_mapping(manifest.get("sidecarBinding")).get("bindingKind")) or "",
    )
    _validate_replay_bundle(_mapping(manifest.get("replayBundle")), screen_ids, status == "completed", errors)
    _validate_evidence_index(manifest, errors)
    if status == "completed":
        _validate_completed_live_manifest(manifest, errors)
    else:
        if manifest.get("completionEligible") is not False or manifest.get("realNativeSidecarExecuted") is not False:
            errors.append(_issue("blocked_run_cannot_claim_completion", "Blocked M6 evidence must not claim live completion.", "$.completionEligible"))
        if not _string(manifest.get("blockedReason")):
            errors.append(_issue("blocked_reason_missing", "Blocked M6 evidence must explain the missing live sidecar.", "$.blockedReason"))
    if require_existing_refs:
        root = _bundle_root(manifest)
        for ref in refs:
            is_file_ref = _looks_like_file_ref(ref)
            ref_path = _resolve_bundle_ref(ref, root) if root and is_file_ref else Path(ref)
            if is_file_ref and not ref_path.exists():
                errors.append(_issue("ref_missing", f"Referenced file does not exist: {ref}", "$.refs"))
            if root and is_file_ref and not _is_under(ref_path, root):
                errors.append(_issue("ref_outside_current_bundle", f"Reference is outside current bundle root: {ref}", "$.currentBundle.refs"))
            if is_file_ref and ref_path.is_file():
                _validate_referenced_json_ref(ref_path, root, errors)
    return _validation_result(errors, refs, _native_summary(manifest), manifest)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the opt-in native multi-screen Computer Use live demo.")
    parser.add_argument("--output-dir", required=True, help="Directory for refs-first live demo evidence.")
    parser.add_argument("--run-id", default="native-multi-screen-live-run")
    parser.add_argument("--platform", help="Override platform name for sidecar diagnostics.")
    parser.add_argument("--sidecar-command", help="External native sidecar command. The runner sends JSON on stdin and expects a platform-sidecar result JSON on stdout.")
    parser.add_argument("--sidecar-timeout-seconds", type=float, default=30.0)
    args = parser.parse_args(argv)
    manifest = run_native_multi_screen_live_demo(
        args.output_dir,
        run_id=args.run_id,
        platform=args.platform,
        sidecar_command=args.sidecar_command,
        sidecar_timeout_seconds=args.sidecar_timeout_seconds,
    )
    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)
    print(json.dumps({"manifest": manifest, "validation": validation}, sort_keys=True))
    return 0 if manifest.get("status") == "completed" and validation.get("ok") is True else 1


def _sidecar_call(
    dispatcher: SidecarDispatcher,
    tool: str,
    payload: Mapping[str, Any],
    root: Path,
    sidecar_dir: Path,
    platform: str | None,
) -> dict[str, Any]:
    payload_ref = _bundle_local_ref(_write_json(root / "sidecar-payloads" / f"{tool}-{_digest(payload)}.json", payload), root)
    try:
        result = dispatcher(tool, payload, output_dir=sidecar_dir, platform=platform)
    except TypeError:
        result = dispatcher(tool, payload)
    if not isinstance(result, Mapping):
        result = {"schemaVersion": PLATFORM_SIDECAR_RESULT_SCHEMA, "tool": tool, "status": "failed", "reason": "sidecar_dispatcher_returned_non_object", "refs": []}
    result = _mapping(_localize_bundle_refs(_redact_for_storage(result), root))
    result_ref = _bundle_local_ref(_write_json(root / "sidecar-results" / f"{tool}-{_digest(result)}.json", result), root)
    return {
        "tool": tool,
        "payload": dict(payload),
        "payloadRef": payload_ref,
        "resultRef": result_ref,
        "status": _string(result.get("status")) or "failed",
        "reason": _string(result.get("reason")) or "",
        "refs": _refs(result),
        "result": dict(result),
    }


def _sidecar_binding_record(
    run_id: str,
    *,
    sidecar_command: Sequence[str] | str | None,
    custom_dispatcher: bool,
    timeout_seconds: float,
) -> dict[str, Any]:
    if sidecar_command is not None:
        argv = _normalize_sidecar_command(sidecar_command)
        return {
            "schemaVersion": NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA,
            "runId": run_id,
            "bindingKind": "external-command",
            "executable": Path(argv[0]).name,
            "argvCount": len(argv),
            "commandDigest": _digest({"argv": argv}),
            "stdinSchema": NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA,
            "stdoutSchema": PLATFORM_SIDECAR_RESULT_SCHEMA,
            "timeoutSeconds": timeout_seconds,
            "dockerNovncRequired": False,
        }
    return {
        "schemaVersion": NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA,
        "runId": run_id,
        "bindingKind": "custom-dispatcher" if custom_dispatcher else "diagnostic-local",
        "stdinSchema": NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA,
        "stdoutSchema": PLATFORM_SIDECAR_RESULT_SCHEMA,
        "timeoutSeconds": timeout_seconds,
        "dockerNovncRequired": False,
    }


def _normalize_sidecar_command(sidecar_command: Sequence[str] | str) -> list[str]:
    argv = shlex.split(sidecar_command) if isinstance(sidecar_command, str) else [str(item) for item in sidecar_command]
    argv = [item for item in argv if item]
    if not argv:
        raise ValueError("sidecar_command must not be empty")
    marker = next((item for item in _FORBIDDEN_BACKEND_MARKERS if item in " ".join(argv).lower()), None)
    if marker:
        raise ValueError(f"sidecar_command must not use legacy backend marker: {marker}")
    return argv


def _sidecar_command_failed(tool: str, reason: str, argv: Sequence[str]) -> dict[str, Any]:
    return {
        "schemaVersion": PLATFORM_SIDECAR_RESULT_SCHEMA,
        "tool": tool,
        "status": "failed",
        "reason": reason,
        "refs": [],
        "value": {
            "bindingKind": "external-command",
            "executable": Path(argv[0]).name if argv else "",
            "commandDigest": _digest({"argv": list(argv)}),
        },
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
        "planningPerformed": False,
        "completionJudged": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
    }


def _collect_sidecar_capabilities_and_discovery(
    dispatcher: SidecarDispatcher,
    root: Path,
    sidecar_dir: Path,
    platform: str | None,
    *,
    run_id: str,
    display_group_id: str,
    sidecar_binding_ref: str,
    observed: str,
    calls: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None, dict[str, Any], str | None]:
    capabilities_payload = {
        "runId": run_id,
        "displayGroupId": display_group_id,
        "sidecarBindingRef": sidecar_binding_ref,
        "requiredTools": ["preflight", "capture", "state", "execute", "discover"],
        "requiredFeatures": ["multi-screen", "multi-actor-cursor", "window-local-lease", "screen-global-lease", "refs-first-evidence"],
        "metadata": {"observedAt": observed},
    }
    capability_call = _sidecar_call(dispatcher, "capabilities", capabilities_payload, root, sidecar_dir, platform)
    calls.append(capability_call)
    capability_ref = _value_ref(capability_call["result"], "capabilitiesRef") or _value_ref(capability_call["result"], "capabilityRef")
    capabilities = _mapping(_localize_bundle_refs(_redact_for_storage(_sidecar_value_record(capability_call["result"], capability_ref, "capabilities", root)), root))

    discovery_payload = {
        "runId": run_id,
        "displayGroupId": display_group_id,
        "sidecarBindingRef": sidecar_binding_ref,
        "capabilitiesRef": capability_ref,
        "discoveryKind": "display-group-screens-windows",
        "metadata": {"observedAt": observed},
    }
    discovery_call = _sidecar_call(dispatcher, "discover", discovery_payload, root, sidecar_dir, platform)
    calls.append(discovery_call)
    discovery_ref = _value_ref(discovery_call["result"], "discoveryRef")
    discovery = _mapping(_localize_bundle_refs(_redact_for_storage(_sidecar_value_record(discovery_call["result"], discovery_ref, "discovery", root)), root))
    return capabilities, capability_ref, discovery, discovery_ref


def _sidecar_value_record(result: Mapping[str, Any], ref: str | None, inline_key: str, root: Path) -> dict[str, Any]:
    if ref and _looks_like_path(ref):
        try:
            loaded = _mapping(json.loads(_resolve_bundle_ref(ref, root).read_text(encoding="utf8")))
            if loaded.get("schemaVersion"):
                return loaded
        except (OSError, json.JSONDecodeError):
            pass
    return _mapping(_mapping(result.get("value")).get(inline_key))


def _screens_from_discovery(discovery: Mapping[str, Any], run_id: str, display_group_id: str) -> list[dict[str, Any]]:
    screens: list[dict[str, Any]] = []
    for index, screen in enumerate(_mapping_list(discovery.get("screens")), start=1):
        screen_id = _string(screen.get("screenId")) or f"{run_id}-discovered-screen-{index}"
        bounds = _mapping(screen.get("bounds"))
        screens.append({
            "displayGroupId": _string(screen.get("displayGroupId")) or display_group_id,
            "screenId": screen_id,
            "screenRef": _string(screen.get("screenRef")),
            "bounds": {
                "x": _number(bounds.get("x"), 0),
                "y": _number(bounds.get("y"), 0),
                "width": max(1, _number(bounds.get("width"), 1)),
                "height": max(1, _number(bounds.get("height"), 1)),
            },
        })
    if len({screen["screenId"] for screen in screens}) >= 2:
        return screens
    return _default_screens(run_id, display_group_id)


def _actor_cursors_from_discovery(
    discovery: Mapping[str, Any],
    run_id: str,
    display_group_id: str,
    screens: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    screen_ids = [str(screen["screenId"]) for screen in screens]
    window_records_by_id = {
        _string(window.get("windowId")): window
        for window in _mapping_list(discovery.get("windows"))
        if _string(window.get("windowId"))
    }
    actor_plan: list[dict[str, Any]] = []
    for index, cursor in enumerate(_mapping_list(discovery.get("actorCursorPlan")), start=1):
        screen_id = _string(cursor.get("screenId"))
        if screen_id not in screen_ids:
            continue
        window_id = _string(cursor.get("windowId")) or f"{run_id}-window-{index}"
        window_record = _mapping(window_records_by_id.get(window_id))
        actor_plan.append({
            "actorId": _string(cursor.get("actorId")) or f"{run_id}-actor-{index}",
            "cursorId": _string(cursor.get("cursorId")) or f"{run_id}-cursor-{index}",
            "screenId": screen_id,
            "windowId": window_id,
            "windowRef": _string(cursor.get("windowRef")) or _string(window_record.get("windowRef")),
            "actorCursorRef": _string(cursor.get("actorCursorRef")),
        })
    if _actor_plan_satisfies_m6(actor_plan):
        return actor_plan

    windows = _mapping_list(discovery.get("windows"))
    grouped_windows: dict[str, list[Mapping[str, Any]]] = {}
    for window in windows:
        screen_id = _string(window.get("screenId"))
        if screen_id in screen_ids:
            grouped_windows.setdefault(screen_id, []).append(window)
    same_screen = next((screen_id for screen_id, items in grouped_windows.items() if len(items) >= 2), None)
    other_screen = next((screen_id for screen_id in screen_ids if screen_id != same_screen and grouped_windows.get(screen_id)), None)
    if same_screen and other_screen:
        selected = [grouped_windows[same_screen][0], grouped_windows[same_screen][1], grouped_windows[other_screen][0]]
        return [
            {
                "actorId": f"{run_id}-actor-{index}",
                "cursorId": f"{run_id}-cursor-{index}",
                "screenId": _string(window.get("screenId")),
                "windowId": _string(window.get("windowId")) or f"{run_id}-window-{index}",
                "windowRef": _string(window.get("windowRef")),
                "actorCursorRef": _string(window.get("windowRef")),
            }
            for index, window in enumerate(selected, start=1)
        ]
    return _default_actor_cursors(run_id, display_group_id, screens)


def _actor_plan_satisfies_m6(actor_plan: list[Mapping[str, Any]]) -> bool:
    if len({_string(cursor.get("actorId")) for cursor in actor_plan}) < 3:
        return False
    if len({_string(cursor.get("cursorId")) for cursor in actor_plan}) < 3:
        return False
    screen_counts: dict[str, int] = {}
    for cursor in actor_plan:
        screen_id = _string(cursor.get("screenId"))
        if screen_id:
            screen_counts[screen_id] = screen_counts.get(screen_id, 0) + 1
    return len(screen_counts) >= 2 and any(count >= 2 for count in screen_counts.values())


def _capabilities_and_discovery_support_m6(
    capabilities: Mapping[str, Any],
    discovery: Mapping[str, Any],
    screens: list[Mapping[str, Any]],
    actor_cursors: list[Mapping[str, Any]],
) -> bool:
    if capabilities.get("schemaVersion") != NATIVE_SIDECAR_CAPABILITIES_SCHEMA:
        return False
    if discovery.get("schemaVersion") != NATIVE_SIDECAR_DISCOVERY_SCHEMA:
        return False
    if capabilities.get("diagnosticOnly") is True or capabilities.get("dockerNovncRequired") is not False:
        return False
    features = set(string_array(capabilities.get("features")))
    if not {"multi-screen", "multi-actor-cursor", "window-local-lease", "screen-global-lease", "refs-first-evidence"}.issubset(features):
        return False
    tools = set(string_array(capabilities.get("tools")))
    if not {"capabilities", "discover", "preflight", "capture", "state", "execute"}.issubset(tools):
        return False
    discovered_screen_ids = {_string(screen.get("screenId")) for screen in _mapping_list(discovery.get("screens"))}
    if len(discovered_screen_ids) < 2:
        return False
    if any(_string(screen.get("screenId")) not in discovered_screen_ids for screen in screens):
        return False
    discovered_window_refs_by_id = {
        _string(window.get("windowId")): _string(window.get("windowRef"))
        for window in _mapping_list(discovery.get("windows"))
        if _string(window.get("windowId")) and _string(window.get("windowRef"))
    }
    if len(discovered_window_refs_by_id) < 3:
        return False
    discovered_actor_keys = {
        (_string(cursor.get("actorId")), _string(cursor.get("cursorId")), _string(cursor.get("screenId")), _string(cursor.get("windowId")))
        for cursor in _mapping_list(discovery.get("actorCursorPlan"))
        if _string(cursor.get("windowId")) in discovered_window_refs_by_id
    }
    if len(discovered_actor_keys) < 3:
        return False
    if any((_string(cursor.get("actorId")), _string(cursor.get("cursorId")), _string(cursor.get("screenId")), _string(cursor.get("windowId"))) not in discovered_actor_keys for cursor in actor_cursors):
        return False
    return _actor_plan_satisfies_m6(actor_cursors)


def _blocked_reason(calls: list[Mapping[str, Any]], discovery_supports_live: bool) -> str:
    if _all_sidecar_calls_completed(calls) and not discovery_supports_live:
        return "native-sidecar-capability-or-discovery-insufficient"
    return "real-native-multi-screen-sidecar-unavailable-or-diagnostic"


def _build_evidence_index(
    *,
    root: Path,
    run_id: str,
    observed: str,
    status: str,
    platform: str | None,
    sidecar_binding: Mapping[str, Any],
    sidecar_binding_ref: str,
    sidecar_capabilities_ref: str | None,
    sidecar_discovery: Mapping[str, Any],
    sidecar_discovery_ref: str | None,
    screens: list[Mapping[str, Any]],
    actor_cursors: list[Mapping[str, Any]],
    replay_bundle: Mapping[str, Any],
    replay_ref: str,
    overlay_refs: list[str],
    cursor_events: list[Mapping[str, Any]],
    scheduler_lease_refs: list[str],
    target_refs: list[str],
    executor_event_refs: list[str],
    current_refs: list[str],
    current_bundle_ref: str,
    manifest_ref: str,
    validation_ref: str,
    evidence_index_ref: str,
) -> dict[str, Any]:
    frame_refs = _replay_frame_screenshot_refs(replay_bundle)
    retention_redaction = _retention_redaction_metadata(
        root=root,
        screenshot_refs=frame_refs,
        window_refs=sorted(_discovery_window_refs(sidecar_discovery) | {
            ref
            for ref in (_string(cursor.get("windowRef")) or _string(cursor.get("windowId")) for cursor in actor_cursors)
            if ref
        }),
        title_owner_hashes=_window_title_owner_hashes(sidecar_discovery),
        cursor_refs=[event["cursorEventRef"] for event in cursor_events if _string(event.get("cursorEventRef"))] + overlay_refs,
        executor_event_refs=executor_event_refs,
        validation_ref=validation_ref,
    )
    critical_refs = sorted(set(
        [manifest_ref, current_bundle_ref, validation_ref, evidence_index_ref, replay_ref, sidecar_binding_ref]
        + ([sidecar_capabilities_ref] if sidecar_capabilities_ref else [])
        + ([sidecar_discovery_ref] if sidecar_discovery_ref else [])
        + frame_refs
        + overlay_refs
        + scheduler_lease_refs
        + target_refs
        + executor_event_refs
    ))
    return {
        "schemaVersion": NATIVE_MULTI_SCREEN_EVIDENCE_INDEX_SCHEMA,
        "runId": run_id,
        "observedAt": observed,
        "status": status,
        "platform": platform or sys.platform,
        "bundleLocal": True,
        "completionEvidenceSubstitute": False,
        "notCompletionEvidence": True,
        "sidecarBindingKind": _string(sidecar_binding.get("bindingKind")) or "unknown",
        "sidecarBindingRef": sidecar_binding_ref,
        "sidecarCapabilitiesRef": sidecar_capabilities_ref,
        "sidecarDiscoveryRef": sidecar_discovery_ref,
        "screenCount": len(screens),
        "actorCursorCount": len(actor_cursors),
        "manifestRef": manifest_ref,
        "currentBundleRef": current_bundle_ref,
        "validationRef": validation_ref,
        "evidenceIndexRef": evidence_index_ref,
        "replayRef": replay_ref,
        "frameRefs": frame_refs,
        "overlayRefs": overlay_refs,
        "cursorEventRefs": [event["cursorEventRef"] for event in cursor_events if _string(event.get("cursorEventRef"))],
        "schedulerLeaseRefs": scheduler_lease_refs,
        "targetRefs": target_refs,
        "executorEventRefs": executor_event_refs,
        "criticalRefs": critical_refs,
        "currentBundleRefsDigest": _hash_json(current_refs),
        "cleanup": {
            "cleanupUnit": "run-bundle",
            "bundleRootRef": ".",
            "cleanupStatus": "retained-current-run",
            "canDeleteWhenSuperseded": True,
            "replayValidationPreservedByRefs": True,
            "preserveRefs": sorted(set([current_bundle_ref, validation_ref, replay_ref, evidence_index_ref] + frame_refs)),
        },
        "retentionRedaction": retention_redaction,
    }


def _retention_redaction_metadata(
    *,
    root: Path,
    screenshot_refs: list[str],
    window_refs: list[str],
    title_owner_hashes: list[dict[str, str]],
    cursor_refs: list[str],
    executor_event_refs: list[str],
    validation_ref: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": NATIVE_MULTI_SCREEN_RETENTION_REDACTION_SCHEMA,
        "refsFirst": True,
        "bundleLocal": True,
        "rawInlineStored": False,
        "cleanupUnit": "run-bundle",
        "bundleRootRef": ".",
        "forbiddenInlineFields": sorted(_FORBIDDEN_EVIDENCE_FIELD_NAMES | _SENSITIVE_EVIDENCE_FIELD_NAMES),
        "screenshot": {
            "storage": "ref-and-hash-only",
            "refs": screenshot_refs,
            "refHashes": [_hash_text(ref) for ref in screenshot_refs],
            "contentHashes": [_file_hash(ref, root) for ref in screenshot_refs if _looks_like_path(ref) and _resolve_bundle_ref(ref, root).exists()],
            "rawInlineStored": False,
        },
        "window": {
            "storage": "ref-and-title-owner-hash-only",
            "refs": window_refs,
            "refHashes": [_hash_text(ref) for ref in window_refs],
            "titleOwnerHashes": title_owner_hashes,
            "rawTitleOwnerStored": False,
            "rawInlineStored": False,
        },
        "cursor": {
            "storage": "ref-only",
            "refs": sorted(set(cursor_refs)),
            "rawInlineStored": False,
        },
        "executor": {
            "storage": "ref-only",
            "refs": executor_event_refs,
            "rawInlineStored": False,
        },
        "validation": {
            "storage": "ref-only",
            "validationRef": validation_ref,
            "rawInlineStored": False,
        },
    }


def _window_title_owner_hashes(discovery: Mapping[str, Any]) -> list[dict[str, str]]:
    hashes: list[dict[str, str]] = []
    for window in _mapping_list(discovery.get("windows")):
        window_ref = _string(window.get("windowRef")) or _string(window.get("windowId")) or ""
        for key, value in window.items():
            normalized = _normalized_field_name(key)
            if normalized.endswith("hash") and any(normalized.startswith(prefix) for prefix in ("title", "windowtitle", "owner", "windowowner", "appowner", "applicationowner")):
                hash_value = _string(value)
                if hash_value:
                    hashes.append({"windowRefHash": _hash_text(window_ref), "field": str(key), "hash": hash_value})
    return hashes


def _default_screens(run_id: str, display_group_id: str) -> list[dict[str, Any]]:
    return [
        {
            "displayGroupId": display_group_id,
            "screenId": f"{run_id}-screen-source",
            "bounds": {"x": 0, "y": 0, "width": 1440, "height": 900},
        },
        {
            "displayGroupId": display_group_id,
            "screenId": f"{run_id}-screen-preview",
            "bounds": {"x": 1440, "y": 0, "width": 1280, "height": 800},
        },
    ]


def _default_actor_cursors(run_id: str, display_group_id: str, screens: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    screen_ids = [str(screen["screenId"]) for screen in screens]
    return [
        {"actorId": f"{run_id}-actor-1", "cursorId": f"{run_id}-cursor-1", "screenId": screen_ids[0], "windowId": f"{run_id}-window-1", "displayGroupId": display_group_id},
        {"actorId": f"{run_id}-actor-2", "cursorId": f"{run_id}-cursor-2", "screenId": screen_ids[0], "windowId": f"{run_id}-window-2", "displayGroupId": display_group_id},
        {"actorId": f"{run_id}-actor-3", "cursorId": f"{run_id}-cursor-3", "screenId": screen_ids[1], "windowId": f"{run_id}-window-3", "displayGroupId": display_group_id},
    ]


def _discovery_window_refs_for_screen(actor_cursors: list[Mapping[str, Any]], screen_id: str | None) -> list[str]:
    refs: list[str] = []
    for cursor in actor_cursors:
        if screen_id is not None and _string(cursor.get("screenId")) != screen_id:
            continue
        ref = _string(cursor.get("windowRef")) or _string(cursor.get("windowId"))
        if ref:
            refs.append(ref)
    return refs


def _write_cursor_events(root: Path, run_id: str, actor_cursors: list[Mapping[str, Any]], observed: str) -> list[dict[str, Any]]:
    event_specs = [
        ("move", actor_cursors[0], {"x": 96, "y": 96}),
        ("point", actor_cursors[1], {"x": 220, "y": 132}),
        ("annotate", actor_cursors[2], {"x": 64, "y": 72}),
    ]
    events: list[dict[str, Any]] = []
    for index, (event_type, cursor, position) in enumerate(event_specs, start=1):
        event_id = f"{run_id}-cursor-event-{index}-{event_type}"
        event = {
            "schemaVersion": "sciforge.computer-use.actor-cursor-event.v1",
            "eventId": event_id,
            "eventType": event_type,
            "actorId": cursor["actorId"],
            "cursorId": cursor["cursorId"],
            "screenId": cursor["screenId"],
            "windowId": cursor.get("windowId"),
            "position": position,
            "readOnly": True,
            "mutatingGuiAction": False,
            "executorEventRef": None,
            "observedAt": observed,
        }
        event_ref = _bundle_local_ref(_write_json(root / "cursor-events" / f"{event_id}.json", event), root)
        events.append({**event, "cursorEventRef": event_ref})
    return events


def _write_user_control_refs(
    root: Path,
    run_id: str,
    display_group_id: str,
    screens: list[Mapping[str, Any]],
    actor_cursors: list[Mapping[str, Any]],
) -> dict[str, str]:
    allowed_window_refs = _discovery_window_refs_for_screen(actor_cursors, None)
    return {
        "sessionPermissionRef": _write_json(root / "user-control" / "session-permission.json", {
            "schemaVersion": "sciforge.computer-use.session-permission.v1",
            "runId": run_id,
            "displayGroupId": display_group_id,
            "status": "granted-for-live-demo-attempt",
        }),
        "appWindowAllowlistRef": _write_json(root / "user-control" / "app-window-allowlist.json", {
            "schemaVersion": "sciforge.computer-use.app-window-allowlist.v1",
            "screenIds": [screen["screenId"] for screen in screens],
            "allowedWindowRefs": allowed_window_refs,
            "policy": "bounded-live-demo",
        }),
        "riskPreviewRef": _write_json(root / "user-control" / "risk-preview.json", {
            "schemaVersion": "sciforge.computer-use.risk-preview.v1",
            "riskLevel": "low",
            "mutatingActions": ["click", "type_text", "hotkey"],
        }),
        "dataVisibilityRef": _write_json(root / "user-control" / "data-visibility.json", {
            "schemaVersion": "sciforge.computer-use.data-visibility.v1",
            "visibleDataPolicy": "refs-first-current-bundle-only",
        }),
        "stopRef": _write_json(root / "user-control" / "stop-cancel.json", {
            "schemaVersion": "sciforge.computer-use.stop-cancel-lease.v1",
            "stopAvailable": True,
            "cancelLeaseAvailable": True,
        }),
    }


def _proposal(proposal_id: str, cursor: Mapping[str, Any], action_type: str, display_group_id: str, scope_kind: str) -> dict[str, Any]:
    lease_scope: dict[str, Any] = {
        "kind": scope_kind,
        "displayGroupId": display_group_id,
        "screenId": cursor["screenId"],
    }
    if scope_kind == "window-local":
        lease_scope["windowId"] = cursor["windowId"]
    return {
        "proposalId": proposal_id,
        "actorId": cursor["actorId"],
        "cursorId": cursor["cursorId"],
        "actionType": action_type,
        "leaseScope": lease_scope,
    }


def _target_record_for_scope(
    run_id: str,
    index: int,
    display_group_id: str,
    scope: Mapping[str, Any],
    screens: list[Mapping[str, Any]],
    discovery: Mapping[str, Any],
    discovery_ref: str | None,
    state_ref: str,
    capture_ref: str,
) -> dict[str, Any]:
    screen_id = _string(scope.get("screenId")) or ""
    window_id = _string(scope.get("windowId"))
    screen = next((item for item in screens if _string(item.get("screenId")) == screen_id), {})
    window = next((
        item
        for item in _mapping_list(discovery.get("windows"))
        if window_id and _string(item.get("windowId")) == window_id
    ), {})
    source_bounds = _mapping(window.get("bounds")) or _mapping(screen.get("bounds"))
    target_scope = "screen" if scope.get("kind") == "screen-global" else "window"
    return {
        "schemaVersion": "sciforge.computer-use.discovery-backed-action-target.v1",
        "targetId": f"{run_id}-target-{index}",
        "targetSource": "native-sidecar-discovery-state",
        "displayGroupId": display_group_id,
        "screenId": screen_id,
        "windowId": window_id,
        "windowRef": _string(window.get("windowRef")),
        "screenRef": _string(screen.get("screenRef")),
        "scope": target_scope,
        "leaseScope": dict(scope),
        "bounds": _inset_bounds(source_bounds),
        "discoveryRef": discovery_ref,
        "stateRef": state_ref,
        "captureRef": capture_ref,
        "regionRef": f"region:{run_id}-target-{index}",
        "refsFirst": True,
        "currentBundleOnly": True,
    }


def _target_from_record(target_record: Mapping[str, Any], target_ref: str) -> dict[str, Any]:
    target = {
        "scope": target_record.get("scope"),
        "screenId": target_record.get("screenId"),
        "bounds": dict(_mapping(target_record.get("bounds"))),
        "targetRef": target_ref,
        "regionRef": target_record.get("regionRef"),
        "discoveryRef": target_record.get("discoveryRef"),
        "stateRef": target_record.get("stateRef"),
        "targetSource": target_record.get("targetSource"),
    }
    for key in ("windowId", "windowRef", "screenRef"):
        if target_record.get(key):
            target[key] = target_record.get(key)
    return target


def _inset_bounds(bounds: Mapping[str, Any]) -> dict[str, int]:
    x = _number(bounds.get("x"), 0)
    y = _number(bounds.get("y"), 0)
    width = max(1, _number(bounds.get("width"), 1))
    height = max(1, _number(bounds.get("height"), 1))
    inset_x = max(1, width // 20)
    inset_y = max(1, height // 20)
    return {
        "x": x + inset_x,
        "y": y + inset_y,
        "width": max(1, min(width - inset_x, max(1, width // 5))),
        "height": max(1, min(height - inset_y, max(1, height // 8))),
    }


def _all_sidecar_calls_completed(calls: list[Mapping[str, Any]]) -> bool:
    if not calls:
        return False
    for call in calls:
        result = _mapping(call.get("result"))
        if call.get("status") != "completed":
            return False
        if result.get("diagnosticOnly") is not False or result.get("userAcceptanceEligible") is not True:
            return False
        for key in ("sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent", "planningPerformed", "completionJudged", "rawPayloadWritten", "inlineImageWritten", "secretsWritten"):
            if result.get(key) is not False:
                return False
    return True


def _all_sidecar_calls_from_native_command(calls: list[Mapping[str, Any]]) -> bool:
    return bool(calls) and all(_mapping(call.get("result")).get("nativeSidecarCommandExecuted") is True for call in calls)


def _validate_proposals_and_queues(proposals: list[Mapping[str, Any]], queues: list[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    scopes = [_mapping(proposal.get("leaseScope")) for proposal in proposals]
    same_screen_window_local: dict[str, set[str]] = {}
    has_screen_global = False
    for scope in scopes:
        if scope.get("kind") == "screen-global":
            has_screen_global = True
        if scope.get("kind") == "window-local":
            same_screen_window_local.setdefault(str(scope.get("screenId") or ""), set()).add(str(scope.get("windowId") or ""))
    if not any(screen and len({window for window in windows if window}) >= 2 for screen, windows in same_screen_window_local.items()):
        errors.append(_issue("same_screen_multi_actor_window_queue_missing", "M6 requires two same-screen actor proposals queued by a serial window-local lane.", "$.proposals"))
    if not has_screen_global:
        errors.append(_issue("screen_global_proposal_missing", "M6 requires a screen-global proposal/queue.", "$.proposals"))
    if not any(queue.get("scopeKind") == "window-local" and queue.get("schedulerPolicy") == "native-screen-serial" and len(queue.get("proposalIds") or []) >= 2 for queue in queues):
        errors.append(_issue("serial_window_queue_missing", "M6 requires a native-screen-serial window-local queue.", "$.leaseQueues"))
    if not any(queue.get("scopeKind") == "screen-global" and queue.get("schedulerPolicy") == "native-screen-serial" for queue in queues):
        errors.append(_issue("serial_screen_queue_missing", "M6 requires a native-screen-serial screen-global queue.", "$.leaseQueues"))


def _validate_cursor_events(
    cursor_events: list[Mapping[str, Any]],
    actor_ids: set[str | None],
    cursor_ids: set[str | None],
    screen_ids: set[str | None],
    errors: list[dict[str, Any]],
) -> None:
    event_types = {_string(event.get("eventType")) for event in cursor_events}
    for required in ("move", "point", "annotate"):
        if required not in event_types:
            errors.append(_issue("cursor_event_missing", f"M6 live demo requires read-only {required} cursor event evidence.", "$.cursorEvents"))
    for index, event in enumerate(cursor_events):
        if event.get("readOnly") is not True or event.get("mutatingGuiAction") is not False or event.get("executorEventRef") not in {None, ""}:
            errors.append(_issue("cursor_event_not_read_only", "Actor cursor move/point/annotate events must remain read-only and cannot execute GUI mutations.", f"$.cursorEvents[{index}]"))
        if _string(event.get("actorId")) not in actor_ids:
            errors.append(_issue("cursor_event_actor_unknown", "Cursor event actorId must match declared actor cursor provenance.", f"$.cursorEvents[{index}].actorId"))
        if _string(event.get("cursorId")) not in cursor_ids:
            errors.append(_issue("cursor_event_cursor_unknown", "Cursor event cursorId must match declared actor cursor provenance.", f"$.cursorEvents[{index}].cursorId"))
        if _string(event.get("screenId")) not in screen_ids:
            errors.append(_issue("cursor_event_screen_unknown", "Cursor event screenId must match declared screens.", f"$.cursorEvents[{index}].screenId"))
        if not _string(event.get("cursorEventRef")):
            errors.append(_issue("cursor_event_ref_missing", "Cursor event must be backed by a refs-first log record.", f"$.cursorEvents[{index}].cursorEventRef"))


def _validate_sidecar_binding(binding: Mapping[str, Any], binding_ref: str | None, require_completed: bool, errors: list[dict[str, Any]]) -> None:
    if binding.get("schemaVersion") != NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA:
        errors.append(_issue("sidecar_binding_schema_invalid", "M6 live demo requires a native sidecar binding record.", "$.sidecarBinding.schemaVersion"))
    binding_kind = _string(binding.get("bindingKind"))
    if binding_kind not in {"diagnostic-local", "custom-dispatcher", "external-command"}:
        errors.append(_issue("sidecar_binding_kind_invalid", "M6 sidecar binding kind is invalid.", "$.sidecarBinding.bindingKind"))
    _reject_forbidden_markers(binding.get("executable"), "$.sidecarBinding.executable", errors)
    if binding.get("dockerNovncRequired") is not False:
        errors.append(_issue("sidecar_binding_docker_novnc_forbidden", "M6 sidecar binding must not require Docker/noVNC.", "$.sidecarBinding.dockerNovncRequired"))
    if not binding_ref:
        errors.append(_issue("sidecar_binding_ref_missing", "M6 live demo must write sidecarBindingRef.", "$.sidecarBindingRef"))
    if require_completed and binding_kind != "external-command":
        errors.append(_issue("completed_run_requires_external_sidecar_command", "Completed M6 evidence requires an external native sidecar command binding.", "$.sidecarBinding.bindingKind"))
    if binding_kind == "external-command":
        if not _string(binding.get("commandDigest")) or not _string(binding.get("executable")):
            errors.append(_issue("external_sidecar_binding_incomplete", "External sidecar binding must record executable and command digest.", "$.sidecarBinding"))
        if binding.get("stdinSchema") != NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA or binding.get("stdoutSchema") != PLATFORM_SIDECAR_RESULT_SCHEMA:
            errors.append(_issue("external_sidecar_protocol_invalid", "External sidecar binding must use the native sidecar JSON dispatch protocol.", "$.sidecarBinding"))


def _validate_capabilities_and_discovery(
    capabilities: Mapping[str, Any],
    capabilities_ref: str | None,
    discovery: Mapping[str, Any],
    discovery_ref: str | None,
    screen_ids: set[str | None],
    actor_cursors: list[Mapping[str, Any]],
    require_completed: bool,
    errors: list[dict[str, Any]],
) -> None:
    if not require_completed:
        return
    if not capabilities_ref:
        errors.append(_issue("sidecar_capabilities_ref_missing", "Completed M6 evidence requires refs-first native sidecar capabilities.", "$.sidecarCapabilitiesRef"))
    if capabilities.get("schemaVersion") != NATIVE_SIDECAR_CAPABILITIES_SCHEMA:
        errors.append(_issue("sidecar_capabilities_schema_invalid", "Completed M6 sidecar capabilities schema is invalid.", "$.sidecarCapabilities.schemaVersion"))
    features = set(string_array(capabilities.get("features")))
    for feature in ("multi-screen", "multi-actor-cursor", "window-local-lease", "screen-global-lease", "refs-first-evidence"):
        if feature not in features:
            errors.append(_issue("sidecar_capability_missing", f"Completed M6 sidecar capabilities must include {feature}.", "$.sidecarCapabilities.features"))
    tools = set(string_array(capabilities.get("tools")))
    for tool in ("capabilities", "preflight", "capture", "state", "execute", "discover"):
        if tool not in tools:
            errors.append(_issue("sidecar_capability_tool_missing", f"Completed M6 sidecar capabilities must include tool {tool}.", "$.sidecarCapabilities.tools"))
    for key in ("planningPerformed", "completionJudged", "sharedSystemInputAllowed", "dockerNovncRequired"):
        if capabilities.get(key) is not False:
            errors.append(_issue("sidecar_capability_boundary_violation", f"Completed M6 capabilities must keep {key}=false.", f"$.sidecarCapabilities.{key}"))

    if not discovery_ref:
        errors.append(_issue("sidecar_discovery_ref_missing", "Completed M6 evidence requires refs-first native sidecar discovery.", "$.sidecarDiscoveryRef"))
    if discovery.get("schemaVersion") != NATIVE_SIDECAR_DISCOVERY_SCHEMA:
        errors.append(_issue("sidecar_discovery_schema_invalid", "Completed M6 sidecar discovery schema is invalid.", "$.sidecarDiscovery.schemaVersion"))
    discovered_screen_ids = {_string(screen.get("screenId")) for screen in _mapping_list(discovery.get("screens"))}
    for screen_id in screen_ids:
        if screen_id and screen_id not in discovered_screen_ids:
            errors.append(_issue("sidecar_discovery_screen_missing", "Completed M6 screens must come from native sidecar discovery.", "$.sidecarDiscovery.screens"))
    discovered_actor_keys = {
        (_string(cursor.get("actorId")), _string(cursor.get("cursorId")), _string(cursor.get("screenId")), _string(cursor.get("windowId")))
        for cursor in _mapping_list(discovery.get("actorCursorPlan"))
    }
    discovered_windows = {
        _string(window.get("windowId")): window
        for window in _mapping_list(discovery.get("windows"))
        if _string(window.get("windowId"))
    }
    for cursor in actor_cursors:
        key = (_string(cursor.get("actorId")), _string(cursor.get("cursorId")), _string(cursor.get("screenId")), _string(cursor.get("windowId")))
        if key not in discovered_actor_keys:
            errors.append(_issue("sidecar_discovery_actor_cursor_missing", "Completed M6 actor cursors must come from native sidecar discovery.", "$.sidecarDiscovery.actorCursorPlan"))
            break
        window = _mapping(discovered_windows.get(_string(cursor.get("windowId"))))
        if not _string(window.get("windowRef")):
            errors.append(_issue("sidecar_discovery_window_ref_missing", "Completed M6 actor cursor windows must bind native sidecar discovery windowRef.", "$.sidecarDiscovery.windows"))
            break


def _validate_sidecar_calls(
    calls: list[Mapping[str, Any]],
    require_completed: bool,
    errors: list[dict[str, Any]],
    discovery: Mapping[str, Any],
    discovery_ref: str | None,
    actor_cursors: list[Mapping[str, Any]],
    binding_kind: str,
) -> None:
    tools = [call.get("tool") for call in calls]
    for tool in ("capabilities", "discover", "preflight", "capture", "state", "execute"):
        if tool not in tools:
            errors.append(_issue("sidecar_tool_missing", f"M6 live runner must call sidecar tool {tool}.", "$.sidecarCalls"))
    if tools.count("execute") < 2:
        errors.append(_issue("sidecar_execute_events_missing", "M6 live runner must attempt at least two scoped execute calls.", "$.sidecarCalls"))
    if not require_completed:
        return
    for index, call in enumerate(calls):
        result = _mapping(call.get("result"))
        if result.get("schemaVersion") != PLATFORM_SIDECAR_RESULT_SCHEMA:
            errors.append(_issue("sidecar_result_schema_invalid", "Completed M6 sidecar results must use the platform sidecar result schema.", f"$.sidecarCalls[{index}].result.schemaVersion"))
        if result.get("tool") != call.get("tool"):
            errors.append(_issue("sidecar_result_tool_mismatch", "Completed M6 sidecar result tool must match the requested sidecar call.", f"$.sidecarCalls[{index}].result.tool"))
        if call.get("status") != "completed":
            errors.append(_issue("sidecar_call_not_completed", "Completed M6 run requires every sidecar call to complete.", f"$.sidecarCalls[{index}]"))
        if result.get("diagnosticOnly") is not False or result.get("userAcceptanceEligible") is not True:
            errors.append(_issue("sidecar_call_not_live_eligible", "Completed M6 run requires non-diagnostic live sidecar evidence.", f"$.sidecarCalls[{index}].result"))
        if binding_kind == "external-command" and result.get("nativeSidecarCommandExecuted") is not True:
            errors.append(_issue("sidecar_call_not_external_command", "Completed M6 run requires every sidecar call to come from the external native sidecar command.", f"$.sidecarCalls[{index}].result.nativeSidecarCommandExecuted"))
        for key in ("planningPerformed", "completionJudged", "sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent", "rawPayloadWritten", "inlineImageWritten", "secretsWritten"):
            if result.get(key) is not False:
                errors.append(_issue("sidecar_boundary_or_input_violation", f"Completed M6 sidecar result must keep {key}=false.", f"$.sidecarCalls[{index}].result.{key}"))
        payload = _mapping(call.get("payload"))
        if call.get("tool") == "preflight":
            _validate_preflight_payload(payload, discovery, actor_cursors, f"$.sidecarCalls[{index}].payload", errors)
        if call.get("tool") == "execute":
            _validate_execute_payload_target(payload, discovery, discovery_ref, f"$.sidecarCalls[{index}].payload", errors)


def _validate_preflight_payload(
    payload: Mapping[str, Any],
    discovery: Mapping[str, Any],
    actor_cursors: list[Mapping[str, Any]],
    path: str,
    errors: list[dict[str, Any]],
) -> None:
    screen_id = _string(payload.get("screenId"))
    expected_refs = {
        ref
        for ref in _discovery_window_refs_for_screen(actor_cursors, screen_id)
        if ref in _discovery_window_refs(discovery)
    }
    actual_refs = set(string_array(payload.get("allowedWindowRefs")))
    if not expected_refs or actual_refs != expected_refs:
        errors.append(_issue(
            "preflight_allowed_windows_not_discovery_allowlisted",
            "Completed M6 preflight allowedWindowRefs must equal the per-screen discovery window refs allowed by user control.",
            f"{path}.allowedWindowRefs",
        ))


def _validate_execute_payload_target(
    payload: Mapping[str, Any],
    discovery: Mapping[str, Any],
    discovery_ref: str | None,
    path: str,
    errors: list[dict[str, Any]],
) -> None:
    target = _mapping(payload.get("target"))
    screen_id = _string(payload.get("screenId"))
    window_id = _string(payload.get("windowId"))
    discovered_screen_ids = {_string(screen.get("screenId")) for screen in _mapping_list(discovery.get("screens"))}
    discovered_window_refs = _discovery_window_refs(discovery)
    if screen_id not in discovered_screen_ids:
        errors.append(_issue("execute_target_not_discovery_backed", "Completed M6 execute screenId must come from native sidecar discovery.", f"{path}.screenId"))
    if window_id:
        window = next((
            item
            for item in _mapping_list(discovery.get("windows"))
            if _string(item.get("windowId")) == window_id
        ), {})
        if not _string(window.get("windowRef")) or target.get("windowRef") not in discovered_window_refs:
            errors.append(_issue("execute_target_not_discovery_backed", "Completed M6 window-local targets must bind a discovered windowRef.", f"{path}.target.windowRef"))
    if target.get("discoveryRef") != discovery_ref or not _string(target.get("targetRef")) or not _string(target.get("regionRef")) or not _string(target.get("stateRef")):
        errors.append(_issue(
            "execute_target_ref_missing",
            "Completed M6 execute target must include targetRef, regionRef, discoveryRef, and stateRef.",
            f"{path}.target",
        ))
    bounds = _mapping(target.get("bounds"))
    if bounds == {"x": 32, "y": 32, "width": 96, "height": 32}:
        errors.append(_issue("execute_target_magic_bounds_forbidden", "Completed M6 execute target cannot use fixed harness magic bounds.", f"{path}.target.bounds"))


def _discovery_window_refs(discovery: Mapping[str, Any]) -> set[str]:
    return {
        _string(window.get("windowRef")) or ""
        for window in _mapping_list(discovery.get("windows"))
        if _string(window.get("windowRef"))
    }


def _validate_replay_bundle(
    replay_bundle: Mapping[str, Any],
    screen_ids: set[str | None],
    require_completed: bool,
    errors: list[dict[str, Any]],
) -> None:
    if replay_bundle.get("schemaVersion") != "sciforge.computer-use.native-multi-screen-live-replay.v1":
        errors.append(_issue("replay_bundle_schema_invalid", "M6 live demo requires a native multi-screen replay bundle.", "$.replayBundle.schemaVersion"))
    frames = _mapping_list(replay_bundle.get("frames"))
    screenshot_screens = {
        _string(frame.get("screenId"))
        for frame in frames
        if frame.get("placeholder") is not True and _string(frame.get("screenshotRef"))
    }
    for screen_id in screen_ids:
        if screen_id and screen_id not in screenshot_screens:
            errors.append(_issue("replay_screenshot_missing_for_screen", "M6 replay requires a non-placeholder screenshotRef frame for each screen.", "$.replayBundle.frames"))
    for index, frame in enumerate(frames):
        if frame.get("placeholder") is True:
            errors.append(_issue("replay_placeholder_frame_forbidden", "M6 live replay must not rely on placeholder frames.", f"$.replayBundle.frames[{index}]"))
        if not string_array(frame.get("beforeEvidenceRefs")):
            errors.append(_issue("replay_before_refs_missing", "M6 replay frames must include beforeEvidenceRefs.", f"$.replayBundle.frames[{index}].beforeEvidenceRefs"))
        if require_completed and not string_array(frame.get("afterEvidenceRefs")):
            errors.append(_issue("replay_after_refs_missing", "Completed M6 replay frames must include afterEvidenceRefs.", f"$.replayBundle.frames[{index}].afterEvidenceRefs"))
        if not _string(frame.get("cursorOverlayRef")):
            errors.append(_issue("replay_cursor_overlay_missing", "M6 replay frames must bind cursor overlay refs.", f"$.replayBundle.frames[{index}].cursorOverlayRef"))
        if not string_array(frame.get("leaseOwnerRefs")):
            errors.append(_issue("replay_lease_owner_refs_missing", "M6 replay frames must bind scheduler lease owner refs.", f"$.replayBundle.frames[{index}].leaseOwnerRefs"))
        if require_completed:
            screenshot_ref = _string(frame.get("screenshotRef")) or ""
            if not _is_image_frame_ref(screenshot_ref):
                errors.append(_issue("replay_screenshot_not_image_ref", "Completed M6 replay screenshotRef must point at an image frame ref, not JSON capture metadata.", f"$.replayBundle.frames[{index}].screenshotRef"))
    if len(string_array(replay_bundle.get("cursorEventRefs"))) < 3:
        errors.append(_issue("replay_cursor_event_refs_missing", "M6 replay must include cursor event refs.", "$.replayBundle.cursorEventRefs"))


def _validate_evidence_index(manifest: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    index = _load_evidence_index(manifest)
    if not index:
        errors.append(_issue("evidence_index_missing", "M6 live demo must write a bundle-local evidence index.", "$.evidenceIndexRef"))
        return
    _validate_no_forbidden_inline_evidence(index, "$.evidenceIndex", errors)
    if index.get("schemaVersion") != NATIVE_MULTI_SCREEN_EVIDENCE_INDEX_SCHEMA:
        errors.append(_issue("evidence_index_schema_invalid", "Evidence index schemaVersion is invalid.", "$.evidenceIndex.schemaVersion"))
    if index.get("runId") != manifest.get("runId"):
        errors.append(_issue("evidence_index_run_mismatch", "Evidence index runId must match the manifest.", "$.evidenceIndex.runId"))
    if index.get("status") != manifest.get("status"):
        errors.append(_issue("evidence_index_status_mismatch", "Evidence index status must match the manifest completed/blocked path.", "$.evidenceIndex.status"))
    if index.get("bundleLocal") is not True:
        errors.append(_issue("evidence_index_not_bundle_local", "Evidence index must be bundle-local.", "$.evidenceIndex.bundleLocal"))
    if index.get("completionEvidenceSubstitute") is not False or index.get("notCompletionEvidence") is not True:
        errors.append(_issue("evidence_index_completion_substitute_forbidden", "Evidence index is a directory, not completion evidence.", "$.evidenceIndex.completionEvidenceSubstitute"))
    if index.get("screenCount") != len(_mapping_list(manifest.get("screens"))):
        errors.append(_issue("evidence_index_screen_count_mismatch", "Evidence index screenCount must match manifest screens.", "$.evidenceIndex.screenCount"))
    if index.get("actorCursorCount") != len(_mapping_list(manifest.get("actorCursors"))):
        errors.append(_issue("evidence_index_actor_count_mismatch", "Evidence index actorCursorCount must match manifest actor cursors.", "$.evidenceIndex.actorCursorCount"))
    for manifest_key, index_key in (
        ("currentBundleRef", "currentBundleRef"),
        ("validationRef", "validationRef"),
        ("replayRef", "replayRef"),
        ("sidecarBindingRef", "sidecarBindingRef"),
    ):
        if _string(manifest.get(manifest_key)) and index.get(index_key) != manifest.get(manifest_key):
            errors.append(_issue("evidence_index_ref_mismatch", f"Evidence index {index_key} must match the manifest.", f"$.evidenceIndex.{index_key}"))
    index_ref = _string(manifest.get("evidenceIndexRef"))
    current_bundle_refs = set(string_array(_mapping(manifest.get("currentBundle")).get("refs")))
    if not index_ref:
        errors.append(_issue("evidence_index_ref_missing", "Manifest must expose evidenceIndexRef.", "$.evidenceIndexRef"))
    elif index_ref not in current_bundle_refs:
        errors.append(_issue("evidence_index_ref_not_current_bundle", "evidenceIndexRef must be part of currentBundle.refs.", "$.currentBundle.refs"))
    replay_frame_refs = set(_replay_frame_screenshot_refs(_mapping(manifest.get("replayBundle"))))
    index_frame_refs = set(string_array(index.get("frameRefs")))
    if replay_frame_refs and not replay_frame_refs.issubset(index_frame_refs):
        errors.append(_issue("evidence_index_replay_refs_missing", "Evidence index must include replay frame refs without replacing replay validation.", "$.evidenceIndex.frameRefs"))
    critical_refs = set(string_array(index.get("criticalRefs")))
    for ref in (manifest.get("manifestRef"), manifest.get("currentBundleRef"), manifest.get("validationRef"), manifest.get("replayRef"), manifest.get("evidenceIndexRef")):
        if _string(ref) and ref not in critical_refs:
            errors.append(_issue("evidence_index_critical_ref_missing", "Evidence index must list the manifest/current bundle/validation/replay/index refs.", "$.evidenceIndex.criticalRefs"))
    retention = _mapping(index.get("retentionRedaction"))
    if retention.get("schemaVersion") != NATIVE_MULTI_SCREEN_RETENTION_REDACTION_SCHEMA:
        errors.append(_issue("retention_redaction_schema_invalid", "Retention/redaction metadata schemaVersion is invalid.", "$.evidenceIndex.retentionRedaction.schemaVersion"))
    if retention.get("refsFirst") is not True or retention.get("bundleLocal") is not True or retention.get("rawInlineStored") is not False:
        errors.append(_issue("retention_redaction_policy_invalid", "Retention/redaction metadata must be refs-first, bundle-local, and raw-inline-free.", "$.evidenceIndex.retentionRedaction"))
    for category in ("screenshot", "window", "cursor", "executor", "validation"):
        section = _mapping(retention.get(category))
        if section.get("rawInlineStored") is not False:
            errors.append(_issue("retention_redaction_raw_inline_forbidden", f"{category} retention must not store raw inline data.", f"$.evidenceIndex.retentionRedaction.{category}.rawInlineStored"))
        storage = _string(section.get("storage")) or ""
        if "ref" not in storage and "hash" not in storage:
            errors.append(_issue("retention_redaction_storage_invalid", f"{category} retention must use refs or hashes.", f"$.evidenceIndex.retentionRedaction.{category}.storage"))
    cleanup = _mapping(index.get("cleanup"))
    if cleanup.get("cleanupUnit") != "run-bundle" or cleanup.get("replayValidationPreservedByRefs") is not True:
        errors.append(_issue("evidence_index_cleanup_invalid", "Evidence index cleanup must operate by run bundle and preserve replay validation refs.", "$.evidenceIndex.cleanup"))


def _validate_completed_live_manifest(manifest: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if manifest.get("completionEligible") is not True or manifest.get("realNativeSidecarExecuted") is not True:
        errors.append(_issue("completed_run_requires_real_sidecar", "Completed M6 evidence requires real native sidecar execution.", "$.realNativeSidecarExecuted"))
    for key in ("diagnosticOnly", "packageHarnessOnly", "fixture", "dryRun"):
        if manifest.get(key) is not False:
            errors.append(_issue("completed_run_cannot_be_diagnostic", f"Completed M6 evidence must keep {key}=false.", f"$.{key}"))
    if not _string(manifest.get("replayRef")) or not manifest.get("overlayRefs"):
        errors.append(_issue("completed_run_replay_missing", "Completed M6 evidence requires replay and overlay refs.", "$.replayRef"))
    if not manifest.get("executorEventRefs"):
        errors.append(_issue("completed_run_executor_refs_missing", "Completed M6 evidence requires executor event refs.", "$.executorEventRefs"))
    summary = _mapping(manifest.get("runSummary"))
    if summary.get("windowLocalQueue") is not True or summary.get("screenGlobalQueue") is not True:
        errors.append(_issue("completed_run_summary_queue_flags_missing", "Completed M6 runSummary must prove window-local and screen-global queues.", "$.runSummary"))


def _native_summary(manifest: Mapping[str, Any]) -> dict[str, Any]:
    cursor_events = _mapping_list(manifest.get("cursorEvents"))
    replay_bundle = _mapping(manifest.get("replayBundle"))
    frames = _mapping_list(replay_bundle.get("frames"))
    queues = _mapping_list(manifest.get("leaseQueues"))
    validation_summary = {
        "realNativeSidecarExecuted": manifest.get("realNativeSidecarExecuted") is True,
        "completionEligible": manifest.get("completionEligible") is True,
        "screenCount": len(_mapping_list(manifest.get("screens"))),
        "actorCursorCount": len(_mapping_list(manifest.get("actorCursors"))),
        "cursorEventTypes": sorted({
            event_type
            for event_type in (_string(event.get("eventType")) for event in cursor_events)
            if event_type
        }),
        "nonPlaceholderReplayScreenCount": len({
            _string(frame.get("screenId"))
            for frame in frames
            if frame.get("placeholder") is not True and _string(frame.get("screenshotRef"))
        }),
        "windowLocalQueue": any(queue.get("scopeKind") == "window-local" and queue.get("schedulerPolicy") == "native-screen-serial" for queue in queues),
        "screenGlobalQueue": any(queue.get("scopeKind") == "screen-global" and queue.get("schedulerPolicy") == "native-screen-serial" for queue in queues),
    }
    for key in ("runId", "status", "validationRef", "currentBundleRef", "evidenceIndexRef", "replayRef"):
        if _string(manifest.get(key)):
            validation_summary[key] = manifest.get(key)
    binding = _mapping(manifest.get("sidecarBinding"))
    if binding.get("bindingKind"):
        validation_summary["sidecarBindingKind"] = binding.get("bindingKind")
    return validation_summary


def _write_json(path: Path, payload: Mapping[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")
    return str(path)


def _load_mapping(value: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return copy.deepcopy(dict(value))
    parsed = json.loads(Path(value).read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("payload root is not an object")
    return parsed


def _validation_result(
    errors: list[dict[str, Any]],
    refs: list[str],
    summary: Mapping[str, Any] | None = None,
    manifest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        "schemaVersion": NATIVE_MULTI_SCREEN_LIVE_DEMO_VALIDATION_SCHEMA,
        "ok": not errors,
        "status": "accepted" if not errors else "blocked",
        "errors": errors,
        "errorCount": len(errors),
        "refs": refs,
        "dockerNovncRequired": False,
        **({"summary": dict(summary)} if summary else {}),
    }
    if manifest is not None:
        result.update({
            "runId": manifest.get("runId"),
            "currentBundleRef": manifest.get("currentBundleRef"),
            "sidecarBindingRef": manifest.get("sidecarBindingRef"),
            "sidecarCapabilitiesRef": manifest.get("sidecarCapabilitiesRef"),
            "sidecarDiscoveryRef": manifest.get("sidecarDiscoveryRef"),
            "schedulerLeaseRefs": manifest.get("schedulerLeaseRefs") or [],
            "replayRef": manifest.get("replayRef"),
            "targetRefs": manifest.get("targetRefs") or [],
            "currentBundle": manifest.get("currentBundle"),
            "sidecarBinding": manifest.get("sidecarBinding"),
            "sidecarCapabilities": manifest.get("sidecarCapabilities"),
            "sidecarDiscovery": manifest.get("sidecarDiscovery"),
        })
        binding = _mapping(manifest.get("sidecarBinding"))
        if binding.get("bindingKind"):
            result["sidecarBindingKind"] = binding.get("bindingKind")
    return result


def _issue(code: str, message: str, path: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path, **extra}


def _reject_forbidden_markers(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    text = str(value or "").lower()
    marker = next((item for item in _FORBIDDEN_BACKEND_MARKERS if item in text), None)
    if marker:
        errors.append(_issue("legacy_docker_novnc_backend_forbidden", f"Legacy Docker/noVNC/RDP backend marker is not allowed for M6: {marker}.", path))


def _validate_no_forbidden_inline_evidence(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            child_path = f"{path}.{key}"
            normalized = _normalized_field_name(key)
            if _is_forbidden_evidence_field(normalized):
                errors.append(_issue(
                    "raw_or_secret_evidence_field_forbidden",
                    "M6 evidence must not inline raw screenshots/base64/raw traces/secrets.",
                    child_path,
                ))
                continue
            if normalized in _WINDOW_TITLE_OWNER_FIELD_NAMES and item not in {None, ""}:
                errors.append(_issue(
                    "window_title_owner_not_redacted",
                    "Window title/owner evidence must be stored as a hash, not raw text.",
                    child_path,
                ))
                continue
            _validate_no_forbidden_inline_evidence(item, child_path, errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_no_forbidden_inline_evidence(item, f"{path}[{index}]", errors)
    elif isinstance(value, str) and _contains_forbidden_evidence_value(value):
        errors.append(_issue(
            "raw_or_secret_evidence_value_forbidden",
            "M6 evidence value contains inline image/base64/raw trace/secret material.",
            path,
        ))


def _validate_referenced_json_ref(path: Path, root: Path | None, errors: list[dict[str, Any]]) -> None:
    if root and not _is_under(path, root):
        return
    if path.suffix.lower() != ".json":
        return
    try:
        parsed = json.loads(path.read_text(encoding="utf8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return
    _validate_no_forbidden_inline_evidence(parsed, f"ref:{path}", errors)


def _load_evidence_index(manifest: Mapping[str, Any]) -> Mapping[str, Any]:
    index_ref = _string(manifest.get("evidenceIndexRef"))
    if index_ref:
        root = _bundle_root(manifest)
        path = _resolve_bundle_ref(index_ref, root) if root else Path(index_ref)
        if path.is_file():
            try:
                return _mapping(json.loads(path.read_text(encoding="utf8")))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                return {}
    return _mapping(manifest.get("evidenceIndex"))


def _redact_for_storage(value: Any) -> Any:
    if isinstance(value, Mapping):
        cleaned: dict[str, Any] = {}
        redactions: list[dict[str, str]] = []
        for key, item in value.items():
            normalized = _normalized_field_name(key)
            if _is_forbidden_evidence_field(normalized):
                redactions.append({
                    "fieldHash": _hash_text(str(key)),
                    "valueHash": _hash_json(item),
                    "reason": "forbidden-inline-evidence",
                })
                continue
            if normalized in _WINDOW_TITLE_OWNER_FIELD_NAMES and item not in {None, ""}:
                cleaned[f"{key}Hash"] = _hash_json(item)
                redactions.append({
                    "fieldHash": _hash_text(str(key)),
                    "valueHash": _hash_json(item),
                    "reason": "window-title-owner-redacted",
                })
                continue
            cleaned[str(key)] = _redact_for_storage(item)
        if redactions:
            cleaned["redactedFieldSummaries"] = redactions
        return cleaned
    if isinstance(value, list):
        return [_redact_for_storage(item) for item in value]
    if isinstance(value, str) and _contains_forbidden_evidence_value(value):
        return {
            "redactedValueHash": _hash_text(value),
            "redactionReason": "forbidden-inline-evidence-value",
        }
    return value


def _is_forbidden_evidence_field(normalized: str) -> bool:
    return normalized in _FORBIDDEN_EVIDENCE_FIELD_NAMES or normalized in _SENSITIVE_EVIDENCE_FIELD_NAMES


def _contains_forbidden_evidence_value(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in _FORBIDDEN_EVIDENCE_VALUE_MARKERS)


def _normalized_field_name(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _replay_frame_screenshot_refs(replay_bundle: Mapping[str, Any]) -> list[str]:
    return sorted(set(
        ref
        for ref in (_string(frame.get("screenshotRef")) for frame in _mapping_list(replay_bundle.get("frames")))
        if ref
    ))


def _collect_refs(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized_key = _normalized_field_name(key)
            if normalized_key in {"rootref", "bundlerootref"}:
                continue
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


def _refs(result: Mapping[str, Any]) -> list[str]:
    refs = result.get("refs")
    return [ref for ref in refs if isinstance(ref, str) and ref.strip()] if isinstance(refs, list) else []


def _first_ref(result: Mapping[str, Any]) -> str | None:
    refs = _refs(result)
    return refs[0] if refs else None


def _value_ref(result: Mapping[str, Any], key: str) -> str | None:
    value = _mapping(result.get("value")).get(key)
    return _string(value)


def _capture_screenshot_ref(result: Mapping[str, Any], capture_ref: str, root: Path) -> str | None:
    screenshot_ref = _value_ref(result, "screenshotRef")
    if screenshot_ref and _is_image_frame_ref(screenshot_ref):
        return screenshot_ref
    capture_path = _resolve_bundle_ref(capture_ref, root) if _looks_like_path(capture_ref) else None
    if capture_path and capture_path.is_file():
        try:
            capture = _mapping(json.loads(capture_path.read_text(encoding="utf8")))
            loaded_screenshot_ref = _string(capture.get("screenshotRef"))
            if loaded_screenshot_ref and _is_image_frame_ref(loaded_screenshot_ref):
                return _bundle_local_ref(loaded_screenshot_ref, root)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
    return None


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _mapping_list(value: Any) -> list[Mapping[str, Any]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def string_array(value: Any) -> list[str]:
    return [item.strip() for item in value if isinstance(item, str) and item.strip()] if isinstance(value, list) else []


def _number(value: Any, default: int) -> int:
    numeric = value if isinstance(value, (int, float)) else default
    return int(numeric) if isinstance(numeric, (int, float)) and numeric == numeric else default


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _looks_like_path(ref: str) -> bool:
    return ref.startswith("/") or ref.startswith(".") or "/" in ref


def _looks_like_file_ref(ref: str) -> bool:
    return bool(_string(ref)) and not _has_uri_scheme(ref) and (_looks_like_path(ref) or bool(Path(ref).suffix))


def _is_image_frame_ref(ref: str) -> bool:
    return bool(_string(ref)) and Path(ref).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _resolve_bundle_ref(ref: str | Path, root: Path) -> Path:
    path = Path(ref).expanduser()
    if not path.is_absolute():
        path = root / path
    return path.resolve()


def _bundle_local_ref(ref: str | Path, root: Path) -> str:
    ref_text = str(ref)
    if _has_uri_scheme(ref_text):
        return ref_text
    resolved = _resolve_bundle_ref(ref, root)
    if not _is_under(resolved, root.resolve()):
        raise ValueError(f"bundle ref must stay under evidence root: {ref}")
    return resolved.relative_to(root.resolve()).as_posix()


def _localize_bundle_refs(value: Any, root: Path) -> Any:
    if isinstance(value, Mapping):
        return {key: _localize_bundle_refs(item, root) for key, item in value.items()}
    if isinstance(value, list):
        return [_localize_bundle_refs(item, root) for item in value]
    if isinstance(value, str) and _looks_like_path(value) and not _has_uri_scheme(value):
        try:
            resolved = _resolve_bundle_ref(value, root)
            if _is_under(resolved, root.resolve()):
                return resolved.relative_to(root.resolve()).as_posix()
        except (OSError, RuntimeError, ValueError):
            return value
    return value


def _has_uri_scheme(value: str) -> bool:
    head = value.split("/", 1)[0]
    return ":" in head and not value.startswith(("./", "../"))


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


def _digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf8")).hexdigest()[:12]


def _hash_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf8")).hexdigest()


def _hash_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf8")).hexdigest()


def _file_hash(ref: str, root: Path | None = None) -> str:
    try:
        path = _resolve_bundle_ref(ref, root) if root else Path(ref)
        return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return _hash_text(ref)


__all__ = [
    "NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA",
    "NATIVE_MULTI_SCREEN_LIVE_DEMO_VALIDATION_SCHEMA",
    "NATIVE_MULTI_SCREEN_EVIDENCE_INDEX_SCHEMA",
    "NATIVE_MULTI_SCREEN_RETENTION_REDACTION_SCHEMA",
    "NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA",
    "NATIVE_SIDECAR_CAPABILITIES_SCHEMA",
    "NATIVE_SIDECAR_DISPATCH_CALL_SCHEMA",
    "NATIVE_SIDECAR_DISCOVERY_SCHEMA",
    "make_native_sidecar_command_dispatcher",
    "run_native_multi_screen_live_demo",
    "validate_native_multi_screen_live_demo_run",
]


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
