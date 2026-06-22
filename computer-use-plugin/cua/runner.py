"""run_task: drive the AgentS2_5 loop, record a trace, return a ServiceResult.

Boundary (template): we return evidence + trace + status, NOT a final answer or
completion truth — the Agent Host decides if the task is truly done.

Side-effect safety (template requires approval/dry-run for external effects):
  * dry_run (default): predict + ground each step, record the action that WOULD run,
    never touch the real mouse/keyboard.
  * execute: only when the caller passes execute=True AND approve=True AND the server
    is started with allow_execute — otherwise NEEDS_APPROVAL is returned.
Screenshots are written to disk and returned as artifact refs (refs-first), never
inlined as base64 in the result.
"""
from __future__ import annotations
import io
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from PIL import Image

from . import result as R
from .config import Config
from .agent import build_agent

ScreenshotProvider = Callable[[], Image.Image]


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _plan_text(info: Dict[str, Any]) -> str:
    for k in ("executor_plan", "plan", "reflection"):
        v = info.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def run_task(cfg: Config, instruction: str, screenshot_provider: ScreenshotProvider,
             execute: bool = False, approve: bool = False,
             request_id: Optional[str] = None) -> Dict[str, Any]:
    request_id = request_id or str(uuid.uuid4())
    started = time.time()
    prov = R.provenance("computer_use_run", request_id, started)

    if not instruction or not instruction.strip():
        return R.err("INVALID_ARGUMENT", "instruction is required", prov=prov)

    really_execute = bool(execute)
    if really_execute and not (approve and cfg.allow_execute):
        return R.err(
            "NEEDS_APPROVAL",
            "Execution touches the real desktop (mouse/keyboard). Re-call with "
            "execute=true & approve=true, and start the service with CUA_ALLOW_EXECUTE=true.",
            blocked_reason="external-side-effect-requires-approval", prov=prov)

    run_dir = os.path.join(cfg.artifact_dir, request_id)
    os.makedirs(run_dir, exist_ok=True)

    # First observation fixes the screen dims the ACI scales against.
    try:
        first = screenshot_provider()
    except Exception as e:  # noqa: BLE001
        return R.err("UNAVAILABLE", f"screenshot failed: {e}", prov=prov)
    w, h = first.size

    try:
        agent, aci, os_name = build_agent(cfg, w, h)
    except Exception as e:  # noqa: BLE001
        return R.err("INTERNAL_ERROR", f"agent build failed: {e}", retryable=True, prov=prov)

    steps: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    status = "exhausted_steps"
    img = first

    # Visualize the agent's mouse on the real desktop during live execution so
    # the user can see WHERE and WHEN the agent is acting. Best-effort: any
    # overlay failure leaves `overlay` inactive and never blocks the run.
    overlay = None
    overlay_uninstall = lambda: None  # noqa: E731
    if really_execute and getattr(cfg, "show_overlay", False):
        try:
            from driver.overlay import DesktopOverlay, install_pyautogui_overlay
            overlay = DesktopOverlay().start()
            overlay_uninstall = install_pyautogui_overlay(overlay)
        except Exception:  # noqa: BLE001
            overlay = None
            overlay_uninstall = lambda: None  # noqa: E731

    # Hide the overlay during each capture so its ring/banner never pollute the
    # grounder's observation, then restore it.
    def capture() -> Image.Image:
        if overlay is not None and getattr(overlay, "active", False):
            overlay.hide()
            try:
                return screenshot_provider()
            finally:
                overlay.show()
        return screenshot_provider()

    try:
        return _run_loop(
            cfg, instruction, capture, agent, aci, os_name,
            really_execute, run_dir, first, w, h, steps, artifacts, status,
            request_id, started)
    finally:
        try:
            overlay_uninstall()
        finally:
            if overlay is not None:
                overlay.close()


def _run_loop(cfg: Config, instruction: str, screenshot_provider: ScreenshotProvider,
              agent, aci, os_name: str, really_execute: bool, run_dir: str,
              first: Image.Image, w: int, h: int,
              steps: List[Dict[str, Any]], artifacts: List[Dict[str, Any]],
              status: str, request_id: str, started: float) -> Dict[str, Any]:
    img = first

    for i in range(cfg.max_steps):
        shot_path = os.path.join(run_dir, f"step{i:02d}.png")
        img.save(shot_path)
        artifacts.append(R.artifact_ref("screenshot", f"step {i} screenshot", path=shot_path))
        obs = {"screenshot": _png_bytes(img)}

        try:
            info, code = agent.predict(instruction=instruction, observation=obs)
        except Exception as e:  # noqa: BLE001
            status = "error"
            steps.append({"step": i, "error": str(e)})
            break

        action = (code[0] if code else "").strip()
        low = action.lower()
        step_rec = {
            "step": i,
            "plan": _plan_text(info)[:600],
            "action": action[:400],
            "coords": list(getattr(aci, "coords1", []) or []) or None,
            "screenshot": shot_path,
            "executed": False,
        }

        if "done" in low:
            step_rec["terminal"] = "done"; steps.append(step_rec); status = "agent_reported_done"; break
        if "fail" in low:
            step_rec["terminal"] = "fail"; steps.append(step_rec); status = "agent_reported_fail"; break
        if "wait" in low or "next" in low:
            steps.append(step_rec)
            if "wait" in low:
                time.sleep(2)
            img = screenshot_provider()
            continue

        if really_execute:
            try:
                exec(action, {"agent": aci, "time": time, "pyautogui": __import__("pyautogui")})
                step_rec["executed"] = True
            except Exception as e:  # noqa: BLE001
                step_rec["exec_error"] = str(e)
            steps.append(step_rec)
            img = screenshot_provider()
        else:
            steps.append(step_rec)
            status = "dry_run_planned"
            break  # dry-run: one grounded step is enough to validate; no live re-observe

    summary = (f"{len(steps)} step(s); status={status}; "
               f"{'executed' if really_execute else 'dry-run (no actions performed)'}.")
    data = {
        "status": status,                 # NOT a completion claim; host decides
        "executed": really_execute,
        "instruction": instruction,
        "platform": os_name,
        "screen": [w, h],
        "steps": steps,
        "stepCount": len(steps),
    }
    prov = R.provenance("computer_use_run", request_id, started)
    return R.ok(data, summary=summary, artifacts=artifacts, prov=prov)
