"""Default manifest for the SciForge Vision Sense package."""

from __future__ import annotations

from .types import SenseManifest


DEFAULT_VISION_MODEL = "sciforge-router"
KV_GROUND_URL_ENV = "SCIFORGE_VISION_KV_GROUND_URL"
KV_GROUND_REMOTE_PATH_PREFIXES_ENV = "SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIXES"


def build_default_manifest() -> SenseManifest:
    return SenseManifest(
        id="sciforge.vision-sense",
        modality="vision",
        version="0.1.0",
        capabilities=[
            "sense_plugin_text_input_contract",
            "sense_plugin_text_output_contract",
            "screen_observation_contract",
            "kv_ground_contract",
            "pixel_diff_verification_contract",
        ],
        inputs={
            "sensePluginRequest": "SensePluginRequest(text + modality refs)",
            "screenshots": ["ScreenshotRef"],
            "grounderRequest": {
                "schema": "GrounderRequest",
                "required": {
                    "screenshot_ref": "ScreenshotRef URI or service-readable screenshot reference",
                    "target_description": "Natural-language description of the target to ground",
                },
                "optional": {
                    "crop_bbox": "Window-local crop bounds as [x1, y1, x2, y2]",
                },
                "coordinate_space": {
                    "allowed": ["window-local", "crop-local"],
                    "default": "window-local",
                    "cropLocalRequires": "crop_bbox",
                },
            },
        },
        outputs={
            "sensePluginResult": "SensePluginTextResult(text-only; no desktop execution side effects)",
            "textEnvelope": "SensePluginTextEnvelope serialized as text observations",
            "artifacts": "lightweight refs and trace refs; no inline screenshot base64",
            "grounderResult": {
                "schema": "GrounderResult",
                "required": {
                    "window_local_coordinates": (
                        "Target point or bbox in window-local coordinates, even when the request is crop-local"
                    ),
                    "coordinate_space": "Normalized request coordinate space: window-local or crop-local",
                    "diagnostics": "Structured grounding diagnostics; empty when no diagnostics were emitted",
                },
                "optional": {
                    "crop_local_coordinates": "Target point or bbox in crop-local coordinates for crop-local requests",
                    "confidence": "Grounder confidence score when provided by the service",
                    "raw_text": "Raw textual model or service output when available",
                    "crop_bbox": "Window-local crop bounds used to translate crop-local coordinates",
                },
            },
        },
        configSchema={
            "vlm": {
                "defaultModel": DEFAULT_VISION_MODEL,
                "usesSharedLlmConfig": True,
                "requiredSharedFields": ["baseUrl", "apiKey"],
                "optionalSharedFields": ["headers", "timeoutSeconds", "retry"],
            },
            "grounder": {
                "kind": "model-router.capability.computer-use.grounding-translator",
                "baseUrlConfig": {
                    "field": "grounderConfig.baseUrl",
                    "env": KV_GROUND_URL_ENV,
                    "required": True,
                },
                "remotePathPrefixesConfig": {
                    "field": "grounderConfig.remotePathPrefixes",
                    "env": KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
                    "required": False,
                },
                "healthEndpoint": "/health",
                "contract": "GrounderRequest -> GrounderResult",
            },
            "pixelDiffThresholdDefault": 0.005,
        },
        safety={
            "executionBoundary": "sensing-only",
            "desktopActions": "not-owned-by-vision-sense",
            "highRiskBehavior": "action provider must fail closed without explicit upstream approval",
        },
        runtimeRequirements={
            "python": ">=3.10",
            "dependencies": [],
            "kvGround": {"baseUrlEnv": KV_GROUND_URL_ENV},
            "desktopExecutorRequired": False,
            "computerUseExecutor": "packages/actions/computer-use action provider",
            "privateSciForgeImports": False,
        },
        observability={
            "recordStepTrace": True,
            "records": [
                "screenshot_refs",
                "screen_summary",
                "visible_texts",
                "grounding_request_response",
                "pixel_diff",
                "verifier_feedback",
                "failure_reason",
            ],
        },
    )


DEFAULT_MANIFEST = build_default_manifest()
