"""Pluggable OpenAI-compatible chat client (stdlib only) + offline stub.

The extractor and the NLI judge both depend on this. Real runs hit an
OpenAI-compatible `chat/completions` endpoint (DeepSeek-V4 by default); tests
inject `StubLLM` so they run fully offline and deterministically.
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


class OpenAICompatLLM:
    """Minimal chat client with retry/backoff (robustness lives in the module)."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_s: float = 180.0,
        max_attempts: int = 5,
        retry_base_s: float = 1.5,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = (base_url or os.environ.get("EDAG_LLM_BASE_URL", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("EDAG_LLM_API_KEY", "")
        self.model = model or os.environ.get("EDAG_LLM_MODEL", "bailian/deepseek-v4-flash")
        self.timeout_s = timeout_s
        self.max_attempts = max_attempts
        self.retry_base_s = retry_base_s
        self._sleep = sleep
        if not self.base_url:
            raise ValueError("EDAG_LLM_BASE_URL not set")

    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str:
        payload = json.dumps({
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }).encode("utf-8")
        url = f"{self.base_url}/chat/completions"
        last_err: Optional[Exception] = None
        for attempt in range(1, self.max_attempts + 1):
            req = urllib.request.Request(url, data=payload, method="POST")
            req.add_header("Content-Type", "application/json")
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                return body["choices"][0]["message"]["content"] or ""
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, KeyError) as exc:
                last_err = exc
                if attempt < self.max_attempts:
                    self._sleep(self.retry_base_s * (2 ** (attempt - 1)))
        raise RuntimeError(f"LLM call failed after {self.max_attempts} attempts: {last_err}")


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
        return self.extract_response


def _split_nli_user(user: str) -> tuple[str, str]:
    premise = hypothesis = ""
    for line in user.splitlines():
        if line.startswith("PREMISE:"):
            premise = line[len("PREMISE:"):].strip()
        elif line.startswith("HYPOTHESIS:"):
            hypothesis = line[len("HYPOTHESIS:"):].strip()
    return premise, hypothesis
