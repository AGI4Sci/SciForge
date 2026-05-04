"""Default manifest for the SciForge Vision Sense MVP."""

from __future__ import annotations

from .types import SenseManifest


DEFAULT_VLM_MODEL = "qwen3.6-plus"
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
            "visual_action_planning_contract",
            "kv_ground_contract",
            "text_command_envelope_contract",
            "computer_use_command_contract",
            "pixel_diff_verification_contract",
        ],
        inputs={
            "sensePluginRequest": "SensePluginRequest(text + modality refs)",
            "request": "VisionTaskRequest",
            "screenshots": ["ScreenshotRef"],
            "supportedActions": ["click", "type_text", "press_key", "scroll"],
        },
        outputs={
            "sensePluginResult": "SensePluginTextResult(text-only; no desktop execution side effects)",
            "textEnvelope": "SensePluginTextEnvelope serialized as text",
            "result": "VisionTaskResult",
            "trace": "VisionStepRecord[]",
            "artifacts": "lightweight refs; no inline screenshot base64",
        },
        configSchema={
            "vlm": {
                "defaultModel": DEFAULT_VLM_MODEL,
                "usesSharedLlmConfig": True,
                "requiredSharedFields": ["baseUrl", "apiKey"],
                "optionalSharedFields": ["headers", "timeoutSeconds", "retry"],
            },
            "grounder": {
                "kind": "kv-ground",
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
                "predictEndpoint": "/predict/",
            },
            "maxStepsDefault": 30,
            "pixelDiffThresholdDefault": 0.005,
        },
        safety={
            "defaultRiskPolicy": "low-risk-gui-actions-only",
            "allowedActions": ["click", "type_text", "press_key", "scroll"],
            "highRiskActions": [
                "send",
                "delete",
                "pay",
                "authorize",
                "external_publish",
            ],
            "highRiskBehavior": "fail_closed_without_explicit_upstream_approval",
        },
        runtimeRequirements={
            "python": ">=3.10",
            "dependencies": [],
            "kvGround": {"baseUrlEnv": KV_GROUND_URL_ENV},
            "desktopExecutorRequired": False,
            "computerUseExecutor": "external modular consumer of text command envelopes",
            "privateSciForgeImports": False,
        },
        observability={
            "recordStepTrace": True,
            "records": [
                "screenshot_refs",
                "screen_summary",
                "visible_texts",
                "planner_action",
                "grounding_request_response",
                "execution_result",
                "pixel_diff",
                "failure_reason",
            ],
        },
    )


DEFAULT_MANIFEST = build_default_manifest()
