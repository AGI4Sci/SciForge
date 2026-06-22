"""Drive the validated SOTA agent loop (Agent-S / AgentS2_5) with our stack.

We do NOT reinvent the loop — AgentS2_5 (OSWorld SOTA, Worker + reflection, no
external search dep) IS the loop. We only supply:
  * planner engine  -> qwen3.7-plus (gateway)
  * grounder        -> GUI-Owl-1.5-8b (vLLM)   [via OSWorldACI engine_params_for_grounding]
  * the screen      -> static image (safe test) or live DesktopExecutor (real run)
  * the hands       -> DesktopExecutor (cross-platform; dry_run by default)

Modes:
  --image <png>   feed a static screenshot as the observation (no real desktop) — SAFE
  --live          capture the real screen each step via DesktopExecutor
  --execute       actually perform actions (default: dry-run = print only)

Each step prints the agent's plan + the grounded action code it emits.
"""
from __future__ import annotations
import argparse
import io
import os
import sys
from pathlib import Path

from PIL import Image

GW = "http://35.220.164.252:3888/v1"
KEY = os.environ.get("QWEN_API_KEY", "")  # set QWEN_API_KEY; never hardcode secrets
GROUND_URL = os.environ.get("GUIOWL_BASE_URL", "http://127.0.0.1:18901/v1")


def build_agent(width: int, height: int):
    from gui_agents.s2_5.agents.grounding import OSWorldACI
    from gui_agents.s2_5.agents.agent_s import AgentS2_5
    gen = {"engine_type": "openai", "model": "qwen3.7-plus", "base_url": GW, "api_key": KEY}
    grd = {"engine_type": "openai", "model": "gui-owl-1.5-8b", "base_url": GROUND_URL,
           "api_key": "EMPTY", "grounding_width": 1000, "grounding_height": 1000}
    aci = OSWorldACI(platform="windows", engine_params_for_generation=gen,
                     engine_params_for_grounding=grd, width=width, height=height)
    agent = AgentS2_5(gen, aci, platform="windows", enable_reflection=True)
    return agent, aci


def to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instruction", required=True)
    ap.add_argument("--image", help="static screenshot file (safe test mode)")
    ap.add_argument("--live", action="store_true", help="capture real screen each step")
    ap.add_argument("--execute", action="store_true", help="actually perform actions")
    ap.add_argument("--max-steps", type=int, default=8)
    args = ap.parse_args()

    executor = None
    if args.live:
        sys.path.insert(0, str(Path(__file__).parent))
        from driver.desktop import DesktopExecutor
        executor = DesktopExecutor(dry_run=not args.execute)
        w, h = executor.screen_size()
    else:
        base = Image.open(args.image).convert("RGB")
        w, h = base.size

    agent, aci = build_agent(w, h)
    print(f"task: {args.instruction!r} | screen {w}x{h} | "
          f"mode={'live' if args.live else 'image'} execute={args.execute}\n")

    for step in range(args.max_steps):
        img = executor.screenshot() if args.live else base
        obs = {"screenshot": to_png_bytes(img)}
        info, code = agent.predict(instruction=args.instruction, observation=obs)
        action = code[0] if code else ""
        print(f"--- step {step+1} ---")
        print("  plan:", (info.get("executor_plan") or info.get("plan") or "")[:300].replace("\n", " "))
        print("  grounded action:", action[:200])
        print("  coords:", getattr(aci, "coords1", None), getattr(aci, "coords2", None))

        low = action.lower()
        if "done" in low or "fail" in low:
            print(f"\n=== agent terminated: {action} ==="); break
        if "wait" in low or "next" in low:
            continue
        if args.live and args.execute:
            try:
                exec(action, {"agent": aci, "time": __import__("time")})
            except Exception as e:  # noqa: BLE001
                print("  exec error:", e)
        elif not args.live:
            print("  (image mode: not executing; loop would re-screenshot a live desktop)")
            break


if __name__ == "__main__":
    main()
