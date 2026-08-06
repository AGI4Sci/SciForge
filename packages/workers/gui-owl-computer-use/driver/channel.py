"""Target-bound execution channel used by the Computer Use runner."""
from __future__ import annotations

import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Mapping

from cua.capabilities import BackendCapabilities, Verification
from cua.isolation import IsolationDecision
from cua.session_registry import RegistryError, RequestState, SessionRegistry, TargetLease
from cua.target import TargetDescriptor

from .backend import (
    ActionReceipt,
    BackendOperationError,
    InputBackend,
    Observation,
)


class ChannelError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class ActionOutcome:
    action_id: str
    target_id: str
    committed: bool
    may_have_taken_effect: bool
    verification: Verification
    evidence: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "actionId": self.action_id,
            "targetId": self.target_id,
            "committed": self.committed,
            "mayHaveTakenEffect": self.may_have_taken_effect,
            "verification": self.verification.value,
            "evidence": dict(self.evidence),
        }


@dataclass
class CleanupSummary:
    closed: bool = False
    lease_released: bool = False
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "closed": self.closed,
            "leaseReleased": self.lease_released,
            "errors": list(self.errors),
        }


class SessionInputChannel:
    """Couple observe/act/verify to one immutable target, handle and lease."""

    def __init__(
        self,
        *,
        registry: SessionRegistry,
        session_id: str,
        request_id: str,
        target: TargetDescriptor,
        lease: TargetLease,
        backend: InputBackend,
        handle: object,
        capabilities: BackendCapabilities,
        isolation: IsolationDecision,
        cancellation: threading.Event,
        deadline: float | None,
    ) -> None:
        self.registry = registry
        self.session_id = session_id
        self.request_id = request_id
        self.target = target
        self.lease = lease
        self.backend = backend
        self.handle = handle
        self.capabilities = capabilities
        self.isolation = isolation
        self.cancellation = cancellation
        self.deadline = deadline
        self._latest_observation: Observation | None = None
        self._close_lock = threading.Lock()
        self._state = threading.Condition()
        self._closing = False
        self._in_flight = 0
        self._closed = False
        self.cleanup = CleanupSummary()

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def cancelled(self) -> bool:
        return self.cancellation.is_set()

    @property
    def remaining_seconds(self) -> float | None:
        if self.deadline is None:
            return None
        return max(0.0, self.deadline - time.time())

    def _check_available(self) -> None:
        if self._closed or self._closing:
            raise ChannelError("CLEANUP_INCOMPLETE", "channel is already closed")
        if self.cancelled:
            raise ChannelError("CANCEL_PENDING", "request cancellation was requested")
        if self.deadline is not None and time.time() >= self.deadline:
            self.cancellation.set()
            raise ChannelError("TIMEOUT", "request deadline expired")

    def observe(self) -> Observation:
        # Observation can own a native handle and overlay state just like an
        # action. Count it as in-flight so force-release/shutdown cannot close
        # the handle while a capture is still using it.
        with self.activity():
            try:
                observation = self.backend.observe(self.handle)
            except BackendOperationError as error:
                raise ChannelError(error.code or "BACKEND_UNAVAILABLE", str(error)) from error
            if observation.target_id != self.target.target_id:
                raise ChannelError(
                    "TARGET_LOST",
                    "backend observation belongs to a different target",
                    details={"expectedTargetId": self.target.target_id, "actualTargetId": observation.target_id},
                )
            self._latest_observation = observation
            return observation

    def perform(self, action: Mapping[str, Any], *, expected_revision: str) -> ActionOutcome:
        self._check_available()
        action_name = str(action.get("action") or "").lower()
        if action_name not in self.capabilities.actions:
            raise ChannelError(
                "ACTION_UNSUPPORTED",
                f"backend {self.capabilities.backend.value} does not support action {action_name}",
            )
        before = self._latest_observation
        if before is None or before.revision != expected_revision:
            raise ChannelError(
                "STALE_OBSERVATION",
                "action revision does not match the latest channel observation",
                details={"expectedRevision": expected_revision, "latestRevision": before.revision if before else None},
            )
        action_id = f"action-{uuid.uuid4()}"
        with self._state:
            self._check_available()
            self._in_flight += 1
        try:
            self.registry.begin_action(self.lease.lease_id)
        except Exception:
            with self._state:
                self._in_flight -= 1
                self._state.notify_all()
            raise
        receipt: ActionReceipt | None = None
        try:
            receipt = self.backend.perform(self.handle, action, expected_revision)
            if receipt.target_id != self.target.target_id:
                raise ChannelError("TARGET_LOST", "backend receipt belongs to a different target")
            try:
                self.registry.transition_request(self.request_id, RequestState.VERIFYING)
            except RegistryError as error:
                if error.code != "INVALID_STATE_TRANSITION" or not self.cancelled:
                    raise
            evidence = self.backend.verify(self.handle, action, receipt, before)
            if evidence.target_id != self.target.target_id:
                raise ChannelError("TARGET_LOST", "verification belongs to a different target")
            if not self.cancelled:
                self.registry.transition_request(self.request_id, RequestState.RUNNING)
            if evidence.status is Verification.FAILED:
                raise ChannelError(
                    "ACTION_UNVERIFIED",
                    "backend verification reported failure",
                    details=dict(evidence.details),
                )
            if self.cancelled:
                raise ChannelError(
                    "CANCEL_PENDING",
                    "request was cancelled after the action reached a safe point",
                    details={
                        "committed": receipt.committed,
                        "mayHaveTakenEffect": receipt.may_have_taken_effect,
                    },
                )
            return ActionOutcome(
                action_id=receipt.action_id or action_id,
                target_id=receipt.target_id,
                committed=receipt.committed,
                may_have_taken_effect=receipt.may_have_taken_effect,
                verification=evidence.status,
                evidence={**dict(receipt.backend_evidence), **dict(evidence.details)},
            )
        except BackendOperationError as error:
            code = error.code or (
                "ACTION_OUTCOME_UNKNOWN" if error.may_have_taken_effect else "ACTION_UNSUPPORTED"
            )
            raise ChannelError(code, str(error)) from error
        finally:
            try:
                self.registry.finish_action(self.lease.lease_id)
            except RegistryError as error:
                if error.code not in {"LEASE_NOT_FOUND", "INVALID_STATE_TRANSITION"}:
                    raise
            finally:
                with self._state:
                    self._in_flight -= 1
                    self._state.notify_all()

    def wait(self, seconds: float) -> None:
        end = time.monotonic() + max(0.0, min(float(seconds), 30.0))
        while True:
            self._check_available()
            remaining = end - time.monotonic()
            if remaining <= 0:
                return
            self.cancellation.wait(min(0.1, remaining))

    @contextmanager
    def activity(self):
        """Keep the lease non-reusable across model/reflection work."""
        with self._state:
            self._check_available()
            self._in_flight += 1
        try:
            self.registry.begin_action(self.lease.lease_id)
        except Exception:
            with self._state:
                self._in_flight -= 1
                self._state.notify_all()
            raise
        try:
            yield
        finally:
            try:
                self.registry.finish_action(self.lease.lease_id)
            finally:
                with self._state:
                    self._in_flight -= 1
                    self._state.notify_all()

    def close(self, reason: str = "completed") -> CleanupSummary:
        with self._close_lock:
            if self._closed:
                return self.cleanup
            with self._state:
                self._closing = True
            if self.cancelled:
                try:
                    self.backend.cancel(self.handle, reason)
                except Exception as error:  # cleanup must continue
                    self.cleanup.errors.append(f"backend cancel: {error}")
            with self._state:
                while self._in_flight:
                    self._state.wait()
            try:
                self.registry.begin_release(self.lease.lease_id, reason)
            except Exception as error:
                self._record_cleanup_error(f"lease begin release: {error}")
            if not self.cleanup.closed:
                try:
                    self.backend.close(self.handle, reason)
                    self.cleanup.closed = True
                except Exception as error:
                    self._record_cleanup_error(f"backend close: {error}")
            # A failed backend close may leave owned keys, buttons, overlay or
            # target handles live. Keep the lease quarantined until a later
            # close retry succeeds instead of allowing another request to
            # overlap with that residual state.
            if self.cleanup.closed and not self.cleanup.lease_released:
                try:
                    self.registry.finish_release(self.lease.lease_id)
                    self.cleanup.lease_released = True
                except Exception as error:
                    self._record_cleanup_error(f"lease finish release: {error}")
            with self._state:
                self._closed = self.cleanup.closed and self.cleanup.lease_released
            return self.cleanup

    def _record_cleanup_error(self, message: str) -> None:
        if message not in self.cleanup.errors:
            self.cleanup.errors.append(message)
