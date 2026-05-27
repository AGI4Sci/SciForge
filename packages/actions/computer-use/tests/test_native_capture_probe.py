import subprocess
from pathlib import Path

from sciforge_computer_use import native_capture_probe


_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02"
    b"\x00\x00\x00\x03\x08\x06\x00\x00\x00"
)


def test_native_capture_probe_records_capture_only_preflight(tmp_path, monkeypatch):
    monkeypatch.setattr(native_capture_probe, "_native_capture_provider", lambda: "macos-screencapture")
    monkeypatch.setattr(native_capture_probe, "_window_inventory", lambda runner=None: [])

    def fake_runner(command):
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    manifest = native_capture_probe.run_native_capture_probe(
        output_dir=tmp_path / "capture",
        target_window="Fixture Window",
        runner=fake_runner,
    )

    assert manifest["status"] == "completed"
    assert manifest["category"] == "native-capture-only"
    assert manifest["captureProvider"] == "macos-screencapture"
    assert manifest["captureScope"] == "display"
    assert manifest["targetWindowResolved"] is False
    assert manifest["observedHostPorts"] == ["capture"]
    assert manifest["inputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["screenshotMetadata"]["width"] == 2
    assert manifest["screenshotMetadata"]["height"] == 3
    assert manifest["preflightStatus"] == "blocked"
    assert any("execute" in reason for reason in manifest["preflightBlockedReasons"])
    assert Path(manifest["preflightRef"]).is_file()


def test_native_capture_probe_blocks_when_capture_command_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(native_capture_probe, "_native_capture_provider", lambda: "macos-screencapture")
    monkeypatch.setattr(native_capture_probe, "_window_inventory", lambda runner=None: [])

    def fake_runner(command):
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="permission denied")

    manifest = native_capture_probe.run_native_capture_probe(
        output_dir=tmp_path / "capture",
        runner=fake_runner,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "native-capture-blocked"
    assert "permission denied" in manifest["reason"]
    assert manifest["inputExecuted"] is False
    assert manifest["osInputExecuted"] is False
    assert manifest["realOsInputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert manifest["rawPayloadWritten"] is False
    assert manifest["inlineImageWritten"] is False
    assert manifest["secretsWritten"] is False
    assert manifest["realWindowEvidence"] is False
    assert manifest["diagnosticOnly"] is True


def test_native_capture_probe_uses_display_capture_without_explicit_target(tmp_path, monkeypatch):
    monkeypatch.setattr(native_capture_probe, "_native_capture_provider", lambda: "macos-screencapture")
    monkeypatch.setattr(
        native_capture_probe,
        "_window_inventory",
        lambda runner=None: [
            {
                "windowId": 42,
                "owner": "FixtureApp",
                "title": "Fixture Window",
                "bounds": {"X": 1, "Y": 2, "Width": 300, "Height": 200},
            }
        ],
    )
    commands = []

    def fake_runner(command):
        commands.append(list(command))
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    manifest = native_capture_probe.run_native_capture_probe(
        output_dir=tmp_path / "capture",
        runner=fake_runner,
    )

    assert manifest["status"] == "completed"
    assert manifest["captureScope"] == "display"
    assert manifest["targetWindowResolved"] is False
    assert manifest["selectedWindow"] is None
    assert "-l42" not in commands[0]


def test_native_capture_probe_blocks_ambiguous_window_target(tmp_path, monkeypatch):
    monkeypatch.setattr(native_capture_probe, "_native_capture_provider", lambda: "macos-screencapture")
    monkeypatch.setattr(
        native_capture_probe,
        "_window_inventory",
        lambda runner=None: [
            {
                "windowId": 42,
                "owner": "FixtureApp",
                "title": "Fixture Window One",
                "bounds": {"X": 1, "Y": 2, "Width": 300, "Height": 200},
            },
            {
                "windowId": 43,
                "owner": "FixtureApp",
                "title": "Fixture Window Two",
                "bounds": {"X": 4, "Y": 5, "Width": 300, "Height": 200},
            },
        ],
    )
    commands = []

    def fake_runner(command):
        commands.append(list(command))
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    manifest = native_capture_probe.run_native_capture_probe(
        output_dir=tmp_path / "capture",
        target_window="Fixture Window",
        runner=fake_runner,
    )

    assert manifest["status"] == "blocked"
    assert "matched 2 windows" in manifest["reason"]
    assert manifest["targetWindowResolved"] is False
    assert commands == []


def test_native_capture_probe_uses_window_capture_when_inventory_matches(tmp_path, monkeypatch):
    monkeypatch.setattr(native_capture_probe, "_native_capture_provider", lambda: "macos-screencapture")
    monkeypatch.setattr(
        native_capture_probe,
        "_window_inventory",
        lambda runner=None: [
            {
                "windowId": 42,
                "owner": "FixtureApp",
                "title": "Fixture Window",
                "bounds": {"X": 1, "Y": 2, "Width": 300, "Height": 200},
            }
        ],
    )
    commands = []

    def fake_runner(command):
        commands.append(list(command))
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    manifest = native_capture_probe.run_native_capture_probe(
        output_dir=tmp_path / "capture",
        target_window="Fixture Window",
        runner=fake_runner,
    )

    assert manifest["status"] == "completed"
    assert manifest["captureScope"] == "window"
    assert manifest["targetWindowResolved"] is True
    assert manifest["selectedWindow"]["windowId"] == 42
    assert manifest["selectedWindowRef"].endswith("native-selected-window.json")
    assert manifest["targetWindowBindingProofRef"].endswith("native-target-window-binding-proof.json")
    assert "-l42" in commands[0]
    assert "-i" not in commands[0]
    assert "-w" not in commands[0]
    assert "-W" not in commands[0]
    assert Path(manifest["windowInventoryRef"]).is_file()
    selected_window = read_json(manifest["selectedWindowRef"])
    proof = read_json(manifest["targetWindowBindingProofRef"])
    assert selected_window["selectedWindow"]["windowId"] == 42
    assert proof["schemaVersion"] == "sciforge.computer-use.native-target-window-binding-proof.v1"
    assert proof["selectedWindowRef"] == manifest["selectedWindowRef"]
    assert proof["windowInventoryRef"] == manifest["windowInventoryRef"]
    assert proof["screenshotRef"] == manifest["screenshotRefs"][0]
    assert proof["captureScope"] == "window"
    assert proof["inputExecuted"] is False
    assert proof["sharedSystemInputUsed"] is False
    assert proof["systemPointerMoved"] is False
    assert proof["systemKeyboardEventsSent"] is False
    assert manifest["preflightStatus"] == "blocked"


def read_json(path):
    import json

    return json.loads(Path(path).read_text(encoding="utf8"))
