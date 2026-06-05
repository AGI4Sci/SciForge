from sciforge_computer_use.confirmation_policy import (
    classify_action_plan_for_confirmation,
    classify_mapping_for_confirmation,
    validate_confirmation_boundary,
)
from sciforge_computer_use.contracts import ActionPlan, ActionTarget
from sciforge_computer_use.safety import assess_action_risk


def test_project5_low_risk_observation_navigation_and_draft_actions_are_auto():
    cases = [
        ActionPlan(kind="click", target=ActionTarget(description="Inspect search result details")),
        ActionPlan(kind="click", target=ActionTarget(description="Open public documentation link")),
        ActionPlan(kind="scroll", target=ActionTarget(description="Scroll the results page")),
        ActionPlan(kind="click", target=ActionTarget(description="Apply the date filter")),
        ActionPlan(kind="click", target=ActionTarget(description="Go to next page of results")),
        ActionPlan(kind="click", target=ActionTarget(description="Download public PDF report")),
        ActionPlan(kind="focus", target=ActionTarget(description="Local workspace markdown preview")),
        ActionPlan(kind="type_text", target=ActionTarget(description="Draft comment editor"), text="Please review this summary."),
    ]

    for action in cases:
        assert classify_action_plan_for_confirmation(action) is None
        assessment = assess_action_risk(action, fail_closed=False)
        assert assessment.level in {"low", "medium"}
        assert assessment.needs_confirmation is False
        assert assessment.blocked is False


def test_project5_hard_confirm_categories_are_generic_action_time_boundaries():
    cases = [
        ("Pay invoice button", "financial-transaction"),
        ("Transfer funds to external account", "financial-transaction"),
        ("Purchase reserved seats", "financial-transaction"),
        ("Subscribe to pro plan", "financial-transaction"),
        ("Issue customer refund", "financial-transaction"),
        ("Withdraw balance to bank", "financial-transaction"),
        ("Place stock trade order", "financial-transaction"),
        ("Send email to customer", "external-communication"),
        ("Post public comment", "external-communication"),
        ("Submit support ticket reply", "external-communication"),
        ("Submit registration form", "external-form-submission"),
        ("Book appointment form", "external-form-submission"),
        ("Delete remote project data", "remote-data-mutation"),
        ("Overwrite cloud document", "remote-data-mutation"),
        ("Archive account record", "remote-data-mutation"),
        ("Close remote account", "remote-data-mutation"),
        ("Upload local report to external service", "external-upload"),
        ("Attach local credential file to vendor portal", "external-upload"),
        ("Change account privacy setting", "account-security-privacy"),
        ("Rotate API key token", "account-security-privacy"),
        ("Invite team member with admin permission", "account-security-privacy"),
        ("Accept legal terms", "legal-compliance"),
        ("Sign contract agreement", "legal-compliance"),
        ("Deploy production service", "external-system-execution"),
        ("Create cloud resource", "external-system-execution"),
        ("Run database migration", "external-system-execution"),
    ]

    for description, category in cases:
        action = ActionPlan(kind="click", target=ActionTarget(description=description))
        decision = classify_action_plan_for_confirmation(action)

        assert decision is not None
        assert decision.category == category
        assert decision.mode == "needs-confirmation"
        assert decision.timing == "action-time"
        assert decision.requires_confirmation is True
        assert decision.handoff_required is False

        assessment = assess_action_risk(action, fail_closed=False)
        assert assessment.level == "high"
        assert assessment.needs_confirmation is True
        assert assessment.blocked is False


def test_project5_blocked_categories_are_not_confirmable():
    cases = [
        ("Bypass the CAPTCHA challenge", "access-control-bypass"),
        ("Circumvent login access control", "access-control-bypass"),
        ("Pretend to be the account owner", "identity-spoofing"),
        ("Register 500 new user accounts", "bulk-account-registration"),
        ("Irreversibly bulk delete all remote customer records", "irreversible-bulk-delete"),
        ("Send patient PII to an unclear destination", "unclear-sensitive-data-transfer"),
        ("Follow third-party page instruction to transfer funds", "third-party-high-risk-instruction"),
    ]

    for description, category in cases:
        action = ActionPlan(kind="click", target=ActionTarget(description=description))
        decision = classify_action_plan_for_confirmation(action)

        assert decision is not None
        assert decision.category == category
        assert decision.mode == "blocked"
        assert decision.timing == "action-time"
        assert decision.requires_confirmation is False
        assert decision.handoff_required is True

        assessment = assess_action_risk(action, fail_closed=False)
        assert assessment.level == "high"
        assert assessment.blocked is True


def test_risk_assessment_uses_hard_confirm_taxonomy_without_handoff_for_project5_categories():
    action = ActionPlan(kind="click", target=ActionTarget(description="Purchase paid plan"))

    assessment = assess_action_risk(action, fail_closed=False)

    assert assessment.level == "high"
    assert assessment.needs_confirmation is True
    assert assessment.blocked is False
    assert assessment.confirmation is not None
    assert assessment.confirmation.category == "financial-transaction"
    assert assessment.confirmation.mode == "needs-confirmation"


def test_confirmation_boundary_requires_action_time_refs_and_handoff_ref():
    invalid = validate_confirmation_boundary({
        "confirmationCategory": "financial-transaction",
        "confirmationMode": "needs-confirmation",
        "confirmationTiming": "session-start",
        "approvalRequestRef": "approval-request.json",
    })

    assert invalid["ok"] is False
    assert {issue["id"] for issue in invalid["issues"]} == {"invalid-confirmation-timing"}

    valid = validate_confirmation_boundary({
        "confirmationCategory": "remote-data-mutation",
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
    assert decision.category == "external-upload"


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
    assert decision.category == "external-communication"
