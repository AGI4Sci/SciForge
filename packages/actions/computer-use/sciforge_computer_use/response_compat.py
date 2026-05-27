"""Small Responses/Chat Completions compatibility helpers.

The backend owns the full proxy. The Computer Use package only needs a
dependency-free subset for package-local verifier probes and diagnostics.
"""

from __future__ import annotations

import json
import time
from itertools import count
from typing import Any, Mapping, Sequence


_ID_COUNTER = count()


def responses_to_chat_completions(value: Mapping[str, Any], *, default_model: str | None = None) -> dict[str, Any]:
    """Convert a minimal Responses request shape into Chat Completions."""

    model = _string_or_none(value.get("model")) or default_model
    if not model:
        raise ValueError("Responses request must include model or default_model.")

    messages: list[dict[str, Any]] = []
    instructions = text_from_content(value.get("instructions"))
    if instructions:
        messages.append({"role": "system", "content": instructions})
    messages.extend(_input_to_messages(value.get("input")))
    if not messages:
        messages.append({"role": "user", "content": ""})

    request: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    if value.get("stream") is True:
        request["stream"] = True
    if value.get("temperature") is not None:
        request["temperature"] = value.get("temperature")
    if value.get("top_p") is not None:
        request["top_p"] = value.get("top_p")
    max_output_tokens = value.get("max_output_tokens")
    max_tokens = value.get("max_tokens")
    if max_output_tokens is not None or max_tokens is not None:
        request["max_tokens"] = max_output_tokens if max_output_tokens is not None else max_tokens
    tools = _tools_to_chat_tools(value.get("tools"))
    if tools:
        request["tools"] = tools
    if value.get("tool_choice") is not None:
        request["tool_choice"] = value.get("tool_choice")
    if value.get("parallel_tool_calls") is not None:
        request["parallel_tool_calls"] = value.get("parallel_tool_calls")
    if value.get("metadata") is not None:
        request["metadata"] = value.get("metadata")
    return request


def chat_completions_to_responses(value: Mapping[str, Any], *, default_model: str | None = None) -> dict[str, Any]:
    """Convert a minimal Chat Completions request shape into Responses."""

    model = _string_or_none(value.get("model")) or default_model
    if not model:
        raise ValueError("Chat Completions request must include model or default_model.")

    messages = value.get("messages") if isinstance(value.get("messages"), list) else []
    instructions: list[str] = []
    input_items: list[dict[str, Any]] = []
    for message in messages:
        record = _mapping(message)
        role = _normalize_role(record.get("role"))
        if role == "system":
            instruction = text_from_content(record.get("content")).strip()
            if instruction:
                instructions.append(instruction)
            continue
        if role == "tool":
            input_items.append({
                "type": "function_call_output",
                "call_id": _string_or_none(record.get("tool_call_id")) or _make_id("call"),
                "output": text_from_content(record.get("content")),
            })
            continue
        if role == "assistant":
            content = _chat_content_to_responses_content(record.get("content"), role="assistant")
            if content:
                input_items.append({"role": "assistant", "content": content})
            tool_calls = record.get("tool_calls") if isinstance(record.get("tool_calls"), list) else []
            for tool_call in tool_calls:
                item = _chat_tool_call_to_response_item(tool_call)
                if item:
                    input_items.append(item)
            continue

        content = _chat_content_to_responses_content(record.get("content"), role="user")
        input_items.append({"role": "user", "content": content or [{"type": "input_text", "text": ""}]})

    if not input_items:
        input_items.append({"role": "user", "content": [{"type": "input_text", "text": ""}]})

    request: dict[str, Any] = {
        "model": model,
        "input": input_items,
    }
    if instructions:
        request["instructions"] = "\n".join(instructions)
    if value.get("temperature") is not None:
        request["temperature"] = value.get("temperature")
    if value.get("top_p") is not None:
        request["top_p"] = value.get("top_p")
    max_tokens = value.get("max_tokens")
    max_output_tokens = value.get("max_output_tokens")
    if max_output_tokens is not None or max_tokens is not None:
        request["max_output_tokens"] = max_output_tokens if max_output_tokens is not None else max_tokens
    tools = _chat_tools_to_responses_tools(value.get("tools"))
    if tools:
        request["tools"] = tools
    if value.get("tool_choice") is not None:
        request["tool_choice"] = _chat_tool_choice_to_responses(value.get("tool_choice"))
    if value.get("parallel_tool_calls") is not None:
        request["parallel_tool_calls"] = value.get("parallel_tool_calls")
    if value.get("metadata") is not None:
        request["metadata"] = value.get("metadata")
    return request


def chat_completion_to_response(value: Mapping[str, Any], *, model: str | None = None) -> dict[str, Any]:
    """Convert a non-streaming Chat Completions object into Responses shape."""

    choices = value.get("choices") if isinstance(value.get("choices"), list) else []
    first = _mapping(choices[0]) if choices else {}
    message = _mapping(first.get("message"))
    text = text_from_content(message.get("content"))
    output: list[dict[str, Any]] = []
    if text:
        output.append(message_output_item(text))

    tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []
    for tool_call in tool_calls:
        item = _chat_tool_call_to_response_item(tool_call)
        if item:
            output.append(item)

    return _compact({
        "id": _string_or_none(value.get("id")) or _make_id("resp"),
        "object": "response",
        "created_at": value.get("created") if isinstance(value.get("created"), (int, float)) else int(time.time()),
        "model": _string_or_none(value.get("model")) or model or "unknown",
        "status": "completed",
        "output": output,
        "output_text": text,
        "usage": value.get("usage"),
    })


def extract_provider_text(value: Mapping[str, Any]) -> str:
    """Extract assistant text from either Responses or Chat Completions."""

    output_text = value.get("output_text")
    if isinstance(output_text, str) and output_text.strip() and not _contains_forbidden_inline_payload(output_text):
        return output_text

    output = value.get("output")
    if isinstance(output, list):
        texts: list[str] = []
        for item in output:
            content = _mapping(item).get("content")
            if isinstance(content, str) and content.strip() and not _contains_forbidden_inline_payload(content):
                texts.append(content.strip())
                continue
            if isinstance(content, list):
                for part in content:
                    part_map = _mapping(part)
                    if _looks_like_image_part(part_map):
                        continue
                    text = part_map.get("text") or part_map.get("output_text")
                    if isinstance(text, str) and text.strip() and not _contains_forbidden_inline_payload(text):
                        texts.append(text.strip())
        if texts:
            return " ".join(texts)

    choices = value.get("choices")
    if isinstance(choices, list) and choices:
        message = _mapping(_mapping(choices[0]).get("message"))
        content = message.get("content")
        if isinstance(content, str):
            if content.strip() and not _contains_forbidden_inline_payload(content):
                return content
        if isinstance(content, list):
            text = text_from_content(content).strip()
            if text:
                return text

    raise ValueError("Provider response did not contain chat choices or responses output text.")


def message_output_item(text: str, *, item_id: str | None = None) -> dict[str, Any]:
    return {
        "id": item_id or _make_id("msg"),
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


def text_from_content(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _redact_inline_payload_text(value)
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        parts: list[str] = []
        for item in value:
            record = _mapping(item)
            if _looks_like_image_part(record):
                parts.append(_image_part_placeholder(record))
                continue
            text = record.get("text")
            if not isinstance(text, str):
                text = record.get("output_text")
            if not isinstance(text, str):
                text = record.get("input_text")
            if not isinstance(text, str):
                text = record.get("content")
            if isinstance(text, str):
                parts.append(text)
            elif record:
                parts.append(json.dumps(_redact_non_text_part(record), sort_keys=True))
        return "\n".join(part for part in parts if part)
    record = _mapping(value)
    if isinstance(record.get("text"), str):
        return _redact_inline_payload_text(str(record["text"]))
    if isinstance(record.get("content"), str):
        return _redact_inline_payload_text(str(record["content"]))
    if record:
        return json.dumps(_redact_non_text_part(record), sort_keys=True)
    return json.dumps(value, sort_keys=True)


def _input_to_messages(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        return [{"role": "user", "content": value}]
    if not isinstance(value, list):
        return [{"role": "user", "content": text_from_content(value)}]

    messages: list[dict[str, Any]] = []
    for item in value:
        record = _mapping(item)
        item_type = _string_or_none(record.get("type"))
        if item_type == "function_call_output":
            messages.append({
                "role": "tool",
                "tool_call_id": _string_or_none(record.get("call_id"))
                or _string_or_none(record.get("item_id"))
                or _string_or_none(record.get("id"))
                or _make_id("call"),
                "content": text_from_content(record.get("output", record.get("content"))),
            })
            continue
        if item_type == "function_call":
            messages.append({"role": "assistant", "content": "", "tool_calls": [_response_function_call_to_chat_tool_call(record)]})
            continue

        role = _normalize_role(record.get("role"))
        if not role:
            messages.append({"role": "user", "content": text_from_content(item)})
        else:
            messages.append({"role": role, "content": text_from_content(record.get("content", record.get("text", record.get("input"))))})
    return messages


def _tools_to_chat_tools(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    converted: list[Any] = []
    for tool in value:
        record = _mapping(tool)
        if record.get("type") != "function":
            continue
        if isinstance(record.get("function"), Mapping):
            converted.append(tool)
            continue
        name = _string_or_none(record.get("name"))
        if not name:
            continue
        converted.append({
            "type": "function",
            "function": _compact({
                "name": name,
                "description": record.get("description"),
                "parameters": record.get("parameters") or record.get("input_schema") or {"type": "object", "properties": {}},
                "strict": record.get("strict"),
            }),
        })
    return converted


def _chat_tools_to_responses_tools(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    converted: list[dict[str, Any]] = []
    for tool in value:
        record = _mapping(tool)
        if record.get("type") != "function":
            continue
        function = _mapping(record.get("function"))
        name = _string_or_none(function.get("name")) or _string_or_none(record.get("name"))
        if not name:
            continue
        converted.append(_compact({
            "type": "function",
            "name": name,
            "description": function.get("description", record.get("description")),
            "parameters": function.get("parameters") or record.get("parameters") or record.get("input_schema") or {"type": "object", "properties": {}},
            "strict": function.get("strict", record.get("strict")),
        }))
    return converted


def _chat_tool_choice_to_responses(value: Any) -> Any:
    record = _mapping(value)
    if not record:
        return value
    name = _string_or_none(record.get("name"))
    function = _mapping(record.get("function"))
    name = name or _string_or_none(function.get("name"))
    if name:
        return {"type": "function", "name": name}
    return value


def _chat_content_to_responses_content(value: Any, *, role: str) -> list[dict[str, Any]]:
    if isinstance(value, list):
        parts: list[dict[str, Any]] = []
        for part in value:
            record = _mapping(part)
            if _looks_like_image_part(record):
                image_part = _chat_image_part_to_responses(record)
                if image_part:
                    parts.append(image_part)
                continue
            text = _text_field_from_record(record)
            if text is not None:
                parts.append({"type": _responses_text_part_type(role), "text": text})
            elif record:
                redacted = json.dumps(_redact_non_text_part(record), sort_keys=True)
                parts.append({"type": _responses_text_part_type(role), "text": redacted})
        return parts

    text = text_from_content(value)
    if text:
        return [{"type": _responses_text_part_type(role), "text": text}]
    return []


def _responses_text_part_type(role: str) -> str:
    return "output_text" if role == "assistant" else "input_text"


def _chat_image_part_to_responses(record: Mapping[str, Any]) -> dict[str, Any] | None:
    image_url = record.get("image_url")
    if isinstance(image_url, Mapping):
        url = image_url.get("url") or image_url.get("ref")
        if isinstance(url, str) and url:
            return {"type": "input_image", "image_url": url}
    if isinstance(image_url, str) and image_url:
        return {"type": "input_image", "image_url": image_url}
    image_ref = _string_or_none(record.get("image_ref")) or _string_or_none(record.get("ref"))
    if image_ref:
        return {"type": "input_image", "image_url": image_ref}
    return None


def _text_field_from_record(record: Mapping[str, Any]) -> str | None:
    for key in ("text", "output_text", "input_text", "content"):
        value = record.get(key)
        if isinstance(value, str):
            return _redact_inline_payload_text(value)
    return None


def _response_function_call_to_chat_tool_call(record: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": _string_or_none(record.get("call_id")) or _string_or_none(record.get("id")) or _make_id("call"),
        "type": "function",
        "function": {
            "name": _string_or_none(record.get("name")) or "unknown_tool",
            "arguments": record.get("arguments") if isinstance(record.get("arguments"), str) else json.dumps(record.get("arguments") or {}, sort_keys=True),
        },
    }


def _chat_tool_call_to_response_item(value: Any) -> dict[str, Any] | None:
    record = _mapping(value)
    function = _mapping(record.get("function"))
    name = _string_or_none(function.get("name"))
    if not name:
        return None
    return {
        "id": _make_id("fc"),
        "type": "function_call",
        "status": "completed",
        "call_id": _string_or_none(record.get("id")) or _make_id("call"),
        "name": name,
        "arguments": function.get("arguments") if isinstance(function.get("arguments"), str) else json.dumps(function.get("arguments") or {}, sort_keys=True),
    }


def _looks_like_image_part(record: Mapping[str, Any]) -> bool:
    part_type = _string_or_none(record.get("type"))
    return part_type in {"input_image", "image", "image_url"} or "image_url" in record


def _image_part_placeholder(record: Mapping[str, Any]) -> str:
    image_ref = _string_or_none(record.get("image_ref")) or _string_or_none(record.get("ref"))
    image_url = record.get("image_url")
    if isinstance(image_url, Mapping):
        image_ref = image_ref or _string_or_none(image_url.get("ref"))
    elif isinstance(image_url, str) and not image_url.startswith("data:"):
        image_ref = image_ref or image_url
    if image_ref:
        return json.dumps({"type": "image_ref", "ref": image_ref}, sort_keys=True)
    return json.dumps({"type": "image", "content": "[redacted-image]"}, sort_keys=True)


def _redact_non_text_part(record: Mapping[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in record.items():
        normalized = str(key).replace("_", "").replace("-", "").lower()
        if normalized in {"imageurl", "dataurl", "base64", "rawimage", "imagebase64"}:
            redacted[str(key)] = "[REDACTED_IMAGE]"
        elif isinstance(value, Mapping):
            redacted[str(key)] = _redact_non_text_part(value)
        elif isinstance(value, list):
            redacted[str(key)] = [
                _redact_non_text_part(item) if isinstance(item, Mapping) else item
                for item in value
            ]
        else:
            redacted[str(key)] = value
    return redacted


def _contains_forbidden_inline_payload(value: str) -> bool:
    lowered = value.lower()
    return "data:image/" in lowered or ";base64," in lowered


def _redact_inline_payload_text(value: str) -> str:
    if not _contains_forbidden_inline_payload(value):
        return value
    return "[REDACTED_INLINE_PAYLOAD]"


def _normalize_role(value: Any) -> str | None:
    if value in {"user", "assistant", "tool"}:
        return str(value)
    if value in {"system", "developer"}:
        return "system"
    return None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _compact(value: Mapping[str, Any]) -> dict[str, Any]:
    return {key: entry for key, entry in value.items() if entry is not None}


def _make_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000):x}{next(_ID_COUNTER):x}"
