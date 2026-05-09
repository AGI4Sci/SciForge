# SciForge Vision Sense

`vision-sense` 是 SciForge 的视觉感官包。它只负责把 `instruction + 图像/截图/其它视觉模态` 转成可审计的 `text-response`，例如 JSON、NDJSON、坐标、操作指令、区域摘要、OCR 或普通文本。真实桌面执行由外部 action provider（例如 Computer Use executor）负责；本包不拥有桌面、浏览器、DOM、accessibility tree 或 MCP 会话。

上层主 agent 可以主动、多次调用本 sense。一次视觉 instruction 不需要覆盖图片全貌；主 agent 可以先问整体布局，再问局部文本、图例、坐标、异常区域或 verifier 复查。`vision-sense` 的职责是回答当前 instruction 并暴露不确定性、能力边界和下一步建议。

## 设计文档

Vision/Computer Use 的模块级设计文档位于 `vision_docs/`：

- [`vision_docs/vision_computer_use_agent_mvp.md`](vision_docs/vision_computer_use_agent_mvp.md)：Vision + Computer Use 最小闭环。
- [`vision_docs/vision_computer_use_agent_design_v2.md`](vision_docs/vision_computer_use_agent_design_v2.md)：Vision + Computer Use 设计细节。
- [`vision_docs/VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md`](vision_docs/VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md)：视觉优先的混合 Computer Use 策略。
- [`vision_docs/KV_GROUND_ERVICE_GUIDANCE.md`](vision_docs/KV_GROUND_ERVICE_GUIDANCE.md)：KV-Ground 部署、路径映射和排障。

核心链路：

```text
Observer 截图
  -> VisionPlanner 视觉规划
  -> KV-Ground 视觉定位
  -> Computer Use 文本指令
  -> Executor 执行
  -> Verifier 截图验证
```

## Agent 契约

当 agent 或 skill 需要纯视觉 GUI 能力时使用这个包。输入是任务文本和截图引用，输出仍然是文本。输出文本可以包括：

- `click`、`type_text`、`press_key`、`scroll` 等 Computer Use 命令。
- KV-Ground 返回的像素坐标。
- 可读的失败原因、证据摘要和下一步建议。
- 代码片段或控制信号，但必须保持可审计、可序列化。

禁止把截图 base64 或大图像字节放进长期上下文。多轮记忆只保留截图路径、哈希、尺寸、窗口元数据、planner action、grounder 摘要、执行状态、focus-region refs、verifier feedback 和 pixel diff。

## 临时多模态记忆

视觉任务运行中的工作记忆由本包负责，不散落在 SciForge runtime prompt 拼接里。`sciforge_vision_sense.visual_memory` 读取 `vision-trace.json` refs，输出预算化的 `VisionMemoryBlock`：

- `policy=file-ref-only`，不内联 `data:image`、base64、DOM/accessibility 或截图字节。
- 保留 window screenshot refs、focus-region refs、sha256、尺寸、displayId、windowTarget、scheduler、action counts 和 verifier feedback。
- 支持 `same-run-replan`、`cross-round-followup`、`failure-recovery`、`long-context-compact` 等模式。
- runtime 只把 trace refs 交给 `vision-sense`，再把返回的 memory block 提供给 Planner/Grounder/Verifier。

```python
from sciforge_vision_sense import VisionMemoryTraceInput, build_visual_memory_block

block = build_visual_memory_block(
    [VisionMemoryTraceInput(path=".sciforge/vision-runs/run-1/vision-trace.json", label="round 1")],
    mode="cross-round-followup",
    char_budget=4000,
)
assert block.policy == "file-ref-only"
```

## Computer Use 通用策略与 trace 契约

T084/T085 这类长时 Computer Use 任务的通用算法放在本包内，runtime 和长测工具只调用接口：

- `sciforge_vision_sense.trace_contract`：校验 `vision-trace.json` 的 windowTarget、window screenshot refs、window-local coordinates、generic input channel、scheduler metadata、window verifier consistency、file-ref-only memory 和 no DOM/accessibility/private fields。
- `sciforge_vision_sense.computer_use_policy`：生成 dry-run/real GUI matrix execution plan、默认 window target contract，并判断 planner-only evidence task。

```python
from sciforge_vision_sense import build_matrix_execution_plan

plan = build_matrix_execution_plan(dry_run=True, scenario_count=10, requested_max_concurrency=4)
assert plan.mode == "parallel-analysis"
```

## Coarse-to-fine 与局部 verifier

`sciforge_vision_sense.coarse_to_fine` 提供 Computer Use 的局部视觉算法接口：

- `build_focus_region` / `build_focus_region_from_trace`：从整窗粗 grounding 生成 clipped focus-region bbox。
- `build_verifier_planning_feedback`：把 pixel diff、window consistency、grounding、focus bbox 和失败原因压缩成下一轮 Planner 可读反馈。
- `build_region_semantic_verifier`：基于 action、focus crop diff、整窗 diff 和 focus bbox 输出 `regionSemantic` verdict、confidence、summary 和 nextPlannerHint。

Runtime 的职责是截图、裁剪、执行、坐标映射和写 trace；二次 crop grounding 的策略边界由本包定义，runtime 只把 focus crop 交给 KV-Ground 或 visual Grounder，并把 crop-local 坐标映射回 window-local。

## 模型分工

SciForge 将“视觉规划”和“视觉定位”分开配置：

- **VisionPlanner 使用 VLM**：读取任务文本和截图，输出下一步通用 GUI action。推荐统一使用 `qwen3.6-plus`，也可以配置其他支持图像输入的模型。
- **Grounder 默认使用 KV-Ground**：你自己部署 KV-Ground 服务，SciForge 通过 `/health` 和 `/predict/` 调用它，把目标描述映射到截图像素坐标。
- **visual Grounder fallback 也必须使用 VLM**：只有没有 KV-Ground 时才启用，模型同样建议和 VisionPlanner 使用同一个 VLM，例如 `qwen3.6-plus`。
- **普通文本模型不能作为 VLM**：例如 `deepseek-v4` / `deepseek-v4-flash` 不能处理截图输入，不应配置为 VisionPlanner 或 visual Grounder。

## 配置项

推荐在 `workspace/.sciforge/config.json` 或 `.sciforge/config.json` 中配置：

```json
{
  "modelBaseUrl": "http://your-openai-compatible-endpoint/v1",
  "apiKey": "your-api-key",
  "modelName": "bailian/deepseek-v4-flash",
  "visionSense": {
    "desktopBridgeEnabled": true,
    "plannerModel": "qwen3.6-plus",
    "visualGrounderModel": "qwen3.6-plus",
    "grounderBaseUrl": "http://127.0.0.1:18081",
    "grounderRemotePathPrefix": "/remote/shared/path/",
    "grounderLocalPathPrefix": "/local/shared/path/",
    "showVisualCursor": true
  }
}
```

含义：

- `modelName`：普通文本 backend，可继续使用 deepseek 等文本模型。
- `visionSense.plannerModel`：VisionPlanner 的 VLM，必须支持图像输入。
- `visionSense.visualGrounderModel`：没有 KV-Ground 时的 VLM 定位 fallback，必须支持图像输入。
- `visionSense.grounderBaseUrl`：你部署的 KV-Ground 服务地址。
- `visionSense.grounderRemotePathPrefix` / `grounderLocalPathPrefix`：当 KV-Ground 服务和 SciForge 共享挂载目录时，用于把本地截图路径映射为服务端可读路径。
- `visionSense.showVisualCursor`：真实 Computer Use 时显示 SciForge 专属视觉指针，便于区分用户鼠标和 agent 操作。

等价环境变量：

```bash
export SCIFORGE_VISION_PLANNER_BASE_URL="http://your-openai-compatible-endpoint/v1"
export SCIFORGE_VISION_PLANNER_API_KEY="your-api-key"
export SCIFORGE_VISION_PLANNER_MODEL="qwen3.6-plus"

export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
export SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX="/local/shared/path/"
export SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX="/remote/shared/path/"

export SCIFORGE_VISION_GROUNDER_LLM_BASE_URL="http://your-openai-compatible-endpoint/v1"
export SCIFORGE_VISION_GROUNDER_LLM_API_KEY="your-api-key"
export SCIFORGE_VISION_GROUNDER_LLM_MODEL="qwen3.6-plus"
export SCIFORGE_VISION_SHOW_CURSOR=1
```

## 最小请求

```python
from sciforge_vision_sense import VisionTaskRequest

request = VisionTaskRequest(
    task="搜索一篇论文标题，并停在结果页",
    appWindowTarget={"app": "browser"},
    artifactOutputDir=".bioagent/vision-runs/run-001",
)
```

## Sense Plugin 文本结果

```python
from sciforge_vision_sense import (
    ComputerUseTextCommand,
    build_sense_plugin_request,
    sense_text_result_for_computer_use,
)

request = build_sense_plugin_request(
    "点击 Upload 按钮",
    modalities=[{"kind": "screenshot", "ref": "artifact:screen-001.png"}],
)
command = ComputerUseTextCommand(
    action="click",
    target={"x": 682, "y": 1101, "description": "Upload button"},
    sourceModalityRefs=["artifact:screen-001.png"],
)
text_result = sense_text_result_for_computer_use(request, command)
assert text_result.format == "application/json"
```

## KV-Ground 调用示例

```python
import os

from sciforge_vision_sense import KvGroundClient

client = KvGroundClient(
    base_url=os.environ["SCIFORGE_VISION_KV_GROUND_URL"],
    remote_path_prefixes=("/remote/shared/path/",),
)
result = client.predict(
    "/remote/shared/path/restart_check.png",
    "Click the Submit button",
)
```

## 失败处理

失败时必须结构化记录：

- 截图 ref、哈希、尺寸和窗口元数据。
- VisionPlanner 原始 JSON 或解析失败原因。
- KV-Ground 请求摘要、返回摘要和坐标解析状态。
- Executor 状态、输入通道、窗口锁和失败原因。
- Verifier 的 before/after 截图和 pixel diff。

高风险动作默认 fail closed。发送、删除、支付、授权、外部发布等动作必须由上游明确确认后才能执行。

## MVP 边界

- 纯视觉：不读 DOM，不读 accessibility tree。
- Planner 不输出坐标，只输出目标描述。
- KV-Ground 负责把 `image_path + text_prompt` 变成原图像素坐标。
- Executor 是外部模块，本包只定义文本命令和协议。
- Pixel diff 只证明视觉状态变化，语义完成仍需下一步检查。

## 测试

在仓库根目录运行：

```bash
python -m unittest discover -s packages/observe/vision/tests
python -m pytest packages/observe/vision/tests
```
