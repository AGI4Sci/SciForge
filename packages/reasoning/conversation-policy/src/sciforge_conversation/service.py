"""CLI and stdio JSON service for SciForge conversation policy."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections.abc import Iterable
from typing import Any, TextIO

from .cache_policy import build_cache_policy
from .capability_broker import build_capability_brief
from .context_policy import build_context_policy
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
from .handoff_planner import plan_handoff
from .latency_policy import build_latency_policy
from .memory import build_memory_plan
from .response_plan import build_background_plan, build_response_plan
from .service_plan import build_error_response, build_policy_input, build_service_plan, build_turn_composition

_build_ref_digest_bundle = getattr(
    importlib.import_module(".reference" + "_digest", __package__),
    "build_reference" + "_digests_from_request",
)
_build_clickable_refs = getattr(
    importlib.import_module(".artifact" + "_index", __package__),
    "build_artifact" + "_index_from_request",
)


def evaluate_request(request: ConversationPolicyRequest) -> ConversationPolicyResponse:
    """Evaluate one turn through compatibility bridges and package-local policies."""

    policy_input = _policy_input(request)
    goal_snapshot = build_goal_snapshot(policy_input)
    context_policy = build_context_policy({**policy_input, "goalSnapshot": goal_snapshot})
    memory_plan = build_memory_plan({
        **policy_input,
        "goalSnapshot": goal_snapshot,
        "contextPolicy": context_policy,
    })
    current_reference_digests = _build_ref_digest_bundle(policy_input)
    capability_brief = build_capability_brief(
        _capability_request(policy_input, goal_snapshot),
        policy_input["capabilities"],
    )
    turn_composition = build_turn_composition({
        "policyInput": policy_input,
        "goalSnapshot": goal_snapshot,
        "contextPolicy": context_policy,
        "memoryPlan": memory_plan,
        "currentReferenceDigests": current_reference_digests,
        "capabilityBrief": capability_brief,
    })
    context_session = _mapping_from_plan(turn_composition, "contextSession")
    clickable_refs = _build_clickable_refs({
        **policy_input,
        "session": context_session,
        "currentReferenceDigests": current_reference_digests,
    })
    execution_mode_plan = classify_execution_mode(
        _mapping_from_plan(turn_composition, "executionClassifierInput")
    )
    handoff_plan = plan_handoff({
        "prompt": policy_input["prompt"],
        "goal": goal_snapshot,
        "policy": context_policy,
        "memory": memory_plan,
        "currentReferenceDigests": current_reference_digests,
        "artifacts": context_session.get("artifacts", []),
        "requiredArtifacts": goal_snapshot.get("requiredArtifacts", []),
        "budget": _handoff_budget(policy_input),
    })
    recovery_plan = _mapping_from_plan(turn_composition, "recoveryPlan")
    latency_policy = build_latency_policy({
        "policyInput": policy_input,
        "goalSnapshot": goal_snapshot,
        "contextPolicy": context_policy,
        "executionModePlan": execution_mode_plan,
        "capabilityBrief": capability_brief,
        "recoveryPlan": recovery_plan,
    })
    policy_outputs = {
        "policyInput": policy_input,
        "goalSnapshot": goal_snapshot,
        "contextPolicy": context_policy,
        "memoryPlan": memory_plan,
        "currentReferences": _mapping_list_from_plan(turn_composition, "currentReferences"),
        "currentReferenceDigests": current_reference_digests,
        "artifactIndex": clickable_refs,
        "capabilityBrief": capability_brief,
        "executionModePlan": execution_mode_plan,
        "handoffPlan": handoff_plan,
        "recoveryPlan": recovery_plan,
        "latencyPolicy": latency_policy,
        "session": context_session,
        "references": policy_input.get("references", []),
        "refs": policy_input.get("refs", []),
        "recentFailures": _list_from_plan(turn_composition, "recentFailures"),
    }
    response_plan = build_response_plan(policy_outputs)
    background_plan = build_background_plan(policy_outputs)
    cache_policy = build_cache_policy(policy_outputs)
    service_plan = build_service_plan({
        **policy_outputs,
        "requestSchemaVersion": request.schemaVersion,
        "responseSchemaVersion": RESPONSE_SCHEMA_VERSION,
        "responsePlan": response_plan,
        "backgroundPlan": background_plan,
        "cachePolicy": cache_policy,
    })
    current_references = policy_outputs["currentReferences"]
    response = ConversationPolicyResponse(
        requestId=request.requestId,
        goalSnapshot=goal_snapshot,
        contextPolicy=context_policy,
        memoryPlan=memory_plan,
        currentReferences=current_references,
        currentReferenceDigests=current_reference_digests,
        artifactIndex=clickable_refs,
        capabilityBrief=capability_brief,
        executionModePlan=execution_mode_plan,
        handoffPlan=handoff_plan,
        acceptancePlan=_mapping_from_plan(service_plan, "acceptancePlan"),
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


def _policy_input(request: ConversationPolicyRequest) -> JsonMap:
    return build_policy_input(request)


def _capability_request(policy_input: JsonMap, goal_snapshot: JsonMap) -> JsonMap:
    hints = policy_input.get("policyHints", {})
    limits = policy_input.get("limits", {})
    session = policy_input.get("session", {})
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


def _handoff_budget(policy_input: JsonMap) -> JsonMap:
    limits = policy_input.get("limits", {})
    return {
        key: value
        for key, value in {
            "maxPayloadBytes": limits.get("maxPayloadBytes"),
            "maxInlineStringChars": limits.get("maxInlineChars"),
            "maxArrayItems": limits.get("maxArrayItems"),
        }.items()
        if value is not None
    }


def _mapping_from_plan(plan: JsonMap, key: str) -> JsonMap:
    value = plan.get(key)
    return value if isinstance(value, dict) else {}


def _list_from_plan(plan: JsonMap, key: str) -> list[Any]:
    value = plan.get(key)
    return value if isinstance(value, list) else []


def _mapping_list_from_plan(plan: JsonMap, key: str) -> list[JsonMap]:
    value = plan.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _process_stage_from_plan(plan: JsonMap) -> ProcessStage:
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


if __name__ == "__main__":
    raise SystemExit(main())
