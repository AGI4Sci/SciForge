"""Env-driven config for the Computer-Use worker. Secrets via env, never in code."""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse, urlunparse


LOCAL_MODEL_ROUTER_BASE_URL_ERROR = (
    "CUA_MODEL_ROUTER_BASE_URL must point to the local SciForge Model Router "
    "(http://127.0.0.1:<port>/v1, http://localhost:<port>/v1, or "
    "http://[::1]:<port>/v1)."
)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int_env(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _float_env(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() == "true"


def _normalize_local_model_router_base_url(raw: str) -> str:
    base = raw.strip()
    if not base:
        return ""
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
    if parsed.username or parsed.password or parsed.params or parsed.query or parsed.fragment:
        raise ValueError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
    if (parsed.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
    path = parsed.path.rstrip("/")
    if path not in ("", "/v1", "/v1/responses"):
        raise ValueError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
    return urlunparse((parsed.scheme, parsed.netloc, "/v1", "", "", ""))


@dataclass
class Config:
    # Model access is centralized through the local Model Router. This worker never
    # defaults to a raw provider/vLLM URL; users must configure the router and supply
    # the runtime key that authorizes /v1/responses.
    model_base_url: str = field(default_factory=lambda: _env("CUA_MODEL_ROUTER_BASE_URL"))
    model_name: str = field(default_factory=lambda: _env(
        "CUA_MODEL_ROUTER_MODEL",
        _env("SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS", "sciforge-router"),
    ))
    model_api_key: str = field(default_factory=lambda: _env(
        "CUA_MODEL_ROUTER_API_KEY",
        _env("SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY"),
    ))
    # loop / safety
    max_steps: int = field(default_factory=lambda: _int_env("CUA_MAX_STEPS", 12))
    # Official GUI-Owl sliding window: how many of the most recent steps keep their
    # screenshot in the prompt (older steps drop the image; the assistant action
    # outputs carry them forward as text). Must be <= the vLLM --limit-mm-per-prompt
    # image cap (the serve script uses 2). Mirrors cut_current_messages(last_image=N).
    image_window: int = field(default_factory=lambda: _int_env("CUA_IMAGE_WINDOW", 2))
    # seconds to wait after a real action for the UI to settle
    settle_s: float = field(default_factory=lambda: _float_env("CUA_SETTLE_S", 0.25))
    # loop guard: if the agent repeats essentially the same action this many times
    # in a short window (e.g. retyping the same URL because it never presses Enter),
    # stop with status 'stuck_repeated_action' instead of spinning to max_steps.
    nonprogress_limit: int = field(default_factory=lambda: _int_env("CUA_NONPROGRESS_LIMIT", 3))
    # Reflector (official Mobile-Agent-v3 module): after each executed action, the
    # same GUI-Owl model compares the before/after screenshots and judges the
    # outcome (A=ok, B=wrong page, C=no change), updating a running progress note
    # and feeding failures back into the next step. Off => single-pass loop.
    # Default ON (suits the 8B). The launcher sets CUA_REFLECT per served model
    # (32B -> false for speed, 8B -> true); an explicit CUA_REFLECT always wins.
    reflect: bool = field(default_factory=lambda: _bool_env("CUA_REFLECT", True))
    # consecutive B/C outcomes that trigger a "rethink your approach" hint
    # (mirrors Mobile-Agent-v3's err_to_manager_thresh; we have no separate
    # Manager, so the native model re-plans itself).
    reflect_escalate: int = field(default_factory=lambda: _int_env("CUA_REFLECT_ESCALATE", 2))
    # optional separate model for reflection; empty => reuse the planner model.
    reflect_model: str = field(default_factory=lambda: _env("CUA_REFLECT_MODEL"))
    # destructive actions are OFF unless the caller both sets execute and approves.
    allow_execute: bool = field(default_factory=lambda: _bool_env("CUA_ALLOW_EXECUTE", False))
    # HTTP sidecar bearer token. The GUI launcher generates a random token and
    # passes it to both this service and the Kun tool provider. If live execution
    # is enabled, POST endpoints require this token.
    service_token: str = field(default_factory=lambda: _env(
        "CUA_SERVICE_TOKEN",
        _env("SCIFORGE_CUA_SERVICE_TOKEN"),
    ))
    # paint a click-through mouse overlay on the real desktop during live execution
    # (Windows; degrades to no-op elsewhere). Off => no visualization.
    show_overlay: bool = field(default_factory=lambda: _bool_env("CUA_SHOW_OVERLAY", True))
    port: int = field(default_factory=lambda: _int_env("CUA_PORT", 3900))
    artifact_dir: str = field(default_factory=lambda: _env("CUA_ARTIFACT_DIR", os.path.join(os.getcwd(), "cua-runs")))

    def __post_init__(self) -> None:
        self.model_base_url = _normalize_local_model_router_base_url(self.model_base_url)


CONFIG = Config()
