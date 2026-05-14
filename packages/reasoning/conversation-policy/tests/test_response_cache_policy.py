import sys
from pathlib import Path

import pytest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from sciforge_conversation.cache_policy import build_cache_policy
from sciforge_conversation.response_plan import build_background_plan, build_response_plan


MODES = [
    "direct-context-answer",
    "thin-reproducible-adapter",
    "single-stage-task",
    "multi-stage-project",
    "repair-or-continue-project",
]


@pytest.mark.parametrize("mode", MODES)
def test_response_and_background_plan_cover_every_execution_mode(mode):
    request = _policy_request(mode=mode, risk="low")

    response = build_response_plan(request)
    background = build_background_plan(request)

    assert response["initialResponseMode"] in {
        "direct-context-answer",
        "quick-status",
        "streaming-draft",
        "wait-for-result",
    }
    assert response["finalizationMode"] in {
        "append-final",
        "replace-draft",
        "update-artifacts-only",
    }
    assert response["userVisibleProgress"]
    assert response["fallbackMessagePolicy"]
    assert isinstance(background["enabled"], bool)
    assert isinstance(background["tasks"], list)
    assert isinstance(background["handoffRefsRequired"], bool)
    assert isinstance(background["cancelOnNewUserTurn"], bool)

    if mode == "direct-context-answer":
        assert response["initialResponseMode"] == "direct-context-answer"
        assert background["enabled"] is False
    if mode == "multi-stage-project":
        assert "output-materialization" in background["tasks"]


@pytest.mark.parametrize(
    ("risk", "expected_initial", "background_enabled"),
    [
        ("low", "quick-status", True),
        ("medium", "quick-status", True),
        ("high", "wait-for-result", False),
    ],
)
def test_response_and_background_plan_cover_risk_levels(risk, expected_initial, background_enabled):
    request = _policy_request(mode="multi-stage-project", risk=risk)

    response = build_response_plan(request)
    background = build_background_plan(request)

    assert response["signals"]["riskLevel"] == risk
    assert response["initialResponseMode"] == expected_initial
    assert background["enabled"] is background_enabled
    if risk == "high":
        assert response["fallbackMessagePolicy"] == "safety-first-status-with-required-confirmation"
        assert background["cancelOnNewUserTurn"] is True


def test_cache_policy_covers_reusable_ref_artifact_stage_and_session():
    request = _policy_request(
        mode="repair-or-continue-project",
        risk="low",
        context_mode="continue",
        include_refs=True,
        include_artifacts=True,
        include_success=True,
    )

    policy = build_cache_policy(request)

    assert policy["reuseScenarioPlan"] is True
    assert policy["reuseSkillPlan"] is True
    assert policy["reuseUiPlan"] is False
    assert policy["reuseReferenceDigests"] is True
    assert policy["reuseArtifactIndex"] is True
    assert policy["reuseLastSuccessfulStage"] is True
    assert policy["reuseBackendSession"] is True
    assert policy["scenarioPlan"]["reuse"] is True
    assert policy["referenceDigests"]["reuse"] is True
    assert policy["lastSuccessfulStage"]["reuse"] is True


def test_cache_policy_blocks_stale_reuse_for_high_risk_or_failure():
    request = _policy_request(
        mode="multi-stage-project",
        risk="high",
        context_mode="continue",
        include_refs=True,
        include_artifacts=True,
        include_success=True,
        recent_failure=True,
    )

    policy = build_cache_policy(request)

    assert policy["reuseScenarioPlan"] is False
    assert policy["reuseSkillPlan"] is False
    assert policy["reuseUiPlan"] is False
    assert policy["reuseLastSuccessfulStage"] is False
    assert policy["reuseBackendSession"] is False
    assert policy["signals"]["recentFailure"] is True


def test_cache_policy_blocks_unresolved_reference_digest_reuse():
    request = _policy_request(mode="thin-reproducible-adapter", risk="low", include_refs=True)
    request["currentReferenceDigests"][0]["status"] = "unresolved"

    policy = build_cache_policy(request)

    assert policy["reuseReferenceDigests"] is False
    assert policy["referenceDigests"]["reuse"] is False


def test_policy_hint_high_risk_action_blocks_background_and_cache_reuse():
    request = _policy_request(mode="multi-stage-project", risk="low", context_mode="continue", include_success=True)
    request["policyInput"] = {
        "policyHints": {
            "selectedActions": [
                {
                    "id": "workspace.delete",
                    "kind": "action",
                    "riskLevel": "high",
                    "sideEffects": ["delete"],
                }
            ]
        }
    }

    response = build_response_plan(request)
    background = build_background_plan(request)
    cache = build_cache_policy(request)

    assert response["signals"]["riskLevel"] == "high"
    assert response["initialResponseMode"] == "wait-for-result"
    assert background["enabled"] is False
    assert cache["reuseScenarioPlan"] is False
    assert cache["reuseBackendSession"] is False


def _policy_request(
    *,
    mode: str,
    risk: str,
    context_mode: str = "continue",
    include_refs: bool = False,
    include_artifacts: bool = False,
    include_success: bool = False,
    recent_failure: bool = False,
):
    risk_flags = []
    if risk in {"medium", "high"}:
        risk_flags.append("code-or-workspace-side-effect")
    if recent_failure:
        risk_flags.append("recent-failure")
    request = {
        "contextPolicy": {"mode": context_mode},
        "handoffMemoryProjection": {"currentReferenceFocus": ["fixtures/sample.md"] if include_refs else []},
        "executionModePlan": {
            "executionMode": mode,
            "stagePlanHint": _stage_hint(mode),
            "riskFlags": risk_flags,
            "signals": ["continuation"] if mode == "repair-or-continue-project" else [],
        },
        "capabilityBrief": {
            "selected": [
                {
                    "id": f"{risk}-capability",
                    "title": f"{risk} capability",
                    "kind": "action" if risk == "high" else "tool",
                    "riskLevel": risk,
                }
            ]
        },
        "currentReferences": [{"kind": "file", "ref": "fixtures/sample.md"}] if include_refs else [],
        "currentReferenceDigests": [
            {"id": "digest-1", "status": "ok", "sourceRef": "fixtures/sample.md"}
        ]
        if include_refs
        else [],
        "artifactIndex": {
            "entries": [{"id": "artifact-1", "ref": "file:out.md", "status": "completed"}]
        }
        if include_artifacts
        else {"entries": []},
        "session": {
            "executionUnits": [
                {"id": "stage-1", "status": "completed", "outputRef": "file:out.md"}
            ]
            if include_success
            else []
        },
        "recentFailures": [{"stageId": "stage-2", "failureReason": "timeout"}]
        if recent_failure
        else [],
    }
    return request


def _stage_hint(mode: str):
    if mode == "direct-context-answer":
        return []
    if mode == "thin-reproducible-adapter":
        return ["search", "fetch", "emit"]
    if mode == "repair-or-continue-project":
        return ["fetch", "analyze", "repair", "validate", "emit"]
    if mode == "multi-stage-project":
        return ["plan", "search", "analyze", "validate", "emit"]
    return ["analyze", "validate", "emit"]
