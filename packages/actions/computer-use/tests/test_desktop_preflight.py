import json
import subprocess
import sys
from pathlib import Path

import pytest

from sciforge_computer_use.desktop_preflight import (
    EVIDENCE_REQUIRED_HOST_PORTS,
    LOOP_REQUIRED_HOST_PORTS,
    REQUIRED_HOST_PORTS,
    build_preflight_manifest,
)
from sciforge_computer_use.virtual_input_adapter import (
    INPUT_ADAPTER_BINDING_STATUS_BOUND,
    INPUT_ADAPTER_TARGET_BINDING_SCHEMA,
    build_input_adapter_target_binding_manifest,
    build_target_bound_input_adapter_manifest,
    get_virtual_input_adapter_manifest,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_desktop_preflight_blocks_by_default(tmp_path):
    manifest = build_preflight_manifest(output_dir=tmp_path / "preflight")

    assert manifest["status"] == "blocked"
    assert manifest["schemaVersion"] == "sciforge.computer-use.desktop-preflight.v1"
    assert manifest["requiredHostPorts"] == REQUIRED_HOST_PORTS
    assert manifest["loopRequiredHostPorts"] == LOOP_REQUIRED_HOST_PORTS
    assert manifest["evidenceRequiredHostPorts"] == EVIDENCE_REQUIRED_HOST_PORTS
    assert any(check["category"] == "input-isolation" and not check["ok"] for check in manifest["preflightChecks"])
    assert manifest["inputIsolation"]["sharedSystemInputAllowed"] is False
    assert "runtime" in " ".join(manifest["projectConstraints"]).lower()
    assert Path(manifest["manifestRef"]).is_file()


def test_desktop_preflight_blocks_independent_adapter_without_target_binding(tmp_path):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": get_virtual_input_adapter_manifest(),
            "inputChannel": "isolated-window",
            "apiKey": "do-not-write",
        },
    )

    assert manifest["status"] == "blocked"
    assert any(
        check["category"] == "target-environment-binding" and not check["ok"]
        for check in manifest["preflightChecks"]
    )
    assert manifest["inputIsolation"]["adapterManifestDeclared"] is True
    assert manifest["inputIsolation"]["targetBindingDeclared"] is False
    assert manifest["observedCapabilities"]["apiKey"] == "[REDACTED]"
    serialized = Path(manifest["manifestRef"]).read_text(encoding="utf8")
    assert "do-not-write" not in serialized


def test_desktop_preflight_ready_with_independent_adapter_target_binding(tmp_path):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": target_bound_adapter_manifest(),
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "ready"
    assert manifest["blockedReasons"] == []
    assert all(check["ok"] for check in manifest["preflightChecks"])
    assert manifest["inputIsolation"]["adapterManifestDeclared"] is True
    assert manifest["inputIsolation"]["adapterManifestReadyForRealDesktop"] is True
    assert manifest["inputIsolation"]["adapterManifestValidation"]["ok"] is True
    assert manifest["inputIsolation"]["targetBindingDeclared"] is True
    assert manifest["inputIsolation"]["targetBindingSchema"] == INPUT_ADAPTER_TARGET_BINDING_SCHEMA
    assert manifest["inputIsolation"]["targetBindingValidation"]["ok"] is True
    assert manifest["inputIsolation"]["targetBindingValidation"]["adapterManifestRef"].endswith("adapter-manifest.json")
    assert manifest["inputIsolation"]["targetBindingValidation"]["targetWindowRef"].endswith("target-window.json")
    assert manifest["inputIsolation"]["targetBindingValidation"]["evidenceRefs"][0].endswith("target-binding-proof.json")
    assert manifest["inputIsolation"]["targetBindingValidation"]["requireExistingRefs"] is True


def test_desktop_preflight_blocks_self_reported_binding_without_refs(tmp_path):
    missing_ref_binding = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
    )

    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": get_virtual_input_adapter_manifest(),
            "inputAdapterBindingManifest": missing_ref_binding,
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "blocked"
    assert manifest["inputIsolation"]["targetBindingDeclared"] is False
    assert "adapterManifestRef is required" in manifest["inputIsolation"]["targetBindingValidation"]["errors"]
    assert "targetWindowRef is required" in manifest["inputIsolation"]["targetBindingValidation"]["errors"]
    assert "evidenceRefs must include at least one ref" in manifest["inputIsolation"]["targetBindingValidation"]["errors"]


def test_desktop_preflight_blocks_fail_closed_executor_even_with_valid_binding(tmp_path):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-stdio-fail-closed-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": target_bound_adapter_manifest(),
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "blocked"
    assert any(check["category"] == "target-bound-executor" and not check["ok"] for check in manifest["preflightChecks"])
    assert any("target-bound independent executor" in reason for reason in manifest["blockedReasons"])


@pytest.mark.parametrize(
    "executor_provider",
    [
        "shell-direct-file-write-executor",
        "macos-ax-executor",
        "applescript-executor",
        "dom-playwright-executor",
        "private-api-executor",
        "clipboard-paste-executor",
    ],
)
def test_desktop_preflight_blocks_shortcut_executor_providers(tmp_path, executor_provider):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": executor_provider,
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": target_bound_adapter_manifest(),
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "blocked"
    assert any(check["category"] == "target-bound-executor" and not check["ok"] for check in manifest["preflightChecks"])
    assert any("shortcut-based" in reason for reason in manifest["blockedReasons"])


@pytest.mark.parametrize(
    "input_channel",
    [
        "global-keyboard",
        "global-mouse",
        "real-os",
        "shared-input",
        "shared-system",
        "virtual-session",
        "simulated",
        "state-only",
        "diagnostic-only",
        "",
    ],
)
def test_desktop_preflight_blocks_shared_global_or_real_input_channels(tmp_path, input_channel):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / f"preflight-{input_channel or 'empty'}",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": target_bound_adapter_manifest(),
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": input_channel,
        },
    )

    assert manifest["status"] == "blocked"
    assert any(
        check["category"] == "input-channel-isolation" and not check["ok"]
        for check in manifest["preflightChecks"]
    )


def test_desktop_preflight_blocks_virtual_state_adapter_manifest_even_with_binding(tmp_path):
    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": get_virtual_input_adapter_manifest(),
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "blocked"
    assert manifest["inputIsolation"]["adapterManifestDeclared"] is True
    assert manifest["inputIsolation"]["adapterManifestReadyForRealDesktop"] is False
    assert "adapter manifest inputChannel must be target-bound isolated input" in (
        manifest["inputIsolation"]["adapterManifestValidation"]["errors"]
    )
    assert any(
        check["category"] == "input-adapter-capability" and not check["ok"]
        for check in manifest["preflightChecks"]
    )


def test_desktop_preflight_blocks_target_bound_adapter_manifest_without_side_effects(tmp_path):
    incomplete_manifest = target_bound_adapter_manifest()
    del incomplete_manifest["sideEffects"]

    manifest = build_preflight_manifest(
        output_dir=tmp_path / "preflight",
        target_window="Fixture Editor",
        observed_capabilities={
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": "native-window-capture",
            "executorProvider": "native-independent-executor",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputAdapterManifest": incomplete_manifest,
            "inputAdapterBindingManifest": valid_binding_manifest(tmp_path),
            "inputChannel": "isolated-window",
        },
    )

    assert manifest["status"] == "blocked"
    assert manifest["inputIsolation"]["adapterManifestReadyForRealDesktop"] is False
    assert "adapter manifest sideEffects must be declared" in (
        manifest["inputIsolation"]["adapterManifestValidation"]["errors"]
    )
    assert any(
        check["category"] == "input-adapter-capability" and not check["ok"]
        for check in manifest["preflightChecks"]
    )


def test_desktop_preflight_accepts_adapter_manifest_ref_only_when_schema_matches(tmp_path):
    adapter_manifest_ref = tmp_path / "virtual-input-adapter-manifest.json"
    adapter_manifest_ref.write_text(json.dumps(target_bound_adapter_manifest()), encoding="utf8")
    binding_manifest_ref = tmp_path / "input-adapter-binding-manifest.json"
    binding_manifest_ref.write_text(json.dumps(valid_binding_manifest(tmp_path)), encoding="utf8")
    common = {
        "hostPorts": REQUIRED_HOST_PORTS,
        "captureProvider": "native-window-capture",
        "executorProvider": "native-independent-executor",
        "inputAdapterStatus": "independent-simulated-input-adapter",
        "inputAdapterBindingManifestRef": str(binding_manifest_ref),
        "inputChannel": "isolated-window",
    }

    ready = build_preflight_manifest(
        output_dir=tmp_path / "ready",
        target_window="Fixture Editor",
        observed_capabilities={**common, "inputAdapterManifestRef": str(adapter_manifest_ref)},
    )
    assert ready["status"] == "ready"
    assert ready["inputIsolation"]["adapterManifestSchema"] == "sciforge.computer-use.virtual-input-adapter-manifest.v1"
    assert ready["inputIsolation"]["targetBindingDeclared"] is True

    placeholder_binding_ref = tmp_path / "placeholder-binding.json"
    placeholder_binding_ref.write_text(json.dumps(valid_binding_manifest()), encoding="utf8")
    placeholder_blocked = build_preflight_manifest(
        output_dir=tmp_path / "placeholder-blocked",
        target_window="Fixture Editor",
        observed_capabilities={
            **common,
            "inputAdapterManifestRef": str(adapter_manifest_ref),
            "inputAdapterBindingManifestRef": str(placeholder_binding_ref),
        },
    )
    assert placeholder_blocked["status"] == "blocked"
    assert "adapterManifestRef must point to an existing local file" in placeholder_blocked["inputIsolation"]["targetBindingValidation"]["errors"]
    assert "targetWindowRef must point to an existing local file" in placeholder_blocked["inputIsolation"]["targetBindingValidation"]["errors"]
    assert "evidenceRefs must point to existing local files" in placeholder_blocked["inputIsolation"]["targetBindingValidation"]["errors"]

    bad_ref = tmp_path / "not-adapter.json"
    bad_ref.write_text(json.dumps({"schemaVersion": "not-this"}), encoding="utf8")
    blocked = build_preflight_manifest(
        output_dir=tmp_path / "blocked",
        target_window="Fixture Editor",
        observed_capabilities={**common, "inputAdapterManifestRef": str(bad_ref)},
    )
    assert blocked["status"] == "blocked"
    assert any(check["category"] == "input-isolation" and not check["ok"] for check in blocked["preflightChecks"])

    bad_binding_ref = tmp_path / "not-binding.json"
    bad_binding_ref.write_text(json.dumps({"schemaVersion": "not-this"}), encoding="utf8")
    binding_blocked = build_preflight_manifest(
        output_dir=tmp_path / "binding-blocked",
        target_window="Fixture Editor",
        observed_capabilities={
            **common,
            "inputAdapterManifestRef": str(adapter_manifest_ref),
            "inputAdapterBindingManifestRef": str(bad_binding_ref),
        },
    )
    assert binding_blocked["status"] == "blocked"
    assert any(
        check["category"] == "target-environment-binding" and not check["ok"]
        for check in binding_blocked["preflightChecks"]
    )


def test_desktop_preflight_cli_writes_blocked_manifest(tmp_path):
    output_dir = tmp_path / "preflight"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.desktop_preflight",
            "--output-dir",
            str(output_dir),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert result.returncode == 1
    assert result.stderr == ""
    payload = json.loads(result.stdout)
    assert payload["status"] == "blocked"
    assert (output_dir / "desktop-host-port-preflight-manifest.json").is_file()


def valid_binding_manifest(tmp_path=None):
    if tmp_path is None:
        adapter_ref = "adapter-manifest.json"
        target_ref = "target-window.json"
        proof_ref = "target-binding-proof.json"
    else:
        adapter_ref = tmp_path / "adapter-manifest.json"
        target_ref = tmp_path / "target-window.json"
        proof_ref = tmp_path / "target-binding-proof.json"
        adapter_ref.write_text(json.dumps(target_bound_adapter_manifest()), encoding="utf8")
        target_ref.write_text(json.dumps({"schemaVersion": "fixture.target-window.v1"}), encoding="utf8")
        proof_ref.write_text(json.dumps({"schemaVersion": "fixture.binding-proof.v1"}), encoding="utf8")
        adapter_ref = str(adapter_ref)
        target_ref = str(target_ref)
        proof_ref = str(proof_ref)
    return build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref=adapter_ref,
        target_window_ref=target_ref,
        evidence_refs=[proof_ref],
    )


def target_bound_adapter_manifest():
    return build_target_bound_input_adapter_manifest(
        executor_provider="native-independent-executor",
        input_channel="isolated-window",
    )
