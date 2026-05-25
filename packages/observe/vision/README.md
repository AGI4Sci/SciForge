# SciForge Vision Sense

`vision-sense` 是 SciForge 的视觉感官包。它只负责把 `instruction + 图像/截图/其它视觉模态` 转成可审计的 `text-response`，例如 JSON、NDJSON、坐标、候选目标描述、区域摘要、OCR、verifier feedback 或普通文本。真实桌面执行由 `packages/actions/computer-use` action provider 通过 TUI Host ports 负责；本包不拥有 executor、scheduler、desktop bridge、浏览器、DOM、accessibility tree、MCP 会话或用户级完成判断。

`vision-sense` 和 Computer Use 一样属于 TUI 侧 extension 生态，只直接和 TUI Host 或 action provider 通信。GUI 需要展示截图、trace 或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`；本包不得 import React/UI、renderer registry 或 GUI 私有状态。

上层主 agent 可以主动、多次调用本 sense。一次视觉 instruction 不需要覆盖图片全貌；主 agent 可以先问整体布局，再问局部文本、图例、坐标、异常区域或 verifier 复查。`vision-sense` 的职责是回答当前 instruction 并暴露不确定性、能力边界和下一步建议。

## 设计文档

Vision/Computer Use 的模块级设计文档位于 `vision_docs/`：

- [`vision_docs/vision_computer_use_agent_mvp.md`](vision_docs/vision_computer_use_agent_mvp.md)：Vision + Computer Use 最小闭环。
- [`vision_docs/KV_GROUND_SERVICE_GUIDANCE.md`](vision_docs/KV_GROUND_SERVICE_GUIDANCE.md)：KV-Ground 部署、路径映射和排障。

Computer Use action provider 消费本包输出时的目标链路：

```text
TUI Host
  -> packages/actions/computer-use.runTask(request, hostPorts)
  -> optional packages/observe/vision observation / focus-region / verifier feedback
  -> optional KV-Ground coordinates
  -> Computer Use generic action validation
  -> hostPorts executor
  -> refs-first trace/result
```

## Agent 契约

当 agent、skill 或 Computer Use action provider 需要纯视觉 GUI 信号时使用这个包。输入是任务文本和截图引用，输出仍然是文本。输出文本可以包括：

- 可供 Computer Use planner 校验的候选目标描述或 generic action suggestion；最终 action schema、审批和执行归 `packages/actions/computer-use`。
- KV-Ground 返回的像素坐标。
- 可读的失败原因、证据摘要和下一步建议。
- 代码片段或控制信号，但必须保持可审计、可序列化。

禁止把截图 base64 或大图像字节放进长期上下文。多轮记忆只保留截图路径、哈希、尺寸、窗口元数据、candidate action / grounder 摘要、执行状态 ref、focus-region refs、verifier feedback 和 pixel diff。

## 临时多模态记忆

视觉任务运行中的视觉工作记忆由本包负责，不散落在 SciForge runtime prompt 拼接里。`sciforge_vision_sense.visual_memory` 读取 `vision-trace.json` refs，输出预算化的 `VisionMemoryBlock`：

- `policy=file-ref-only`，不内联 `data:image`、base64、DOM/accessibility 或截图字节。
- 保留 window screenshot refs、focus-region refs、sha256、尺寸、displayId、windowTarget、scheduler、action counts 和 verifier feedback。
- 支持 `same-run-replan`、`cross-round-followup`、`failure-recovery`、`long-context-compact` 等模式。
- runtime 或 Computer Use host adapter 只把 trace refs 交给 `vision-sense`，再把返回的 memory block 提供给 Planner/Grounder/Verifier。执行历史只以 refs 或摘要出现，真实动作 owner 仍是 action provider。

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

Computer Use action provider 的 host ports 负责截图、裁剪、执行、坐标映射和写 trace；二次 crop grounding 的策略边界由本包定义，host adapter 只把 focus crop 交给 KV-Ground，并把 crop-local 坐标映射回 window-local。

## 模型分工

SciForge 将“任务规划”、“视觉观察”和“视觉定位”分开配置：

- **Planner 默认属于 Codex CLI / TUI 文本 agent 或 Computer Use action provider**：它消费 compact observation、visible text、action history 和 verifier feedback，输出一个 generic action 或 `done=true`，不输出坐标。
- **Vision helper 使用 VLM**：当 Planner 需要看图时，本包读取任务文本和截图，输出 observation summary、候选目标描述、局部区域信息或 verifier feedback。推荐统一使用 `qwen3.6-plus`，也可以配置其他支持图像输入的模型。
- **Grounder 使用 KV-Ground**：你自己部署 KV-Ground 服务，SciForge 通过 `/health` 和 `/predict/` 调用它，把目标描述映射到截图像素坐标。KV-Ground 缺失或失败时 fail closed 并记录 diagnostics，不再 fallback 到视觉模型执行定位。
- **普通文本模型不能作为 VLM**：例如 `deepseek-v4` / `deepseek-v4-flash` 不能处理截图输入，不应配置为视觉 helper。

## 配置项

推荐在 `workspace/.sciforge/config.json` 或 `.sciforge/config.json` 中配置：

```json
{
  "modelBaseUrl": "http://your-openai-compatible-endpoint/v1",
  "apiKey": "your-api-key",
  "modelName": "bailian/deepseek-v4-flash",
  "visionSense": {
    "desktopBridgeEnabled": true,
    "grounderBaseUrl": "http://127.0.0.1:18081",
    "grounderUploadStrategy": "inline",
    "grounderRemotePathPrefix": "/remote/shared/path/",
    "grounderLocalPathPrefix": "/local/shared/path/",
    "showVisualCursor": true
  }
}
```

含义：

- `modelName`：普通文本 backend，可继续使用 deepseek 等文本模型。
- `SCIFORGE_RUNTIME_API_KEY` / Runtime Codex config：Computer Use 默认 Planner 是 Codex CLI / TUI 文本 agent，消费 compact observation、visible text、action history 和 verifier feedback。
- `visionSense.grounderBaseUrl`：你部署的 KV-Ground 服务地址，默认本地 endpoint 是 `http://127.0.0.1:18081`。
- `visionSense.grounderUploadStrategy`：默认 `inline`，表示本机截图以内联 `image_base64` 发送给 `/predict/`。只有明确共享路径映射时才改用服务端可读路径。
- `visionSense.grounderRemotePathPrefix` / `grounderLocalPathPrefix`：当 KV-Ground 服务和 SciForge 共享挂载目录时，用于把本地截图路径映射为服务端可读路径。
- `visionSense.showVisualCursor`：shared-system 诊断时显示 SciForge 专属视觉指针，便于区分用户鼠标和 agent 操作；最终无用户影响路径应优先使用独立 input adapter，例如 `SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop` 搭配 `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop`，由 adapter 维护虚拟 pointer/keyboard state refs。

等价环境变量：

```bash
export SCIFORGE_RUNTIME_API_KEY="your-runtime-provider-key"
# Optional: only set this when using a non-default Runtime Codex planner profile.
export SCIFORGE_COMPUTER_USE_PLANNER_PROFILE="sciforge-runtime-deepseek"

export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="inline"
export SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX="/local/shared/path/"
export SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX="/remote/shared/path/"

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

## KV-Ground 调用示例

```python
import os

from sciforge_vision_sense import GrounderRequest, KvGroundClient

client = KvGroundClient(
    base_url=os.environ["SCIFORGE_VISION_KV_GROUND_URL"],
)
health = client.health()
result = client.ground(
    GrounderRequest.window(
        screenshot_ref="/local/path/restart_check.png",
        target_description="Click the Submit button",
    )
)
fine_result = client.ground(
    GrounderRequest.crop(
        screenshot_ref="/local/path/focus-submit.png",
        target_description="Click the Submit button",
        crop_bbox=(320, 160, 520, 280),
    )
)
assert fine_result.crop_local_coordinates is not None
assert fine_result.window_local_coordinates is not None
```

默认 `SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY=inline` 时，本地图片会作为 `image_base64` 随 `/predict/` 上传；只有 `remote_path_prefixes` 确认服务端可读时，才传 `image_path`。

## 失败处理

失败时必须结构化记录：

- 截图 ref、哈希、尺寸和窗口元数据。
- Vision helper 原始 JSON 或解析失败原因。
- KV-Ground endpoint、`/health` 摘要、`/predict/` 请求摘要、返回摘要、上传策略和坐标解析状态。
- Computer Use action provider 写入的执行状态 ref、输入通道、窗口锁/executor lease 和失败原因；真实执行细节不在本包生成。
- Verifier 的 before/after 截图和 pixel diff。

高风险动作默认 fail closed。发送、删除、支付、授权、外部发布等动作必须由上游明确确认后才能执行。

Trace 输出必须保持 file-ref-only：保存 before/after screenshot refs、focus crop refs、sha256、尺寸、target description、coordinates、provider metadata、diagnostics、approval/audit refs；不保存 raw screenshot payload、`data:image`、base64 或大日志。

## MVP 边界

- 纯视觉：不读 DOM，不读 accessibility tree。
- Planner 不输出坐标，只输出目标描述。
- KV-Ground 负责把 screenshot ref 或 inline upload 后的 image payload 加 `text_prompt` 变成原图像素坐标。
- Executor 属于 Computer Use action provider/host ports；本包只定义视觉文本、grounding 和 verifier 辅助协议。
- Pixel diff 只证明视觉状态变化，语义完成仍需下一步检查。

## 测试

在仓库根目录运行：

```bash
python -m unittest discover -s packages/observe/vision/tests
python -m pytest packages/observe/vision/tests
```
