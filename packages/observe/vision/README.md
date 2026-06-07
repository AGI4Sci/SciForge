# SciForge Vision Sense

`vision-sense` 是 SciForge 的视觉感官包。它只负责把 `instruction + 图像/截图/其它视觉模态` 转成可审计的 `text-response`，例如 JSON、NDJSON、坐标、候选目标描述、区域摘要、OCR、verifier feedback 或普通文本。真实桌面执行由 `packages/actions/computer-use` action provider 通过 TUI Host ports 负责；本包不拥有 executor、scheduler、desktop bridge、浏览器、DOM、accessibility tree、MCP 会话或用户级完成判断。

`vision-sense` 和 Computer Use 一样属于 TUI 侧 extension 生态，只直接和 TUI Host 或 action provider 通信。GUI 需要展示截图、trace 或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`；本包不得 import React/UI、renderer registry 或 GUI 私有状态。

上层主 agent 可以主动、多次调用本 sense。一次视觉 instruction 不需要覆盖图片全貌；主 agent 可以先问整体布局，再问局部文本、图例、坐标、异常区域或 verifier 复查。`vision-sense` 的职责是回答当前 instruction 并暴露不确定性、能力边界和下一步建议。

## 设计文档

Vision/Computer Use 的模块级设计文档位于 `vision_docs/`：

- [`vision_docs/vision_computer_use_agent_mvp.md`](vision_docs/vision_computer_use_agent_mvp.md)：Vision + Computer Use 最小闭环。

Computer Use action provider 消费本包输出时的目标链路：

```text
TUI Host
  -> packages/actions/computer-use primitive refs
  -> optional packages/observe/vision observation / focus-region / verifier feedback
  -> caller selects target / elementRef / point / textRef
  -> computer_use.bind / observe / act / run_procedure / control
  -> refs-first primitive evidence
```

`vision-sense` 只能提供 observation / grounding hints；它不拥有 Computer Use plan、executor、approval、repair、completion truth 或 final answer。旧 `computer_use.runTask(request, hostPorts)` 只作为历史迁移口径，不是新的产品链路。

## Agent 契约

当 agent、skill 或 Computer Use action provider 需要纯视觉 GUI 信号时使用这个包。输入是任务文本和截图引用，输出仍然是文本。输出文本可以包括：

- 可供 Computer Use planner 校验的候选目标描述或 generic action suggestion；最终 action schema、审批和执行归 `packages/actions/computer-use`。
- Model Router grounding translator 返回的像素坐标。
- 可读的失败原因、证据摘要和下一步建议。
- 代码片段或控制信号，但必须保持可审计、可序列化。

禁止把截图 base64 或大图像字节放进长期上下文。多轮记忆只保留截图路径、哈希、尺寸、窗口元数据、candidate action / grounding 摘要、执行状态 ref、focus-region refs、verifier feedback 和 pixel diff。

## 临时多模态记忆

视觉任务运行中的视觉工作记忆由本包负责，不散落在 SciForge runtime prompt 拼接里。`sciforge_vision_sense.visual_memory` 读取 `vision-trace.json` refs，输出预算化的 `VisionMemoryBlock`：

- `policy=file-ref-only`，不内联 `data:image`、base64、DOM/accessibility 或截图字节。
- 保留 window screenshot refs、focus-region refs、sha256、尺寸、displayId、windowTarget、scheduler、action counts 和 verifier feedback。
- 支持 `same-run-replan`、`cross-round-followup`、`failure-recovery`、`long-context-compact` 等模式。
- runtime 或 Computer Use host adapter 只把 trace refs 交给 `vision-sense`，再把返回的 memory block 提供给 Planner / Model Router grounding translator / Verifier。执行历史只以 refs 或摘要出现，真实动作 owner 仍是 action provider。

```python
from sciforge_vision_sense import VisionMemoryTraceInput, build_visual_memory_block

block = build_visual_memory_block(
    [VisionMemoryTraceInput(path=".sciforge/vision-runs/run-1/vision-trace.json", label="round 1")],
    mode="cross-round-followup",
    char_budget=4000,
)
assert block.policy == "file-ref-only"
```

## 视觉策略与 trace 校验辅助

本包保留若干 Computer Use 视觉侧 helper，供 action provider、runtime adapter 和长测工具复用；它们不拥有执行 loop：

- `sciforge_vision_sense.trace_contract`：校验 `vision-trace.json` 的 windowTarget、window screenshot refs、window-local coordinates、generic input channel、scheduler metadata、window verifier consistency、file-ref-only memory 和 no DOM/accessibility/private fields。
- `sciforge_vision_sense.computer_use_policy`：生成 dry-run/real GUI matrix analysis plan、默认 window target contract，并判断 planner-only evidence task。真实 GUI action stream、executor lease 和审批由 `packages/actions/computer-use` 处理。

```python
from sciforge_vision_sense import build_matrix_execution_plan

plan = build_matrix_execution_plan(dry_run=True, scenario_count=10, requested_max_concurrency=4)
assert plan.mode == "parallel-analysis"
```

## Coarse-to-fine 与局部 verifier

`sciforge_vision_sense.coarse_to_fine` 提供 Computer Use 可消费的局部视觉算法接口：

- `build_focus_region` / `build_focus_region_from_trace`：从整窗粗 grounding 生成 clipped focus-region bbox。
- `build_verifier_planning_feedback`：把 pixel diff、window consistency、grounding、focus bbox 和失败原因压缩成下一轮 Planner 可读反馈。
- `build_region_semantic_verifier`：基于 action、focus crop diff、整窗 diff 和 focus bbox 输出 `regionSemantic` verdict、confidence、summary 和 nextPlannerHint。

Computer Use action provider 的 host ports 负责截图、裁剪、执行、坐标映射和写 trace；二次 crop grounding 的策略边界由本包定义，host adapter 把 screenshot/crop/grounding/verifier prompt 交给 Model Router vision translator roles，并把 crop-local 坐标映射回 window-local。

## 模型路由契约

Computer Use 不在 policy 中区分公开的 reasoning、vision 或具体 grounding 上游模型。公共契约只依赖 Model Router provider/capability surface：

- `model-router.capability.computer-use.planner`：消费 compact observation、visible text、action history 和 verifier feedback，输出一个 generic action 或 `done=true`，不输出坐标。
- `model-router.capability.computer-use.screenshot-translator`：把 screenshot ref 和当前 instruction 转成可审计 observation summary。
- `model-router.capability.computer-use.crop-translator`：处理 focus-region/crop prompt，输出局部区域摘要或候选目标描述。
- `model-router.capability.computer-use.grounding-translator`：把 screenshot/crop ref 加 target description 转成原图像素坐标。
- `model-router.capability.computer-use.verifier-translator`：压缩 before/after screenshot refs、pixel diff 和 verifier feedback。

Router 后面可以选择任意合规 provider/model，但这些选择不写入 Computer Use policy 默认值。Computer Use / Vision Sense 不暴露 direct grounding endpoint、provider URL、API key、raw model slug 或未注册 provider/profile。

## 配置项

推荐在 `workspace/.sciforge/config.json` 或 `.sciforge/config.json` 中配置：

```json
{
  "runtimeProfile": "sciforge-runtime-default",
  "modelProvider": "sciforge-model-router",
  "modelName": "sciforge-router",
  "visionSense": {
    "desktopBridgeEnabled": true,
    "routerProfile": "sciforge-runtime-default",
    "groundingTranslatorCapability": "model-router.capability.computer-use.grounding-translator",
    "showVisualCursor": true
  }
}
```

含义：

- `modelProvider` / `modelName` / `runtimeProfile`：公开 Runtime Codex router alias/profile；Computer Use policy 不把它解释为具体上游文本、视觉或 grounding 模型。
- `SCIFORGE_RUNTIME_API_KEY` / Runtime config：供 Model Router 或运行时 provider 取用；Computer Use policy 只要求 router capability，不要求某个文本 planner slug。
- Computer Use / Vision Sense 的设计默认是统一 Model Router capability surface；进入 evidence 的 provider/model metadata 只能作为 router 决议结果记录，不能成为 policy 默认值。
- `visionSense.groundingTranslatorCapability`：默认由 Host adapter 注入 `model-router.capability.computer-use.grounding-translator`；公共配置只记录 capability alias，不接收 direct provider URL。
- `visionSense.showVisualCursor`：shared-system 诊断时显示 SciForge 专属视觉指针，便于区分用户鼠标和 agent 操作；最终无用户影响路径应优先使用独立 input adapter，例如 `SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop` 搭配 `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop`，由 adapter 维护虚拟 pointer/keyboard state refs。

等价环境变量：

```bash
export SCIFORGE_RUNTIME_API_KEY="your-runtime-provider-key"
export SCIFORGE_MODEL_ROUTER_PROFILE="sciforge-runtime-default"
export SCIFORGE_VISION_SHOW_CURSOR=1
```

## 最小 Sense Plugin 请求

```python
from sciforge_vision_sense import build_default_manifest, ModalityInput, SensePluginRequest

manifest = build_default_manifest()
request = SensePluginRequest(
    text="Describe the visible Upload button and return trace refs only.",
    modalities=[
        ModalityInput(kind="screenshot", ref="artifact:screen-001.png"),
    ],
    targetUse="computer-use-observation",
    metadata={"traceOutputDir": ".sciforge/vision-runs/run-001"},
)
```

## Sense Plugin 文本结果

```python
from sciforge_vision_sense import (
    SensePluginTextResult,
    build_sense_plugin_request,
)

request = build_sense_plugin_request(
    "Describe the Upload button for an external Computer Use action provider.",
    modalities=[{"kind": "screenshot", "ref": "artifact:screen-001.png"}],
)
text_result = SensePluginTextResult(
    text="Visible target: Upload button near the upper-right toolbar.",
    modality="vision",
    artifacts=[{"type": "vision-trace", "ref": ".sciforge/vision-runs/run-001/vision-trace.json"}],
)
assert text_result.format == "application/json"
```

## Model Router Grounding 调用边界

本包不再公开 direct grounding HTTP client。需要模型参与的目标定位时，Host adapter 通过 `model-router.capability.computer-use.grounding-translator` 传递 screenshot/crop refs、target description、coordinate space 和 trace refs；返回值只作为可审计 grounding evidence，再由 Computer Use action provider 映射到 executor coordinates。截图、crop、provider payload 和 raw 模型响应都必须保持 refs-first，不得进入长期聊天正文或主上下文。

## 失败处理

失败时必须结构化记录：

- 截图 ref、哈希、尺寸和窗口元数据。
- Vision helper 原始 JSON 或解析失败原因。
- Model Router capability metadata、router trace refs、grounding diagnostic refs、坐标解析状态和失败原因。
- Computer Use action provider 写入的执行状态 ref、输入通道、窗口锁/executor lease 和失败原因；真实执行细节不在本包生成。
- Verifier 的 before/after 截图和 pixel diff。

高风险动作默认 fail closed。发送、删除、支付、授权、外部发布等动作必须由上游明确确认后才能执行。

Trace 输出必须保持 file-ref-only：保存 before/after screenshot refs、focus crop refs、sha256、尺寸、target description、coordinates、provider metadata、diagnostics、approval/audit refs；不保存 raw screenshot payload、`data:image`、base64 或大日志。

## MVP 边界

- 纯视觉：不读 DOM，不读 accessibility tree。
- Planner 不输出坐标，只输出目标描述。
- Model Router grounding translator 负责把 screenshot/crop ref 加目标描述变成原图像素坐标。
- Executor 属于 Computer Use action provider/host ports；本包只定义视觉文本、grounding 和 verifier 辅助协议。
- Pixel diff 只证明视觉状态变化，语义完成仍需下一步检查。

## 测试

在仓库根目录运行：

```bash
python -m unittest discover -s packages/observe/vision/tests
python -m pytest packages/observe/vision/tests
```
