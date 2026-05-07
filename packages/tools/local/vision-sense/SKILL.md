---
name: vision-sense
description: Vision Sense 插件：把文本指令加截图/图像模态转成 text-only 视觉观察和可审计 vision trace。
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

## Agent 快速契约

- 类型：sense-plugin tool。输入是 `text + screenshot/image modalities`，输出只允许是文本和 refs。
- 边界：skill 构造 `SensePluginRequest` 或 `VisionTaskRequest`；本包输出视觉观察、grounding 摘要、trace refs，以及可选的 action suggestion 文本。真实 Computer Use 规划与执行属于独立 consumer/provider，不在本包内。
- Runtime：Python package 位于 `packages/senses/vision-sense`，import root 是 `sciforge_vision_sense`。
- 适合：解释截图/图像、生成视觉目标描述、输出 KV-Ground 坐标证据、text-only observation 和 file-ref-only trace memory。
- 避免：执行代码或桌面动作、持有鼠标/键盘状态、读取 DOM/accessibility tree、处理支付/删除/发送/授权等高风险操作，或在没有外部 Computer Use trace 的情况下声称 GUI action 已执行。

## 执行契约

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

Computer Use 模块化边界：

- `vision-sense` 不点击、不输入、不滚动、不运行 shell，也不驱动应用程序。
- 独立 Computer Use consumer/provider 可以读取 text output、验证风险和确认状态、映射坐标、执行鼠标/键盘动作，并写入自己的 action ledger。
- Trace memory 必须 file-ref-only。不要把 `data:image`、screenshot base64 或二进制图像 payload 内联进后续上下文。

## 维护说明

本包刻意采用 dependency injection，便于 fake-test。它提供 contract、manifest、prompt helpers、KV-Ground HTTP adapter、VLM helper、trace helpers 和 verifier-facing text outputs；真实桌面控制始终留在 package boundary 之外。
