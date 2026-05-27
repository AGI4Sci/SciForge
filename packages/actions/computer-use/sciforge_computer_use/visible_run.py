"""CLI wrapper that produces visible Computer Use replay artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .target_bound_window_host_probe import TargetBoundWindowHostProbeRunner
from .visible_viewer import build_visible_run_viewer
from .virtual_desktop_probe import VirtualDesktopProbeRunner


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Computer Use and write a visible replay viewer.")
    parser.add_argument("--mode", choices=["target-bound-window", "virtual-desktop"], default="target-bound-window")
    parser.add_argument("--request-json", required=True, help="ComputerUseRequest JSON.")
    parser.add_argument("--scenario-file", required=True, help="Scenario JSON file.")
    parser.add_argument("--output-dir", required=True, help="Directory for result, trace, state refs, and viewer.")
    parser.add_argument("--source-repair-manifest", help="Optional previous blocked repair manifest ref.")
    parser.add_argument("--title", help="Viewer title.")
    args = parser.parse_args(argv)

    try:
        output_dir = Path(args.output_dir).expanduser().resolve()
        runner = _runner(
            mode=args.mode,
            request=_parse_json(args.request_json),
            scenario=_load_json_file(args.scenario_file),
            output_dir=output_dir,
            scenario_file=args.scenario_file,
            source_repair_manifest=Path(args.source_repair_manifest).expanduser() if args.source_repair_manifest else None,
        )
        payload = runner.run()
        manifest_ref = _source_manifest_ref(payload)
        viewer = build_visible_run_viewer(
            output_dir=output_dir,
            result=payload,
            result_ref=output_dir / "computer-use-result.json",
            manifest_ref=manifest_ref,
            title=args.title,
        )
        payload = dict(payload)
        diagnostics = dict(payload.get("failureDiagnostics") or {})
        diagnostics.update({
            "visibleRunViewerManifestRef": str((output_dir / "visible-run-viewer-manifest.json").resolve()),
            "visibleRunViewerHtmlRef": viewer["viewerHtmlRef"],
            "visibleRunViewerValidation": viewer["validation"],
        })
        payload["failureDiagnostics"] = diagnostics
        _write_json(output_dir / "computer-use-result.json", payload)
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0 if payload.get("status") in {"completed", "max-steps", "needs-confirmation"} else 1
    except Exception as exc:  # noqa: BLE001 - keep CLI output structured.
        payload = {
            "schemaVersion": "sciforge.computer-use.result.v1",
            "status": "failed-with-reason",
            "reason": str(exc),
            "message": str(exc),
            "failureDiagnostics": {"failedStage": "visible-run"},
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


def _runner(
    *,
    mode: str,
    request: Mapping[str, Any],
    scenario: Mapping[str, Any],
    output_dir: Path,
    scenario_file: str,
    source_repair_manifest: Path | None,
) -> TargetBoundWindowHostProbeRunner | VirtualDesktopProbeRunner:
    if mode == "virtual-desktop":
        return VirtualDesktopProbeRunner(
            request=request,
            scenario=scenario,
            output_dir=output_dir,
            scenario_file=scenario_file,
            source_repair_manifest=source_repair_manifest,
        )
    return TargetBoundWindowHostProbeRunner(
        request=request,
        scenario=scenario,
        output_dir=output_dir,
        scenario_file=scenario_file,
        source_repair_manifest=source_repair_manifest,
    )


def _source_manifest_ref(payload: Mapping[str, Any]) -> str | None:
    diagnostics = payload.get("failureDiagnostics") if isinstance(payload.get("failureDiagnostics"), Mapping) else {}
    for key in ["targetBoundWindowHostProbeManifestRef", "virtualDesktopProbeManifestRef"]:
        value = diagnostics.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _parse_json(value: str) -> dict[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, Mapping):
        raise ValueError("Expected JSON object.")
    return dict(parsed)


def _load_json_file(path: str | Path) -> dict[str, Any]:
    parsed = json.loads(Path(path).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError(f"Expected JSON object in {path}.")
    return dict(parsed)


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf8")


if __name__ == "__main__":
    raise SystemExit(main())
