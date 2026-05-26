"""Trace serialization and validation helpers for Computer Use results."""

from __future__ import annotations

import json
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from .contracts import ComputerUseResult


TRACE_SCHEMA_VERSION = "sciforge.computer-use.loop-trace.v1"
TRACE_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.trace-validation.v1"


def result_to_trace(result: ComputerUseResult) -> dict[str, Any]:
    """Return a file-ref-only trace dictionary."""

    screenshot_refs, artifact_refs = _promoted_result_refs(result)
    final_artifact_refs = _promoted_final_artifact_refs(result)
    trace = {
        "schemaVersion": TRACE_SCHEMA_VERSION,
        "resultSchemaVersion": result.schema_version,
        "status": result.status,
        "reason": result.reason,
        "approvalRequest": _compact_dataclass(result.approval_request),
        "metrics": dict(result.metrics),
        "failureDiagnostics": dict(result.failure_diagnostics),
        "finalObservationRef": result.final_observation.ref if result.final_observation else None,
        "traceRefs": list(result.trace_refs),
        "screenshotRefs": screenshot_refs,
        "artifactRefs": artifact_refs,
        "finalArtifactRef": final_artifact_refs[0] if final_artifact_refs else None,
        "finalArtifactRefs": final_artifact_refs,
        "steps": [_step_to_trace(step) for step in result.steps],
        "budgetDebits": [dict(debit) for debit in result.budget_debits],
        "budgetDebitRefs": list(result.budget_debit_refs),
    }
    _reject_inline_payloads(trace)
    return trace


def compact_result_for_handoff(result: ComputerUseResult) -> dict[str, Any]:
    """Build a compact handoff block for upper-level agents."""

    trace = result_to_trace(result)
    refs = _unique_strings([
        *trace["screenshotRefs"],
        *trace["artifactRefs"],
        *trace["finalArtifactRefs"],
        *trace["traceRefs"],
    ])
    return {
        "schemaVersion": "sciforge.computer-use.compact-handoff.v1",
        "status": result.status,
        "reason": result.reason,
        "refs": refs,
        "traceRefs": trace["traceRefs"],
        "screenshotRefs": trace["screenshotRefs"],
        "artifactRefs": trace["artifactRefs"],
        "finalArtifactRef": trace.get("finalArtifactRef"),
        "finalArtifactRefs": trace["finalArtifactRefs"],
        "actions": [
            {
                "index": step["index"],
                "kind": step.get("action", {}).get("kind"),
                "target": step.get("action", {}).get("target"),
                "status": step.get("status"),
                "verification": step.get("verification"),
                "screenshotRefs": step.get("screenshotRefs", []),
                "artifactRefs": step.get("artifactRefs", []),
                "budgetDebitRefs": list(step.get("budgetDebitRefs", [])),
            }
            for step in trace["steps"]
        ],
        "failureDiagnostics": trace["failureDiagnostics"],
        "approvalRequest": trace.get("approvalRequest"),
        "budgetDebits": trace["budgetDebits"],
        "budgetDebitRefs": trace["budgetDebitRefs"],
    }


def compact_result(result: ComputerUseResult) -> dict[str, Any]:
    """Public README-aligned shim for compact result handoff."""

    return compact_result_for_handoff(result)


def validate_trace(
    trace_or_ref: Mapping[str, Any] | str | Path,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate a refs-first Computer Use trace payload, local trace path, or host-resolved durable ref.

    Durable workspace refs such as ``trace:...`` require a host-side resolver, so
    callers can pass ``resolver`` to map durable refs to a payload or local JSON
    file before validation.
    """

    trace_ref: str | None = None
    warnings: list[str] = []
    errors: list[str] = []

    try:
        trace = _load_trace(trace_or_ref, resolver=resolver)
    except FileNotFoundError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[f"Trace ref is not a readable local JSON file: {exc}."],
            warnings=warnings,
        )
    except json.JSONDecodeError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[f"Trace JSON could not be parsed: {exc}."],
            warnings=warnings,
        )
    except TypeError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[str(exc)],
            warnings=warnings,
        )

    if not isinstance(trace_or_ref, Mapping):
        trace_ref = str(trace_or_ref)

    if trace.get("schemaVersion") != TRACE_SCHEMA_VERSION:
        errors.append(f"Unsupported trace schemaVersion={trace.get('schemaVersion')!r}.")
    for key in ("status", "reason", "steps"):
        if key not in trace:
            errors.append(f"Trace missing required key {key!r}.")
    if not isinstance(trace.get("steps", []), list):
        errors.append("Trace key 'steps' must be a list.")

    inline_issues = _inline_payload_issues(trace)
    errors.extend(inline_issues)

    screenshot_refs = _unique_strings([
        *_refs_from_explicit_list(trace.get("screenshotRefs")),
        *_collect_screenshot_refs(trace),
    ])
    artifact_refs = _unique_strings([
        *_refs_from_explicit_list(trace.get("artifactRefs")),
        *_collect_artifact_refs(trace),
    ])
    final_artifact_refs = _unique_strings([
        *(_refs_inside(trace.get("finalArtifactRef"), prefer_image=False) if trace.get("finalArtifactRef") else []),
        *_refs_from_explicit_list(trace.get("finalArtifactRefs")),
        *_collect_final_artifact_refs(trace),
    ])
    trace_refs = _unique_strings(_refs_from_explicit_list(trace.get("traceRefs")))

    if not screenshot_refs:
        warnings.append("Trace has no promoted screenshotRefs.")

    return _trace_validation_result(
        trace,
        trace_ref=trace_ref,
        errors=errors,
        warnings=warnings,
        screenshot_refs=screenshot_refs,
        artifact_refs=artifact_refs,
        final_artifact_refs=final_artifact_refs,
        trace_refs=trace_refs,
    )


def _step_to_trace(step: Any) -> dict[str, Any]:
    screenshot_refs, artifact_refs = _promoted_observation_refs([
        step.before,
        step.after,
    ])
    return {
        "index": step.index,
        "status": step.status,
        "beforeRef": step.before.ref,
        "beforeSummary": step.before.summary,
        "afterRef": step.after.ref if step.after else None,
        "screenshotRefs": screenshot_refs,
        "artifactRefs": artifact_refs,
        "action": _action_to_trace(step.plan),
        "grounding": _compact_dataclass(step.grounding),
        "execution": _compact_dataclass(step.execution),
        "verification": _compact_dataclass(step.verification),
        "failureReason": step.failure_reason,
        "budgetDebitRefs": list(step.budget_debit_refs),
    }


def _action_to_trace(action: Any) -> dict[str, Any]:
    return {
        "kind": action.kind,
        "target": action.target.description if action.target else None,
        "targetRegion": action.target.region_description if action.target else None,
        "text": action.text,
        "key": action.key,
        "keys": list(action.keys),
        "direction": action.direction,
        "amount": action.amount,
        "appName": action.app_name,
        "done": action.done,
        "reason": action.reason,
        "riskLevel": action.risk_level,
        "requiresConfirmation": action.requires_confirmation,
    }


def _compact_dataclass(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        data = dict(value)
    elif is_dataclass(value):
        data = {field.name: getattr(value, field.name) for field in fields(value)}
    else:
        return {"value": str(value)}
    return {key: _compact_value(item) for key, item in data.items()}


def _compact_value(value: Any) -> Any:
    if is_dataclass(value):
        return _compact_dataclass(value)
    if isinstance(value, Mapping):
        return {key: _compact_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_compact_value(item) for item in value]
    return value


def _reject_inline_payloads(value: Any) -> None:
    if _inline_payload_issues(value):
        raise ValueError("Computer Use trace must be file-ref-only and cannot contain inline image payloads.")


def _inline_payload_issues(value: Any) -> list[str]:
    issues: list[str] = []
    _collect_inline_payload_issues(value, issues, path="$")
    return _unique_strings(issues)


def _collect_inline_payload_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if normalized in {"rawscreenshot", "rawimage", "base64", "imagebase64"}:
                issues.append(f"Trace contains forbidden inline payload key {key_text!r} at {path}.")
            _collect_inline_payload_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_inline_payload_issues(item, issues, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        if "data:image/" in value or ";base64," in value:
            issues.append("Trace must be file-ref-only and cannot contain inline image payloads.")


def _promoted_result_refs(result: ComputerUseResult) -> tuple[list[str], list[str]]:
    observations: list[Any] = []
    for step in result.steps:
        observations.append(step.before)
        observations.append(step.after)
    observations.append(result.final_observation)
    return _promoted_observation_refs(observations)


def _promoted_final_artifact_refs(result: ComputerUseResult) -> list[str]:
    refs = list(getattr(result, "final_artifact_refs", ()) or ())
    refs.extend(_collect_final_artifact_refs(getattr(result.final_observation, "artifacts", None)))
    refs.extend(_collect_final_artifact_refs(getattr(result.final_observation, "metadata", None)))
    for step in reversed(list(result.steps)):
        refs.extend(_collect_final_artifact_refs(getattr(step.plan, "metadata", None)))
        verification = getattr(step, "verification", None)
        refs.extend(_collect_final_artifact_refs(getattr(verification, "metadata", None)))
        if refs:
            break
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _promoted_observation_refs(observations: Iterable[Any]) -> tuple[list[str], list[str]]:
    screenshot_refs: list[str] = []
    artifact_refs: list[str] = []
    for observation in observations:
        if observation is None:
            continue
        ref = getattr(observation, "ref", None)
        if isinstance(ref, str) and ref.strip():
            screenshot_refs.append(ref)
        artifacts = getattr(observation, "artifacts", None)
        metadata = getattr(observation, "metadata", None)
        screenshot_refs.extend(_collect_screenshot_refs(artifacts))
        screenshot_refs.extend(_collect_screenshot_refs(metadata))
        artifact_refs.extend(_collect_artifact_refs(artifacts))
        artifact_refs.extend(_collect_artifact_refs(metadata))
    return _unique_strings(screenshot_refs), _unique_strings(artifact_refs)


def _collect_screenshot_refs(value: Any) -> list[str]:
    return _collect_refs(value, _is_screenshot_key, prefer_image=True)


def _collect_artifact_refs(value: Any) -> list[str]:
    return _collect_refs(value, _is_artifact_key, prefer_image=False)


def _collect_final_artifact_refs(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        if _looks_like_visible_artifact_record(value):
            refs.extend(_refs_inside({
                "artifactRef": value.get("artifactRef") or value.get("artifact_ref"),
                "dataRef": value.get("dataRef") or value.get("data_ref"),
                "outputRef": value.get("outputRef") or value.get("output_ref"),
                "path": value.get("path"),
                "ref": value.get("ref"),
            }, prefer_image=False))
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"finalartifactref", "finalartifactrefs", "finalartifact", "finalartifacts"}:
                refs.extend(_refs_inside(item, prefer_image=False))
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_collect_final_artifact_refs(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_collect_final_artifact_refs(item))
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _collect_refs(value: Any, key_predicate: Any, *, prefer_image: bool) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if key_predicate(key_text):
                refs.extend(_refs_inside(item, prefer_image=prefer_image))
                if isinstance(item, str) and _looks_like_ref(item) and (not prefer_image or _looks_like_screenshot_ref(item)):
                    refs.append(item)
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_collect_refs(item, key_predicate, prefer_image=prefer_image))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_collect_refs(item, key_predicate, prefer_image=prefer_image))
    return _unique_strings(refs)


def _refs_inside(value: Any, *, prefer_image: bool) -> list[str]:
    refs: list[str] = []
    if isinstance(value, str):
        if _looks_like_ref(value) and (not prefer_image or _looks_like_screenshot_ref(value)):
            refs.append(value)
    elif isinstance(value, Mapping):
        for key in ("path", "uri", "ref", "id", "artifactRef", "dataRef", "outputRef", "rawRef"):
            item = value.get(key)
            if isinstance(item, str) and _looks_like_ref(item):
                if not prefer_image or _looks_like_screenshot_ref(item) or _is_screenshot_key(key):
                    refs.append(item)
        for item in value.values():
            refs.extend(_refs_inside(item, prefer_image=prefer_image))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_inside(item, prefer_image=prefer_image))
    return _unique_strings(refs)


def _refs_from_explicit_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return _unique_strings([item for item in value if isinstance(item, str) and item.strip()])
    return []


def _is_screenshot_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("screenshot", "image", "capture", "focusref", "focusrefs"))


def _is_artifact_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("artifact", "output", "dataref", "rawref", "resultref"))


def _looks_like_visible_artifact_record(value: Mapping[str, Any]) -> bool:
    schema = str(value.get("schemaVersion") or value.get("schema_version") or "")
    delivery = str(value.get("delivery") or "")
    status = str(value.get("status") or "")
    kind = str(value.get("kind") or value.get("type") or "")
    return (
        schema == "sciforge.computer-use.virtual-remote-artifact.v1"
        or delivery == "virtual-remote-session-artifact"
        or status in {"visible-and-saved", "saved", "final"}
        or any(token in kind.lower() for token in ("artifact", "document", "index", "report", "deck", "presentation"))
    )


def _looks_like_ref(value: str) -> bool:
    text = value.strip()
    return (
        text.startswith(("artifact:", "file:", "workEvidence:", "budgetDebit:", "audit:", "approval:", "ref:", "trace:"))
        or text.startswith(("EU-", ".sciforge/", "/"))
        or text.lower().endswith((".json", ".md", ".txt", ".csv", ".tsv", ".xlsx", ".ppt", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"))
    )


def _looks_like_screenshot_ref(value: str) -> bool:
    text = value.strip().lower()
    return text.endswith((".png", ".jpg", ".jpeg", ".webp")) or text.startswith(("screenshot:", "capture:"))


def _looks_like_final_artifact_ref(value: str) -> bool:
    text = value.strip()
    return (
        bool(text)
        and _looks_like_ref(text)
        and not _looks_like_screenshot_ref(text)
        and not _looks_like_control_evidence_ref(text)
    )


def _looks_like_control_evidence_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return name in {
        "vision-trace.json",
        "host-ports.json",
        "tool-payload.json",
        "gui-present.json",
        "gui-ask-user.json",
        "computer-use-request.json",
        "gateway-request.json",
        "request.json",
        "independent-input-adapter.json",
        "virtual-remote-session.json",
        "action-ledger.json",
        "failure-diagnostics.json",
        "cu-user-acceptance-manifest.json",
        "cu-user-acceptance-input.json",
        "cu-l3-independent-input-verifier.json",
    }


def _unique_strings(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def _load_trace(
    trace_or_ref: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any]:
    if isinstance(trace_or_ref, Mapping):
        return trace_or_ref
    if isinstance(trace_or_ref, str) and trace_or_ref.startswith("trace:"):
        if resolver is None:
            raise FileNotFoundError(f"{trace_or_ref} (durable refs require a host resolver)")
        resolved = resolver(trace_or_ref)
        if resolved == trace_or_ref:
            raise FileNotFoundError(f"{trace_or_ref} (resolver returned the original ref)")
        return _load_trace(resolved, resolver=None)
    path = Path(trace_or_ref)
    if not path.exists():
        raise FileNotFoundError(str(path))
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("Trace JSON root must be an object.")
    return parsed


def _trace_validation_result(
    trace: Mapping[str, Any] | None,
    *,
    trace_ref: str | None,
    errors: list[str],
    warnings: list[str],
    screenshot_refs: list[str] | None = None,
    artifact_refs: list[str] | None = None,
    final_artifact_refs: list[str] | None = None,
    trace_refs: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": TRACE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "traceRef": trace_ref,
        "status": trace.get("status") if trace else None,
        "errors": errors,
        "warnings": warnings,
        "screenshotRefs": screenshot_refs or [],
        "artifactRefs": artifact_refs or [],
        "finalArtifactRefs": final_artifact_refs or [],
        "traceRefs": trace_refs or [],
    }
