"""Opt-in physical input smoke against one test-owned Win32 window."""
from __future__ import annotations

import os
import sys

import pytest

if sys.platform != "win32":
    pytest.skip("Windows-only physical input smoke", allow_module_level=True)

import ctypes
import json
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from ctypes import wintypes
from pathlib import Path

import mss
import pyperclip
from cua import result as R
from cua.service import ComputerUseService
from driver.backends.legacy_pyautogui import LegacyPyAutoGUIBackend
from driver.router import BackendRouter


pytestmark = [
    pytest.mark.skipif(sys.platform != "win32", reason="Windows-only physical input smoke"),
    pytest.mark.skipif(
        os.getenv("CUA_LEGACY_REAL_INPUT") != "1",
        reason="set CUA_LEGACY_REAL_INPUT=1 to authorize physical host input",
    ),
]

HOST = Path(__file__).with_name("_legacy_input_window_host.py")
TEXT = "SciForge-Legacy-Smoke-20260807"
WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
SW_RESTORE = 9


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long), ("top", ctypes.c_long),
        ("right", ctypes.c_long), ("bottom", ctypes.c_long),
    ]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND), ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND),
        ("rcCaret", RECT),
    ]


user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.restype = ctypes.c_void_p
user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.SetCursorPos.restype = wintypes.BOOL
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL
user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsWindow.restype = wintypes.BOOL
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t]
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.WindowFromPoint.argtypes = [POINT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.GetGUIThreadInfo.argtypes = [wintypes.DWORD, ctypes.POINTER(GUITHREADINFO)]
user32.GetGUIThreadInfo.restype = wintypes.BOOL
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short


def _window_text(hwnd: int) -> str:
    length = int(user32.SendMessageW(wintypes.HWND(hwnd), WM_GETTEXTLENGTH, 0, 0))
    value = ctypes.create_unicode_buffer(length + 1)
    user32.SendMessageW(wintypes.HWND(hwnd), WM_GETTEXT, len(value), ctypes.addressof(value))
    return value.value


def _restore_foreground(hwnd: int) -> None:
    if hwnd and user32.IsWindow(wintypes.HWND(hwnd)):
        user32.ShowWindow(wintypes.HWND(hwnd), SW_RESTORE)
        user32.SetForegroundWindow(wintypes.HWND(hwnd))


def test_legacy_real_input_is_serial_unverified_and_restores_host_state() -> None:
    process = subprocess.Popen(
        [sys.executable, str(HOST)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW,
    )
    original_foreground = int(user32.GetForegroundWindow() or 0)
    original_cursor = POINT()
    assert user32.GetCursorPos(ctypes.byref(original_cursor))
    original_clipboard = pyperclip.paste()
    service = ComputerUseService(router=BackendRouter([LegacyPyAutoGUIBackend()]))
    release = threading.Event()
    entered = threading.Event()
    try:
        assert process.stdout is not None
        host = json.loads(process.stdout.readline())
        hwnd = int(host["hwnd"])
        edit_hwnd = int(host["editHwnd"])
        assert _window_text(edit_hwnd) == "READY"
        rect = RECT()
        assert user32.GetWindowRect(wintypes.HWND(edit_hwnd), ctypes.byref(rect))
        screen_x = (rect.left + rect.right) // 2
        screen_y = (rect.top + rect.bottom) // 2
        hit = int(user32.WindowFromPoint(POINT(screen_x, screen_y)) or 0)
        assert hit == edit_hwnd, (
            f"controlled Edit is obscured before input: expected {edit_hwnd}, got {hit}"
        )
        with mss.mss() as capture:
            primary = capture.monitors[1]
        coordinate = [screen_x - int(primary["left"]), screen_y - int(primary["top"])]

        def execute(_request, channel):
            observation = channel.observe()
            entered.set()
            assert release.wait(5)
            click = channel.perform({"action": "click", "coordinate": coordinate}, expected_revision=observation.revision)
            actual_cursor = POINT()
            assert user32.GetCursorPos(ctypes.byref(actual_cursor))
            actual_hit = int(user32.WindowFromPoint(actual_cursor) or 0)
            actual_foreground = int(user32.GetForegroundWindow() or 0)
            process_id = wintypes.DWORD()
            thread_id = user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(process_id))
            gui = GUITHREADINFO()
            gui.cbSize = ctypes.sizeof(GUITHREADINFO)
            assert user32.GetGUIThreadInfo(thread_id, ctypes.byref(gui))
            focus_after_click = int(gui.hwndFocus or 0)
            after_click = channel.observe()
            selected = channel.perform({"action": "hotkey", "keys": ["ctrl", "a"]}, expected_revision=after_click.revision)
            ctrl_after_select = bool(user32.GetAsyncKeyState(0x11) & 0x8000)
            after_select = channel.observe()
            keyed = channel.perform({"action": "key", "keys": ["x"]}, expected_revision=after_select.revision)
            ctrl_after_key = bool(user32.GetAsyncKeyState(0x11) & 0x8000)
            keyed_text = _window_text(edit_hwnd)
            after_key = channel.observe()
            typed = channel.perform({"action": "type", "text": TEXT}, expected_revision=after_key.revision)
            ctrl_after_type = bool(user32.GetAsyncKeyState(0x11) & 0x8000)
            return R.ok({
                "click": click.to_dict(), "select": selected.to_dict(),
                "key": keyed.to_dict(), "type": typed.to_dict(),
                "textAfterKey": keyed_text,
                "cursorAfterClick": [actual_cursor.x, actual_cursor.y],
                "windowAtCursor": actual_hit,
                "foregroundAfterClick": actual_foreground,
                "focusAfterClick": focus_after_click,
                "ctrlStates": [ctrl_after_select, ctrl_after_key, ctrl_after_type],
            })

        first_request = {
            "instruction": "type into the controlled Legacy test window",
            "target": {"targetId": "host-desktop:default", "kind": "host-desktop", "locator": {"monitorId": "1"}},
            "requestedIsolation": "host-approved", "requestId": "legacy-real-smoke-1",
            "execute": True, "approve": True,
        }
        second_request = {
            **first_request, "requestId": "legacy-real-smoke-2",
        }
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(
                service.run, first_request, execute,
                channel_options={"allow_execute": True, "show_overlay": False, "settle_s": 0.1},
            )
            assert entered.wait(5)
            second = service.run(
                second_request, lambda *_args: R.ok({"unexpected": True}),
                channel_options={"allow_execute": True, "show_overlay": False, "settle_s": 0.1},
            )
            assert second["error"]["code"] == "HOST_INPUT_BUSY"
            user32.SetCursorPos(max(100, screen_x - 50), max(100, screen_y - 50))
            user32.ShowWindow(wintypes.HWND(hwnd), SW_RESTORE)
            user32.SetForegroundWindow(wintypes.HWND(hwnd))
            time.sleep(0.2)
            release.set()
            first_result = first.result(timeout=15)

        assert first_result["ok"] is True
        assert first_result["data"]["click"]["verification"] == "unverified"
        assert first_result["data"]["select"]["verification"] == "unverified"
        assert first_result["data"]["key"]["verification"] == "unverified"
        assert first_result["data"]["type"]["verification"] == "unverified"
        deadline = time.monotonic() + 3
        expected_text = f"x{TEXT}"
        while time.monotonic() < deadline and _window_text(edit_hwnd) != expected_text:
            time.sleep(0.05)
        assert _window_text(edit_hwnd) == expected_text, (
            f"textAfterKey={first_result['data']['textAfterKey']!r}; "
            f"final={_window_text(edit_hwnd)!r}; "
            f"cursor={first_result['data']['cursorAfterClick']!r}; "
            f"windowAtCursor={first_result['data']['windowAtCursor']}; "
            f"foreground={first_result['data']['foregroundAfterClick']}; "
            f"focus={first_result['data']['focusAfterClick']}; "
            f"ctrlStates={first_result['data']['ctrlStates']!r}; "
            f"expectedEdit={edit_hwnd}; expectedWindow={hwnd}"
        )
        assert pyperclip.paste() == original_clipboard
        counts = service.registry.snapshot_counts()
        assert counts["requests"] == counts["activeLeases"] == 0
        assert service.status()["activeChannels"] == 0
        assert service.status()["cleanupPending"] == []
    finally:
        release.set()
        service.shutdown()
        try:
            pyperclip.copy(original_clipboard)
        finally:
            user32.SetCursorPos(original_cursor.x, original_cursor.y)
            _restore_foreground(original_foreground)
        if process.stdin is not None:
            try:
                process.stdin.write("shutdown\n")
                process.stdin.flush()
            except OSError:
                pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
