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
        response = response_from_json(payload)

        self.assertEqual(response.status, "ok")
        self.assertEqual(response.goalSnapshot["taskRelation"], "continue")
        self.assertEqual(response.contextPolicy["mode"], "continue")
        self.assertEqual(response.capabilityBrief["selected"], [])
        self.assertEqual(to_json_dict(response)["schemaVersion"], RESPONSE_SCHEMA_VERSION)

    def test_service_matches_basic_golden_fixture(self):
        request = _read_fixture("request_basic.json")
        expected = _read_fixture("response_basic.json")
        result = handle_payload(request)

        self.assertEqual(result["schemaVersion"], expected["schemaVersion"])
        self.assertEqual(result["requestId"], expected["requestId"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["goalSnapshot"]["taskRelation"], "continue")
        self.assertEqual(result["contextPolicy"]["mode"], "continue")
        self.assertEqual(result["memoryPlan"]["schemaVersion"], "sciforge.conversation.memory-plan.v1")
        self.assertEqual(result["handoffPlan"]["status"], "ready")
        self.assertEqual(result["executionModePlan"]["executionMode"], "repair-or-continue-project")
        self.assertIn("capabilityBrief", result)
        self.assertNotIn("capabilityBriefs", result)
        self.assertTrue(result["userVisiblePlan"])

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
