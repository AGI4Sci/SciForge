import threading

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
