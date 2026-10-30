from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from PIL import Image

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput, Verification
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind
from driver.backend import ActionReceipt, BackendOpenContext, BackendOperationError, Observation, VerificationEvidence


@dataclass
class FakeHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    closed: bool = False


class FakeCdpBackend:
    def __init__(self, target: TargetDescriptor, *, fail_close: bool = False,
                 unknown_action: bool = False, unknown_open: bool = False) -> None:
        self.target = target
        self.fail_close = fail_close
        self.unknown_action = unknown_action
        self.unknown_open = unknown_open
        self.revision = 0
        self.text = "Ready"
        self.handles = 0
        self.actions = 0
        self.pending_opens: dict[str, FakeHandle] = {}

    def probe(self):
        return BackendCapabilities(
            backend=BackendId.BROWSER_CDP, available=True,
            target_kinds=(TargetKind.BROWSER_PAGE, TargetKind.ELECTRON_WEBCONTENTS),
            actions=("observe", "click", "type", "key", "hotkey", "scroll"),
            effective_isolation=IsolationLevel.HOST_APP_SCOPED,
            background_input=BackgroundInput.SEMANTIC, requires_host_focus=False,
            affects_user_input=False, uses_host_clipboard=False,
            supports_readback=("click", "type", "key", "scroll"),
            lease_scope=LeaseScope.TARGET, max_concurrency=8,
            instance_id="fake-adapter", generation=self.target.generation,
        )

    def discover_targets(self, filters=None): return [self.target]

    def open(self, target, context):
        if target.generation != self.target.generation:
            raise BackendOperationError("generation changed", code="TARGET_LOST", safe_to_retry=True)
        self.handles += 1
        handle = FakeHandle(target, context)
        if self.unknown_open:
            self.pending_opens[context.request_id] = handle
            raise BackendOperationError("open response lost")
        return handle

    def recover_open(self, target, context):
        return self.pending_opens[context.request_id]

    def observe(self, handle):
        self._handle(handle)
        return Observation(
            target_id=self.target.target_id, revision=f"cdp:{self.revision}",
            image=Image.new("RGB", (1000, 800)), backend="browser-cdp",
            metadata={"semanticTree": [
                {"tag": "button", "role": "button", "name": "Commit", "center": [500, 500], "disabled": False},
                {"tag": "output", "role": "status", "name": self.text, "center": [500, 700], "disabled": False},
            ]},
        )

    def perform(self, handle, action: Mapping[str, Any], expected_revision: str):
        self._handle(handle)
        self.actions += 1
        if self.unknown_action:
            raise BackendOperationError("transport lost", may_have_taken_effect=True)
        self.revision += 1
        self.text = "Committed" if action.get("action") == "click" else str(action.get("text") or "Changed")
        return ActionReceipt(
            action_id=f"action-{uuid.uuid4()}", target_id=self.target.target_id,
            revision_before=expected_revision, committed=True, may_have_taken_effect=True,
            backend_evidence={"reason": "semantic-tree-changed"},
        )

    def verify(self, handle, action, receipt, before):
        self._handle(handle)
        return VerificationEvidence(Verification.VERIFIED, self.target.target_id,
                                    revision_after=f"cdp:{self.revision}", details={"reason": "semantic-tree-changed"})

    def cancel(self, handle, reason): self._handle(handle).context.cancellation.set()

    def close(self, handle, reason):
        value = self._handle(handle)
        if self.fail_close: raise RuntimeError("close failed")
        value.closed = True
        self.handles -= 1
        self.pending_opens.pop(value.context.request_id, None)

    @staticmethod
    def _handle(value):
        if not isinstance(value, FakeHandle) or value.closed: raise RuntimeError("invalid handle")
        return value
