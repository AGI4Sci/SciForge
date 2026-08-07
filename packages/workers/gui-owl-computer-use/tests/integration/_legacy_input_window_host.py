"""Test-owned focusable Win32 window for opt-in physical Legacy input smoke."""
from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
from ctypes import wintypes


WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WS_CHILD = 0x40000000
WS_VISIBLE = 0x10000000
WS_TABSTOP = 0x00010000
WS_BORDER = 0x00800000
WS_OVERLAPPEDWINDOW = 0x00CF0000
WS_EX_TOPMOST = 0x00000008
SW_SHOW = 5
IDC_ARROW = 32512
KLF_ACTIVATE = 0x00000001

HWND = wintypes.HWND
HINSTANCE = wintypes.HINSTANCE
HMENU = wintypes.HMENU
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, HWND, wintypes.UINT, WPARAM, LPARAM)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT), ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int), ("hInstance", HINSTANCE),
        ("hIcon", ctypes.c_void_p), ("hCursor", ctypes.c_void_p),
        ("hbrBackground", ctypes.c_void_p), ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", ctypes.c_void_p),
    ]


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
imm32 = ctypes.WinDLL("imm32", use_last_error=True)
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = HINSTANCE
user32.RegisterClassExW.argtypes = [ctypes.POINTER(WNDCLASSEXW)]
user32.RegisterClassExW.restype = ctypes.c_ushort
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    HWND, HMENU, HINSTANCE, ctypes.c_void_p,
]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.restype = HWND
user32.DefWindowProcW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.DestroyWindow.argtypes = [HWND]
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.PostMessageW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.ShowWindow.argtypes = [HWND, ctypes.c_int]
user32.UpdateWindow.argtypes = [HWND]
user32.LoadCursorW.argtypes = [HINSTANCE, ctypes.c_void_p]
user32.LoadCursorW.restype = ctypes.c_void_p
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), HWND, wintypes.UINT, wintypes.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.LoadKeyboardLayoutW.argtypes = [wintypes.LPCWSTR, wintypes.UINT]
user32.LoadKeyboardLayoutW.restype = ctypes.c_void_p
imm32.ImmAssociateContext.argtypes = [HWND, ctypes.c_void_p]
imm32.ImmAssociateContext.restype = ctypes.c_void_p


@WNDPROC
def _window_proc(hwnd, message, wparam, lparam):
    if message == WM_CLOSE:
        user32.DestroyWindow(hwnd)
        return 0
    if message == WM_DESTROY:
        user32.PostQuitMessage(0)
        return 0
    return int(user32.DefWindowProcW(hwnd, message, wparam, lparam))


hinstance = kernel32.GetModuleHandleW(None)
if not user32.LoadKeyboardLayoutW("00000409", KLF_ACTIVATE):
    raise ctypes.WinError(ctypes.get_last_error())
class_name = f"SciForgeCuaLegacyHost{os.getpid()}"
window_class = WNDCLASSEXW()
window_class.cbSize = ctypes.sizeof(WNDCLASSEXW)
window_class.lpfnWndProc = _window_proc
window_class.hInstance = hinstance
window_class.hCursor = user32.LoadCursorW(None, ctypes.c_void_p(IDC_ARROW))
window_class.hbrBackground = ctypes.c_void_p(6)
window_class.lpszClassName = class_name
if not user32.RegisterClassExW(ctypes.byref(window_class)):
    raise ctypes.WinError(ctypes.get_last_error())

window_hwnd = user32.CreateWindowExW(
    WS_EX_TOPMOST, class_name, "SciForge Controlled Legacy Input", WS_OVERLAPPEDWINDOW,
    180, 160, 520, 230, None, None, hinstance, None,
)
if not window_hwnd:
    raise ctypes.WinError(ctypes.get_last_error())
edit_hwnd = user32.CreateWindowExW(
    0, "EDIT", "READY", WS_CHILD | WS_VISIBLE | WS_TABSTOP | WS_BORDER,
    40, 55, 420, 42, window_hwnd, HMENU(2101), hinstance, None,
)
if not edit_hwnd:
    raise ctypes.WinError(ctypes.get_last_error())
# Keep this test-owned control independent of the user's current Chinese IME.
# The association and keyboard layout live only for this short-lived host.
imm32.ImmAssociateContext(edit_hwnd, None)
user32.ShowWindow(window_hwnd, SW_SHOW)
user32.UpdateWindow(window_hwnd)
print(json.dumps({
    "pid": os.getpid(), "hwnd": int(window_hwnd), "editHwnd": int(edit_hwnd),
}), flush=True)


def _shutdown():
    for line in sys.stdin:
        if line.strip().lower() == "shutdown":
            user32.PostMessageW(window_hwnd, WM_CLOSE, 0, 0)
            return


threading.Thread(target=_shutdown, daemon=True).start()
message = wintypes.MSG()
while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
    user32.TranslateMessage(ctypes.byref(message))
    user32.DispatchMessageW(ctypes.byref(message))
