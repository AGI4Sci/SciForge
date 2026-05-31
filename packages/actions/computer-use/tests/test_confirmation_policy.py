from sciforge_computer_use.confirmation_policy import (
    classify_action_plan_for_confirmation,
    classify_mapping_for_confirmation,
    validate_confirmation_boundary,
)
from sciforge_computer_use.contracts import ActionPlan, ActionTarget
from sciforge_computer_use.safety import assess_action_risk


def test_confirmation_taxonomy_maps_common_risk_categories_to_action_time_modes():
    cases = [
        (
            ActionPlan(kind="click", target=ActionTarget(description="Delete selected file")),
            "destructive-delete",
            "needs-confirmation",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Upload report to external portal")),
            "upload",
            "needs-confirmation",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Send message to customer")),
            "external-message",
            "needs-confirmation",
        ),
        (
            ActionPlan(kind="type_text", target=ActionTarget(description="Login password field"), text="redacted"),
            "login",
            "hand-off-required",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Grant accessibility permission")),
            "permission",
            "needs-confirmation",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Pay invoice")),
            "payment",
            "hand-off-required",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Install browser extension")),
            "install-software",
            "hand-off-required",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Send API key to support")),
            "sensitive-data-transfer",
            "hand-off-required",
        ),
        (
            ActionPlan(kind="click", target=ActionTarget(description="Open system settings privacy panel")),
            "system-settings",
            "needs-confirmation",
        ),
    ]

    for action, category, mode in cases:
        decision = classify_action_plan_for_confirmation(action)

        assert decision is not None
        assert decision.category == category
        assert decision.mode == mode
        assert decision.timing == "action-time"
        assert decision.requires_confirmation is True


def test_risk_assessment_uses_confirmation_taxonomy_and_blocks_handoff_even_when_confirmed_policy():
    action = ActionPlan(kind="click", target=ActionTarget(description="Purchase paid plan"))

    assessment = assess_action_risk(action, fail_closed=False)

    assert assessment.level == "high"
    assert assessment.needs_confirmation is True
    assert assessment.blocked is True
    assert assessment.confirmation is not None
    assert assessment.confirmation.category == "payment"
    assert assessment.confirmation.mode == "hand-off-required"


def test_confirmation_boundary_requires_action_time_refs_and_handoff_ref():
    invalid = validate_confirmation_boundary({
        "confirmationCategory": "payment",
        "confirmationMode": "hand-off-required",
        "confirmationTiming": "session-start",
        "approvalRequestRef": "approval-request.json",
    })

    assert invalid["ok"] is False
    assert {issue["id"] for issue in invalid["issues"]} == {
        "invalid-confirmation-timing",
        "missing-handoff-ref",
    }

    valid = validate_confirmation_boundary({
        "confirmationCategory": "destructive-delete",
        "confirmationMode": "needs-confirmation",
        "confirmationTiming": "action-time",
        "approvalRequestRef": "approval-request.json",
    })

    assert valid["ok"] is True


def test_mapping_classifier_ignores_negated_risk_phrases():
    assert classify_mapping_for_confirmation({
        "target": {"description": "Open notes but do not delete anything"},
    }) is None
    assert classify_action_plan_for_confirmation(
        ActionPlan(kind="click", target=ActionTarget(description="visible empty result or no-result message area"))
    ) is None

    decision = classify_mapping_for_confirmation({
        "action": {"kind": "click"},
        "target": {"description": "Submit file upload"},
    })

    assert decision is not None
    assert decision.category == "upload"


def test_confirmation_classifier_does_not_treat_email_fields_as_external_messages():
    assert classify_action_plan_for_confirmation(
        ActionPlan(kind="press_key", key="Tab", reason="move to Email field")
    ) is None
    assert classify_action_plan_for_confirmation(
        ActionPlan(kind="type_text", target=ActionTarget(description="Email field"), text="ada@example.test")
    ) is None

    decision = classify_action_plan_for_confirmation(
        ActionPlan(kind="click", target=ActionTarget(description="Send email button"))
    )

    assert decision is not None
    assert decision.category == "external-message"
