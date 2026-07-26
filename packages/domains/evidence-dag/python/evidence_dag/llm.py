"""Pluggable Model Router client (stdlib only) + offline stub.

The extractor and the NLI judge both depend on this. Real runs hit an
in-app Model Router `/v1/responses` endpoint; tests inject `StubLLM` so they
run fully offline and deterministically.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Optional, Protocol


_MAX_ROUTER_ERROR_BODY_BYTES = 8_192
_MAX_ROUTER_ERROR_MESSAGE_CHARS = 300
_MAX_RESPONSE_ADAPTATIONS = 1
STRUCTURED_EXTRACTION_INITIAL_OUTPUT_TOKENS = 8_192
MAX_ADAPTIVE_OUTPUT_TOKENS = 16_384
_LOW_REASONING_OPERATIONS = frozenset({
    "extract",
    "verify",
    "adversarial-review",
})
_OPERATION_OUTPUT_TOKEN_FLOORS = {
    "verify": 2_048,
    "adversarial-review": 2_048,
}
_ROUTER_ERROR_CODE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,79}$")
_SENSITIVE_ERROR_TEXT = re.compile(
    r"(?:authorization|proxy-authorization|cookie|set-cookie|"
    r"api[\s_-]*key|access[\s_-]*token|secret|password|bearer|"
    r"\bsk-[a-z0-9_-]{4,})",
    re.IGNORECASE,
)


class LLMCallError(RuntimeError):
    """Typed, bounded failure reported by the Model Router client."""

    def __init__(
        self,
        code: str,
        detail: str,
        *,
        attempts: int,
        retryable: bool,
        response_status: Optional[str] = None,
        incomplete_reason: Optional[str] = None,
        adaptation: Optional[str] = None,
    ) -> None:
        self.code = code
        self.detail = detail
        self.attempts = attempts
        self.retryable = retryable
        self.response_status = response_status
        self.incomplete_reason = incomplete_reason
        self.adaptation = adaptation
        super().__init__(f"LLM call failed after {attempts} attempts: {code}: {detail}")


class LLM(Protocol):
    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str: ...


class ModelRouterLLM:
    """Minimal Model Router responses client with retry/backoff."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_s: Optional[float] = None,
        max_attempts: Optional[int] = None,
        retry_base_s: Optional[float] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = (base_url or os.environ.get("EDAG_MODEL_ROUTER_BASE_URL", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("EDAG_MODEL_ROUTER_API_KEY", "")
        self.model = model or os.environ.get("EDAG_MODEL_ROUTER_MODEL", "sciforge-router")
        self.timeout_s = timeout_s if timeout_s is not None else _float_env("EDAG_MODEL_ROUTER_TIMEOUT_S", 180.0)
        self.max_attempts = max_attempts if max_attempts is not None else _int_env("EDAG_MODEL_ROUTER_MAX_ATTEMPTS", 1)
        self.retry_base_s = retry_base_s if retry_base_s is not None else _float_env("EDAG_MODEL_ROUTER_RETRY_BASE_S", 1.5)
        self._sleep = sleep
        if not self.base_url:
            raise ValueError("EDAG_MODEL_ROUTER_BASE_URL not set")
        if not self.api_key:
            raise ValueError("EDAG_MODEL_ROUTER_API_KEY not set")

    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str:
        operation = _operation(messages)
        output_token_floor = _OPERATION_OUTPUT_TOKEN_FLOORS.get(operation, 0)
        payload: dict[str, Any] = {
            "model": self.model,
            "instructions": _system_text(messages),
            "input": _conversation_text(messages),
            "temperature": temperature,
            "max_output_tokens": max(max_tokens, output_token_floor),
            "metadata": {
                "source": "evidence-dag",
                "operation": operation,
            },
        }
        # These package-owned operations produce bounded structured judgments,
        # not open-ended reasoning. The Responses API counts hidden reasoning
        # against max_output_tokens, so the explicit effort and judge floor are
        # part of the Model Router contract rather than caller-specific retries.
        if operation in _LOW_REASONING_OPERATIONS:
            payload["reasoning"] = {"effort": "low"}
        url = f"{self.base_url}/responses" if self.base_url.endswith("/v1") else f"{self.base_url}/v1/responses"
        last_failure: Optional[LLMCallError] = None
        attempts_made = 0
        response_adaptations = 0
        transport_failures = 0
        while True:
            attempt = attempts_made + 1
            attempts_made = attempt
            request_body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=request_body, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {self.api_key}")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    raw_body = resp.read().decode("utf-8")
                try:
                    body = json.loads(raw_body)
                except json.JSONDecodeError as exc:
                    last_failure = LLMCallError(
                        "router_invalid_json",
                        f"Model Router returned a non-JSON response at line {exc.lineno}, column {exc.colno}.",
                        attempts=attempt,
                        retryable=True,
                        adaptation="retry_response",
                    )
                else:
                    try:
                        return _completed_response_text(
                            body,
                            attempts=attempt,
                            api_key=self.api_key,
                        )
                    except LLMCallError as exc:
                        last_failure = exc

                if (
                    last_failure.retryable
                    and last_failure.adaptation
                    and response_adaptations < _MAX_RESPONSE_ADAPTATIONS
                ):
                    response_adaptations += 1
                    if last_failure.adaptation == "increase_output_tokens":
                        current = int(payload["max_output_tokens"])
                        expanded = min(
                            MAX_ADAPTIVE_OUTPUT_TOKENS,
                            max(current * 2, current + 1_024),
                        )
                        if expanded <= current:
                            last_failure = LLMCallError(
                                last_failure.code,
                                last_failure.detail,
                                attempts=attempt,
                                retryable=False,
                                response_status=last_failure.response_status,
                                incomplete_reason=last_failure.incomplete_reason,
                            )
                            break
                        payload["max_output_tokens"] = expanded
                    continue
                if last_failure.adaptation and response_adaptations >= _MAX_RESPONSE_ADAPTATIONS:
                    last_failure = LLMCallError(
                        last_failure.code,
                        last_failure.detail,
                        attempts=attempt,
                        retryable=False,
                        response_status=last_failure.response_status,
                        incomplete_reason=last_failure.incomplete_reason,
                    )
                break
            except urllib.error.HTTPError as exc:
                code, detail = _safe_router_http_error(exc, api_key=self.api_key)
                retryable = exc.code >= 500 or exc.code in (408, 429)
                last_failure = LLMCallError(
                    code,
                    detail,
                    attempts=attempt,
                    retryable=retryable,
                )
                # 4xx (except 408/429) means the request itself is wrong;
                # retrying only burns the backoff budget.
                if not retryable:
                    break
                transport_failures += 1
                if transport_failures < self.max_attempts:
                    self._sleep(self.retry_base_s * (2 ** (transport_failures - 1)))
                    continue
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                code = "upstream_timeout" if _is_timeout(exc) else "upstream_network_error"
                detail = (
                    "Upstream request timed out."
                    if code == "upstream_timeout"
                    else "Upstream request failed before a response was received."
                )
                last_failure = LLMCallError(
                    code,
                    detail,
                    attempts=attempt,
                    retryable=True,
                )
                transport_failures += 1
                if transport_failures < self.max_attempts:
                    self._sleep(self.retry_base_s * (2 ** (transport_failures - 1)))
                    continue
                break
        if last_failure is None:
            last_failure = LLMCallError(
                "router_unknown_error",
                "Model Router request failed without a diagnostic.",
                attempts=attempts_made,
                retryable=False,
            )
        if last_failure.attempts == attempts_made:
            raise last_failure
        raise LLMCallError(
            last_failure.code,
            last_failure.detail,
            attempts=attempts_made,
            retryable=last_failure.retryable,
            response_status=last_failure.response_status,
            incomplete_reason=last_failure.incomplete_reason,
            adaptation=last_failure.adaptation,
        )


def _safe_router_http_error(exc: urllib.error.HTTPError, *, api_key: str) -> tuple[str, str]:
    """Return bounded Model Router error details without reflecting credentials."""
    fallback_code = f"router_http_{exc.code}"
    fallback_message = f"Model Router returned HTTP {exc.code}."
    try:
        raw = exc.read(_MAX_ROUTER_ERROR_BODY_BYTES + 1)
        if len(raw) > _MAX_ROUTER_ERROR_BODY_BYTES:
            return fallback_code, fallback_message
        payload = json.loads(raw.decode("utf-8"))
    except (AttributeError, UnicodeDecodeError, json.JSONDecodeError, OSError):
        return fallback_code, fallback_message

    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return fallback_code, fallback_message

    raw_code = error.get("code")
    code = raw_code.strip().lower() if isinstance(raw_code, str) else ""
    if (
        not _ROUTER_ERROR_CODE.fullmatch(code)
        or _SENSITIVE_ERROR_TEXT.search(code)
        or (api_key and api_key.lower() in code)
    ):
        code = fallback_code

    raw_message = error.get("message")
    message = " ".join(raw_message.split()) if isinstance(raw_message, str) else ""
    if (
        not message
        or len(message) > _MAX_ROUTER_ERROR_MESSAGE_CHARS
        or _SENSITIVE_ERROR_TEXT.search(message)
        or (api_key and api_key in message)
    ):
        message = fallback_message
    return code, message


def _completed_response_text(body: object, *, attempts: int, api_key: str) -> str:
    if not isinstance(body, dict):
        raise LLMCallError(
            "router_invalid_response",
            "Model Router response envelope must be a JSON object.",
            attempts=attempts,
            retryable=True,
            adaptation="retry_response",
        )

    raw_status = body.get("status")
    status = raw_status.strip().lower() if isinstance(raw_status, str) else ""
    if not status:
        raise LLMCallError(
            "router_missing_status",
            "Model Router response omitted the Responses status.",
            attempts=attempts,
            retryable=False,
        )

    incomplete = body.get("incomplete_details")
    incomplete_reason = _response_reason(incomplete)
    if status == "incomplete":
        reason = incomplete_reason or "unknown"
        retryable = reason == "max_output_tokens"
        raise LLMCallError(
            "router_response_incomplete",
            f"Model Router response was incomplete (reason={reason}).",
            attempts=attempts,
            retryable=retryable,
            response_status=status,
            incomplete_reason=reason,
            adaptation="increase_output_tokens" if retryable else None,
        )
    if status != "completed":
        code, detail = _safe_response_error(body, status=status, api_key=api_key)
        raise LLMCallError(
            code,
            detail,
            attempts=attempts,
            retryable=False,
            response_status=status,
            incomplete_reason=incomplete_reason,
        )
    if incomplete_reason:
        raise LLMCallError(
            "router_invalid_response",
            "Completed Model Router response unexpectedly included incomplete_details.",
            attempts=attempts,
            retryable=False,
            response_status=status,
            incomplete_reason=incomplete_reason,
        )

    text = _response_text(body)
    if text.strip():
        return text
    refusal = _response_refusal(body)
    if refusal:
        raise LLMCallError(
            "router_response_refused",
            "Model Router completed with a refusal instead of output text.",
            attempts=attempts,
            retryable=False,
            response_status=status,
        )
    raise LLMCallError(
        "router_empty_output",
        "Model Router completed without output text.",
        attempts=attempts,
        retryable=True,
        response_status=status,
        adaptation="retry_response",
    )


def _safe_response_error(body: dict, *, status: str, api_key: str) -> tuple[str, str]:
    error = body.get("error")
    if not isinstance(error, dict):
        return (
            f"router_response_{status or 'unknown'}",
            f"Model Router returned terminal response status {status or 'unknown'}.",
        )
    raw_code = error.get("code")
    code = raw_code.strip().lower() if isinstance(raw_code, str) else ""
    if (
        not _ROUTER_ERROR_CODE.fullmatch(code)
        or _SENSITIVE_ERROR_TEXT.search(code)
        or (api_key and api_key.lower() in code)
    ):
        code = f"router_response_{status or 'unknown'}"
    raw_message = error.get("message")
    message = " ".join(raw_message.split()) if isinstance(raw_message, str) else ""
    if (
        not message
        or len(message) > _MAX_ROUTER_ERROR_MESSAGE_CHARS
        or _SENSITIVE_ERROR_TEXT.search(message)
        or (api_key and api_key in message)
    ):
        message = f"Model Router returned terminal response status {status or 'unknown'}."
    return code, message


def _response_reason(details: object) -> Optional[str]:
    if not isinstance(details, dict):
        return None
    raw_reason = details.get("reason")
    reason = raw_reason.strip().lower() if isinstance(raw_reason, str) else ""
    if not reason or not _ROUTER_ERROR_CODE.fullmatch(reason):
        return None
    return reason


def _response_refusal(body: dict) -> str:
    output = body.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "refusal":
                continue
            refusal = block.get("refusal")
            if isinstance(refusal, str) and refusal.strip():
                return refusal.strip()
    return ""


def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    reason = getattr(exc, "reason", None)
    return isinstance(reason, TimeoutError)


def _float_env(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def llm_concurrency() -> int:
    """Bounded fan-out for independent judge/review calls (EDAG_LLM_CONCURRENCY)."""
    return max(1, _int_env("EDAG_LLM_CONCURRENCY", 8))


class StubLLM:
    """Offline stub. Routes each call to a handler by inspecting the system msg
    role hint ('extractor' | 'nli'); used only in tests."""

    def __init__(self, extract_response: str = "{}",
                 nli_handler: Optional[Callable[[str, str], float]] = None) -> None:
        self.extract_response = extract_response
        self.nli_handler = nli_handler or (lambda premise, hypothesis: 0.0)
        self.calls: list[dict] = []

    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str:
        self.calls.append({"messages": messages})
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        user = next((m["content"] for m in messages if m["role"] == "user"), "")
        if "EDAG-TASK: nli" in system:
            premise, hypothesis = _split_nli_user(user)
            score = float(self.nli_handler(premise, hypothesis))
            return json.dumps({"entailment": score, "label": "entailment" if score >= 0.5 else "neutral"})
        if "EDAG-TASK: adversarial" in system:
            claim = user.split("\n", 1)[0].removeprefix("CLAIM:").strip()
            score = float(self.nli_handler(user, claim))
            return json.dumps({
                "result": "passed" if score >= 0.7 else ("failed" if score <= 0.3 else "uncertain"),
                "confidence": score if score >= 0.5 else 1.0 - score,
                "rationale": "Deterministic independent test reviewer result.",
            })
        return self.extract_response


def _split_nli_user(user: str) -> tuple[str, str]:
    premise = hypothesis = ""
    for line in user.splitlines():
        if line.startswith("PREMISE:"):
            premise = line[len("PREMISE:"):].strip()
        elif line.startswith("HYPOTHESIS:"):
            hypothesis = line[len("HYPOTHESIS:"):].strip()
    return premise, hypothesis


def _message_content_text(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, ensure_ascii=False)
    except TypeError:
        return str(content)


def _system_text(messages: list[dict]) -> str:
    return "\n\n".join(
        _message_content_text(message).strip()
        for message in messages
        if message.get("role") == "system" and _message_content_text(message).strip()
    )


def _conversation_text(messages: list[dict]) -> str:
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role", "user"))
        if role == "system":
            continue
        text = _message_content_text(message).strip()
        if text:
            parts.append(f"{role.upper()}: {text}")
    return "\n\n".join(parts) or ""


def _operation(messages: list[dict]) -> str:
    system = _system_text(messages)
    if "EDAG-TASK: extract" in system:
        return "extract"
    if "EDAG-TASK: nli" in system:
        return "verify"
    if "EDAG-TASK: adversarial" in system:
        return "adversarial-review"
    return "model-call"


def _response_text(body: dict) -> str:
    text = body.get("output_text")
    if isinstance(text, str) and text.strip():
        return text
    output = body.get("output")
    if isinstance(output, list):
        chunks: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if (
                    isinstance(block, dict)
                    and block.get("type") == "output_text"
                    and isinstance(block.get("text"), str)
                ):
                    chunks.append(block["text"])
        return "".join(chunks)
    return ""
