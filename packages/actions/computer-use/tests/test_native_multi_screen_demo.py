from __future__ import annotations

import copy

from sciforge_computer_use.native_multi_screen_demo import (
    NATIVE_MULTI_SCREEN_DEMO_SCHEMA,
    build_native_multi_screen_demo_bundle,
    validate_native_multi_screen_demo_bundle,
)


def test_native_multi_screen_demo_bundle_validates_required_product_gate_shape(tmp_path) -> None:
    manifest = build_native_multi_screen_demo_bundle(
        tmp_path / "native-demo",
        run_id="native-demo-test",
        observed_at="2026-05-31T10:00:00.000Z",
    )

    validation = validate_native_multi_screen_demo_bundle(manifest, require_existing_refs=True)

    assert manifest["schemaVersion"] == NATIVE_MULTI_SCREEN_DEMO_SCHEMA
    assert manifest["backendKind"] == "native-multi-screen-sidecar"
    assert manifest["dockerNovncRequired"] is False
    assert len(manifest["screens"]) == 2
    assert len({cursor["actorId"] for cursor in manifest["actorCursors"]}) == 3
    assert len({cursor["cursorId"] for cursor in manifest["actorCursors"]}) == 3
    assert {event["eventType"] for event in manifest["cursorEvents"]} >= {"move", "point", "annotate"}
    assert all(event["mutatingGuiAction"] is False for event in manifest["cursorEvents"] if event["eventType"] in {"move", "point", "annotate"})
    assert any(queue["scopeKind"] == "window-local" for queue in manifest["leaseQueues"])
    assert any(queue["scopeKind"] == "screen-global" for queue in manifest["leaseQueues"])
    assert all(queue["schedulerPolicy"] == "native-screen-serial" for queue in manifest["leaseQueues"])
    assert manifest["browserRuntimeObservation"]["observationUse"] == "observe-before-mutate-hint"
    assert manifest["browserRuntimeObservation"]["completionEvidenceEligible"] is False
    assert validation["ok"] is True


def test_native_multi_screen_demo_rejects_legacy_docker_novnc_backend(tmp_path) -> None:
    manifest = build_native_multi_screen_demo_bundle(tmp_path / "native-demo")
    invalid = copy.deepcopy(manifest)
    invalid["backendKind"] = "docker-novnc-rdp"

    validation = validate_native_multi_screen_demo_bundle(invalid)

    assert validation["ok"] is False
    assert "legacy_docker_novnc_backend_forbidden" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_demo_requires_two_screens_three_actors_and_replay_overlays(tmp_path) -> None:
    manifest = build_native_multi_screen_demo_bundle(tmp_path / "native-demo")
    invalid = copy.deepcopy(manifest)
    invalid["screens"] = invalid["screens"][:1]
    invalid["actorCursors"] = invalid["actorCursors"][:1]
    invalid["replay"]["overlayRefs"] = []

    validation = validate_native_multi_screen_demo_bundle(invalid)

    codes = {error["code"] for error in validation["errors"]}
    assert validation["ok"] is False
    assert "multi_screen_required" in codes
    assert "multi_actor_cursor_required" in codes
    assert "replay_overlay_refs_missing" in codes

    placeholder = copy.deepcopy(manifest)
    placeholder["replay"]["overlayRefs"] = ["placeholder-overlay.json", "placeholder-preview.json"]
    validation = validate_native_multi_screen_demo_bundle(placeholder)
    codes = {error["code"] for error in validation["errors"]}
    assert "placeholder_replay_ref_forbidden" in codes


def test_native_multi_screen_demo_rejects_dom_ax_completion_or_executor_substitution(tmp_path) -> None:
    manifest = build_native_multi_screen_demo_bundle(tmp_path / "native-demo")
    invalid = copy.deepcopy(manifest)
    invalid["browserRuntimeObservation"]["completionEvidenceEligible"] = True
    invalid["browserRuntimeObservation"]["executorLeaseSubstitute"] = True
    invalid["browserRuntimeObservation"]["guiActionSubstitute"] = True

    validation = validate_native_multi_screen_demo_bundle(invalid)

    assert validation["ok"] is False
    assert "browser_runtime_observation_invalid" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_demo_requires_l0_only_platform_sidecar(tmp_path) -> None:
    manifest = build_native_multi_screen_demo_bundle(tmp_path / "native-demo")
    invalid = copy.deepcopy(manifest)
    invalid["platformSidecar"]["planning"] = True
    invalid["platformSidecar"]["artifactValidation"] = True

    validation = validate_native_multi_screen_demo_bundle(invalid)

    assert validation["ok"] is False
    assert "platform_sidecar_boundary_invalid" in {error["code"] for error in validation["errors"]}
