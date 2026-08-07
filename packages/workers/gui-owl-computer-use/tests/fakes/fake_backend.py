from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from PIL import Image

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput, Verification
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    BackendOperationError,
    Observation,
    VerificationEvidence,
)


@dataclass
class FakeHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    closed: bool = False


class FakeBackend:
    """Deterministic target-keyed backend; it never touches the host desktop."""

    def __init__(
        self,
        *,
        backend_id: BackendId = BackendId.WINDOWS_UIA,
        isolation: IsolationLevel = IsolationLevel.HOST_APP_SCOPED,
        target_kinds: tuple[TargetKind, ...] = (TargetKind.WINDOWS_UIA,),
        actions: tuple[str, ...] = ("observe", "write", "click", "type", "wait"),
        lease_scope: LeaseScope = LeaseScope.TARGET,
        available: bool = True,
        fail_open: bool = False,
        fail_observe: bool = False,
        fail_close: bool = False,
        fail_action_target: str | None = None,
        verification: Verification = Verification.VERIFIED,
    ) -> None:
        self.backend_id = backend_id
        self.isolation = isolation
        self.target_kinds = target_kinds
        self.actions = actions
        self.lease_scope = lease_scope
        self.available = available
        self.fail_open = fail_open
        self.fail_observe = fail_observe
        self.fail_close = fail_close
        self.fail_action_target = fail_action_target
        self.verification = verification
        self._lock = threading.Lock()
        self._values: dict[str, list[str]] = {}
        self._revisions: dict[str, int] = {}
        self._open_handles = 0
        self.action_log: list[tuple[str, str]] = []

    def probe(self) -> BackendCapabilities:
        return BackendCapabilities(
            backend=self.backend_id,
            available=self.available,
            target_kinds=self.target_kinds,
            actions=self.actions,
            effective_isolation=self.isolation,
            background_input=BackgroundInput.SEMANTIC,
            requires_host_focus=False,
            affects_user_input=False,
            uses_host_clipboard=False,
            supports_readback=("write", "type"),
            lease_scope=self.lease_scope,
            max_concurrency=16 if self.available else 0,
            reason=None if self.available else "disabled for test",
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        return []

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> FakeHandle:
        if self.fail_open:
            raise BackendOperationError("fake open failed before handle creation", safe_to_retry=True)
        with self._lock:
            self._open_handles += 1
            self._revisions.setdefault(target.target_id, 0)
        return FakeHandle(target, context)

    def observe(self, handle: object) -> Observation:
        h = self._as_handle(handle)
        if self.fail_observe:
            raise RuntimeError("fake observe failed")
        with self._lock:
            revision = self._revisions[h.target.target_id]
            value = "|".join(self._values.get(h.target.target_id, ()))
        return Observation(
            target_id=h.target.target_id,
            revision=f"fake:{revision}",
            image=Image.new("RGB", (32, 24), (revision % 255, 0, 0)),
            backend=self.backend_id.value,
            metadata={"textValue": value},
        )

    def perform(self, handle: object, action: Mapping[str, Any], expected_revision: str) -> ActionReceipt:
        h = self._as_handle(handle)
        target_id = h.target.target_id
        if self.fail_action_target == target_id:
            raise BackendOperationError("fake commit failed", may_have_taken_effect=True)
        value = str(action.get("value") or action.get("text") or action.get("action") or "")
        with self._lock:
            self._values.setdefault(target_id, []).append(value)
            self._revisions[target_id] = self._revisions.get(target_id, 0) + 1
            self.action_log.append((target_id, value))
        return ActionReceipt(
            action_id=f"action-{uuid.uuid4()}",
            target_id=target_id,
            revision_before=expected_revision,
            committed=True,
            may_have_taken_effect=True,
            backend_evidence={"value": value},
        )

    def verify(self, handle: object, action, receipt, before) -> VerificationEvidence:
        h = self._as_handle(handle)
        with self._lock:
            revision = self._revisions[h.target.target_id]
        return VerificationEvidence(
            status=self.verification,
            target_id=h.target.target_id,
            revision_after=f"fake:{revision}",
        )

    def cancel(self, handle: object, reason: str) -> None:
        self._as_handle(handle).context.cancellation.set()

    def close(self, handle: object, reason: str) -> None:
        h = self._as_handle(handle)
        if h.closed:
            return
        if self.fail_close:
            # A backend exception does not prove that its handle or owned
            # system state was released. Keep the fake open so cleanup tests
            # exercise the conservative lease-quarantine contract.
            raise RuntimeError("fake close failed")
        h.closed = True
        with self._lock:
            self._open_handles -= 1

    def write(self, target_id: str, value: str) -> None:
        with self._lock:
            self._values.setdefault(target_id, []).append(value)

    def read(self, target_id: str) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._values.get(target_id, ()))

    @property
    def open_handle_count(self) -> int:
        with self._lock:
            return self._open_handles

    @staticmethod
    def _as_handle(handle: object) -> FakeHandle:
        if not isinstance(handle, FakeHandle) or handle.closed:
            raise RuntimeError("fake handle is closed or invalid")
        return handle
