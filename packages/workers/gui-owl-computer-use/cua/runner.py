"""run_task: drive GUI-Owl-1.5 directly (no Agent-S), record a trace, return a
ServiceResult.

Loop: screenshot -> GUI-Owl (native computer_use action space) -> parse the
tool call -> execute via DesktopExecutor -> repeat. One model call per step.

Boundary (template): we return evidence + trace + status, NOT a final answer or
completion truth — the Agent Host decides if the task is truly done.

Side-effect safety:
  * dry_run (default): predict one step, record the action that WOULD run, never
    touch the real mouse/keyboard.
  * execute: only when execute=True AND approve=True AND the server was started
    with allow_execute — otherwise NEEDS_APPROVAL.
Screenshots are written to disk and returned as artifact refs (refs-first).
"""
from __future__ import annotations
import io
import json
import os
import platform as _platform
import re
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from PIL import Image

from . import result as R
from . import cancel
from . import owl_agent
from . import reflector
from .config import Config

ScreenshotProvider = Callable[[], Image.Image]

_OS_NAME = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(
    _platform.system(), "linux")


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _norm_action(action: str) -> str:
    """Normalize an action for loop detection: lowercased, whitespace-collapsed,
    with integers bucketed to ~20px so coordinate jitter doesn't hide a repeat."""
    a = re.sub(r"\d+", lambda m: str(int(m.group()) // 20), (action or "").lower())
    return re.sub(r"\s+", " ", a).strip()


def _action_summary(output_text: str) -> str:
    """Pull the human-readable 'Action:' line (or a leading thought) from output."""
    m = re.search(r"Action:\s*(.+?)(?:<tool_call>|$)", output_text, re.DOTALL | re.IGNORECASE)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()[:300]
    return re.sub(r"\s+", " ", output_text).strip()[:300]


def _do_action(ex, args: Dict[str, Any], w: int, h: int) -> None:
    """Map a parsed GUI-Owl computer_use action to a DesktopExecutor call."""
    a = (args.get("action") or "").lower()
    coord = args.get("coordinate")

    def xy():
        return owl_agent.to_screen(coord, w, h)

    if a in ("left_click", "click"):
        ex.click(*xy())
    elif a == "right_click":
        ex.right_click(*xy())
    elif a == "middle_click":
        ex.middle_click(*xy())
    elif a == "double_click":
        ex.double_click(*xy())
    elif a == "triple_click":
        ex.triple_click(*xy())
    elif a == "mouse_move":
        ex.move(*xy())
    elif a in ("left_click_drag", "drag"):
        if coord is not None:
            ex.left_click_drag(*xy())
    elif a in ("scroll", "hscroll"):
        if coord is not None:
            ex.move(*xy())
        ex.scroll(int(args.get("pixels", 1) or 1))
    elif a == "type":
        ex.type_text(args.get("text", "") or "")
    elif a in ("key", "hotkey"):
        keys = args.get("keys") or []
        if isinstance(keys, str):
            keys = [keys]
        keys = [str(k).lower() for k in keys]
        if keys:
            ex.press_key(*keys)
    else:
        raise ValueError(f"unsupported action: {a}")


# Actions that end the run rather than driving the desktop.
_TERMINAL = {"terminate", "answer", "stop", "done", "interact", "call_user"}


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

    try:
        first = screenshot_provider()
    except Exception as e:  # noqa: BLE001
        return R.err("UNAVAILABLE", f"screenshot failed: {e}", prov=prov)
    w, h = first.size

    # The executor drives the real mouse/keyboard; only created for live runs.
    executor = None
    if really_execute:
        try:
            from driver.desktop import DesktopExecutor
            executor = DesktopExecutor(dry_run=False, settle_s=cfg.settle_s)
        except Exception as e:  # noqa: BLE001
            return R.err("INTERNAL_ERROR", f"executor init failed: {e}", retryable=True, prov=prov)

    steps: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []

    # Visualize the agent's mouse during live execution so the user sees WHERE and
    # WHEN it acts. Best-effort: any overlay failure leaves it inactive.
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
    # model's observation, then restore it.
    def capture() -> Image.Image:
        if overlay is not None and getattr(overlay, "active", False):
            overlay.hide()
            try:
                return screenshot_provider()
            finally:
                overlay.show()
        return screenshot_provider()

    try:
        return _run_loop(cfg, instruction, capture, executor, really_execute,
                         run_dir, first, w, h, steps, artifacts, request_id, started)
    finally:
        try:
            overlay_uninstall()
        finally:
            if overlay is not None:
                overlay.close()
            cancel.clear(request_id)


def _run_loop(cfg: Config, instruction: str, screenshot_provider: ScreenshotProvider,
              executor, really_execute: bool, run_dir: str,
              first: Image.Image, w: int, h: int,
              steps: List[Dict[str, Any]], artifacts: List[Dict[str, Any]],
              request_id: str, started: float) -> Dict[str, Any]:
    img = first
    status = "exhausted_steps"
    history: List[Dict[str, str]] = []          # {"output", "image"} per step
    recent_actions: List[str] = []              # for the repeat-loop guard
    progress_status = ""                         # Reflector's running progress note
    action_outcomes: List[str] = []              # A/B/C per executed step
    replan_hint = False                          # set after consecutive B/C outcomes

    for i in range(cfg.max_steps):
        if cancel.is_cancelled(request_id):
            status = "cancelled"
            break

        shot_path = os.path.join(run_dir, f"step{i:02d}.png")
        img.save(shot_path)
        artifacts.append(R.artifact_ref("screenshot", f"step {i} screenshot", path=shot_path))
        w, h = img.size

        # Ask GUI-Owl for the next step.
        try:
            messages = owl_agent.build_messages(instruction, history, img,
                                                image_window=cfg.image_window,
                                                progress_status=progress_status,
                                                replan_hint=replan_hint)
            output_text = owl_agent.call_owl(
                cfg.model_base_url, cfg.model_name, cfg.model_api_key, messages)
        except Exception as e:  # noqa: BLE001
            status = "error"
            steps.append({"step": i, "error": str(e)})
            break

        args = owl_agent.extract_action(output_text)
        action_type = (args.get("action") if args else "") or ""
        coord = (args or {}).get("coordinate")
        step_rec = {
            "step": i,
            "plan": _action_summary(output_text),
            "action": (json.dumps(args, ensure_ascii=False)[:400] if args else "<no-action>"),
            "coords": owl_agent.to_screen(coord, w, h) if (coord and len(coord) >= 2) else None,
            "screenshot": shot_path,
            "executed": False,
        }
        history.append({"output": output_text, "image": shot_path})

        # Terminal actions end the run.
        low = action_type.lower()
        if low in _TERMINAL:
            if low in ("interact", "call_user"):
                step_rec["terminal"] = low; steps.append(step_rec)
                status = "needs_user"; break
            if low == "answer":
                step_rec["terminal"] = "answer"; step_rec["answer"] = (args or {}).get("text", "")
                steps.append(step_rec); status = "agent_reported_done"; break
            ok = str((args or {}).get("status", "success")).lower() != "failure"
            step_rec["terminal"] = action_type; steps.append(step_rec)
            status = "agent_reported_done" if ok else "agent_reported_fail"; break

        # `wait` is not a desktop mutation: sleep, re-observe, continue.
        if low == "wait":
            steps.append(step_rec)
            time.sleep(float((args or {}).get("time", 2) or 2))
            img = screenshot_provider()
            continue

        # Repeat-loop guard (covers unparseable / no-action too).
        norm = _norm_action(step_rec["action"]) or "<no-action>"
        recent_actions.append(norm)
        del recent_actions[: -(cfg.nonprogress_limit * 2)]
        if recent_actions.count(norm) >= cfg.nonprogress_limit:
            step_rec["stuck"] = "repeated_action"; steps.append(step_rec)
            status = "stuck_repeated_action"; break

        if not really_execute:
            steps.append(step_rec)
            status = "dry_run_planned"
            break  # dry-run: one parsed step validates the path; no live re-observe

        # Re-check cancel right before touching the desktop.
        if cancel.is_cancelled(request_id):
            steps.append(step_rec); status = "cancelled"; break

        if not args:
            # Nothing parseable to do; record and re-observe (guard above bounds spins).
            steps.append(step_rec)
            img = screenshot_provider()
            continue
        before_img = img
        try:
            _do_action(executor, args, w, h)
            step_rec["executed"] = True
        except Exception as e:  # noqa: BLE001
            step_rec["exec_error"] = str(e)
        after_img = screenshot_provider()

        # Reflector (official Mobile-Agent-v3 module): judge the before/after pair,
        # thread progress forward, surface failures into the next step's prompt.
        # Fail-open: any reflection error leaves the run otherwise unaffected.
        if cfg.reflect:
            try:
                refl = reflector.reflect(
                    cfg, instruction, progress_status,
                    current_subgoal=instruction,
                    last_action=args, last_summary=step_rec["plan"],
                    before_img=before_img, after_img=after_img)
                step_rec["reflect"] = {"outcome": refl["outcome"],
                                       "error": refl["error_description"]}
                history[-1]["reflect_outcome"] = refl["outcome"]
                history[-1]["reflect_error"] = refl["error_description"]
                if refl["progress_status"]:
                    progress_status = refl["progress_status"]
                action_outcomes.append(refl["outcome"])
                window = action_outcomes[-cfg.reflect_escalate:]
                replan_hint = (len(window) >= cfg.reflect_escalate
                               and all(o in ("B", "C") for o in window))
            except Exception as e:  # noqa: BLE001
                step_rec["reflect_error"] = str(e)
        steps.append(step_rec)
        img = after_img

    summary = (f"{len(steps)} step(s); status={status}; "
               f"{'executed' if really_execute else 'dry-run (no actions performed)'}.")
    data = {
        "status": status,                 # NOT a completion claim; host decides
        "executed": really_execute,
        "instruction": instruction,
        "platform": _OS_NAME,
        "screen": [w, h],
        "steps": steps,
        "stepCount": len(steps),
    }
    prov = R.provenance("computer_use_run", request_id, started)
    return R.ok(data, summary=summary, artifacts=artifacts, prov=prov)
