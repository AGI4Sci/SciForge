"""Stable contracts for the SciForge Computer Use package."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Protocol, Sequence


REQUEST_SCHEMA_VERSION = "sciforge.computer-use.request.v1"
RESULT_SCHEMA_VERSION = "sciforge.computer-use.result.v1"


ActionKind = Literal[
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "wait",
    "focus",
    "save",
]
ComputerUseStatus = Literal[
    "completed",
    "failed-with-reason",
    "needs-confirmation",
    "max-steps",
]
RiskLevel = Literal["low", "medium", "high"]
PlannerContractIssue = Literal[
    "coordinate-output",
    "app-private-shortcut",
    "unsupported-action",
    "empty-action",
]


@dataclass(frozen=True)
class ComputerUseRequest:
    task: str
    schema_version: str = REQUEST_SCHEMA_VERSION
    max_steps: int = 12
    risk_policy: Literal["fail-closed", "allow-confirmed"] = "fail-closed"
    approval_ref: str | None = None
    providers: Mapping[str, str] = field(default_factory=dict)
    window_target: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Observation:
    ref: str
    summary: str = ""
    visible_texts: Sequence[str] = field(default_factory=tuple)
    window_target: Mapping[str, Any] | None = None
    artifacts: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionTarget:
    description: str
    region_description: str | None = None
    ref: str | None = None


@dataclass(frozen=True)
class ActionPlan:
    kind: ActionKind | None = None
    target: ActionTarget | None = None
    text: str | None = None
    key: str | None = None
    keys: Sequence[str] = field(default_factory=tuple)
    direction: str | None = None
    amount: float = 1.0
    app_name: str | None = None
    done: bool = False
    reason: str = ""
    risk_level: RiskLevel = "low"
    requires_confirmation: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ApprovalRequest:
    id: str
    reason: str
    action_kind: str
    risk_level: RiskLevel
    blocked_action_index: int
    confirmation_text: str
    refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Grounding:
    ok: bool
    x: float | None = None
    y: float | None = None
    coordinate_space: str = "observation"
    confidence: float | None = None
    reason: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecutionOutcome:
    ok: bool
    message: str = ""
    blocked: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Verification:
    ok: bool
    done: bool = False
    reason: str = ""
    confidence: float | None = None
    changed: bool | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LoopStep:
    index: int
    before: Observation
    plan: ActionPlan
    grounding: Grounding | None = None
    execution: ExecutionOutcome | None = None
    after: Observation | None = None
    verification: Verification | None = None
    status: str = "planned"
    failure_reason: str | None = None
    budget_debit_refs: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class ComputerUseResult:
    status: ComputerUseStatus
    reason: str
    schema_version: str = RESULT_SCHEMA_VERSION
    steps: Sequence[LoopStep] = field(default_factory=tuple)
    final_observation: Observation | None = None
    final_artifact_refs: Sequence[str] = field(default_factory=tuple)
    approval_request: ApprovalRequest | None = None
    failure_diagnostics: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    trace_refs: Sequence[str] = field(default_factory=tuple)
    budget_debits: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    budget_debit_refs: Sequence[str] = field(default_factory=tuple)


class ComputerUseHostPorts(Protocol):
    def plan(
        self,
        request: ComputerUseRequest,
        observation: Observation,
        history: Sequence[LoopStep],
    ) -> ActionPlan | Mapping[str, Any]:
        """Return exactly one generic action or done=True."""

    def capture(
        self,
        request: ComputerUseRequest,
        history: Sequence[LoopStep],
        query: str | None = None,
    ) -> Observation | Mapping[str, Any]:
        """Capture the current target environment and return a file-ref observation."""

    def crop(
        self,
        observation: Observation,
        region: Mapping[str, Any],
    ) -> Observation | Mapping[str, Any]:
        """Create a focus-region observation from an existing screenshot ref."""

    def execute(
        self,
        action: ActionPlan,
        grounding: Grounding | None,
        request: ComputerUseRequest,
    ) -> ExecutionOutcome | Mapping[str, Any]:
        """Execute one generic action through the host-owned input adapter."""

    def locate(
        self,
        observation: Observation,
        target: ActionTarget,
        history: Sequence[LoopStep],
    ) -> Grounding | Mapping[str, Any]:
        """Locate a target description using host-injected sense or grounder providers."""

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[LoopStep],
    ) -> Verification | Mapping[str, Any]:
        """Verify action effect and task completion through host-injected verifier providers."""

    def write_trace(
        self,
        result: ComputerUseResult,
    ) -> str:
        """Persist a refs-first trace and return its durable ref."""

    def emit_event(
        self,
        event: Mapping[str, Any],
    ) -> None:
        """Emit a compact runtime event for the TUI Host."""


class SenseProvider(Protocol):
    def observe(
        self,
        request: ComputerUseRequest,
        history: Sequence[LoopStep],
        query: str | None = None,
    ) -> Observation | Mapping[str, Any]:
        """Return the current target observation using any available sense."""

    def query(
        self,
        observation: Observation,
        question: str,
        history: Sequence[LoopStep],
    ) -> Mapping[str, Any] | str:
        """Optional extra query against an existing observation."""

    def locate(
        self,
        observation: Observation,
        target: ActionTarget,
        history: Sequence[LoopStep],
    ) -> Grounding | Mapping[str, Any]:
        """Locate a target in the observation coordinate space."""


class ActionPlanner(Protocol):
    def plan(
        self,
        request: ComputerUseRequest,
        observation: Observation,
        history: Sequence[LoopStep],
    ) -> ActionPlan | Mapping[str, Any]:
        """Return one next generic GUI action or done=True."""


class GuiExecutor(Protocol):
    def execute(
        self,
        action: ActionPlan,
        grounding: Grounding | None,
        request: ComputerUseRequest,
    ) -> ExecutionOutcome | Mapping[str, Any]:
        """Execute one generic GUI action through a host adapter."""


class Verifier(Protocol):
    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[LoopStep],
    ) -> Verification | Mapping[str, Any]:
        """Verify whether the action worked and whether the task is complete."""
