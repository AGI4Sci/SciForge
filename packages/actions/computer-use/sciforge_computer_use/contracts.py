"""Stable contracts for the SciForge Computer Use package."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Protocol, Sequence


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
]
ComputerUseStatus = Literal[
    "completed",
    "failed-with-reason",
    "needs-confirmation",
    "max-steps",
]
RiskLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class ComputerUseRequest:
    task: str
    max_steps: int = 12
    risk_policy: Literal["fail-closed", "allow-confirmed"] = "fail-closed"
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
    steps: Sequence[LoopStep] = field(default_factory=tuple)
    final_observation: Observation | None = None
    failure_diagnostics: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    budget_debits: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    budget_debit_refs: Sequence[str] = field(default_factory=tuple)


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
