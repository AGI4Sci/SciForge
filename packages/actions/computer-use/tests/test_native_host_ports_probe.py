import subprocess
from pathlib import Path

from sciforge_computer_use import validate_trace
from sciforge_computer_use import native_host_ports_probe


_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\r\x00"
    b"\x00\x00\x09\x08\x06\x00\x00\x00"
)


def test_native_stdio_probe_captures_then_fails_closed_without_input(tmp_path, monkeypatch):
    monkeypatch.setattr(native_host_ports_probe, "_native_capture_provider", lambda: "macos-screencapture")
    commands = []

    def fake_runner(command):
        commands.append(list(command))
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def fake_inventory(runner=None):
        return [
            {
                "windowId": 123,
                "owner": "FixtureApp",
                "title": "Fixture Window",
                "bounds": {"X": 0, "Y": 0, "Width": 640, "Height": 480},
            }
        ]

    output_dir = tmp_path / "native-stdio"
    runner = native_host_ports_probe.NativeStdioProbeRunner(
        request={"task": "click fixture window safely", "maxSteps": 1},
        output_dir=output_dir,
        target_window="Fixture Window",
        command_runner=fake_runner,
        inventory_reader=fake_inventory,
    )
    payload = runner.run()

    assert payload["status"] == "failed-with-reason"
    assert "will not execute input" in payload["reason"]
    assert payload["failureDiagnostics"]["failedStage"] == "execution"
    assert payload["failureDiagnostics"]["nativeStdioProbeManifestRef"] == str((output_dir / "native-stdio-probe-manifest.json").resolve())
    assert payload["failureDiagnostics"]["nativeStdioPreflightStatus"] == "blocked"
    assert payload["failureDiagnostics"]["nativeStdioTargetWindowResolved"] is True
    assert payload["failureDiagnostics"]["executeFailClosed"] is True
    assert payload["failureDiagnostics"]["inputExecuted"] is False
    assert payload["failureDiagnostics"]["sharedSystemInputUsed"] is False
    assert payload["failureDiagnostics"]["targetBindingStatus"] == "virtual-state-only"
    assert payload["failureDiagnostics"]["targetBindingValidation"]["ok"] is False
    assert payload["failureDiagnostics"]["targetBindingValidation"]["adapterManifestRef"].endswith(
        "native-stdio-input-adapter-manifest.json"
    )
    assert payload["failureDiagnostics"]["targetBindingValidation"]["targetWindowRef"].endswith(
        "native-target-window-binding-proof.json"
    )
    assert payload["failureDiagnostics"]["targetWindowBindingProofRef"].endswith(
        "native-target-window-binding-proof.json"
    )
    assert payload["traceRefs"] == [str((output_dir / "vision-trace.json").resolve())]
    assert payload["screenshotRefs"] == [str((output_dir / "native-stdio-before.png").resolve())]
    assert commands[0][0:2] == ["screencapture", "-x"]
    assert "-l123" in commands[0]
    assert "-i" not in commands[0]
    assert "-w" not in commands[0]
    assert "-W" not in commands[0]

    manifest = read_json(output_dir / "native-stdio-probe-manifest.json")
    assert manifest["schemaVersion"] == "sciforge.computer-use.native-stdio-probe-manifest.v1"
    assert manifest["mode"] == "native-capture-stdio-host-ports"
    assert manifest["protocolSchemas"] == {
        "hostPortCall": "sciforge.computer-use.host-port-call.v1",
        "hostPortResult": "sciforge.computer-use.host-port-result.v1",
        "finalResult": "sciforge.computer-use.cli-final-result.v1",
    }
    assert manifest["captureScope"] == "window"
    assert manifest["requestedTargetWindow"] == "Fixture Window"
    assert manifest["targetWindowResolved"] is True
    assert manifest["selectedWindow"]["windowId"] == 123
    assert manifest["screenshotMetadataByRef"][payload["screenshotRefs"][0]]["width"] == 13
    assert manifest["inputExecuted"] is False
    assert manifest["executeFailClosed"] is True
    assert manifest["inputChannel"] == "isolated-window"
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["rawPayloadWritten"] is False
    assert manifest["inlineImageWritten"] is False
    assert manifest["secretsWritten"] is False
    assert manifest["unreachedHostPorts"] == ["verify"]
    assert manifest["preflightStatus"] == "blocked"
    assert manifest["inputAdapterManifestRef"] == str((output_dir / "native-stdio-input-adapter-manifest.json").resolve())
    assert manifest["inputAdapterBindingManifestRef"] == str((output_dir / "native-stdio-target-binding-candidate.json").resolve())
    assert manifest["selectedWindowRef"] == str((output_dir / "native-selected-window.json").resolve())
    assert manifest["targetWindowBindingProofRef"] == str((output_dir / "native-target-window-binding-proof.json").resolve())
    assert manifest["targetBindingStatus"] == "virtual-state-only"
    assert manifest["targetBindingValidation"]["ok"] is False
    assert manifest["targetBindingValidation"]["targetWindowRef"] == manifest["targetWindowBindingProofRef"]
    assert manifest["targetBindingValidation"]["evidenceRefs"] == [
        str((output_dir / "native-window-inventory.json").resolve()),
        str((output_dir / "native-selected-window.json").resolve()),
        str((output_dir / "native-stdio-before.png").resolve()),
        str((output_dir / "native-target-window-binding-proof.json").resolve()),
    ]
    assert "bindingStatus must be bound" in manifest["targetBindingValidation"]["errors"]
    assert "executeChangesTargetEnvironment must be true" in manifest["targetBindingValidation"]["errors"]
    assert "realWindowEvidenceCapable must be true" in manifest["targetBindingValidation"]["errors"]
    assert any("target binding" in reason for reason in manifest["preflightBlockedReasons"])
    assert not any("required host port" in reason.lower() for reason in manifest["preflightBlockedReasons"])
    assert not any("independent simulated input adapter" in reason.lower() for reason in manifest["preflightBlockedReasons"])
    assert read_json(output_dir / "native-stdio-input-adapter-manifest.json")["inputAdapterStatus"] == (
        "independent-simulated-input-adapter"
    )
    binding = read_json(output_dir / "native-stdio-target-binding-candidate.json")
    assert binding["bindingStatus"] == "virtual-state-only"
    assert binding["targetWindowResolved"] is True
    assert binding["executeChangesTargetEnvironment"] is False
    proof = read_json(output_dir / "native-target-window-binding-proof.json")
    assert proof["selectedWindow"]["windowId"] == 123
    assert proof["screenshotRef"] == str((output_dir / "native-stdio-before.png").resolve())
    assert proof["inputExecuted"] is False
    assert [call["port"] for call in manifest["hostPortCalls"]] == [
        "emitEvent",
        "capture",
        "plan",
        "locate",
        "execute",
        "writeTrace",
        "emitEvent",
    ]
    assert validate_trace(output_dir / "vision-trace.json")["ok"] is True
    assert read_json(output_dir / "computer-use-result.json")["failureDiagnostics"] == payload["failureDiagnostics"]


def test_native_stdio_probe_blocks_when_native_capture_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(native_host_ports_probe, "_native_capture_provider", lambda: "macos-screencapture")

    def failing_runner(command):
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="screen recording denied")

    runner = native_host_ports_probe.NativeStdioProbeRunner(
        request={"task": "click fixture window safely", "maxSteps": 1},
        output_dir=tmp_path / "native-stdio",
        command_runner=failing_runner,
        inventory_reader=lambda runner=None: [],
    )
    payload = runner.run()

    assert payload["status"] == "failed-with-reason"
    assert "screen recording denied" in payload["reason"]
    assert read_json(tmp_path / "native-stdio" / "native-stdio-probe-manifest.json")["inputExecuted"] is False


def test_native_stdio_probe_uses_display_capture_without_explicit_target(tmp_path, monkeypatch):
    monkeypatch.setattr(native_host_ports_probe, "_native_capture_provider", lambda: "macos-screencapture")
    commands = []

    def fake_runner(command):
        commands.append(list(command))
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    runner = native_host_ports_probe.NativeStdioProbeRunner(
        request={"task": "delete nothing; native probe must not inherit risky target", "maxSteps": 1},
        output_dir=tmp_path / "native-stdio",
        command_runner=fake_runner,
        inventory_reader=lambda runner=None: [
            {
                "windowId": 999,
                "owner": "FixtureApp",
                "title": "Fixture Window",
                "bounds": {"X": 0, "Y": 0, "Width": 640, "Height": 480},
            }
        ],
    )
    payload = runner.run()
    manifest = read_json(tmp_path / "native-stdio" / "native-stdio-probe-manifest.json")

    assert payload["failureDiagnostics"]["failedStage"] == "execution"
    assert manifest["captureScope"] == "display"
    assert manifest["targetWindowResolved"] is False
    assert manifest["selectedWindow"] is None
    assert manifest["targetBindingStatus"] == "virtual-state-only"
    assert manifest["targetBindingValidation"]["targetWindowRef"] is None
    assert "targetWindowResolved must be true" in manifest["targetBindingValidation"]["errors"]
    assert all(not item.startswith("-l") for item in commands[0])
    assert payload["steps"][0]["action"]["target"] == "native stdio diagnostic target"


def read_json(path):
    import json

    return json.loads(Path(path).read_text(encoding="utf8"))
