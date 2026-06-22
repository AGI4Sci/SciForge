"""Env-driven config for the Computer-Use plugin. Secrets via env, never in code."""
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass
class Config:
    # planner / reasoner (OpenAI-compatible). qwen3.7-plus via the gateway.
    planner_base_url: str = os.environ.get("CUA_PLANNER_BASE_URL", "http://35.220.164.252:3888/v1")
    planner_api_key: str = os.environ.get("CUA_PLANNER_API_KEY", "")
    planner_model: str = os.environ.get("CUA_PLANNER_MODEL", "qwen3.7-plus")
    # dedicated grounder (GUI-Owl-1.5 via vLLM). 0-1000 coords -> grounding_dim=1000.
    grounder_base_url: str = os.environ.get("CUA_GROUNDER_BASE_URL", "http://127.0.0.1:18901/v1")
    grounder_api_key: str = os.environ.get("CUA_GROUNDER_API_KEY", "EMPTY")
    grounder_model: str = os.environ.get("CUA_GROUNDER_MODEL", "gui-owl-1.5-8b")
    grounding_dim: int = int(os.environ.get("CUA_GROUNDING_DIM", "1000"))
    # loop / safety
    max_steps: int = int(os.environ.get("CUA_MAX_STEPS", "15"))
    # destructive actions are OFF unless the caller both sets execute and approves.
    allow_execute: bool = os.environ.get("CUA_ALLOW_EXECUTE", "false").lower() == "true"
    # paint a click-through mouse overlay on the real desktop during live execution
    # (Windows; degrades to no-op elsewhere). Off => no visualization.
    show_overlay: bool = os.environ.get("CUA_SHOW_OVERLAY", "true").lower() == "true"
    port: int = int(os.environ.get("CUA_PORT", "3900"))
    artifact_dir: str = os.environ.get("CUA_ARTIFACT_DIR", os.path.join(os.getcwd(), "cua-runs"))

    def planner_params(self) -> dict:
        return {"engine_type": "openai", "model": self.planner_model,
                "base_url": self.planner_base_url, "api_key": self.planner_api_key}

    def grounder_params(self) -> dict:
        return {"engine_type": "openai", "model": self.grounder_model,
                "base_url": self.grounder_base_url, "api_key": self.grounder_api_key,
                "grounding_width": self.grounding_dim, "grounding_height": self.grounding_dim}


CONFIG = Config()
