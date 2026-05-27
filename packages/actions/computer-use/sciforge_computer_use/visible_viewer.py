"""Visible replay artifacts for package-local Computer Use runs."""

from __future__ import annotations

import html
import json
import os
from pathlib import Path
from typing import Any, Mapping, Sequence


VISIBLE_RUN_VIEWER_SCHEMA = "sciforge.computer-use.visible-run-viewer.v1"
VISIBLE_RUN_VIEWER_VALIDATION_SCHEMA = "sciforge.computer-use.visible-run-viewer-validation.v1"


def build_visible_run_viewer(
    *,
    output_dir: str | Path,
    result: Mapping[str, Any] | None = None,
    result_ref: str | Path | None = None,
    manifest_ref: str | Path | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Write a refs-first replay manifest and HTML viewer for a run directory."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    result_path = Path(result_ref).expanduser().resolve() if result_ref else root / "computer-use-result.json"
    payload = dict(result or _load_mapping(result_path))
    if result is not None and not result_path.is_file():
        _write_json(result_path, payload)

    viewer_dir = root / "visible-run-viewer"
    viewer_dir.mkdir(parents=True, exist_ok=True)
    viewer_html_ref = viewer_dir / "index.html"
    viewer_manifest_ref = root / "visible-run-viewer-manifest.json"
    trace_refs = _string_list(payload.get("traceRefs"))
    screenshot_refs = _unique_strings([
        *_string_list(payload.get("screenshotRefs")),
        *[
            str(step.get("beforeRef"))
            for step in _mapping_list(payload.get("steps"))
            if isinstance(step.get("beforeRef"), str)
        ],
        *[
            str(step.get("afterRef"))
            for step in _mapping_list(payload.get("steps"))
            if isinstance(step.get("afterRef"), str)
        ],
        *([str(payload.get("finalObservationRef"))] if isinstance(payload.get("finalObservationRef"), str) else []),
    ])
    diagnostics = _mapping(payload.get("failureDiagnostics"))
    input_event_log_refs = _unique_strings([
        *_diagnostic_ref_list(diagnostics, [
            "inputEventLogRef",
            "pointerEventLogRef",
            "keyboardEventLogRef",
            "virtualInputStateRef",
            "virtualPointerStateRef",
            "virtualKeyboardStateRef",
        ]),
        *_nested_ref_list(diagnostics.get("virtualInputStateRefs")),
    ])
    isolation = _isolation_summary(diagnostics)
    actions = _actions(payload.get("steps"))
    frames = _frames(screenshot_refs, root, _frame_context(actions, payload))
    input_summary = _input_summary(input_event_log_refs)

    manifest = {
        "schemaVersion": VISIBLE_RUN_VIEWER_SCHEMA,
        "status": payload.get("status"),
        "reason": payload.get("reason") or payload.get("message"),
        "title": title or str(payload.get("task") or "Computer Use visible run"),
        "resultRef": str(result_path),
        "sourceManifestRef": str(Path(manifest_ref).expanduser().resolve()) if manifest_ref else _source_manifest_ref(diagnostics),
        "viewerHtmlRef": str(viewer_html_ref),
        "traceRefs": trace_refs,
        "screenshotRefs": screenshot_refs,
        "artifactRefs": _unique_strings([
            *_string_list(payload.get("artifactRefs")),
            *_string_list(payload.get("finalArtifactRefs")),
            *([str(payload.get("finalArtifactRef"))] if isinstance(payload.get("finalArtifactRef"), str) else []),
        ]),
        "finalArtifactRef": payload.get("finalArtifactRef"),
        "frames": frames,
        "actions": actions,
        "inputEventLogRefs": input_event_log_refs,
        "inputSummary": input_summary,
        "isolation": isolation,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
    }
    viewer_html_ref.write_text(_html_for_manifest(manifest, viewer_html_ref.parent), encoding="utf8")
    validation = validate_visible_run_viewer_manifest(manifest, require_existing_refs=True)
    manifest["validation"] = validation
    _write_json(viewer_manifest_ref, manifest)
    viewer_html_ref.write_text(_html_for_manifest(manifest, viewer_html_ref.parent), encoding="utf8")
    return manifest


def validate_visible_run_viewer_manifest(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate visible replay refs without reading raw screenshots or artifacts."""

    try:
        manifest = _load_mapping(manifest_or_ref) if isinstance(manifest_or_ref, (str, Path)) else dict(manifest_or_ref)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return _validation(False, errors=[_error("manifest_load_failed", str(exc), "$")])

    errors: list[dict[str, Any]] = []
    if manifest.get("schemaVersion") != VISIBLE_RUN_VIEWER_SCHEMA:
        errors.append(_error("unsupported_schema_version", "Visible viewer schemaVersion is invalid.", "$.schemaVersion"))
    if not isinstance(manifest.get("viewerHtmlRef"), str) or not manifest.get("viewerHtmlRef"):
        errors.append(_error("viewer_html_ref_missing", "Viewer HTML ref is missing.", "$.viewerHtmlRef"))
    if not _mapping_list(manifest.get("frames")):
        errors.append(_error("frames_missing", "Viewer manifest must contain at least one frame.", "$.frames"))
    if not _mapping_list(manifest.get("actions")):
        errors.append(_error("actions_missing", "Viewer manifest must contain at least one action.", "$.actions"))
    isolation = _mapping(manifest.get("isolation"))
    for field in ["sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent"]:
        if isolation.get(field) is not False:
            errors.append(_error("input_isolation_flag_not_false", f"{field} must be false.", f"$.isolation.{field}"))
    if manifest.get("rawPayloadWritten") is not False:
        errors.append(_error("raw_payload_written", "Visible viewer must not write raw payloads.", "$.rawPayloadWritten"))
    if manifest.get("inlineImageWritten") is not False:
        errors.append(_error("inline_image_written", "Visible viewer must not inline images.", "$.inlineImageWritten"))
    if require_existing_refs:
        for path_field in ["viewerHtmlRef", "resultRef"]:
            ref = manifest.get(path_field)
            if isinstance(ref, str) and ref and not Path(ref).is_file():
                errors.append(_error("ref_missing", f"{path_field} does not exist.", f"$.{path_field}", ref=ref))
        for index, frame in enumerate(_mapping_list(manifest.get("frames"))):
            ref = frame.get("screenshotRef")
            if isinstance(ref, str) and ref and not Path(ref).is_file():
                errors.append(_error("ref_missing", "Frame screenshot ref does not exist.", f"$.frames[{index}].screenshotRef", ref=ref))
        for index, ref in enumerate(_string_list(manifest.get("inputEventLogRefs"))):
            if not Path(ref).is_file():
                errors.append(_error("ref_missing", "Input event log ref does not exist.", f"$.inputEventLogRefs[{index}]", ref=ref))
    return _validation(not errors, errors=errors)


def _html_for_manifest(manifest: Mapping[str, Any], base_dir: Path) -> str:
    title = html.escape(str(manifest.get("title") or "Computer Use visible run"))
    status = html.escape(str(manifest.get("status") or "unknown"))
    reason = html.escape(str(manifest.get("reason") or ""))
    isolation = _mapping(manifest.get("isolation"))
    frame_cards = "\n".join(_frame_html(frame, base_dir) for frame in _mapping_list(manifest.get("frames")))
    action_rows = "\n".join(_action_html(action) for action in _mapping_list(manifest.get("actions")))
    input_summary = _mapping(manifest.get("inputSummary"))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    body {{ margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18202a; background: #f6f7f9; }}
    header {{ padding: 20px 24px 12px; background: #ffffff; border-bottom: 1px solid #d9dee7; }}
    h1 {{ margin: 0 0 8px; font-size: 22px; font-weight: 700; }}
    main {{ padding: 20px 24px 28px; display: grid; gap: 18px; }}
    section {{ background: #ffffff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px; }}
    h2 {{ margin: 0 0 12px; font-size: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }}
    figure {{ margin: 0; border: 1px solid #d9dee7; border-radius: 8px; overflow: hidden; background: #fbfcfe; }}
    figure img {{ display: block; width: 100%; height: auto; image-rendering: auto; }}
    figcaption {{ padding: 10px 12px; font-size: 12px; color: #475569; word-break: break-word; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 8px 10px; border-bottom: 1px solid #e5e9f0; text-align: left; vertical-align: top; }}
    th {{ font-size: 12px; color: #64748b; text-transform: uppercase; }}
    code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }}
    .ok {{ color: #116329; font-weight: 700; }}
  </style>
</head>
<body>
  <header>
    <h1>{title}</h1>
    <div>Status: <strong>{status}</strong></div>
    <div>{reason}</div>
  </header>
  <main>
    <section>
      <h2>Input Isolation</h2>
      <p class="ok">Virtual input only: shared system input={html.escape(str(isolation.get("sharedSystemInputUsed")))}, pointer moved={html.escape(str(isolation.get("systemPointerMoved")))}, keyboard events={html.escape(str(isolation.get("systemKeyboardEventsSent")))}</p>
      <p>Pointer events: {html.escape(str(input_summary.get("pointerEventCount", 0)))}; keyboard events: {html.escape(str(input_summary.get("keyboardEventCount", 0)))}.</p>
    </section>
    <section>
      <h2>Frames</h2>
      <div class="grid">{frame_cards}</div>
    </section>
    <section>
      <h2>Actions</h2>
      <table><thead><tr><th>#</th><th>Kind</th><th>Status</th><th>Target</th><th>Input</th><th>Refs</th></tr></thead><tbody>{action_rows}</tbody></table>
    </section>
  </main>
</body>
</html>
"""


def _frame_html(frame: Mapping[str, Any], base_dir: Path) -> str:
    ref = str(frame.get("screenshotRef") or "")
    src = html.escape(_relative_ref(ref, base_dir))
    label = html.escape(str(frame.get("label") or ref))
    index = html.escape(str(frame.get("index")))
    summary = html.escape(str(frame.get("summary") or ""))
    image = f'<img src="{src}" alt="{label}">' if ref else ""
    summary_block = f"<div>{summary}</div>" if summary else ""
    return f"<figure>{image}<figcaption>Frame {index}: <code>{label}</code>{summary_block}</figcaption></figure>"


def _action_html(action: Mapping[str, Any]) -> str:
    refs = ", ".join(_string_list(action.get("screenshotRefs")) + _string_list(action.get("artifactRefs")))
    input_text = _input_label(action)
    return (
        "<tr>"
        f"<td>{html.escape(str(action.get('index')))}</td>"
        f"<td>{html.escape(str(action.get('kind') or ''))}</td>"
        f"<td>{html.escape(str(action.get('status') or ''))}</td>"
        f"<td>{html.escape(str(action.get('target') or ''))}</td>"
        f"<td>{html.escape(input_text)}</td>"
        f"<td><code>{html.escape(refs)}</code></td>"
        "</tr>"
    )


def _frames(refs: Sequence[str], root: Path, context: Mapping[str, str]) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for index, ref in enumerate(_unique_strings(refs)):
        path = Path(ref)
        absolute_ref = str(path.resolve()) if path.is_absolute() else str((root / path).resolve())
        frames.append({
            "index": index,
            "label": path.name or f"frame-{index}",
            "screenshotRef": absolute_ref,
            "summary": context.get(ref) or context.get(absolute_ref),
            "kind": "screenshot",
        })
    return frames


def _actions(steps: Any) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for fallback_index, step in enumerate(_mapping_list(steps)):
        action = _mapping(step.get("action"))
        actions.append({
            "index": step.get("index", fallback_index),
            "kind": action.get("kind") or action.get("type"),
            "target": _target_text(action.get("target")),
            "textPreview": _text_preview(action.get("text")),
            "key": _key_preview(action),
            "reason": action.get("reason"),
            "status": step.get("status"),
            "verification": step.get("verification"),
            "beforeSummary": step.get("beforeSummary"),
            "verificationReason": _mapping(step.get("verification")).get("reason"),
            "screenshotRefs": _unique_strings([
                *([str(step.get("beforeRef"))] if isinstance(step.get("beforeRef"), str) else []),
                *([str(step.get("afterRef"))] if isinstance(step.get("afterRef"), str) else []),
                *_string_list(step.get("screenshotRefs")),
            ]),
            "artifactRefs": _string_list(step.get("artifactRefs")),
        })
    return actions


def _frame_context(actions: Sequence[Mapping[str, Any]], payload: Mapping[str, Any]) -> dict[str, str]:
    context: dict[str, str] = {}
    for action in actions:
        refs = _string_list(action.get("screenshotRefs"))
        if refs and isinstance(action.get("beforeSummary"), str):
            context.setdefault(refs[0], str(action.get("beforeSummary")))
        if refs and isinstance(action.get("verificationReason"), str):
            context[refs[-1]] = str(action.get("verificationReason"))
    final_ref = payload.get("finalObservationRef")
    if isinstance(final_ref, str) and isinstance(payload.get("reason"), str):
        context[final_ref] = str(payload.get("reason"))
    return context


def _input_label(action: Mapping[str, Any]) -> str:
    pieces: list[str] = []
    if action.get("key"):
        pieces.append(f"key={action['key']}")
    if action.get("textPreview"):
        pieces.append(f"text={action['textPreview']}")
    if action.get("reason"):
        pieces.append(str(action["reason"]))
    return "; ".join(pieces)


def _text_preview(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    compact = " ".join(value.split())
    if len(compact) > 160:
        return compact[:157] + "..."
    return compact


def _key_preview(action: Mapping[str, Any]) -> str | None:
    key = action.get("key")
    if isinstance(key, str) and key:
        return key
    keys = action.get("keys")
    if isinstance(keys, list) and keys:
        return "+".join(str(item) for item in keys)
    return None


def _input_summary(refs: Sequence[str]) -> dict[str, Any]:
    pointer_count = 0
    keyboard_count = 0
    modalities: set[str] = set()
    for ref in refs:
        try:
            payload = _load_mapping(ref)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        events = _mapping_list(payload.get("events"))
        for event in events:
            modality = str(event.get("modality") or "")
            if modality == "pointer" or (not modality and "systemPointerMoved" in event):
                pointer_count += 1
                modalities.add("pointer")
            if modality == "keyboard" or (not modality and "systemKeyboardEventsSent" in event):
                keyboard_count += 1
                modalities.add("keyboard")
    return {
        "inputEventLogCount": len(refs),
        "pointerEventCount": pointer_count,
        "keyboardEventCount": keyboard_count,
        "inputModalities": sorted(modalities),
    }


def _isolation_summary(diagnostics: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "inputChannel": diagnostics.get("inputChannel"),
        "inputAdapterStatus": diagnostics.get("inputAdapterStatus"),
        "inputExecuted": diagnostics.get("inputExecuted"),
        "osInputExecuted": diagnostics.get("osInputExecuted", False),
        "realOsInputExecuted": diagnostics.get("realOsInputExecuted", False),
        "sharedSystemInputUsed": diagnostics.get("sharedSystemInputUsed", False),
        "systemPointerMoved": diagnostics.get("systemPointerMoved", False),
        "systemKeyboardEventsSent": diagnostics.get("systemKeyboardEventsSent", False),
        "realWindowEvidence": diagnostics.get("realWindowEvidence"),
        "diagnosticOnly": diagnostics.get("diagnosticOnly"),
    }


def _diagnostic_ref_list(diagnostics: Mapping[str, Any], keys: Sequence[str]) -> list[str]:
    refs: list[str] = []
    for key in keys:
        value = diagnostics.get(key)
        if isinstance(value, str) and value:
            refs.append(value)
    return refs


def _nested_ref_list(value: Any) -> list[str]:
    if isinstance(value, Mapping):
        return [str(item) for item in value.values() if isinstance(item, str) and item]
    return []


def _source_manifest_ref(diagnostics: Mapping[str, Any]) -> str | None:
    for key in ["targetBoundWindowHostProbeManifestRef", "virtualDesktopProbeManifestRef"]:
        value = diagnostics.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _relative_ref(ref: str, base_dir: Path) -> str:
    if not ref:
        return ""
    try:
        return os.path.relpath(Path(ref), base_dir)
    except ValueError:
        return ref


def _target_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        for key in ("description", "label", "text", "name", "id"):
            item = value.get(key)
            if isinstance(item, str) and item:
                return item
    return ""


def _load_mapping(path: str | Path) -> dict[str, Any]:
    parsed = json.loads(Path(path).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError(f"Expected JSON object at {path}.")
    return dict(parsed)


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf8")


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _mapping_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, Mapping)]
    return []


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, (str, int, float)) and str(item)]
    return []


def _unique_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _validation(ok: bool, *, errors: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": VISIBLE_RUN_VIEWER_VALIDATION_SCHEMA,
        "ok": ok,
        "errors": [dict(error) for error in errors],
        "warnings": [],
    }


def _error(code: str, message: str, path: str, **metadata: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path, **metadata}
