"""Model Router client boundary tests."""
from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.error
from io import BytesIO
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from evidence_dag.llm import LLMCallError, ModelRouterLLM  # noqa: E402


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
            urlopen.return_value = FakeHttpResponse({
                "status": "completed",
                "output_text": '{"ok": true}',
            })
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
        self.assertNotIn("reasoning", body)
        self.assertNotIn("messages", body)

    def test_extraction_requests_low_reasoning(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeHttpResponse({
                "status": "completed",
                "output_text": '{"nodes":[],"edges":[]}',
            })
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=1,
            )

            llm.chat([
                {"role": "system", "content": "EDAG-TASK: extract\nReturn JSON."},
                {"role": "user", "content": "trace text"},
            ])

        body = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(body["reasoning"], {"effort": "low"})
        self.assertEqual(body["metadata"]["operation"], "extract")

    def test_structured_judges_request_low_reasoning_and_a_2048_token_floor(self):
        operations = [
            ("EDAG-TASK: nli (support)", "verify", 200),
            ("EDAG-TASK: adversarial", "adversarial-review", 300),
        ]
        for system, operation, requested_tokens in operations:
            with self.subTest(operation=operation):
                with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
                    urlopen.return_value = FakeHttpResponse({
                        "status": "completed",
                        "output_text": '{"result":"passed"}',
                    })
                    llm = ModelRouterLLM(
                        base_url="http://127.0.0.1:3892/v1",
                        api_key="router-key",
                        max_attempts=1,
                    )

                    llm.chat(
                        [{"role": "system", "content": system}],
                        max_tokens=requested_tokens,
                    )

                body = json.loads(
                    urlopen.call_args.args[0].data.decode("utf-8")
                )
                self.assertEqual(body["metadata"]["operation"], operation)
                self.assertEqual(body["reasoning"], {"effort": "low"})
                self.assertEqual(body["max_output_tokens"], 2048)

    def test_verifier_output_limit_adapts_from_2048_to_4096_once(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.side_effect = [
                FakeHttpResponse({
                    "status": "incomplete",
                    "incomplete_details": {"reason": "max_output_tokens"},
                    "output_text": "",
                }),
                FakeHttpResponse({
                    "status": "completed",
                    "output_text": '{"support":0.9,"label":"supports"}',
                }),
            ]
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=1,
            )

            output = llm.chat(
                [{"role": "system", "content": "EDAG-TASK: nli (support)"}],
                max_tokens=200,
            )

        self.assertEqual(output, '{"support":0.9,"label":"supports"}')
        bodies = [
            json.loads(call.args[0].data.decode("utf-8"))
            for call in urlopen.call_args_list
        ]
        self.assertEqual(
            [body["max_output_tokens"] for body in bodies],
            [2048, 4096],
        )
        self.assertTrue(all(
            body["reasoning"] == {"effort": "low"} for body in bodies
        ))

    def test_verifier_repeated_truncation_is_terminal_at_4096(self):
        incomplete = {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output_text": "",
        }
        with patch(
            "evidence_dag.llm.urllib.request.urlopen",
            side_effect=[
                FakeHttpResponse(incomplete),
                FakeHttpResponse(incomplete),
            ],
        ) as urlopen:
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat(
                    [{"role": "system", "content": "EDAG-TASK: nli (support)"}],
                    max_tokens=200,
                )

        bodies = [
            json.loads(call.args[0].data.decode("utf-8"))
            for call in urlopen.call_args_list
        ]
        self.assertEqual(
            [body["max_output_tokens"] for body in bodies],
            [2048, 4096],
        )
        self.assertEqual(raised.exception.attempts, 2)
        self.assertEqual(
            raised.exception.incomplete_reason,
            "max_output_tokens",
        )
        self.assertFalse(raised.exception.retryable)

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

    def test_retains_safe_structured_router_error_after_transient_retries(self):
        errors = [
            urllib.error.HTTPError(
                "http://127.0.0.1:3892/v1/responses",
                500,
                "Internal Server Error",
                {},
                BytesIO(json.dumps({
                    "error": {
                        "code": "provider_exception_timeout",
                        "message": "Provider request failed (provider_exception_timeout).",
                    },
                }).encode("utf-8")),
            )
            for _ in range(3)
        ]
        sleeps = []
        with patch("evidence_dag.llm.urllib.request.urlopen", side_effect=errors) as urlopen:
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=3,
                retry_base_s=0.1,
                sleep=sleeps.append,
            )

            with self.assertRaisesRegex(
                RuntimeError,
                r"after 3 attempts: provider_exception_timeout: Provider request failed",
            ):
                llm.chat([{"role": "user", "content": "trace text"}])

        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(sleeps, [0.1, 0.2])

    def test_router_error_never_reflects_credentials(self):
        error = urllib.error.HTTPError(
            "http://127.0.0.1:3892/v1/responses",
            500,
            "Internal Server Error",
            {},
            BytesIO(json.dumps({
                "error": {
                    "code": "provider_http_500",
                    "message": "Authorization: Bearer router-key",
                },
            }).encode("utf-8")),
        )
        with patch("evidence_dag.llm.urllib.request.urlopen", side_effect=error):
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=1,
                sleep=lambda _seconds: None,
            )

            with self.assertRaises(RuntimeError) as raised:
                llm.chat([{"role": "user", "content": "trace text"}])

        message = str(raised.exception)
        self.assertIn("provider_http_500: Model Router returned HTTP 500.", message)
        self.assertNotIn("router-key", message)
        self.assertNotIn("Bearer", message)

    def test_incomplete_max_tokens_retries_once_with_expanded_budget(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.side_effect = [
                FakeHttpResponse({
                    "status": "incomplete",
                    "incomplete_details": {"reason": "max_output_tokens"},
                    "output_text": '{"nodes":[',
                }),
                FakeHttpResponse({
                    "status": "completed",
                    "output_text": '{"nodes":[],"edges":[]}',
                }),
            ]
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
                sleep=lambda _seconds: None,
            )

            out = llm.chat(
                [{"role": "system", "content": "EDAG-TASK: extract"}],
                max_tokens=8192,
            )

        self.assertEqual(out, '{"nodes":[],"edges":[]}')
        self.assertEqual(urlopen.call_count, 2)
        first = json.loads(urlopen.call_args_list[0].args[0].data.decode("utf-8"))
        second = json.loads(urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        self.assertEqual(first["max_output_tokens"], 8192)
        self.assertEqual(second["max_output_tokens"], 16384)

    def test_response_adaptation_is_independent_from_transport_retry_budget(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.side_effect = [
                FakeHttpResponse({
                    "status": "incomplete",
                    "incomplete_details": {"reason": "max_output_tokens"},
                    "output_text": '{"nodes":[',
                }),
                FakeHttpResponse({
                    "status": "completed",
                    "output_text": '{"nodes":[],"edges":[]}',
                }),
            ]
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=1,
                sleep=lambda _seconds: None,
            )

            out = llm.chat(
                [{"role": "system", "content": "EDAG-TASK: extract"}],
                max_tokens=8192,
            )

        self.assertEqual(out, '{"nodes":[],"edges":[]}')
        self.assertEqual(urlopen.call_count, 2)

    def test_deterministic_incomplete_reason_does_not_retry(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeHttpResponse({
                "status": "incomplete",
                "incomplete_details": {"reason": "content_filter"},
                "output_text": "",
            })
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
                sleep=lambda _seconds: None,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat([{"role": "user", "content": "trace text"}])

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(raised.exception.code, "router_response_incomplete")
        self.assertEqual(raised.exception.incomplete_reason, "content_filter")
        self.assertFalse(raised.exception.retryable)

    def test_repeated_truncation_stops_after_adaptation_and_is_not_retryable(self):
        incomplete = {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output_text": '{"nodes":[',
        }
        with patch(
            "evidence_dag.llm.urllib.request.urlopen",
            side_effect=[FakeHttpResponse(incomplete), FakeHttpResponse(incomplete)],
        ) as urlopen:
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
                sleep=lambda _seconds: None,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat(
                    [{"role": "system", "content": "EDAG-TASK: extract"}],
                    max_tokens=8192,
                )

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(raised.exception.attempts, 2)
        self.assertEqual(raised.exception.incomplete_reason, "max_output_tokens")
        self.assertFalse(raised.exception.retryable)

    def test_truncation_at_the_output_cap_is_immediately_non_retryable(self):
        incomplete = {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output_text": '{"nodes":[',
        }
        with patch(
            "evidence_dag.llm.urllib.request.urlopen",
            return_value=FakeHttpResponse(incomplete),
        ) as urlopen:
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=1,
                sleep=lambda _seconds: None,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat(
                    [{"role": "system", "content": "EDAG-TASK: extract"}],
                    max_tokens=16384,
                )

        self.assertEqual(urlopen.call_count, 1)
        self.assertFalse(raised.exception.retryable)

    def test_empty_completed_output_is_typed_and_bounded(self):
        empty = {
            "status": "completed",
            "output": [],
            "output_text": "",
        }
        with patch(
            "evidence_dag.llm.urllib.request.urlopen",
            side_effect=[FakeHttpResponse(empty), FakeHttpResponse(empty)],
        ) as urlopen:
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
                sleep=lambda _seconds: None,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat([{"role": "user", "content": "trace text"}])

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(raised.exception.code, "router_empty_output")
        self.assertFalse(raised.exception.retryable)
        self.assertNotIsInstance(raised.exception.__cause__, json.JSONDecodeError)

    def test_missing_response_status_is_not_retried(self):
        with patch("evidence_dag.llm.urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeHttpResponse({"output_text": '{"ok": true}'})
            llm = ModelRouterLLM(
                base_url="http://127.0.0.1:3892/v1",
                api_key="router-key",
                max_attempts=5,
            )

            with self.assertRaises(LLMCallError) as raised:
                llm.chat([{"role": "user", "content": "trace text"}])

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(raised.exception.code, "router_missing_status")


if __name__ == "__main__":
    unittest.main()
