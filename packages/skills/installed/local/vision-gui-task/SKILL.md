---
name: vision-gui-task
description: 模板 skill：把低风险 GUI 请求转换为 SciForge VisionTaskRequest，并调用 vision-sense tool。
metadata:
  provider: local
  visionTaskRequest: packages/observe/vision/sciforge_vision_sense/types.py:VisionTaskRequest
  outputArtifactTypes: vision-trace
  requiredCapabilities: vision-sense
  tags: vision, gui, computer-use, template
---

# vision-gui-task

## Agent 快速契约

- 只用于低风险 GUI 任务：任务可以通过观察截图并执行 `click`、`type_text`、`press_key` 或 `scroll` 完成。
- 构造 `VisionTaskRequest`，包含用户任务、目标 app/window hint、默认 `maxSteps=30`、低风险 policy、共享 LLM config ref、KV-Ground config、screenshot policy 和 artifact output directory。
- 注入 VLM、observer、grounder 和 executor 的 runtime 实现，然后调用 `vision-sense` tool package。
- 后续上下文只保留轻量 trace refs 和摘要：screenshot refs、planned action、grounding summary、crosshair checks、execution status、pixel diff 和 failure reason。
- 视觉运行不使用 DOM 或 accessibility tree 数据。

## Request 模板

```python
from sciforge_vision_sense import VisionTaskRequest

request = VisionTaskRequest(
    task=user_prompt,
    appWindowTarget={"app": "browser"},
    maxSteps=30,
    riskPolicy={"allowHighRiskActions": False},
    modelConfigRef="shared-llm-config",
    grounderConfig={
        # Fill from workspace/runtime config or SCIFORGE_VISION_KV_GROUND_URL.
        "baseUrl": kv_ground_base_url,
        # Optional: service-readable shared storage prefixes for image_path.
        "remotePathPrefixes": kv_ground_remote_path_prefixes,
    },
    screenshotPolicy={
        "stabilityIntervalSeconds": 0.3,
        "stableChangeRatio": 0.01,
        "maxWaitSeconds": 8,
    },
    artifactOutputDir=".bioagent/vision-runs/current",
)
```

## 安全边界

发送、删除、支付、授权、外部发布或其它不可逆动作必须 fail closed。除非未来上游确认机制明确授权该 action class，否则该模板 skill 不应继续执行高风险 GUI 流程。
