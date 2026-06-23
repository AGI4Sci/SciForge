"""Reflector — the official Mobile-Agent-v3 action-reflection module.

After each executed action, GUI-Owl is shown the before/after screenshots and
asked to judge whether the action achieved its intent. It returns four sections
(Screenshot Difference / Outcome / Error Description / Progress Status); we parse
the A/B/C outcome and a running progress note.

The prompt + parser are reproduced VERBATIM from X-PLUG/MobileAgent
(Mobile-Agent-v3, os_world_v3/mm_agents/mobileagent_v3/mobile_agent_modules.py,
class Reflector), the only change being the OS word in the opening sentence so it
matches the real desktop instead of the hard-coded "Ubuntu".

In the full framework the Reflector's failures escalate to a Manager that
re-plans; our loop has no separate Manager (GUI-Owl is the whole agent), so the
runner feeds the outcome/progress/error back into the next step's prompt and lets
the native model re-plan itself.
"""
from __future__ import annotations

import platform as _platform
from typing import Any, Dict, Optional

from PIL import Image

from . import owl_agent
from .config import Config

_OS_NAME = {"Windows": "Windows", "Darwin": "macOS", "Linux": "Ubuntu"}.get(
    _platform.system(), "Ubuntu")


def build_prompt(instruction: str, progress_status: str, current_subgoal: str,
                 last_action: Any, last_summary: str, platform: str = _OS_NAME) -> str:
    """Verbatim Mobile-Agent-v3 Reflector.get_prompt (OS word parameterized)."""
    prompt = (f"You are an agent who can operate an {platform} computer on behalf "
              "of a user. Your goal is to verify whether the last action produced "
              "the expected behavior and to keep track of the overall progress.\n\n")

    prompt += "### User Request ###\n"
    prompt += f"{instruction}\n\n"

    prompt += "### Progress Status ###\n"
    if progress_status != "":
        prompt += f"{progress_status}\n\n"
    else:
        prompt += "No progress yet.\n\n"

    prompt += "### Current Subgoal ###\n"
    prompt += f"{current_subgoal}\n\n"

    prompt += "---\n"
    prompt += ("The two attached images are computer screenshots taken before and "
               "after your last action. You should observe them carefully to verify "
               "whether the action achieves the expected result.\n")

    prompt += "---\n"
    prompt += "### Latest Action ###\n"
    prompt += f"Action: {last_action}\n"
    prompt += f"Expectation: {last_summary}\n\n"

    prompt += "---\n"
    prompt += ("Carefully examine the information provided above to determine whether "
               "the last action produced the expected behavior. If the action was "
               "successful, update the progress status accordingly. If the action "
               "failed, identify the failure mode and provide reasoning on the "
               "potential reason causing this failure. Note that for the `scroll` "
               "action, it may take multiple attempts to display the expected content. "
               "Thus, for a `scroll` action, if the screen shows new content, it "
               "usually meets the expectation.\nPro Tip: In rare cases, the UI might "
               "not visibly change even if a click action is performed correctly — for "
               "example, when clicking on a color before drawing. In such situations, "
               "you can assume the action was successful and proceed — for example, by "
               "drawing a line.\n\n")

    prompt += ("When the user instruction involves adjusting some values (e.g., "
               "brightness, contrast, steps), be sure to check if the values meet "
               "expectations after the operation.\n\n")

    prompt += "Provide your output in the following format containing four parts:\n\n"

    prompt += "### Screenshot Difference ###\n"
    prompt += ("Describte the main differences between the screenshots taken before "
               "and after the last action.\n")

    prompt += "### Outcome ###\n"
    prompt += "Choose from the following options. Give your response as \"A\", \"B\" or \"C\":\n"
    prompt += "A: Successful or Partially Successful. The result of the last action meets the expectation.\n"
    prompt += "B: Failed. The last action results in a wrong page. I need to return to the previous state.\n"
    prompt += "C: Failed. The last action produces no changes.\n\n"

    prompt += "### Error Description ###\n"
    prompt += ("If the action failed, provide a detailed description of the error and "
               "the potential reason causing this failure. If the action succeeded, "
               "put \"None\" here.\n\n")

    prompt += "### Progress Status ###\n"
    prompt += ("If the action was successful or partially successful, update the "
               "progress status. If the action failed, copy the previous progress "
               "status.\n")

    return prompt


def parse_response(response: str) -> Dict[str, str]:
    """Verbatim Mobile-Agent-v3 Reflector.parse_response."""
    outcome = response.split("### Outcome ###")[-1].split("### Error Description ###")[0].replace("\n", " ").replace("  ", " ").strip()
    error_description = response.split("### Error Description ###")[-1].split("### Progress Status ###")[0].replace("\n", " ").replace("  ", " ").strip()
    progress_status = response.split("### Progress Status ###")[-1].replace("\n", " ").replace("  ", " ").strip()
    return {"outcome": outcome, "error_description": error_description, "progress_status": progress_status}


def _classify(outcome_text: str) -> str:
    """Map the parsed Outcome section to A/B/C (Mobile-Agent-v3 uses `'X' in outcome`).
    Order matters: a failed reflection should not silently pass, so prefer B/C when
    present; default to A only when no verdict letter is found (fail-open: keep going)."""
    head = outcome_text[:40]  # the verdict letter leads the section; avoid stray letters in prose
    if "B" in head:
        return "B"
    if "C" in head:
        return "C"
    if "A" in head:
        return "A"
    return "A"


def reflect(cfg: Config, instruction: str, progress_status: str, current_subgoal: str,
            last_action: Any, last_summary: str,
            before_img: Image.Image, after_img: Image.Image) -> Dict[str, Any]:
    """Run one reflection turn. Returns {outcome:'A'|'B'|'C', error_description,
    progress_status, raw}. Raises on transport error (caller is fail-open)."""
    prompt = build_prompt(instruction, progress_status, current_subgoal, last_action, last_summary)
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": owl_agent._png_data_url(before_img)}},
            {"type": "image_url", "image_url": {"url": owl_agent._png_data_url(after_img)}},
        ]},
    ]
    model = cfg.reflect_model or cfg.model_name
    text = owl_agent.call_owl(cfg.model_base_url, model, cfg.model_api_key, messages, max_tokens=512)
    parsed = parse_response(text)
    parsed["outcome"] = _classify(parsed["outcome"])
    parsed["raw"] = text
    return parsed
