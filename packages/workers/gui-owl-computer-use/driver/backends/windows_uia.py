"""Pattern-driven Windows UI Automation backend with semantic readback."""
from __future__ import annotations

import ctypes
import hashlib
import json
import platform
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from PIL import Image

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput, Verification
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind, parse_target_descriptor
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    BackendOperationError,
    Observation,
    VerificationEvidence,
)


_ACTIONS = (
    "observe", "click", "left_click", "invoke", "type", "write",
    "toggle", "select", "range", "scroll",
)


class UIATargetLost(RuntimeError):
    pass


class UIAActionUnsupported(RuntimeError):
    pass


@dataclass(frozen=True)
class UIASnapshot:
    revision: str
    nodes: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True)
class UIAActionResult:
    verification: Verification
    revision_after: str
    details: Mapping[str, Any] = field(default_factory=dict)


class UIAProvider(Protocol):
    def available(self) -> tuple[bool, str | None]: ...
    def discover(self) -> list[TargetDescriptor]: ...
    def open(self, target: TargetDescriptor) -> str: ...
    def snapshot(self, target: TargetDescriptor, identity: str) -> UIASnapshot: ...
    def perform(self, target: TargetDescriptor, identity: str, action: Mapping[str, Any]) -> UIAActionResult: ...


@dataclass
class WindowsUIAHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    identity: str
    closed: bool = False
    results: dict[str, UIAActionResult] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class WindowsUIABackend:
    """Use target control patterns only; never synthesize host mouse/keyboard."""

    def __init__(self, provider: UIAProvider | None = None) -> None:
        self.provider = provider or ComtypesUIAProvider()

    def probe(self) -> BackendCapabilities:
        available, reason = self.provider.available()
        return BackendCapabilities(
            backend=BackendId.WINDOWS_UIA,
            available=available,
            target_kinds=(TargetKind.WINDOWS_UIA,),
            actions=_ACTIONS,
            effective_isolation=IsolationLevel.HOST_APP_SCOPED,
            background_input=BackgroundInput.SEMANTIC,
            requires_host_focus=False,
            affects_user_input=False,
            uses_host_clipboard=False,
            supports_readback=("type", "write", "toggle", "select", "range", "scroll"),
            lease_scope=LeaseScope.TARGET,
            max_concurrency=64 if available else 0,
            reason=reason,
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        return self.provider.discover()

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> WindowsUIAHandle:
        if target.kind is not TargetKind.WINDOWS_UIA:
            raise BackendOperationError("Windows UIA backend only accepts windows-uia targets")
        try:
            identity = self.provider.open(target)
        except UIATargetLost as error:
            raise BackendOperationError(str(error), code="TARGET_LOST") from error
        return WindowsUIAHandle(target, context, identity)

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        with h.lock:
            self._ensure_open(h)
            try:
                snapshot = self.provider.snapshot(h.target, h.identity)
            except UIATargetLost as error:
                raise BackendOperationError(str(error), code="TARGET_LOST") from error
            # UIA is a semantic provider, not a target-bound pixel capture API.
            # Keep image provenance honest; the semantic tree is in metadata.
            image = Image.new("RGB", (32, 24), (32, 32, 32))
            return Observation(
                target_id=h.target.target_id,
                revision=snapshot.revision,
                image=image,
                backend=BackendId.WINDOWS_UIA.value,
                metadata={"semanticTree": list(snapshot.nodes), "imageAvailable": False},
            )

    def perform(
        self,
        handle: object,
        action: Mapping[str, Any],
        expected_revision: str,
    ) -> ActionReceipt:
        h = self._handle(handle)
        name = str(action.get("action") or "").lower()
        if name not in _ACTIONS:
            raise BackendOperationError(f"unsupported UIA action: {name}")
        if "coordinate" in action and not (action.get("automationId") or action.get("elementId")):
            raise BackendOperationError(
                "UIA cannot bind a coordinate-only action without a semantic element id",
                may_have_taken_effect=False,
                code="ACTION_UNSUPPORTED",
            )
        if h.context.cancellation.is_set():
            raise BackendOperationError("request was cancelled before UIA action")
        action_id = f"action-{uuid.uuid4()}"
        try:
            with h.lock:
                self._ensure_open(h)
                current = self.provider.snapshot(h.target, h.identity)
                if current.revision != expected_revision:
                    raise BackendOperationError(
                        "UIA semantic state changed after observation",
                        may_have_taken_effect=False,
                        code="STALE_OBSERVATION",
                    )
                result = self.provider.perform(h.target, h.identity, action)
        except BackendOperationError:
            raise
        except UIAActionUnsupported as error:
            raise BackendOperationError(str(error), may_have_taken_effect=False) from error
        except UIATargetLost as error:
            raise BackendOperationError(
                str(error), may_have_taken_effect=False, code="TARGET_LOST",
            ) from error
        except Exception as error:
            raise BackendOperationError(f"UIA action failed: {error}", may_have_taken_effect=True) from error
        h.results[action_id] = result
        return ActionReceipt(
            action_id=action_id,
            target_id=h.target.target_id,
            revision_before=expected_revision,
            committed=True,
            may_have_taken_effect=True,
            backend_evidence={"patternDriven": True},
        )

    def verify(
        self,
        handle: object,
        action: Mapping[str, Any],
        receipt: ActionReceipt,
        before: Observation,
    ) -> VerificationEvidence:
        h = self._handle(handle)
        result = h.results.pop(receipt.action_id, None)
        if result is None:
            raise BackendOperationError("UIA verification evidence is unavailable", may_have_taken_effect=True)
        return VerificationEvidence(
            status=result.verification,
            target_id=h.target.target_id,
            revision_after=result.revision_after,
            details=result.details,
        )

    def cancel(self, handle: object, reason: str) -> None:
        self._handle(handle).context.cancellation.set()

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        with h.lock:
            h.results.clear()
            h.closed = True

    @staticmethod
    def _handle(handle: object) -> WindowsUIAHandle:
        if not isinstance(handle, WindowsUIAHandle):
            raise TypeError("invalid Windows UIA handle")
        return handle

    @staticmethod
    def _ensure_open(handle: WindowsUIAHandle) -> None:
        if handle.closed:
            raise BackendOperationError("Windows UIA handle is closed")


class ComtypesUIAProvider:
    """Resolve fresh COM elements per call so pointers never cross threads."""

    def available(self) -> tuple[bool, str | None]:
        if platform.system() != "Windows":
            return False, "Windows UI Automation is available only on Windows"
        try:
            self._load_types()
        except Exception as error:
            return False, f"Windows UI Automation binding unavailable: {error}"
        return True, None

    def discover(self) -> list[TargetDescriptor]:
        targets: list[TargetDescriptor] = []
        with self._automation() as (automation, _uia):
            walker = automation.ControlViewWalker
            root = automation.GetRootElement()
            element = walker.GetFirstChildElement(root)
            while element is not None and len(targets) < 256:
                try:
                    hwnd = int(element.CurrentNativeWindowHandle)
                    pid = int(element.CurrentProcessId)
                    if hwnd > 0 and pid > 0:
                        identity = self._identity(element)
                        targets.append(parse_target_descriptor({
                            "targetId": f"uia:{pid}:{hwnd}:{identity[:16]}",
                            "kind": "windows-uia",
                            "ownership": "attached",
                            "locator": {"processId": pid, "nativeWindowHandle": str(hwnd)},
                            "generation": identity,
                            "metadata": {
                                "title": str(element.CurrentName or "")[:2048],
                                "processName": "",
                            },
                        }))
                except Exception:
                    pass
                element = walker.GetNextSiblingElement(element)
        return targets

    def open(self, target: TargetDescriptor) -> str:
        with self._automation() as (automation, uia):
            element = self._resolve(automation, uia, target)
            return self._identity(element)

    def snapshot(self, target: TargetDescriptor, identity: str) -> UIASnapshot:
        with self._automation() as (automation, uia):
            root = self._resolve_and_validate(automation, uia, target, identity)
            nodes = tuple(self._walk(automation.ControlViewWalker, root, limit=256))
            revision = "uia:" + hashlib.sha256(
                json.dumps(nodes, sort_keys=True, ensure_ascii=True).encode("utf-8")
            ).hexdigest()[:24]
            return UIASnapshot(revision, nodes)

    def perform(
        self,
        target: TargetDescriptor,
        identity: str,
        action: Mapping[str, Any],
    ) -> UIAActionResult:
        with self._automation() as (automation, uia):
            root = self._resolve_and_validate(automation, uia, target, identity)
            element = self._action_element(automation, uia, root, action)
            name = str(action.get("action") or "").lower()
            if name in {"type", "write"}:
                value = str(action.get("text") if "text" in action else action.get("value", ""))
                pattern = self._pattern(element, uia.UIA_ValuePatternId, uia.IUIAutomationValuePattern)
                if bool(pattern.CurrentIsReadOnly):
                    raise UIAActionUnsupported("UIA ValuePattern is read-only")
                pattern.SetValue(value)
                readback = str(pattern.CurrentValue)
                status = Verification.VERIFIED if readback == value else Verification.FAILED
                details = {"pattern": "Value", "expected": value, "actual": readback}
            elif name in {"click", "left_click", "invoke"}:
                before = self._element_state(element)
                pattern = self._pattern(element, uia.UIA_InvokePatternId, uia.IUIAutomationInvokePattern)
                pattern.Invoke()
                after = self._element_state(element)
                status = Verification.VERIFIED if before != after else Verification.UNVERIFIED
                details = {"pattern": "Invoke", "before": before, "after": after}
            elif name == "toggle":
                pattern = self._pattern(element, uia.UIA_TogglePatternId, uia.IUIAutomationTogglePattern)
                before = int(pattern.CurrentToggleState)
                pattern.Toggle()
                after = int(pattern.CurrentToggleState)
                status = Verification.VERIFIED if before != after else Verification.FAILED
                details = {"pattern": "Toggle", "before": before, "after": after}
            elif name == "select":
                pattern = self._pattern(element, uia.UIA_SelectionItemPatternId, uia.IUIAutomationSelectionItemPattern)
                pattern.Select()
                selected = bool(pattern.CurrentIsSelected)
                status = Verification.VERIFIED if selected else Verification.FAILED
                details = {"pattern": "SelectionItem", "selected": selected}
            elif name == "range":
                requested = float(action.get("value"))
                pattern = self._pattern(element, uia.UIA_RangeValuePatternId, uia.IUIAutomationRangeValuePattern)
                if bool(pattern.CurrentIsReadOnly):
                    raise UIAActionUnsupported("UIA RangeValuePattern is read-only")
                if not float(pattern.CurrentMinimum) <= requested <= float(pattern.CurrentMaximum):
                    raise UIAActionUnsupported("UIA range value is outside provider bounds")
                pattern.SetValue(requested)
                actual = float(pattern.CurrentValue)
                status = Verification.VERIFIED if actual == requested else Verification.FAILED
                details = {"pattern": "RangeValue", "expected": requested, "actual": actual}
            elif name == "scroll":
                pattern = self._pattern(element, uia.UIA_ScrollPatternId, uia.IUIAutomationScrollPattern)
                before = [float(pattern.CurrentHorizontalScrollPercent), float(pattern.CurrentVerticalScrollPercent)]
                amount = uia.ScrollAmount_SmallIncrement if float(action.get("pixels", 1) or 1) > 0 else uia.ScrollAmount_SmallDecrement
                pattern.Scroll(uia.ScrollAmount_NoAmount, amount)
                after = [float(pattern.CurrentHorizontalScrollPercent), float(pattern.CurrentVerticalScrollPercent)]
                status = Verification.VERIFIED if before != after else Verification.UNVERIFIED
                details = {"pattern": "Scroll", "before": before, "after": after}
            else:
                raise UIAActionUnsupported(f"UIA action requires focus or is unsupported: {name}")
            snapshot = tuple(self._walk(automation.ControlViewWalker, root, limit=256))
            revision = "uia:" + hashlib.sha256(
                json.dumps(snapshot, sort_keys=True, ensure_ascii=True).encode("utf-8")
            ).hexdigest()[:24]
            return UIAActionResult(status, revision, details)

    @staticmethod
    def _load_types():
        from comtypes.client import GetModule

        GetModule("UIAutomationCore.dll")
        import comtypes.gen.UIAutomationClient as uia

        return uia

    @contextmanager
    def _automation(self):
        import comtypes
        from comtypes.client import CreateObject

        uia = self._load_types()
        comtypes.CoInitialize()
        try:
            automation = CreateObject(uia.CUIAutomation8, interface=uia.IUIAutomation)
            yield automation, uia
        finally:
            comtypes.CoUninitialize()

    def _resolve(self, automation, uia, target: TargetDescriptor):
        locator = target.locator
        hwnd_raw = locator.get("nativeWindowHandle")
        pid = int(locator.get("processId", 0) or 0)
        if hwnd_raw is not None:
            hwnd = int(str(hwnd_raw), 0)
            self._validate_hwnd(hwnd, pid)
            element = automation.ElementFromHandle(hwnd)
        else:
            conditions = []
            if pid:
                conditions.append(automation.CreatePropertyCondition(uia.UIA_ProcessIdPropertyId, pid))
            automation_id = locator.get("automationId")
            if automation_id:
                conditions.append(automation.CreatePropertyCondition(
                    uia.UIA_AutomationIdPropertyId, str(automation_id),
                ))
            if not conditions:
                raise UIATargetLost("target has no resolvable UIA locator")
            condition = conditions[0]
            for next_condition in conditions[1:]:
                condition = automation.CreateAndCondition(condition, next_condition)
            element = automation.GetRootElement().FindFirst(uia.TreeScope_Subtree, condition)
        if element is None:
            raise UIATargetLost("UIA target element was not found")
        if pid and int(element.CurrentProcessId) != pid:
            raise UIATargetLost("UIA target process identity changed")
        return element

    def _resolve_and_validate(self, automation, uia, target: TargetDescriptor, identity: str):
        element = self._resolve(automation, uia, target)
        if self._identity(element) != identity:
            raise UIATargetLost("UIA target runtime identity changed")
        return element

    @staticmethod
    def _validate_hwnd(hwnd: int, expected_pid: int) -> None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.IsWindow.argtypes = [ctypes.c_void_p]
        user32.IsWindow.restype = ctypes.c_bool
        user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        user32.GetWindowThreadProcessId.restype = ctypes.c_ulong
        if not user32.IsWindow(hwnd):
            raise UIATargetLost("native window handle is no longer valid")
        actual_pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(actual_pid))
        if expected_pid and actual_pid.value != expected_pid:
            raise UIATargetLost("native window handle now belongs to another process")

    def _action_element(self, automation, uia, root, action: Mapping[str, Any]):
        automation_id = action.get("automationId") or action.get("elementId")
        if not automation_id:
            return root
        condition = automation.CreatePropertyCondition(uia.UIA_AutomationIdPropertyId, str(automation_id))
        element = root.FindFirst(uia.TreeScope_Subtree, condition)
        if element is None:
            raise UIATargetLost("requested UIA action element was not found")
        return element

    @staticmethod
    def _pattern(element, pattern_id: int, interface):
        try:
            unknown = element.GetCurrentPattern(pattern_id)
            if unknown is None:
                raise UIAActionUnsupported(f"UIA pattern {pattern_id} is unavailable")
            return unknown.QueryInterface(interface)
        except UIAActionUnsupported:
            raise
        except Exception as error:
            raise UIAActionUnsupported(f"UIA pattern {pattern_id} is unavailable") from error

    @staticmethod
    def _identity(element) -> str:
        runtime_id = tuple(int(item) for item in (element.GetRuntimeId() or ()))
        payload = [
            int(element.CurrentProcessId), int(element.CurrentNativeWindowHandle),
            str(element.CurrentAutomationId or ""), runtime_id,
        ]
        return hashlib.sha256(repr(payload).encode("utf-8")).hexdigest()

    @staticmethod
    def _element_state(element) -> dict[str, Any]:
        return {
            "name": str(element.CurrentName or "")[:512],
            "enabled": bool(element.CurrentIsEnabled),
            "offscreen": bool(element.CurrentIsOffscreen),
            "itemStatus": str(element.CurrentItemStatus or "")[:512],
        }

    def _walk(self, walker, root, *, limit: int):
        stack = [(root, 0)]
        emitted = 0
        while stack and emitted < limit:
            element, depth = stack.pop()
            try:
                node = {
                    "depth": depth,
                    "automationId": str(element.CurrentAutomationId or "")[:256],
                    "name": "<password>" if bool(element.CurrentIsPassword) else str(element.CurrentName or "")[:512],
                    "controlType": int(element.CurrentControlType),
                    "enabled": bool(element.CurrentIsEnabled),
                    "offscreen": bool(element.CurrentIsOffscreen),
                }
                yield node
                emitted += 1
                children = []
                child = walker.GetFirstChildElement(element)
                while child is not None and len(children) < limit:
                    children.append(child)
                    child = walker.GetNextSiblingElement(child)
                stack.extend((child, depth + 1) for child in reversed(children))
            except Exception:
                continue
