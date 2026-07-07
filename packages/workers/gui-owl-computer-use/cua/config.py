"""Config for the Computer-Use worker. Secrets via env, never in code."""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse, urlunparse


DEFAULT_GROUNDING_BASE_URL = "http://10.140.158.130:8881/v1/chat/completions"
DEFAULT_GROUNDING_MODEL = "gui-owl"
DEFAULT_GROUNDING_ENDPOINT = "chat_completions"
DEFAULT_GROUNDING_EXTRA_HEADERS = {"x-original-model": "gui-owl"}

DEFAULT_MODEL_ROUTER_BASE_URL = "http://127.0.0.1:3892/v1"
DEFAULT_MODEL_ROUTER_MODEL = "sciforge-router"


BASE_URL_ERROR_SUFFIX = (
    "must be an http(s) URL without embedded credentials, "
    "query parameters, or fragments."
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


def _json_object_env(name: str, default: dict[str, str] | None = None) -> dict[str, str]:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return dict(default or {})
    raw = raw_value.strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} must be a JSON object of HTTP headers.") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{name} must be a JSON object of HTTP headers.")
    return {str(k): str(v) for k, v in parsed.items() if str(k).strip() and str(v).strip()}


def _normalize_base_url(raw: str, name: str) -> str:
    base = raw.strip()
    if not base:
        return ""
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{name} {BASE_URL_ERROR_SUFFIX}")
    if parsed.username or parsed.password or parsed.params or parsed.query or parsed.fragment:
        raise ValueError(f"{name} {BASE_URL_ERROR_SUFFIX}")
    path = parsed.path.rstrip("/")
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def _normalize_grounding_endpoint(raw: str) -> str:
    endpoint = raw.strip().lower().replace("-", "_").replace("/", "_")
    if endpoint in ("", "chat", "chat_completions", "v1_chat_completions"):
        return "chat_completions"
    if endpoint in ("responses", "v1_responses"):
        return "responses"
    raise ValueError("CUA_GROUNDING_ENDPOINT must be chat_completions or responses.")


@dataclass
class Config:
    # OpenAI-compatible GUI-Owl grounding profile. URL/model/header defaults live
    # in this package so all runtimes use the same computer-use path; only the
    # bearer key is machine-local secret material.
    grounding_base_url: str = field(default_factory=lambda: _env("CUA_GROUNDING_BASE_URL", DEFAULT_GROUNDING_BASE_URL))
    grounding_model: str = field(default_factory=lambda: _env("CUA_GROUNDING_MODEL", DEFAULT_GROUNDING_MODEL))
    grounding_api_key: str = field(default_factory=lambda: _env("CUA_GROUNDING_API_KEY"))
    grounding_endpoint: str = field(default_factory=lambda: _env("CUA_GROUNDING_ENDPOINT", DEFAULT_GROUNDING_ENDPOINT))
    grounding_extra_headers: dict[str, str] = field(default_factory=lambda: _json_object_env("CUA_GROUNDING_EXTRA_HEADERS", DEFAULT_GROUNDING_EXTRA_HEADERS))
    # General vision calls inside this package (currently the optional
    # Reflector) use the app's Model Router public alias by default. The router
    # decides the real vision model, e.g. the current default gpt5.5 profile.
    vision_base_url: str = field(default_factory=lambda: _env(
        "CUA_VISION_BASE_URL",
        _env("SCIFORGE_MODEL_ROUTER_BASE_URL", DEFAULT_MODEL_ROUTER_BASE_URL),
    ))
    vision_model: str = field(default_factory=lambda: _env(
        "CUA_VISION_MODEL",
        _env("SCIFORGE_MODEL_ROUTER_MODEL", DEFAULT_MODEL_ROUTER_MODEL),
    ))
    vision_api_key: str = field(default_factory=lambda: _env(
        "CUA_VISION_API_KEY",
        _env("SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY"),
    ))
    vision_endpoint: str = field(default_factory=lambda: _env("CUA_VISION_ENDPOINT", "chat_completions"))
    vision_extra_headers: dict[str, str] = field(default_factory=lambda: _json_object_env("CUA_VISION_EXTRA_HEADERS"))
    # loop / safety
    max_steps: int = field(default_factory=lambda: _int_env("CUA_MAX_STEPS", 20))
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
    # Reflector (official Mobile-Agent-v3 module): after each executed action,
    # a general vision model compares the before/after screenshots and judges
    # the outcome (A=ok, B=wrong page, C=no change). Off => single-pass loop.
    reflect: bool = field(default_factory=lambda: _bool_env("CUA_REFLECT", False))
    # consecutive B/C outcomes that trigger a "rethink your approach" hint
    # (mirrors Mobile-Agent-v3's err_to_manager_thresh; we have no separate
    # Manager, so the native model re-plans itself).
    reflect_escalate: int = field(default_factory=lambda: _int_env("CUA_REFLECT_ESCALATE", 2))
    # optional separate model for reflection; empty => use the Model Router alias above.
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
        self.grounding_base_url = _normalize_base_url(self.grounding_base_url, "CUA_GROUNDING_BASE_URL")
        self.grounding_endpoint = _normalize_grounding_endpoint(self.grounding_endpoint)
        self.vision_base_url = _normalize_base_url(self.vision_base_url, "CUA_VISION_BASE_URL")
        self.vision_endpoint = _normalize_grounding_endpoint(self.vision_endpoint)


CONFIG = Config()
