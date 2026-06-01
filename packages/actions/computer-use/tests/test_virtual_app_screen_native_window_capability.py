import json
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PACKAGE_ROOT / "native-window-capability.manifest.json"

REQUIRED_CAPABILITIES = {
    "window.identity",
    "window.frame-ref",
    "permission.diagnostics",
    "accessibility.hit-test",
    "accessibility.action",
    "display-like.offscreen-hidden-probe",
    "app.lifecycle",
    "handoff.dialog-focus",
}
REQUIRED_DIAGNOSTICS = {
    "target-ambiguous",
    "permission-missing",
    "background-capture-unavailable",
    "hit-test-unavailable",
    "action-unavailable",
    "display-like-probe-unavailable",
    "lifecycle-unavailable",
    "dialog-or-focus-steal",
    "shared-system-input-forbidden",
    "raw-screenshot-forbidden",
}
FORBIDDEN_INLINE_PAYLOADS = {
    "rawScreenshot",
    "rawScreenshots",
    "base64",
    "data:image",
    "inlineImage",
    "rawProviderPayload",
}
REQUIRED_FALSE_FLAGS = {
    "realOsInputExecuted",
    "sharedSystemInputUsed",
    "systemPointerMoved",
    "systemKeyboardEventsSent",
    "physicalPopupShown",
    "rawScreenshotAllowed",
    "rawPayloadWritten",
    "inlineImageWritten",
}
FORBIDDEN_RUNTIME_COMMAND_KEYS = {
    "command",
    "commands",
    "cli",
    "entrypoint",
    "diagnosticEntrypoint",
    "sidecarCommand",
}


def _load_manifest():
    return json.loads(MANIFEST_PATH.read_text(encoding="utf8"))


def _capabilities_by_id(manifest):
    return {capability["capabilityId"]: capability for capability in manifest["capabilities"]}


def _taxonomy_by_category(manifest):
    return {category["category"]: category for category in manifest["diagnosticTaxonomy"]["categories"]}


def _walk_key_values(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from _walk_key_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_key_values(item)


def _values_for_key(value, wanted_key):
    for key, item in _walk_key_values(value):
        if key == wanted_key:
            yield item


def _blocked_diagnostic(manifest, category, requested):
    diagnostic = _taxonomy_by_category(manifest)[category]
    return {
        "ok": False,
        "status": diagnostic["status"],
        "diagnosticCategory": category,
        "blockedReason": diagnostic["blockedReasonTemplate"],
        "requiredRefs": diagnostic["requiredRefs"],
        "requested": requested,
        "userAcceptanceEligible": diagnostic["userAcceptanceEligible"],
    }


def test_native_window_capability_manifest_is_refs_first_fail_closed_contract_only():
    manifest = _load_manifest()

    assert manifest["schemaVersion"] == "sciforge.computer-use.native-window-capability-manifest.v1"
    assert manifest["productGate"] == "P1-CU-UA-BACKGROUND-NATIVE-WINDOW"
    assert manifest["refsFirst"] is True
    assert manifest["failClosed"] is True
    assert manifest["contractOnly"] is True
    assert manifest["diagnosticOnlyUntilRuntimeEvidence"] is True
    assert manifest["userAcceptanceEligible"] is False
    assert manifest["livePassClaimsAllowed"] is False
    assert manifest["claimLimit"]

    assert set(_capabilities_by_id(manifest)) == REQUIRED_CAPABILITIES
    assert set(_taxonomy_by_category(manifest)) == REQUIRED_DIAGNOSTICS
    assert set(manifest["providers"][0]["capabilityIds"]) == REQUIRED_CAPABILITIES

    for value in _values_for_key(manifest, "userAcceptanceEligible"):
        assert value is False
    for value in _values_for_key(manifest, "livePassClaimsAllowed"):
        assert value is False
    for value in _values_for_key(manifest, "status"):
        assert value not in {"passed", "completed"}

    runtime_command_keys = {
        key
        for key, _ in _walk_key_values(manifest)
        if key in FORBIDDEN_RUNTIME_COMMAND_KEYS
    }
    assert runtime_command_keys == set()


def test_identity_bounds_frame_preview_hash_timestamp_and_permission_fields_are_required():
    manifest = _load_manifest()
    record_groups = manifest["nativeWindowRecord"]["requiredGroups"]
    capabilities = _capabilities_by_id(manifest)

    assert {
        "appId",
        "appRef",
        "appKind",
        "bundleIdHash",
        "ownerHash",
        "processIdentityHash",
    } <= set(record_groups["appIdentity"])
    assert {
        "windowId",
        "windowRef",
        "targetWindowRef",
        "displayGroupId",
        "screenId",
        "titleHash",
        "activationState",
    } <= set(record_groups["windowIdentity"])
    assert {"bounds", "contentBounds", "coordinateSpace", "scaleFactor"} <= set(record_groups["bounds"])
    assert {"frameRef", "previewRef", "frameHash", "previewHash", "capturedAt", "observedAt"} <= set(record_groups["frameEvidence"])
    assert {
        "permissionDiagnosticsRef",
        "screenRecording",
        "accessibility",
        "automation",
        "inputMonitoring",
        "appAllowlist",
        "blockedReason",
    } <= set(record_groups["permissionDiagnostics"])

    assert {"observedAt", "capturedAt", "permissionCheckedAt"} <= set(manifest["nativeWindowRecord"]["timestampFields"])
    assert {"titleHash", "ownerHash", "frameHash", "previewHash", "stateHash"} <= set(manifest["nativeWindowRecord"]["hashFields"])

    frame_capability = capabilities["window.frame-ref"]
    assert {"frameRef", "previewRef", "frameMetadataRef", "permissionDiagnosticsRef"} <= set(frame_capability["requiredRefs"])
    assert {"capturedAt", "frameHash", "previewHash", "bounds"} <= set(frame_capability["requiredFields"])

    permission_capability = capabilities["permission.diagnostics"]
    assert {
        "permissionDiagnosticsRef",
        "sessionPermissionRef",
        "appWindowAllowlistRef",
        "riskPreviewRef",
    } <= set(permission_capability["requiredRefs"])


def test_ax_uia_at_spi_hit_test_and_action_contract_are_ref_bound_and_lease_bound():
    manifest = _load_manifest()
    accessibility = manifest["accessibilityContract"]
    adapters = accessibility["platformAdapters"]
    hit_test = accessibility["hitTest"]
    action = accessibility["action"]
    action_policy = action["policy"]

    assert {adapter["api"] for adapter in adapters} == {"AX", "UIA", "AT-SPI"}
    assert {adapter["platform"] for adapter in adapters} == {"darwin", "win32", "linux"}
    assert {adapter["providerRef"] for adapter in adapters} == {
        "native-window-accessibility-provider:darwin-ax",
        "native-window-accessibility-provider:win32-uia",
        "native-window-accessibility-provider:linux-at-spi",
    }

    assert hit_test["operationId"] == "native-window.accessibility.hit-test"
    assert {"targetWindowRef", "frameRef", "coordinateRef", "permissionDiagnosticsRef"} <= set(hit_test["inputRequiredRefs"])
    assert {"hitTestRef", "accessibilityElementRef", "groundingRef"} <= set(hit_test["returnsRefs"])
    assert {"rawAccessibilityTree", "rawElementText", "rawProviderPayload"} <= set(hit_test["forbiddenElementPayloadFields"])
    assert "hit-test-ambiguous" in hit_test["failClosedWhen"]

    assert action["operationId"] == "native-window.accessibility.action"
    assert {"hitTestRef", "accessibilityElementRef", "inputIntentRef", "schedulerLeaseRef"} <= set(action["inputRequiredRefs"])
    assert {"executorEventRef", "beforeAfterFrameRef", "verificationRef", "isolationReportRef"} <= set(action["returnsRefs"])
    assert action_policy["proposalFirst"] is True
    assert action_policy["leaseRequired"] is True
    assert action_policy["targetWindowBindingRequired"] is True
    assert action_policy["beforeAfterFrameRefsRequired"] is True
    assert action_policy["verifierRefRequired"] is True
    assert action_policy["directAccessibilityMutationWithoutLeaseAllowed"] is False
    assert action_policy["directAxMutationWithoutLeaseAllowed"] is False
    assert action_policy["directUiaMutationWithoutLeaseAllowed"] is False
    assert action_policy["directAtSpiMutationWithoutLeaseAllowed"] is False
    assert action_policy["sharedSystemInputUsed"] is False
    assert action_policy["systemPointerMoved"] is False
    assert action_policy["systemKeyboardEventsSent"] is False
    assert {"action-would-focus-window", "modal-dialog-detected", "shared-system-input-required"} <= set(action["failClosedWhen"])


def test_offscreen_hidden_display_probe_and_lifecycle_manager_fail_closed_with_handoff():
    manifest = _load_manifest()
    probe = manifest["displayLikeCapabilityProbe"]
    lifecycle = manifest["appLifecycleManager"]
    lifecycle_operations = lifecycle["operations"]
    dialog_policy = lifecycle["dialogAndFocusPolicy"]

    assert probe["successMeaning"] == "capability-readiness-only"
    assert probe["userAcceptanceEligible"] is False
    assert {"offscreen-window", "hidden-window", "occluded-window", "minimized-window"} <= set(probe["probeTargets"])
    assert {"targetWindowRef", "permissionDiagnosticsRef", "probePlanRef"} <= set(probe["requiredInputRefs"])
    assert {"capabilityProbeRef", "probeFrameRef", "probePreviewRef", "isolationReportRef", "blockedRef"} <= set(probe["returnsRefs"])
    assert {"probeStartedAt", "probeCompletedAt", "frameHash", "previewHash", "backgroundRenderable"} <= set(probe["requiredEvidenceFields"])
    assert {"requires-focus-steal", "physical-popup-shown", "shared-system-input-required", "raw-screenshot-only-provider"} <= set(probe["failClosedWhen"])

    assert set(lifecycle_operations) == {"open", "attach", "reuse", "close"}
    assert {"open-would-steal-focus", "modal-dialog-detected"} <= set(lifecycle_operations["open"]["failClosedWhen"])
    assert "target-window-ambiguous" in lifecycle_operations["attach"]["failClosedWhen"]
    assert "stale-window-ref" in lifecycle_operations["reuse"]["failClosedWhen"]
    assert {"unowned-window-close-requested", "destructive-close-without-confirmation"} <= set(lifecycle_operations["close"]["failClosedWhen"])
    for operation in lifecycle_operations.values():
        assert operation["inputRequiredRefs"]
        assert operation["returnsRefs"]
        assert "permissionDiagnosticsRef" in operation["returnsRefs"]

    assert dialog_policy["statusOnDetection"] == "requires-handoff"
    assert dialog_policy["userAcceptanceEligible"] is False
    assert {"modal-dialog", "permission-dialog", "focus-steal-request", "system-prompt"} <= set(dialog_policy["detects"])
    assert {"handoffRef", "blockedRef", "errorRef", "permissionDiagnosticsRef"} <= set(dialog_policy["returnsRefs"])

    popup_result = _blocked_diagnostic(manifest, "dialog-or-focus-steal", {"operation": "open"})
    assert popup_result["ok"] is False
    assert popup_result["status"] == "requires-handoff"
    assert popup_result["userAcceptanceEligible"] is False
    assert {"handoffRef", "blockedRef", "errorRef"} <= set(popup_result["requiredRefs"])


def test_shared_system_input_and_raw_screenshot_paths_are_forbidden_not_live_passes():
    manifest = _load_manifest()
    provider = manifest["providers"][0]
    security = manifest["securityPolicy"]
    source_boundary = manifest["sourceBoundaryPolicy"]

    assert FORBIDDEN_INLINE_PAYLOADS <= set(security["forbiddenInlinePayloads"])
    assert {"shared-system-input", "system-pointer", "system-keyboard", "global-coordinate-input"} <= set(security["forbiddenInputChannels"])
    assert set(security["requiredFalseFlags"]) == REQUIRED_FALSE_FLAGS
    assert {"AX", "UIA", "AT-SPI", "accessibility-tree", "raw-screenshot", "fixture", "shared-system-input"} <= set(source_boundary["forbiddenAsLivePass"])
    assert {"AX", "UIA", "AT-SPI", "window-inventory", "permission-diagnostics"} <= set(source_boundary["allowedAsObservationHints"])

    for flag in REQUIRED_FALSE_FLAGS:
        assert provider["sideEffectFlags"][flag] is False
        for value in _values_for_key(manifest, flag):
            if isinstance(value, bool):
                assert value is False, flag

    shared_input_result = _blocked_diagnostic(
        manifest,
        "shared-system-input-forbidden",
        {"inputChannel": "shared-system-input"},
    )
    assert shared_input_result["ok"] is False
    assert shared_input_result["status"] == "requires-handoff"
    assert shared_input_result["userAcceptanceEligible"] is False

    raw_screenshot_result = _blocked_diagnostic(
        manifest,
        "raw-screenshot-forbidden",
        {"payloadKind": "rawScreenshot"},
    )
    assert raw_screenshot_result["ok"] is False
    assert raw_screenshot_result["status"] == "blocked"
    assert raw_screenshot_result["userAcceptanceEligible"] is False
