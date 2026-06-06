"""Default manifest for the SciForge Vision Sense package."""

from __future__ import annotations

from .types import SenseManifest


DEFAULT_VISION_MODEL = "sciforge-router"
MODEL_ROUTER_GROUNDING_TRANSLATOR_CAPABILITY = "model-router.capability.computer-use.grounding-translator"


def build_default_manifest() -> SenseManifest:
    return SenseManifest(
        id="sciforge.vision-sense",
        modality="vision",
        version="0.1.0",
        capabilities=[
            "sense_plugin_text_input_contract",
            "sense_plugin_text_output_contract",
            "screen_observation_contract",
            "model_router_grounding_translator_ref_contract",
            "pixel_diff_verification_contract",
        ],
        inputs={
            "sensePluginRequest": "SensePluginRequest(text + modality refs)",
            "screenshots": ["ScreenshotRef"],
        },
        outputs={
            "sensePluginResult": "SensePluginTextResult(text-only; no desktop execution side effects)",
            "textEnvelope": "SensePluginTextEnvelope serialized as text observations",
            "artifacts": "lightweight refs and trace refs; no inline screenshot base64",
        },
        configSchema={
            "vlm": {
                "defaultModel": DEFAULT_VISION_MODEL,
                "usesSharedLlmConfig": True,
                "requiredSharedFields": ["baseUrl", "apiKey"],
                "optionalSharedFields": ["headers", "timeoutSeconds", "retry"],
            },
            "modelRouter": {
                "groundingTranslatorCapability": MODEL_ROUTER_GROUNDING_TRANSLATOR_CAPABILITY,
                "usesSharedLlmConfig": True,
                "requestPayloadPolicy": "refs-first; no inline screenshots or provider payloads in package API",
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
                "model_router_grounding_refs",
                "pixel_diff",
                "verifier_feedback",
                "failure_reason",
            ],
        },
    )


DEFAULT_MANIFEST = build_default_manifest()
