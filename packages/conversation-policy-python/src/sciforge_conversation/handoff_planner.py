from __future__ import annotations

from typing import Any

from ._common import as_list, as_record, digest_text, estimate_bytes, failed_result, first_text, is_record, stable_json, string_list

SCHEMA_VERSION = "sciforge.conversation.handoff-plan.v1"

DEFAULT_HANDOFF_BUDGET: dict[str, int] = {
    "maxPayloadBytes": 220_000,
    "maxInlineStringChars": 12_000,
    "maxInlineJsonBytes": 48_000,
    "maxArrayItems": 24,
    "maxObjectKeys": 80,
    "headChars": 2_000,
    "tailChars": 2_000,
    "maxPriorAttempts": 4,
}

REFERENCE_KEYS = ("ref", "dataRef", "path", "filePath", "markdownRef", "contentRef", "stdoutRef", "stderrRef", "outputRef")


def plan_handoff(request: dict[str, Any]) -> dict[str, Any]:
    """Build a bounded AgentServer handoff plan from policy inputs.

    The planner is deliberately conservative: large values are replaced with
    summaries and durable refs; failed planning returns failed-with-reason rather
    than a partial success envelope.
    """

    budget = {**DEFAULT_HANDOFF_BUDGET, **as_record(request.get("budget"))}
    decisions: list[dict[str, Any]] = []
    required_artifacts = _required_artifacts(request)
    payload = {
        "goal": _compact_value(request.get("goal", {}), budget, decisions, ["goal"]),
        "prompt": _compact_prompt(first_text(request.get("prompt"), as_record(request.get("goal")).get("prompt")), budget, decisions),
        "policy": _compact_value(request.get("policy", {}), budget, decisions, ["policy"]),
        "currentReferenceDigests": _compact_refs(as_list(request.get("currentReferenceDigests") or request.get("digests")), budget, decisions),
        "artifacts": _compact_artifacts(as_list(request.get("artifacts")), budget, decisions),
        "memory": _compact_memory(as_record(request.get("memory")), budget, decisions),
        "requiredArtifacts": required_artifacts,
    }
    payload = {key: value for key, value in payload.items() if value not in (None, {}, [])}
    normalized_bytes = estimate_bytes(payload)

    if normalized_bytes > int(budget["maxPayloadBytes"]):
        decisions.append({
            "kind": "handoff-payload",
            "reason": "payload-budget",
            "estimatedBytes": normalized_bytes,
            "maxPayloadBytes": budget["maxPayloadBytes"],
        })
        payload = _emergency_payload(request, required_artifacts, budget, decisions)
        normalized_bytes = estimate_bytes(payload)

    if normalized_bytes > int(budget["maxPayloadBytes"]):
        return failed_result(
            SCHEMA_VERSION,
            "handoff-budget-exceeded",
            f"Compacted handoff is {normalized_bytes} bytes, above budget {budget['maxPayloadBytes']}.",
            next_actions=[
                "Persist large prompt/artifact inputs behind workspace refs.",
                "Retry with a smaller recent conversation window.",
                "Provide currentReferenceDigests instead of inline source content.",
            ],
        ) | {"budget": budget, "decisions": decisions, "normalizedBytes": normalized_bytes}

    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "ready",
        "ok": True,
        "payload": payload,
        "budget": budget,
        "normalizedBytes": normalized_bytes,
        "decisions": decisions,
        "requiredArtifacts": required_artifacts,
        "auditRefs": _audit_refs(request, payload),
    }


def _required_artifacts(request: dict[str, Any]) -> list[dict[str, Any]]:
    goal = as_record(request.get("goal"))
    raw = request.get("requiredArtifacts", goal.get("requiredArtifacts"))
    artifacts: list[dict[str, Any]] = []
    for item in as_list(raw):
        if isinstance(item, str) and item.strip():
            artifacts.append({"type": item.strip(), "required": True})
        elif is_record(item):
            artifact_type = first_text(item.get("type"), item.get("artifactType"), item.get("id"))
            if artifact_type:
                artifacts.append({
                    "type": artifact_type,
                    "required": item.get("required", True) is not False,
                    "requiresMarkdown": item.get("requiresMarkdown", item.get("markdownRequired", False)) is True,
                    "requiresRef": item.get("requiresRef", item.get("refRequired", True)) is not False,
                })
    required_formats = set(string_list(goal.get("requiredFormats")) + string_list(request.get("requiredFormats")))
    prompt = first_text(request.get("prompt"), goal.get("prompt"), goal.get("summary")) or ""
    if ("markdown" in required_formats or "report" in required_formats or _looks_like_report_request(prompt)) and not any(a["type"] == "research-report" for a in artifacts):
        artifacts.append({"type": "research-report", "required": True, "requiresMarkdown": True, "requiresRef": True})
    return artifacts


def _compact_prompt(prompt: str | None, budget: dict[str, int], decisions: list[dict[str, Any]]) -> Any:
    if not prompt:
        return None
    max_chars = int(budget["maxInlineStringChars"])
    if len(prompt) <= max_chars:
        return prompt
    decisions.append({"kind": "prompt", "reason": "large-string", "rawSha1": digest_text(prompt), "originalChars": len(prompt), "keptChars": budget["headChars"] + budget["tailChars"]})
    return {
        "kind": "text-summary",
        "rawSha1": digest_text(prompt),
        "originalChars": len(prompt),
        "head": prompt[: int(budget["headChars"])],
        "tail": prompt[-int(budget["tailChars"]) :],
    }


def _compact_refs(refs: list[Any], budget: dict[str, int], decisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for index, ref in enumerate(refs[: int(budget["maxArrayItems"])]):
        compact = _compact_value(ref, budget, decisions, ["currentReferenceDigests", str(index)])
        if is_record(compact):
            out.append(compact)
    if len(refs) > int(budget["maxArrayItems"]):
        decisions.append({"kind": "current-reference-digests", "reason": "array-budget", "originalCount": len(refs), "keptCount": budget["maxArrayItems"]})
    return out


def _compact_artifacts(artifacts: list[Any], budget: dict[str, int], decisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for index, item in enumerate(artifacts[: int(budget["maxArrayItems"])]):
        artifact = as_record(item)
        if not artifact:
            continue
        refs = {key: artifact[key] for key in REFERENCE_KEYS if isinstance(artifact.get(key), str) and artifact.get(key)}
        compact = {
            "id": first_text(artifact.get("id"), artifact.get("name"), artifact.get("type")),
            "type": first_text(artifact.get("type"), artifact.get("artifactType")),
            **refs,
            "status": first_text(artifact.get("status"), as_record(artifact.get("metadata")).get("status")),
            "metadata": _compact_value(artifact.get("metadata", {}), budget, decisions, ["artifacts", str(index), "metadata"]),
        }
        data = artifact.get("data")
        if data is not None:
            if refs or estimate_bytes(data) > int(budget["maxInlineJsonBytes"]):
                compact["dataOmitted"] = True
                compact["dataSummary"] = _summary_for(data, "artifact-data")
                decisions.append({"kind": "artifact-data", "reason": "refs-first", "artifactId": compact.get("id"), "estimatedBytes": estimate_bytes(data)})
            else:
                compact["data"] = _compact_value(data, budget, decisions, ["artifacts", str(index), "data"])
        out.append({key: value for key, value in compact.items() if value not in (None, {}, [])})
    if len(artifacts) > int(budget["maxArrayItems"]):
        decisions.append({"kind": "artifacts", "reason": "array-budget", "originalCount": len(artifacts), "keptCount": budget["maxArrayItems"]})
    return out


def _compact_memory(memory: dict[str, Any], budget: dict[str, int], decisions: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("recentConversation", "ledger", "priorAttempts"):
        value = memory.get(key)
        if key == "priorAttempts" and isinstance(value, list) and len(value) > int(budget["maxPriorAttempts"]):
            out[key] = [_compact_value(item, budget, decisions, ["memory", key, str(i)]) for i, item in enumerate(value[-int(budget["maxPriorAttempts"]) :])]
            decisions.append({"kind": "prior-attempts", "reason": "array-budget", "originalCount": len(value), "keptCount": budget["maxPriorAttempts"]})
        else:
            compact = _compact_value(value, budget, decisions, ["memory", key])
            if compact not in (None, {}, []):
                out[key] = compact
    return out


def _compact_value(value: Any, budget: dict[str, int], decisions: list[dict[str, Any]], path: list[str]) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if value.startswith("data:"):
            decisions.append({"kind": "binary", "reason": "data-url", "pointer": "/" + "/".join(path), "rawSha1": digest_text(value)})
            return {"kind": "omitted-binary", "rawSha1": digest_text(value), "originalChars": len(value)}
        if len(value) > int(budget["maxInlineStringChars"]):
            decisions.append({"kind": "string", "reason": "large-string", "pointer": "/" + "/".join(path), "rawSha1": digest_text(value), "originalChars": len(value)})
            return {"kind": "text-summary", "rawSha1": digest_text(value), "originalChars": len(value), "head": value[: int(budget["headChars"])], "tail": value[-int(budget["tailChars"]) :]}
        return value
    if isinstance(value, list):
        kept = [_compact_value(item, budget, decisions, [*path, str(index)]) for index, item in enumerate(value[: int(budget["maxArrayItems"])])]
        if len(value) > int(budget["maxArrayItems"]):
            decisions.append({"kind": "array", "reason": "array-budget", "pointer": "/" + "/".join(path), "originalCount": len(value), "keptCount": budget["maxArrayItems"]})
        return kept
    if is_record(value):
        if estimate_bytes(value) > int(budget["maxInlineJsonBytes"]) and any(isinstance(value.get(key), str) for key in REFERENCE_KEYS):
            return {key: value[key] for key in REFERENCE_KEYS if isinstance(value.get(key), str)}
        entries = list(value.items())[: int(budget["maxObjectKeys"])]
        if len(value) > int(budget["maxObjectKeys"]):
            decisions.append({"kind": "object", "reason": "object-key-budget", "pointer": "/" + "/".join(path), "originalCount": len(value), "keptCount": budget["maxObjectKeys"]})
        return {str(key): _compact_value(nested, budget, decisions, [*path, str(key)]) for key, nested in entries}
    return _summary_for(value, "unknown-value")


def _summary_for(value: Any, reason: str) -> dict[str, Any]:
    encoded = stable_json(value)
    return {"kind": "summary", "reason": reason, "rawSha1": digest_text(encoded), "estimatedBytes": len(encoded.encode("utf-8"))}


def _emergency_payload(request: dict[str, Any], required_artifacts: list[dict[str, Any]], budget: dict[str, int], decisions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "goal": _compact_value(request.get("goal", {}), {**budget, "maxInlineStringChars": 1_000, "maxInlineJsonBytes": 4_000, "maxArrayItems": 8}, decisions, ["goal"]),
        "currentReferenceDigests": _compact_refs(as_list(request.get("currentReferenceDigests") or request.get("digests")), {**budget, "maxInlineStringChars": 1_000, "maxInlineJsonBytes": 4_000, "maxArrayItems": 8}, decisions),
        "requiredArtifacts": required_artifacts,
        "omitted": {"reason": "handoff-budget", "nextActions": ["Use workspace refs for full source material."]},
    }


def _audit_refs(request: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    refs = []
    for item in as_list(request.get("currentReferenceDigests") or request.get("digests")) + as_list(request.get("artifacts")):
        record = as_record(item)
        for key in REFERENCE_KEYS:
            value = record.get(key)
            if isinstance(value, str) and value:
                refs.append(value)
    refs.append(f"handoff-plan:{digest_text(stable_json(payload))[:12]}")
    return list(dict.fromkeys(refs))


def _looks_like_report_request(text: str) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in ("report", "markdown", "summary", "报告", "总结", "综述"))
