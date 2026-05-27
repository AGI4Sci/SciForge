"""Preflight manifest for native Computer Use desktop host ports.

This module does not capture the screen or send input. It records whether the
package can honestly claim readiness for a real-window host-port probe.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .virtual_input_adapter import (
    BLOCKED_INPUT_MODE_VALUES,
    TARGET_BOUND_READY_INPUT_CHANNEL_VALUES,
    VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA,
    VIRTUAL_INPUT_ADAPTER_STATUS,
    load_input_adapter_target_binding_manifest,
    validate_input_adapter_manifest_for_real_desktop,
    validate_input_adapter_target_binding_manifest,
)


PREFLIGHT_SCHEMA = "sciforge.computer-use.desktop-preflight.v1"
MANIFEST_NAME = "desktop-host-port-preflight-manifest.json"
LOOP_REQUIRED_HOST_PORTS = [
    "capture",
    "plan",
    "locate",
    "execute",
    "verify",
]
EVIDENCE_REQUIRED_HOST_PORTS = [
    "writeTrace",
    "emitEvent",
]
REAL_DESKTOP_REQUIRED_HOST_PORTS = [*LOOP_REQUIRED_HOST_PORTS, *EVIDENCE_REQUIRED_HOST_PORTS]
REQUIRED_HOST_PORTS = REAL_DESKTOP_REQUIRED_HOST_PORTS
DIAGNOSTIC_EXECUTOR_PROVIDERS = {
    "native-stdio-fail-closed-executor",
    "fail-closed-executor",
    "diagnostic-fail-closed-executor",
    "virtual-input-state-executor",
}
FORBIDDEN_SHORTCUT_EXECUTOR_PROVIDER_TOKENS = (
    "accessibility",
    "applescript",
    "ax",
    "clipboard",
    "directfilewrite",
    "dom",
    "filewrite",
    "osascript",
    "playwright",
    "privateapi",
    "puppeteer",
    "selenium",
    "shell",
)
ALLOWED_READY_INPUT_CHANNELS = set(TARGET_BOUND_READY_INPUT_CHANNEL_VALUES)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a Computer Use desktop host-port preflight manifest.")
    parser.add_argument("--output-dir", required=True, help="Directory where the preflight manifest is written.")
    parser.add_argument("--capabilities-json", help="Observed host capability JSON. If omitted, preflight blocks.")
    parser.add_argument("--capabilities-file", help="Observed host capability JSON file. Mutually exclusive with --capabilities-json.")
    parser.add_argument("--target-window", help="Optional human-readable target window descriptor.")
    args = parser.parse_args(argv)

    try:
        capabilities = _load_capabilities(args.capabilities_json, args.capabilities_file)
        manifest = build_preflight_manifest(
            output_dir=Path(args.output_dir).expanduser(),
            observed_capabilities=capabilities,
            target_window=args.target_window,
        )
        json.dump(manifest, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0 if manifest["status"] == "ready" else 1
    except Exception as exc:  # noqa: BLE001 - CLI must stay structured.
        payload = {
            "schemaVersion": PREFLIGHT_SCHEMA,
            "status": "blocked",
            "category": "preflight-error",
            "reason": str(exc),
            "requiredHostPorts": REQUIRED_HOST_PORTS,
            "loopRequiredHostPorts": LOOP_REQUIRED_HOST_PORTS,
            "evidenceRequiredHostPorts": EVIDENCE_REQUIRED_HOST_PORTS,
            "observedCapabilities": {},
            "traceRefs": [],
            "artifactRefs": [],
            "screenshotRefs": [],
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


def build_preflight_manifest(
    *,
    output_dir: Path,
    observed_capabilities: Mapping[str, Any] | None = None,
    target_window: str | None = None,
) -> dict[str, Any]:
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    capabilities = dict(observed_capabilities or {})
    checks = _preflight_checks(capabilities, target_window=target_window)
    status = "ready" if all(check["ok"] for check in checks) else "blocked"
    blocked_reasons = [check["reason"] for check in checks if not check["ok"]]
    manifest_ref = (output_dir / MANIFEST_NAME).resolve()
    manifest = {
        "schemaVersion": PREFLIGHT_SCHEMA,
        "status": status,
        "category": "native-desktop-host-ports" if status == "ready" else "native-desktop-host-ports-blocked",
        "reason": "Native desktop host-port preflight is ready." if status == "ready" else "; ".join(blocked_reasons),
        "blockedReasons": blocked_reasons,
        "requiredHostPorts": REQUIRED_HOST_PORTS,
        "loopRequiredHostPorts": LOOP_REQUIRED_HOST_PORTS,
        "evidenceRequiredHostPorts": EVIDENCE_REQUIRED_HOST_PORTS,
        "observedCapabilities": _safe_capabilities(capabilities),
        "preflightChecks": checks,
        "desktopPlatform": {
            "system": platform.system(),
            "machine": platform.machine(),
        },
        "targetWindow": target_window,
        "inputIsolation": {
            "required": "independent-simulated-input-adapter",
            "observed": _string_value(capabilities.get("inputAdapterStatus")) or "unknown",
            "inputChannel": _string_value(capabilities.get("inputChannel")) or "unknown",
            "adapterManifestDeclared": _adapter_manifest_declared(capabilities),
            "adapterManifestReadyForRealDesktop": _adapter_manifest_ready_for_real_desktop(capabilities),
            "adapterManifestSchema": _adapter_manifest_schema(capabilities),
            "adapterManifestRef": _string_value(capabilities.get("inputAdapterManifestRef")) or None,
            "adapterManifestValidation": _adapter_manifest_validation(capabilities),
            "targetBindingDeclared": _target_binding_declared(capabilities),
            "targetBindingSchema": _target_binding_schema(capabilities),
            "targetBindingRef": _string_value(capabilities.get("inputAdapterBindingManifestRef")) or None,
            "targetBindingValidation": _target_binding_validation(capabilities),
            "sharedSystemInputAllowed": False,
            "sharedSystemInputAcknowledged": bool(capabilities.get("sharedSystemInputAcknowledged")),
            "risk": (
                "shared-system-input cannot satisfy PROJECT.md final input isolation; "
                "it is diagnostic-only unless an upstream TUI Host explicitly acknowledges it."
            ),
        },
        "projectConstraints": [
            "Do not use SciForge runtime, GUI, CU-NEXT, browser acceptance, AgentServer, or release gate as plugin evidence.",
            "Use package-local or native host ports through the Computer Use package boundary.",
            "High-risk and shared-system input must fail closed unless explicitly acknowledged by the TUI Host.",
            "Claimed success must be backed by trace/result refs, screenshots, artifacts, or a blocked manifest.",
        ],
        "suggestedNextAction": _suggested_next_action(status, blocked_reasons),
        "manifestRef": str(manifest_ref),
        "traceRefs": [],
        "artifactRefs": [],
        "screenshotRefs": [],
        "rawPayloadWritten": False,
        "secretsWritten": False,
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _preflight_checks(capabilities: Mapping[str, Any], *, target_window: str | None) -> list[dict[str, Any]]:
    declared_ports = set(_string_list(capabilities.get("hostPorts")))
    missing_ports = [port for port in REAL_DESKTOP_REQUIRED_HOST_PORTS if port not in declared_ports]
    input_channel = _string_value(capabilities.get("inputChannel"))
    adapter_status = _string_value(capabilities.get("inputAdapterStatus"))
    capture_provider = _string_value(capabilities.get("captureProvider"))
    executor_provider = _string_value(capabilities.get("executorProvider"))
    input_channel_allowed = _input_channel_allowed_for_ready(input_channel)
    executor_provider_allowed = _executor_provider_allowed_for_ready(executor_provider)
    adapter_declared = adapter_status == VIRTUAL_INPUT_ADAPTER_STATUS and _adapter_manifest_declared(capabilities)
    adapter_ready = adapter_status == VIRTUAL_INPUT_ADAPTER_STATUS and _adapter_manifest_ready_for_real_desktop(capabilities)
    target_binding_declared = _target_binding_declared(capabilities)
    return [
        _check(not missing_ports, "required-host-ports", "Missing required host port(s): " + ", ".join(missing_ports)),
        _check(bool(capture_provider), "capture-provider", "No native capture provider was declared."),
        _check(bool(executor_provider), "executor-provider", "No native executor provider was declared."),
        _check(
            executor_provider_allowed,
            "target-bound-executor",
            (
                "Executor provider is diagnostic-only, fail-closed, or shortcut-based; real desktop "
                "preflight requires a target-bound independent executor."
            ),
        ),
        _check(
            adapter_declared,
            "input-isolation",
            "No independent simulated input adapter manifest/ref was declared.",
        ),
        _check(
            adapter_ready,
            "input-adapter-capability",
            (
                "Input adapter manifest is virtual, diagnostic, state-only, or fail-closed; real desktop "
                "preflight requires a target-bound independent adapter."
            ),
        ),
        _check(
            target_binding_declared,
            "target-environment-binding",
            "No independent input adapter target binding manifest/ref was declared.",
        ),
        _check(
            input_channel_allowed,
            "input-channel-isolation",
            (
                "Input channel is shared, global, real OS, diagnostic-only, or missing; real desktop preflight "
                "requires target-bound isolated input."
            ),
        ),
        _check(bool(target_window or capabilities.get("targetWindow")), "target-window", "No target window was declared."),
    ]


def _check(ok: bool, category: str, reason: str) -> dict[str, Any]:
    return {
        "category": category,
        "ok": bool(ok),
        "reason": "" if ok else reason,
    }


def _suggested_next_action(status: str, blocked_reasons: Sequence[str]) -> str:
    if status == "ready":
        return "Run a low-risk real-window host-port probe through python -m sciforge_computer_use --host-port-stdio and keep trace/result refs."
    if any("independent simulated input adapter" in reason for reason in blocked_reasons):
        return "Provide an independent simulated input adapter manifest/ref and host executor binding, or keep B/C marked unchecked with this blocked manifest."
    if any("target binding" in reason for reason in blocked_reasons):
        return "Provide an input adapter target binding manifest/ref proving the adapter changes a verifiable target environment, or keep B/C marked unchecked."
    if any("Executor provider is diagnostic-only" in reason for reason in blocked_reasons):
        return "Provide a target-bound independent executor that can change the declared target environment, or keep B/C unchecked."
    if any("Input channel is shared" in reason for reason in blocked_reasons):
        return "Do not claim real desktop completion; use only target-bound isolated input for ready preflight."
    return "Add the missing native host capability and rerun this preflight before any real-window B/C probe."


def _executor_provider_allowed_for_ready(value: str | None) -> bool:
    if not value:
        return False
    normalized = _normalized_mode(value)
    compact = normalized.replace("-", "")
    return normalized not in DIAGNOSTIC_EXECUTOR_PROVIDERS and not any(
        token in compact for token in ("failclosed", "diagnostic", "stateonly", "virtualinputstate")
    ) and not any(
        token in compact for token in FORBIDDEN_SHORTCUT_EXECUTOR_PROVIDER_TOKENS
    )


def _input_channel_allowed_for_ready(value: str | None) -> bool:
    normalized = _normalized_mode(value)
    if not normalized:
        return False
    allowed = {_normalized_mode(entry) for entry in ALLOWED_READY_INPUT_CHANNELS}
    if normalized in allowed:
        return True
    blocked = {_normalized_mode(entry) for entry in BLOCKED_INPUT_MODE_VALUES}
    if normalized in blocked:
        return False
    if normalized.startswith(("global", "system", "shared", "real", "os")):
        return False
    if "shared" in normalized or "global" in normalized or "realos" in normalized:
        return False
    return False


def _normalized_mode(value: str | None) -> str:
    return value.strip().replace("_", "-").lower() if isinstance(value, str) else ""


def _load_capabilities(capabilities_json: str | None, capabilities_file: str | None) -> Mapping[str, Any]:
    if capabilities_json and capabilities_file:
        raise ValueError("--capabilities-json and --capabilities-file are mutually exclusive.")
    if capabilities_file:
        parsed = json.loads(Path(capabilities_file).expanduser().read_text(encoding="utf8"))
    elif capabilities_json:
        parsed = json.loads(capabilities_json)
    else:
        parsed = {}
    if not isinstance(parsed, Mapping):
        raise ValueError("Capabilities root must be a JSON object.")
    return parsed


def _safe_capabilities(capabilities: Mapping[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in capabilities.items():
        normalized = str(key).replace("_", "").replace("-", "").lower()
        if any(token in normalized for token in ("key", "token", "secret", "password", "credential")):
            safe[str(key)] = "[REDACTED]"
        elif isinstance(value, (str, int, float, bool)) or value is None:
            safe[str(key)] = value
        elif isinstance(value, list):
            safe[str(key)] = [item for item in value if isinstance(item, (str, int, float, bool))]
        elif isinstance(value, Mapping):
            safe[str(key)] = _safe_capabilities(value)
        else:
            safe[str(key)] = str(value)
    return safe


def _adapter_manifest_declared(capabilities: Mapping[str, Any]) -> bool:
    manifest = _adapter_manifest_payload(capabilities)
    if isinstance(manifest, Mapping):
        schema = _string_value(manifest.get("schemaVersion"))
        status = _string_value(manifest.get("inputAdapterStatus"))
        return schema == VIRTUAL_INPUT_ADAPTER_MANIFEST_SCHEMA and status == VIRTUAL_INPUT_ADAPTER_STATUS
    return False


def _adapter_manifest_ready_for_real_desktop(capabilities: Mapping[str, Any]) -> bool:
    return bool(_adapter_manifest_validation(capabilities).get("ok"))


def _adapter_manifest_validation(capabilities: Mapping[str, Any]) -> dict[str, Any]:
    return validate_input_adapter_manifest_for_real_desktop(_adapter_manifest_payload(capabilities))


def _adapter_manifest_schema(capabilities: Mapping[str, Any]) -> str | None:
    manifest = _adapter_manifest_payload(capabilities)
    if isinstance(manifest, Mapping):
        return _string_value(manifest.get("schemaVersion")) or None
    return None


def _adapter_manifest_payload(capabilities: Mapping[str, Any]) -> Mapping[str, Any] | None:
    manifest = capabilities.get("inputAdapterManifest")
    if isinstance(manifest, Mapping):
        return manifest
    manifest_ref = _string_value(capabilities.get("inputAdapterManifestRef"))
    if not manifest_ref:
        return None
    path = Path(manifest_ref).expanduser()
    if not path.is_file():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, Mapping) else None


def _target_binding_declared(capabilities: Mapping[str, Any]) -> bool:
    return bool(_target_binding_validation(capabilities).get("ok"))


def _target_binding_validation(capabilities: Mapping[str, Any]) -> dict[str, Any]:
    return validate_input_adapter_target_binding_manifest(
        _target_binding_source(capabilities),
        require_existing_refs=True,
    )


def _target_binding_schema(capabilities: Mapping[str, Any]) -> str | None:
    binding = _target_binding_payload(capabilities)
    if isinstance(binding, Mapping):
        return _string_value(binding.get("schemaVersion")) or None
    return None


def _target_binding_payload(capabilities: Mapping[str, Any]) -> Mapping[str, Any] | None:
    source = _target_binding_source(capabilities)
    if source is None:
        return None
    try:
        parsed = load_input_adapter_target_binding_manifest(source)
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, Mapping) else None


def _target_binding_source(capabilities: Mapping[str, Any]) -> Mapping[str, Any] | str | None:
    binding = capabilities.get("inputAdapterBindingManifest")
    if isinstance(binding, Mapping):
        return binding
    binding_ref = _string_value(capabilities.get("inputAdapterBindingManifestRef"))
    return binding_ref or None


def _string_value(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


if __name__ == "__main__":
    raise SystemExit(main())
