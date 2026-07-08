"""Model Router client boundary tests."""
from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.llm import ModelRouterLLM  # noqa: E402


class FakeHttpResponse:
    def __init__(self, body: dict):
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class TestModelRouterLLM(unittest.TestCase):
    def test_calls_model_router_responses_endpoint(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeHttpResponse({"output_text": '{"ok": true}'})
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                model="sciforge-router",
                sleep=lambda _seconds: None,
            )

            out = llm.chat([
                {"role": "system", "content": "extract JSON"},
                {"role": "user", "content": "trace text"},
            ], max_tokens=123)

        self.assertEqual(out, '{"ok": true}')
        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "http://127.0.0.1:3892/v1/responses")
        self.assertEqual(req.headers.get("Authorization"), "Bearer router-key")
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["model"], "sciforge-router")
        self.assertEqual(body["instructions"], "extract JSON")
        self.assertEqual(body["input"], "USER: trace text")
        self.assertEqual(body["max_output_tokens"], 123)
        self.assertNotIn("messages", body)

    def test_ignores_legacy_direct_llm_env(self):
        old_env = dict(os.environ)
        try:
            os.environ.clear()
            os.environ["EDAG_LLM_BASE_URL"] = "https://provider.example/v1"
            os.environ["EDAG_LLM_API_KEY"] = "provider-key"
            with self.assertRaisesRegex(ValueError, "EDAG_MODEL_ROUTER_BASE_URL"):
                ModelRouterLLM()
        finally:
            os.environ.clear()
            os.environ.update(old_env)

    def test_model_router_timeout_settings_can_come_from_env(self):
        old_env = dict(os.environ)
        try:
            os.environ.clear()
            os.environ["EDAG_MODEL_ROUTER_BASE_URL"] = "http://127.0.0.1:3892/v1"
            os.environ["EDAG_MODEL_ROUTER_API_KEY"] = "router-key"
            os.environ["EDAG_MODEL_ROUTER_TIMEOUT_S"] = "12.5"
            os.environ["EDAG_MODEL_ROUTER_MAX_ATTEMPTS"] = "2"
            os.environ["EDAG_MODEL_ROUTER_RETRY_BASE_S"] = "0.25"

            llm = ModelRouterLLM()

            self.assertEqual(llm.timeout_s, 12.5)
            self.assertEqual(llm.max_attempts, 2)
            self.assertEqual(llm.retry_base_s, 0.25)
        finally:
            os.environ.clear()
            os.environ.update(old_env)


if __name__ == "__main__":
    unittest.main()
