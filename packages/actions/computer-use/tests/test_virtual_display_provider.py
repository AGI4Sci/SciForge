import json

from sciforge_computer_use.contracts import validate_action_adapter_readiness
from sciforge_computer_use.virtual_display_provider import (
    VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA,
    VIRTUAL_DISPLAY_PROVIDER_PROBE_BUNDLE_SCHEMA,
    VIRTUAL_DISPLAY_READINESS_SCHEMA,
    build_virtual_display_provider_manifest,
    build_virtual_display_screen_payload,
    describe_virtual_display_providers,
    invoke_virtual_display_provider,
    is_virtual_display_readiness_controllable,
    probe_virtual_display_providers,
    query_virtual_display_providers,
    read_virtual_display_provider,
    select_virtual_display_provider_probe,
    virtual_display_readiness_to_action_adapter_readiness,
)


def _ready_macos_probe():
    return probe_virtual_display_providers(
        platform="darwin",
        target_app_kind="VS Code",
        node_package_availability={"node-mac-virtual-display": True},
        permission_grants={
            "permission:macos/screen-recording": True,
            "permission:macos/accessibility": True,
        },
    )


def _walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)


def test_virtual_display_provider_catalog_declares_one_native_truth_source_per_platform():
    darwin = describe_virtual_display_providers(platform="darwin")
    linux = describe_virtual_display_providers(platform="linux")
    win32 = describe_virtual_display_providers(platform="win32")

    assert [provider["providerId"] for provider in darwin] == [
        "virtual-display.macos.cgvirtualdisplay-screencapturekit"
    ]
    assert [provider["providerId"] for provider in linux] == ["virtual-display.linux.xpra"]
    assert [provider["providerId"] for provider in win32] == ["virtual-display.windows.idd"]
    assert all(provider["schemaVersion"] == VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA for provider in darwin + linux + win32)

    macos = read_virtual_display_provider(
        "virtual-display.macos.cgvirtualdisplay-screencapturekit",
        platform="darwin",
    )
    assert macos["backendKind"] == "cgvirtualdisplay-screencapturekit"
    assert macos["supportedTransports"] == ["webrtc", "native-frame-stream"]
    assert macos["capabilities"]["affectsPhysicalDisplay"] is False
    assert macos["capabilities"]["requiresFocusSteal"] is False
    assert macos["capabilities"]["sharedSystemInputUsed"] is False
    assert "permission:macos/screen-recording" in macos["permissionRefs"]

    queried = query_virtual_display_providers(
        platform="darwin",
        target_app_kind="vscode",
        supported_transport="webrtc",
        supported_input_adapter="ax",
    )
    assert [provider["providerId"] for provider in queried] == [
        "virtual-display.macos.cgvirtualdisplay-screencapturekit"
    ]


def test_virtual_display_provider_manifest_excludes_fallback_and_app_surface_providers():
    manifest = build_virtual_display_provider_manifest()

    assert manifest["providerIds"] == [
        "virtual-display.macos.cgvirtualdisplay-screencapturekit",
        "virtual-display.linux.xpra",
        "virtual-display.windows.idd",
    ]
    assert manifest["supportedTransports"] == ["native-frame-stream", "webrtc"]
    assert "browser-runtime" not in manifest["supportedInputAdapters"]
    assert "vm-input" not in manifest["supportedInputAdapters"]


def test_virtual_display_probe_fail_closes_when_macos_driver_or_permissions_are_missing():
    missing_package = probe_virtual_display_providers(
        platform="darwin",
        target_app_kind="vscode",
        node_package_availability={"node-mac-virtual-display": False},
    )

    assert missing_package["schemaVersion"] == VIRTUAL_DISPLAY_PROVIDER_PROBE_BUNDLE_SCHEMA
    assert missing_package["status"] == "blocked"
    assert missing_package["selectedProviderId"] == "virtual-display.macos.cgvirtualdisplay-screencapturekit"
    assert missing_package["selectedReadiness"]["schemaVersion"] == VIRTUAL_DISPLAY_READINESS_SCHEMA
    assert missing_package["selectedReadiness"]["installationStatus"] == "installable"
    assert missing_package["selectedReadiness"]["captureSupported"] is False
    assert missing_package["selectedReadiness"]["sharedSystemInputUsed"] is False
    assert "installable but not installed" in missing_package["blockedReason"]
    assert is_virtual_display_readiness_controllable(missing_package["selectedReadiness"]) is False

    missing_permission = probe_virtual_display_providers(
        platform="darwin",
        target_app_kind="vscode",
        node_package_availability={"node-mac-virtual-display": True},
        permission_grants={
            "permission:macos/screen-recording": True,
            "permission:macos/accessibility": False,
        },
    )

    assert missing_permission["status"] == "blocked"
    assert missing_permission["selectedReadiness"]["installationStatus"] == "installed"
    assert missing_permission["selectedReadiness"]["inputSupported"] is False
    assert "permission or driver readiness is not proven" in missing_permission["blockedReason"]


def test_virtual_display_accepts_only_local_native_macos_provider_for_vscode_readiness():
    bundle = _ready_macos_probe()

    assert bundle["status"] == "ready"
    assert bundle["targetAppKind"] == "vscode"
    assert bundle["selectedProviderId"] == "virtual-display.macos.cgvirtualdisplay-screencapturekit"
    assert bundle["selectedReadiness"]["selectedTransport"] == "webrtc"
    assert bundle["selectedReadiness"]["backgroundRenderable"] is True
    assert bundle["selectedReadiness"]["affectsPhysicalDisplay"] is False
    assert bundle["selectedReadiness"]["requiresFocusSteal"] is False
    assert bundle["selectedReadiness"]["singleInteractiveTruth"] is True

    adapter_readiness = virtual_display_readiness_to_action_adapter_readiness(
        bundle["selectedReadiness"],
        readiness_ref="adapter-readiness:run/vscode.json",
    )
    validation = validate_action_adapter_readiness(adapter_readiness)
    assert validation["ok"] is True
    assert adapter_readiness["ready"] is True
    assert adapter_readiness["supportedActions"] == ["click", "type_text", "drag", "scroll", "hotkey", "menu_command"]
    assert VIRTUAL_DISPLAY_READINESS_SCHEMA in adapter_readiness["schemaRefs"]


def test_linux_provider_keeps_xpra_as_the_only_linux_provider():
    xpra_ready = probe_virtual_display_providers(
        platform="linux",
        target_app_kind="vscode",
        command_availability={"xpra": True},
    )

    assert xpra_ready["status"] == "ready"
    assert xpra_ready["selectedProviderId"] == "virtual-display.linux.xpra"
    assert xpra_ready["selectedReadiness"]["selectedTransport"] == "webrtc"
    assert len(xpra_ready["probes"]) == 1

    selected = select_virtual_display_provider_probe(xpra_ready["probes"])
    assert selected["description"]["providerId"] == "virtual-display.linux.xpra"
    assert selected["description"]["supportedTransports"] == ["webrtc", "native-frame-stream"]


def test_virtual_display_screen_payload_exposes_live_refs_only_for_controllable_readiness():
    blocked = probe_virtual_display_providers(
        platform="darwin",
        target_app_kind="vscode",
        node_package_availability={"node-mac-virtual-display": False},
    )
    blocked_payload = build_virtual_display_screen_payload(
        run_id="blocked-vscode",
        target_app_kind="vscode",
        target_app_name="VSCode",
        probe_bundle=blocked,
    )

    assert blocked_payload["status"] == "blocked"
    assert blocked_payload["attachState"] == "adapter-unavailable"
    assert "currentFrameRef" not in blocked_payload
    assert "sessionRef" not in blocked_payload
    assert blocked_payload["isolationFlags"]["diagnosticOnly"] is True
    assert "not installed" in blocked_payload["blockedReason"]

    ready_payload = build_virtual_display_screen_payload(
        run_id="ready-vscode",
        target_app_kind="vscode",
        target_app_name="VSCode",
        probe_bundle=_ready_macos_probe(),
    )

    assert ready_payload["status"] == "ready"
    assert ready_payload["attachState"] == "attached"
    assert ready_payload["liveSurfaceRef"] == ".sciforge/vision-runs/ready-vscode/virtual-display-provider/live-surface.json"
    assert ready_payload["surfaceTransport"] == "webrtc"
    assert ready_payload["sessionRef"] == "computer-use:session/ready-vscode/virtual-display-session.json"
    assert ready_payload["inputIntentRefs"] == [
        ".sciforge/vision-runs/ready-vscode/virtual-display-provider/input-intents/click-and-type.json"
    ]
    assert ready_payload["beforeAfterFrameRefs"] == [
        ".sciforge/vision-runs/ready-vscode/virtual-display-provider/before-after/input.json"
    ]
    assert ready_payload["isolationFlags"]["diagnosticOnly"] is False


def test_virtual_display_invoke_is_refs_first_and_fail_closed_without_raw_payloads():
    blocked = invoke_virtual_display_provider(
        intent="createSession",
        run_id="invoke-blocked",
        target_app_kind="vscode",
        probe_options={
            "platform": "darwin",
            "node_package_availability": {"node-mac-virtual-display": False},
        },
    )

    assert blocked["schemaVersion"] == VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA
    assert blocked["status"] == "requires-handoff"
    assert blocked["mutatingActionExecuted"] is False
    assert blocked["rawPayloadWritten"] is False
    assert blocked["refs"]["blockedRef"].endswith("/virtual-display-provider/blocked.json")

    ready_probe = _ready_macos_probe()
    create_session = invoke_virtual_display_provider(
        intent="createSession",
        run_id="invoke-ready",
        target_app_kind="vscode",
        probe_bundle=ready_probe,
    )
    assert create_session["status"] == "ready"
    assert create_session["refs"]["sessionRef"] == "computer-use:session/invoke-ready/virtual-display-session.json"
    assert create_session["refs"]["screenRef"] == "virtual-app-screen:invoke-ready/screen"

    input_result = invoke_virtual_display_provider(
        intent="executeInputIntent",
        run_id="invoke-ready",
        target_app_kind="vscode",
        probe_bundle=ready_probe,
    )
    assert input_result["status"] == "ready"
    assert input_result["mutatingActionExecuted"] is True
    assert input_result["refs"]["beforeAfterFrameRefs"] == [
        ".sciforge/vision-runs/invoke-ready/virtual-display-provider/before-after/input.json"
    ]
    assert input_result["refs"]["executorEventRefs"] == [
        ".sciforge/vision-runs/invoke-ready/virtual-display-provider/executor-events/click-and-type.json"
    ]

    serialized = json.dumps({"blocked": blocked, "ready": create_session, "input": input_result}, sort_keys=True)
    forbidden_tokens = {"rawScreenshot", "base64", "data:image", "providerUrl", "streamUrl", "webrtcSdp", "iceCandidate"}
    assert forbidden_tokens.isdisjoint(set(_walk_strings(json.loads(serialized))))
