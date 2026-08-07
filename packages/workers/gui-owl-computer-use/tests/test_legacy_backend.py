import threading

import pytest
from PIL import Image

from cua.capabilities import Verification
from cua.target import host_desktop_target
from driver.backend import BackendOpenContext
from driver.backends.legacy_pyautogui import LegacyPyAutoGUIBackend


def context(provider):
    return BackendOpenContext(
        request_id="request-1",
        execute=True,
        settle_s=0,
        show_overlay=False,
        cancellation=threading.Event(),
        screenshot_provider=provider,
    )


def test_legacy_observe_uses_injected_source_and_write_is_explicitly_unverified(monkeypatch):
    backend = LegacyPyAutoGUIBackend()
    handle = backend.open(host_desktop_target(), context(lambda: Image.new("RGB", (20, 10))))
    observation = backend.observe(handle)
    clipboard = ["original"]
    copies = []
    downs = []
    ups = []
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyperclip.paste", lambda: clipboard[0])
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyperclip.copy", lambda value: copies.append(value))
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyautogui.keyDown", lambda key: downs.append(key))
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyautogui.keyUp", lambda key: ups.append(key))
    receipt = backend.perform(
        handle,
        {"action": "type", "text": "hello"},
        observation.revision,
    )
    evidence = backend.verify(handle, {"action": "type"}, receipt, observation)
    assert copies == ["hello", "original"]
    assert downs == ["ctrl", "v"]
    assert ups == ["v", "ctrl"]
    assert evidence.status is Verification.UNVERIFIED
    backend.close(handle, "done")


def test_overlay_module_has_no_global_pyautogui_monkeypatch_api():
    from driver import overlay

    assert not hasattr(overlay, "install_pyautogui_overlay")


def test_legacy_close_retries_owned_key_release_before_marking_handle_closed(monkeypatch):
    backend = LegacyPyAutoGUIBackend()
    original_failsafe = False
    original_pause = 0.37
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyautogui.FAILSAFE", original_failsafe)
    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyautogui.PAUSE", original_pause)
    handle = backend.open(host_desktop_target(), context(lambda: Image.new("RGB", (1, 1))))
    handle.pressed_keys.add("ctrl")
    attempts = []

    def fail_once(key):
        attempts.append(key)
        if len(attempts) == 1:
            raise RuntimeError("release failed")

    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyautogui.keyUp", fail_once)
    with pytest.raises(RuntimeError, match="keyUp ctrl"):
        backend.close(handle, "first")
    assert handle.closed is False
    assert handle.pressed_keys == {"ctrl"}
    assert handle.previous_failsafe is original_failsafe
    assert handle.previous_pause == original_pause

    backend.close(handle, "retry")
    assert attempts == ["ctrl", "ctrl"]
    assert handle.closed is True
    assert handle.pressed_keys == set()
    assert pyautogui_value("FAILSAFE") is original_failsafe
    assert pyautogui_value("PAUSE") == original_pause


def test_legacy_close_retries_clipboard_restore_before_marking_handle_closed(monkeypatch):
    backend = LegacyPyAutoGUIBackend()
    handle = backend.open(host_desktop_target(), context(lambda: Image.new("RGB", (1, 1))))
    handle.clipboard_restore_pending = True
    handle.clipboard_restore_value = "original"
    attempts = []

    def fail_once(value):
        attempts.append(value)
        if len(attempts) == 1:
            raise RuntimeError("clipboard locked")

    monkeypatch.setattr("driver.backends.legacy_pyautogui.pyperclip.copy", fail_once)
    with pytest.raises(RuntimeError, match="clipboard restore"):
        backend.close(handle, "first")
    assert handle.closed is False
    assert handle.clipboard_restore_pending is True

    backend.close(handle, "retry")
    assert attempts == ["original", "original"]
    assert handle.closed is True
    assert handle.clipboard_restore_pending is False


def pyautogui_value(name):
    from driver.backends.legacy_pyautogui import pyautogui

    return getattr(pyautogui, name)
