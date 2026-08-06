"""One test-owned native Win32 window exposing standard UIA control patterns."""
from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
from ctypes import wintypes


LABEL = (sys.argv[1] if len(sys.argv) > 1 else "A")[:1].upper()
INDEX = max(0, ord(LABEL) - ord("A"))
EDIT_ID = 1101 + INDEX * 100
BUTTON_ID = 1102 + INDEX * 100
CHECK_ID = 1103 + INDEX * 100
STATUS_ID = 1104 + INDEX * 100

WM_COMMAND = 0x0111
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
BM_GETCHECK = 0x00F0
BN_CLICKED = 0
BS_PUSHBUTTON = 0x00000000
BS_AUTOCHECKBOX = 0x00000003
WS_CHILD = 0x40000000
WS_VISIBLE = 0x10000000
WS_TABSTOP = 0x00010000
WS_BORDER = 0x00800000
WS_OVERLAPPEDWINDOW = 0x00CF0000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
SW_SHOWNOACTIVATE = 4
CW_USEDEFAULT = 0x80000000
IDC_ARROW = 32512

HWND = wintypes.HWND
HINSTANCE = wintypes.HINSTANCE
HMENU = wintypes.HMENU
HICON = ctypes.c_void_p
HCURSOR = ctypes.c_void_p
HBRUSH = ctypes.c_void_p
ATOM = ctypes.c_ushort
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, HWND, wintypes.UINT, WPARAM, LPARAM)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HINSTANCE),
        ("hIcon", HICON),
        ("hCursor", HCURSOR),
        ("hbrBackground", HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
        ("hIconSm", HICON),
    ]


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = HINSTANCE
user32.RegisterClassExW.argtypes = [ctypes.POINTER(WNDCLASSEXW)]
user32.RegisterClassExW.restype = ATOM
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    HWND, HMENU, HINSTANCE, ctypes.c_void_p,
]
user32.CreateWindowExW.restype = HWND
user32.DefWindowProcW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.DestroyWindow.argtypes = [HWND]
user32.DestroyWindow.restype = wintypes.BOOL
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.PostQuitMessage.restype = None
user32.PostMessageW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.PostMessageW.restype = wintypes.BOOL
user32.ShowWindow.argtypes = [HWND, ctypes.c_int]
user32.ShowWindow.restype = wintypes.BOOL
user32.UpdateWindow.argtypes = [HWND]
user32.UpdateWindow.restype = wintypes.BOOL
user32.LoadCursorW.argtypes = [HINSTANCE, ctypes.c_void_p]
user32.LoadCursorW.restype = HCURSOR
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), HWND, wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = wintypes.BOOL
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.TranslateMessage.restype = wintypes.BOOL
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.GetWindowTextLengthW.argtypes = [HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.SetWindowTextW.argtypes = [HWND, wintypes.LPCWSTR]
user32.SetWindowTextW.restype = wintypes.BOOL
user32.SendMessageW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.SendMessageW.restype = LRESULT


window_hwnd = HWND()
edit_hwnd = HWND()
status_hwnd = HWND()
button_clicks = 0


def _text(hwnd: HWND) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, len(buffer))
    return buffer.value


def _update_status() -> None:
    checked = int(user32.SendMessageW(check_hwnd, BM_GETCHECK, 0, 0))
    user32.SetWindowTextW(
        status_hwnd,
        f"text={_text(edit_hwnd)};clicks={button_clicks};checked={checked}",
    )


@WNDPROC
def _window_proc(hwnd: HWND, message: int, wparam: int, lparam: int) -> int:
    global button_clicks
    if message == WM_COMMAND:
        control_id = int(wparam) & 0xFFFF
        notification = (int(wparam) >> 16) & 0xFFFF
        if control_id == BUTTON_ID and notification == BN_CLICKED:
            button_clicks += 1
        _update_status()
        return 0
    if message == WM_CLOSE:
        user32.DestroyWindow(hwnd)
        return 0
    if message == WM_DESTROY:
        user32.PostQuitMessage(0)
        return 0
    return int(user32.DefWindowProcW(hwnd, message, wparam, lparam))


hinstance = kernel32.GetModuleHandleW(None)
class_name = f"SciForgeCuaUIAHost{os.getpid()}"
window_class = WNDCLASSEXW()
window_class.cbSize = ctypes.sizeof(WNDCLASSEXW)
window_class.lpfnWndProc = _window_proc
window_class.hInstance = hinstance
window_class.hCursor = user32.LoadCursorW(None, ctypes.c_void_p(IDC_ARROW))
window_class.hbrBackground = HBRUSH(6)
window_class.lpszClassName = class_name
if not user32.RegisterClassExW(ctypes.byref(window_class)):
    raise ctypes.WinError(ctypes.get_last_error())

window_hwnd = user32.CreateWindowExW(
    WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
    class_name,
    f"SciForge Controlled UIA {LABEL}",
    WS_OVERLAPPEDWINDOW,
    80 + INDEX * 430,
    80 + INDEX * 40,
    400,
    260,
    None,
    None,
    hinstance,
    None,
)
if not window_hwnd:
    raise ctypes.WinError(ctypes.get_last_error())


def _control(class_value: str, text: str, style: int, x: int, y: int, width: int, height: int, control_id: int) -> HWND:
    hwnd = user32.CreateWindowExW(
        0, class_value, text, WS_CHILD | WS_VISIBLE | style,
        x, y, width, height, window_hwnd, HMENU(control_id), hinstance, None,
    )
    if not hwnd:
        raise ctypes.WinError(ctypes.get_last_error())
    return hwnd


edit_hwnd = _control("EDIT", "", WS_BORDER | WS_TABSTOP, 24, 24, 330, 32, EDIT_ID)
button_hwnd = _control("BUTTON", f"Commit {LABEL}", BS_PUSHBUTTON | WS_TABSTOP, 24, 72, 150, 34, BUTTON_ID)
check_hwnd = _control("BUTTON", f"Check {LABEL}", BS_AUTOCHECKBOX | WS_TABSTOP, 200, 72, 154, 34, CHECK_ID)
status_hwnd = _control("STATIC", "", 0, 24, 126, 330, 48, STATUS_ID)
_update_status()
user32.ShowWindow(window_hwnd, SW_SHOWNOACTIVATE)
user32.UpdateWindow(window_hwnd)

print(json.dumps({
    "pid": os.getpid(),
    "label": LABEL,
    "hwnd": int(window_hwnd),
    "editHwnd": int(edit_hwnd),
    "buttonHwnd": int(button_hwnd),
    "checkHwnd": int(check_hwnd),
    "statusHwnd": int(status_hwnd),
    "editAutomationId": str(EDIT_ID),
    "buttonAutomationId": str(BUTTON_ID),
    "checkAutomationId": str(CHECK_ID),
    "statusAutomationId": str(STATUS_ID),
}), flush=True)


def _stdin_shutdown() -> None:
    for line in sys.stdin:
        if line.strip().lower() == "shutdown":
            user32.PostMessageW(window_hwnd, WM_CLOSE, 0, 0)
            return


threading.Thread(target=_stdin_shutdown, daemon=True).start()
message = wintypes.MSG()
while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
    user32.TranslateMessage(ctypes.byref(message))
    user32.DispatchMessageW(ctypes.byref(message))
