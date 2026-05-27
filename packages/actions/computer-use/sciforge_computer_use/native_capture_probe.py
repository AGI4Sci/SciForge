"""Native capture-only probe for package-local Computer Use diagnostics.

The probe captures a screenshot ref when the local platform supports it, then
writes a desktop preflight manifest that remains blocked until executor and
input-isolation capabilities are also present.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .desktop_preflight import REQUIRED_HOST_PORTS, build_preflight_manifest


PROBE_SCHEMA = "sciforge.computer-use.native-capture-probe.v1"
SCREENSHOT_NAME = "native-capture.png"
WINDOW_SCREENSHOT_NAME = "native-window-capture.png"
WINDOW_INVENTORY_NAME = "native-window-inventory.json"
SELECTED_WINDOW_NAME = "native-selected-window.json"
TARGET_WINDOW_BINDING_PROOF_NAME = "native-target-window-binding-proof.json"
MANIFEST_NAME = "native-capture-probe-manifest.json"

CommandRunner = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a capture-only native Computer Use host-port probe.")
    parser.add_argument("--output-dir", required=True, help="Directory for screenshot and manifests.")
    parser.add_argument("--target-window", help="Optional target window descriptor. The probe still captures display scope.")
    args = parser.parse_args(argv)

    manifest = run_native_capture_probe(
        output_dir=Path(args.output_dir).expanduser(),
        target_window=args.target_window,
    )
    json.dump(manifest, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest["status"] == "completed" else 1


def run_native_capture_probe(
    *,
    output_dir: Path,
    target_window: str | None = None,
    runner: CommandRunner | None = None,
) -> dict[str, Any]:
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    screenshot_ref = (output_dir / SCREENSHOT_NAME).resolve()
    manifest_ref = (output_dir / MANIFEST_NAME).resolve()
    inventory_ref = (output_dir / WINDOW_INVENTORY_NAME).resolve()
    capture_provider = _native_capture_provider()

    if not capture_provider:
        manifest = _blocked_manifest(
            output_dir=output_dir,
            reason="No supported native capture command was found.",
            target_window=target_window,
            screenshot_ref=None,
        )
        _write_json(manifest_ref, manifest)
        return manifest

    inventory = _window_inventory(runner=runner)
    if inventory:
        _write_json(inventory_ref, {"schemaVersion": "sciforge.computer-use.native-window-inventory.v1", "windows": inventory})
    selected_window = _select_window(inventory, target_window)
    ambiguous_matches = _matching_windows(inventory, target_window) if target_window else []
    if target_window and len(ambiguous_matches) > 1:
        manifest = _blocked_manifest(
            output_dir=output_dir,
            reason=f"Target window descriptor matched {len(ambiguous_matches)} windows; refusing ambiguous target binding.",
            target_window=target_window,
            screenshot_ref=None,
            capture_provider=capture_provider,
            capture_scope="display",
        )
        _write_json(manifest_ref, manifest)
        return manifest
    if selected_window:
        screenshot_ref = (output_dir / WINDOW_SCREENSHOT_NAME).resolve()
    capture_scope = "window" if selected_window else "display"
    command = _capture_command(capture_provider, screenshot_ref, window_id=_window_id(selected_window))
    completed = (runner or _run_command)(command)
    if completed.returncode != 0 or not screenshot_ref.is_file() or screenshot_ref.stat().st_size <= 0:
        manifest = _blocked_manifest(
            output_dir=output_dir,
            reason=(completed.stderr.strip() or completed.stdout.strip() or "Native capture command did not produce a screenshot."),
            target_window=target_window,
            screenshot_ref=str(screenshot_ref),
            capture_provider=capture_provider,
            capture_scope=capture_scope,
        )
        _write_json(manifest_ref, manifest)
        return manifest

    metadata = _png_metadata(screenshot_ref)
    binding_proof = write_native_target_window_binding_proof(
        output_dir=output_dir,
        selected_window=selected_window,
        window_inventory_ref=str(inventory_ref) if inventory else None,
        screenshot_ref=str(screenshot_ref),
        capture_provider=capture_provider,
        capture_scope=capture_scope,
        screenshot_metadata=metadata,
    )
    preflight = build_preflight_manifest(
        output_dir=output_dir,
        target_window=target_window if selected_window else None,
        observed_capabilities={
            "hostPorts": ["capture"],
            "captureProvider": capture_provider,
            "captureScope": capture_scope,
            "screenshotRef": str(screenshot_ref),
            "targetWindow": selected_window,
            "windowInventoryRef": str(inventory_ref) if inventory else None,
            "inputAdapterStatus": "not-declared",
            "inputChannel": "none",
        },
    )
    manifest = {
        "schemaVersion": PROBE_SCHEMA,
        "status": "completed",
        "category": "native-capture-only",
        "reason": f"Native {capture_scope} capture succeeded; executor and input isolation remain unresolved.",
        "desktopPlatform": {
            "system": platform.system(),
            "machine": platform.machine(),
        },
        "requestedTargetWindow": target_window,
        "targetWindowResolved": bool(selected_window),
        "selectedWindow": selected_window,
        "selectedWindowRef": binding_proof.get("selectedWindowRef") if binding_proof else None,
        "targetWindowBindingProofRef": binding_proof.get("proofRef") if binding_proof else None,
        "windowInventoryRef": str(inventory_ref) if inventory else None,
        "captureProvider": capture_provider,
        "captureScope": capture_scope,
        "requiredHostPorts": REQUIRED_HOST_PORTS,
        "observedHostPorts": ["capture"],
        "screenshotRefs": [str(screenshot_ref)],
        "screenshotMetadata": metadata,
        "preflightRef": preflight["manifestRef"],
        "preflightStatus": preflight["status"],
        "preflightBlockedReasons": list(preflight.get("blockedReasons") or []),
        "artifactRefs": [],
        "traceRefs": [],
        "inputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "note": "Capture-only evidence cannot complete B/C; it only proves a package-local native screenshot ref exists.",
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _native_capture_provider() -> str | None:
    if platform.system() == "Darwin" and shutil.which("screencapture"):
        return "macos-screencapture"
    return None


def _capture_command(provider: str, screenshot_ref: Path, *, window_id: int | None = None) -> list[str]:
    if provider == "macos-screencapture":
        command = ["screencapture", "-x"]
        if window_id is not None:
            command.append(f"-l{window_id}")
        command.append(str(screenshot_ref))
        return command
    raise ValueError(f"Unsupported capture provider: {provider}")


def _run_command(command: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def _window_inventory(runner: CommandRunner | None = None) -> list[dict[str, Any]]:
    if platform.system() != "Darwin" or not shutil.which("swift"):
        return []
    script = """
import Foundation
import CoreGraphics

let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var records: [[String: Any]] = []
for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  let id = window[kCGWindowNumber as String] as? Int ?? 0
  let layer = window[kCGWindowLayer as String] as? Int ?? 0
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  if id <= 0 || layer != 0 { continue }
  records.append([
    "windowId": id,
    "owner": owner,
    "title": title,
    "bounds": bounds
  ])
}
let data = try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
"""
    with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False, encoding="utf8") as handle:
        handle.write(script)
        script_path = handle.name
    try:
        completed = (runner or _run_command)(["swift", script_path])
    finally:
        Path(script_path).unlink(missing_ok=True)
    if completed.returncode != 0:
        return []
    try:
        parsed = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [_safe_window_record(item) for item in parsed if isinstance(item, Mapping)]


def _safe_window_record(item: Mapping[str, Any]) -> dict[str, Any]:
    bounds = item.get("bounds") if isinstance(item.get("bounds"), Mapping) else {}
    return {
        "windowId": int(item.get("windowId") or 0),
        "owner": str(item.get("owner") or ""),
        "title": str(item.get("title") or ""),
        "bounds": {
            "X": _number_value(bounds.get("X")),
            "Y": _number_value(bounds.get("Y")),
            "Width": _number_value(bounds.get("Width")),
            "Height": _number_value(bounds.get("Height")),
        },
    }


def _select_window(inventory: Sequence[Mapping[str, Any]], target_window: str | None) -> dict[str, Any] | None:
    matches = _matching_windows(inventory, target_window)
    return dict(matches[0]) if len(matches) == 1 else None


def _matching_windows(inventory: Sequence[Mapping[str, Any]], target_window: str | None) -> list[Mapping[str, Any]]:
    needle = (target_window or "").strip().lower()
    if not needle:
        return []
    return [
        item
        for item in inventory
        if needle in f"{item.get('owner', '')} {item.get('title', '')}".lower()
    ]


def _window_id(window: Mapping[str, Any] | None) -> int | None:
    if not window:
        return None
    try:
        value = int(window.get("windowId") or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _number_value(value: Any) -> float | int | None:
    if isinstance(value, (int, float)):
        return value
    return None


def write_native_target_window_binding_proof(
    *,
    output_dir: Path,
    selected_window: Mapping[str, Any] | None,
    window_inventory_ref: str | None,
    screenshot_ref: str | None,
    capture_provider: str | None,
    capture_scope: str,
    screenshot_metadata: Mapping[str, Any],
) -> dict[str, Any] | None:
    if not selected_window or capture_scope != "window" or not screenshot_ref:
        return None
    selected_window_ref = (output_dir / SELECTED_WINDOW_NAME).resolve()
    proof_ref = (output_dir / TARGET_WINDOW_BINDING_PROOF_NAME).resolve()
    selected_window_payload = {
        "schemaVersion": "sciforge.computer-use.native-selected-window.v1",
        "selectedWindow": dict(selected_window),
        "windowInventoryRef": window_inventory_ref,
    }
    proof = {
        "schemaVersion": "sciforge.computer-use.native-target-window-binding-proof.v1",
        "status": "completed",
        "selectedWindowRef": str(selected_window_ref),
        "windowInventoryRef": window_inventory_ref,
        "screenshotRef": screenshot_ref,
        "captureProvider": capture_provider,
        "captureScope": capture_scope,
        "selectedWindow": dict(selected_window),
        "screenshotMetadata": dict(screenshot_metadata),
        "inputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realWindowEvidence": False,
        "diagnosticOnly": True,
        "claimLimit": "This proves a native window capture binding only; it does not prove input execution or real-window state change.",
        "proofRef": str(proof_ref),
    }
    _write_json(selected_window_ref, selected_window_payload)
    _write_json(proof_ref, proof)
    return {
        "selectedWindowRef": str(selected_window_ref),
        "proofRef": str(proof_ref),
        "proof": proof,
    }


def _blocked_manifest(
    *,
    output_dir: Path,
    reason: str,
    target_window: str | None,
    screenshot_ref: str | None,
    capture_provider: str | None = None,
    capture_scope: str = "display",
) -> dict[str, Any]:
    return {
        "schemaVersion": PROBE_SCHEMA,
        "status": "blocked",
        "category": "native-capture-blocked",
        "reason": reason,
        "desktopPlatform": {
            "system": platform.system(),
            "machine": platform.machine(),
        },
        "requestedTargetWindow": target_window,
        "targetWindowResolved": False,
        "captureProvider": capture_provider,
        "captureScope": capture_scope,
        "requiredHostPorts": REQUIRED_HOST_PORTS,
        "observedHostPorts": [],
        "screenshotRefs": [screenshot_ref] if screenshot_ref else [],
        "artifactRefs": [],
        "traceRefs": [],
        "manifestRef": str((output_dir / MANIFEST_NAME).resolve()),
        "inputExecuted": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "realWindowEvidence": False,
        "diagnosticOnly": True,
        "suggestedNextAction": "Grant native capture capability or add a platform capture provider, then rerun before attempting real-window B/C.",
    }


def _png_metadata(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    metadata: dict[str, Any] = {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        metadata["format"] = "png"
        metadata["width"] = int.from_bytes(data[16:20], "big")
        metadata["height"] = int.from_bytes(data[20:24], "big")
    return metadata


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


if __name__ == "__main__":
    raise SystemExit(main())
