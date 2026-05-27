import json
import subprocess
from pathlib import Path

from sciforge_computer_use.plugin_probe import run_plugin_probe


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ACTION_MANIFEST = PACKAGE_ROOT / "action-provider.manifest.json"


def test_plugin_probe_discovers_manifest_api_and_runs_cli_fixture(tmp_path):
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        payload = {
            "schemaVersion": "sciforge.computer-use.result.v1",
            "status": "completed",
            "reason": "fixture completed",
            "traceRefs": ["trace:plugin-probe/computer-use.json"],
            "screenshotRefs": [],
            "artifactRefs": ["artifact:plugin-probe/report.md"],
            "steps": [],
        }
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(payload), stderr="")

    manifest = run_plugin_probe(
        output_dir=tmp_path / "probe",
        run_fixture=True,
        subprocess_run=fake_run,
    )

    assert list(manifest)[:7] == [
        "schemaVersion",
        "status",
        "category",
        "reason",
        "probeManifestRef",
        "actionProviderManifestRef",
        "packageRootRef",
    ]
    assert manifest["status"] == "completed"
    assert manifest["actionProvider"]["id"] == "sciforge.computer-use"
    assert manifest["entrypoint"]["module"] == "sciforge_computer_use"
    assert manifest["entrypoint"]["symbol"] == "run_task"
    assert manifest["api"]["requiredSymbols"] == [
        "run_task",
        "runTask",
        "getManifest",
        "validateTrace",
        "compactResult",
        "buildRepairReplayEvidence",
        "validateRepairReplayEvidence",
        "buildViewportRecoveryEvidence",
        "validateViewportRecoveryEvidence",
        "buildTargetBoundRealWindowProbeEvidence",
        "validateTargetBoundRealWindowProbeEvidence",
        "buildTargetBoundInputAdapterManifest",
        "validateInputAdapterManifestForRealDesktop",
    ]
    assert {
        "sciforge_computer_use.virtual_input_adapter.build_target_bound_input_adapter_manifest",
        "sciforge_computer_use.virtual_input_adapter.validate_input_adapter_manifest_for_real_desktop",
        "sciforge_computer_use.repair_manifest.validate_repair_manifest",
        "sciforge_computer_use.trace.build_repair_replay_evidence",
        "sciforge_computer_use.trace.validate_viewport_recovery_evidence",
        "sciforge_computer_use.target_bound_evidence.build_target_bound_real_window_probe_evidence",
        "sciforge_computer_use.target_bound_evidence.validate_target_bound_real_window_probe_evidence",
        "sciforge_computer_use.response_compat.extract_provider_text",
        "sciforge_computer_use.response_compat.responses_to_chat_completions",
        "sciforge_computer_use.response_compat.chat_completions_to_responses",
    } <= set(manifest["api"]["manifestCallablePaths"])
    assert manifest["api"]["getManifestMatchesActionProvider"] is True
    assert manifest["cliFixture"]["ran"] is True
    assert manifest["cliFixture"]["mode"] == "stdin-request-plus-fixture-json"
    assert manifest["cliFixture"]["resultRef"].endswith("plugin-probe-cli-result.json")
    assert manifest["cliFixture"]["fixtureOutputDirRef"].endswith("plugin-probe-cli-fixture")
    assert manifest["traceRefs"] == ["trace:plugin-probe/computer-use.json"]
    assert manifest["artifactRefs"] == ["artifact:plugin-probe/report.md"]
    assert manifest["rawActionManifestWritten"] is False
    assert manifest["rawCliStdoutWritten"] is False
    assert manifest["sciForgeRuntimeTouched"] is False
    assert manifest["guiTouched"] is False
    assert "actionSchema" not in manifest

    command, kwargs = calls[0]
    assert command[:3] == [command[0], "-m", "sciforge_computer_use"]
    assert "--fixture-json" in command
    assert "--fixture-output-dir" in command
    assert "--request-json" not in command
    assert json.loads(kwargs["input"])["task"] == "package-local plugin discovery probe"
    assert kwargs["cwd"] == PACKAGE_ROOT

    written_manifest = json.loads((tmp_path / "probe" / "plugin-probe-manifest.json").read_text(encoding="utf8"))
    written_result = json.loads((tmp_path / "probe" / "plugin-probe-cli-result.json").read_text(encoding="utf8"))
    assert written_manifest == manifest
    assert written_result["status"] == "completed"


def test_plugin_probe_blocks_when_manifest_is_missing(tmp_path):
    missing_manifest = tmp_path / "missing-action-provider.manifest.json"

    manifest = run_plugin_probe(
        manifest_path=missing_manifest,
        output_dir=tmp_path / "probe",
        module_importer=lambda _name: (_ for _ in ()).throw(AssertionError("must not import without manifest")),
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "missing-manifest"
    assert str(missing_manifest) in manifest["reason"]
    assert manifest["actionProviderManifestRef"] == str(missing_manifest.resolve())
    assert (tmp_path / "probe" / "plugin-probe-manifest.json").is_file()


def test_plugin_probe_blocks_when_required_api_symbol_is_missing(tmp_path):
    class FakeModule:
        __file__ = __file__

        @staticmethod
        def run_task():
            return None

        @staticmethod
        def getManifest():
            return {"id": "sciforge.computer-use"}

    manifest = run_plugin_probe(
        output_dir=tmp_path / "probe",
        module_importer=lambda _name: FakeModule,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "missing-api-symbol"
    assert "runTask" in manifest["reason"]
    assert any(check["category"] == "api-symbol:runTask" and not check["ok"] for check in manifest["checks"])


def test_plugin_probe_blocks_when_viewport_recovery_api_symbol_is_missing(tmp_path):
    class FakeModule:
        __file__ = __file__

        @staticmethod
        def run_task():
            return None

        @staticmethod
        def runTask():
            return None

        @staticmethod
        def getManifest():
            return {"id": "sciforge.computer-use"}

        @staticmethod
        def validateTrace():
            return None

        @staticmethod
        def compactResult():
            return None

        @staticmethod
        def buildRepairReplayEvidence():
            return None

        @staticmethod
        def validateRepairReplayEvidence():
            return None

        @staticmethod
        def buildViewportRecoveryEvidence():
            return None

    manifest = run_plugin_probe(
        output_dir=tmp_path / "probe",
        module_importer=lambda _name: FakeModule,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "missing-api-symbol"
    assert "validateViewportRecoveryEvidence" in manifest["reason"]
    assert any(
        check["category"] == "api-symbol:validateViewportRecoveryEvidence" and not check["ok"]
        for check in manifest["checks"]
    )


def test_plugin_probe_blocks_when_manifest_callable_path_is_missing(tmp_path):
    manifest_payload = json.loads(ACTION_MANIFEST.read_text(encoding="utf8"))
    manifest_payload["hostPortsContract"]["executorAdapterContract"]["adapterManifestValidator"] = (
        "sciforge_computer_use.virtual_input_adapter.missing_adapter_manifest_validator"
    )
    manifest_path = tmp_path / "action-provider.manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload), encoding="utf8")

    manifest = run_plugin_probe(
        manifest_path=manifest_path,
        output_dir=tmp_path / "probe",
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "manifest-api-path-missing"
    assert "missing_adapter_manifest_validator" in manifest["reason"]
    assert any(
        check["category"].endswith("missing_adapter_manifest_validator") and not check["ok"]
        for check in manifest["checks"]
    )


def test_plugin_probe_blocks_unsafe_cli_entrypoint(tmp_path):
    bad_manifest = _write_manifest(
        tmp_path,
        {
            "cli": "python -m sciforge_computer_use; rm -rf / --request-json '<json>' --host-port-stdio",
        },
    )

    manifest = run_plugin_probe(
        manifest_path=bad_manifest,
        output_dir=tmp_path / "probe",
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "unsafe-entrypoint"
    assert "shell control" in manifest["reason"]
    assert any(check["category"] == "entrypoint-cli" and not check["ok"] for check in manifest["checks"])


def test_plugin_probe_blocks_non_package_local_entrypoint(tmp_path):
    bad_manifest = _write_manifest(
        tmp_path,
        {
            "module": "os",
            "symbol": "system",
            "cli": "python -m os --request-json '<json>' --host-port-stdio",
        },
    )

    manifest = run_plugin_probe(
        manifest_path=bad_manifest,
        output_dir=tmp_path / "probe",
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "non-package-local-entrypoint"
    assert "not package-local" in manifest["reason"]
    assert any(check["category"] == "entrypoint-module" and not check["ok"] for check in manifest["checks"])


def _write_manifest(tmp_path, entrypoint_updates):
    manifest = json.loads(ACTION_MANIFEST.read_text(encoding="utf8"))
    manifest["entrypoint"] = {
        **manifest["entrypoint"],
        **entrypoint_updates,
    }
    manifest_path = tmp_path / "action-provider.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf8")
    return manifest_path
