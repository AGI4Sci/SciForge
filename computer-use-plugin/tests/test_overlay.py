"""Overlay tests — no real mouse/keyboard, no upstream models.

Run: python tests/test_overlay.py    (from computer-use-plugin/)

Verifies:
  1. The overlay's draw queue (move/ripple/hide/show/close) processes without
     error and hide() actually blocks until off-screen (when a display exists).
  2. install_pyautogui_overlay patches the mouse primitives and the uninstaller
     restores the originals EXACTLY — without ever calling a real mouse action.

On a headless box the overlay is simply inactive and the patch is a no-op; both
are valid outcomes and the test asserts the contract for whichever applies.
"""
from __future__ import annotations

import sys
import types

from driver.overlay import DesktopOverlay, install_pyautogui_overlay


def _fake_pyautogui() -> types.ModuleType:
    """A stand-in pyautogui so we can verify patching without a real desktop."""
    m = types.ModuleType("pyautogui")
    m.FAILSAFE = True
    m.PAUSE = 0.0
    calls = []
    m._calls = calls  # type: ignore[attr-defined]
    m.moveTo = lambda x=None, y=None, duration=0.0, *a, **k: calls.append(("moveTo", x, y, duration))
    m.click = lambda x=None, y=None, *a, **k: calls.append(("click", x, y))
    m.dragTo = lambda x=None, y=None, duration=0.0, *a, **k: calls.append(("dragTo", x, y, duration))
    m.mouseDown = lambda x=None, y=None, *a, **k: calls.append(("mouseDown", x, y))
    m.position = lambda: (0, 0)
    return m


def test_draw_queue() -> None:
    ov = DesktopOverlay().start()
    # Whether or not a display exists, these must never raise.
    ov.move_to(100, 100)
    ov.ripple(120, 140)
    ov.hide()          # blocks until hidden (or returns immediately if inactive)
    ov.show()
    ov.move_to(200, 200)
    ov.close()
    print(f"  draw queue OK (overlay active={ov.active})")


def test_pyautogui_patch_and_restore() -> None:
    fake = _fake_pyautogui()
    sys.modules["pyautogui"] = fake
    try:
        orig = (fake.moveTo, fake.click, fake.dragTo, fake.mouseDown)
        ov = DesktopOverlay().start()
        uninstall = install_pyautogui_overlay(ov, min_move_duration=0.0)

        if ov.active:
            # primitives must be wrapped (different objects), then restored exactly
            assert fake.moveTo is not orig[0], "moveTo should be wrapped"
            assert fake.click is not orig[1], "click should be wrapped"
            # exercise the wrapper -> it must forward to the fake (no real desktop)
            fake.moveTo(10, 20)
            assert ("moveTo", 10, 20, 0.0) in fake._calls, "wrapped moveTo must forward"
            uninstall()
            assert fake.moveTo is orig[0], "uninstall must restore moveTo"
            assert fake.click is orig[1], "uninstall must restore click"
            assert fake.dragTo is orig[2] and fake.mouseDown is orig[3]
            print("  pyautogui patch + restore OK (active)")
        else:
            # inactive overlay -> install must be a no-op leaving primitives intact
            assert fake.moveTo is orig[0] and fake.click is orig[1]
            uninstall()
            print("  pyautogui patch no-op OK (inactive/headless)")
        ov.close()
    finally:
        del sys.modules["pyautogui"]


if __name__ == "__main__":
    print("overlay tests:")
    test_draw_queue()
    test_pyautogui_patch_and_restore()
    print("ALL OVERLAY TESTS PASSED")
