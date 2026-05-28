from sciforge_computer_use.isolated_desktop_l3_workflow_plan import (
    ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION,
    L3_WORKFLOW_ACTION_PHASES,
    build_isolated_desktop_l3_workflow_action_plan,
    validate_isolated_desktop_l3_workflow_action_plan,
)


def test_l3_workflow_action_plan_builder_and_validator_accept_happy_path():
    plan = build_isolated_desktop_l3_workflow_action_plan(workflow_ref="workflow-001")
    validation = validate_isolated_desktop_l3_workflow_action_plan(plan)

    assert plan["schemaVersion"] == ISOLATED_DESKTOP_L3_WORKFLOW_ACTION_PLAN_SCHEMA_VERSION
    assert plan["status"] == "planned"
    assert plan["diagnosticOnly"] is True
    assert "userAcceptanceEligible" not in plan
    assert plan["phaseOrder"] == list(L3_WORKFLOW_ACTION_PHASES)
    assert [action["actionIndex"] for action in plan["actions"]] == [1, 2, 3, 4, 5]
    assert [action["phase"] for action in plan["actions"]] == list(L3_WORKFLOW_ACTION_PHASES)
    assert all("screenshotRef" in action["requiredRefs"] for action in plan["actions"])
    assert all("observationRef" in action["requiredRefs"] for action in plan["actions"])
    assert plan["executionPolicy"]["executeGui"] is False
    assert plan["executionPolicy"]["writeCompletedEvidence"] is False
    assert plan["executionPolicy"]["readShellArtifacts"] is False
    assert plan["executionPolicy"]["declareUserAcceptanceEligibility"] is False
    assert validation["ok"] is True
    assert validation["errors"] == []


def test_l3_workflow_action_plan_validator_rejects_missing_action_index():
    plan = build_isolated_desktop_l3_workflow_action_plan()
    plan["actions"][0].pop("actionIndex")

    codes = _codes(validate_isolated_desktop_l3_workflow_action_plan(plan))

    assert "action_index_missing" in codes


def test_l3_workflow_action_plan_validator_rejects_non_monotonic_action_index():
    plan = build_isolated_desktop_l3_workflow_action_plan()
    plan["actions"][1]["actionIndex"] = 3
    plan["actions"][2]["actionIndex"] = 2

    codes = _codes(validate_isolated_desktop_l3_workflow_action_plan(plan))

    assert "action_index_not_monotonic" in codes


def test_l3_workflow_action_plan_validator_rejects_duplicate_action_index():
    plan = build_isolated_desktop_l3_workflow_action_plan()
    plan["actions"][2]["actionIndex"] = 2

    codes = _codes(validate_isolated_desktop_l3_workflow_action_plan(plan))

    assert "action_index_duplicate" in codes
    assert "action_index_not_monotonic" in codes


def test_l3_workflow_action_plan_validator_requires_screenshot_and_observation_refs():
    plan = build_isolated_desktop_l3_workflow_action_plan()
    plan["actions"][0]["requiredRefs"] = [
        ref for ref in plan["actions"][0]["requiredRefs"] if ref != "screenshotRef"
    ]
    plan["actions"][4]["requiredRefs"] = [
        ref for ref in plan["actions"][4]["requiredRefs"] if ref != "observationRef"
    ]

    codes = _codes(validate_isolated_desktop_l3_workflow_action_plan(plan))

    assert "required_screenshot_observation_ref_missing" in codes
    assert "required_action_ref_missing" in codes


def test_l3_workflow_action_plan_validator_rejects_completed_or_user_eligible_plan():
    plan = build_isolated_desktop_l3_workflow_action_plan()
    plan["status"] = "completed"
    plan["userAcceptanceEligible"] = True

    codes = _codes(validate_isolated_desktop_l3_workflow_action_plan(plan))

    assert "status_completed_forbidden" in codes
    assert "user_acceptance_eligible_forbidden" in codes


def _codes(validation):
    return {error["code"] for error in validation["errors"]}
