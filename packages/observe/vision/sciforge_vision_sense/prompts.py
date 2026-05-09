from __future__ import annotations

from typing import Iterable, Mapping


def build_completion_check_prompt(
    *,
    task: str,
    step_history: Iterable[Mapping[str, object]] | None = None,
) -> str:
    return "\n".join(
        [
            "You are the completion checker for a pure-vision GUI agent.",
            "Inspect the screenshot and decide whether the user's task is complete.",
            "Return only JSON with this schema:",
            '{"done": boolean, "reason": string, "confidence": number}',
            "The confidence must be between 0 and 1.",
            f"Task: {task}",
            f"Recent step history: {list(step_history or [])}",
        ]
    )


def build_planner_prompt(
    *,
    task: str,
    screen_summary: str,
    visible_texts: Iterable[str] | None = None,
    recent_actions: Iterable[Mapping[str, object]] | None = None,
) -> str:
    return "\n".join(
        [
            "You are the planner for a pure-vision GUI agent.",
            "Return exactly one JSON object and no prose.",
            "Allowed actions: click, type_text, press_key, scroll, wait, done.",
            "Allowed JSON fields:",
            "action_type, target_description, text, key, direction, amount, reason",
            "The action must use target_description as a natural-language visual target.",
            "Never include coordinates or grid locations. Forbidden fields include x, y, coordinates, coordinate, bbox, bounding_box, point, row, column, left, top, width, height.",
            "Do not put coordinates in target_description, including pixel positions, x/y pairs, row/column locations, or '(number, number)' references.",
            "Example click target_description: the blue Search button near the query field.",
            f"Task: {task}",
            f"Screen summary: {screen_summary}",
            f"Visible texts: {list(visible_texts or [])}",
            f"Recent actions: {list(recent_actions or [])}",
        ]
    )


def build_screen_summary_prompt(*, task: str) -> str:
    return "\n".join(
        [
            "You summarize the current screenshot for a pure-vision GUI agent.",
            "Return one concise sentence describing the visible app/page state.",
            "Do not mention DOM, accessibility tree, hidden state, or coordinates.",
            f"Task: {task}",
        ]
    )


def build_visible_texts_prompt(*, task: str) -> str:
    return "\n".join(
        [
            "You extract visible text from the screenshot for a pure-vision GUI agent.",
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
