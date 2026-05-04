---
name: vision-sense
description: Vision Sense Plugin for turning text plus screenshot/image modalities into text-only visual observations and auditable vision traces.
metadata:
  provider: local
  packageRoot: packages/senses/vision-sense
  toolType: sense-plugin
  modality: vision
  acceptedModalities: screenshot, image
  skillDomains: knowledge
  producesArtifactTypes: vision-trace
  requiredConfig: shared-llm-config, kv-ground-base-url, trace-output-dir
  tags: vision, modality:vision, grounding, text-output, computer-use-input, kv-ground
---

# vision-sense

## Agent quick contract

- Kind: sense-plugin tool. Input is `text + screenshot/image modalities`; output is text only.
- Boundary: skills construct a `SensePluginRequest` or `VisionTaskRequest`; the package emits visual observations, grounding summaries, trace refs, and optional action suggestions as text. Real Computer Use planning/execution is a separate modular consumer/provider and remains outside this package.
- Runtime: Python package at `packages/senses/vision-sense`, import root `sciforge_vision_sense`.
- Best for: interpreting screenshots/images, producing visual target descriptions, KV-Ground coordinate evidence, text-only observations, and file-ref-only trace memory.
- Avoid: executing code or desktop actions, owning mouse/keyboard state, DOM/accessibility-tree workflows, payment/delete/send/authorize operations, or claiming a GUI action happened without an external Computer Use consumer/provider trace.

## Execution contract

```python
from sciforge_vision_sense import SensePluginTextResult, build_sense_plugin_request

request = build_sense_plugin_request(
    "Describe the visible Upload button and return file-ref-only trace evidence.",
    modalities=[{"kind": "screenshot", "ref": "artifact:screen-001.png"}],
)
result = SensePluginTextResult(
    text="Visible target: Upload button near the upper-right toolbar. Suggested next action for an external Computer Use consumer: click the Upload button.",
    modality="vision",
    artifacts=[{"type": "vision-trace", "ref": ".sciforge/vision-runs/run-001/vision-trace.json"}],
)
```

Computer Use modularity:

- `vision-sense` does not click, type, scroll, run shell commands, or drive applications.
- A separate Computer Use consumer/provider may read the text output, verify risk and confirmation state, map coordinates, execute mouse/keyboard actions, and write its own action ledger.
- Trace memory is file-ref-only. Do not inline `data:image`, screenshot base64, or binary image payloads into follow-up context.

## Human notes

The package is intentionally dependency-injected and fake-testable. It ships the
contract, manifest, prompt helpers, KV-Ground HTTP adapter, VLM helper, trace
helpers, and verifier-facing text outputs, but real desktop control remains
outside the package boundary.
