"""Versioned JSON contracts for SciForge conversation policy.

The contracts intentionally use only the Python standard library so the package
can run in mirror mode from TypeScript without importing app-private modules.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal


JsonMap = dict[str, Any]

REQUEST_SCHEMA_VERSION = "sciforge.conversation-policy.request.v1"
RESPONSE_SCHEMA_VERSION = "sciforge.conversation-policy.response.v1"

PolicyStatus = Literal["ok", "rejected", "failed"]
ConversationMode = Literal[
    "new_task",
    "continue_previous",
    "repair_previous",
    "ambiguous",
    "isolate",
    "continue",
    "repair",
    "new-task",
]
CapabilityRisk = Literal["low", "medium", "high"]


REQUEST_JSON_SCHEMA: JsonMap = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": REQUEST_SCHEMA_VERSION,
    "type": "object",
    "required": ["schemaVersion", "turn"],
    "properties": {
        "schemaVersion": {"const": REQUEST_SCHEMA_VERSION},
        "requestId": {"type": ["string", "null"]},
        "turn": {"type": "object"},
        "history": {"type": "array"},
        "session": {"type": "object"},
        "capabilities": {"type": "array"},
        "policyHints": {"type": "object"},
        "limits": {"type": "object"},
        "tsDecisions": {"type": "object"},
        "metadata": {"type": "object"},
    },
}

RESPONSE_JSON_SCHEMA: JsonMap = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": RESPONSE_SCHEMA_VERSION,
    "type": "object",
    "required": ["schemaVersion", "status", "goalSnapshot", "contextPolicy"],
    "properties": {
        "schemaVersion": {"const": RESPONSE_SCHEMA_VERSION},
        "requestId": {"type": ["string", "null"]},
        "status": {"enum": ["ok", "rejected", "failed"]},
        "goalSnapshot": {"type": "object"},
        "contextPolicy": {"type": "object"},
        "memoryPlan": {"type": "object"},
        "currentReferences": {"type": "array"},
        "currentReferenceDigests": {"type": "array"},
        "artifactIndex": {"type": "object"},
        "capabilityBrief": {"type": "object"},
        "executionModePlan": {"type": "object"},
        "handoffPlan": {"type": "object"},
        "acceptancePlan": {"type": "object"},
        "recoveryPlan": {"type": "object"},
        "latencyPolicy": {"type": "object"},
        "responsePlan": {"type": "object"},
        "backgroundPlan": {"type": "object"},
        "cachePolicy": {"type": "object"},
        "userVisiblePlan": {"type": "array"},
        "processStage": {"type": "object"},
        "auditTrace": {"type": "array"},
        "errors": {"type": "array"},
        "metadata": {"type": "object"},
    },
}


@dataclass(slots=True)
class Reference:
    kind: str
    ref: str
    title: str | None = None
    mimeType: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ConversationTurn:
    role: Literal["user", "assistant", "system", "tool"]
    text: str = ""
    turnId: str | None = None
    refs: list[Reference] = field(default_factory=list)
    artifacts: list[JsonMap] = field(default_factory=list)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class CapabilityManifest:
    id: str
    title: str
    kind: str = "tool"
    description: str = ""
    summary: str = ""
    keywords: list[str] = field(default_factory=list)
    domain: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    antiTriggers: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    inputTypes: list[str] = field(default_factory=list)
    outputTypes: list[str] = field(default_factory=list)
    riskLevel: CapabilityRisk = "low"
    risk: list[str] = field(default_factory=list)
    sideEffects: list[str] = field(default_factory=list)
    cost: str | None = None
    latency: str | None = None
    adapter: str | None = None
    internalAgent: bool | str = False
    costHint: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ConversationPolicyRequest:
    turn: ConversationTurn
    schemaVersion: str = REQUEST_SCHEMA_VERSION
    requestId: str | None = None
    history: list[ConversationTurn] = field(default_factory=list)
    capabilities: list[CapabilityManifest] = field(default_factory=list)
    session: JsonMap = field(default_factory=dict)
    policyHints: JsonMap = field(default_factory=dict)
    workspace: JsonMap = field(default_factory=dict)
    limits: JsonMap = field(default_factory=dict)
    tsDecisions: JsonMap = field(default_factory=dict)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class GoalSnapshot:
    text: str
    mode: ConversationMode = "new_task"
    explicitRefs: list[Reference] = field(default_factory=list)
    acceptanceHints: list[str] = field(default_factory=list)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ContextPolicy:
    mode: ConversationMode
    includeHistoryTurns: list[str] = field(default_factory=list)
    excludedHistoryReasons: list[JsonMap] = field(default_factory=list)
    maxPromptTokens: int | None = None
    referencePolicy: JsonMap = field(default_factory=dict)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class CapabilityBrief:
    id: str
    title: str
    reason: str
    riskLevel: CapabilityRisk = "low"
    internalAgent: bool = False
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class HandoffPlan:
    requiredArtifacts: list[str] = field(default_factory=list)
    budget: JsonMap = field(default_factory=dict)
    fallback: JsonMap = field(default_factory=dict)
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ProcessStage:
    phase: Literal["received", "planning", "running", "waiting", "done", "failed"] = "planning"
    summary: str = "Conversation policy request accepted."
    visibleDetail: str | None = None
    metadata: JsonMap = field(default_factory=dict)


@dataclass(slots=True)
class ConversationPolicyResponse:
    goalSnapshot: JsonMap
    contextPolicy: JsonMap
    schemaVersion: str = RESPONSE_SCHEMA_VERSION
    requestId: str | None = None
    status: PolicyStatus = "ok"
    memoryPlan: JsonMap = field(default_factory=dict)
    currentReferences: list[JsonMap] = field(default_factory=list)
    currentReferenceDigests: list[JsonMap] = field(default_factory=list)
    artifactIndex: JsonMap = field(default_factory=dict)
    capabilityBrief: JsonMap = field(default_factory=dict)
    executionModePlan: JsonMap = field(default_factory=dict)
    handoffPlan: JsonMap = field(default_factory=dict)
    acceptancePlan: JsonMap = field(default_factory=dict)
    recoveryPlan: JsonMap = field(default_factory=dict)
    latencyPolicy: JsonMap = field(default_factory=dict)
    responsePlan: JsonMap = field(default_factory=dict)
    backgroundPlan: JsonMap = field(default_factory=dict)
    cachePolicy: JsonMap = field(default_factory=dict)
    userVisiblePlan: list[JsonMap] = field(default_factory=list)
    processStage: ProcessStage = field(default_factory=ProcessStage)
    auditTrace: list[JsonMap] = field(default_factory=list)
    errors: list[JsonMap] = field(default_factory=list)
    metadata: JsonMap = field(default_factory=dict)


def to_json_dict(value: Any) -> Any:
    """Convert nested dataclasses to plain JSON-compatible dictionaries."""

    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, list):
        return [to_json_dict(item) for item in value]
    if isinstance(value, tuple):
        return [to_json_dict(item) for item in value]
    if isinstance(value, dict):
        return {key: to_json_dict(item) for key, item in value.items()}
    return value


def request_from_json(payload: JsonMap) -> ConversationPolicyRequest:
    if payload.get("schemaVersion") != REQUEST_SCHEMA_VERSION:
        raise ValueError(f"Unsupported request schemaVersion: {payload.get('schemaVersion')!r}")

    turn_payload = _require_mapping(payload, "turn")
    session = _optional_mapping(payload.get("session"), "session")
    history_payload = _optional_list(payload.get("history"), "history")
    if not history_payload:
        history_payload = _history_from_session_messages(session.get("messages"))
    return ConversationPolicyRequest(
        schemaVersion=payload["schemaVersion"],
        requestId=_optional_str(payload.get("requestId"), "requestId"),
        turn=_turn_from_json(turn_payload),
        history=[_turn_from_json(item) for item in history_payload],
        capabilities=[
            _capability_from_json(item)
            for item in _optional_list(payload.get("capabilities"), "capabilities")
        ],
        session=session,
        policyHints=_optional_mapping(payload.get("policyHints"), "policyHints"),
        workspace=_optional_mapping(payload.get("workspace"), "workspace"),
        limits=_optional_mapping(payload.get("limits"), "limits"),
        tsDecisions=_optional_mapping(payload.get("tsDecisions"), "tsDecisions"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def response_from_json(payload: JsonMap) -> ConversationPolicyResponse:
    if payload.get("schemaVersion") != RESPONSE_SCHEMA_VERSION:
        raise ValueError(f"Unsupported response schemaVersion: {payload.get('schemaVersion')!r}")

    return ConversationPolicyResponse(
        schemaVersion=payload["schemaVersion"],
        requestId=_optional_str(payload.get("requestId"), "requestId"),
        status=payload.get("status", "ok"),
        goalSnapshot=_optional_mapping(payload.get("goalSnapshot"), "goalSnapshot"),
        contextPolicy=_optional_mapping(payload.get("contextPolicy"), "contextPolicy"),
        memoryPlan=_optional_mapping(payload.get("memoryPlan"), "memoryPlan"),
        currentReferences=[
            item for item in _optional_list(payload.get("currentReferences"), "currentReferences")
            if isinstance(item, dict)
        ],
        currentReferenceDigests=[
            item for item in _optional_list(payload.get("currentReferenceDigests"), "currentReferenceDigests")
            if isinstance(item, dict)
        ],
        artifactIndex=_optional_mapping(payload.get("artifactIndex"), "artifactIndex"),
        capabilityBrief=_optional_mapping(payload.get("capabilityBrief"), "capabilityBrief"),
        executionModePlan=_optional_mapping(payload.get("executionModePlan"), "executionModePlan"),
        handoffPlan=_optional_mapping(payload.get("handoffPlan"), "handoffPlan"),
        acceptancePlan=_optional_mapping(payload.get("acceptancePlan"), "acceptancePlan"),
        recoveryPlan=_optional_mapping(payload.get("recoveryPlan"), "recoveryPlan"),
        latencyPolicy=_optional_mapping(payload.get("latencyPolicy"), "latencyPolicy"),
        responsePlan=_optional_mapping(payload.get("responsePlan"), "responsePlan"),
        backgroundPlan=_optional_mapping(payload.get("backgroundPlan"), "backgroundPlan"),
        cachePolicy=_optional_mapping(payload.get("cachePolicy"), "cachePolicy"),
        userVisiblePlan=[
            item for item in _optional_list(payload.get("userVisiblePlan"), "userVisiblePlan")
            if isinstance(item, dict)
        ],
        processStage=_stage_from_json(_optional_mapping(payload.get("processStage"), "processStage")),
        auditTrace=_optional_list(payload.get("auditTrace"), "auditTrace"),
        errors=_optional_list(payload.get("errors"), "errors"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _turn_from_json(payload: Any) -> ConversationTurn:
    if isinstance(payload, str):
        return ConversationTurn(role="user", text=payload)
    if not isinstance(payload, dict):
        return ConversationTurn(role="user", text=str(payload or ""))
    return ConversationTurn(
        role=payload.get("role", "user"),
        text=payload.get("text", payload.get("prompt", "")),
        turnId=_optional_str(payload.get("turnId"), "turnId"),
        refs=[
            _reference_from_json(item)
            for item in _optional_list(payload.get("refs", payload.get("references")), "refs")
        ],
        artifacts=_optional_list(payload.get("artifacts"), "artifacts"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _reference_from_json(payload: Any) -> Reference:
    if isinstance(payload, str):
        return Reference(kind="path", ref=payload)
    if not isinstance(payload, dict):
        return Reference(kind="unknown", ref=str(payload or ""))
    return Reference(
        kind=payload.get("kind", "unknown"),
        ref=payload.get("ref", payload.get("path", payload.get("id", ""))),
        title=_optional_str(payload.get("title"), "title"),
        mimeType=_optional_str(payload.get("mimeType"), "mimeType"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _capability_from_json(payload: JsonMap) -> CapabilityManifest:
    return CapabilityManifest(
        id=payload.get("id", ""),
        title=payload.get("title", payload.get("id", "")),
        kind=payload.get("kind", "tool"),
        description=payload.get("description", ""),
        summary=payload.get("summary", ""),
        keywords=[str(item) for item in _optional_list(payload.get("keywords"), "keywords")],
        domain=[str(item) for item in _optional_list(payload.get("domain"), "domain")],
        triggers=[str(item) for item in _optional_list(payload.get("triggers"), "triggers")],
        antiTriggers=[
            str(item)
            for item in _optional_list(payload.get("antiTriggers"), "antiTriggers")
        ],
        artifacts=[str(item) for item in _optional_list(payload.get("artifacts"), "artifacts")],
        inputTypes=[str(item) for item in _optional_list(payload.get("inputTypes"), "inputTypes")],
        outputTypes=[str(item) for item in _optional_list(payload.get("outputTypes"), "outputTypes")],
        riskLevel=payload.get("riskLevel", "low"),
        risk=[str(item) for item in _optional_list(payload.get("risk"), "risk")],
        sideEffects=[str(item) for item in _optional_list(payload.get("sideEffects"), "sideEffects")],
        cost=_optional_str(payload.get("cost"), "cost"),
        latency=_optional_str(payload.get("latency"), "latency"),
        adapter=_optional_str(payload.get("adapter"), "adapter"),
        internalAgent=_internal_agent_value(payload.get("internalAgent", False)),
        costHint=_optional_str(payload.get("costHint"), "costHint"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _goal_from_json(payload: JsonMap) -> GoalSnapshot:
    return GoalSnapshot(
        text=payload.get("text", ""),
        mode=payload.get("mode", "new_task"),
        explicitRefs=[
            _reference_from_json(item)
            for item in _optional_list(payload.get("explicitRefs"), "explicitRefs")
        ],
        acceptanceHints=[
            str(item) for item in _optional_list(payload.get("acceptanceHints"), "acceptanceHints")
        ],
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _context_from_json(payload: JsonMap) -> ContextPolicy:
    return ContextPolicy(
        mode=payload.get("mode", "new_task"),
        includeHistoryTurns=[
            str(item)
            for item in _optional_list(payload.get("includeHistoryTurns"), "includeHistoryTurns")
        ],
        excludedHistoryReasons=_optional_list(
            payload.get("excludedHistoryReasons"), "excludedHistoryReasons"
        ),
        maxPromptTokens=payload.get("maxPromptTokens"),
        referencePolicy=_optional_mapping(payload.get("referencePolicy"), "referencePolicy"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _brief_from_json(payload: JsonMap) -> CapabilityBrief:
    return CapabilityBrief(
        id=payload.get("id", ""),
        title=payload.get("title", payload.get("id", "")),
        reason=payload.get("reason", ""),
        riskLevel=payload.get("riskLevel", "low"),
        internalAgent=bool(payload.get("internalAgent", False)),
        inputs=[str(item) for item in _optional_list(payload.get("inputs"), "inputs")],
        outputs=[str(item) for item in _optional_list(payload.get("outputs"), "outputs")],
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _handoff_from_json(payload: JsonMap) -> HandoffPlan:
    return HandoffPlan(
        requiredArtifacts=[
            str(item)
            for item in _optional_list(payload.get("requiredArtifacts"), "requiredArtifacts")
        ],
        budget=_optional_mapping(payload.get("budget"), "budget"),
        fallback=_optional_mapping(payload.get("fallback"), "fallback"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _stage_from_json(payload: JsonMap) -> ProcessStage:
    return ProcessStage(
        phase=payload.get("phase", "planning"),
        summary=payload.get("summary", "Conversation policy request accepted."),
        visibleDetail=_optional_str(payload.get("visibleDetail"), "visibleDetail"),
        metadata=_optional_mapping(payload.get("metadata"), "metadata"),
    )


def _require_mapping(payload: JsonMap, key: str) -> JsonMap:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _optional_mapping(value: Any, key: str) -> JsonMap:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _optional_list(value: Any, key: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{key} must be an array")
    return value


def _optional_str(value: Any, key: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string or null")
    return value


def _history_from_session_messages(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    history: list[Any] = []
    for index, item in enumerate(value):
        if isinstance(item, str):
            history.append({"role": "user", "turnId": f"session-message-{index + 1}", "text": item})
        elif isinstance(item, dict):
            history.append(item)
    return history


def _internal_agent_value(value: Any) -> bool | str:
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"none", "optional", "required"}:
            return lowered
        return bool(lowered)
    return bool(value)
