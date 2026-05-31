from __future__ import annotations

from sciforge_computer_use.browser_runtime_dom_ax_observation import (
    BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA,
    BROWSER_RUNTIME_PAGE_QUERY_SCHEMA,
    BROWSER_RUNTIME_STABLE_REF_SCHEMA,
    build_browser_runtime_dom_ax_observation,
    build_observe_before_mutate_from_browser_runtime,
    validate_browser_runtime_dom_ax_observation,
)


def _page_query() -> dict[str, object]:
    return {
        "schemaVersion": BROWSER_RUNTIME_PAGE_QUERY_SCHEMA,
        "select": {"role": "button", "name": "Save", "visible": True},
        "fields": ["role", "ariaLabel", "bbox", "isVisible"],
        "limit": 5,
    }


def _stable_ref() -> dict[str, object]:
    return {
        "schemaVersion": BROWSER_RUNTIME_STABLE_REF_SCHEMA,
        "primary": "button:Save",
        "resolveStrategy": "best-match",
        "signals": {
            "role": "button",
            "accessibleName": "Save",
            "domPath": "main button:nth-of-type(1)",
            "bbox": {"x": 12, "y": 16, "width": 90, "height": 32},
        },
    }


def _observation(**overrides: object) -> dict[str, object]:
    payload = build_browser_runtime_dom_ax_observation(
        observation_id="browser-obs-1",
        observation_ref=".sciforge/vision-runs/run-1/browser-dom-ax-observation.json",
        display_group_id="display-group-main",
        screen_id="screen-main",
        window_id="window-101",
        browser_session_ref=".sciforge/browser/session.json",
        browser_tab_ref=".sciforge/browser/tab.json",
        source_snapshot_ref=".sciforge/browser/snapshot.json",
        page_query=_page_query(),
        stable_refs=[_stable_ref()],
        visible_dom_ref=".sciforge/browser/visible-dom.json",
        accessibility_snapshot_ref=".sciforge/browser/accessibility.json",
        playwright_evaluate_ref=".sciforge/browser/evaluate.json",
        screenshot_ref=".sciforge/vision-runs/run-1/step-001-before-display-1.png",
        observed_at="2026-05-31T10:00:00.000Z",
    )
    payload.update(overrides)
    return payload


def test_browser_runtime_dom_ax_observation_is_refs_first_hint_only() -> None:
    observation = _observation()

    assert observation["schemaVersion"] == BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA
    assert observation["refsFirst"] is True
    assert observation["trust"] == "untrusted-page-observation"
    assert observation["observationUse"] == "observe-before-mutate-hint"
    assert observation["completionEvidenceEligible"] is False
    assert observation["executorLeaseSubstitute"] is False
    assert observation["guiActionSubstitute"] is False
    assert observation["artifactCausalitySubstitute"] is False
    assert observation["userLevelCompletionSubstitute"] is False

    validation = validate_browser_runtime_dom_ax_observation(observation)
    assert validation["ok"] is True
    assert validation["hintOnly"] is True
    assert ".sciforge/browser/visible-dom.json" in validation["refs"]


def test_browser_runtime_observation_projects_to_observe_before_mutate_without_completion_authority() -> None:
    evidence = build_observe_before_mutate_from_browser_runtime(
        _observation(),
        grounding_ref=".sciforge/vision-runs/run-1/browser-grounding-hints.json",
    )

    assert evidence["appStateRef"] == ".sciforge/browser/snapshot.json"
    assert evidence["accessibilitySnapshotRef"] == ".sciforge/browser/accessibility.json"
    assert evidence["stateSnapshotRef"] == ".sciforge/browser/accessibility.json"
    assert evidence["groundingRef"] == ".sciforge/vision-runs/run-1/browser-grounding-hints.json"
    assert evidence["displayGroupId"] == "display-group-main"
    assert evidence["screenId"] == "screen-main"
    assert evidence["windowId"] == "window-101"
    assert evidence["freshnessCheck"]["status"] == "current"
    assert evidence["browserRuntimeObservationRef"] == ".sciforge/vision-runs/run-1/browser-dom-ax-observation.json"
    assert evidence["domVisibleRef"] == ".sciforge/browser/visible-dom.json"
    assert evidence["playwrightEvaluateRef"] == ".sciforge/browser/evaluate.json"


def test_browser_runtime_dom_ax_observation_rejects_completion_or_inline_substitutes() -> None:
    invalid = _observation(
        completionEvidenceEligible=True,
        executorLeaseSubstitute=True,
        guiActionSubstitute=True,
        artifactCausalitySubstitute=True,
        userLevelCompletionSubstitute=True,
        rawDom="<html>large provider payload</html>",
    )

    validation = validate_browser_runtime_dom_ax_observation(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "boundary_flag_invalid" in codes
    assert "inline_payload_key_forbidden" in codes


def test_browser_runtime_dom_ax_observation_requires_page_query_stable_ref_and_dom_ax_ref() -> None:
    invalid = _observation(
        pageQuery={"schemaVersion": "wrong"},
        stableElementRefs=[],
        visibleDomRef=None,
        accessibilitySnapshotRef=None,
        playwrightEvaluateRef=None,
    )

    validation = validate_browser_runtime_dom_ax_observation(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "page_query_invalid" in codes
    assert "stable_refs_missing" in codes
    assert "dom_ax_ref_missing" in codes


def test_browser_runtime_dom_ax_observation_requires_refs_first_current_bundle_refs() -> None:
    invalid = _observation(
        refsFirst=False,
        currentBundleOnly=False,
        sourceSnapshotRef="https://example.test/old-snapshot.json",
        pageQuery={
            "schemaVersion": BROWSER_RUNTIME_PAGE_QUERY_SCHEMA,
            "select": {"ref": "https://example.test/old-node.json"},
            "fields": ["role", "ariaLabel", "bbox", "isVisible"],
            "limit": 5,
        },
        stableElementRefs=[{
            **_stable_ref(),
            "refs": ["https://example.test/old-stable-ref.json"],
        }],
    )

    validation = validate_browser_runtime_dom_ax_observation(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "refs_first_flag_invalid" in codes
    assert "ref_not_current_bundle" in codes
    assert "page_query_ref_invalid" in codes
    assert "stable_ref_ref_payload_forbidden" in codes
