"""Wire the validated SOTA loop (Agent-S / AgentS2_5) with our grounder + planner.

We do not reimplement the agent loop. AgentS2_5 (OSWorld SOTA, Worker + reflection,
no external-search dependency) is the loop; we only inject:
  planner  -> qwen3.7-plus      (engine_params)
  grounder -> GUI-Owl-1.5-8b    (engine_params_for_grounding, 0-1000 -> grounding_dim)
"""
from __future__ import annotations
import platform as _platform

from .config import Config


def build_agent(cfg: Config, width: int, height: int):
    from gui_agents.s2_5.agents.grounding import OSWorldACI
    from gui_agents.s2_5.agents.agent_s import AgentS2_5

    os_name = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(
        _platform.system(), "linux")
    aci = OSWorldACI(
        platform=os_name,
        engine_params_for_generation=cfg.planner_params(),
        engine_params_for_grounding=cfg.grounder_params(),
        width=width,
        height=height,
    )
    agent = AgentS2_5(cfg.planner_params(), aci, platform=os_name, enable_reflection=True)
    return agent, aci, os_name
