"""Fail-closed assembly helper for completed isolated desktop L3 evidence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from .isolated_desktop_l3_workflow_evidence import (
    build_isolated_desktop_l3_workflow_evidence,
    validate_isolated_desktop_l3_workflow_evidence,
)


ISOLATED_DESKTOP_L3_COMPLETION_ASSEMBLY_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l3-completion-assembly.v1"
)
MANIFEST_NAME = "isolated-desktop-l3-completion-assembly-manifest.json"
COMPLETION_EVIDENCE_NAME = "isolated-desktop-l3-workflow-evidence.json"
PARTIAL_REF_KEYS = ("partialRunRef", "partialRuntimeRefs")


def assemble_isolated_desktop_l3_workflow_completion(
    *,
    payload: Mapping[str, Any],
    output_dir: str | Path,
    require_existing_refs: bool = True,
    completion_evidence_name: str = COMPLETION_EVIDENCE_NAME,
) -> dict[str, Any]:
    """Validate and write completed L3 evidence only after all gates pass."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_ref = root / MANIFEST_NAME
    completion_ref = root / completion_evidence_name
    candidate = dict(payload)
    validation = validate_isolated_desktop_l3_workflow_evidence(
        candidate,
        require_existing_refs=require_existing_refs,
    )
    errors = [*_partial_ref_errors(candidate), *validation.get("errors", [])]
    ok = bool(validation.get("ok")) and not errors
    validation_for_manifest = dict(validation)
    validation_for_manifest["ok"] = ok
    validation_for_manifest["errors"] = errors

    completion_evidence_ref: str | None = None
    if ok:
        completed_evidence = build_isolated_desktop_l3_workflow_evidence(
            payload=candidate,
            require_existing_refs=require_existing_refs,
        )
        completed_evidence = _bundle_localize_refs(completed_evidence, root)
        completion_ref.write_text(f"{json.dumps(completed_evidence, indent=2, sort_keys=True)}\n", encoding="utf8")
        _bundle_localize_json_payload_files(root)
        completion_evidence_ref = completion_evidence_name

    manifest = {
        "schemaVersion": ISOLATED_DESKTOP_L3_COMPLETION_ASSEMBLY_SCHEMA_VERSION,
        "status": "completed" if ok else "blocked",
        "category": (
            "isolated-desktop-l3-completion-assembled"
            if ok
            else "isolated-desktop-l3-completion-assembly-blocked"
        ),
        "reason": (
            "Completed L3 evidence was validated and written."
            if ok
            else "; ".join(error["message"] for error in errors) or "Completed L3 evidence validator rejected the payload."
        ),
        "manifestRef": str(manifest_ref),
        "completionEvidenceRef": completion_evidence_ref,
        "candidateEvidenceWritten": ok,
        "validator": "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.validate_isolated_desktop_l3_workflow_evidence",
        "requireExistingRefs": bool(require_existing_refs),
        "validation": validation_for_manifest,
        "errors": errors,
        "blockedReasons": [error["message"] for error in errors],
        "diagnosticOnly": not ok,
        "userAcceptanceEligible": bool(ok and candidate.get("userAcceptanceEligible") is True),
        "l3WorkflowCompleted": ok,
        "partialRefsPromoted": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "claimLimit": (
            "This assembler may write completionEvidenceRef only after the completed L3 validator "
            "accepts existing refs. Blocked assembly manifests are diagnostics and cannot complete L3."
        ),
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _partial_ref_errors(candidate: Mapping[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for key in PARTIAL_REF_KEYS:
        if key in candidate and candidate.get(key) not in (None, [], {}):
            errors.append(_error(
                "partial_refs_forbidden",
                f"{key} belongs to the blocked partial runtime namespace and cannot be assembled as completed L3 evidence.",
                f"$.{key}",
                actual=candidate.get(key),
            ))
    return errors


def _error(
    code: str,
    message: str,
    path: str,
    *,
    actual: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "path": path,
        "severity": "error",
    }
    if actual is not None:
        payload["actual"] = actual
    return payload


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _bundle_localize_refs(value: Any, root: Path, *, key: str | None = None) -> Any:
    if isinstance(value, Mapping):
        return {
            name: _bundle_localize_refs(item, root, key=str(name))
            for name, item in value.items()
        }
    if isinstance(value, list):
        return [_bundle_localize_refs(item, root, key=key) for item in value]
    if isinstance(value, str) and key and _is_ref_key(key):
        return _bundle_local_ref(value, root)
    return value


def _is_ref_key(key: str) -> bool:
    return key.endswith("Ref") or key.endswith("Refs")


def _bundle_local_ref(ref: str, root: Path) -> str:
    path_text, separator, fragment = ref.partition("#")
    try:
        path = Path(path_text).expanduser()
    except (TypeError, ValueError):
        return ref
    if not path.is_absolute():
        return ref
    try:
        relative = path.resolve(strict=False).relative_to(root.resolve(strict=False))
    except ValueError:
        return ref
    localized = relative.as_posix()
    return localized + (separator + fragment if separator else "")


def _bundle_localize_json_payload_files(root: Path) -> None:
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in {".json", ".jsonl"}:
            continue
        if path.suffix == ".json":
            try:
                payload = json.loads(path.read_text(encoding="utf8"))
            except (json.JSONDecodeError, OSError, UnicodeDecodeError):
                continue
            localized = _bundle_localize_all_strings(payload, root)
            path.write_text(f"{json.dumps(localized, indent=2, sort_keys=True)}\n", encoding="utf8")
            continue
        try:
            lines = path.read_text(encoding="utf8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        output: list[str] = []
        changed = False
        for line in lines:
            if not line.strip():
                output.append(line)
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                output.append(line)
                continue
            localized = _bundle_localize_all_strings(payload, root)
            rendered = json.dumps(localized, sort_keys=True)
            output.append(rendered)
            changed = changed or rendered != line
        if changed:
            path.write_text("\n".join(output) + "\n", encoding="utf8")


def _bundle_localize_all_strings(value: Any, root: Path) -> Any:
    if isinstance(value, Mapping):
        return {
            name: _bundle_localize_all_strings(item, root)
            for name, item in value.items()
        }
    if isinstance(value, list):
        return [_bundle_localize_all_strings(item, root) for item in value]
    if isinstance(value, str):
        return _bundle_local_ref(value, root)
    return value


__all__ = [
    "COMPLETION_EVIDENCE_NAME",
    "ISOLATED_DESKTOP_L3_COMPLETION_ASSEMBLY_SCHEMA_VERSION",
    "MANIFEST_NAME",
    "assemble_isolated_desktop_l3_workflow_completion",
]
