"""Package-local discovery probe for the Computer Use action provider.

The probe intentionally stays inside ``packages/actions/computer-use``. It
parses the action-provider manifest, verifies the declared Python package
surface, and can optionally call the package CLI with a tiny stdin+fixture run.
It does not import SciForge runtime code or touch any GUI host.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


PROBE_MANIFEST_SCHEMA = "sciforge.computer-use.plugin-probe-manifest.v1"
PROBE_MANIFEST_NAME = "plugin-probe-manifest.json"
CLI_RESULT_NAME = "plugin-probe-cli-result.json"
ACTION_MANIFEST_NAME = "action-provider.manifest.json"
PACKAGE_MODULE = "sciforge_computer_use"
REQUIRED_API_VALUE_SYMBOLS = (
    "executorCommandEventLogSchema",
    "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA",
)

ModuleImporter = Callable[[str], Any]
SubprocessRun = Callable[..., subprocess.CompletedProcess[str]]


class ProbeFailure(RuntimeError):
    def __init__(
        self,
        category: str,
        reason: str,
        *,
        checks: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        super().__init__(reason)
        self.category = category
        self.reason = reason
        self.checks = [dict(check) for check in checks or []]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the package-local Computer Use plugin discovery probe.")
    parser.add_argument("--output-dir", required=True, help="Directory for the refs-first probe manifest.")
    parser.add_argument("--manifest-path", help="Override action-provider manifest path.")
    parser.add_argument("--run-fixture", action="store_true", help="Call the package CLI with a tiny stdin+fixture run.")
    args = parser.parse_args(argv)

    manifest = run_plugin_probe(
        output_dir=Path(args.output_dir).expanduser(),
        manifest_path=Path(args.manifest_path).expanduser() if args.manifest_path else None,
        run_fixture=args.run_fixture,
    )
    json.dump(manifest, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest.get("status") == "completed" else 1


def run_plugin_probe(
    *,
    package_root: Path | None = None,
    manifest_path: Path | None = None,
    output_dir: Path | None = None,
    run_fixture: bool = False,
    required_api_symbols: Sequence[str] | None = None,
    module_importer: ModuleImporter = importlib.import_module,
    subprocess_run: SubprocessRun = subprocess.run,
) -> dict[str, Any]:
    """Return a refs-first manifest for package-local plugin discovery."""

    package_root = (package_root or Path(__file__).resolve().parents[1]).resolve()
    manifest_path = (manifest_path or package_root / ACTION_MANIFEST_NAME).resolve()
    output_dir = output_dir.resolve() if output_dir is not None else None
    probe_manifest_ref = (output_dir / PROBE_MANIFEST_NAME).resolve() if output_dir is not None else None
    checks: list[dict[str, Any]] = []

    try:
        action_manifest = _load_action_manifest(manifest_path)
        entrypoint = _entrypoint(action_manifest)
        entry_module = _entrypoint_module(entrypoint)
        entry_symbol = _entrypoint_symbol(entrypoint)
        required_symbols = _required_api_symbols(entry_symbol, required_api_symbols)

        _check_entrypoint_type(entrypoint, checks)
        entrypoint_path = _check_entrypoint_path(entrypoint, package_root, checks)
        _check_package_local_module(entry_module, checks)
        cli_tokens = _check_cli_entrypoint(entrypoint, entry_module, checks)
        api_checks, api_manifest = _check_api_symbols(
            entry_module=entry_module,
            action_manifest=action_manifest,
            required_symbols=required_symbols,
            module_importer=module_importer,
        )
        checks.extend(api_checks)
        manifest_callable_paths = _manifest_callable_paths(action_manifest)
        checks.extend(_check_manifest_callable_paths(
            manifest_callable_paths,
            module_importer=module_importer,
        ))
        diagnostic_probe_modules = _check_manifest_diagnostic_probe_commands(
            _manifest_diagnostic_probe_commands(action_manifest),
            checks,
            module_importer=module_importer,
        )
        _check_manifest_diagnostic_claim_semantics(action_manifest, checks)

        cli_probe = _not_run_cli_probe()
        cli_trace_refs: list[str] = []
        cli_screenshot_refs: list[str] = []
        cli_artifact_refs: list[str] = []
        if run_fixture:
            cli_probe, cli_payload = _run_cli_fixture_probe(
                package_root=package_root,
                entry_module=entry_module,
                output_dir=output_dir,
                subprocess_run=subprocess_run,
            )
            cli_trace_refs = list(cli_payload.get("traceRefs") or [])
            cli_screenshot_refs = list(cli_payload.get("screenshotRefs") or [])
            cli_artifact_refs = list(cli_payload.get("artifactRefs") or [])

        manifest = _base_manifest(
            status="completed",
            category="package-local-plugin-discovery",
            reason="Action provider manifest, package API, and CLI entrypoint are discoverable.",
            probe_manifest_ref=probe_manifest_ref,
            action_manifest_ref=manifest_path,
            package_root_ref=package_root,
            trace_refs=cli_trace_refs,
            screenshot_refs=cli_screenshot_refs,
            artifact_refs=cli_artifact_refs,
        )
        manifest.update(
            {
                "actionProvider": {
                    "id": action_manifest.get("id"),
                    "version": action_manifest.get("version"),
                    "schemaVersion": action_manifest.get("schemaVersion"),
                    "kind": action_manifest.get("kind"),
                },
                "entrypoint": {
                    "type": entrypoint.get("type"),
                    "package": entrypoint.get("package"),
                    "module": entry_module,
                    "symbol": entry_symbol,
                    "path": entrypoint.get("path"),
                    "resolvedPathRef": str(entrypoint_path),
                    "cliModule": _module_after_dash_m(cli_tokens),
                    "interface": entrypoint.get("interface"),
                },
                "api": {
                    "module": entry_module,
                    "moduleRef": _module_file_ref(module_importer, entry_module),
                    "requiredSymbols": required_symbols,
                    "requiredValueSymbols": list(REQUIRED_API_VALUE_SYMBOLS),
                    "manifestCallablePaths": manifest_callable_paths,
                    "getManifestMatchesActionProvider": api_manifest.get("id") == action_manifest.get("id"),
                },
                "diagnosticProbeModules": diagnostic_probe_modules,
                "cliFixture": cli_probe,
                "diagnosticOnly": True,
                "userAcceptanceEligible": False,
                "l1SmokeCompleted": False,
                "l3WorkflowCompleted": False,
                "claimLimit": (
                    "Plugin discovery only proves package manifest/API/CLI fixture plumbing. "
                    "It does not execute a real isolated desktop L1 smoke run or L3 multi-app workflow."
                ),
                "checks": checks,
                "rawActionManifestWritten": False,
                "rawCliStdoutWritten": False,
                "sciForgeRuntimeTouched": False,
                "guiTouched": False,
            }
        )
    except ProbeFailure as exc:
        manifest = _base_manifest(
            status="blocked",
            category=exc.category,
            reason=exc.reason,
            probe_manifest_ref=probe_manifest_ref,
            action_manifest_ref=manifest_path,
            package_root_ref=package_root,
            trace_refs=[],
            screenshot_refs=[],
            artifact_refs=[],
        )
        manifest.update(
            {
                "checks": exc.checks or checks,
                "rawActionManifestWritten": False,
                "rawCliStdoutWritten": False,
                "sciForgeRuntimeTouched": False,
                "guiTouched": False,
            }
        )

    if probe_manifest_ref is not None:
        _write_json(probe_manifest_ref, manifest)
    return manifest


def _load_action_manifest(path: Path) -> Mapping[str, Any]:
    if not path.is_file():
        raise ProbeFailure("missing-manifest", f"Action provider manifest not found: {path}.")
    try:
        parsed = json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError as exc:
        raise ProbeFailure("invalid-manifest", f"Action provider manifest is not valid JSON: {exc}.") from exc
    if not isinstance(parsed, Mapping):
        raise ProbeFailure("invalid-manifest", "Action provider manifest root must be a JSON object.")
    return parsed


def _entrypoint(action_manifest: Mapping[str, Any]) -> Mapping[str, Any]:
    entrypoint = action_manifest.get("entrypoint")
    if not isinstance(entrypoint, Mapping):
        raise ProbeFailure("invalid-manifest", "Action provider manifest is missing object entrypoint.")
    return entrypoint


def _entrypoint_module(entrypoint: Mapping[str, Any]) -> str:
    module = entrypoint.get("module")
    if not isinstance(module, str) or not module.strip():
        raise ProbeFailure("invalid-manifest", "Manifest entrypoint.module must be a non-empty string.")
    return module.strip()


def _entrypoint_symbol(entrypoint: Mapping[str, Any]) -> str:
    symbol = entrypoint.get("symbol")
    if not isinstance(symbol, str) or not _is_identifier_path(symbol):
        raise ProbeFailure("invalid-manifest", "Manifest entrypoint.symbol must be a valid Python symbol name.")
    return symbol


def _required_api_symbols(entry_symbol: str, override: Sequence[str] | None) -> list[str]:
    symbols = list(override or [
        entry_symbol,
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
        "buildIsolatedDesktopL1SmokeEvidence",
        "validateIsolatedDesktopL1SmokeEvidence",
        "buildIsolatedDesktopL3WorkflowEvidence",
        "validateIsolatedDesktopL3WorkflowEvidence",
        "buildTargetBoundInputAdapterManifest",
        "validateInputAdapterManifestForRealDesktop",
        "validateRepairManifest",
        "buildVisibleRunViewer",
        "validateVisibleRunViewerManifest",
        "buildEvidenceIndex",
        "buildEvidenceSnapshot",
        "buildPlannerBrief",
    ])
    ordered: list[str] = []
    for symbol in symbols:
        if symbol not in ordered:
            ordered.append(symbol)
    return ordered


def _check_entrypoint_type(entrypoint: Mapping[str, Any], checks: list[dict[str, Any]]) -> None:
    entrypoint_type = entrypoint.get("type")
    ok = entrypoint_type == "python-package"
    checks.append(_check("entrypoint-type", ok, "" if ok else "entrypoint.type must be python-package."))
    if not ok:
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.type is not python-package.", checks=checks)


def _check_entrypoint_path(
    entrypoint: Mapping[str, Any],
    package_root: Path,
    checks: list[dict[str, Any]],
) -> Path:
    raw_path = entrypoint.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        checks.append(_check("entrypoint-path", False, "entrypoint.path must be a non-empty relative package path."))
        raise ProbeFailure("non-package-local-entrypoint", "Manifest entrypoint.path is missing.", checks=checks)
    entry_path = Path(raw_path)
    if entry_path.is_absolute() or any(part == ".." for part in entry_path.parts):
        checks.append(_check("entrypoint-path", False, "entrypoint.path must not be absolute or parent-relative."))
        raise ProbeFailure("non-package-local-entrypoint", "Manifest entrypoint.path is not package-local.", checks=checks)

    for base in (package_root, *package_root.parents):
        candidate = (base / entry_path).resolve()
        if candidate == package_root:
            checks.append(_check("entrypoint-path", True))
            return candidate

    checks.append(_check("entrypoint-path", False, f"entrypoint.path resolves outside package root: {raw_path}."))
    raise ProbeFailure("non-package-local-entrypoint", "Manifest entrypoint.path does not resolve to this package.", checks=checks)


def _check_package_local_module(module: str, checks: list[dict[str, Any]]) -> None:
    ok = _is_package_local_module(module)
    checks.append(_check("entrypoint-module", ok, "" if ok else f"Module {module!r} is not package-local."))
    if not ok:
        raise ProbeFailure("non-package-local-entrypoint", "Manifest entrypoint.module is not package-local.", checks=checks)


def _check_cli_entrypoint(entrypoint: Mapping[str, Any], expected_module: str, checks: list[dict[str, Any]]) -> list[str]:
    cli = entrypoint.get("cli")
    if not isinstance(cli, str) or not cli.strip():
        checks.append(_check("entrypoint-cli", False, "entrypoint.cli must be a non-empty string."))
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.cli is missing.", checks=checks)
    try:
        tokens = shlex.split(cli)
    except ValueError as exc:
        checks.append(_check("entrypoint-cli", False, f"entrypoint.cli cannot be parsed safely: {exc}."))
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.cli cannot be parsed safely.", checks=checks) from exc

    unsafe_token = _unsafe_cli_token(tokens)
    if unsafe_token:
        checks.append(_check("entrypoint-cli", False, f"entrypoint.cli contains unsafe token: {unsafe_token!r}."))
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.cli contains shell control syntax.", checks=checks)
    if len(tokens) < 3 or _python_command_name(tokens[0]) is None or "-m" not in tokens:
        checks.append(_check("entrypoint-cli", False, "entrypoint.cli must use python -m <package-module>."))
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.cli is not a python -m package entrypoint.", checks=checks)

    module = _module_after_dash_m(tokens)
    if module != expected_module or not _is_package_local_module(module):
        checks.append(_check("entrypoint-cli", False, f"CLI module {module!r} is not the manifest package module."))
        raise ProbeFailure("non-package-local-entrypoint", "Manifest entrypoint.cli is not package-local.", checks=checks)
    if "--request-json" not in tokens or "--host-port-stdio" not in tokens:
        checks.append(_check("entrypoint-cli", False, "entrypoint.cli must expose request-json and host-port-stdio flags."))
        raise ProbeFailure("unsafe-entrypoint", "Manifest entrypoint.cli does not expose the expected stdin protocol.", checks=checks)

    checks.append(_check("entrypoint-cli", True))
    return tokens


def _check_api_symbols(
    *,
    entry_module: str,
    action_manifest: Mapping[str, Any],
    required_symbols: Sequence[str],
    module_importer: ModuleImporter,
) -> tuple[list[dict[str, Any]], Mapping[str, Any]]:
    checks: list[dict[str, Any]] = []
    try:
        module = module_importer(entry_module)
    except Exception as exc:  # noqa: BLE001 - import failure must become a blocked manifest.
        checks.append(_check("api-import", False, str(exc)))
        raise ProbeFailure("api-import-failed", f"Could not import package module {entry_module!r}: {exc}.", checks=checks) from exc

    checks.append(_check("api-import", True))
    for symbol in required_symbols:
        value = getattr(module, symbol, None)
        ok = callable(value)
        checks.append(_check(f"api-symbol:{symbol}", ok, "" if ok else f"Missing callable API symbol {symbol!r}."))
        if not ok:
            raise ProbeFailure("missing-api-symbol", f"Package API is missing callable symbol {symbol!r}.", checks=checks)
    value_symbol_values: dict[str, Any] = {}
    for symbol in REQUIRED_API_VALUE_SYMBOLS:
        value = getattr(module, symbol, None)
        ok = isinstance(value, str) and bool(value.strip())
        checks.append(_check(f"api-value-symbol:{symbol}", ok, "" if ok else f"Missing non-empty string API symbol {symbol!r}."))
        if not ok:
            raise ProbeFailure("missing-api-symbol", f"Package API is missing value symbol {symbol!r}.", checks=checks)
        value_symbol_values[symbol] = value
    if value_symbol_values.get("executorCommandEventLogSchema") != value_symbol_values.get("EXECUTOR_COMMAND_EVENT_LOG_SCHEMA"):
        checks.append(_check("api-value-symbol:executorCommandEventLogSchema", False, "executorCommandEventLogSchema must match EXECUTOR_COMMAND_EVENT_LOG_SCHEMA."))
        raise ProbeFailure("api-symbol-mismatch", "Package API executor command event schema aliases do not match.", checks=checks)

    api_manifest = getattr(module, "getManifest")()
    if not isinstance(api_manifest, Mapping):
        checks.append(_check("api-getManifest", False, "getManifest() did not return a JSON object."))
        raise ProbeFailure("api-manifest-mismatch", "Package API getManifest() did not return a JSON object.", checks=checks)
    ok = api_manifest.get("id") == action_manifest.get("id")
    checks.append(_check("api-getManifest", ok, "" if ok else "getManifest() id does not match action-provider manifest id."))
    if not ok:
        raise ProbeFailure("api-manifest-mismatch", "Package API getManifest() does not match action-provider manifest.", checks=checks)
    return checks, api_manifest


def _manifest_callable_paths(action_manifest: Mapping[str, Any]) -> list[str]:
    paths = [
        _nested_string(action_manifest, ("hostPortsContract", "executorAdapterContract", "targetBoundManifestBuilder")),
        _nested_string(action_manifest, ("hostPortsContract", "executorAdapterContract", "adapterManifestValidator")),
        _nested_string(action_manifest, ("hostPortsContract", "executorAdapterContract", "bindingHelper")),
        _nested_string(action_manifest, ("hostPortsContract", "executorAdapterContract", "bindingValidator")),
        _nested_string(action_manifest, ("repairManifestContract", "validator")),
        _nested_string(action_manifest, ("repairReplayContract", "builder")),
        _nested_string(action_manifest, ("repairReplayContract", "validator")),
        _nested_string(action_manifest, ("viewportRecoveryContract", "builder")),
        _nested_string(action_manifest, ("viewportRecoveryContract", "validator")),
        _nested_string(action_manifest, ("targetBoundRealWindowProbeContract", "builder")),
        _nested_string(action_manifest, ("targetBoundRealWindowProbeContract", "validator")),
        _nested_string(action_manifest, ("isolatedDesktopL1SmokeContract", "builder")),
        _nested_string(action_manifest, ("isolatedDesktopL1SmokeContract", "validator")),
        _nested_string(action_manifest, ("isolatedDesktopL3WorkflowContract", "builder")),
        _nested_string(action_manifest, ("isolatedDesktopL3WorkflowContract", "validator")),
        _nested_string(action_manifest, ("semanticVerifierProbeContract", "responseCompatibilityHelper")),
        _nested_string(action_manifest, ("semanticVerifierProbeContract", "responseCompatibilityHelpers", "textExtraction")),
        _nested_string(action_manifest, ("semanticVerifierProbeContract", "responseCompatibilityHelpers", "responsesToChatCompletions")),
        _nested_string(action_manifest, ("semanticVerifierProbeContract", "responseCompatibilityHelpers", "chatCompletionsToResponses")),
        *_recursive_manifest_callable_paths(action_manifest),
    ]
    ordered: list[str] = []
    for path in paths:
        if path and path not in ordered:
            ordered.append(path)
    return ordered


def _recursive_manifest_callable_paths(value: Any, *, parent_key: str = "") -> list[str]:
    paths: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if isinstance(item, str) and (_is_callable_manifest_key(key_text) or _is_callable_container_key(parent_key)):
                if "." in item:
                    paths.append(item.strip())
            paths.extend(_recursive_manifest_callable_paths(item, parent_key=key_text))
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str) and _is_callable_container_key(parent_key) and "." in item:
                paths.append(item.strip())
            paths.extend(_recursive_manifest_callable_paths(item, parent_key=parent_key))
    return paths


def _is_callable_manifest_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return normalized in {"assembler", "builder", "validator", "helper"} or normalized.endswith(("assembler", "builder", "validator", "helper"))


def _is_callable_container_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return normalized.endswith("helpers")


def _check_manifest_callable_paths(
    paths: Sequence[str],
    *,
    module_importer: ModuleImporter,
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for dotted_path in paths:
        module_name, separator, symbol = dotted_path.rpartition(".")
        ok_path = bool(separator and _is_package_local_module(module_name) and _is_identifier_path(symbol))
        checks.append(_check(
            f"manifest-api-path:{dotted_path}",
            ok_path,
            "" if ok_path else f"Manifest callable path {dotted_path!r} is not a package-local dotted symbol.",
        ))
        if not ok_path:
            raise ProbeFailure(
                "manifest-api-path-invalid",
                f"Manifest callable path {dotted_path!r} is not a package-local dotted symbol.",
                checks=checks,
            )
        try:
            module = module_importer(module_name)
        except Exception as exc:  # noqa: BLE001 - import failure must become blocked probe evidence.
            checks[-1] = _check(f"manifest-api-path:{dotted_path}", False, str(exc))
            raise ProbeFailure(
                "manifest-api-path-import-failed",
                f"Could not import manifest callable module {module_name!r}: {exc}.",
                checks=checks,
            ) from exc
        value = getattr(module, symbol, None)
        ok = callable(value)
        checks[-1] = _check(
            f"manifest-api-path:{dotted_path}",
            ok,
            "" if ok else f"Manifest callable path {dotted_path!r} is not callable.",
        )
        if not ok:
            raise ProbeFailure(
                "manifest-api-path-missing",
                f"Manifest callable path {dotted_path!r} is not callable.",
                checks=checks,
            )
    return checks


def _manifest_diagnostic_probe_commands(action_manifest: Mapping[str, Any]) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    entrypoint = action_manifest.get("entrypoint")
    if isinstance(entrypoint, Mapping):
        for key, item in entrypoint.items():
            if str(key).endswith("Probe") and isinstance(item, str) and item.strip():
                commands.append({"manifestPath": f"entrypoint.{key}", "command": item.strip()})

    diagnostic_probes = _nested_mapping(action_manifest, ("hostPortsContract", "diagnosticProbes"))
    if diagnostic_probes is not None:
        commands.extend(_recursive_diagnostic_probe_commands(
            diagnostic_probes,
            manifest_path="hostPortsContract.diagnosticProbes",
        ))
    return commands


def _recursive_diagnostic_probe_commands(value: Any, *, manifest_path: str) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            commands.extend(_recursive_diagnostic_probe_commands(item, manifest_path=f"{manifest_path}.{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            commands.extend(_recursive_diagnostic_probe_commands(item, manifest_path=f"{manifest_path}[{index}]"))
    elif isinstance(value, str) and value.strip():
        commands.append({"manifestPath": manifest_path, "command": value.strip()})
    return commands


def _check_manifest_diagnostic_probe_commands(
    commands: Sequence[Mapping[str, str]],
    checks: list[dict[str, Any]],
    *,
    module_importer: ModuleImporter,
) -> list[dict[str, str]]:
    modules: list[dict[str, str]] = []
    for command_entry in commands:
        manifest_path = command_entry["manifestPath"]
        command = command_entry["command"]
        try:
            tokens = shlex.split(command)
        except ValueError as exc:
            checks.append(_diagnostic_probe_check(
                manifest_path,
                False,
                f"diagnostic probe command cannot be parsed safely: {exc}.",
            ))
            raise ProbeFailure(
                "unsafe-diagnostic-probe-command",
                f"Manifest diagnostic probe command at {manifest_path} cannot be parsed safely.",
                checks=checks,
            ) from exc

        unsafe_token = _unsafe_cli_token(tokens)
        if unsafe_token:
            checks.append(_diagnostic_probe_check(
                manifest_path,
                False,
                f"diagnostic probe command contains unsafe token: {unsafe_token!r}.",
            ))
            raise ProbeFailure(
                "unsafe-diagnostic-probe-command",
                f"Manifest diagnostic probe command at {manifest_path} contains shell control syntax.",
                checks=checks,
            )

        module = _python_dash_m_module(tokens)
        if module is None:
            checks.append(_diagnostic_probe_check(
                manifest_path,
                False,
                "diagnostic probe command must use python -m <package-module>.",
            ))
            raise ProbeFailure(
                "unsafe-diagnostic-probe-command",
                f"Manifest diagnostic probe command at {manifest_path} is not a python -m package entrypoint.",
                checks=checks,
            )
        if not _is_package_local_module(module):
            checks.append(_diagnostic_probe_check(
                manifest_path,
                False,
                f"diagnostic probe module {module!r} is not package-local.",
                module=module,
            ))
            raise ProbeFailure(
                "diagnostic-probe-module-external",
                f"Manifest diagnostic probe module {module!r} at {manifest_path} is not package-local.",
                checks=checks,
            )

        try:
            module_importer(module)
        except Exception as exc:  # noqa: BLE001 - import failure must become blocked probe evidence.
            checks.append(_diagnostic_probe_check(manifest_path, False, str(exc), module=module))
            raise ProbeFailure(
                "diagnostic-probe-module-import-failed",
                f"Could not import diagnostic probe module {module!r} from {manifest_path}: {exc}.",
                checks=checks,
            ) from exc

        checks.append(_diagnostic_probe_check(manifest_path, True, module=module))
        modules.append({"manifestPath": manifest_path, "module": module})
    return modules


def _check_manifest_diagnostic_claim_semantics(
    action_manifest: Mapping[str, Any],
    checks: list[dict[str, Any]],
) -> None:
    diagnostic_probes = _nested_mapping(action_manifest, ("hostPortsContract", "diagnosticProbes")) or {}
    execute_probe = diagnostic_probes.get("isolatedDesktopL3WorkflowExecute")
    if not isinstance(execute_probe, str) or "--execute" not in execute_probe:
        checks.append(_check(
            "diagnostic-claim-semantics:l3-execute-key",
            False,
            "L3 workflow diagnostic probes must expose isolatedDesktopL3WorkflowExecute and include --execute now that a completed runner exists.",
        ))
        raise ProbeFailure(
            "diagnostic-claim-semantics-invalid",
            "Manifest is missing isolatedDesktopL3WorkflowExecute for the completed L3 workflow probe.",
            checks=checks,
        )
    checks.append(_check("diagnostic-claim-semantics:l3-execute-key", True))

    workflow_requirements = _nested_mapping(action_manifest, ("isolatedDesktopL3WorkflowContract", "workflowRequirements")) or {}
    partial_policy = workflow_requirements.get("partialRuntimeRefsPolicy")
    if not isinstance(partial_policy, str):
        checks.append(_check(
            "diagnostic-claim-semantics:l3-partial-runtime-policy",
            False,
            "isolatedDesktopL3WorkflowContract.workflowRequirements.partialRuntimeRefsPolicy must be a string.",
        ))
        raise ProbeFailure(
            "diagnostic-claim-semantics-invalid",
            "Manifest is missing the L3 partial runtime claim-limit policy.",
            checks=checks,
        )
    missing_policy_markers = [
        marker
        for marker in ("eventCount=0", "events=[]", "no-workflow-input", "launcher-completed")
        if marker not in partial_policy
    ]
    if missing_policy_markers:
        checks.append(_check(
            "diagnostic-claim-semantics:l3-partial-runtime-policy",
            False,
            f"partialRuntimeRefsPolicy is missing markers: {', '.join(missing_policy_markers)}.",
        ))
        raise ProbeFailure(
            "diagnostic-claim-semantics-invalid",
            "Manifest L3 partial runtime policy does not fully describe empty command-log and file-preview launcher semantics.",
            checks=checks,
        )
    checks.append(_check("diagnostic-claim-semantics:l3-partial-runtime-policy", True))

    claim_limit = _nested_string(action_manifest, ("isolatedDesktopL3WorkflowContract", "claimLimit")) or ""
    missing_claim_markers = [marker for marker in ("traceRefs", "completionEvidenceRef") if marker not in claim_limit]
    if missing_claim_markers:
        checks.append(_check(
            "diagnostic-claim-semantics:l3-claim-limit",
            False,
            f"L3 claimLimit is missing markers: {', '.join(missing_claim_markers)}.",
        ))
        raise ProbeFailure(
            "diagnostic-claim-semantics-invalid",
            "Manifest L3 claim limit must forbid partial refs from completed traceRefs and completionEvidenceRef.",
            checks=checks,
        )
    checks.append(_check("diagnostic-claim-semantics:l3-claim-limit", True))


def _diagnostic_probe_check(
    manifest_path: str,
    ok: bool,
    reason: str = "",
    *,
    module: str | None = None,
) -> dict[str, Any]:
    check = _check(f"diagnostic-probe-command:{manifest_path}", ok, reason)
    if module is not None:
        check["module"] = module
    return check


def _nested_string(root: Mapping[str, Any], path: Sequence[str]) -> str | None:
    value: Any = root
    for part in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _nested_mapping(root: Mapping[str, Any], path: Sequence[str]) -> Mapping[str, Any] | None:
    value: Any = root
    for part in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value if isinstance(value, Mapping) else None


def _run_cli_fixture_probe(
    *,
    package_root: Path,
    entry_module: str,
    output_dir: Path | None,
    subprocess_run: SubprocessRun,
) -> tuple[dict[str, Any], Mapping[str, Any]]:
    request = {
        "task": "package-local plugin discovery probe",
        "maxSteps": 1,
        "riskPolicy": "fail-closed",
    }
    fixture = {
        "capture": [
            {
                "ref": ".sciforge/plugin-probe/before.png",
                "summary": "package-local plugin probe observation",
            }
        ],
        "plans": [
            {
                "done": True,
                "reason": "package-local plugin probe fixture completed",
            }
        ],
        "traceRef": "trace:plugin-probe/computer-use.json",
    }
    command = [
        sys.executable,
        "-m",
        entry_module,
        "--fixture-json",
        json.dumps(fixture, sort_keys=True),
    ]
    fixture_output_dir: Path | None = None
    if output_dir is not None:
        fixture_output_dir = (output_dir / "plugin-probe-cli-fixture").resolve()
        command.extend(["--fixture-output-dir", str(fixture_output_dir)])
    env = {
        **os.environ,
        "PYTHONPATH": str(package_root),
    }
    completed = subprocess_run(
        command,
        cwd=package_root,
        input=json.dumps(request, sort_keys=True),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    stdout = str(getattr(completed, "stdout", "") or "")
    stderr = str(getattr(completed, "stderr", "") or "")
    returncode = int(getattr(completed, "returncode", 1))
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ProbeFailure("cli-fixture-failed", f"CLI fixture did not return JSON stdout: {exc}.") from exc
    if not isinstance(payload, Mapping):
        raise ProbeFailure("cli-fixture-failed", "CLI fixture stdout root must be a JSON object.")
    if returncode != 0 or payload.get("status") not in {"completed", "max-steps", "needs-confirmation"}:
        reason = str(payload.get("reason") or payload.get("message") or stderr or "CLI fixture failed.")
        raise ProbeFailure("cli-fixture-failed", reason)

    result_ref: str | None = None
    if output_dir is not None:
        result_path = (output_dir / CLI_RESULT_NAME).resolve()
        _write_json(result_path, payload)
        result_ref = str(result_path)
    return (
        {
            "ran": True,
            "mode": "stdin-request-plus-fixture-json",
            "returnCode": returncode,
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "resultRef": result_ref,
            "fixtureOutputDirRef": str(fixture_output_dir) if fixture_output_dir is not None else None,
            "stdinRequest": True,
            "fixtureJson": True,
        },
        payload,
    )


def _not_run_cli_probe() -> dict[str, Any]:
    return {
        "ran": False,
        "mode": "not-run",
        "reason": "Pass --run-fixture to call the package CLI with stdin request JSON and fixture host ports.",
        "stdinRequest": False,
        "fixtureJson": False,
    }


def _base_manifest(
    *,
    status: str,
    category: str,
    reason: str,
    probe_manifest_ref: Path | None,
    action_manifest_ref: Path,
    package_root_ref: Path,
    trace_refs: Sequence[str],
    screenshot_refs: Sequence[str],
    artifact_refs: Sequence[str],
) -> dict[str, Any]:
    return {
        "schemaVersion": PROBE_MANIFEST_SCHEMA,
        "status": status,
        "category": category,
        "reason": reason,
        "probeManifestRef": str(probe_manifest_ref) if probe_manifest_ref is not None else None,
        "actionProviderManifestRef": str(action_manifest_ref),
        "packageRootRef": str(package_root_ref),
        "traceRefs": list(trace_refs),
        "screenshotRefs": list(screenshot_refs),
        "artifactRefs": list(artifact_refs),
    }


def _check(category: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": reason}


def _module_file_ref(module_importer: ModuleImporter, module_name: str) -> str | None:
    try:
        module = module_importer(module_name)
    except Exception:  # noqa: BLE001 - module import is already checked elsewhere.
        return None
    module_file = getattr(module, "__file__", None)
    return str(Path(module_file).resolve()) if module_file else None


def _module_after_dash_m(tokens: Sequence[str]) -> str | None:
    try:
        index = list(tokens).index("-m")
    except ValueError:
        return None
    if index + 1 >= len(tokens):
        return None
    return tokens[index + 1]


def _python_dash_m_module(tokens: Sequence[str]) -> str | None:
    if len(tokens) < 3 or _python_command_name(tokens[0]) is None:
        return None
    return _module_after_dash_m(tokens)


def _unsafe_cli_token(tokens: Sequence[str]) -> str | None:
    for token in tokens:
        if any(marker in token for marker in (";", "&", "|", "`", "$(")):
            return token
    return None


def _python_command_name(value: str) -> str | None:
    name = Path(value).name
    if name == "python" or re.fullmatch(r"python\d+(\.\d+)?", name):
        return name
    if value == sys.executable:
        return name
    return None


def _is_package_local_module(module: str | None) -> bool:
    if not isinstance(module, str) or not _is_identifier_path(module):
        return False
    return module == PACKAGE_MODULE or module.startswith(f"{PACKAGE_MODULE}.")


def _is_identifier_path(value: str) -> bool:
    return all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", part) for part in value.split("."))


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf8")


if __name__ == "__main__":
    raise SystemExit(main())
