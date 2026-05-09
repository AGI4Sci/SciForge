import pytest

from sciforge_conversation import REQUEST_SCHEMA_VERSION, handle_payload
from sciforge_conversation.latency_policy import build_latency_policy


def test_build_latency_policy_blocks_failed_verification():
    policy = build_latency_policy(
        {
            "policyInput": {
                "metadata": {
                    "recentFailures": [
                        {
                            "type": "verification",
                            "status": "failed",
                            "failureReason": "schema guard rejected output",
                        }
                    ]
                }
            },
            "executionModePlan": {"executionMode": "single-stage-task", "signals": []},
            "recoveryPlan": {"status": "ready"},
        }
    )

    assert policy["blockOnVerification"] is True
    assert policy["allowBackgroundCompletion"] is False
    assert "failed verification" in policy["reason"]


@pytest.mark.parametrize(
    ("name", "payload", "expected"),
    [
        (
            "direct context",
            {
                "turn": {
                    "text": "Explain what this referenced note means.",
                    "refs": [{"kind": "path", "ref": "/workspace/out/note.md"}],
                }
            },
            {
                "executionMode": "direct-context-answer",
                "allowBackgroundCompletion": False,
                "blockOnContextCompaction": False,
                "blockOnVerification": False,
                "maxFirstVisibleResponseMs": 1200,
                "reason": "direct context",
            },
        ),
        (
            "low-risk continuation",
            {
                "turn": {"text": "继续上一轮，解释最新 artifact 里的结论就好。"},
                "session": {
                    "artifacts": [{"artifactType": "table", "status": "done", "summary": "model metrics"}]
                },
            },
            {
                "executionMode": "repair-or-continue-project",
                "allowBackgroundCompletion": True,
                "blockOnContextCompaction": False,
                "blockOnVerification": False,
                "maxFirstVisibleResponseMs": 1200,
                "reason": "low-risk continuation",
            },
        ),
        (
            "light lookup",
            {
                "turn": {"text": "Search today latest release status and give a brief answer."},
                "policyHints": {
                    "selectedTools": [{"id": "web.search", "summary": "Search current web pages."}]
                },
            },
            {
                "executionMode": "thin-reproducible-adapter",
                "allowBackgroundCompletion": True,
                "blockOnContextCompaction": False,
                "blockOnVerification": False,
                "maxFirstVisibleResponseMs": 3000,
                "reason": "light reproducible lookup",
            },
        ),
        (
            "multi-stage project",
            {
                "turn": {"text": "做一个系统性文献调研，比较近期研究证据，输出报告和证据表。"},
                "policyHints": {
                    "selectedCapabilities": [
                        {"id": "literature.search", "summary": "Search academic sources."}
                    ],
                    "selectedVerifiers": [{"id": "citation.checker", "summary": "Validate citations."}],
                },
            },
            {
                "executionMode": "multi-stage-project",
                "allowBackgroundCompletion": True,
                "blockOnContextCompaction": False,
                "blockOnVerification": True,
                "maxFirstVisibleResponseMs": 3000,
                "reason": "multi-stage work",
            },
        ),
        (
            "repair",
            {
                "turn": {"text": "根据日志修复上一轮失败。"},
                "policyHints": {"failure": {"stageId": "validate", "status": "failed"}},
            },
            {
                "executionMode": "repair-or-continue-project",
                "allowBackgroundCompletion": False,
                "blockOnContextCompaction": False,
                "blockOnVerification": True,
                "maxFirstVisibleResponseMs": 8000,
                "reason": "repair/failure path",
            },
        ),
        (
            "high-risk action",
            {
                "turn": {"text": "删除工作区里过期的发布产物。"},
                "policyHints": {
                    "humanApprovalRequired": True,
                    "selectedActions": [
                        {
                            "id": "workspace.delete",
                            "kind": "action",
                            "summary": "Delete workspace files.",
                            "riskLevel": "high",
                            "sideEffects": ["delete"],
                        }
                    ],
                },
            },
            {
                "allowBackgroundCompletion": False,
                "blockOnContextCompaction": False,
                "blockOnVerification": True,
                "maxFirstVisibleResponseMs": 8000,
                "reason": "human approval required",
            },
        ),
        (
            "context near limit",
            {
                "turn": {
                    "text": "Explain what this referenced note means.",
                    "refs": [{"kind": "path", "ref": "/workspace/out/note.md"}],
                },
                "limits": {"contextBudget": {"remainingTokens": 512, "totalTokens": 128000}},
            },
            {
                "executionMode": "direct-context-answer",
                "allowBackgroundCompletion": False,
                "blockOnContextCompaction": True,
                "blockOnVerification": False,
                "maxFirstVisibleResponseMs": 8000,
                "reason": "context near limit",
            },
        ),
    ],
)
def test_latency_policy_service_fixtures(name, payload, expected):
    request = {"schemaVersion": REQUEST_SCHEMA_VERSION, "requestId": name, **payload}
    response = handle_payload(request)
    policy = response["latencyPolicy"]

    assert policy["schemaVersion"] == "sciforge.conversation.latency-policy.v1"
    if "executionMode" in expected:
        assert response["executionModePlan"]["executionMode"] == expected["executionMode"]
    assert policy["allowBackgroundCompletion"] is expected["allowBackgroundCompletion"]
    assert policy["blockOnContextCompaction"] is expected["blockOnContextCompaction"]
    assert policy["blockOnVerification"] is expected["blockOnVerification"]
    assert policy["firstVisibleResponseMs"] <= expected["maxFirstVisibleResponseMs"]
    assert policy["firstEventWarningMs"] >= policy["firstVisibleResponseMs"]
    assert policy["silentRetryMs"] >= policy["firstEventWarningMs"]
    assert expected["reason"] in policy["reason"]
