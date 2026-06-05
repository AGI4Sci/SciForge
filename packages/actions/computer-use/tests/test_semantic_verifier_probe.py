import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import sciforge_computer_use.semantic_verifier_probe as semantic_verifier_probe
from sciforge_computer_use.semantic_verifier_probe import run_semantic_verifier_probe


def test_semantic_verifier_probe_blocks_without_config(tmp_path):
    missing_config = tmp_path / "missing.json"
    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=missing_config,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "missing-config"
    assert manifest["rawPayloadWritten"] is False
    assert manifest["inlineImageWritten"] is False
    assert Path(manifest["promptRef"]).is_file()
    assert (tmp_path / "probe" / "semantic-verifier-probe-manifest.json").is_file()


def test_semantic_verifier_probe_writes_refs_first_summary_from_provider(tmp_path):
    config = tmp_path / "config.computer-use.local.json"
    config.write_text(
        json.dumps({
            "visionLLM": {
                "baseUrl": "https://example.test/v1",
                "apiKey": "secret-token",
                "model": "sciforge-router",
            }
        }),
        encoding="utf8",
    )
    seen = {}

    def fake_transport(url, payload, headers, timeout):
        seen["url"] = url
        seen["payload"] = payload
        seen["headers"] = headers
        seen["timeout"] = timeout
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
                            "verdict": "pass",
                            "confidence": 0.91,
                            "reason": "image evidence is inspectable",
                        })
                    }
                }
            ]
        }

    output_dir = tmp_path / "probe"
    manifest = run_semantic_verifier_probe(
        output_dir=output_dir,
        config_file=config,
        transport=fake_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["baseUrlOrigin"] == "https://example.test"
    assert manifest["modelId"] == "sciforge-router"
    assert manifest["expectedProjectModelId"] == "sciforge-router"
    assert manifest["projectVerifierEvidenceEligible"] is False
    assert manifest["modelPresenceVerified"] is None
    assert "/models did not verify the configured model" in manifest["projectVerifierEvidenceBlockers"]
    assert manifest["semanticVerifier"] == {
        "schemaVersion": "sciforge.computer-use.semantic-verifier.v1",
        "providerIds": ["model-router-semantic-verifier"],
        "modelIds": ["sciforge-router"],
        "verdict": "pass",
        "reason": "image evidence is inspectable",
        "confidence": 0.91,
        "evidenceRefs": [manifest["imageRef"], manifest["promptRef"]],
        "traceRefs": manifest["traceRefs"],
    }
    assert seen["url"] == "https://example.test/v1/chat/completions"
    assert seen["headers"]["Authorization"] == "Bearer secret-token"
    assert Path(manifest["imageRef"]).is_file()
    assert Path(manifest["summaryRef"]).is_file()
    assert Path(manifest["traceRefs"][0]).is_file()

    for path in [output_dir / "semantic-verifier-probe-manifest.json", Path(manifest["summaryRef"]), Path(manifest["traceRefs"][0])]:
        serialized = path.read_text(encoding="utf8")
        assert "secret-token" not in serialized
        assert "data:image" not in serialized
        assert "base64" not in serialized.lower()


def test_semantic_verifier_probe_marks_project_vlm_eligible_only_with_model_presence(tmp_path):
    config = write_config(tmp_path)

    def router_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            return {
                "model": "sciforge-router",
                "choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}],
            }
        return {
            "model": "sciforge-router",
            "choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":0.93,\"reason\":\"image\"}"}}],
        }

    def diagnostic_transport(label, url, payload, headers, timeout):
        if label == "modelsGet":
            return {
                "ok": True,
                "status": 200,
                "bodyKind": "json",
                "bytesRead": 120,
                "bodyTruncated": False,
                "modelCount": 1,
                "configuredModelPresent": True,
            }
        return {"ok": True, "status": 200}

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=router_transport,
        diagnose_provider=True,
        diagnostic_transport=diagnostic_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["responseModelId"] == "sciforge-router"
    assert manifest["configuredModelMatchesProject"] is True
    assert manifest["responseModelMatchesConfigured"] is True
    assert manifest["modelPresenceVerified"] is True
    assert manifest["projectVerifierEvidenceEligible"] is True
    assert manifest["projectVerifierEvidenceBlockers"] == []


def test_semantic_verifier_probe_completed_but_not_project_eligible_for_wrong_model(tmp_path):
    config = write_config(tmp_path)

    def wrong_model_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            return {
                "model": "sciforge-router",
                "choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}],
            }
        return {
            "model": "other-vlm",
            "choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":0.93,\"reason\":\"image\"}"}}],
        }

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=wrong_model_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["responseModelId"] == "other-vlm"
    assert manifest["responseModelMatchesConfigured"] is False
    assert manifest["projectVerifierEvidenceEligible"] is False
    assert "provider response model does not match configured model" in manifest["projectVerifierEvidenceBlockers"]


def test_semantic_verifier_probe_ignores_legacy_text_llm_config_as_vlm_config(tmp_path):
    config = tmp_path / "config.computer-use.local.json"
    config.write_text(
        json.dumps({
            "llm": {
                "baseUrl": "https://example.test/v1",
                "apiKey": "secret-token",
                "model": "text-only-model",
            }
        }),
        encoding="utf8",
    )

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "missing-config"


def test_semantic_verifier_probe_attributes_text_preflight_timeout(tmp_path):
    config = write_config(tmp_path)

    def timeout_transport(url, payload, headers, timeout):
        raise TimeoutError("timed out")

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=timeout_transport,
    )

    assert manifest["status"] == "blocked"
    assert manifest["failureStage"] == "text-preflight"
    assert len(manifest["attempts"]) == 1
    assert_attempt_contains(
        manifest["attempts"][0],
        {
            "stage": "text-preflight",
            "endpointKind": "chat-completions",
            "payloadKind": "text-only",
            "status": "failed",
            "errorCategory": "timeout",
            "reason": "Provider request timed out.",
            "retryCount": 1,
        },
    )
    assert manifest["rawPayloadWritten"] is False
    assert "secret-token" not in json.dumps(manifest)
    assert "data:image" not in json.dumps(manifest)


def test_semantic_verifier_probe_retries_text_timeout_then_completes(tmp_path):
    config = write_config(tmp_path)
    calls = {"text": 0, "image": 0}

    def flaky_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            calls["text"] += 1
            if calls["text"] == 1:
                raise TimeoutError("timed out once")
            return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}]}
        calls["image"] += 1
        return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":0.8,\"reason\":\"image\"}"}}]}

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=flaky_transport,
    )

    assert manifest["status"] == "completed"
    assert calls == {"text": 2, "image": 1}
    assert_attempt_contains(
        manifest["attempts"][0],
        {
            "stage": "text-preflight",
            "payloadKind": "text-only",
            "status": "completed",
            "retryCount": 1,
        },
    )
    assert manifest["semanticVerifier"]["reason"] == "image"
    assert "secret-token" not in json.dumps(manifest)
    assert "data:image" not in json.dumps(manifest)


def test_semantic_verifier_probe_blocks_failed_or_unknown_provider_verdict(tmp_path):
    config = write_config(tmp_path)

    def failed_verdict_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}]}
        return {"choices": [{"message": {"content": "{\"verdict\":\"fail\",\"confidence\":0.2,\"reason\":\"not inspectable\"}"}}]}

    failed = run_semantic_verifier_probe(
        output_dir=tmp_path / "failed",
        config_file=config,
        transport=failed_verdict_transport,
    )

    assert failed["status"] == "blocked"
    assert failed["category"] == "semantic-verifier-verdict-not-pass"
    assert failed["failureStage"] == "semantic-verifier-verdict"
    assert failed["providerVerdict"] == "fail"
    assert failed["successfulAttempt"]["status"] == "completed"

    def unknown_verdict_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}]}
        return {"choices": [{"message": {"content": "provider returned prose instead of JSON"}}]}

    unknown = run_semantic_verifier_probe(
        output_dir=tmp_path / "unknown",
        config_file=config,
        transport=unknown_verdict_transport,
    )

    assert unknown["status"] == "blocked"
    assert unknown["providerVerdict"] == "unknown"
    assert "rawPayloadWritten" in unknown and unknown["rawPayloadWritten"] is False
    assert "secret-token" not in json.dumps(unknown)
    assert "data:image" not in json.dumps(unknown)


def test_semantic_verifier_probe_uses_minimal_text_preflight_after_shape_rejection(tmp_path):
    config = write_config(tmp_path)
    text_payload_keys = []

    def shape_then_minimal_transport(url, payload, headers, timeout):
        if payload.get("messages") and len(payload["messages"]) == 1:
            text_payload_keys.append(sorted(payload))
            if "temperature" in payload or "max_tokens" in payload:
                raise ValueError("unsupported text preflight shape")
            return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"minimal text\"}"}}]}
        return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":0.8,\"reason\":\"image\"}"}}]}

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=shape_then_minimal_transport,
    )

    assert manifest["status"] == "completed"
    assert [attempt["payloadKind"] for attempt in manifest["attempts"][:2]] == ["text-only", "text-only-minimal"]
    assert manifest["attempts"][0]["status"] == "failed"
    assert manifest["attempts"][1]["status"] == "completed"
    assert text_payload_keys[0] == ["max_tokens", "messages", "model", "temperature"]
    assert text_payload_keys[1] == ["messages", "model"]


def test_semantic_verifier_probe_uses_responses_text_preflight_after_chat_text_shape_rejection(tmp_path):
    config = write_config(tmp_path)
    calls = []

    def responses_text_transport(url, payload, headers, timeout):
        if url.endswith("/chat/completions") and payload.get("messages"):
            calls.append(("chat-text", url, sorted(payload)))
            raise ValueError("unsupported chat completions text payload shape")
        if url.endswith("/responses") and payload.get("input"):
            calls.append(("responses", url, sorted(payload)))
            return {
                "output_text": json.dumps({
                    "verdict": "pass",
                    "confidence": 0.84,
                    "reason": "responses text/image accepted",
                })
            }
        raise AssertionError(f"unexpected request: {url} {payload}")

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=responses_text_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["successfulAttempt"]["endpointKind"] == "responses"
    assert [attempt["payloadKind"] for attempt in manifest["attempts"]] == [
        "text-only",
        "text-only-minimal",
        "responses-text-only",
        "responses-input-image",
    ]
    assert [call[0] for call in calls] == ["chat-text", "chat-text", "responses", "responses"]
    assert manifest["semanticVerifier"]["reason"] == "responses text/image accepted"


def test_semantic_verifier_probe_uses_responses_variant_after_chat_image_failures(tmp_path):
    config = write_config(tmp_path)
    calls = []

    def variant_transport(url, payload, headers, timeout):
        if payload.get("messages") and payload["messages"][0]["content"].startswith("Return compact JSON"):
            calls.append(("text", url))
            return {"choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text\"}"}}]}
        if url.endswith("/chat/completions"):
            calls.append(("chat-image", url))
            raise ValueError("unsupported chat image payload")
        calls.append(("responses", url))
        return {
            "output_text": json.dumps({
                "verdict": "pass",
                "confidence": 0.73,
                "reason": "responses endpoint accepted image evidence",
            })
        }

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=variant_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["successfulAttempt"]["endpointKind"] == "responses"
    assert manifest["successfulAttempt"]["payloadKind"] == "responses-input-image"
    assert [attempt["payloadKind"] for attempt in manifest["attempts"]] == [
        "text-only",
        "chat-image-url-object",
        "chat-image-url-string",
        "responses-input-image",
    ]
    assert manifest["semanticVerifier"]["reason"] == "responses endpoint accepted image evidence"
    assert calls[-1][1] == "https://example.test/v1/responses"


def test_semantic_verifier_probe_records_diagnostics_without_secret_leakage(tmp_path):
    config = write_config(tmp_path)

    def timeout_transport(url, payload, headers, timeout):
        raise socket.timeout("timed out")

    def diagnostic_transport(label, url, payload, headers, timeout):
        return {"ok": False, "category": label, "errorType": "TimeoutError"}

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=timeout_transport,
        diagnose_provider=True,
        diagnostic_transport=diagnostic_transport,
    )

    assert manifest["status"] == "blocked"
    assert manifest["providerDiagnostics"]["textChat"]["errorType"] == "TimeoutError"
    assert manifest["providerDiagnostics"]["textResponses"]["errorType"] == "TimeoutError"
    serialized = json.dumps(manifest)
    assert "secret-token" not in serialized
    assert "data:image" not in serialized
    assert "base64" not in serialized.lower()


def test_semantic_verifier_probe_diagnostics_allowlist_scrubs_transport_fields(tmp_path):
    config = write_config(tmp_path, base_url="https://user:pass@example.test/v1/chat/completions")

    def timeout_transport(url, payload, headers, timeout):
        raise ValueError("provider failed with Authorization: Bearer secret-token and data:image/png;base64,abcd")

    def noisy_diagnostic_transport(label, url, payload, headers, timeout):
        return {
            "ok": False,
            "category": label,
            "status": 503,
            "errorType": "Authorization: Bearer secret-token",
            "reason": "raw body data:image/png;base64,abcd apiKey=secret-token",
            "modelIds": ["hidden-other-model"],
            "models": [{"id": "hidden-other-model"}],
            "headers": {"Authorization": "Bearer secret-token"},
            "body": "provider raw body",
            "requestPayload": payload,
            "rawProviderPayload": {"output_text": "raw provider body"},
            "url": "https://user:pass@example.test/v1/chat/completions",
        }

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=timeout_transport,
        diagnose_provider=True,
        diagnostic_transport=noisy_diagnostic_transport,
    )

    assert manifest["baseUrlOrigin"] == "https://example.test"
    diagnostics = manifest["providerDiagnostics"]
    assert diagnostics["baseUrlOrigin"] == "https://example.test"
    assert diagnostics["baseUrlKind"] == "chat-completions-endpoint"
    for key in ("originGet", "modelsGet", "textChat", "textResponses"):
        assert not ({"body", "headers", "requestPayload", "rawProviderPayload", "url", "reason", "models", "modelIds"} & set(diagnostics[key]))
        assert diagnostics[key]["path"] in {"/", "/v1/models", "/v1/chat/completions", "/v1/responses"}
        assert diagnostics[key]["retryable"] is True
    serialized = json.dumps(manifest)
    assert "secret-token" not in serialized
    assert "user:pass" not in serialized
    assert "data:image" not in serialized
    assert "base64" not in serialized.lower()
    assert "provider raw body" not in serialized
    assert "hidden-other-model" not in serialized


def test_semantic_verifier_probe_uses_real_http_path_with_fake_provider(tmp_path):
    requests = []

    class FakeProvider(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002, ANN001 - silence test HTTP server logs.
            return

        def do_GET(self):
            requests.append(("GET", self.path, None, dict(self.headers)))
            if self.path == "/v1/models":
                self._send_json({"data": [{"id": "sciforge-router"}]})
                return
            self._send_json({"error": "not found"}, status=404)

        def do_POST(self):
            length = int(self.headers.get("content-length") or "0")
            payload = json.loads(self.rfile.read(length).decode("utf8"))
            requests.append(("POST", self.path, payload, dict(self.headers)))
            if self.path == "/v1/chat/completions" and is_text_preflight(payload):
                self._send_json({
                    "choices": [
                        {"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text preflight\"}"}}
                    ]
                })
                return
            if self.path == "/v1/chat/completions":
                self._send_json({"error": {"message": "chat image shape rejected"}}, status=400)
                return
            if self.path == "/v1/responses":
                self._send_json({
                    "output": [
                        {
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": json.dumps({
                                        "verdict": "pass",
                                        "confidence": 0.86,
                                        "reason": "responses fake provider accepted image evidence",
                                    }),
                                }
                            ]
                        }
                    ]
                })
                return
            self._send_json({"error": "not found"}, status=404)

        def _send_json(self, payload, *, status=200):
            body = json.dumps(payload).encode("utf8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    with run_fake_provider(FakeProvider) as base_url:
        config = write_config(tmp_path, base_url=base_url)
        manifest = run_semantic_verifier_probe(
            output_dir=tmp_path / "probe",
            config_file=config,
            timeout=2,
        )

    assert manifest["status"] == "completed"
    assert manifest["successfulAttempt"]["endpointKind"] == "responses"
    assert manifest["successfulAttempt"]["payloadKind"] == "responses-input-image"
    assert manifest["semanticVerifier"]["reason"] == "responses fake provider accepted image evidence"
    assert [request[1] for request in requests if request[0] == "POST"] == [
        "/v1/chat/completions",
        "/v1/chat/completions",
        "/v1/chat/completions",
        "/v1/responses",
    ]
    assert all(request[3].get("Authorization") == "Bearer secret-token" for request in requests if request[0] == "POST")

    for path in [tmp_path / "probe" / "semantic-verifier-probe-manifest.json", Path(manifest["summaryRef"]), Path(manifest["traceRefs"][0])]:
        serialized = path.read_text(encoding="utf8")
        assert "secret-token" not in serialized
        assert "data:image" not in serialized
        assert "base64" not in serialized.lower()


def test_semantic_verifier_probe_falls_back_to_raw_http_after_urllib_timeout(tmp_path, monkeypatch):
    requests = []

    class RawFallbackProvider(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002, ANN001 - silence test HTTP server logs.
            return

        def do_GET(self):
            requests.append(("GET", self.path, None, dict(self.headers)))
            if self.path == "/v1/models":
                self._send_json({"data": [{"id": "model-router.capability.computer-use.verifier-translator"}]})
                return
            self._send_json({"ok": True})

        def do_POST(self):
            length = int(self.headers.get("content-length") or "0")
            payload = json.loads(self.rfile.read(length).decode("utf8"))
            requests.append(("POST", self.path, payload, dict(self.headers)))
            if self.path == "/v1/chat/completions":
                self._send_json({
                    "model": "model-router.capability.computer-use.verifier-translator",
                    "choices": [
                        {"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"raw fallback\"}"}}
                    ],
                })
                return
            self._send_json({"error": "not found"}, status=404)

        def _send_json(self, payload, *, status=200):
            body = json.dumps(payload).encode("utf8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def timeout_urlopen(*args, **kwargs):  # noqa: ANN002, ANN003 - monkeypatch test shim.
        raise TimeoutError("urllib transport timed out")

    monkeypatch.setattr(semantic_verifier_probe.urllib.request, "urlopen", timeout_urlopen)
    with run_fake_provider(RawFallbackProvider) as base_url:
        config = write_config(tmp_path, base_url=base_url, model="model-router.capability.computer-use.verifier-translator")
        manifest = run_semantic_verifier_probe(
            output_dir=tmp_path / "probe",
            config_file=config,
            diagnose_provider=True,
            diagnostic_timeout=2,
            timeout=2,
        )

    assert manifest["status"] == "completed"
    assert manifest["responseModelId"] == "model-router.capability.computer-use.verifier-translator"
    assert manifest["configuredModelMatchesProject"] is True
    assert manifest["projectVerifierEvidenceEligible"] is True
    assert manifest["providerDiagnostics"]["modelsGet"]["ok"] is True
    assert manifest["providerDiagnostics"]["modelsGet"]["configuredModelPresent"] is True
    assert any(request[0] == "GET" and request[1] == "/v1/models" for request in requests)
    assert any(request[0] == "POST" and request[1] == "/v1/chat/completions" for request in requests)

    serialized = json.dumps(manifest)
    assert "secret-token" not in serialized
    assert "data:image" not in serialized
    assert "base64" not in serialized.lower()


def test_semantic_verifier_probe_retries_without_temperature_for_no_temperature_shape_rejection(tmp_path):
    payloads = []

    def no_temperature_transport(url, payload, headers, timeout):
        payloads.append(payload)
        if payload.get("temperature") == 0:
            raise semantic_verifier_probe.urllib.error.HTTPError(url, 400, "invalid temperature: only 1 is allowed for this model", {}, None)
        return {
            "model": "sciforge-router-no-temperature",
            "choices": [{"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"no-temperature compatible\"}"}}],
        }

    def diagnostic_transport(label, url, payload, headers, timeout):
        if label == "modelsGet":
            return {
                "ok": True,
                "status": 200,
                "bodyKind": "json",
                "bytesRead": 120,
                "bodyTruncated": False,
                "modelCount": 1,
                "configuredModelPresent": True,
            }
        return {"ok": True, "status": 200}

    config = write_config(tmp_path, model="sciforge-router-no-temperature")
    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=no_temperature_transport,
        diagnose_provider=True,
        diagnostic_transport=diagnostic_transport,
    )

    assert manifest["status"] == "completed"
    assert manifest["modelId"] == "sciforge-router-no-temperature"
    assert manifest["configuredModelMatchesProject"] is True
    assert manifest["projectVerifierEvidenceEligible"] is True
    assert any("temperature" not in payload for payload in payloads)


def test_semantic_verifier_probe_real_diagnostics_use_models_path_from_chat_endpoint_base_url(tmp_path):
    requests = []

    class FakeDiagnosticsProvider(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002, ANN001 - silence test HTTP server logs.
            return

        def do_GET(self):
            requests.append(("GET", self.path))
            if self.path == "/v1/models":
                self._send_json({"data": [{"id": "sciforge-router"}, {"id": "hidden-other-model"}]})
                return
            self._send_json({"error": "not found"}, status=404)

        def do_POST(self):
            length = int(self.headers.get("content-length") or "0")
            self.rfile.read(length)
            requests.append(("POST", self.path))
            if self.path == "/v1/chat/completions":
                self._send_json({
                    "choices": [
                        {"message": {"content": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"diagnostic text\"}"}}
                    ]
                })
                return
            if self.path == "/v1/responses":
                self._send_json({"output_text": "{\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"diagnostic responses\"}"})
                return
            self._send_json({"error": "not found"}, status=404)

        def _send_json(self, payload, *, status=200):
            body = json.dumps(payload).encode("utf8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def timeout_transport(url, payload, headers, timeout):
        raise TimeoutError("provider unavailable")

    with run_fake_provider(FakeDiagnosticsProvider) as api_base:
        config = write_config(tmp_path, base_url=f"{api_base}/chat/completions")
        manifest = run_semantic_verifier_probe(
            output_dir=tmp_path / "probe",
            config_file=config,
            transport=timeout_transport,
            diagnose_provider=True,
            diagnostic_timeout=2,
        )

    diagnostics = manifest["providerDiagnostics"]
    assert manifest["status"] == "blocked"
    assert diagnostics["baseUrlKind"] == "chat-completions-endpoint"
    assert diagnostics["modelsGet"]["ok"] is True
    assert diagnostics["modelsGet"]["path"] == "/v1/models"
    assert diagnostics["modelsGet"]["bodyKind"] == "json"
    assert diagnostics["modelsGet"]["modelCount"] == 2
    assert diagnostics["modelsGet"]["configuredModelPresent"] is True
    assert diagnostics["modelsGet"]["bytesRead"] > 0
    assert diagnostics["textChat"]["ok"] is True
    assert diagnostics["textChat"]["path"] == "/v1/chat/completions"
    assert diagnostics["textResponses"]["ok"] is True
    assert diagnostics["textResponses"]["path"] == "/v1/responses"
    assert ("GET", "/v1/models") in requests
    assert ("POST", "/v1/chat/completions") in requests
    assert ("POST", "/v1/responses") in requests
    assert ("GET", "/v1/chat/completions/models") not in requests
    assert "hidden-other-model" not in json.dumps(manifest)


def test_semantic_verifier_probe_models_diagnostic_summarizes_non_json_body(tmp_path):
    class TextModelsProvider(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002, ANN001 - silence test HTTP server logs.
            return

        def do_GET(self):
            if self.path == "/v1/models":
                body = b"hidden-other-model plain text"
                self.send_response(200)
                self.send_header("content-type", "text/plain")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def do_POST(self):
            length = int(self.headers.get("content-length") or "0")
            self.rfile.read(length)
            self.send_response(200)
            body = b'{"choices":[{"message":{"content":"{\\"verdict\\":\\"pass\\",\\"confidence\\":1,\\"reason\\":\\"text\\"}"}}]}'
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def timeout_transport(url, payload, headers, timeout):
        raise TimeoutError("provider unavailable")

    with run_fake_provider(TextModelsProvider) as api_base:
        config = write_config(tmp_path, base_url=api_base)
        manifest = run_semantic_verifier_probe(
            output_dir=tmp_path / "probe",
            config_file=config,
            transport=timeout_transport,
            diagnose_provider=True,
            diagnostic_timeout=2,
        )

    models_get = manifest["providerDiagnostics"]["modelsGet"]
    assert models_get["ok"] is True
    assert models_get["bodyKind"] == "text"
    assert models_get["modelCount"] is None
    assert models_get["configuredModelPresent"] is False
    assert "hidden-other-model" not in json.dumps(manifest)


def test_semantic_verifier_probe_diagnostics_resolve_models_from_chat_endpoint_base_url(tmp_path):
    config = write_config(tmp_path, base_url="http://127.0.0.1:1/v1/chat/completions")
    seen_urls = {}

    def timeout_transport(url, payload, headers, timeout):
        raise socket.timeout("timed out")

    def diagnostic_transport(label, url, payload, headers, timeout):
        seen_urls[label] = url
        return {"ok": False, "category": label, "errorType": "TimeoutError"}

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=timeout_transport,
        diagnose_provider=True,
        diagnostic_timeout=0.05,
        diagnostic_transport=diagnostic_transport,
    )

    diagnostics = manifest["providerDiagnostics"]
    assert seen_urls["modelsGet"] == "http://127.0.0.1:1/v1/models"
    assert seen_urls["textChat"] == "http://127.0.0.1:1/v1/chat/completions"
    assert seen_urls["textResponses"] == "http://127.0.0.1:1/v1/responses"
    assert diagnostics["baseUrlKind"] == "chat-completions-endpoint"
    assert diagnostics["diagnosticTimeoutSeconds"] == 0.05
    assert diagnostics["resolvedEndpoints"]["models"] == {"method": "GET", "path": "/v1/models"}
    assert diagnostics["modelsGet"]["method"] == "GET"
    assert diagnostics["modelsGet"]["path"] == "/v1/models"
    assert diagnostics["modelsGet"]["errorCategory"] == "TimeoutError"
    assert diagnostics["textChat"]["method"] == "POST"
    assert diagnostics["textChat"]["path"] == "/v1/chat/completions"
    assert diagnostics["textResponses"]["method"] == "POST"
    assert diagnostics["textResponses"]["path"] == "/v1/responses"
    assert "secret-token" not in json.dumps(manifest)
    assert "data:image" not in json.dumps(manifest)


def test_semantic_verifier_probe_redacts_userinfo_and_error_payloads(tmp_path):
    config = write_config(tmp_path, base_url="https://user:pass@example.test/v1")

    def leaky_transport(url, payload, headers, timeout):
        raise RuntimeError(
            "upstream leaked Authorization: Bearer secret-token data:image/png;base64,abcd "
            "https://user:pass@example.test/v1/chat/completions"
        )

    manifest = run_semantic_verifier_probe(
        output_dir=tmp_path / "probe",
        config_file=config,
        transport=leaky_transport,
    )

    serialized = json.dumps(manifest)
    assert manifest["baseUrlOrigin"] == "https://example.test"
    assert "secret-token" not in serialized
    assert "user:pass" not in serialized
    assert "data:image" not in serialized
    assert "base64" not in serialized.lower()


def is_text_preflight(payload):
    messages = payload.get("messages")
    return isinstance(messages, list) and len(messages) == 1 and isinstance(messages[0].get("content"), str)


class run_fake_provider:
    def __init__(self, handler):
        self.handler = handler
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        host, port = self.server.server_address
        return f"http://{host}:{port}/v1"

    def __exit__(self, exc_type, exc, tb):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def write_config(tmp_path, *, base_url="https://example.test/v1", model="sciforge-router"):
    config = tmp_path / "config.computer-use.local.json"
    config.write_text(
        json.dumps({
            "visionLLM": {
                "baseUrl": base_url,
                "apiKey": "secret-token",
                "model": model,
            }
        }),
        encoding="utf8",
    )
    return config


def assert_attempt_contains(attempt, expected):
    for key, value in expected.items():
        assert attempt[key] == value
