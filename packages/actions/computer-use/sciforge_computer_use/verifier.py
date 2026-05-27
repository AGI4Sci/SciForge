"""Verifier metadata boundary helpers.

The action loop remains deterministic: host-provided semantic or VLM verifier
signals are optional evidence metadata, not a second decision path.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping


SEMANTIC_VERIFIER_SCHEMA_VERSION = "sciforge.computer-use.semantic-verifier.v1"

_SEMANTIC_KEYS = {
    "semanticverifier",
    "semanticverification",
    "vlm",
    "vlmverifier",
    "vlmverification",
    "visionverifier",
    "visionverification",
}
_DROP_KEYS = {
    "payload",
    "raw",
    "rawpayload",
    "rawresponse",
    "responsebody",
    "body",
    "image",
    "imagebytes",
    "rawimage",
    "rawscreenshot",
    "screenshot",
    "base64",
    "imagebase64",
}
_REF_KEYS = {
    "evidenceref",
    "evidencerefs",
    "artifactref",
    "artifactrefs",
    "screenshotref",
    "screenshotrefs",
    "imageref",
    "imagerefs",
    "traceref",
    "tracerefs",
}


def normalize_verifier_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return safe verifier metadata suitable for result and trace payloads.

    The helper keeps compact scalar context and durable refs, summarizes optional
    semantic/VLM verifier data under ``semanticVerifier``, drops raw response
    payload fields, and rejects inline image/base64 content.
    """

    if not metadata:
        return {}
    _reject_inline_image_payloads(metadata)
    normalized: dict[str, Any] = {}
    semantic_blocks: list[Mapping[str, Any]] = []

    for key, value in metadata.items():
        normalized_key = _normalize_key(key)
        if normalized_key in _SEMANTIC_KEYS and isinstance(value, Mapping):
            semantic_blocks.append(value)
            continue
        if normalized_key in _DROP_KEYS:
            continue
        compact = _compact_metadata_value(value)
        if compact is not None:
            normalized[str(key)] = compact

    if semantic_blocks:
        normalized["semanticVerifier"] = _semantic_summary(semantic_blocks)
    return normalized


def _semantic_summary(blocks: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    provider_ids: list[str] = []
    model_ids: list[str] = []
    verdicts: list[str] = []
    reasons: list[str] = []
    evidence_refs: list[str] = []
    trace_refs: list[str] = []
    confidences: list[float] = []

    for block in blocks:
        provider_ids.extend(_string_values(block, ("provider", "providerId", "provider_id", "source")))
        model_ids.extend(_string_values(block, ("model", "modelId", "model_id")))
        verdicts.extend(_string_values(block, ("verdict", "status", "label")))
        reasons.extend(_string_values(block, ("reason", "rationale", "summary", "message")))
        evidence_refs.extend(_refs_from_value(block))
        trace_refs.extend(_string_values(block, ("traceRef", "trace_ref", "traceRefs", "trace_refs")))
        confidence = block.get("confidence")
        if isinstance(confidence, (int, float)):
            confidences.append(float(confidence))

    return {
        "schemaVersion": SEMANTIC_VERIFIER_SCHEMA_VERSION,
        "providerIds": _unique_strings(provider_ids),
        "modelIds": _unique_strings(model_ids),
        "verdict": verdicts[-1] if verdicts else "unknown",
        "reason": reasons[-1] if reasons else "",
        "confidence": confidences[-1] if confidences else None,
        "evidenceRefs": _unique_strings(evidence_refs),
        "traceRefs": _unique_strings(trace_refs),
    }


def _compact_metadata_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Mapping):
        compact: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = _normalize_key(key)
            if normalized_key in _DROP_KEYS:
                continue
            compact_item = _compact_metadata_value(item)
            if compact_item is not None:
                compact[str(key)] = compact_item
        return compact
    if isinstance(value, (list, tuple)):
        compact_items = [_compact_metadata_value(item) for item in value]
        return [item for item in compact_items if item is not None]
    return str(value)


def _reject_inline_image_payloads(value: Any) -> None:
    issue = _find_inline_image_payload(value)
    if issue:
        raise ValueError("Verifier metadata must be refs-first and cannot contain inline image/base64 payloads.")


def _find_inline_image_payload(value: Any, *, path: str = "$") -> str | None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized_key = _normalize_key(key_text)
            if normalized_key in {"base64", "imagebase64", "rawimage", "rawscreenshot"}:
                return f"forbidden key {key_text!r} at {path}"
            issue = _find_inline_image_payload(item, path=f"{path}.{key_text}")
            if issue:
                return issue
        return None
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            issue = _find_inline_image_payload(item, path=f"{path}[{index}]")
            if issue:
                return issue
        return None
    if isinstance(value, str):
        if "data:image/" in value or ";base64," in value:
            return f"inline image data at {path}"
    return None


def _refs_from_value(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            if _normalize_key(key) in _REF_KEYS:
                refs.extend(_string_values({"value": item}, ("value",)))
            if isinstance(item, (Mapping, list, tuple)):
                refs.extend(_refs_from_value(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_from_value(item))
    return refs


def _string_values(value: Mapping[str, Any], keys: tuple[str, ...]) -> list[str]:
    values: list[str] = []
    for key in keys:
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            values.append(item.strip())
        elif isinstance(item, (list, tuple)):
            values.extend(str(entry).strip() for entry in item if str(entry).strip())
    return values


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


def _normalize_key(key: Any) -> str:
    return str(key).replace("_", "").replace("-", "").lower()
