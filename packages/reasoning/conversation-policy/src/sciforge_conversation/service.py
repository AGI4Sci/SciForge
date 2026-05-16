"""CLI and stdio JSON service for SciForge conversation policy."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable
from typing import Any, TextIO

from .batch import run_policy_batch
from .capability_broker import build_capability_brief
from .contracts import (
    RESPONSE_SCHEMA_VERSION,
    ConversationPolicyRequest,
    ConversationPolicyResponse,
    JsonMap,
    ProcessStage,
    request_from_json,
    to_json_dict,
)
from .execution_classifier import classify_execution_mode
from .goal_snapshot import build_goal_snapshot
from .service_plan import build_error_response


def evaluate_request(request: ConversationPolicyRequest) -> ConversationPolicyResponse:
    """Evaluate one turn through package-local policies.

    Architecture: Python handles pure-logic steps (goal_snapshot, capability_broker,
    execution_classifier), then delegates all TypeScript-owned policy computations to a
    single batch tsx subprocess via batch.run_policy_batch(). This replaces 11+ separate
    tsx subprocess spawns (~3 seconds) with one call (~0.3 seconds).
    """

    policy_input_seed = _policy_input_seed(request)

    # --- Python-owned steps (no subprocess) ---
    goal_snapshot = build_goal_snapshot(policy_input_seed)
    capability_brief = build_capability_brief(
        _capability_request(policy_input_seed, goal_snapshot),
        policy_input_seed.get("capabilities") or [],
    )

    # --- TypeScript batch (single tsx subprocess) ---
    batch_input: JsonMap = {
        "request": _jsonable(request),
        "goalSnapshot": goal_snapshot,
        "capabilityBrief": capability_brief,
        "handoffBudget": _handoff_budget(policy_input_seed),
        "turnExecutionConstraints": goal_snapshot.get("turnExecutionConstraints") or {},
    }
    batch = run_policy_batch(batch_input)

    policy_input = batch.get("policyInput") or {}
    context_policy = batch.get("contextPolicy") or {}
    context_projection = batch.get("contextProjection") or {}
    current_reference_digests = batch.get("currentReferenceDigests") or []
    artifact_index = batch.get("artifactIndex") or {}
    turn_composition = batch.get("turnComposition") or {}
    handoff_plan = batch.get("handoffPlan") or {}
    recovery_plan = batch.get("recoveryPlan") or {}
    latency_policy = batch.get("latencyPolicy") or {}
    response_plan = batch.get("responsePlan") or {}
    background_plan = batch.get("backgroundPlan") or {}
    cache_policy = batch.get("cachePolicy") or {}
    service_plan = batch.get("servicePlan") or {}
    current_references = batch.get("currentReferences") or []

    # execution_classifier is pure Python – run after batch so it has turn_composition data
    execution_mode_plan = classify_execution_mode(
        _mapping_from_plan(turn_composition, "executionClassifierInput")
    )

    turn_execution_constraints = _turn_execution_constraints(policy_input_seed, goal_snapshot)
    direct_context_decision = _direct_context_decision(
        execution_mode_plan,
        turn_execution_constraints,
        current_references,
        current_reference_digests,
        _coerce_list((policy_input_seed.get("session") or {}).get("artifacts") if isinstance(policy_input_seed.get("session"), dict) else []),
        _coerce_list((policy_input_seed.get("session") or {}).get("runs") if isinstance(policy_input_seed.get("session"), dict) else []),
        _coerce_list((policy_input_seed.get("session") or {}).get("messages") if isinstance(policy_input_seed.get("session"), dict) else []),
        _plain_list_from_plan(turn_composition, "recentFailures"),
    )
    if direct_context_decision.get("allowDirectContext") is True:
        response_plan = {
            **response_plan,
            "schemaVersion": response_plan.get("schemaVersion", "sciforge.conversation.response-plan.v1"),
            "initialResponseMode": "direct-context-answer",
            "finalizationMode": response_plan.get("finalizationMode", "replace-draft"),
            "userVisibleProgress": ["answer"],
            "progressPhases": ["answer"],
            "fallbackMessagePolicy": "truthful-direct-answer-with-current-refs",
            "reason": "direct-context decision can answer from explicit current refs without workspace execution",
        }
        latency_policy = {
            **latency_policy,
            "schemaVersion": latency_policy.get("schemaVersion", "sciforge.conversation.latency-policy.v1"),
            "allowBackgroundCompletion": False,
            "blockOnContextCompaction": False,
            "blockOnVerification": latency_policy.get("blockOnVerification", False),
            "reason": "direct-context decision uses existing current refs",
        }
    acceptance_plan = _mapping_from_plan(service_plan, "acceptancePlan")
    harness_contract = {
        "executionModePlan": execution_mode_plan,
        "contextPolicy": context_policy,
        "capabilityBrief": capability_brief,
        "handoffPlan": handoff_plan,
        "latencyPolicy": latency_policy,
        "directContextDecision": direct_context_decision,
    }

    response = ConversationPolicyResponse(
        requestId=request.requestId,
        goalSnapshot=goal_snapshot,
        contextPolicy=context_policy,
        contextProjection=context_projection,
        currentReferences=current_references,
        currentReferenceDigests=current_reference_digests,
        artifactIndex=artifact_index,
        capabilityBrief=capability_brief,
        directContextDecision=direct_context_decision,
        harnessContract=harness_contract,
        executionModePlan=execution_mode_plan,
        turnExecutionConstraints=turn_execution_constraints,
        handoffPlan=handoff_plan,
        acceptancePlan=acceptance_plan,
        recoveryPlan=recovery_plan,
        latencyPolicy=latency_policy,
        responsePlan=response_plan,
        backgroundPlan=background_plan,
        cachePolicy=cache_policy,
        userVisiblePlan=_mapping_list_from_plan(service_plan, "userVisiblePlan"),
        processStage=_process_stage_from_plan(service_plan),
        auditTrace=_mapping_list_from_plan(service_plan, "auditTrace"),
        metadata=_mapping_from_plan(service_plan, "metadata"),
    )
    return response


def handle_payload(payload: JsonMap) -> JsonMap:
    request = request_from_json(payload)
    return to_json_dict(evaluate_request(request))


def handle_text(text: str) -> str:
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("request payload must be a JSON object")
    return json.dumps(handle_payload(payload), ensure_ascii=False, separators=(",", ":"))


def run_stdio(stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> int:
    data = stdin.read()
    if not data.strip():
        return 0

    chunks = _json_chunks(data)
    for chunk in chunks:
        try:
            stdout.write(handle_text(chunk))
        except Exception as exc:  # stdio service should report structured failures.
            stdout.write(_error_response(exc))
        stdout.write("\n")
        stdout.flush()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SciForge conversation policy JSON service")
    parser.add_argument(
        "--print-schema",
        choices=["request", "response"],
        help="Print the versioned JSON schema and exit.",
    )
    args = parser.parse_args(argv)

    if args.print_schema == "request":
        from .contracts import REQUEST_JSON_SCHEMA

        print(json.dumps(REQUEST_JSON_SCHEMA, indent=2, sort_keys=True))
        return 0
    if args.print_schema == "response":
        from .contracts import RESPONSE_JSON_SCHEMA

        print(json.dumps(RESPONSE_JSON_SCHEMA, indent=2, sort_keys=True))
        return 0

    return run_stdio()


def _json_chunks(data: str) -> Iterable[str]:
    stripped = data.strip()
    if not stripped:
        return []
    try:
        json.loads(stripped)
        return [stripped]
    except json.JSONDecodeError:
        pass
    if "\n" not in stripped:
        return [stripped]
    return [line for line in (item.strip() for item in data.splitlines()) if line]


def _policy_input_seed(request: ConversationPolicyRequest) -> JsonMap:
    """Lightweight extraction for the Python-owned steps before the batch call."""
    session = _get(request, "session") or {}
    turn = _get(request, "turn") or {}
    prompt = _text(_get(turn, "text") or _get(turn, "prompt") or _get(request, "prompt") or "")
    references = _coerce_list(
        _get(turn, "refs")
        or _get(turn, "references")
        or _get(request, "references")
        or _get(request, "refs")
        or []
    )
    return {
        "prompt": prompt,
        "references": references,
        "refs": references,
        "session": session,
        "capabilities": _coerce_list(_get(request, "capabilities") or []),
        "limits": _get(request, "limits") or {},
        "workspace": _get(request, "workspace") or {},
        "policyHints": _get(request, "policyHints") or {},
        "metadata": _get(request, "metadata") or {},
    }


def _direct_context_decision(
    execution_mode_plan: JsonMap,
    turn_execution_constraints: JsonMap,
    current_references: list[JsonMap],
    current_reference_digests: list[JsonMap],
    session_artifacts: list[Any],
    session_runs: list[Any],
    session_messages: list[Any],
    recent_failures: list[Any],
) -> JsonMap:
    reasons: list[str] = []
    if execution_mode_plan.get("executionMode") != "direct-context-answer" or not _direct_context_constraints(turn_execution_constraints):
        reasons.append("execution-not-forbidden")
    used_refs = _unique_strings([
        *(_string_field(ref.get("ref")) for ref in current_references if isinstance(ref, dict)),
        *(_string_field(digest.get("ref")) for digest in current_reference_digests if isinstance(digest, dict)),
        *(_string_field(digest.get("sourceRef")) for digest in current_reference_digests if isinstance(digest, dict)),
        *(_session_artifact_ref(artifact) for artifact in session_artifacts),
        *(_session_run_ref(run) for run in session_runs),
        *(_session_message_ref(message) for message in session_messages),
    ])
    if not used_refs:
        reasons.append("no-prior-context")
        reasons.append("evidence-missing")
    intent = _direct_context_intent(used_refs, current_references, recent_failures)
    if reasons:
        return _negative_direct_context_decision(used_refs, intent, reasons)
    return {
        "schemaVersion": "sciforge.direct-context-decision.v1",
        "decisionRef": f"decision:conversation-policy:{_stable_ref_suffix(used_refs)}",
        "decisionOwner": "harness-policy",
        "intent": intent,
        "requiredTypedContext": _required_typed_context(intent),
        "usedRefs": used_refs,
        "sufficiency": "sufficient",
        "allowDirectContext": True,
    }


def _negative_direct_context_decision(used_refs: list[str], intent: str, reasons: list[str]) -> JsonMap:
    unique_reasons = _unique_strings(reasons)
    return {
        "schemaVersion": "sciforge.direct-context-decision.v1",
        "decisionRef": f"decision:conversation-policy:{_stable_ref_suffix(used_refs or unique_reasons or ['negative'])}",
        "decisionOwner": "harness-policy",
        "intent": intent,
        "requiredTypedContext": _required_typed_context(intent),
        "usedRefs": used_refs,
        "sufficiency": "insufficient",
        "allowDirectContext": False,
        "reasons": unique_reasons,
        "blockReason": "; ".join(unique_reasons),
    }


def _direct_context_constraints(turn_execution_constraints: JsonMap) -> bool:
    return bool(
        turn_execution_constraints.get("contextOnly") is True
        or turn_execution_constraints.get("agentServerForbidden") is True
        or turn_execution_constraints.get("workspaceExecutionForbidden") is True
        or turn_execution_constraints.get("executionModeHint") == "direct-context-answer"
    )


def _direct_context_intent(used_refs: list[str], current_references: list[JsonMap], recent_failures: list[Any]) -> str:
    kinds = {
        str(ref.get("kind") or "").strip().lower()
        for ref in current_references
        if isinstance(ref, dict)
    }
    if recent_failures or any(ref.startswith(("execution-unit:", "run:")) for ref in used_refs) or "execution-unit" in kinds or "run" in kinds:
        return "run-diagnostic"
    if any(ref.startswith("artifact:") for ref in used_refs) or "artifact" in kinds or "task-result" in kinds:
        return "artifact-status"
    return "context-summary"


def _required_typed_context(intent: str) -> list[str]:
    if intent == "run-diagnostic":
        return ["run-trace", "execution-units", "failure-evidence"]
    if intent == "artifact-status":
        return ["artifact-index", "object-references", "current-refs"]
    return ["current-session-context"]


def _stable_ref_suffix(refs: list[str]) -> str:
    value = 2166136261
    for char in "|".join(refs):
        value ^= ord(char)
        value = (value * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def _session_artifact_ref(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    explicit = _string_field(value.get("ref")) or _string_field(value.get("dataRef")) or _string_field(value.get("path"))
    if explicit:
        return explicit
    artifact_id = _string_field(value.get("id"))
    return f"artifact:{artifact_id}" if artifact_id else None


def _session_run_ref(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    run_id = _string_field(value.get("id")) or _string_field(value.get("runId"))
    return f"run:{run_id}" if run_id else None


def _session_message_ref(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    message_id = _string_field(value.get("id")) or _string_field(value.get("messageId"))
    return f"message:{message_id}" if message_id else None


def _string_field(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _unique_strings(values: Iterable[str | None]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _capability_request(policy_input: JsonMap, goal_snapshot: JsonMap) -> JsonMap:
    hints = policy_input.get("policyHints") or {}
    if not isinstance(hints, dict):
        hints = {}
    limits = policy_input.get("limits") or {}
    if not isinstance(limits, dict):
        limits = {}
    session = policy_input.get("session") or {}
    if not isinstance(session, dict):
        session = {}
    return {
        "prompt": policy_input.get("prompt", ""),
        "goal": " ".join([
            str(goal_snapshot.get("goalType", "")),
            str(goal_snapshot.get("normalizedPrompt", "")),
        ]),
        "refs": policy_input.get("references", []),
        "scenario": str(session.get("scenarioId") or policy_input.get("skillDomain") or ""),
        "riskTolerance": hints.get("riskTolerance", "medium"),
        "costBudget": hints.get("costBudget", "medium"),
        "latencyBudget": hints.get("latencyBudget", "batch"),
        "topK": int(hints.get("maxCapabilities") or limits.get("maxCapabilities") or 8),
        "expectedArtifacts": goal_snapshot.get("requiredArtifacts", []),
        "explicitCapabilityIds": hints.get("explicitCapabilityIds", []),
        "availableConfig": hints.get("availableConfig", {}),
        "history": hints.get("capabilityHistory", {}),
    }


def _turn_execution_constraints(policy_input: JsonMap, goal_snapshot: JsonMap) -> JsonMap:
    constraints = goal_snapshot.get("turnExecutionConstraints")
    if isinstance(constraints, dict):
        return constraints
    ts_decisions = policy_input.get("tsDecisions") or {}
    if isinstance(ts_decisions, dict) and isinstance(ts_decisions.get("turnExecutionConstraints"), dict):
        return ts_decisions["turnExecutionConstraints"]
    return {}


def _handoff_budget(policy_input: JsonMap) -> JsonMap:
    limits = policy_input.get("limits") or {}
    if not isinstance(limits, dict):
        limits = {}
    return {
        key: value
        for key, value in {
            "maxPayloadBytes": limits.get("maxPayloadBytes"),
            "maxInlineStringChars": limits.get("maxInlineChars"),
            "maxArrayItems": limits.get("maxArrayItems"),
        }.items()
        if value is not None
    }


def _mapping_from_plan(plan: Any, key: str) -> JsonMap:
    value = plan.get(key) if isinstance(plan, dict) else None
    return value if isinstance(value, dict) else {}


def _mapping_list_from_plan(plan: Any, key: str) -> list[JsonMap]:
    value = plan.get(key) if isinstance(plan, dict) else None
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _plain_list_from_plan(plan: Any, key: str) -> list[Any]:
    value = _get(plan, key)
    return value if isinstance(value, list) else []


def _process_stage_from_plan(plan: Any) -> ProcessStage:
    stage = _mapping_from_plan(plan, "processStage")
    return ProcessStage(
        phase=stage.get("phase", "planning"),
        summary=stage.get("summary", "Conversation policy request accepted."),
        visibleDetail=stage.get("visibleDetail"),
        metadata=stage.get("metadata") if isinstance(stage.get("metadata"), dict) else {},
    )


def _error_response(exc: Exception) -> str:
    payload = build_error_response({
        "error": {"type": type(exc).__name__, "message": str(exc)},
    })
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _jsonable(value: Any) -> Any:
    from dataclasses import asdict, is_dataclass
    if is_dataclass(value):
        return asdict(value)
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _coerce_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


if __name__ == "__main__":
    raise SystemExit(main())
