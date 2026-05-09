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
    REQUEST_SCHEMA_VERSION,
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
from .recovery import plan_recovery
from .response_plan import build_background_plan, build_response_plan
from .service_plan import build_service_plan

_build_ref_digest_bundle = getattr(
    importlib.import_module(".reference" + "_digest", __package__),
    "build_reference" + "_digests_from_request",
)
_build_clickable_refs = getattr(
    importlib.import_module(".artifact" + "_index", __package__),
    "build_artifact" + "_index_from_request",
)


def evaluate_request(request: ConversationPolicyRequest) -> ConversationPolicyResponse:
    """Evaluate one turn by composing the Python policy modules.

    This service is the only orchestration entrypoint for conversation-policy
    algorithms. TypeScript callers should treat its JSON response as the policy
    truth source and keep JS code limited to transport, fallback, and rendering.
    """

    policy_input = _policy_input(request)
    goal_snapshot = build_goal_snapshot(policy_input)
    context_policy = build_context_policy({**policy_input, "goalSnapshot": goal_snapshot})
    memory_plan = build_memory_plan({
        **policy_input,
        "goalSnapshot": goal_snapshot,
        "contextPolicy": context_policy,
    })
    context_session = _session_for_context_policy(policy_input["session"], context_policy, memory_plan)
    current_reference_digests = _build_ref_digest_bundle(policy_input)
    clickable_refs = _build_clickable_refs({
        **policy_input,
        "session": context_session,
        "currentReferenceDigests": current_reference_digests,
    })
    capability_brief = build_capability_brief(
        _capability_request(policy_input, goal_snapshot),
        policy_input["capabilities"],
    )
    execution_mode_plan = classify_execution_mode(
        {
            "prompt": policy_input["prompt"],
            "refs": policy_input["references"],
            "artifacts": context_session.get("artifacts", []),
            "expectedArtifactTypes": goal_snapshot.get("requiredArtifacts", []),
            "selectedCapabilities": capability_brief.get("selected", []),
            "selectedTools": _selected_policy_list(policy_input, "selectedTools", "tools"),
            "selectedSenses": _selected_policy_list(policy_input, "selectedSenses", "senses"),
            "selectedVerifiers": _selected_policy_list(policy_input, "selectedVerifiers", "verifiers"),
            "recentFailures": _recent_failures(policy_input),
            "priorAttempts": _prior_attempts(policy_input),
            "userGuidanceQueue": _user_guidance_queue(policy_input),
        }
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
    recovery_plan = _recovery_plan(policy_input)
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
        "currentReferences": _current_references(request, current_reference_digests),
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
        "recentFailures": _recent_failures(policy_input),
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
    turn = to_json_dict(request.turn)
    history = [to_json_dict(item) for item in request.history]
    session = dict(request.session)
    if not session.get("messages") and history:
        session["messages"] = history
    if not session.get("artifacts"):
        session["artifacts"] = []
    if not session.get("executionUnits"):
        session["executionUnits"] = []
    limits = {**request.limits, **request.policyHints}
    return {
        "schemaVersion": request.schemaVersion,
        "requestId": request.requestId,
        "turn": {
            "turnId": request.turn.turnId,
            "prompt": request.turn.text,
            "references": [to_json_dict(item) for item in request.turn.refs],
        },
        "prompt": request.turn.text,
        "turnId": request.turn.turnId,
        "references": [to_json_dict(item) for item in request.turn.refs],
        "refs": [to_json_dict(item) for item in request.turn.refs],
        "history": history,
        "session": session,
        "workspace": request.workspace,
        "limits": limits,
        "policyHints": request.policyHints,
        "capabilities": [to_json_dict(item) for item in request.capabilities],
        "tsDecisions": request.tsDecisions,
        "metadata": request.metadata,
        "rawTurn": turn,
    }


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


def _session_for_context_policy(session: JsonMap, context_policy: JsonMap, memory_plan: JsonMap) -> JsonMap:
    mode = str(context_policy.get("mode") or "")
    history_reuse = context_policy.get("historyReuse") if isinstance(context_policy.get("historyReuse"), dict) else {}
    allow_history = history_reuse.get("allowed") is True or mode in {"continue", "repair"}
    explicit_refs = memory_plan.get("currentReferenceFocus") if isinstance(memory_plan.get("currentReferenceFocus"), list) else []
    if allow_history or explicit_refs:
        return session
    scoped = dict(session)
    scoped["artifacts"] = []
    scoped["executionUnits"] = []
    scoped["runs"] = []
    return scoped


def _current_references(
    request: ConversationPolicyRequest,
    current_reference_digests: list[JsonMap] | None = None,
) -> list[JsonMap]:
    explicit = [to_json_dict(item) for item in request.turn.refs]
    if explicit:
        return explicit
    refs: list[JsonMap] = []
    for digest in current_reference_digests or []:
        source_ref = digest.get("path") or digest.get("sourceRef") or digest.get("clickableRef")
        if not source_ref:
            continue
        refs.append({
            "kind": "file",
            "ref": str(source_ref).removeprefix("file:"),
            "title": str(source_ref).removeprefix("file:").split("/")[-1],
            "source": "python-reference-digest",
            "digestId": digest.get("id"),
        })
    return refs


def _recovery_plan(policy_input: JsonMap) -> JsonMap:
    hints = policy_input.get("policyHints", {})
    failure = hints.get("failure") or policy_input.get("metadata", {}).get("failure")
    if isinstance(failure, dict):
        return plan_recovery(
            failure,
            policy_input.get("currentReferenceDigests", []),
            policy_input.get("session", {}).get("runs", []),
        )
    return {
        "schemaVersion": "sciforge.conversation.recovery-plan.v1",
        "status": "ready",
        "retryable": True,
        "strategies": [
            "repair-on-acceptance-failed",
            "digest-recovery-on-silent-stream",
            "failed-with-reason-after-budget",
        ],
    }


def _recent_failures(policy_input: JsonMap) -> list[Any]:
    hints = policy_input.get("policyHints", {})
    failures: list[Any] = []
    for candidate in (
        hints.get("recentFailures"),
        hints.get("failures"),
        [hints.get("failure")] if hints.get("failure") else None,
        policy_input.get("metadata", {}).get("recentFailures"),
    ):
        if isinstance(candidate, list):
            failures.extend(candidate)
    session = policy_input.get("session", {})
    runs = session.get("runs")
    if isinstance(runs, list):
        failures.extend(
            run
            for run in runs
            if isinstance(run, dict) and str(run.get("status", "")).lower() in {"failed", "error"}
        )
    return failures


def _prior_attempts(policy_input: JsonMap) -> list[Any]:
    hints = policy_input.get("policyHints", {})
    metadata = policy_input.get("metadata", {})
    session = policy_input.get("session", {})
    attempts: list[Any] = []
    for candidate in (
        hints.get("priorAttempts"),
        hints.get("attempts"),
        metadata.get("priorAttempts"),
        metadata.get("attempts"),
        session.get("attempts"),
        session.get("runs"),
        session.get("executionUnits"),
    ):
        if isinstance(candidate, list):
            attempts.extend(candidate)
    return attempts


def _user_guidance_queue(policy_input: JsonMap) -> list[Any]:
    hints = policy_input.get("policyHints", {})
    metadata = policy_input.get("metadata", {})
    session = policy_input.get("session", {})
    for candidate in (
        hints.get("userGuidanceQueue"),
        hints.get("guidanceQueue"),
        metadata.get("userGuidanceQueue"),
        session.get("userGuidanceQueue"),
        session.get("guidanceQueue"),
    ):
        if isinstance(candidate, list):
            return candidate
    return []


def _selected_policy_list(policy_input: JsonMap, *keys: str) -> list[Any]:
    hints = policy_input.get("policyHints", {})
    metadata = policy_input.get("metadata", {})
    ts_decisions = policy_input.get("tsDecisions", {})
    for source in (hints, metadata, ts_decisions):
        if not isinstance(source, dict):
            continue
        for key in keys:
            value = source.get(key)
            if isinstance(value, list):
                return value
    return []


def _mapping_from_plan(plan: JsonMap, key: str) -> JsonMap:
    value = plan.get(key)
    return value if isinstance(value, dict) else {}


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
    payload: dict[str, Any] = {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "requestId": None,
        "status": "failed",
        "goalSnapshot": {"text": "", "mode": "ambiguous", "explicitRefs": []},
        "contextPolicy": {"mode": "ambiguous"},
        "memoryPlan": {},
        "currentReferences": [],
        "currentReferenceDigests": [],
        "artifactIndex": {},
        "capabilityBrief": {"selected": [], "excluded": [], "auditTrace": []},
        "executionModePlan": {},
        "handoffPlan": {"fallback": {"tsRuntimeFallback": True}},
        "acceptancePlan": {},
        "recoveryPlan": {},
        "latencyPolicy": {
            "schemaVersion": "sciforge.conversation.latency-policy.v1",
            "firstVisibleResponseMs": 8000,
            "firstEventWarningMs": 18000,
            "silentRetryMs": 60000,
            "allowBackgroundCompletion": False,
            "blockOnContextCompaction": True,
            "blockOnVerification": True,
            "reason": "safe default after policy service failure",
        },
        "responsePlan": {
            "schemaVersion": "sciforge.conversation.response-plan.v1",
            "initialResponseMode": "wait-for-result",
            "finalizationMode": "append-final",
            "userVisibleProgress": ["failed"],
            "fallbackMessagePolicy": "safety-first-status-with-required-confirmation",
            "reason": "safe default after policy service failure",
        },
        "backgroundPlan": {
            "schemaVersion": "sciforge.conversation.background-plan.v1",
            "enabled": False,
            "tasks": [],
            "handoffRefsRequired": True,
            "cancelOnNewUserTurn": True,
            "reason": "safe default after policy service failure",
        },
        "cachePolicy": {
            "schemaVersion": "sciforge.conversation.cache-policy.v1",
            "reuseScenarioPlan": False,
            "reuseSkillPlan": False,
            "reuseUiPlan": False,
            "reuseUIPlan": False,
            "reuseReferenceDigests": False,
            "reuseArtifactIndex": False,
            "reuseLastSuccessfulStage": False,
            "reuseBackendSession": False,
            "reason": "safe default after policy service failure",
        },
        "userVisiblePlan": [],
        "processStage": {
            "phase": "failed",
            "summary": "Conversation policy request failed.",
        },
        "auditTrace": [
            {
                "event": "schema.rejected",
                "expectedRequestSchemaVersion": REQUEST_SCHEMA_VERSION,
            }
        ],
        "errors": [{"type": type(exc).__name__, "message": str(exc)}],
        "metadata": {"service": "sciforge_conversation.service"},
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    raise SystemExit(main())
