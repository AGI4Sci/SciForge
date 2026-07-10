"""Pluggable Model Router client (stdlib only) + offline stub.

The extractor and the NLI judge both depend on this. Real runs hit an
in-app Model Router `/v1/responses` endpoint; tests inject `StubLLM` so they
run fully offline and deterministically.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Callable, Optional, Protocol


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
        self.max_attempts = max_attempts if max_attempts is not None else _int_env("EDAG_MODEL_ROUTER_MAX_ATTEMPTS", 5)
        self.retry_base_s = retry_base_s if retry_base_s is not None else _float_env("EDAG_MODEL_ROUTER_RETRY_BASE_S", 1.5)
        self._sleep = sleep
        if not self.base_url:
            raise ValueError("EDAG_MODEL_ROUTER_BASE_URL not set")
        if not self.api_key:
            raise ValueError("EDAG_MODEL_ROUTER_API_KEY not set")

    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str:
        payload = json.dumps({
            "model": self.model,
            "instructions": _system_text(messages),
            "input": _conversation_text(messages),
            "temperature": temperature,
            "max_output_tokens": max_tokens,
            "metadata": {
                "source": "evidence-dag",
                "operation": "extract-or-verify",
            },
        }).encode("utf-8")
        url = f"{self.base_url}/responses" if self.base_url.endswith("/v1") else f"{self.base_url}/v1/responses"
        last_err: Optional[Exception] = None
        for attempt in range(1, self.max_attempts + 1):
            req = urllib.request.Request(url, data=payload, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {self.api_key}")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                return _response_text(body)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, KeyError) as exc:
                last_err = exc
                if attempt < self.max_attempts:
                    self._sleep(self.retry_base_s * (2 ** (attempt - 1)))
        raise RuntimeError(f"LLM call failed after {self.max_attempts} attempts: {last_err}")


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


def _response_text(body: dict) -> str:
    text = body.get("output_text")
    if isinstance(text, str):
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
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    chunks.append(block["text"])
        return "".join(chunks)
    return ""
