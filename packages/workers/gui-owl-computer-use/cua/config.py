"""Env-driven config for the Computer-Use plugin. Secrets via env, never in code."""
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass
class Config:
    # Single end-to-end GUI agent model: GUI-Owl-1.5 (Qwen3-VL based) served via
    # vLLM. It both perceives and decides — no separate planner/grounder, no
    # Agent-S. Defaults fall back to the legacy CUA_GROUNDER_* env so the existing
    # launcher (which points the grounder at GUI-Owl) works unchanged.
    model_base_url: str = os.environ.get(
        "CUA_MODEL_BASE_URL", os.environ.get("CUA_GROUNDER_BASE_URL", "http://127.0.0.1:18901/v1"))
    model_name: str = os.environ.get(
        "CUA_MODEL", os.environ.get("CUA_GROUNDER_MODEL", "gui-owl-1.5-8b"))
    model_api_key: str = os.environ.get(
        "CUA_MODEL_API_KEY", os.environ.get("CUA_GROUNDER_API_KEY", "EMPTY"))
    # loop / safety
    max_steps: int = int(os.environ.get("CUA_MAX_STEPS", "12"))
    # Official GUI-Owl sliding window: how many of the most recent steps keep their
    # screenshot in the prompt (older steps drop the image; the assistant action
    # outputs carry them forward as text). Must be <= the vLLM --limit-mm-per-prompt
    # image cap (the serve script uses 2). Mirrors cut_current_messages(last_image=N).
    image_window: int = int(os.environ.get("CUA_IMAGE_WINDOW", "2"))
    # seconds to wait after a real action for the UI to settle
    settle_s: float = float(os.environ.get("CUA_SETTLE_S", "0.25"))
    # loop guard: if the agent repeats essentially the same action this many times
    # in a short window (e.g. retyping the same URL because it never presses Enter),
    # stop with status 'stuck_repeated_action' instead of spinning to max_steps.
    nonprogress_limit: int = int(os.environ.get("CUA_NONPROGRESS_LIMIT", "3"))
    # Reflector (official Mobile-Agent-v3 module): after each executed action, the
    # same GUI-Owl model compares the before/after screenshots and judges the
    # outcome (A=ok, B=wrong page, C=no change), updating a running progress note
    # and feeding failures back into the next step. Off => single-pass loop.
    # Default ON (suits the 8B). The launcher sets CUA_REFLECT per served model
    # (32B -> false for speed, 8B -> true); an explicit CUA_REFLECT always wins.
    reflect: bool = os.environ.get("CUA_REFLECT", "true").lower() == "true"
    # consecutive B/C outcomes that trigger a "rethink your approach" hint
    # (mirrors Mobile-Agent-v3's err_to_manager_thresh; we have no separate
    # Manager, so the native model re-plans itself).
    reflect_escalate: int = int(os.environ.get("CUA_REFLECT_ESCALATE", "2"))
    # optional separate model for reflection; empty => reuse the planner model.
    reflect_model: str = os.environ.get("CUA_REFLECT_MODEL", "")
    # destructive actions are OFF unless the caller both sets execute and approves.
    allow_execute: bool = os.environ.get("CUA_ALLOW_EXECUTE", "false").lower() == "true"
    # paint a click-through mouse overlay on the real desktop during live execution
    # (Windows; degrades to no-op elsewhere). Off => no visualization.
    show_overlay: bool = os.environ.get("CUA_SHOW_OVERLAY", "true").lower() == "true"
    port: int = int(os.environ.get("CUA_PORT", "3900"))
    artifact_dir: str = os.environ.get("CUA_ARTIFACT_DIR", os.path.join(os.getcwd(), "cua-runs"))


CONFIG = Config()
