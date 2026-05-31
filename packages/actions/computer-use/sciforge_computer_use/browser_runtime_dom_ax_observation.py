"""BrowserRuntime DOM/AX observation helpers for Computer Use.

These helpers intentionally model DOM, accessibility, and Playwright output as
refs-first observation hints. They are useful for observe-before-mutate
freshness and target grounding, but they are never executor leases, GUI action
causality, artifact causality, or completion evidence.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence


BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA = "sciforge.computer-use.browser-runtime-dom-ax-observation.v1"
BROWSER_RUNTIME_GROUNDING_HINT_SCHEMA = "sciforge.computer-use.browser-runtime-grounding-hint.v1"
BROWSER_RUNTIME_PAGE_QUERY_SCHEMA = "sciforge.browser-runtime.page-query.v1"
BROWSER_RUNTIME_STABLE_REF_SCHEMA = "sciforge.browser-runtime.stable-ref.v1"

_FORBIDDEN_INLINE_KEYS = {
    "accessibilitytree",
    "base64",
    "dataurl",
    "fulldom",
    "html",
    "inlinedom",
    "inlineimage",
    "playwrightrawresult",
    "providerrawpayload",
    "rawaccessibilitysnapshot",
    "rawdom",
    "rawpayload",
    "rawplaywrightevaluate",
    "rawscreenshot",
    "screenshotbase64",
}


def build_browser_runtime_dom_ax_observation(
    *,
    observation_id: str,
    display_group_id: str,
    screen_id: str,
    window_id: str,
    browser_session_ref: str,
    source_snapshot_ref: str,
    page_query: Mapping[str, Any],
    stable_refs: Sequence[Mapping[str, Any]],
    visible_dom_ref: str | None = None,
    accessibility_snapshot_ref: str | None = None,
    playwright_evaluate_ref: str | None = None,
    screenshot_ref: str | None = None,
    browser_tab_ref: str | None = None,
    observed_at: str | None = None,
    freshness_check_ref: str | None = None,
    observation_ref: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a scoped DOM/AX observation record from BrowserRuntime refs."""

    grounding_hints = [
        {
            "schemaVersion": BROWSER_RUNTIME_GROUNDING_HINT_SCHEMA,
            "hintId": f"{observation_id}-hint-{index + 1}",
            "source": "browser-runtime-stable-ref",
            "displayGroupId": display_group_id,
            "screenId": screen_id,
            "windowId": window_id,
            "stableRef": dict(stable_ref),
            "groundingUse": "candidate-target-only",
            "executorLeaseSubstitute": False,
            "guiActionSubstitute": False,
            "artifactCausalitySubstitute": False,
            "completionEvidence": False,
        }
        for index, stable_ref in enumerate(stable_refs)
    ]
    ref_values = [
        browser_session_ref,
        browser_tab_ref,
        source_snapshot_ref,
        visible_dom_ref,
        accessibility_snapshot_ref,
        playwright_evaluate_ref,
        screenshot_ref,
        freshness_check_ref,
        observation_ref,
    ]
    return _drop_empty({
        "schemaVersion": BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA,
        "observationId": observation_id,
        "observationRef": observation_ref,
        "provider": "browser_runtime",
        "displayGroupId": display_group_id,
        "screenId": screen_id,
        "windowId": window_id,
        "scope": {
            "displayGroupId": display_group_id,
            "screenId": screen_id,
            "windowId": window_id,
        },
        "browserSessionRef": browser_session_ref,
        "browserTabRef": browser_tab_ref,
        "sourceSnapshotRef": source_snapshot_ref,
        "visibleDomRef": visible_dom_ref,
        "accessibilitySnapshotRef": accessibility_snapshot_ref,
        "playwrightEvaluateRef": playwright_evaluate_ref,
        "screenshotRef": screenshot_ref,
        "stateSnapshotRef": accessibility_snapshot_ref or visible_dom_ref or source_snapshot_ref,
        "pageQuery": dict(page_query),
        "stableElementRefs": [dict(stable_ref) for stable_ref in stable_refs],
        "groundingHints": grounding_hints,
        "groundingHintRefs": [hint["hintId"] for hint in grounding_hints],
        "observedAt": observed_at,
        "freshnessCheckRef": freshness_check_ref,
        "refs": [ref for ref in ref_values if isinstance(ref, str) and ref.strip()],
        "trust": "untrusted-page-observation",
        "observationUse": "observe-before-mutate-hint",
        "refsFirst": True,
        "currentBundleOnly": True,
        "completionEvidenceEligible": False,
        "executorLeaseSubstitute": False,
        "guiActionSubstitute": False,
        "artifactCausalitySubstitute": False,
        "userLevelCompletionSubstitute": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "inlineDomWritten": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "metadata": _safe_mapping(metadata or {}),
    })


def build_observe_before_mutate_from_browser_runtime(
    observation: Mapping[str, Any],
    *,
    grounding_ref: str | None = None,
    freshness_status: str = "current",
    max_age_ms: int = 30000,
) -> dict[str, Any]:
    """Project a BrowserRuntime DOM/AX observation into scheduler evidence."""

    app_state_ref = _string(observation.get("sourceSnapshotRef")) or _string(observation.get("browserSessionRef"))
    state_snapshot_ref = (
        _string(observation.get("stateSnapshotRef"))
        or _string(observation.get("accessibilitySnapshotRef"))
        or _string(observation.get("visibleDomRef"))
    )
    selected_grounding_ref = (
        grounding_ref
        or _first_string(observation.get("groundingHintRefs"))
        or _string(observation.get("visibleDomRef"))
    )
    observed_at = _string(observation.get("observedAt"))
    return _drop_empty({
        "appStateRef": app_state_ref,
        "screenshotRef": _string(observation.get("screenshotRef")),
        "captureRef": _string(observation.get("sourceSnapshotRef")),
        "accessibilitySnapshotRef": _string(observation.get("accessibilitySnapshotRef")),
        "stateSnapshotRef": state_snapshot_ref,
        "groundingRef": selected_grounding_ref,
        "sourceObservationRef": _string(observation.get("observationRef")) or _string(observation.get("sourceSnapshotRef")),
        "displayGroupId": _string(observation.get("displayGroupId")),
        "screenId": _string(observation.get("screenId")),
        "windowId": _string(observation.get("windowId")),
        "observedAt": observed_at,
        "capturedAt": observed_at,
        "freshnessCheckedAt": observed_at,
        "browserRuntimeObservationRef": _string(observation.get("observationRef")),
        "domVisibleRef": _string(observation.get("visibleDomRef")),
        "playwrightEvaluateRef": _string(observation.get("playwrightEvaluateRef")),
        "freshnessCheck": {
            "status": freshness_status,
            "observedAt": observed_at,
            "checkedAt": observed_at,
            "maxAgeMs": max_age_ms,
            "reason": "BrowserRuntime DOM/AX refs are current observe-before-mutate hints.",
        },
    })


def validate_browser_runtime_dom_ax_observation(
    observation_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
    bundle_root: str | Path | None = None,
) -> dict[str, Any]:
    """Validate BrowserRuntime DOM/AX refs as hints-only Computer Use evidence."""

    try:
        observation = _load_payload(observation_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            schema_version=None,
            errors=[_issue("payload_load_failed", f"BrowserRuntime DOM/AX observation could not be loaded: {exc}.", "$")],
            refs=[],
        )

    errors: list[dict[str, Any]] = []
    bundle_root_path = Path(bundle_root).resolve() if bundle_root is not None else None
    schema_version = _string(observation.get("schemaVersion"))
    if schema_version != BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA:
        errors.append(_issue(
            "unsupported_schema_version",
            "BrowserRuntime DOM/AX observation schemaVersion is invalid.",
            "$.schemaVersion",
            expected=BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA,
            actual=schema_version,
        ))
    for key in ("observationId", "displayGroupId", "screenId", "windowId", "browserSessionRef", "sourceSnapshotRef"):
        if not _string(observation.get(key)):
            errors.append(_issue("required_field_missing", f"{key} is required.", f"$.{key}"))
    for key in ("refsFirst", "currentBundleOnly"):
        if observation.get(key) is not True:
            errors.append(_issue("refs_first_flag_invalid", f"{key} must be true.", f"$.{key}", actual=observation.get(key)))
    if not any(_string(observation.get(key)) for key in ("visibleDomRef", "accessibilitySnapshotRef", "playwrightEvaluateRef")):
        errors.append(_issue(
            "dom_ax_ref_missing",
            "At least one DOM, accessibility, or Playwright evaluate ref is required.",
            "$",
        ))
    page_query = observation.get("pageQuery")
    if not isinstance(page_query, Mapping) or page_query.get("schemaVersion") != BROWSER_RUNTIME_PAGE_QUERY_SCHEMA:
        errors.append(_issue(
            "page_query_invalid",
            "pageQuery must use BrowserRuntimePageQuery schema.",
            "$.pageQuery.schemaVersion",
        ))
    stable_refs = observation.get("stableElementRefs")
    if not isinstance(stable_refs, list) or not stable_refs:
        errors.append(_issue("stable_refs_missing", "stableElementRefs must contain at least one stable ref.", "$.stableElementRefs"))
    else:
        for index, stable_ref in enumerate(stable_refs):
            if not isinstance(stable_ref, Mapping) or stable_ref.get("schemaVersion") != BROWSER_RUNTIME_STABLE_REF_SCHEMA:
                errors.append(_issue(
                    "stable_ref_invalid",
                    "stableElementRefs entries must use BrowserRuntimeStableRef schema.",
                    f"$.stableElementRefs[{index}].schemaVersion",
                ))
            elif _stable_ref_has_forbidden_ref_payload(stable_ref):
                errors.append(_issue(
                    "stable_ref_ref_payload_forbidden",
                    "stableElementRefs must not carry embedded refs or raw DOM/AX payloads.",
                    f"$.stableElementRefs[{index}]",
                ))
    if observation.get("trust") != "untrusted-page-observation":
        errors.append(_issue("trust_boundary_invalid", "BrowserRuntime page data must be marked untrusted.", "$.trust"))
    if observation.get("observationUse") != "observe-before-mutate-hint":
        errors.append(_issue(
            "observation_use_invalid",
            "DOM/AX observations can only be used as observe-before-mutate hints.",
            "$.observationUse",
        ))
    for key in (
        "completionEvidenceEligible",
        "executorLeaseSubstitute",
        "guiActionSubstitute",
        "artifactCausalitySubstitute",
        "userLevelCompletionSubstitute",
        "rawPayloadWritten",
        "inlineImageWritten",
        "inlineDomWritten",
        "sharedSystemInputUsed",
        "systemPointerMoved",
        "systemKeyboardEventsSent",
    ):
        if observation.get(key) is not False:
            errors.append(_issue("boundary_flag_invalid", f"{key} must be false.", f"$.{key}", actual=observation.get(key)))
    errors.extend(_inline_payload_issues(observation))
    errors.extend(_page_query_ref_issues(page_query))
    ref_entries = _collect_ref_entries(observation)
    for path, ref in ref_entries:
        if path.endswith(".pageQuery.select.ref") or path.endswith(".pageQuery.select.withinRef"):
            continue
        if not _is_current_bundle_ref(ref, bundle_root_path):
            errors.append(_issue(
                "ref_not_current_bundle",
                "BrowserRuntime DOM/AX evidence refs must stay bundle-local.",
                path,
                actual=ref,
            ))
    refs = sorted({ref for _, ref in ref_entries})
    if require_existing_refs:
        for ref in refs:
            if _looks_like_path(ref) and not Path(ref).exists():
                errors.append(_issue("ref_missing", f"Referenced file does not exist: {ref}", "$.refs"))
    return _validation_result(schema_version=schema_version, errors=errors, refs=refs)


def _load_payload(value: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    parsed = json.loads(Path(value).read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("payload root is not an object")
    return parsed


def _collect_refs(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            if str(key).lower().endswith("ref") and isinstance(item, str) and item.strip():
                refs.append(item.strip())
            elif str(key).lower().endswith("refs") and isinstance(item, list):
                refs.extend(entry.strip() for entry in item if isinstance(entry, str) and entry.strip())
            else:
                refs.extend(_collect_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.extend(_collect_refs(item))
    return sorted(set(refs))


def _collect_ref_entries(value: Any, path: str = "$") -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_path = f"{path}.{key}"
            normalized_key = str(key).lower()
            if normalized_key.endswith("ref") and isinstance(item, str) and item.strip():
                refs.append((key_path, item.strip()))
            elif normalized_key.endswith("refs") and isinstance(item, list):
                refs.extend((f"{key_path}[{index}]", entry.strip()) for index, entry in enumerate(item) if isinstance(entry, str) and entry.strip())
            else:
                refs.extend(_collect_ref_entries(item, key_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            refs.extend(_collect_ref_entries(item, f"{path}[{index}]"))
    return refs


def _inline_payload_issues(value: Any, path: str = "$") -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            child_path = f"{path}.{key}"
            if normalized in _FORBIDDEN_INLINE_KEYS:
                issues.append(_issue(
                    "inline_payload_key_forbidden",
                    "DOM/AX observation must store large/raw page payloads as refs only.",
                    child_path,
                ))
            issues.extend(_inline_payload_issues(item, child_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            issues.extend(_inline_payload_issues(item, f"{path}[{index}]"))
    elif isinstance(value, str):
        if value.startswith("data:image/") or len(value) > 4096:
            issues.append(_issue(
                "inline_payload_string_forbidden",
                "DOM/AX observation must not inline screenshots, full DOM, or large provider payloads.",
                path,
            ))
    return issues


def _page_query_ref_issues(page_query: Any) -> list[dict[str, Any]]:
    if not isinstance(page_query, Mapping):
        return []
    select = page_query.get("select")
    if not isinstance(select, Mapping):
        return []
    issues: list[dict[str, Any]] = []
    for key in ("ref", "withinRef"):
        ref = _string(select.get(key))
        if ref and not _is_stable_token_ref(ref):
            issues.append(_issue(
                "page_query_ref_invalid",
                "BrowserRuntime PageQuery selector refs must be stable tokens, not external/file refs.",
                f"$.pageQuery.select.{key}",
                actual=ref,
            ))
    return issues


def _stable_ref_has_forbidden_ref_payload(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized.endswith("ref") or normalized.endswith("refs") or normalized in _FORBIDDEN_INLINE_KEYS:
                return True
            if _stable_ref_has_forbidden_ref_payload(item):
                return True
    elif isinstance(value, list):
        return any(_stable_ref_has_forbidden_ref_payload(item) for item in value)
    elif isinstance(value, str):
        return value.startswith("data:image/") or len(value) > 4096
    return False


def _validation_result(*, schema_version: str | None, errors: list[dict[str, Any]], refs: list[str]) -> dict[str, Any]:
    return {
        "schemaVersion": "sciforge.computer-use.browser-runtime-dom-ax-observation-validation.v1",
        "targetSchemaVersion": schema_version,
        "ok": not errors,
        "status": "accepted" if not errors else "blocked",
        "errors": errors,
        "errorCount": len(errors),
        "refs": refs,
        "hintOnly": not errors,
        "completionEvidenceEligible": False,
    }


def _issue(code: str, message: str, path: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path, **extra}


def _is_current_bundle_ref(ref: str, bundle_root: Path | None = None) -> bool:
    if ref.startswith("/") and bundle_root is not None:
        try:
            Path(ref).resolve().relative_to(bundle_root)
            return True
        except ValueError:
            return False
    return not (
        "://" in ref
        or ref.startswith("/")
        or ref.startswith("~")
        or any(part == ".." for part in ref.replace("\\", "/").split("/"))
    )


def _is_stable_token_ref(ref: str) -> bool:
    if len(ref) > 256:
        return False
    lowered = ref.lower()
    if lowered.startswith(("http:", "https:", "file:", "data:", "javascript:", "blob:", "about:")):
        return False
    if ref.startswith(("/", "~", ".")):
        return False
    if "/" in ref or "\\" in ref:
        return False
    if ref.endswith((".json", ".png", ".jpg", ".jpeg", ".webp", ".html", ".htm", ".txt", ".md")):
        return False
    return True


def _drop_empty(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        str(key): item
        for key, item in value.items()
        if item is not None and item != "" and item != [] and item != {}
    }


def _safe_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, item in value.items():
        normalized = str(key).replace("_", "").replace("-", "").lower()
        if any(token in normalized for token in ("authorization", "credential", "password", "secret", "token")):
            safe[str(key)] = "[REDACTED]"
        elif isinstance(item, Mapping):
            safe[str(key)] = _safe_mapping(item)
        elif isinstance(item, list):
            safe[str(key)] = [_safe_list_item(entry) for entry in item]
        elif isinstance(item, (str, int, float, bool)) or item is None:
            safe[str(key)] = item
        else:
            safe[str(key)] = str(item)
    return safe


def _safe_list_item(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _safe_mapping(value)
    if isinstance(value, list):
        return [_safe_list_item(entry) for entry in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _first_string(value: Any) -> str | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return None
    for item in value:
        if isinstance(item, str) and item.strip():
            return item.strip()
    return None


def _looks_like_path(ref: str) -> bool:
    return ref.startswith("/") or ref.startswith(".") or "/" in ref


__all__ = [
    "BROWSER_RUNTIME_DOM_AX_OBSERVATION_SCHEMA",
    "BROWSER_RUNTIME_GROUNDING_HINT_SCHEMA",
    "build_browser_runtime_dom_ax_observation",
    "build_observe_before_mutate_from_browser_runtime",
    "validate_browser_runtime_dom_ax_observation",
]
