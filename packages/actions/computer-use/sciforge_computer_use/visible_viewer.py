"""Visible replay artifacts for package-local Computer Use runs."""

from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping, Sequence


VISIBLE_RUN_VIEWER_SCHEMA = "sciforge.computer-use.visible-run-viewer.v1"
VISIBLE_RUN_VIEWER_VALIDATION_SCHEMA = "sciforge.computer-use.visible-run-viewer-validation.v1"
VIEWER_REDACTED_VALUE = "[REDACTED]"
VIEWER_SECRET_TEXT_RE = re.compile(
    r"\b(?:authorization|api[_-]?key|access[_-]?key|token|secret|password|credential)s?\b",
    re.IGNORECASE,
)
VIEWER_SECRET_ASSIGNMENT_RE = re.compile(
    r"\b(?:authorization|api[_-]?key|access[_-]?key|refresh[_-]?token|token|secret|password|credential)s?\s*[:=]\s*[^\s,;}\]]+",
    re.IGNORECASE,
)


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
    trace_refs = _safe_ref_strings(payload.get("traceRefs"))
    raw_screenshot_refs = _unique_strings([
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
    screenshot_refs = _safe_ref_strings(raw_screenshot_refs)
    omitted_inline_screenshot_ref_count = len(raw_screenshot_refs) - len(screenshot_refs)
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
    source_manifest_ref = str(Path(manifest_ref).expanduser().resolve()) if manifest_ref else _source_manifest_ref(diagnostics)
    display_group_ref = _first_ref(
        payload,
        diagnostics,
        keys=["displayGroupRef", "virtualDisplayGroupRef"],
    )
    visible_screen_refs = _unique_strings([
        *_safe_ref_strings(payload.get("visibleScreenRefs")),
        *_safe_ref_strings(payload.get("screenRefs")),
        *_diagnostic_ref_list(diagnostics, ["virtualScreensRef", "virtualDisplayGroupRef", "displayGroupRef"]),
    ])
    visible_cursor_refs = _unique_strings([
        *_safe_ref_strings(payload.get("visibleCursorRefs")),
        *_safe_ref_strings(payload.get("cursorOverlayRefs")),
        *_diagnostic_ref_list(diagnostics, ["actorCursorLogRef", "cursorLogRef"]),
    ])
    final_artifact_ref_values = _safe_ref_strings([payload.get("finalArtifactRef")])
    final_artifact_ref = final_artifact_ref_values[0] if final_artifact_ref_values else None
    artifact_refs = _unique_strings([
        *_safe_ref_strings(payload.get("artifactRefs")),
        *_safe_ref_strings(payload.get("finalArtifactRefs")),
        *final_artifact_ref_values,
    ])
    source_refs = _unique_strings([
        str(result_path),
        *trace_refs,
        *([source_manifest_ref] if source_manifest_ref else []),
        *artifact_refs,
        *input_event_log_refs,
        *visible_screen_refs,
        *visible_cursor_refs,
    ])
    source_context = _source_context(
        payload,
        actions,
        declared_screenshot_ref_count=len(screenshot_refs),
        raw_screenshot_ref_count=len(raw_screenshot_refs),
        omitted_inline_screenshot_ref_count=omitted_inline_screenshot_ref_count,
    )
    frames = _frames(
        screenshot_refs,
        root,
        _frame_context(actions, payload, visible_cursor_refs=visible_cursor_refs),
        source_refs=source_refs,
        source_context=source_context,
        omitted_inline_screenshot_ref_count=omitted_inline_screenshot_ref_count,
        visible_cursor_refs=visible_cursor_refs,
    )
    real_screenshot_refs = [
        str(frame["screenshotRef"])
        for frame in frames
        if _frame_kind(frame) == "screenshot" and isinstance(frame.get("screenshotRef"), str)
    ]
    input_summary = _input_summary(input_event_log_refs)
    frame_counts = _frame_counts(frames)
    completion_evidence_requested_ref = _safe_ref_strings([payload.get("completionEvidenceRef")])
    completion_evidence_ref = completion_evidence_requested_ref[0] if completion_evidence_requested_ref and frame_counts["screenshot"] > 0 else None
    completion_evidence_eligible = payload.get("status") == "completed" and frame_counts["screenshot"] > 0

    manifest = {
        "schemaVersion": VISIBLE_RUN_VIEWER_SCHEMA,
        "status": payload.get("status"),
        "reason": _sanitize_viewer_text(str(payload.get("reason") or payload.get("message") or "")),
        "title": _sanitize_viewer_text(title or str(payload.get("task") or "Computer Use visible run")),
        "resultRef": str(result_path),
        "sourceManifestRef": source_manifest_ref,
        "viewerHtmlRef": str(viewer_html_ref),
        "displayGroupRef": display_group_ref,
        "screenRefs": visible_screen_refs,
        "visibleScreenRefs": visible_screen_refs,
        "visibleCursorRefs": visible_cursor_refs,
        "cursorOverlayRefs": visible_cursor_refs,
        "traceRefs": trace_refs,
        "screenshotRefs": real_screenshot_refs,
        "artifactRefs": artifact_refs,
        "finalArtifactRef": final_artifact_ref,
        "completionEvidenceRef": completion_evidence_ref,
        "completionEvidenceEligible": completion_evidence_eligible,
        "completionEvidenceBlockedReason": (
            "placeholder-only-viewer" if completion_evidence_requested_ref and not completion_evidence_ref else None
        ),
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

    manifest_base_dir = Path.cwd()
    try:
        if isinstance(manifest_or_ref, (str, Path)):
            manifest_path = Path(manifest_or_ref).expanduser()
            manifest_base_dir = manifest_path.resolve().parent
            manifest = _load_mapping(manifest_path)
        else:
            manifest = dict(manifest_or_ref)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return _validation(False, errors=[_error("manifest_load_failed", str(exc), "$")])

    errors: list[dict[str, Any]] = []
    if manifest.get("schemaVersion") != VISIBLE_RUN_VIEWER_SCHEMA:
        errors.append(_error("unsupported_schema_version", "Visible viewer schemaVersion is invalid.", "$.schemaVersion"))
    if not isinstance(manifest.get("viewerHtmlRef"), str) or not manifest.get("viewerHtmlRef"):
        errors.append(_error("viewer_html_ref_missing", "Viewer HTML ref is missing.", "$.viewerHtmlRef"))
    frames = _mapping_list(manifest.get("frames"))
    frame_counts = {"screenshot": 0, "placeholder": 0}
    if not frames:
        errors.append(_error("frames_missing", "Viewer manifest must contain at least one frame.", "$.frames"))
    for index, frame in enumerate(frames):
        kind = _frame_kind(frame)
        if kind == "screenshot":
            frame_counts["screenshot"] += 1
            if not isinstance(frame.get("screenId"), str) or not frame.get("screenId"):
                errors.append(_error("frame_screen_id_missing", "Screenshot frame must include screenId.", f"$.frames[{index}].screenId"))
            ref = frame.get("screenshotRef")
            if not isinstance(ref, str) or not ref:
                errors.append(_error("screenshot_frame_ref_missing", "Screenshot frame must include screenshotRef.", f"$.frames[{index}].screenshotRef"))
            elif _looks_inline_payload(ref):
                errors.append(_error("inline_frame_ref", "Screenshot frame must reference a file, not an inline payload.", f"$.frames[{index}].screenshotRef"))
            elif require_existing_refs and not _existing_file(ref, base_dir=manifest_base_dir):
                errors.append(_error("ref_missing", "Frame screenshot ref does not exist or is empty.", f"$.frames[{index}].screenshotRef", ref=ref))
            for ref_index, overlay_ref in enumerate(_safe_ref_strings(frame.get("cursorOverlayRefs"))):
                if _looks_inline_payload(overlay_ref):
                    errors.append(_error("inline_cursor_overlay_ref", "cursorOverlayRefs must contain refs, not inline payloads.", f"$.frames[{index}].cursorOverlayRefs[{ref_index}]"))
        elif kind == "placeholder":
            frame_counts["placeholder"] += 1
            if isinstance(frame.get("screenshotRef"), str) and frame.get("screenshotRef"):
                errors.append(_error("placeholder_screenshot_ref_present", "Placeholder frames must not pretend to be screenshots.", f"$.frames[{index}].screenshotRef"))
            if not isinstance(frame.get("reason"), str) or not frame.get("reason"):
                errors.append(_error("placeholder_reason_missing", "Placeholder frame must include a reason.", f"$.frames[{index}].reason"))
            if not isinstance(frame.get("explanation"), str) or not frame.get("explanation"):
                errors.append(_error("placeholder_explanation_missing", "Placeholder frame must explain why the screenshot is unavailable.", f"$.frames[{index}].explanation"))
            source_refs = _safe_ref_strings(frame.get("sourceRefs"))
            if not source_refs:
                errors.append(_error("placeholder_source_refs_missing", "Placeholder frame must include source refs.", f"$.frames[{index}].sourceRefs"))
            elif require_existing_refs and not any(_existing_file(ref, base_dir=manifest_base_dir) for ref in source_refs):
                errors.append(_error("placeholder_source_ref_missing", "Placeholder frame must include at least one existing source ref.", f"$.frames[{index}].sourceRefs"))
            if not _mapping(frame.get("sourceContext")):
                errors.append(_error("placeholder_source_context_missing", "Placeholder frame must include source context.", f"$.frames[{index}].sourceContext"))
            missing_ref = frame.get("missingScreenshotRef")
            if isinstance(missing_ref, str) and _looks_inline_payload(missing_ref):
                errors.append(_error("inline_frame_ref", "Placeholder missingScreenshotRef must not contain an inline payload.", f"$.frames[{index}].missingScreenshotRef"))
        else:
            errors.append(_error("unsupported_frame_kind", "Frame kind must be screenshot or placeholder.", f"$.frames[{index}].kind"))
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
    if manifest.get("completionEvidenceEligible") is True and frame_counts["screenshot"] == 0:
        errors.append(_error("placeholder_only_completion_evidence", "Placeholder-only viewer cannot be completion evidence.", "$.completionEvidenceEligible"))
    if isinstance(manifest.get("completionEvidenceRef"), str) and manifest.get("completionEvidenceRef") and frame_counts["screenshot"] == 0:
        errors.append(_error("placeholder_only_completion_evidence_ref", "completionEvidenceRef requires at least one real screenshot frame.", "$.completionEvidenceRef"))
    for index, ref in enumerate(_string_list(manifest.get("screenshotRefs"))):
        if _looks_inline_payload(ref):
            errors.append(_error("inline_screenshot_ref", "screenshotRefs must contain refs, not inline image payloads.", f"$.screenshotRefs[{index}]"))
    for index, ref in enumerate(_string_list(manifest.get("visibleCursorRefs"))):
        if _looks_inline_payload(ref):
            errors.append(_error("inline_cursor_ref", "visibleCursorRefs must contain refs, not inline payloads.", f"$.visibleCursorRefs[{index}]"))
    for issue in _inline_payload_issues(manifest):
        errors.append(_error("inline_payload_forbidden", issue, "$"))
    if require_existing_refs:
        for path_field in ["viewerHtmlRef", "resultRef"]:
            ref = manifest.get(path_field)
            if isinstance(ref, str) and ref and not _existing_file(ref, base_dir=manifest_base_dir):
                errors.append(_error("ref_missing", f"{path_field} does not exist.", f"$.{path_field}", ref=ref))
        for index, ref in enumerate(_string_list(manifest.get("inputEventLogRefs"))):
            if not _existing_file(ref, base_dir=manifest_base_dir):
                errors.append(_error("ref_missing", "Input event log ref does not exist.", f"$.inputEventLogRefs[{index}]", ref=ref))
    return _validation(not errors, errors=errors, frame_counts=frame_counts)


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
    .placeholder-frame {{ border-style: dashed; background: #fffaf0; }}
    .placeholder {{ min-height: 180px; padding: 18px; display: grid; align-content: center; gap: 8px; color: #3d2f13; background: #fff6db; }}
    .placeholder-title {{ font-size: 15px; font-weight: 700; }}
    .placeholder-note {{ font-size: 12px; color: #634d1b; }}
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
    if _frame_kind(frame) == "placeholder":
        return _placeholder_frame_html(frame)
    ref = str(frame.get("screenshotRef") or "")
    src = html.escape(_relative_ref(ref, base_dir))
    label = html.escape(str(frame.get("label") or ref))
    index = html.escape(str(frame.get("index")))
    summary = html.escape(str(frame.get("summary") or ""))
    screen = html.escape(str(frame.get("screenId") or "screen-unknown"))
    window = html.escape(str(frame.get("windowId") or ""))
    lease_owner = _mapping(frame.get("leaseOwner"))
    owner_label = html.escape(str(lease_owner.get("actorId") or lease_owner.get("holder") or ""))
    cursor_refs = html.escape(", ".join(_safe_ref_strings(frame.get("cursorOverlayRefs"))))
    image = f'<img src="{src}" alt="{label}">' if ref else ""
    summary_block = f"<div>{summary}</div>" if summary else ""
    provenance = f"<div>Screen: <code>{screen}</code>"
    if window:
        provenance += f"; window: <code>{window}</code>"
    if owner_label:
        provenance += f"; lease owner: <code>{owner_label}</code>"
    if cursor_refs:
        provenance += f"; cursor overlays: <code>{cursor_refs}</code>"
    provenance += "</div>"
    return f"<figure>{image}<figcaption>Frame {index}: <code>{label}</code>{provenance}{summary_block}</figcaption></figure>"


def _placeholder_frame_html(frame: Mapping[str, Any]) -> str:
    index = html.escape(str(frame.get("index")))
    label = html.escape(str(frame.get("label") or "missing-frame"))
    reason = html.escape(str(frame.get("reason") or "screenshot unavailable"))
    explanation = html.escape(str(frame.get("explanation") or "The screenshot for this frame is unavailable."))
    missing_ref = html.escape(str(frame.get("missingScreenshotRef") or "none declared"))
    source_refs = html.escape(", ".join(_safe_ref_strings(frame.get("sourceRefs"))) or "none")
    summary = html.escape(str(frame.get("summary") or ""))
    summary_block = f"<div>{summary}</div>" if summary else ""
    return (
        '<figure class="placeholder-frame">'
        '<div class="placeholder" role="note" aria-label="Explained missing frame">'
        '<div class="placeholder-title">Frame unavailable</div>'
        '<div>This is not a screenshot.</div>'
        f'<div><strong>Reason:</strong> {reason}</div>'
        f'<div>{explanation}</div>'
        f'<div class="placeholder-note"><strong>Missing screenshot ref:</strong> <code>{missing_ref}</code></div>'
        f'<div class="placeholder-note"><strong>Source refs:</strong> <code>{source_refs}</code></div>'
        "</div>"
        f"<figcaption>Frame {index}: <code>{label}</code>{summary_block}</figcaption>"
        "</figure>"
    )


def _action_html(action: Mapping[str, Any]) -> str:
    refs = ", ".join(_string_list(action.get("screenshotRefs")) + _string_list(action.get("artifactRefs")))
    input_text = _input_label(action)
    target = str(action.get("target") or "")
    provenance = []
    if action.get("screenId"):
        provenance.append(f"screen={action['screenId']}")
    if action.get("windowId"):
        provenance.append(f"window={action['windowId']}")
    if action.get("actorId"):
        provenance.append(f"actor={action['actorId']}")
    if action.get("cursorId"):
        provenance.append(f"cursor={action['cursorId']}")
    if action.get("executorEventRef"):
        provenance.append(f"executor={action['executorEventRef']}")
    if provenance:
        target = "; ".join([target, *provenance]) if target else "; ".join(provenance)
    return (
        "<tr>"
        f"<td>{html.escape(str(action.get('index')))}</td>"
        f"<td>{html.escape(str(action.get('kind') or ''))}</td>"
        f"<td>{html.escape(str(action.get('status') or ''))}</td>"
        f"<td>{html.escape(target)}</td>"
        f"<td>{html.escape(input_text)}</td>"
        f"<td><code>{html.escape(refs)}</code></td>"
        "</tr>"
    )


def _frames(
    refs: Sequence[str],
    root: Path,
    context: Mapping[str, Mapping[str, Any]],
    *,
    source_refs: Sequence[str],
    source_context: Mapping[str, Any],
    omitted_inline_screenshot_ref_count: int,
    visible_cursor_refs: Sequence[str],
) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for index, ref in enumerate(_unique_strings(refs)):
        path = Path(ref)
        absolute_ref = str(path.resolve()) if path.is_absolute() else str((root / path).resolve())
        frame_context = _mapping(context.get(ref)) or _mapping(context.get(absolute_ref))
        if _existing_file(absolute_ref):
            frame = {
                "index": index,
                "label": path.name or f"frame-{index}",
                "screenshotRef": absolute_ref,
                "kind": "screenshot",
                "screenId": frame_context.get("screenId") or "screen-1",
                "windowId": frame_context.get("windowId"),
                "cursorOverlayRefs": _unique_strings([
                    *_safe_ref_strings(frame_context.get("cursorOverlayRefs")),
                    *_safe_ref_strings(visible_cursor_refs),
                ]),
                "sourceEvidenceRefs": _unique_strings([
                    *_safe_ref_strings(frame_context.get("sourceEvidenceRefs")),
                    *_safe_ref_strings(source_refs),
                ]),
                "beforeEvidenceRefs": _safe_ref_strings(frame_context.get("beforeEvidenceRefs")),
                "afterEvidenceRefs": _safe_ref_strings(frame_context.get("afterEvidenceRefs")),
                "leaseOwner": _mapping(frame_context.get("leaseOwner")),
                "leaseScope": _mapping(frame_context.get("leaseScope")),
                "timelineEventRef": frame_context.get("timelineEventRef"),
                "actionIndex": frame_context.get("actionIndex"),
            }
            if frame_context.get("summary"):
                frame["summary"] = frame_context.get("summary")
            frames.append(_sanitize_viewer_payload(frame))
        else:
            frames.append(_placeholder_frame(
                index=index,
                label=path.name or f"frame-{index}",
                reason="screenshot_ref_unavailable",
                explanation=(
                    "A screenshot ref was declared for this frame, but the local screenshot file is missing or empty. "
                    "This placeholder is generated from run refs and metadata instead of rendering a blank frame."
                ),
                source_refs=source_refs,
                source_context={**source_context, **frame_context, "missingScreenshotRef": absolute_ref},
                missing_screenshot_ref=absolute_ref,
                summary=frame_context.get("summary"),
            ))
    if not frames:
        reason = "screenshot_refs_missing"
        explanation = (
            "No screenshot refs were available in result.screenshotRefs, step before/after refs, or finalObservationRef. "
            "This placeholder is generated from run refs and metadata instead of rendering an unexplained blank frame."
        )
        if omitted_inline_screenshot_ref_count:
            reason = "screenshot_refs_omitted_inline_payloads"
            explanation = (
                "Screenshot candidates were present only as inline image payloads, so the viewer omitted them and generated "
                "a refs-first placeholder instead of writing raw image data."
            )
        frames.append(_placeholder_frame(
            index=0,
            label="missing-frame",
            reason=reason,
            explanation=explanation,
            source_refs=source_refs,
            source_context=source_context,
        ))
    return frames


def _placeholder_frame(
    *,
    index: int,
    label: str,
    reason: str,
    explanation: str,
    source_refs: Sequence[str],
    source_context: Mapping[str, Any],
    missing_screenshot_ref: str | None = None,
    summary: str | None = None,
) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "index": index,
        "label": label,
        "kind": "placeholder",
        "placeholder": True,
        "reason": reason,
        "explanation": explanation,
        "screenId": source_context.get("screenId") or "screen-1",
        "windowId": source_context.get("windowId"),
        "sourceRefs": _unique_strings(list(source_refs)),
        "sourceContext": _sanitize_viewer_payload(dict(source_context)),
    }
    if missing_screenshot_ref:
        frame["missingScreenshotRef"] = missing_screenshot_ref
    if summary:
        frame["summary"] = summary
    return _sanitize_viewer_payload(frame)


def _actions(steps: Any) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for fallback_index, step in enumerate(_mapping_list(steps)):
        action = _mapping(step.get("action"))
        provenance = _provenance_from_step(step)
        action_record = {
            "index": step.get("index", fallback_index),
            "kind": action.get("kind") or action.get("type"),
            "target": _target_text(action.get("target")),
            "textPreview": _text_preview(action.get("text")),
            "key": _key_preview(action),
            "reason": action.get("reason"),
            "status": step.get("status"),
            "verification": step.get("verification"),
            "screenId": step.get("screenId") or provenance.get("screenId"),
            "windowId": step.get("windowId") or provenance.get("windowId"),
            "actorId": step.get("actorId") or provenance.get("actorId"),
            "cursorId": step.get("cursorId") or provenance.get("cursorId"),
            "leaseOwner": _mapping(step.get("leaseOwner")) or _lease_owner_from_step(step),
            "leaseScope": _mapping(step.get("leaseScope")) or _lease_scope_from_step(step),
            "executorEventRef": step.get("executorEventRef") or _first_ref(step, _mapping(step.get("execution")), keys=["executorEventRef", "commandEventRef", "executorCommandEventRef", "commandEventLogRef"]),
            "beforeSummary": step.get("beforeSummary"),
            "verificationReason": _mapping(step.get("verification")).get("reason"),
            "beforeEvidenceRefs": _safe_ref_strings(step.get("beforeEvidenceRefs")) or _safe_ref_strings([step.get("beforeRef")]),
            "afterEvidenceRefs": _safe_ref_strings(step.get("afterEvidenceRefs")) or _safe_ref_strings([step.get("afterRef")]),
            "sourceEvidenceRefs": _safe_ref_strings(step.get("sourceEvidenceRefs")),
            "cursorOverlayRefs": _safe_ref_strings(step.get("cursorOverlayRefs")),
            "screenshotRefs": _safe_ref_strings([
                *([str(step.get("beforeRef"))] if isinstance(step.get("beforeRef"), str) else []),
                *([str(step.get("afterRef"))] if isinstance(step.get("afterRef"), str) else []),
                *_string_list(step.get("screenshotRefs")),
            ]),
            "artifactRefs": _safe_ref_strings(step.get("artifactRefs")),
        }
        actions.append(_sanitize_viewer_payload(action_record))
    return actions


def _frame_context(
    actions: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    *,
    visible_cursor_refs: Sequence[str],
) -> dict[str, Mapping[str, Any]]:
    context: dict[str, Mapping[str, Any]] = {}
    for action in actions:
        refs = _string_list(action.get("screenshotRefs"))
        if refs:
            common = {
                "actionIndex": action.get("index"),
                "screenId": action.get("screenId") or "screen-1",
                "windowId": action.get("windowId"),
                "cursorOverlayRefs": _unique_strings([
                    *_safe_ref_strings(action.get("cursorOverlayRefs")),
                    *_safe_ref_strings(visible_cursor_refs),
                ]),
                "leaseOwner": _mapping(action.get("leaseOwner")),
                "leaseScope": _mapping(action.get("leaseScope")),
                "sourceEvidenceRefs": _safe_ref_strings(action.get("sourceEvidenceRefs")),
                "timelineEventRef": action.get("executorEventRef"),
            }
            before_context = {
                **common,
                "summary": action.get("beforeSummary"),
                "beforeEvidenceRefs": _safe_ref_strings(action.get("beforeEvidenceRefs")) or [refs[0]],
            }
            context.setdefault(refs[0], _sanitize_viewer_payload(before_context))
            after_context = {
                **common,
                "summary": action.get("verificationReason"),
                "afterEvidenceRefs": _safe_ref_strings(action.get("afterEvidenceRefs")) or [refs[-1]],
            }
            context[refs[-1]] = _sanitize_viewer_payload(after_context)
    final_ref = payload.get("finalObservationRef")
    if isinstance(final_ref, str) and isinstance(payload.get("reason"), str):
        context[final_ref] = _sanitize_viewer_payload({
            "summary": str(payload.get("reason")),
            "screenId": _provenance_from_step(payload).get("screenId") or "screen-1",
            "cursorOverlayRefs": _safe_ref_strings(visible_cursor_refs),
        })
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
    compact = _sanitize_viewer_text(compact)
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
    seen_events: set[tuple[str, str, str, str, str]] = set()
    for ref in refs:
        try:
            payload = _load_mapping(ref)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        events = _mapping_list(payload.get("events"))
        for event in events:
            modality = str(event.get("modality") or "")
            event_id = (
                str(event.get("actionIndex") if event.get("actionIndex") is not None else ""),
                modality,
                str(event.get("kind") or event.get("actionKind") or ""),
                str(event.get("target") or ""),
                str(event.get("key") or event.get("textPreview") or ""),
            )
            if event_id in seen_events:
                continue
            seen_events.add(event_id)
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


def _first_ref(*mappings: Mapping[str, Any], keys: Sequence[str]) -> str | None:
    for mapping in mappings:
        for key in keys:
            value = mapping.get(key)
            if isinstance(value, str) and value.strip() and not _unsafe_ref_string(value):
                return value.strip()
    return None


def _frame_counts(frames: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts = {"screenshot": 0, "placeholder": 0}
    for frame in frames:
        kind = _frame_kind(frame)
        if kind in counts:
            counts[kind] += 1
    return counts


def _provenance_from_step(step: Mapping[str, Any]) -> dict[str, str]:
    found: dict[str, str] = {}
    _collect_provenance(step, found)
    screen_id = found.get("screenId")
    window_id = found.get("windowId")
    scope_type = found.get("scopeType") or ("window" if window_id else ("screen" if screen_id else ""))
    result: dict[str, str] = {}
    if scope_type:
        result["scopeType"] = scope_type.strip().lower().replace("_", "-")
    for key in ("screenId", "windowId", "actorId", "cursorId"):
        if found.get(key):
            result[key] = found[key]
    return result


def _collect_provenance(value: Any, found: dict[str, str]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"screenid", "screen"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("screenId", str(item).strip())
            elif normalized in {"windowid", "window"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("windowId", str(item).strip())
            elif normalized in {"actorid", "actor"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("actorId", str(item).strip())
            elif normalized in {"cursorid", "cursor"} and isinstance(item, (str, int, float)) and str(item).strip():
                found.setdefault("cursorId", str(item).strip())
            elif normalized in {"scopetype", "scope"} and isinstance(item, str) and item.strip():
                found.setdefault("scopeType", item.strip())
            if isinstance(item, (Mapping, list, tuple)):
                _collect_provenance(item, found)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_provenance(item, found)


def _lease_owner_from_step(step: Mapping[str, Any]) -> dict[str, Any]:
    action = _mapping(step.get("action"))
    execution = _mapping(step.get("execution"))
    candidates = [
        _mapping(step.get("leaseOwner")),
        _mapping(action.get("leaseOwner")),
        _mapping(_mapping(action.get("metadata")).get("leaseOwner")),
        _mapping(_mapping(execution.get("metadata")).get("leaseOwner")),
    ]
    owner: dict[str, Any] = {}
    for candidate in candidates:
        owner.update(candidate)
    provenance = _provenance_from_step(step)
    for key in ("actorId", "cursorId"):
        if key not in owner and provenance.get(key):
            owner[key] = provenance[key]
    return _sanitize_viewer_payload(owner)


def _lease_scope_from_step(step: Mapping[str, Any]) -> dict[str, Any]:
    action = _mapping(step.get("action"))
    execution = _mapping(step.get("execution"))
    candidates = [
        _mapping(step.get("leaseScope")),
        _mapping(action.get("leaseScope")),
        _mapping(_mapping(action.get("metadata")).get("leaseScope")),
        _mapping(_mapping(execution.get("metadata")).get("leaseScope")),
        _provenance_from_step(step),
    ]
    scope: dict[str, Any] = {}
    for candidate in candidates:
        scope.update({key: value for key, value in candidate.items() if value})
    return _sanitize_viewer_payload({
        key: scope[key]
        for key in ("scopeType", "screenId", "windowId")
        if key in scope
    })


def _source_context(
    payload: Mapping[str, Any],
    actions: Sequence[Mapping[str, Any]],
    *,
    declared_screenshot_ref_count: int,
    raw_screenshot_ref_count: int,
    omitted_inline_screenshot_ref_count: int,
) -> dict[str, Any]:
    diagnostics = _mapping(payload.get("failureDiagnostics"))
    provenance = _provenance_from_step(payload) or _provenance_from_step(diagnostics)
    return _sanitize_viewer_payload({
        "status": str(payload.get("status") or "unknown"),
        "reason": str(payload.get("reason") or payload.get("message") or ""),
        "task": str(payload.get("task") or ""),
        "failedStage": str(diagnostics.get("failedStage") or ""),
        "screenId": provenance.get("screenId") or "screen-1",
        "windowId": provenance.get("windowId"),
        "actionCount": len(actions),
        "declaredScreenshotRefCount": declared_screenshot_ref_count,
        "rawScreenshotRefCount": raw_screenshot_ref_count,
        "omittedInlineScreenshotRefCount": omitted_inline_screenshot_ref_count,
        "source": "computer-use-result steps, screenshotRefs, and finalObservationRef",
    })


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


def _safe_ref_strings(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return _unique_strings([
        str(item)
        for item in values
        if isinstance(item, (str, int, float)) and str(item) and not _unsafe_ref_string(str(item))
    ])


def _unique_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _frame_kind(frame: Mapping[str, Any]) -> str:
    raw_kind = str(frame.get("kind") or frame.get("frameType") or "").strip().lower()
    if frame.get("placeholder") is True or raw_kind in {"placeholder", "explained-placeholder", "missing", "unavailable"}:
        return "placeholder"
    if raw_kind == "screenshot" or frame.get("screenshotRef"):
        return "screenshot"
    return raw_kind


def _existing_file(ref: str, *, base_dir: Path | None = None) -> bool:
    try:
        path = Path(ref)
        if not path.is_absolute() and base_dir is not None:
            path = base_dir / path
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _looks_inline_payload(value: str) -> bool:
    text = value.strip().lower()
    return text.startswith("data:") or text.startswith("base64:") or ";base64," in text


def _unsafe_ref_string(value: str) -> bool:
    text = value.strip()
    lowered = text.lower()
    return (
        not text
        or _looks_inline_payload(text)
        or lowered.startswith(("http://", "https://", "www."))
        or "?" in text
        or "#" in text
        or VIEWER_SECRET_ASSIGNMENT_RE.search(text) is not None
        or VIEWER_SECRET_TEXT_RE.search(text) is not None
    )


def _sanitize_viewer_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        safe: dict[str, Any] = {}
        redacted_fields = 0
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if _is_sensitive_viewer_key(normalized):
                redacted_fields += 1
                continue
            safe[key_text] = _sanitize_viewer_payload(item)
        if redacted_fields:
            safe["redactedFieldCount"] = redacted_fields
        return safe
    if isinstance(value, (list, tuple)):
        return [_sanitize_viewer_payload(item) for item in value]
    if isinstance(value, str):
        return _sanitize_viewer_text(value)
    return value


def _sanitize_viewer_text(value: str) -> str:
    text = VIEWER_SECRET_ASSIGNMENT_RE.sub(VIEWER_REDACTED_VALUE, value)
    lowered = text.strip().lower()
    if _looks_inline_payload(text) or "data:image/" in lowered:
        return VIEWER_REDACTED_VALUE
    if VIEWER_SECRET_TEXT_RE.search(text.strip()):
        return VIEWER_REDACTED_VALUE
    return text


def _inline_payload_issues(value: Any) -> list[str]:
    issues: list[str] = []
    _collect_inline_payload_issues(value, issues, path="$")
    return _unique_strings(issues)


def _collect_inline_payload_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if _is_sensitive_viewer_key(normalized):
                issues.append(f"Viewer manifest contains forbidden sensitive/raw payload key {key_text!r} at {path}.")
            _collect_inline_payload_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_inline_payload_issues(item, issues, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        if _looks_inline_payload(value) or "data:image/" in value.lower():
            issues.append("Viewer manifest must not contain inline image/base64 payloads.")
        elif VIEWER_SECRET_ASSIGNMENT_RE.search(value) or VIEWER_SECRET_TEXT_RE.search(value.strip()):
            issues.append("Viewer manifest must not inline provider payloads, tokens, secrets, or credentials.")


def _is_sensitive_viewer_key(normalized_key: str) -> bool:
    if normalized_key.endswith("count"):
        return False
    if normalized_key in {"rawpayloadwritten", "inlineimagewritten", "secretswritten"}:
        return False
    if normalized_key in {
        "authorization",
        "authheader",
        "base64",
        "body",
        "credential",
        "credentials",
        "dataurl",
        "header",
        "headers",
        "imagebase64",
        "password",
        "payload",
        "providerpayload",
        "raw",
        "rawbody",
        "rawimage",
        "rawpayload",
        "rawproviderbody",
        "rawproviderpayload",
        "rawscreenshot",
        "secret",
        "token",
    }:
        return True
    if any(token in normalized_key for token in ("authorization", "password", "credential", "secret", "token")):
        return True
    if any(token in normalized_key for token in ("apikey", "accesskey", "privatekey", "base64", "dataurl")):
        return True
    return normalized_key.startswith("raw") or normalized_key.endswith("payload")


def _validation(
    ok: bool,
    *,
    errors: Sequence[Mapping[str, Any]],
    frame_counts: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": VISIBLE_RUN_VIEWER_VALIDATION_SCHEMA,
        "ok": ok,
        "errors": [dict(error) for error in errors],
        "warnings": [],
        "frameCounts": dict(frame_counts or {"screenshot": 0, "placeholder": 0}),
    }


def _error(code: str, message: str, path: str, **metadata: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path, **metadata}
