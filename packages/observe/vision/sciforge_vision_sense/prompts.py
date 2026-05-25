from __future__ import annotations

from typing import Iterable, Mapping


def build_completion_check_prompt(
    *,
    task: str,
    step_history: Iterable[Mapping[str, object]] | None = None,
) -> str:
    return "\n".join(
        [
            "You are the visual completion checker for a sense-only vision helper.",
            "Inspect the screenshot and decide whether the user's task is complete.",
            "Return only JSON with this schema:",
            '{"done": boolean, "reason": string, "confidence": number}',
            "The confidence must be between 0 and 1.",
            f"Task: {task}",
            f"Recent step history: {list(step_history or [])}",
        ]
    )


def build_screen_summary_prompt(*, task: str) -> str:
    return "\n".join(
        [
            "You summarize the current screenshot for a sense-only vision helper.",
            "Return one concise sentence describing the visible app/page state.",
            "Do not mention DOM, accessibility tree, hidden state, or coordinates.",
            f"Task: {task}",
        ]
    )


def build_visible_texts_prompt(*, task: str) -> str:
    return "\n".join(
        [
            "You extract visible text from the screenshot for a sense-only vision helper.",
            "Return only JSON with this schema:",
            '{"visible_texts": [{"text": string, "approximateRegion": string}]}',
            "Use approximate visual regions such as top, center, left panel, modal, or bottom right.",
            "Do not include DOM selectors, accessibility nodes, or coordinates.",
            f"Task: {task}",
        ]
    )


def build_crosshair_verification_prompt(*, target_description: str) -> str:
    return "\n".join(
        [
            "You are verifying a GUI grounding result using a screenshot with a crosshair overlay.",
            "Decide whether the crosshair is on the intended visual target.",
            "Return only JSON with this schema:",
            '{"hit": boolean, "reason": string, "confidence": number, "revised_target_description": string}',
            "If hit is false, revised_target_description must describe the intended target using visual language only.",
            "Never include coordinates, bounding boxes, rows, columns, or pixel positions.",
            f"Target description: {target_description}",
        ]
    )
