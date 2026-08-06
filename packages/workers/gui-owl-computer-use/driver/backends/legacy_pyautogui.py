"""Approved compatibility backend for the process-global host input desktop."""
from __future__ import annotations

import platform
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

import mss
import pyautogui
import pyperclip
from PIL import Image

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput, Verification
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetDescriptor, TargetKind, host_desktop_target
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    BackendOperationError,
    Observation,
    VerificationEvidence,
)
from driver.overlay import OVERLAY_MANAGER


pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05


_ACTIONS = (
    "observe", "left_click", "click", "right_click", "middle_click",
    "double_click", "triple_click", "mouse_move", "left_click_drag", "drag",
    "scroll", "hscroll", "type", "key", "hotkey", "open_app", "wait",
)


@dataclass
class LegacyHandle:
    target: TargetDescriptor
    context: BackendOpenContext
    monitor: int = 1
    revision: int = 0
    closed: bool = False
    pressed_keys: set[str] = field(default_factory=set)
    pressed_buttons: set[str] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


class LegacyPyAutoGUIBackend:
    """The only production module allowed to call PyAutoGUI directly."""

    def probe(self) -> BackendCapabilities:
        return BackendCapabilities(
            backend=BackendId.LEGACY_PYAUTOGUI,
            available=True,
            target_kinds=(TargetKind.HOST_DESKTOP,),
            actions=_ACTIONS,
            effective_isolation=IsolationLevel.HOST_APPROVED,
            background_input=BackgroundInput.NONE,
            requires_host_focus=True,
            affects_user_input=True,
            uses_host_clipboard=True,
            supports_readback=(),
            lease_scope=LeaseScope.PROCESS_GLOBAL,
            max_concurrency=1,
        )

    def discover_targets(self, filters: Mapping[str, Any] | None = None) -> list[TargetDescriptor]:
        return [host_desktop_target()]

    def open(self, target: TargetDescriptor, context: BackendOpenContext) -> LegacyHandle:
        if target.kind is not TargetKind.HOST_DESKTOP:
            raise BackendOperationError("legacy backend only supports host-desktop targets")
        monitor_raw = target.locator.get("monitorId", "1")
        try:
            monitor = int(monitor_raw)
        except (TypeError, ValueError) as error:
            raise BackendOperationError("host desktop monitorId must be an integer") from error
        handle = LegacyHandle(target=target, context=context, monitor=monitor)
        if context.show_overlay and context.execute:
            OVERLAY_MANAGER.open(context.request_id)
        return handle

    def observe(self, handle: object) -> Observation:
        h = self._handle(handle)
        self._ensure_open(h)
        OVERLAY_MANAGER.before_observe(h.context.request_id)
        try:
            if h.context.screenshot_provider is not None:
                image = h.context.screenshot_provider()
            else:
                with mss.mss() as sct:
                    mon = sct.monitors[h.monitor]
                    raw = sct.grab(mon)
                    image = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        finally:
            OVERLAY_MANAGER.after_observe(h.context.request_id)
        h.revision += 1
        return Observation(
            target_id=h.target.target_id,
            revision=f"legacy:{h.revision}",
            image=image,
            backend=BackendId.LEGACY_PYAUTOGUI.value,
            metadata={"monitorId": str(h.monitor)},
        )

    def perform(
        self,
        handle: object,
        action: Mapping[str, Any],
        expected_revision: str,
    ) -> ActionReceipt:
        h = self._handle(handle)
        self._ensure_open(h)
        if h.context.cancellation.is_set():
            raise BackendOperationError("request was cancelled before action commit")
        action_name = str(action.get("action") or "").lower()
        if action_name not in _ACTIONS:
            raise BackendOperationError(f"unsupported action: {action_name}")
        may_have_taken_effect = False
        try:
            with h.lock:
                may_have_taken_effect = self._perform_locked(h, action_name, action)
        except BackendOperationError:
            raise
        except Exception as error:
            raise BackendOperationError(
                f"legacy action failed: {error}",
                may_have_taken_effect=may_have_taken_effect,
            ) from error
        return ActionReceipt(
            action_id=f"action-{uuid.uuid4()}",
            target_id=h.target.target_id,
            revision_before=expected_revision,
            committed=may_have_taken_effect,
            may_have_taken_effect=may_have_taken_effect,
            backend_evidence={"verification": Verification.UNVERIFIED.value},
        )

    def verify(
        self,
        handle: object,
        action: Mapping[str, Any],
        receipt: ActionReceipt,
        before: Observation,
    ) -> VerificationEvidence:
        h = self._handle(handle)
        self._ensure_open(h)
        return VerificationEvidence(
            status=Verification.UNVERIFIED,
            target_id=h.target.target_id,
            details={"reason": "legacy-pyautogui-has-no-semantic-readback"},
        )

    def cancel(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        h.context.cancellation.set()

    def close(self, handle: object, reason: str) -> None:
        h = self._handle(handle)
        with h.lock:
            if h.closed:
                return
            for button in tuple(h.pressed_buttons):
                try:
                    pyautogui.mouseUp(button=button)
                finally:
                    h.pressed_buttons.discard(button)
            for key in tuple(h.pressed_keys):
                try:
                    pyautogui.keyUp(key)
                finally:
                    h.pressed_keys.discard(key)
            OVERLAY_MANAGER.close(h.context.request_id)
            h.closed = True

    @staticmethod
    def _handle(handle: object) -> LegacyHandle:
        if not isinstance(handle, LegacyHandle):
            raise TypeError("invalid legacy backend handle")
        return handle

    @staticmethod
    def _ensure_open(handle: LegacyHandle) -> None:
        if handle.closed:
            raise BackendOperationError("legacy backend handle is closed")

    def _perform_locked(self, h: LegacyHandle, name: str, action: Mapping[str, Any]) -> bool:
        coord = action.get("coordinate")
        x = float(coord[0]) if isinstance(coord, (list, tuple)) and len(coord) >= 2 else None
        y = float(coord[1]) if isinstance(coord, (list, tuple)) and len(coord) >= 2 else None
        if x is not None and y is not None:
            x, y = self._to_screen(h, x, y)
        OVERLAY_MANAGER.before_action(h.context.request_id, name, x, y)
        if name in {"left_click", "click", "right_click", "middle_click", "double_click", "triple_click"}:
            button = "right" if name == "right_click" else "middle" if name == "middle_click" else "left"
            clicks = 2 if name == "double_click" else 3 if name == "triple_click" else 1
            pyautogui.click(x, y, clicks=clicks, button=button, interval=0.08)
        elif name == "mouse_move":
            pyautogui.moveTo(x, y, duration=0.15)
        elif name in {"left_click_drag", "drag"}:
            h.pressed_buttons.add("left")
            pyautogui.mouseDown(button="left")
            try:
                pyautogui.moveTo(x, y, duration=0.5)
            finally:
                pyautogui.mouseUp(button="left")
                h.pressed_buttons.discard("left")
        elif name in {"scroll", "hscroll"}:
            if x is not None and y is not None:
                pyautogui.moveTo(x, y, duration=0.15)
            pyautogui.scroll(int(action.get("pixels", 1) or 1))
        elif name == "type":
            self._type_text(h, str(action.get("text", "") or ""))
        elif name in {"key", "hotkey"}:
            keys = action.get("keys") or []
            if isinstance(keys, str):
                keys = [keys]
            self._press_keys(h, [str(key).lower() for key in keys])
        elif name == "open_app":
            self._open_app(h, str(action.get("app") or action.get("text") or "").strip())
        elif name == "wait":
            h.context.cancellation.wait(max(0.0, min(float(action.get("time", 1) or 1), 30.0)))
        time.sleep(h.context.settle_s)
        return name != "wait"

    @staticmethod
    def _to_screen(h: LegacyHandle, x: float, y: float) -> tuple[int, int]:
        with mss.mss() as sct:
            monitor = sct.monitors[h.monitor]
        return int(monitor["left"] + x), int(monitor["top"] + y)

    @staticmethod
    def _type_text(h: LegacyHandle, text: str) -> None:
        previous: str | None = None
        try:
            try:
                previous = pyperclip.paste()
            except Exception:
                previous = None
            pyperclip.copy(text)
            modifier = "command" if platform.system() == "Darwin" else "ctrl"
            LegacyPyAutoGUIBackend._press_keys(h, [modifier, "v"])
            time.sleep(max(0.25, h.context.settle_s))
        finally:
            if previous is not None:
                try:
                    pyperclip.copy(previous)
                except Exception:
                    pass

    @staticmethod
    def _press_keys(h: LegacyHandle, keys: list[str]) -> None:
        if not keys:
            return
        for key in keys:
            h.pressed_keys.add(key)
            pyautogui.keyDown(key)
        try:
            pass
        finally:
            for key in reversed(keys):
                try:
                    pyautogui.keyUp(key)
                finally:
                    h.pressed_keys.discard(key)

    def _open_app(self, h: LegacyHandle, app_name: str) -> None:
        if not app_name:
            return
        os_name = platform.system()
        if os_name == "Darwin":
            subprocess.Popen(["open", "-a", app_name])
        elif os_name == "Windows":
            self._press_keys(h, ["win"])
            time.sleep(max(0.25, h.context.settle_s))
            self._type_text(h, app_name)
            pyautogui.press("enter")
        else:
            subprocess.Popen([app_name])
        time.sleep(max(1.0, h.context.settle_s))
