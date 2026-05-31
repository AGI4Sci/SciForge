import json
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use.mcp_server import handle_mcp_request
from sciforge_computer_use.native_tool import (
    NATIVE_TOOL_MANIFEST_SCHEMA,
    dispatch_native_tool,
    get_mcp_tool_schemas,
    get_native_tool_manifest,
    validate_native_tool_payload,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_TOOLS = [
    "get_app_state",
    "observe",
    "click",
    "type_text",
    "scroll",
    "press_key",
    "propose_action",
    "execute_scoped_action",
    "get_replay_refs",
]


def scoped_payload(**extra):
    payload = {
        "displayGroupId": "dg-main",
        "screenId": "screen-a",
        "windowId": "window-a",
        "actorId": "agent-1",
        "cursorId": "cursor-1",
        "target": {
            "scope": "window",
            "screenId": "screen-a",
            "windowId": "window-a",
            "bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
        },
        "appStateRef": "app-state:screen-a/window-a.json",
        "screenshotRef": "screenshot:screen-a/window-a.png",
        "accessibilitySnapshotRef": "accessibility:screen-a/window-a.json",
        "beforeEvidenceRefs": ["evidence:screen-a/before.json"],
        "groundingRefs": ["grounding:screen-a/target.json"],
    }
    payload.update(extra)
    return payload


def test_native_tool_manifest_declares_stable_public_cu_surface():
    manifest = get_native_tool_manifest()

    assert manifest["schemaVersion"] == NATIVE_TOOL_MANIFEST_SCHEMA
    assert manifest["productionHost"] == "Codex app-server native tool/plugin/MCP"
    assert manifest["guiExecutesActions"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert [tool["name"] for tool in manifest["tools"]] == PUBLIC_TOOLS

    execute_tool = next(tool for tool in manifest["tools"] if tool["name"] == "execute_scoped_action")
    assert "proposalRef" in execute_tool["requiredFields"]
    assert "appStateRef" in execute_tool["requiredFields"]
    assert "leaseId" not in execute_tool["requiredFields"]
    assert "executorAdapterRef" not in execute_tool["requiredFields"]
    assert "move_cursor-public-tool" in manifest["unsupported"]
    assert "bare-global-coordinate-execute" in manifest["unsupported"]
    assert "provider-route-parameter" in manifest["unsupported"]


def test_mcp_tool_schemas_match_native_public_surface():
    schemas = get_mcp_tool_schemas()

    assert [schema["name"] for schema in schemas] == PUBLIC_TOOLS
    click_schema = next(schema for schema in schemas if schema["name"] == "click")
    assert "appStateRef" in click_schema["inputSchema"]["required"]
    assert "leaseId" not in click_schema["inputSchema"]["required"]


def test_native_tool_rejects_missing_screen_and_inline_sensitive_payload():
    missing_screen = validate_native_tool_payload("observe", {"displayGroupId": "dg-main"})

    assert missing_screen == {
        "ok": False,
        "reason": "missing_required_fields",
        "missingFields": ["screenId"],
    }

    sensitive = validate_native_tool_payload(
        "observe",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "rawScreenshot": "data:image/png;base64,abc",
            "metadata": {"Authorization": "Bearer secret"},
        },
    )

    assert sensitive["ok"] is False
    assert sensitive["reason"] == "forbidden_inline_payload"
    assert "$.rawScreenshot" in sensitive["forbiddenPaths"]
    assert "$.metadata.Authorization" in sensitive["forbiddenPaths"]


def test_move_cursor_is_not_public_native_tool():
    validation = validate_native_tool_payload(
        "move_cursor",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "actorId": "agent-1",
            "cursorId": "cursor-1",
            "position": {"x": 12, "y": 24},
        },
    )

    assert validation == {"ok": False, "reason": "unsupported_tool:move_cursor"}


def test_propose_action_rejects_bare_global_coordinates_and_public_internals():
    global_target = validate_native_tool_payload(
        "propose_action",
        {
            "screenId": "screen-a",
            "actorId": "agent-1",
            "cursorId": "cursor-1",
            "action": {"kind": "click"},
            "target": {"scope": "screen", "coordinateSpace": "global", "x": 1, "y": 2},
        },
    )

    assert global_target["ok"] is False
    assert global_target["reason"] == "bare_global_coordinate_target"

    private_state = validate_native_tool_payload(
        "propose_action",
        {
            "screenId": "screen-a",
            "actorId": "agent-1",
            "cursorId": "cursor-1",
            "providerRoute": "private-route",
            "action": {"kind": "click"},
            "target": {"scope": "window", "windowId": "window-a"},
        },
    )

    assert private_state["ok"] is False
    assert private_state["reason"] == "forbidden_public_parameter"
    assert "$.providerRoute" in private_state["forbiddenPaths"]


def test_high_risk_proposal_needs_confirmation_before_executor_event(tmp_path):
    result = dispatch_native_tool(
        "propose_action",
        {
            "displayGroupId": "dg-main",
            "screenId": "screen-a",
            "windowId": "window-a",
            "actorId": "agent-1",
            "cursorId": "cursor-1",
            "riskLevel": "high",
            "action": {"kind": "click"},
            "target": {
                "scope": "window",
                "screenId": "screen-a",
                "windowId": "window-a",
                "bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
            },
        },
        output_dir=tmp_path,
    )

    assert result["status"] == "needs-confirmation"
    assert result["approvalRequest"]["riskLevel"] == "high"
    assert result["value"]["actionProposalRef"].endswith(".json")
    assert result["value"]["approvalRequestRef"].endswith(".json")
    assert not any("executor-event" in ref for ref in result["refs"])


def test_click_facade_projects_to_scoped_refs_without_public_internals(tmp_path):
    result = dispatch_native_tool("click", scoped_payload(), output_dir=tmp_path)

    assert result["status"] == "blocked"
    assert result["diagnosticOnly"] is True
    assert result["userAcceptanceEligible"] is False
    assert result["value"]["actionProposalRef"].endswith(".json")
    assert result["value"]["executorLeaseRef"].endswith(".json")
    assert result["value"]["executorEventRef"].endswith(".json")
    assert result["value"]["blockedManifestRef"].endswith(".json")

    proposal = json.loads(Path(result["value"]["actionProposalRef"]).read_text(encoding="utf8"))
    lease = json.loads(Path(result["value"]["executorLeaseRef"]).read_text(encoding="utf8"))
    executor_event = json.loads(Path(result["value"]["executorEventRef"]).read_text(encoding="utf8"))
    assert proposal["publicFacadeTool"] == "click"
    assert lease["publicSchedulerInternalsExposed"] is False
    assert lease["leaseScope"]["kind"] == "window"
    assert executor_event["mutatingActionExecuted"] is False
    assert executor_event["sharedSystemInputUsed"] is False
    assert executor_event["executorProjection"]["providerRoutePublicParameter"] is False
    assert "executorAdapterRef" not in executor_event


def test_mutating_facade_rejects_public_scheduler_and_executor_parameters():
    validation = validate_native_tool_payload(
        "click",
        scoped_payload(
            leaseId="lease-window-a-agent-1",
            leaseScope={"kind": "window", "windowId": "window-a"},
            executorAdapterRef="executor-adapter:host/window-a",
            guiPrivateState={"selectedNode": "private"},
        ),
    )

    assert validation["ok"] is False
    assert validation["reason"] == "forbidden_public_parameter"
    assert "$.leaseId" in validation["forbiddenPaths"]
    assert "$.leaseScope" in validation["forbiddenPaths"]
    assert "$.executorAdapterRef" in validation["forbiddenPaths"]
    assert "$.guiPrivateState" in validation["forbiddenPaths"]


def test_execute_scoped_action_records_blocked_diagnostic_refs(tmp_path):
    result = dispatch_native_tool(
        "execute_scoped_action",
        scoped_payload(
            proposalRef="computer-use-native:action-proposal/proposal-a.json",
            action={"kind": "click"},
        ),
        output_dir=tmp_path,
    )

    assert result["status"] == "blocked"
    assert result["diagnosticOnly"] is True
    assert result["userAcceptanceEligible"] is False
    executor_event = json.loads(Path(result["value"]["executorEventRef"]).read_text(encoding="utf8"))
    assert executor_event["proposalRef"] == "computer-use-native:action-proposal/proposal-a.json"
    assert executor_event["mutatingActionExecuted"] is False
    assert executor_event["sharedSystemInputUsed"] is False
    assert executor_event["leaseScope"]["kind"] == "window"


def test_native_tool_results_do_not_become_internal_task_brain(tmp_path):
    forbidden_keys = {
        "nextStep",
        "next_step",
        "crossModulePlan",
        "cross_module_plan",
        "pipelineDecision",
        "pipeline_decision",
        "userLevelCompletion",
        "user_level_completion",
        "finalAnswer",
        "final_answer",
        "guiIntent",
        "gui_intent",
    }

    results = [
        dispatch_native_tool(
            "get_app_state",
            {"displayGroupId": "dg-main", "screenId": "screen-a"},
            output_dir=tmp_path,
        ),
        dispatch_native_tool(
            "propose_action",
            {
                "displayGroupId": "dg-main",
                "screenId": "screen-a",
                "windowId": "window-a",
                "actorId": "agent-1",
                "cursorId": "cursor-1",
                "action": {"kind": "click"},
                "target": {
                    "scope": "window",
                    "screenId": "screen-a",
                    "windowId": "window-a",
                    "bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
                },
            },
            output_dir=tmp_path,
        ),
        dispatch_native_tool("click", scoped_payload(), output_dir=tmp_path),
    ]

    for result in results:
        assert forbidden_keys.isdisjoint(result.keys())
        assert forbidden_keys.isdisjoint(result["value"].keys())
        assert result["diagnosticOnly"] is True
        assert result["userAcceptanceEligible"] is False


def test_replay_refs_reject_placeholder_only_frame():
    validation = validate_native_tool_payload(
        "get_replay_refs",
        {
            "displayGroupId": "dg-main",
            "frames": [{"screenId": "screen-a", "placeholder": True}],
        },
    )

    assert validation["ok"] is False
    assert validation["reason"] == "placeholder_only_replay_frame"


def test_mcp_server_lists_and_calls_stable_tools(tmp_path):
    listed = handle_mcp_request({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert [tool["name"] for tool in listed["result"]["tools"]] == PUBLIC_TOOLS

    called = handle_mcp_request(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "click",
                "arguments": scoped_payload(),
            },
        },
        output_dir=tmp_path,
    )

    structured = called["result"]["structuredContent"]
    assert structured["tool"] == "click"
    assert structured["status"] == "blocked"
    assert structured["value"]["executorEventRef"].endswith(".json")


def test_native_tool_cli_emits_structured_result(tmp_path):
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.native_tool",
            "--tool",
            "get_app_state",
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

    assert completed.returncode == 0
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["status"] == "completed"
    assert payload["value"]["appStateRef"]
    assert payload["value"]["visibleScreenRefs"]
