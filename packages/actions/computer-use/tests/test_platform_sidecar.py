import ast
import json
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use.platform_sidecar import (
    PLATFORM_CAPTURE_SNAPSHOT_SCHEMA,
    PLATFORM_EXECUTOR_EVENT_SCHEMA,
    PLATFORM_ISOLATION_REPORT_SCHEMA,
    PLATFORM_PERMISSION_PREFLIGHT_SCHEMA,
    PLATFORM_SIDECAR_MANIFEST_SCHEMA,
    PLATFORM_STATE_SNAPSHOT_SCHEMA,
    dispatch_platform_sidecar_tool,
    get_platform_sidecar_manifest,
    validate_platform_sidecar_payload,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SIDECAR_MODULE = PACKAGE_ROOT / "sciforge_computer_use" / "platform_sidecar.py"
ACTION_MANIFEST = PACKAGE_ROOT / "action-provider.manifest.json"


def test_platform_sidecar_manifest_declares_l0_contract_and_policy():
    manifest = get_platform_sidecar_manifest(platform="diagnostic-local")

    assert manifest["schemaVersion"] == PLATFORM_SIDECAR_MANIFEST_SCHEMA
    assert manifest["layer"] == "L0 platform backend"
    assert manifest["ownerPackage"] == "packages/actions/computer-use"
    assert manifest["platform"] == "diagnostic-local"
    assert [tool["name"] for tool in manifest["tools"]] == ["preflight", "capture", "state", "execute"]
    assert manifest["permissionRequirements"]["requiredRefs"] == [
        "sessionPermissionRef",
        "appWindowAllowlistRef",
        "riskPreviewRef",
        "dataVisibilityRef",
        "stopRef or cancelLeaseRef",
    ]
    assert manifest["isolationFlags"]["sharedSystemInputUsed"] is False
    assert manifest["isolationFlags"]["systemPointerMoved"] is False
    assert manifest["isolationFlags"]["systemKeyboardEventsSent"] is False
    assert manifest["supportedInputModalities"] == ["pointer", "keyboard", "scroll", "hotkey"]
    assert manifest["executorEventSchema"]["schemaRef"] == PLATFORM_EXECUTOR_EVENT_SCHEMA
    assert manifest["executorEventSchema"]["schedulerLeaseBindingRequired"] is True
    assert "schedulerLeaseRef" in manifest["executorEventSchema"]["requiredFields"]
    assert "schedulerLease" in manifest["executorEventSchema"]["requiredFields"]
    assert "planning" in manifest["unsupportedActions"]
    assert "user-level-completion" in manifest["unsupportedActions"]
    assert manifest["policies"]["noPlanning"] is True
    assert manifest["policies"]["noCompletion"] is True
    assert manifest["policies"]["noGuiDependency"] is True
    assert manifest["policies"]["noRuntimePrivateDependency"] is True


def test_action_provider_manifest_exposes_platform_sidecar_contract():
    action_manifest = json.loads(ACTION_MANIFEST.read_text(encoding="utf8"))
    sidecar_contract = action_manifest["platformSidecarContract"]

    assert sidecar_contract["schemaRef"] == PLATFORM_SIDECAR_MANIFEST_SCHEMA
    assert sidecar_contract["manifestHelper"] == "sciforge_computer_use.platform_sidecar.get_platform_sidecar_manifest"
    assert sidecar_contract["dispatcherHelper"] == "sciforge_computer_use.platform_sidecar.dispatch_platform_sidecar_tool"
    assert sidecar_contract["validator"] == "sciforge_computer_use.platform_sidecar.validate_platform_sidecar_payload"
    assert sidecar_contract["tools"] == ["preflight", "capture", "state", "execute"]
    assert sidecar_contract["executorEventSchema"]["schedulerLeaseBindingRequired"] is True
    assert sidecar_contract["policies"]["noSchedulerBypass"] is True
    assert "platformSidecarDiagnostic" in action_manifest["hostPortsContract"]["diagnosticProbes"]
    assert "platformSidecarProbe" in action_manifest["entrypoint"]
    native_live_protocol = action_manifest["hostPortsContract"]["nativeMultiScreenSidecarProtocol"]
    assert native_live_protocol["callSchema"] == "sciforge.computer-use.native-sidecar-dispatch-call.v1"
    assert native_live_protocol["requiredDiscoveryTools"] == ["capabilities", "discover"]
    assert native_live_protocol["requiredExecutionTools"] == ["preflight", "capture", "state", "execute"]
    assert "sidecarCapabilitiesRef" in native_live_protocol["completedRunRequiredRefs"]
    assert "multi-actor-cursor" in native_live_protocol["completedRunRequiredCapabilities"]


def test_preflight_returns_permission_and_isolation_refs_when_backend_missing(tmp_path):
    result = dispatch_platform_sidecar_tool(
        "preflight",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "sessionPermissionRef": "permission:session/main.json",
            "appWindowAllowlistRef": "permission:allowlist/main.json",
            "riskPreviewRef": "permission:risk/main.json",
            "dataVisibilityRef": "permission:data/main.json",
            "stopRef": "permission:stop/main.json",
            "allowedWindowRefs": ["window:editor/main.json"],
            "inputModalityPolicy": {
                "allowed": ["pointer", "keyboard"],
                "sharedSystemInputAllowed": False,
            },
        },
        output_dir=tmp_path,
    )

    assert result["status"] == "blocked"
    assert result["diagnosticOnly"] is True
    assert result["userAcceptanceEligible"] is False
    assert result["planningPerformed"] is False
    assert result["completionJudged"] is False
    permission_ref = Path(result["value"]["permissionPreflightRef"])
    isolation_ref = Path(result["value"]["isolationReportRef"])
    assert permission_ref.is_file()
    assert isolation_ref.is_file()

    permission = json.loads(permission_ref.read_text(encoding="utf8"))
    isolation = json.loads(isolation_ref.read_text(encoding="utf8"))
    assert permission["schemaVersion"] == PLATFORM_PERMISSION_PREFLIGHT_SCHEMA
    assert permission["status"] == "blocked"
    assert any("No real platform backend" in reason for reason in permission["blockedReasons"])
    assert isolation["schemaVersion"] == PLATFORM_ISOLATION_REPORT_SCHEMA
    assert isolation["sharedSystemInputUsed"] is False
    assert isolation["systemPointerMoved"] is False
    assert isolation["systemKeyboardEventsSent"] is False


def test_capture_and_state_calls_are_refs_first_blocked_diagnostics(tmp_path):
    capture = dispatch_platform_sidecar_tool(
        "capture",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "windowId": "window-a",
            "permissionPreflightRef": "permission:preflight/main.json",
        },
        output_dir=tmp_path,
    )
    state = dispatch_platform_sidecar_tool(
        "state",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "windowId": "window-a",
            "permissionPreflightRef": "permission:preflight/main.json",
        },
        output_dir=tmp_path,
    )

    assert capture["status"] == "blocked"
    assert state["status"] == "blocked"
    capture_snapshot = json.loads(Path(capture["value"]["captureSnapshotRef"]).read_text(encoding="utf8"))
    state_snapshot = json.loads(Path(state["value"]["stateSnapshotRef"]).read_text(encoding="utf8"))
    assert capture_snapshot["schemaVersion"] == PLATFORM_CAPTURE_SNAPSHOT_SCHEMA
    assert capture_snapshot["screenshotRef"] is None
    assert capture_snapshot["rawScreenshotWritten"] is False
    assert state_snapshot["schemaVersion"] == PLATFORM_STATE_SNAPSHOT_SCHEMA
    assert state_snapshot["accessibilityStateRef"] is None
    assert state_snapshot["rawPayloadWritten"] is False
    assert all(Path(ref).is_file() for ref in capture["refs"])
    assert all(Path(ref).is_file() for ref in state["refs"])


def test_execute_writes_scheduler_lease_bound_blocked_executor_event(tmp_path):
    result = dispatch_platform_sidecar_tool(
        "execute",
        lease_bound_execute_payload(),
        output_dir=tmp_path,
    )

    assert result["status"] == "blocked"
    assert result["sharedSystemInputUsed"] is False
    assert result["systemPointerMoved"] is False
    assert result["systemKeyboardEventsSent"] is False
    event_ref = Path(result["value"]["executorEventRef"])
    event = json.loads(event_ref.read_text(encoding="utf8"))
    assert event["schemaVersion"] == PLATFORM_EXECUTOR_EVENT_SCHEMA
    assert event["status"] == "blocked"
    assert event["leaseId"] == "lease-window-a-agent-1"
    assert event["schedulerLeaseRef"] == "lease:window-a/lease-window-a-agent-1.json"
    assert event["schedulerLease"]["leaseRef"] == event["schedulerLeaseRef"]
    assert event["schedulerLease"]["leaseId"] == event["leaseId"]
    assert event["schedulerLease"]["leaseScope"] == event["leaseScope"]
    assert event["actorId"] == "agent-1"
    assert event["cursorId"] == "cursor-1"
    assert event["mutatingActionExecuted"] is False
    assert event["diagnosticOnly"] is True


def test_execute_refuses_executor_event_without_scheduler_lease(tmp_path):
    payload = lease_bound_execute_payload()
    payload.pop("schedulerLeaseRef")

    result = dispatch_platform_sidecar_tool("execute", payload, output_dir=tmp_path)

    assert result["status"] == "blocked"
    assert result["value"]["executorEventRef"] is None
    assert result["validation"]["reason"] == "missing_required_fields"
    assert "schedulerLeaseRef" in result["validation"]["missingFields"]
    blocked = json.loads(Path(result["value"]["blockedDiagnosticRef"]).read_text(encoding="utf8"))
    assert blocked["executorEventRef"] is None
    assert blocked["requiresSchedulerLease"] is True


def test_sidecar_rejects_inline_sensitive_payloads():
    validation = validate_platform_sidecar_payload(
        "capture",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "permissionPreflightRef": "permission:preflight/main.json",
            "rawScreenshot": "data:image/png;base64,abc",
            "metadata": {"token": "do-not-write"},
        },
    )

    assert validation["ok"] is False
    assert validation["reason"] == "forbidden_inline_payload"
    assert "$.rawScreenshot" in validation["forbiddenPaths"]
    assert "$.metadata.token" in validation["forbiddenPaths"]


def test_platform_sidecar_has_no_gui_runtime_or_policy_imports():
    tree = ast.parse(SIDECAR_MODULE.read_text(encoding="utf8"))
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.add("." * node.level + (node.module or ""))

    forbidden_fragments = (
        "src.runtime",
        "src.ui",
        "packages.presentation",
        "packages.observe",
        "workspace",
        "planner",
        "capability",
        "completion",
        "validator",
    )
    assert not [
        module
        for module in imports
        if any(fragment in module for fragment in forbidden_fragments)
    ]


def test_platform_sidecar_cli_emits_structured_blocked_preflight(tmp_path):
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.platform_sidecar",
            "--tool",
            "preflight",
            "--payload-json",
            json.dumps({"displayGroupId": "dg-main", "screenId": "screen-a"}),
            "--output-dir",
            str(tmp_path),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode == 1
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["schemaVersion"].endswith("platform-sidecar-result.v1")
    assert payload["status"] == "blocked"
    assert payload["value"]["permissionPreflightRef"].endswith(".json")


def lease_bound_execute_payload():
    return {
        "displayGroupId": "dg-main",
        "screenId": "screen-a",
        "windowId": "window-a",
        "actorId": "agent-1",
        "cursorId": "cursor-1",
        "leaseId": "lease-window-a-agent-1",
        "schedulerLeaseRef": "lease:window-a/lease-window-a-agent-1.json",
        "leaseScope": {"kind": "window", "screenId": "screen-a", "windowId": "window-a"},
        "permissionPreflightRef": "permission:preflight/main.json",
        "beforeEvidenceRefs": ["evidence:screen-a/before.json"],
        "groundingRefs": ["grounding:screen-a/target.json"],
        "action": {"kind": "click"},
        "target": {
            "scope": "window",
            "screenId": "screen-a",
            "windowId": "window-a",
            "bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
        },
    }
