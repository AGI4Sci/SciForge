"""Package-local semantic vision verifier probe.

The Computer Use loop treats verifier output as optional host-provided verifier
metadata. This probe exercises that boundary with an OpenAI-compatible vision
chat endpoint and writes only refs-first summaries into package-local evidence.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .response_compat import chat_completions_to_responses, extract_provider_text, responses_to_chat_completions
from .verifier import normalize_verifier_metadata


PROBE_MANIFEST_SCHEMA = "sciforge.computer-use.semantic-verifier-probe.v1"
PROBE_TRACE_SCHEMA = "sciforge.computer-use.semantic-verifier-trace.v1"
SUMMARY_SCHEMA = "sciforge.computer-use.semantic-verifier-summary.v1"
DEFAULT_IMAGE_NAME = "semantic-verifier-input.png"
MANIFEST_NAME = "semantic-verifier-probe-manifest.json"
SUMMARY_NAME = "semantic-verifier-summary.json"
TRACE_NAME = "semantic-verifier-trace.json"
PROMPT_NAME = "semantic-verifier-prompt.txt"
DIAGNOSTIC_BODY_READ_LIMIT = 64 * 1024
PROJECT_VERIFIER_MODEL_ID = "sciforge-router"
PROJECT_VERIFIER_MODEL_IDS = ("sciforge-router", "model-router.capability.computer-use.verifier-translator", "sciforge-router-no-temperature")
LEGACY_DIRECT_PROVIDER_DIAGNOSTIC_ONLY = True
PRODUCT_MODEL_ROUTER_CALL_SURFACE = False
PRODUCT_DEFAULT_ACCEPTANCE_ALLOWED = False
USER_ACCEPTANCE_ELIGIBLE = False

DEFAULT_PROMPT = (
    "Verify this Computer Use screenshot evidence. Return only JSON with keys "
    "verdict, confidence, and reason. The correct verdict is pass when the "
    "image is available and can be inspected."
)

Transport = Callable[[str, Mapping[str, Any], Mapping[str, str], float], Mapping[str, Any]]
DiagnosticTransport = Callable[[str, str, Mapping[str, Any] | None, Mapping[str, str], float], Mapping[str, Any]]


@dataclass(frozen=True)
class VisionConfig:
    base_url: str
    api_key: str
    model: str
    source: Path


@dataclass(frozen=True)
class ProviderEndpoints:
    origin: str
    api_base_url: str
    base_url_kind: str
    chat_completions_url: str
    responses_url: str
    models_url: str


@dataclass(frozen=True)
class RawHttpResponse:
    status: int
    reason: str
    headers: Mapping[str, str]
    body: bytes


class ProviderAttemptError(RuntimeError):
    def __init__(self, message: str, *, attempts: Sequence[Mapping[str, Any]], failure_stage: str) -> None:
        super().__init__(message)
        self.attempts = [dict(attempt) for attempt in attempts]
        self.failure_stage = failure_stage


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a package-local semantic verifier probe.")
    parser.add_argument("--output-dir", required=True, help="Directory for manifest, trace, prompt, and evidence refs.")
    parser.add_argument("--config-file", help="Local JSON config. Defaults to config.computer-use.local.json then config.local.json.")
    parser.add_argument("--image-ref", help="Existing image ref/path to send to the verifier. A small PNG is created when omitted.")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Verifier prompt text. It is written as a prompt ref.")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--diagnose-provider",
        action="store_true",
        help="On provider failure, add TCP/origin/models/text-chat/text-responses diagnostics to the blocked manifest.",
    )
    parser.add_argument("--diagnostic-timeout", type=float, default=8.0, help="Timeout for each provider diagnostic request.")
    args = parser.parse_args(argv)

    manifest = run_semantic_verifier_probe(
        output_dir=Path(args.output_dir).expanduser(),
        config_file=Path(args.config_file).expanduser() if args.config_file else None,
        image_ref=Path(args.image_ref).expanduser() if args.image_ref else None,
        prompt=args.prompt,
        timeout=args.timeout,
        diagnose_provider=args.diagnose_provider,
        diagnostic_timeout=args.diagnostic_timeout,
    )
    json.dump(manifest, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest.get("status") == "completed" else 1


def run_semantic_verifier_probe(
    *,
    output_dir: Path,
    config_file: Path | None = None,
    image_ref: Path | None = None,
    prompt: str = DEFAULT_PROMPT,
    timeout: float = 30.0,
    diagnose_provider: bool = False,
    diagnostic_timeout: float = 8.0,
    transport: Transport | None = None,
    diagnostic_transport: DiagnosticTransport | None = None,
) -> dict[str, Any]:
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    prompt_ref = (output_dir / PROMPT_NAME).resolve()
    prompt_ref.write_text(prompt, encoding="utf8")

    config = _load_vision_config(config_file)
    if not config:
        manifest = _blocked_manifest(
            output_dir=output_dir,
            category="missing-config",
            reason="No usable vision LLM config was found.",
            prompt_ref=prompt_ref,
            checked_config_refs=_candidate_config_refs(config_file),
        )
        _write_json(output_dir / MANIFEST_NAME, manifest)
        return manifest

    missing = _missing_config_fields(config)
    if missing:
        manifest = _blocked_manifest(
            output_dir=output_dir,
            category="missing-config-fields",
            reason=f"Vision LLM config is missing required field(s): {', '.join(missing)}.",
            prompt_ref=prompt_ref,
            checked_config_refs=[str(config.source.resolve())],
            model_id=config.model or None,
            base_url_origin=_safe_url_origin(config.base_url),
        )
        _write_json(output_dir / MANIFEST_NAME, manifest)
        return manifest

    image_path = _prepare_image_ref(output_dir, image_ref)
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }

    try:
        parsed, content, attempts, successful_attempt, response_model_id = _run_verifier_attempts(
            config=config,
            image_path=image_path,
            prompt=prompt,
            headers=headers,
            timeout=timeout,
            transport=transport or _http_json_post,
        )
    except ProviderAttemptError as exc:
        provider_diagnostics = (
            _provider_diagnostics(config, headers=headers, timeout=diagnostic_timeout, transport=diagnostic_transport)
            if diagnose_provider
            else None
        )
        manifest = _blocked_manifest(
            output_dir=output_dir,
            category="provider-call-failed",
            reason=_sanitize_error(exc),
            prompt_ref=prompt_ref,
            checked_config_refs=[str(config.source.resolve())],
            image_ref=str(image_path),
            model_id=config.model,
            base_url_origin=_safe_url_origin(config.base_url),
            provider_diagnostics=provider_diagnostics,
            attempts=exc.attempts,
            failure_stage=exc.failure_stage,
            timeout_seconds=timeout,
        )
        _write_json(output_dir / MANIFEST_NAME, manifest)
        return manifest
    except Exception as exc:  # noqa: BLE001 - probe must write a structured blocked manifest.
        provider_diagnostics = (
            _provider_diagnostics(config, headers=headers, timeout=diagnostic_timeout, transport=diagnostic_transport)
            if diagnose_provider
            else None
        )
        manifest = _blocked_manifest(
            output_dir=output_dir,
            category="provider-call-failed",
            reason=_sanitize_error(exc),
            prompt_ref=prompt_ref,
            checked_config_refs=[str(config.source.resolve())],
            image_ref=str(image_path),
            model_id=config.model,
            base_url_origin=_safe_url_origin(config.base_url),
            provider_diagnostics=provider_diagnostics,
            attempts=[],
            failure_stage="provider-call",
            timeout_seconds=timeout,
        )
        _write_json(output_dir / MANIFEST_NAME, manifest)
        return manifest

    provider_verdict = str(parsed.get("verdict") or "unknown").strip().lower()
    provider_diagnostics = (
        _provider_diagnostics(config, headers=headers, timeout=diagnostic_timeout, transport=diagnostic_transport)
        if diagnose_provider
        else None
    )
    vlm_evidence = _project_vlm_evidence_summary(
        config=config,
        response_model_id=response_model_id,
        provider_diagnostics=provider_diagnostics,
    )
    if provider_verdict != "pass":
        manifest = _blocked_manifest(
            output_dir=output_dir,
            category="semantic-verifier-verdict-not-pass",
            reason=f"Semantic verifier returned verdict={_safe_error_text(provider_verdict or 'unknown')}.",
            prompt_ref=prompt_ref,
            checked_config_refs=[str(config.source.resolve())],
            image_ref=str(image_path),
            model_id=config.model,
            base_url_origin=_safe_url_origin(config.base_url),
            attempts=attempts,
            failure_stage="semantic-verifier-verdict",
            timeout_seconds=timeout,
            provider_diagnostics=provider_diagnostics,
        )
        manifest["providerVerdict"] = _safe_error_text(provider_verdict or "unknown")
        manifest["providerConfidence"] = _coerce_confidence(parsed.get("confidence"))
        manifest["successfulAttempt"] = successful_attempt
        manifest["semanticVerifierEvidenceRefs"] = [str(image_path), str(prompt_ref)]
        manifest["responseModelId"] = response_model_id
        manifest.update(vlm_evidence)
        _write_json(output_dir / MANIFEST_NAME, manifest)
        return manifest

    trace_ref = (output_dir / TRACE_NAME).resolve()
    semantic_metadata = normalize_verifier_metadata({
        "semanticVerifier": {
            "providerId": "model-router-semantic-verifier",
            "modelId": config.model,
            "verdict": provider_verdict,
            "confidence": _coerce_confidence(parsed.get("confidence")),
            "reason": str(parsed.get("reason") or content or ""),
            "evidenceRefs": [str(image_path), str(prompt_ref)],
        }
    })
    semantic_summary = dict(semantic_metadata.get("semanticVerifier") or {})
    semantic_summary["traceRefs"] = [str(trace_ref)]
    summary_ref = (output_dir / SUMMARY_NAME).resolve()
    _write_json(
        summary_ref,
        {
            "schemaVersion": SUMMARY_SCHEMA,
            "semanticVerifier": semantic_summary,
            "modelId": config.model,
            "expectedProjectModelId": PROJECT_VERIFIER_MODEL_ID,
            "responseModelId": response_model_id,
            "baseUrlOrigin": _safe_url_origin(config.base_url),
            "evidenceRefs": [str(image_path), str(prompt_ref)],
            **vlm_evidence,
            "rawPayloadWritten": False,
            **_diagnostic_boundary_fields(),
        },
    )
    _write_json(
        trace_ref,
        {
            "schemaVersion": PROBE_TRACE_SCHEMA,
            "status": "completed",
            "providerId": "model-router-semantic-verifier",
            "modelId": config.model,
            "expectedProjectModelId": PROJECT_VERIFIER_MODEL_ID,
            "responseModelId": response_model_id,
            "baseUrlOrigin": _safe_url_origin(config.base_url),
            "promptRef": str(prompt_ref),
            "imageRef": str(image_path),
            "summaryRef": str(summary_ref),
            "semanticVerifier": semantic_summary,
            **vlm_evidence,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            **_diagnostic_boundary_fields(),
        },
    )
    manifest = {
        "schemaVersion": PROBE_MANIFEST_SCHEMA,
        "status": "completed",
        "category": "semantic-verifier",
        "reason": "Semantic verifier returned a refs-first summary.",
        "configSource": str(config.source.resolve()),
        "baseUrlOrigin": _safe_url_origin(config.base_url),
        "modelId": config.model,
        "expectedProjectModelId": PROJECT_VERIFIER_MODEL_ID,
        "responseModelId": response_model_id,
        "providerId": "model-router-semantic-verifier",
        "promptRef": str(prompt_ref),
        "imageRef": str(image_path),
        "summaryRef": str(summary_ref),
        "traceRefs": [str(trace_ref)],
        "evidenceRefs": [str(image_path), str(prompt_ref), str(summary_ref)],
        "successfulAttempt": successful_attempt,
        "attempts": attempts,
        "providerDiagnostics": provider_diagnostics,
        "timeoutSeconds": timeout,
        "semanticVerifier": semantic_summary,
        **vlm_evidence,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        **_diagnostic_boundary_fields(),
        "note": "This probe verifies the package metadata boundary; verifier output remains optional evidence and does not own execution, coordinates, or completion.",
    }
    _write_json(output_dir / MANIFEST_NAME, manifest)
    return manifest


def _diagnostic_boundary_fields() -> dict[str, Any]:
    return {
        "legacyDirectProviderDiagnosticOnly": LEGACY_DIRECT_PROVIDER_DIAGNOSTIC_ONLY,
        "productModelRouterCallSurface": PRODUCT_MODEL_ROUTER_CALL_SURFACE,
        "productDefaultAcceptanceAllowed": PRODUCT_DEFAULT_ACCEPTANCE_ALLOWED,
        "diagnosticOnly": LEGACY_DIRECT_PROVIDER_DIAGNOSTIC_ONLY,
        "userAcceptanceEligible": USER_ACCEPTANCE_ELIGIBLE,
    }


def _load_vision_config(config_file: Path | None) -> VisionConfig | None:
    for path in _candidate_config_paths(config_file):
        if not path.exists():
            continue
        try:
            parsed = json.loads(path.read_text(encoding="utf8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, Mapping):
            continue
        config = _config_from_mapping(parsed, path)
        if config:
            return config
    return None


def _config_from_mapping(parsed: Mapping[str, Any], source: Path) -> VisionConfig | None:
    vision = parsed.get("visionLLM")
    if isinstance(vision, Mapping):
        env = vision.get("env") if isinstance(vision.get("env"), Mapping) else {}
        return VisionConfig(
            base_url=str(_first_present(vision, env, keys=("baseUrl", "base_url", "SCIFORGE_VISION_TRANSLATOR_BASE_URL")) or ""),
            api_key=str(_first_present(vision, env, keys=("apiKey", "api_key", "SCIFORGE_VISION_TRANSLATOR_API_KEY")) or ""),
            model=str(_first_present(vision, env, keys=("model", "modelId", "SCIFORGE_VISION_TRANSLATOR_MODEL")) or ""),
            source=source,
        )

    computer_use = parsed.get("computerUse")
    if isinstance(computer_use, Mapping):
        nested = computer_use.get("visionLLM")
        if isinstance(nested, Mapping):
            return VisionConfig(
                base_url=str(_first_present(nested, {}, keys=("baseUrl", "base_url")) or ""),
                api_key=str(_first_present(nested, {}, keys=("apiKey", "api_key")) or ""),
                model=str(_first_present(nested, {}, keys=("model", "modelId")) or ""),
                source=source,
            )

    return None


def _candidate_config_paths(config_file: Path | None) -> list[Path]:
    if config_file:
        return [config_file.expanduser().resolve()]
    candidates: list[Path] = []
    for root in [Path.cwd(), *Path(__file__).resolve().parents]:
        for name in ("config.computer-use.local.json", "config.local.json"):
            path = (root / name).resolve()
            if path not in candidates:
                candidates.append(path)
    return candidates


def _candidate_config_refs(config_file: Path | None) -> list[str]:
    return [str(path) for path in _candidate_config_paths(config_file)]


def _first_present(primary: Mapping[str, Any], secondary: Mapping[str, Any], *, keys: Sequence[str]) -> Any:
    for key in keys:
        value = primary.get(key)
        if value not in (None, ""):
            return value
    for key in keys:
        value = secondary.get(key)
        if value not in (None, ""):
            return value
    return None


def _missing_config_fields(config: VisionConfig) -> list[str]:
    missing: list[str] = []
    if not config.base_url.strip():
        missing.append("baseUrl")
    if not config.api_key.strip():
        missing.append("apiKey")
    if not config.model.strip():
        missing.append("model")
    return missing


def _prepare_image_ref(output_dir: Path, image_ref: Path | None) -> Path:
    if image_ref:
        path = image_ref.resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Image ref does not exist: {path}")
        return path
    path = (output_dir / DEFAULT_IMAGE_NAME).resolve()
    path.write_bytes(_MINIMAL_PNG_BYTES)
    return path


def _build_chat_payload(model: str, prompt: str, image_path: Path) -> dict[str, Any]:
    image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return _build_chat_image_payload(model, prompt, f"data:image/png;base64,{image_data}", image_url_shape="object")


def _build_text_chat_payload(model: str) -> dict[str, Any]:
    return responses_to_chat_completions(_build_text_responses_payload(model))


def _build_chat_image_payload(model: str, prompt: str, data_url: str, *, image_url_shape: str) -> dict[str, Any]:
    image_value: Any = {"url": data_url} if image_url_shape == "object" else data_url
    return {
        "model": model,
        "temperature": 0,
        "max_tokens": 160,
        "messages": [
            {
                "role": "system",
                "content": "You are a strict Computer Use semantic verifier. Return compact JSON only.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": image_value},
                ],
            },
        ],
    }


def _without_temperature(payload: Mapping[str, Any]) -> dict[str, Any]:
    clone = dict(payload)
    clone.pop("temperature", None)
    return clone


def _build_responses_image_payload(model: str, prompt: str, image_path: Path) -> dict[str, Any]:
    image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return chat_completions_to_responses(
        _build_chat_image_payload(
            model,
            prompt,
            f"data:image/png;base64,{image_data}",
            image_url_shape="object",
        )
    )


def _run_verifier_attempts(
    *,
    config: VisionConfig,
    image_path: Path,
    prompt: str,
    headers: Mapping[str, str],
    timeout: float,
    transport: Transport,
) -> tuple[dict[str, Any], str, list[dict[str, Any]], dict[str, Any], str | None]:
    attempts: list[dict[str, Any]] = []
    endpoints = _provider_endpoints(config.base_url)
    text_payloads = [
        ("chat-completions", "text-only", endpoints.chat_completions_url, _build_text_chat_payload(config.model)),
        ("chat-completions", "text-only-minimal", endpoints.chat_completions_url, _build_minimal_text_chat_payload(config.model)),
        ("responses", "responses-text-only", endpoints.responses_url, _build_text_responses_payload(config.model)),
        ("responses", "responses-text-only-no-temperature", endpoints.responses_url, _without_temperature(_build_text_responses_payload(config.model))),
    ]
    text_preflight_ok = False
    responses_text_preflight_ok = False
    for endpoint_kind, payload_kind, url, payload in text_payloads:
        started = time.monotonic()
        try:
            text_response, retry_count = _transport_with_bounded_retry(
                transport,
                url,
                payload,
                headers,
                timeout,
            )
            _extract_provider_content(text_response)
            attempts.append(_attempt_record(
                stage="text-preflight",
                endpoint_kind=endpoint_kind,
                payload_kind=payload_kind,
                status="completed",
                elapsed_ms=_elapsed_ms(started),
                retry_count=retry_count,
            ))
            text_preflight_ok = True
            responses_text_preflight_ok = endpoint_kind == "responses"
            break
        except Exception as exc:  # noqa: BLE001 - preserve a structured attempt record.
            attempts.append(_attempt_record(
                stage="text-preflight",
                endpoint_kind=endpoint_kind,
                payload_kind=payload_kind,
                status="failed",
                error=exc,
                elapsed_ms=_elapsed_ms(started),
                retry_count=_retry_count_from_exception(exc),
            ))
            if not _is_shape_rejection(exc):
                raise ProviderAttemptError(_sanitize_error(exc), attempts=attempts, failure_stage="text-preflight") from exc
    if not text_preflight_ok:
        last_error = RuntimeError("Text preflight was rejected by all compatible Chat/Responses payload shapes.")
        raise ProviderAttemptError(_sanitize_error(last_error), attempts=attempts, failure_stage="text-preflight") from last_error

    candidates = _multimodal_candidates(config, prompt, image_path)
    if responses_text_preflight_ok:
        candidates = [candidate for candidate in candidates if candidate["endpointKind"] == "responses"]
    last_error: Exception | None = None
    for candidate in candidates:
        started = time.monotonic()
        try:
            response, retry_count = _transport_with_bounded_retry(
                transport,
                candidate["url"],
                candidate["payload"],
                headers,
                timeout,
            )
            content = _extract_provider_content(response)
            parsed = _parse_verdict_content(content)
            attempt = _attempt_record(
                stage="multimodal-request",
                endpoint_kind=str(candidate["endpointKind"]),
                payload_kind=str(candidate["payloadKind"]),
                status="completed",
                elapsed_ms=_elapsed_ms(started),
                retry_count=retry_count,
            )
            attempts.append(attempt)
            return parsed, content, attempts, attempt, _provider_response_model_id(response)
        except Exception as exc:  # noqa: BLE001 - continue to the next safe variant.
            last_error = exc
            attempts.append(_attempt_record(
                stage="multimodal-request",
                endpoint_kind=str(candidate["endpointKind"]),
                payload_kind=str(candidate["payloadKind"]),
                status="failed",
                error=exc,
                elapsed_ms=_elapsed_ms(started),
                retry_count=_retry_count_from_exception(exc),
            ))
    message = _sanitize_error(last_error) if last_error else "No semantic verifier variants were attempted."
    raise ProviderAttemptError(message, attempts=attempts, failure_stage="multimodal-request")


def _build_minimal_text_chat_payload(model: str) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Return compact JSON only: {\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text health\"}.",
            }
        ],
    }


def _build_text_responses_payload(model: str) -> dict[str, Any]:
    return {
        "model": model,
        "temperature": 0,
        "max_output_tokens": 40,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Return compact JSON only: {\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text health\"}.",
                    }
                ],
            }
        ],
    }


def _transport_with_bounded_retry(
    transport: Transport,
    url: str,
    payload: Mapping[str, Any],
    headers: Mapping[str, str],
    timeout: float,
    *,
    max_retries: int = 1,
) -> tuple[Mapping[str, Any], int]:
    attempts = 0
    while True:
        try:
            return transport(url, payload, headers, timeout), attempts
        except Exception as exc:  # noqa: BLE001 - retry classification is bounded and explicit.
            if attempts >= max_retries or not _is_retryable_provider_error(exc):
                if attempts:
                    raise ProviderRetryError(str(exc), retry_count=attempts, cause=exc) from exc
                raise
            attempts += 1


class ProviderRetryError(RuntimeError):
    def __init__(self, message: str, *, retry_count: int, cause: Exception) -> None:
        super().__init__(message)
        self.retry_count = retry_count
        self.cause = cause


def _retry_count_from_exception(exc: Exception) -> int:
    if isinstance(exc, ProviderRetryError):
        return exc.retry_count
    return 0


def _is_retryable_provider_error(exc: Exception) -> bool:
    if isinstance(exc, ProviderRetryError):
        return _is_retryable_provider_error(exc.cause)
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in {408, 429, 500, 502, 503, 504}
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, urllib.error.URLError):
        return _url_error_category(exc.reason) in {"timeout", "dns", "connection-refused", "url-error"}
    return False


def _is_shape_rejection(exc: Exception) -> bool:
    if isinstance(exc, ProviderRetryError):
        return _is_shape_rejection(exc.cause)
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in {400, 415, 422}
    text = str(exc).lower()
    return any(token in text for token in ("shape", "schema", "unsupported", "invalid payload", "bad request"))


def _multimodal_candidates(config: VisionConfig, prompt: str, image_path: Path) -> list[dict[str, Any]]:
    image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    data_url = f"data:image/png;base64,{image_data}"
    endpoints = _provider_endpoints(config.base_url)
    chat_object_payload = _build_chat_image_payload(config.model, prompt, data_url, image_url_shape="object")
    chat_string_payload = _build_chat_image_payload(config.model, prompt, data_url, image_url_shape="string")
    responses_payload = _build_responses_image_payload(config.model, prompt, image_path)
    return [
        {
            "endpointKind": "chat-completions",
            "payloadKind": "chat-image-url-object",
            "url": endpoints.chat_completions_url,
            "payload": chat_object_payload,
        },
        {
            "endpointKind": "chat-completions",
            "payloadKind": "chat-image-url-string",
            "url": endpoints.chat_completions_url,
            "payload": chat_string_payload,
        },
        {
            "endpointKind": "responses",
            "payloadKind": "responses-input-image",
            "url": endpoints.responses_url,
            "payload": responses_payload,
        },
        {
            "endpointKind": "chat-completions",
            "payloadKind": "chat-image-url-object-no-temperature",
            "url": endpoints.chat_completions_url,
            "payload": _without_temperature(chat_object_payload),
        },
        {
            "endpointKind": "chat-completions",
            "payloadKind": "chat-image-url-string-no-temperature",
            "url": endpoints.chat_completions_url,
            "payload": _without_temperature(chat_string_payload),
        },
        {
            "endpointKind": "responses",
            "payloadKind": "responses-input-image-no-temperature",
            "url": endpoints.responses_url,
            "payload": _without_temperature(responses_payload),
        },
    ]


def _attempt_record(
    *,
    stage: str,
    endpoint_kind: str,
    payload_kind: str,
    status: str,
    error: Exception | None = None,
    elapsed_ms: int | None = None,
    retry_count: int | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "stage": stage,
        "endpointKind": endpoint_kind,
        "payloadKind": payload_kind,
        "status": status,
    }
    if elapsed_ms is not None:
        record["elapsedMs"] = elapsed_ms
    if retry_count is not None:
        record["retryCount"] = retry_count
    if error is not None:
        record["errorCategory"] = _error_category(error)
        record["reason"] = _sanitize_error(error)
    return record


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))


def _http_json_post(url: str, payload: Mapping[str, Any], headers: Mapping[str, str], timeout: float) -> Mapping[str, Any]:
    try:
        return _raw_http_json_post(url, payload, headers, timeout)
    except Exception as exc:
        if isinstance(exc, urllib.error.HTTPError) or not _is_retryable_provider_error(exc):
            raise
        return _urllib_json_post(url, payload, headers, timeout)


def _urllib_json_post(url: str, payload: Mapping[str, Any], headers: Mapping[str, str], timeout: float) -> Mapping[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf8"),
        headers=dict(headers),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - user-provided local config controls endpoint.
        body = response.read().decode("utf8")
    parsed = json.loads(body)
    if not isinstance(parsed, Mapping):
        raise ValueError("Provider response root was not a JSON object.")
    return parsed


def _raw_http_json_post(url: str, payload: Mapping[str, Any], headers: Mapping[str, str], timeout: float) -> Mapping[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf8")
    response = _raw_http_request("POST", url, body, headers, timeout)
    if response.status >= 400:
        raise urllib.error.HTTPError(url, response.status, response.reason, response.headers, None)
    parsed = json.loads(response.body.decode("utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Provider response root was not a JSON object.")
    return parsed


def _raw_http_request(
    method: str,
    url: str,
    body: bytes | None,
    headers: Mapping[str, str],
    timeout: float,
    *,
    read_limit: int | None = None,
) -> RawHttpResponse:
    parsed = urllib.parse.urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise urllib.error.URLError("invalid provider URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    outbound_headers = {
        str(key): str(value)
        for key, value in headers.items()
        if key.lower() not in {"host", "content-length", "connection"}
    }
    outbound_headers.setdefault("Accept", "*/*")
    outbound_headers.setdefault("User-Agent", "sciforge-computer-use-raw-http/1")
    outbound_headers["Host"] = parsed.netloc
    outbound_headers["Connection"] = "close"
    if body is not None:
        outbound_headers["Content-Length"] = str(len(body))
    request_head = [f"{method.upper()} {path} HTTP/1.1"]
    request_head.extend(f"{key}: {value}" for key, value in outbound_headers.items())
    request = ("\r\n".join(request_head) + "\r\n\r\n").encode("utf8") + (body or b"")
    started = time.monotonic()
    with socket.create_connection((parsed.hostname, port), timeout=timeout) as sock:
        sock.settimeout(max(0.001, timeout - (time.monotonic() - started)))
        if parsed.scheme == "https":
            context = ssl.create_default_context()
            with context.wrap_socket(sock, server_hostname=parsed.hostname) as tls_sock:
                tls_sock.sendall(request)
                raw_response = _read_raw_http_response(tls_sock, read_limit=read_limit)
        else:
            sock.sendall(request)
            raw_response = _read_raw_http_response(sock, read_limit=read_limit)
    return _parse_raw_http_response(raw_response)


def _read_raw_http_response(sock: socket.socket | ssl.SSLSocket, *, read_limit: int | None) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if read_limit is not None and total > read_limit + 65536:
            break
    return b"".join(chunks)


def _parse_raw_http_response(raw_response: bytes) -> RawHttpResponse:
    header_blob, separator, raw_body = raw_response.partition(b"\r\n\r\n")
    if not separator:
        raise ValueError("Provider raw HTTP response did not include headers.")
    header_lines = header_blob.decode("iso-8859-1", "replace").split("\r\n")
    status_parts = header_lines[0].split(" ", 2)
    if len(status_parts) < 2 or not status_parts[1].isdigit():
        raise ValueError("Provider raw HTTP response had an invalid status line.")
    status = int(status_parts[1])
    reason = status_parts[2] if len(status_parts) > 2 else ""
    response_headers: dict[str, str] = {}
    for line in header_lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        response_headers[key.strip().lower()] = value.strip()
    body = _decode_chunked_body(raw_body) if response_headers.get("transfer-encoding", "").lower() == "chunked" else raw_body
    return RawHttpResponse(status=status, reason=reason, headers=response_headers, body=body)


def _decode_chunked_body(raw_body: bytes) -> bytes:
    decoded = bytearray()
    index = 0
    while index < len(raw_body):
        line_end = raw_body.find(b"\r\n", index)
        if line_end < 0:
            break
        size_text = raw_body[index:line_end].split(b";", 1)[0].strip()
        try:
            size = int(size_text, 16)
        except ValueError:
            return raw_body
        index = line_end + 2
        if size == 0:
            break
        decoded.extend(raw_body[index : index + size])
        index += size + 2
    return bytes(decoded)


def _provider_diagnostics(
    config: VisionConfig,
    *,
    headers: Mapping[str, str],
    timeout: float,
    transport: DiagnosticTransport | None = None,
) -> dict[str, Any]:
    endpoints = _provider_endpoints(config.base_url)
    diagnostics = {
        "schemaVersion": "sciforge.computer-use.provider-diagnostics.v1",
        "baseUrlOrigin": endpoints.origin,
        "baseUrlKind": endpoints.base_url_kind,
        "diagnosticTimeoutSeconds": timeout,
        "modelId": config.model,
        "resolvedEndpoints": _safe_resolved_endpoints(endpoints),
        "tcp": _tcp_diagnostic(config.base_url, timeout=timeout),
        "originGet": _diagnostic_request("originGet", endpoints.origin, None, headers, timeout, transport, model_id=config.model),
        "modelsGet": _diagnostic_request("modelsGet", endpoints.models_url, None, headers, timeout, transport, model_id=config.model),
        "textChat": _diagnostic_request(
            "textChat",
            endpoints.chat_completions_url,
            {
                "model": config.model,
                "temperature": 0,
                "max_tokens": 40,
                "messages": [
                    {
                        "role": "user",
                        "content": "Return compact JSON only: {\"verdict\":\"pass\",\"confidence\":1,\"reason\":\"text health\"}.",
                    }
                ],
            },
            headers,
            timeout,
            transport,
            model_id=config.model,
        ),
        "textResponses": _diagnostic_request(
            "textResponses",
            endpoints.responses_url,
            _build_text_responses_payload(config.model),
            headers,
            timeout,
            transport,
            model_id=config.model,
        ),
    }
    return diagnostics


def _tcp_diagnostic(base_url: str, *, timeout: float) -> dict[str, Any]:
    started = time.monotonic()
    try:
        parsed = urllib.parse.urlsplit(base_url.strip())
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not parsed.hostname:
            return {
                "ok": False,
                "category": "tcp",
                "errorType": "invalid-host",
                "errorCategory": "invalid-url",
                "retryable": False,
                "elapsedMs": _elapsed_ms(started),
                "timeoutSeconds": timeout,
            }
        with socket.create_connection((parsed.hostname, port), timeout=timeout):
            return {
                "ok": True,
                "category": "tcp",
                "retryable": False,
                "elapsedMs": _elapsed_ms(started),
                "timeoutSeconds": timeout,
            }
    except Exception as exc:  # noqa: BLE001 - diagnostics must stay bounded.
        return {
            "ok": False,
            "category": "tcp",
            "errorType": type(exc).__name__,
            "errorCategory": _error_category(exc),
            "retryable": _is_retryable_provider_error(exc),
            "elapsedMs": _elapsed_ms(started),
            "timeoutSeconds": timeout,
        }


def _diagnostic_request(
    label: str,
    url: str,
    payload: Mapping[str, Any] | None,
    headers: Mapping[str, str],
    timeout: float,
    transport: DiagnosticTransport | None,
    *,
    model_id: str | None = None,
) -> dict[str, Any]:
    method = "GET" if payload is None else "POST"
    started = time.monotonic()
    base_record = {
        "category": label,
        "method": method,
        "path": _safe_url_path(url),
        "timeoutSeconds": timeout,
    }
    if not url:
        return {
            **base_record,
            "ok": False,
            "errorType": "missing-url",
            "errorCategory": "invalid-url",
            "retryable": False,
            "elapsedMs": _elapsed_ms(started),
        }
    if transport:
        try:
            return _diagnostic_result_record(
                base_record,
                transport(label, url, payload, headers, timeout),
                elapsed_ms=_elapsed_ms(started),
            )
        except Exception as exc:  # noqa: BLE001 - diagnostics must stay bounded.
            return {
                **base_record,
                "ok": False,
                "errorType": type(exc).__name__,
                "errorCategory": _error_category(exc),
                "retryable": _is_retryable_provider_error(exc),
                "elapsedMs": _elapsed_ms(started),
            }
    try:
        status, body = _diagnostic_http_request(url, payload, headers, timeout)
        body_summary = _diagnostic_body_summary(label, body, model_id=model_id)
        return {
            **base_record,
            "ok": 200 <= status < 400,
            "status": status,
            "errorCategory": "none" if 200 <= status < 400 else _http_error_category(status),
            "retryable": status in {408, 429, 500, 502, 503, 504},
            "elapsedMs": _elapsed_ms(started),
            **body_summary,
        }
    except urllib.error.HTTPError as exc:
        return {
            **base_record,
            "ok": False,
            "status": exc.code,
            "errorType": "HTTPError",
            "errorCategory": _error_category(exc),
            "retryable": _is_retryable_provider_error(exc),
            "elapsedMs": _elapsed_ms(started),
        }
    except urllib.error.URLError as exc:
        return {
            **base_record,
            "ok": False,
            "errorType": type(exc.reason).__name__,
            "errorCategory": _error_category(exc),
            "retryable": _is_retryable_provider_error(exc),
            "elapsedMs": _elapsed_ms(started),
        }
    except Exception as exc:  # noqa: BLE001 - diagnostics must stay bounded.
        return {
            **base_record,
            "ok": False,
            "errorType": type(exc).__name__,
            "errorCategory": _error_category(exc),
            "retryable": _is_retryable_provider_error(exc),
            "elapsedMs": _elapsed_ms(started),
        }


def _diagnostic_http_request(url: str, payload: Mapping[str, Any] | None, headers: Mapping[str, str], timeout: float) -> tuple[int, bytes]:
    diagnostic_headers = {key: value for key, value in headers.items() if payload is not None or key.lower() != "content-type"}
    raw_body = json.dumps(payload, separators=(",", ":")).encode("utf8") if payload is not None else None
    try:
        response = _raw_http_request("GET" if payload is None else "POST", url, raw_body, diagnostic_headers, timeout, read_limit=DIAGNOSTIC_BODY_READ_LIMIT + 1)
        return response.status, response.body[: DIAGNOSTIC_BODY_READ_LIMIT + 1]
    except Exception as exc:
        if isinstance(exc, urllib.error.HTTPError) or not _is_retryable_provider_error(exc):
            raise
    try:
        if payload is None:
            request = urllib.request.Request(url, headers={key: value for key, value in headers.items() if key.lower() != "content-type"}, method="GET")
        else:
            request = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf8"),
                headers=dict(headers),
                method="POST",
            )
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - user-provided local config controls endpoint.
            return response.status, response.read(DIAGNOSTIC_BODY_READ_LIMIT + 1)
    except Exception as exc:
        if not _is_retryable_provider_error(exc):
            raise
    raise


def _chat_completions_url(base_url: str) -> str:
    return _provider_endpoints(base_url).chat_completions_url


def _responses_url(base_url: str) -> str:
    return _provider_endpoints(base_url).responses_url


def _provider_endpoints(base_url: str) -> ProviderEndpoints:
    text = base_url.strip().rstrip("/")
    api_base_url = text
    base_url_kind = "api-base"
    for suffix, kind in (
        ("/chat/completions", "chat-completions-endpoint"),
        ("/responses", "responses-endpoint"),
        ("/models", "models-endpoint"),
    ):
        if api_base_url.endswith(suffix):
            api_base_url = api_base_url[: -len(suffix)].rstrip("/")
            base_url_kind = kind
            break
    return ProviderEndpoints(
        origin=_safe_url_origin(text),
        api_base_url=api_base_url,
        base_url_kind=base_url_kind,
        chat_completions_url=f"{api_base_url}/chat/completions" if api_base_url else "",
        responses_url=f"{api_base_url}/responses" if api_base_url else "",
        models_url=f"{api_base_url}/models" if api_base_url else "",
    )


def _safe_resolved_endpoints(endpoints: ProviderEndpoints) -> dict[str, Any]:
    return {
        "apiBasePath": _safe_url_path(endpoints.api_base_url),
        "chatCompletions": {"method": "POST", "path": _safe_url_path(endpoints.chat_completions_url)},
        "responses": {"method": "POST", "path": _safe_url_path(endpoints.responses_url)},
        "models": {"method": "GET", "path": _safe_url_path(endpoints.models_url)},
    }


def _safe_url_path(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
    except ValueError:
        return ""
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?<redacted>"
    return path


def _diagnostic_result_record(base_record: Mapping[str, Any], result: Mapping[str, Any], *, elapsed_ms: int) -> dict[str, Any]:
    sanitized = _sanitize_diagnostic_transport_result(result)
    record = {**base_record, **sanitized}
    record["category"] = str(base_record["category"])
    record["method"] = str(base_record["method"])
    record["path"] = str(base_record["path"])
    record["timeoutSeconds"] = base_record["timeoutSeconds"]
    record["elapsedMs"] = int(record.get("elapsedMs")) if isinstance(record.get("elapsedMs"), int) else elapsed_ms
    status = record.get("status")
    if "retryable" not in record:
        record["retryable"] = bool(isinstance(status, int) and status in {408, 429, 500, 502, 503, 504})
    if "errorCategory" not in record:
        if record.get("ok") is True:
            record["errorCategory"] = "none"
        elif isinstance(status, int):
            record["errorCategory"] = _http_error_category(status)
        elif isinstance(record.get("errorType"), str):
            record["errorCategory"] = _safe_error_text(str(record["errorType"]))
    return record


def _diagnostic_body_summary(label: str, body: bytes, *, model_id: str | None = None) -> dict[str, Any]:
    truncated = len(body) > DIAGNOSTIC_BODY_READ_LIMIT
    visible_body = body[:DIAGNOSTIC_BODY_READ_LIMIT]
    summary: dict[str, Any] = {
        "bytesRead": len(visible_body),
        "bodyTruncated": truncated,
        "bodyKind": "empty" if not visible_body else "text",
    }
    if label == "modelsGet":
        summary["modelCount"] = None
        summary["configuredModelPresent"] = False
    if not visible_body:
        if label == "modelsGet":
            summary["modelCount"] = 0
        return summary
    try:
        decoded = visible_body.decode("utf8")
    except UnicodeDecodeError:
        summary["bodyKind"] = "binary"
        return summary
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError:
        return summary
    summary["bodyKind"] = "json"
    if label == "modelsGet":
        model_ids = _extract_model_ids_from_models_payload(parsed)
        summary["modelCount"] = len(model_ids)
        summary["configuredModelPresent"] = bool(model_id and model_id in model_ids)
    return summary


def _extract_model_ids_from_models_payload(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        for key in ("data", "models"):
            items = value.get(key)
            if isinstance(items, list):
                return _model_ids_from_items(items)
        model_id = value.get("id")
        return {model_id} if isinstance(model_id, str) and model_id else set()
    if isinstance(value, list):
        return _model_ids_from_items(value)
    return set()


def _model_ids_from_items(items: Sequence[Any]) -> set[str]:
    model_ids: set[str] = set()
    for item in items:
        if isinstance(item, str) and item:
            model_ids.add(item)
            continue
        record = item if isinstance(item, Mapping) else {}
        model_id = record.get("id") or record.get("model")
        if isinstance(model_id, str) and model_id:
            model_ids.add(model_id)
    return model_ids


def _sanitize_diagnostic_transport_result(result: Mapping[str, Any]) -> dict[str, Any]:
    allowed = {
        "ok",
        "category",
        "status",
        "errorType",
        "errorCategory",
        "retryable",
        "elapsedMs",
        "timeoutSeconds",
        "method",
        "path",
        "bodyKind",
        "bytesRead",
        "bodyTruncated",
        "modelCount",
        "configuredModelPresent",
    }
    sanitized: dict[str, Any] = {}
    for key, value in result.items():
        if key not in allowed:
            continue
        if key == "ok" and isinstance(value, bool):
            sanitized[key] = value
        elif key in {"status", "elapsedMs"} and isinstance(value, int):
            sanitized[key] = value
        elif key in {"bytesRead", "modelCount"} and (isinstance(value, int) or value is None):
            sanitized[key] = value
        elif key in {"timeoutSeconds"} and isinstance(value, (int, float)):
            sanitized[key] = value
        elif key in {"retryable", "bodyTruncated", "configuredModelPresent"} and isinstance(value, bool):
            sanitized[key] = value
        elif key == "method" and isinstance(value, str):
            sanitized[key] = value[:12].upper()
        elif key == "path" and isinstance(value, str):
            sanitized[key] = _safe_url_path(value) if "://" in value else _safe_error_text(value[:200])
        elif isinstance(value, str):
            sanitized[key] = _safe_error_text(value[:500])
    return sanitized


def _extract_message_content(response_payload: Mapping[str, Any]) -> str:
    return _extract_provider_content(response_payload)


def _extract_provider_content(response_payload: Mapping[str, Any]) -> str:
    return extract_provider_text(response_payload)


def _provider_response_model_id(response_payload: Mapping[str, Any]) -> str | None:
    model = response_payload.get("model")
    return model.strip() if isinstance(model, str) and model.strip() else None


def _project_vlm_evidence_summary(
    *,
    config: VisionConfig,
    response_model_id: str | None,
    provider_diagnostics: Mapping[str, Any] | None,
) -> dict[str, Any]:
    configured_matches_project = config.model in PROJECT_VERIFIER_MODEL_IDS
    response_model_matches_configured = response_model_id in (None, config.model)
    model_presence_verified = None
    models_get = _mapping_or_empty((provider_diagnostics or {}).get("modelsGet"))
    if models_get:
        model_presence_verified = models_get.get("ok") is True and models_get.get("configuredModelPresent") is True
    eligible = bool(configured_matches_project and response_model_matches_configured and model_presence_verified is True)
    blockers: list[str] = []
    if not configured_matches_project:
        blockers.append("configured model is not an accepted PROJECT verifier model")
    if not response_model_matches_configured:
        blockers.append("provider response model does not match configured model")
    if model_presence_verified is not True:
        blockers.append("/models did not verify the configured model")
    return {
        "projectVerifierEvidenceEligible": eligible,
        "projectVerifierEvidenceBlockers": blockers,
        "expectedProjectModelId": PROJECT_VERIFIER_MODEL_ID,
        "expectedProjectModelIds": list(PROJECT_VERIFIER_MODEL_IDS),
        "configuredModelMatchesProject": configured_matches_project,
        "responseModelMatchesConfigured": response_model_matches_configured,
        "modelPresenceVerified": model_presence_verified,
    }


def _mapping_or_empty(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _parse_verdict_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"verdict": "unknown", "confidence": None, "reason": content[:500]}
    if not isinstance(parsed, Mapping):
        return {"verdict": "unknown", "confidence": None, "reason": content[:500]}
    return dict(parsed)


def _coerce_confidence(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    if isinstance(value, str):
        try:
            return max(0.0, min(1.0, float(value)))
        except ValueError:
            return None
    return None


def _blocked_manifest(
    *,
    output_dir: Path,
    category: str,
    reason: str,
    prompt_ref: Path,
    checked_config_refs: Sequence[str],
    image_ref: str | None = None,
    model_id: str | None = None,
    base_url_origin: str | None = None,
    provider_diagnostics: Mapping[str, Any] | None = None,
    attempts: Sequence[Mapping[str, Any]] | None = None,
    failure_stage: str | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": PROBE_MANIFEST_SCHEMA,
        "status": "blocked",
        "category": category,
        "reason": reason,
        "checkedConfigRefs": list(checked_config_refs),
        "requiredConfigFields": ["visionLLM.baseUrl", "visionLLM.apiKey", "visionLLM.model"],
        "baseUrlOrigin": base_url_origin,
        "modelId": model_id,
        "promptRef": str(prompt_ref),
        "imageRef": image_ref,
        "traceRefs": [],
        "evidenceRefs": [ref for ref in (image_ref, str(prompt_ref)) if ref],
        "suggestedNextAction": "Provide a local OpenAI-compatible visionLLM config or rerun after provider/network access is available.",
        "manifestRef": str((output_dir / MANIFEST_NAME).resolve()),
        "failureStage": failure_stage,
        "attempts": [dict(attempt) for attempt in attempts] if attempts else [],
        "timeoutSeconds": timeout_seconds,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "providerDiagnostics": dict(provider_diagnostics) if provider_diagnostics else None,
        **_diagnostic_boundary_fields(),
    }


def _safe_url_origin(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        port = parsed.port
    except ValueError:
        return ""
    if not parsed.scheme or not parsed.hostname:
        return ""
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{host}:{port}" if port else host
    return urllib.parse.urlunsplit((parsed.scheme, netloc, "", "", ""))


def _sanitize_error(exc: Exception) -> str:
    if isinstance(exc, ProviderRetryError):
        return _sanitize_error(exc.cause)
    if isinstance(exc, TimeoutError):
        return "Provider request timed out."
    if isinstance(exc, socket.timeout):
        return "Provider request timed out."
    if isinstance(exc, urllib.error.HTTPError):
        return f"Provider HTTP error {exc.code}."
    if isinstance(exc, urllib.error.URLError):
        return _safe_error_text(f"Provider URL error: {exc.reason}.")
    return _safe_error_text(str(exc))


def _error_category(exc: Exception) -> str:
    if isinstance(exc, ProviderRetryError):
        return _error_category(exc.cause)
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(exc, json.JSONDecodeError):
        return "json-parse"
    if isinstance(exc, urllib.error.HTTPError):
        return _http_error_category(exc.code)
    if isinstance(exc, urllib.error.URLError):
        return _url_error_category(exc.reason)
    text = str(exc).lower()
    if any(token in text for token in ("shape", "schema", "unsupported", "invalid payload", "bad request")):
        return "shape"
    return type(exc).__name__


def _http_error_category(status: int) -> str:
    if status in {408, 504}:
        return "timeout"
    if status in {401, 403}:
        return "auth"
    if status == 429:
        return "rate-limit"
    if status in {400, 415, 422}:
        return "shape"
    if 500 <= status <= 599:
        return "server"
    return f"http-{status}"


def _url_error_category(reason: Any) -> str:
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(reason, socket.gaierror):
        return "dns"
    if isinstance(reason, ConnectionRefusedError):
        return "connection-refused"
    if isinstance(reason, ssl.SSLError):
        return "tls"
    text = str(reason).lower()
    if "timed out" in text or "timeout" in text:
        return "timeout"
    if "name or service not known" in text or "nodename" in text or "dns" in text:
        return "dns"
    if "certificate" in text or "ssl" in text or "tls" in text:
        return "tls"
    if "refused" in text:
        return "connection-refused"
    if "invalid" in text:
        return "invalid-url"
    return "url-error"


def _safe_error_text(value: str) -> str:
    text = value[:1000]
    text = re.sub(r"(?i)data:image/[^\s,;]+;base64,[A-Za-z0-9+/=._-]+", "[REDACTED_DATA_URL]", text)
    text = re.sub(r"(?i);base64,[A-Za-z0-9+/=._-]+", ";[REDACTED_BINARY]", text)
    text = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", text)
    text = re.sub(
        r"(?i)(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?[^,;\s}\]]+",
        r"\1=[REDACTED]",
        text,
    )
    text = re.sub(r"://([^/@\s]+)@", "://[REDACTED]@", text)
    return text[:500]


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


_MINIMAL_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAdElEQVR42u3QMQEAIAwDMKRNAnKQgyZuvBQZO8gRAxmpSqfaaTUECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQICADwLmWemUO1sJECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABHwQ8qKF+lfeMOSgAAAAASUVORK5CYII="
)


if __name__ == "__main__":
    raise SystemExit(main())
