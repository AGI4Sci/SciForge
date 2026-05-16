import json
import subprocess
import sys
import unittest
from dataclasses import is_dataclass
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = PACKAGE_ROOT / "tests" / "fixtures"
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from sciforge_conversation import (
    REQUEST_JSON_SCHEMA,
    REQUEST_SCHEMA_VERSION,
    RESPONSE_JSON_SCHEMA,
    RESPONSE_SCHEMA_VERSION,
    CapabilityBrief,
    CapabilityManifest,
    ContextPolicy,
    ConversationPolicyRequest,
    ConversationPolicyResponse,
    ConversationTurn,
    GoalSnapshot,
    HandoffPlan,
    ProcessStage,
    Reference,
    handle_payload,
    request_from_json,
    response_from_json,
    to_json_dict,
)


class ConversationPolicyContractTest(unittest.TestCase):
    def test_contract_types_are_dataclasses(self):
        for contract in (
            Reference,
            ConversationTurn,
            CapabilityManifest,
            ConversationPolicyRequest,
            GoalSnapshot,
            ContextPolicy,
            CapabilityBrief,
            HandoffPlan,
            ProcessStage,
            ConversationPolicyResponse,
        ):
            self.assertTrue(is_dataclass(contract), contract.__name__)

    def test_schema_constants_are_versioned(self):
        self.assertEqual(REQUEST_SCHEMA_VERSION, "sciforge.conversation-policy.request.v1")
        self.assertEqual(RESPONSE_SCHEMA_VERSION, "sciforge.conversation-policy.response.v1")
        self.assertEqual(REQUEST_JSON_SCHEMA["$id"], REQUEST_SCHEMA_VERSION)
        self.assertEqual(RESPONSE_JSON_SCHEMA["$id"], RESPONSE_SCHEMA_VERSION)

    def test_request_fixture_round_trips(self):
        payload = _read_fixture("request_basic.json")
        request = request_from_json(payload)

        self.assertEqual(request.requestId, "fixture-request-001")
        self.assertEqual(request.turn.refs[0].kind, "path")
        self.assertEqual(request.history[1].turnId, "turn-002")
        self.assertEqual(request.capabilities[0].id, "reference-digest")
        self.assertEqual(to_json_dict(request)["schemaVersion"], REQUEST_SCHEMA_VERSION)

    def test_response_fixture_round_trips(self):
        payload = _read_fixture("response_basic.json")
        payload["turnExecutionConstraints"] = {
            "schemaVersion": "sciforge.turn-execution-constraints.v1",
            "policyId": "sciforge.current-turn-execution-constraints.v1",
            "source": "runtime-contract.turn-constraints",
            "contextOnly": True,
            "agentServerForbidden": True,
        }
        response = response_from_json(payload)

        self.assertEqual(response.status, "ok")
        self.assertEqual(response.goalSnapshot["taskRelation"], "continue")
        self.assertEqual(response.contextPolicy["mode"], "continue")
        self.assertEqual(response.capabilityBrief["selected"], [])
        self.assertTrue(response.turnExecutionConstraints["agentServerForbidden"])
        self.assertEqual(to_json_dict(response)["schemaVersion"], RESPONSE_SCHEMA_VERSION)

    def test_response_preserves_direct_context_decision(self):
        payload = _read_fixture("response_basic.json")
        payload["directContextDecision"] = {
            "schemaVersion": "sciforge.direct-context-decision.v1",
            "decisionRef": "decision:conversation-policy:refs",
            "decisionOwner": "harness-policy",
            "intent": "run-diagnostic",
            "requiredTypedContext": ["run-trace", "execution-units", "failure-evidence"],
            "usedRefs": ["execution-unit:EU-old"],
            "sufficiency": "sufficient",
            "allowDirectContext": True,
        }

        response = response_from_json(payload)
        result = to_json_dict(response)

        self.assertEqual(result["directContextDecision"]["decisionRef"], "decision:conversation-policy:refs")

    def test_response_legacy_projection_field_is_migration_alias_only(self):
        payload = _read_fixture("response_basic.json")
        legacy_projection = {"schemaVersion": "sciforge.conversation.handoff-memory-projection.v1"}
        payload.pop("contextProjection")
        payload["handoffMemoryProjection"] = legacy_projection

        response = response_from_json(payload)
        result = to_json_dict(response)

        self.assertNotIn("handoffMemoryProjection", result)
        self.assertEqual(result["contextProjection"]["schemaVersion"], legacy_projection["schemaVersion"])
        self.assertEqual(result["contextProjection"]["migrationAlias"]["from"], "handoffMemoryProjection")

    def test_service_matches_basic_golden_fixture(self):
        request = _read_fixture("request_basic.json")
        expected = _read_fixture("response_basic.json")
        result = handle_payload(request)

        self.assertEqual(result["schemaVersion"], expected["schemaVersion"])
        self.assertEqual(result["requestId"], expected["requestId"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["goalSnapshot"]["taskRelation"], "continue")
        self.assertEqual(result["contextPolicy"]["mode"], "continue")
        self.assertEqual(result["contextProjection"]["schemaVersion"], "sciforge.conversation.context-projection.v1")
        self.assertNotIn("handoffMemoryProjection", result)
        self.assertEqual(result["handoffPlan"]["status"], "ready")
        self.assertEqual(result["executionModePlan"]["executionMode"], "repair-or-continue-project")
        self.assertIn("turnExecutionConstraints", result)
        self.assertEqual(result["latencyPolicy"]["schemaVersion"], "sciforge.conversation.latency-policy.v1")
        self.assertEqual(result["responsePlan"]["schemaVersion"], "sciforge.conversation.response-plan.v1")
        self.assertEqual(result["backgroundPlan"]["schemaVersion"], "sciforge.conversation.background-plan.v1")
        self.assertEqual(result["cachePolicy"]["schemaVersion"], "sciforge.conversation.cache-policy.v1")
        self.assertIn("initialResponseMode", result["responsePlan"])
        self.assertIn("enabled", result["backgroundPlan"])
        self.assertIn("reuseReferenceDigests", result["cachePolicy"])
        self.assertIn("capabilityBrief", result)
        self.assertNotIn("capabilityBriefs", result)
        self.assertTrue(result["userVisiblePlan"])

    def test_service_keeps_fresh_failure_reporting_request_out_of_repair_mode(self):
        result = handle_payload({
            "schemaVersion": REQUEST_SCHEMA_VERSION,
            "requestId": "fresh-provider-failure-reporting",
            "turn": {
                "role": "user",
                "turnId": "turn-fresh",
                "text": (
                    "请用最小检索验证 arXiv 是否可访问：搜索 CRISPR prime editing review，"
                    "返回 3 篇候选论文标题和来源；如果外部 provider 不可用，"
                    "请给出可恢复失败原因，不要编造结果。"
                ),
                "refs": [],
            },
            "history": [],
            "capabilities": [{
                "id": "literature.search",
                "title": "Literature search",
                "keywords": ["literature", "search"],
                "inputTypes": ["query"],
                "outputTypes": ["paper-list"],
                "riskLevel": "low",
                "internalAgent": False,
            }],
            "policyHints": {
                "requiredArtifacts": [],
            },
        })

        self.assertEqual(result["goalSnapshot"]["taskRelation"], "new-task")
        self.assertNotEqual(result["goalSnapshot"]["goalType"], "repair")
        self.assertNotEqual(result["contextPolicy"]["mode"], "repair")
        self.assertNotEqual(result["executionModePlan"]["executionMode"], "repair-or-continue-project")

    def test_service_emits_no_execution_turn_constraints(self):
        request = {
            "schemaVersion": REQUEST_SCHEMA_VERSION,
            "requestId": "no-exec-current-ref",
            "turn": {
                "text": "Do not rerun or dispatch AgentServer; use current refs only.",
                "refs": [{"kind": "path", "ref": "reports/current.md"}],
            },
        }
        result = handle_payload(request)

        self.assertEqual(result["turnExecutionConstraints"]["executionModeHint"], "direct-context-answer")
        self.assertTrue(result["turnExecutionConstraints"]["agentServerForbidden"])
        self.assertEqual(result["executionModePlan"]["executionMode"], "direct-context-answer")
        self.assertEqual(result["directContextDecision"]["decisionOwner"], "harness-policy")
        self.assertEqual(result["directContextDecision"]["intent"], "context-summary")
        self.assertEqual(result["directContextDecision"]["usedRefs"], ["reports/current.md"])

    def test_service_emits_run_diagnostic_direct_context_decision_for_selected_execution_unit(self):
        request = {
            "schemaVersion": REQUEST_SCHEMA_VERSION,
            "requestId": "selected-execution-unit-no-exec",
            "turn": {
                "text": "Use selected current refs only.",
                "refs": [{"kind": "execution-unit", "ref": "execution-unit:EU-failed"}],
            },
            "session": {
                "executionUnits": [{
                    "id": "EU-failed",
                    "ref": "execution-unit:EU-failed",
                    "status": "repair-needed",
                    "failureReason": "bounded failure",
                    "outputRef": ".sciforge/task-results/failed.json",
                }],
            },
            "tsDecisions": {
                "turnExecutionConstraints": {
                    "schemaVersion": "sciforge.turn-execution-constraints.v1",
                    "policyId": "sciforge.current-turn-execution-constraints.v1",
                    "source": "runtime-contract.turn-constraints",
                    "contextOnly": True,
                    "agentServerForbidden": True,
                    "workspaceExecutionForbidden": True,
                    "externalIoForbidden": True,
                    "codeExecutionForbidden": True,
                    "preferredCapabilityIds": ["runtime.direct-context-answer"],
                    "executionModeHint": "direct-context-answer",
                    "initialResponseModeHint": "direct-context-answer",
                }
            },
        }

        result = handle_payload(request)

        self.assertEqual(result["executionModePlan"]["executionMode"], "direct-context-answer")
        self.assertEqual(result["directContextDecision"]["intent"], "run-diagnostic")
        self.assertEqual(result["directContextDecision"]["usedRefs"], ["execution-unit:EU-failed"])
        self.assertEqual(
            result["directContextDecision"]["requiredTypedContext"],
            ["run-trace", "execution-units", "failure-evidence"],
        )

    def test_service_routes_answer_only_continuation_to_direct_context(self):
        result = handle_payload({
            "schemaVersion": REQUEST_SCHEMA_VERSION,
            "requestId": "answer-only-continuation",
            "turn": {
                "text": (
                    "Continue previous answer: compress the three points into one checklist "
                    "and explicitly reuse the previous conclusion. No new search, no code."
                ),
                "refs": [],
            },
            "session": {
                "messages": [{"id": "msg-prior", "role": "scenario"}],
                "runs": [{"id": "run-prior", "status": "completed"}],
                "artifacts": [{"id": "research-report", "type": "research-report"}],
                "executionUnits": [],
            },
        })

        self.assertEqual(result["goalSnapshot"]["taskRelation"], "continue")
        self.assertEqual(result["executionModePlan"]["executionMode"], "direct-context-answer")
        self.assertTrue(result["turnExecutionConstraints"]["agentServerForbidden"])
        self.assertEqual(result["directContextDecision"]["decisionOwner"], "harness-policy")
        self.assertIn("artifact:research-report", result["directContextDecision"]["usedRefs"])
        self.assertEqual(result["responsePlan"]["initialResponseMode"], "direct-context-answer")

    def test_service_returns_structured_stdio_json(self):
        request_text = json.dumps(_read_fixture("request_basic.json"))
        completed = subprocess.run(
            [sys.executable, "-m", "sciforge_conversation.service"],
            input=request_text,
            text=True,
            capture_output=True,
            cwd=PACKAGE_ROOT,
            check=True,
            env={"PYTHONPATH": str(PACKAGE_ROOT / "src")},
        )

        response = json.loads(completed.stdout)
        self.assertEqual(response["schemaVersion"], RESPONSE_SCHEMA_VERSION)
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["requestId"], "fixture-request-001")

    def test_rejects_unsupported_request_schema(self):
        payload = _read_fixture("request_basic.json")
        payload["schemaVersion"] = "sciforge.conversation-policy.request.v0"

        with self.assertRaises(ValueError):
            request_from_json(payload)


def _read_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
