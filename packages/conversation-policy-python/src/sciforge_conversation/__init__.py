"""SciForge conversation policy engine."""

from .acceptance import evaluate_acceptance
from .capability_broker import (
    CapabilityRequest,
    broker_capabilities,
    build_capability_brief,
    load_capability_manifests,
    select_capabilities,
)
from .contracts import (
    REQUEST_JSON_SCHEMA,
    REQUEST_SCHEMA_VERSION,
    RESPONSE_JSON_SCHEMA,
    RESPONSE_SCHEMA_VERSION,
    CapabilityBrief,
    CapabilityManifest,
    ContextPolicy,
    ConversationPolicyRequest,
    ConversationPolicyResponse,
    ConversationTurn,
    GoalSnapshot,
    HandoffPlan,
    ProcessStage,
    Reference,
    request_from_json,
    response_from_json,
    to_json_dict,
)
from .handoff_planner import plan_handoff
from .recovery import plan_recovery

_SERVICE_EXPORTS = {"evaluate_request", "handle_payload", "handle_text", "run_stdio"}


def __getattr__(name: str):
    if name in _SERVICE_EXPORTS:
        from . import service

        return getattr(service, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "REQUEST_JSON_SCHEMA",
    "REQUEST_SCHEMA_VERSION",
    "RESPONSE_JSON_SCHEMA",
    "RESPONSE_SCHEMA_VERSION",
    "CapabilityBrief",
    "CapabilityManifest",
    "ContextPolicy",
    "ConversationPolicyRequest",
    "ConversationPolicyResponse",
    "ConversationTurn",
    "GoalSnapshot",
    "HandoffPlan",
    "ProcessStage",
    "Reference",
    "CapabilityRequest",
    "broker_capabilities",
    "build_capability_brief",
    "evaluate_request",
    "evaluate_acceptance",
    "handle_payload",
    "handle_text",
    "load_capability_manifests",
    "plan_handoff",
    "plan_recovery",
    "request_from_json",
    "response_from_json",
    "run_stdio",
    "select_capabilities",
    "to_json_dict",
]
