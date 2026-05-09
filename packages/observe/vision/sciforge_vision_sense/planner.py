from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Mapping


ALLOWED_ACTION_FIELDS = {
    "action_type",
    "target_description",
    "text",
    "key",
    "direction",
    "amount",
    "reason",
}

FORBIDDEN_COORDINATE_FIELDS = {
    "x",
    "y",
    "xy",
    "coordinate",
    "coordinates",
    "coord",
    "coords",
    "bbox",
    "bounding_box",
    "box",
    "point",
    "position",
    "location",
    "row",
    "column",
    "col",
    "left",
    "right",
    "top",
    "bottom",
    "width",
    "height",
}

ACTION_TYPES = {"click", "type_text", "press_key", "scroll", "wait", "done"}

COORDINATE_PATTERNS = [
    re.compile(r"\b[xy]\s*[:=]\s*-?\d+(?:\.\d+)?\b", re.IGNORECASE),
    re.compile(r"\b(?:row|column|col)\s*[:#]?\s*\d+\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*(?:px|pixel|pixels)\b", re.IGNORECASE),
    re.compile(r"[\(\[]\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*[\)\]]"),
    re.compile(r"\b(?:coordinate|coordinates|coord|coords|bbox|bounding box|point)\b", re.IGNORECASE),
]


class PlannerParseError(ValueError):
    pass


class PlannerValidationError(ValueError):
    pass


@dataclass(frozen=True)
class PlannerAction:
    action_type: str
    target_description: str = ""
    text: str | None = None
    key: str | None = None
    direction: str | None = None
    amount: int | float | None = None
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {key: value for key, value in self.__dict__.items() if value is not None}


def extract_json_object(text: str) -> Mapping[str, Any]:
    if not text or not text.strip():
        raise PlannerParseError("Planner response is empty")

    candidates = _json_candidates(text)
    errors: list[str] = []
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError as exc:
            errors.append(str(exc))
            continue
        if not isinstance(value, dict):
            raise PlannerParseError("Planner JSON must be an object")
        return value

    raise PlannerParseError(f"No valid JSON object found in planner response: {errors[:2]}")


def parse_planner_action(response_text: str) -> PlannerAction:
    payload = dict(extract_json_object(response_text))
    return validate_planner_action(payload)


def validate_planner_action(payload: Mapping[str, Any]) -> PlannerAction:
    normalized = _normalize_keys(payload)
    fields = set(normalized)
    forbidden = fields & FORBIDDEN_COORDINATE_FIELDS
    if forbidden:
        raise PlannerValidationError(f"Planner action contains forbidden coordinate fields: {sorted(forbidden)}")

    unknown = fields - ALLOWED_ACTION_FIELDS
    if unknown:
        raise PlannerValidationError(f"Planner action contains unsupported fields: {sorted(unknown)}")

    action_type = normalized.get("action_type")
    if not isinstance(action_type, str) or action_type not in ACTION_TYPES:
        raise PlannerValidationError(f"Planner action_type must be one of {sorted(ACTION_TYPES)}")

    target_description = normalized.get("target_description", "")
    if target_description is None:
        target_description = ""
    if not isinstance(target_description, str):
        raise PlannerValidationError("Planner target_description must be a string")
    if _contains_coordinate_expression(target_description):
        raise PlannerValidationError("Planner target_description contains a coordinate-like expression")

    return PlannerAction(
        action_type=action_type,
        target_description=target_description,
        text=_optional_string(normalized, "text"),
        key=_optional_string(normalized, "key"),
        direction=_optional_string(normalized, "direction"),
        amount=_optional_number(normalized, "amount"),
        reason=_optional_string(normalized, "reason"),
    )


def _json_candidates(text: str) -> list[str]:
    stripped = text.strip()
    candidates = [stripped]
    candidates.extend(match.group(1).strip() for match in re.finditer(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE))

    start = text.find("{")
    while start != -1:
        end = _matching_json_object_end(text, start)
        if end is not None:
            candidates.append(text[start : end + 1])
        start = text.find("{", start + 1)

    deduped: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _matching_json_object_end(text: str, start: int) -> int | None:
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return None


def _normalize_keys(payload: Mapping[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            raise PlannerValidationError("Planner JSON keys must be strings")
        normalized[_camel_to_snake(key)] = value
    return normalized


def _camel_to_snake(value: str) -> str:
    value = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", value)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value).lower()


def _contains_coordinate_expression(value: str) -> bool:
    return any(pattern.search(value) for pattern in COORDINATE_PATTERNS)


def _optional_string(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise PlannerValidationError(f"Planner {key} must be a string")
    return value


def _optional_number(payload: Mapping[str, Any], key: str) -> int | float | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise PlannerValidationError(f"Planner {key} must be a number")
    return value
