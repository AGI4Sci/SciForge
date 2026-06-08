from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class VisionVlmConfig:
    base_url: str = field(default_factory=lambda: _default_router_base_url())
    api_key: str = field(default_factory=lambda: _default_router_api_key())
    model: str = field(default_factory=lambda: _default_router_model())
    profile: str = field(default_factory=lambda: _default_router_profile())
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
        _normalize_router_base_url(config.base_url)
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
        content = response.get("output_text")
        if isinstance(content, str):
            return content
        try:
            return response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise VisionVlmError("vision verifier response did not contain output_text") from exc

    def chat_completions(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        temperature: float = 0.0,
        response_format: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        payload: dict[str, Any] = {
            "model": self.config.model,
            "input": responses_input_from_messages(messages),
            "metadata": {"profile": self.config.profile},
            "temperature": temperature,
        }
        if response_format is not None:
            payload["response_format"] = response_format

        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self._responses_url(),
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

        raise VisionVlmError(f"vision verifier chat completion request failed: {last_error}") from last_error

    def user_message_with_image(
        self,
        text: str,
        *,
        image_base64: str,
        mime_type: str = "image/png",
    ) -> dict[str, Any]:
        return build_user_message_with_image(text, image_base64=image_base64, mime_type=mime_type)

    def _responses_url(self) -> str:
        return f"{_normalize_router_base_url(self.config.base_url)}/responses"

    def _chat_completions_url(self) -> str:
        return self._responses_url()


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
            {"type": "input_text", "text": text},
            {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{image_base64}",
                "mime_type": mime_type,
            },
        ],
    }


def responses_input_from_messages(messages: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [_responses_message(message) for message in messages]


def _responses_message(message: Mapping[str, Any]) -> dict[str, Any]:
    role = message.get("role", "user")
    content = message.get("content", "")
    return {
        "role": role if isinstance(role, str) else "user",
        "content": _responses_content(content),
    }


def _responses_content(content: Any) -> list[Any]:
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    if isinstance(content, Sequence) and not isinstance(content, (bytes, bytearray, str)):
        return [_responses_content_part(part) for part in content]
    return [{"type": "input_text", "text": str(content)}]


def _responses_content_part(part: Any) -> Any:
    if not isinstance(part, Mapping):
        return part
    part_type = part.get("type")
    if part_type in ("input_text", "text"):
        text = part.get("text", part.get("content", ""))
        return {"type": "input_text", "text": text if isinstance(text, str) else str(text)}
    if part_type in ("input_image", "image_url") or "image_url" in part:
        image_url = _image_url_value(part.get("image_url"))
        if image_url:
            converted: dict[str, Any] = {"type": "input_image", "image_url": image_url}
            mime_type = part.get("mime_type", part.get("mimeType")) or _mime_type_from_data_url(image_url)
            if isinstance(mime_type, str) and mime_type:
                converted["mime_type"] = mime_type
            return converted
    return dict(part)


def _default_router_base_url() -> str:
    explicit = (
        os.environ.get("SCIFORGE_MODEL_ROUTER_BASE_URL")
        or os.environ.get("SCIFORGE_MODEL_ROUTER_URL")
    )
    if explicit:
        return _normalize_router_base_url(explicit)
    port = os.environ.get("SCIFORGE_MODEL_ROUTER_PORT")
    if port and port.isdigit():
        host = os.environ.get("SCIFORGE_MODEL_ROUTER_HOST") or "127.0.0.1"
        return f"http://{host}:{int(port)}/v1"
    return ""


def _default_router_api_key() -> str:
    return (
        os.environ.get("SCIFORGE_RUNTIME_API_KEY")
        or os.environ.get("SCIFORGE_MODEL_ROUTER_API_KEY")
        or ""
    )


def _default_router_model() -> str:
    return os.environ.get("SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS") or "sciforge-router"


def _default_router_profile() -> str:
    return (
        os.environ.get("SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE")
        or os.environ.get("SCIFORGE_MODEL_ROUTER_PROFILE")
        or "sciforge-runtime-default"
    )


def _normalize_router_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    if not base_url:
        return ""
    if re.search(r"/chat/completions$", base_url, re.IGNORECASE):
        raise ValueError(
            "VisionVlmConfig.base_url must point to the Model Router /v1 endpoint, not /chat/completions"
        )
    if re.search(r"/v1/responses$", base_url, re.IGNORECASE):
        return re.sub(r"/responses$", "", base_url, flags=re.IGNORECASE)
    if re.search(r"/v1$", base_url, re.IGNORECASE):
        return base_url
    return f"{base_url}/v1"


def _image_url_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        url = value.get("url")
        return url if isinstance(url, str) else ""
    return ""


def _mime_type_from_data_url(value: str) -> str:
    match = re.match(r"^data:([^;,]+)", value)
    return match.group(1) if match else ""


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
        raise VisionVlmError("vision verifier response is empty")

    candidates = _json_candidates(text)
    errors: list[str] = []
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError as exc:
            errors.append(str(exc))
            continue
        if not isinstance(value, dict):
            raise VisionVlmError("vision verifier JSON must be an object")
        return value

    raise VisionVlmError(f"No valid JSON object found in verifier response: {errors[:2]}")


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
