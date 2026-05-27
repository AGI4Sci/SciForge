import json

from sciforge_computer_use import (
    ActionPlan,
    ComputerUseRequest,
    ExecutionOutcome,
    Observation,
    Verification,
    result_to_trace,
    run_computer_use_task,
)


class StaticSense:
    def __init__(self):
        self.refs = ["before.png", "after.png"]
        self.calls = 0

    def observe(self, request, history, query=None):
        ref = self.refs[min(self.calls, len(self.refs) - 1)]
        self.calls += 1
        return Observation(ref=ref, summary=ref)

    def locate(self, observation, target, history):
        raise AssertionError("press_key should not require grounding")


class StaticPlanner:
    def plan(self, request, observation, history):
        return ActionPlan(kind="press_key", key="Enter", reason="deterministic action")


class StaticExecutor:
    def execute(self, action, grounding, request):
        return ExecutionOutcome(ok=True, message="executed")


class MetadataVerifier:
    def __init__(self, metadata):
        self.metadata = metadata

    def verify(self, request, before, after, action, execution, history):
        return Verification(
            ok=True,
            done=True,
            reason="deterministic verifier accepted",
            changed=True,
            metadata=self.metadata,
        )


def test_semantic_verifier_metadata_is_summarized_without_raw_payloads():
    result = run_computer_use_task(
        ComputerUseRequest(task="submit local form", max_steps=1),
        StaticSense(),
        StaticPlanner(),
        StaticExecutor(),
        MetadataVerifier({
            "semanticVerifier": {
                "providerId": "host-vlm",
                "modelId": "local-vision-verifier",
                "verdict": "pass",
                "confidence": 0.82,
                "rationale": "after screenshot shows submitted state",
                "evidenceRefs": ["artifact:verifier/evidence.json", "after.png"],
                "rawResponse": {"tokenLogprobs": [1, 2, 3]},
            },
            "rawPayload": {"debug": "drop me"},
            "hostTraceRef": "trace:host/verifier.json",
        }),
    )

    trace = result_to_trace(result)
    verification = trace["steps"][0]["verification"]
    semantic = verification["metadata"]["semanticVerifier"]

    assert result.status == "completed"
    assert semantic == {
        "schemaVersion": "sciforge.computer-use.semantic-verifier.v1",
        "providerIds": ["host-vlm"],
        "modelIds": ["local-vision-verifier"],
        "verdict": "pass",
        "reason": "after screenshot shows submitted state",
        "confidence": 0.82,
        "evidenceRefs": ["artifact:verifier/evidence.json", "after.png"],
        "traceRefs": [],
    }
    assert verification["metadata"]["hostTraceRef"] == "trace:host/verifier.json"
    serialized = json.dumps(trace)
    assert "rawResponse" not in serialized
    assert "rawPayload" not in serialized
    assert "tokenLogprobs" not in serialized


def test_inline_image_in_verifier_metadata_fails_closed_before_trace_payload():
    result = run_computer_use_task(
        ComputerUseRequest(task="submit local form", max_steps=1),
        StaticSense(),
        StaticPlanner(),
        StaticExecutor(),
        MetadataVerifier({
            "semanticVerifier": {
                "providerId": "host-vlm",
                "imageBase64": "AAAA",
            },
        }),
    )

    trace = result_to_trace(result)

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["failedStage"] == "verification"
    assert "inline image/base64 payloads" in result.reason
    assert trace["steps"][0]["verification"]["metadata"] == {}
    assert "imageBase64" not in json.dumps(trace)
