from sciforge_computer_use import (
    ActionPlan,
    ActionTarget,
    ComputerUseResult,
    ExecutionOutcome,
    Grounding,
    LoopStep,
    Observation,
    Verification,
    result_to_trace,
    validate_trace,
)


def test_trace_promotes_multi_screen_cursor_lease_and_evidence_refs():
    result = ComputerUseResult(
        status="completed",
        reason="done",
        failure_diagnostics={
            "virtualDisplayGroupRef": ".sciforge/vision-runs/ms/virtual-display-group.json",
            "virtualScreensRef": ".sciforge/vision-runs/ms/virtual-screens.json",
            "actorCursorLogRef": ".sciforge/vision-runs/ms/actor-cursors.jsonl",
        },
        steps=[
            LoopStep(
                index=0,
                before=Observation(
                    ref=".sciforge/vision-runs/ms/before.png",
                    summary="Before",
                    metadata={"screenId": "screen-a", "windowId": "writer"},
                ),
                plan=ActionPlan(
                    kind="click",
                    target=ActionTarget(description="Save"),
                    metadata={
                        "leaseScope": {"scopeType": "window", "screenId": "screen-a", "windowId": "writer"},
                        "leaseOwner": {"actorId": "agent-a", "cursorId": "cursor-a"},
                    },
                ),
                grounding=Grounding(ok=True, metadata={"screenId": "screen-a", "windowId": "writer"}),
                execution=ExecutionOutcome(
                    ok=True,
                    metadata={
                        "executorEventRef": ".sciforge/vision-runs/ms/executor-event.json",
                        "leaseScope": {"scopeType": "window", "screenId": "screen-a", "windowId": "writer"},
                        "leaseOwner": {"actorId": "agent-a", "cursorId": "cursor-a"},
                    },
                ),
                after=Observation(
                    ref=".sciforge/vision-runs/ms/after.png",
                    summary="After",
                    metadata={"screenId": "screen-a", "windowId": "writer"},
                ),
                verification=Verification(ok=True, done=True, metadata={"evidenceRef": ".sciforge/vision-runs/ms/verify.json"}),
                status="done",
            )
        ],
        final_observation=Observation(ref=".sciforge/vision-runs/ms/after.png"),
    )

    trace = result_to_trace(result)
    validation = validate_trace(trace)

    assert validation["ok"] is True
    assert trace["visibleScreenRefs"] == [
        ".sciforge/vision-runs/ms/virtual-screens.json",
        ".sciforge/vision-runs/ms/virtual-display-group.json",
    ]
    assert trace["visibleCursorRefs"] == [".sciforge/vision-runs/ms/actor-cursors.jsonl"]
    step = trace["steps"][0]
    assert step["screenId"] == "screen-a"
    assert step["windowId"] == "writer"
    assert step["actorId"] == "agent-a"
    assert step["cursorId"] == "cursor-a"
    assert step["leaseScope"] == {"scopeType": "window", "screenId": "screen-a", "windowId": "writer"}
    assert step["leaseOwner"] == {"actorId": "agent-a", "cursorId": "cursor-a"}
    assert step["executorEventRef"] == ".sciforge/vision-runs/ms/executor-event.json"
    assert ".sciforge/vision-runs/ms/before.png" in step["beforeEvidenceRefs"]
    assert ".sciforge/vision-runs/ms/after.png" in step["afterEvidenceRefs"]
    assert ".sciforge/vision-runs/ms/verify.json" in step["afterEvidenceRefs"]
    assert validation["visibleScreenRefs"] == trace["visibleScreenRefs"]
    assert validation["visibleCursorRefs"] == trace["visibleCursorRefs"]


def test_trace_validation_rejects_provider_payload_and_token_keys():
    validation = validate_trace({
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "bad trace",
        "steps": [{"beforeRef": ".sciforge/vision-runs/ms/before.png"}],
        "rawProviderPayload": {"token": "secret-token"},
    })

    assert validation["ok"] is False
    assert any("rawProviderPayload" in error for error in validation["errors"])
