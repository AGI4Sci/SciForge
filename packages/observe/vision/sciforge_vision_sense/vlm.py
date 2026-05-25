from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class VisionVlmConfig:
    base_url: str
    api_key: str
    model: str = "qwen3.6-plus"
    timeout_seconds: float = 60.0
    max_retries: int = 2
    headers: Mapping[str, str] = field(default_factory=dict)


class VisionVlmError(RuntimeError):
    pass


@dataclass(frozen=True)
class ParsedCompletionCheck:
    done: bool
    reason: str
    confidence: float


@dataclass(frozen=True)
class ParsedCrosshairVerification:
    hit: bool
    reason: str
    confidence: float
    revised_target_description: str


@dataclass(frozen=True)
class ParsedVisibleText:
    text: str
    approximate_region: str


class VisionVlmClient:
    def __init__(self, config: VisionVlmConfig):
        if not config.base_url:
            raise ValueError("VisionVlmConfig.base_url is required")
        if not config.api_key:
            raise ValueError("VisionVlmConfig.api_key is required")
        self.config = config

    def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        temperature: float = 0.0,
        response_format: Mapping[str, Any] | None = None,
    ) -> str:
        response = self.chat_completions(
            messages,
            temperature=temperature,
            response_format=response_format,
        )
        try:
            return response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise VisionVlmError("VLM response did not contain choices[0].message.content") from exc

    def chat_completions(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        temperature: float = 0.0,
        response_format: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": list(messages),
            "temperature": temperature,
        }
        if response_format is not None:
            payload["response_format"] = response_format

        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self._chat_completions_url(),
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
                **dict(self.config.headers),
            },
        )

        last_error: Exception | None = None
        for attempt in range(self.config.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.config.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt >= self.config.max_retries:
                    break
                time.sleep(min(0.25 * (2**attempt), 2.0))

        raise VisionVlmError(f"VLM chat completion request failed: {last_error}") from last_error

    def user_message_with_image(
        self,
        text: str,
        *,
        image_base64: str,
        mime_type: str = "image/png",
    ) -> dict[str, Any]:
        return build_user_message_with_image(text, image_base64=image_base64, mime_type=mime_type)

    def _chat_completions_url(self) -> str:
        base_url = self.config.base_url.rstrip("/")
        if base_url.endswith("/chat/completions"):
            return base_url
        return f"{base_url}/chat/completions"


def encode_image_file(path: str | Path) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def build_user_message_with_image(
    text: str,
    *,
    image_base64: str,
    mime_type: str = "image/png",
) -> dict[str, Any]:
    return {
        "role": "user",
        "content": [
            {"type": "text", "text": text},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{image_base64}"},
            },
        ],
    }


def parse_completion_check_response(response_text: str) -> ParsedCompletionCheck:
    try:
        payload = _extract_json_object(response_text)
    except VisionVlmError as exc:
        raise VisionVlmError(f"completion check response is not valid JSON: {exc}") from exc

    done = payload.get("done")
    reason = payload.get("reason")
    confidence = payload.get("confidence")
    if not isinstance(done, bool):
        raise VisionVlmError("completion check field done must be boolean")
    if not isinstance(reason, str):
        raise VisionVlmError("completion check field reason must be string")
    return ParsedCompletionCheck(
        done=done,
        reason=reason,
        confidence=_confidence(confidence, "completion check"),
    )


def parse_crosshair_verification_response(response_text: str) -> ParsedCrosshairVerification:
    try:
        payload = _extract_json_object(response_text)
    except VisionVlmError as exc:
        raise VisionVlmError(f"crosshair verification response is not valid JSON: {exc}") from exc

    hit = payload.get("hit")
    reason = payload.get("reason")
    confidence = payload.get("confidence")
    revised = payload.get("revised_target_description")
    if revised is None:
        revised = payload.get("revisedTargetDescription", "")
    if not isinstance(hit, bool):
        raise VisionVlmError("crosshair verification field hit must be boolean")
    if not isinstance(reason, str):
        raise VisionVlmError("crosshair verification field reason must be string")
    if not isinstance(revised, str):
        raise VisionVlmError("crosshair verification revised_target_description must be string")
    if revised:
        _validate_revised_target_description(revised)
    return ParsedCrosshairVerification(
        hit=hit,
        reason=reason,
        confidence=_confidence(confidence, "crosshair verification"),
        revised_target_description=revised,
    )


def parse_visible_texts_response(response_text: str) -> list[ParsedVisibleText]:
    try:
        payload = _extract_json_object(response_text)
    except VisionVlmError as exc:
        raise VisionVlmError(f"visible texts response is not valid JSON: {exc}") from exc

    values = payload.get("visible_texts")
    if values is None:
        values = payload.get("visibleTexts")
    if not isinstance(values, list):
        raise VisionVlmError("visible texts response must contain visible_texts list")

    parsed: list[ParsedVisibleText] = []
    for index, item in enumerate(values):
        if not isinstance(item, Mapping):
            raise VisionVlmError(f"visible_texts[{index}] must be an object")
        text = item.get("text")
        region = item.get("approximateRegion", item.get("approximate_region", ""))
        if not isinstance(text, str):
            raise VisionVlmError(f"visible_texts[{index}].text must be a string")
        if not isinstance(region, str):
            raise VisionVlmError(
                f"visible_texts[{index}].approximateRegion must be a string"
            )
        if _looks_coordinate_like(region):
            raise VisionVlmError(
                f"visible_texts[{index}].approximateRegion must not contain coordinates"
            )
        parsed.append(ParsedVisibleText(text=text, approximate_region=region))
    return parsed


def _confidence(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VisionVlmError(f"{label} confidence must be a number")
    confidence = float(value)
    if confidence < 0 or confidence > 1:
        raise VisionVlmError(f"{label} confidence must be between 0 and 1")
    return confidence


def _validate_revised_target_description(value: str) -> None:
    if _contains_coordinate_expression(value):
        raise VisionVlmError("crosshair revised_target_description must not contain coordinates")


def _looks_coordinate_like(value: str) -> bool:
    return _contains_coordinate_expression(value)


COORDINATE_PATTERNS = [
    re.compile(r"\b[xy]\s*[:=]\s*-?\d+(?:\.\d+)?\b", re.IGNORECASE),
    re.compile(r"\b(?:row|column|col)\s*[:#]?\s*\d+\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*(?:px|pixel|pixels)\b", re.IGNORECASE),
    re.compile(r"[\(\[]\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*[\)\]]"),
    re.compile(r"\b(?:coordinate|coordinates|coord|coords|bbox|bounding box|point)\b", re.IGNORECASE),
]


def _extract_json_object(text: str) -> Mapping[str, Any]:
    if not text or not text.strip():
        raise VisionVlmError("VLM response is empty")

    candidates = _json_candidates(text)
    errors: list[str] = []
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError as exc:
            errors.append(str(exc))
            continue
        if not isinstance(value, dict):
            raise VisionVlmError("VLM JSON must be an object")
        return value

    raise VisionVlmError(f"No valid JSON object found in VLM response: {errors[:2]}")


def _json_candidates(text: str) -> list[str]:
    stripped = text.strip()
    candidates = [stripped]
    candidates.extend(
        match.group(1).strip()
        for match in re.finditer(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    )

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


def _contains_coordinate_expression(value: str) -> bool:
    return any(pattern.search(value) for pattern in COORDINATE_PATTERNS)
