---
name: vision-gui-task
description: 模板 skill：为 GUI 任务构造 vision-sense 观察请求，并把执行交给 Computer Use action provider。
metadata:
  provider: local
  sensePluginRequest: packages/observe/vision/sciforge_vision_sense/types.py:SensePluginRequest
  actionProvider: packages/actions/computer-use
  outputArtifactTypes: vision-trace
  requiredCapabilities: vision-sense, computer-use-action-provider
  tags: vision, gui, computer-use, template
---

# vision-gui-task

## Agent 快速契约

- 只用 `vision-sense` 获取截图/图像的文本观察、候选目标描述、Model Router grounding translator 证据、verifier feedback 和 trace refs。
- 构造 `SensePluginRequest`，包含用户任务、截图/图像 modality refs、`targetUse="computer-use-observation"`、共享 trace output metadata 和低风险默认 policy。
- 不构造或调用正向 GUI runner，不生成静态桌面命令，不注入 executor，也不声称动作已经执行。
- 需要点击、输入、滚动、按键、审批或真实窗口锁时，把任务交给 `packages/actions/computer-use` action provider；Runtime Codex text planner 只在 action-provider 边界规划 generic action。
- 后续上下文只保留轻量 refs 和摘要：screenshot refs、candidate target、grounding summary、verifier feedback、provider execution refs、pixel diff 和 failure reason。
- 视觉运行不使用 DOM 或 accessibility tree 数据。

## Request 模板

```python
from sciforge_vision_sense import SensePluginRequest, build_sense_plugin_request

request = build_sense_plugin_request(
    user_prompt,
    modalities=[
        {
            "kind": "screenshot",
            "ref": "artifact:screen-001.png",
            "role": "current-window",
        }
    ],
    target_use="computer-use-observation",
    allow_high_risk_actions=False,
    metadata={
        "traceOutputDir": ".sciforge/vision-runs/current",
        "actionOwner": "packages/actions/computer-use",
    },
)
assert isinstance(request, SensePluginRequest)
```

## 安全边界

发送、删除、支付、授权、外部发布或其它不可逆动作必须由 Computer Use action provider fail closed 并请求明确上游确认。这个模板只准备视觉观察输入，不执行高风险或低风险 GUI 流程。
