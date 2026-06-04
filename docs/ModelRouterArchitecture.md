# Model Router 架构

最后更新：2026-06-04

## 结论

SciForge Model Router 是一个 Codex provider-compatible 的多模态模型 facade，不是新的 agent host。

MVP 路线：

```text
SciForge / Codex app-server
  -> Model Router /v1/responses
  -> text reasoner
  -> vision translator
  -> refs-first trace bundle
```

外部调用者看到的是一个 `/v1/responses` provider。内部只做确定性编排：识别模态输入、按 profile 选择模型、把视觉转译成文本、执行受限补问循环、写审计 trace，并把最终文本回答返回给调用者。

## 设计原则

- Router 是薄 orchestrator，不做任务推理、planning、completion 判断或 capability ranking。
- 主文本模型是 reasoning owner。
- 模态模型只负责 `instruction + modality -> text observation`。
- 所有模型按 workspace/profile 配置，不在代码里写死。
- 默认对外透明，只返回最终答案；内部过程写 refs-first trace。
- 视觉输入可以多次补充，但次数由 profile 控制，默认 2 次。
- 缺少视觉信息时降级回答，不能假装看过图。

## MVP 范围

第一阶段只支持视觉模态：

- image
- screenshot
- inline image input
- SciForge artifact/file ref

不做 protein structure、audio、video、table-specific translator 或公开 trace HTTP endpoint。未来新模态必须作为新的 translator role 接入，而不是扩张 router 的智能职责。

## 组件边界

| 组件 | 职责 | 禁止 |
| --- | --- | --- |
| Model Router HTTP service | `/v1/responses` facade、profile 解析、模态归一化、补问循环、stream 转发、trace 写入 | 推理答案、替 agent 规划、静默 fallback 到未注册模型 |
| Text Reasoner Client | 调用当前 profile 的文本模型 | 直接读取图片或依赖未审计模态 payload |
| Vision Translator Client | 调用当前 profile 的视觉转译模型，返回文本观察 | 执行桌面动作、判断任务完成、长期保存 base64 |
| Profile Resolver | 按 request/workspace/default 选择已注册 profile | 允许任意请求指定 provider/base URL/API key |
| Trace Writer | 写 `.sciforge/model-router-traces/**` refs-first bundle | 写 API key、完整 raw provider payload、长期 base64 |

现有 `codex-responses-proxy` 继续作为 provider protocol compatibility 工具。Model Router 可以复用兼容代码，但不把原 proxy 扩成多模态编排器。

## Profile 配置

请求可以通过 header 或 metadata 携带 workspace/profile；没有携带时使用服务默认 profile。

```yaml
defaultProfile: sciforge-runtime-default

profiles:
  sciforge-runtime-default:
    traceRoot: .sciforge/model-router-traces
    textReasoner:
      provider: deepseek
      baseUrl: ${SCIFORGE_TEXT_BASE_URL}
      apiKeyEnv: SCIFORGE_TEXT_API_KEY
      model: deepseek-v4-flash
    translators:
      vision:
        provider: qwen
        baseUrl: ${SCIFORGE_VISION_BASE_URL}
        apiKeyEnv: SCIFORGE_VISION_API_KEY
        model: qwen3.7-plus
        maxSupplementRounds: 2
```

DeepSeek 和 Qwen 只是默认 profile 示例。稳定语义是 role：

```text
textReasoner
translators.vision
future translators.proteinStructure
future translators.audio
```

未知 profile、未注册模型或缺少必要 secret 时 fail closed，不静默换模型。

## 请求数据流

纯文本请求直接转给 text reasoner。

视觉请求按以下流程执行：

```text
request
  -> resolve profile
  -> normalize visual inputs into ModalityRef
  -> call vision translator for initial observation
  -> call text reasoner with user text + visual observations
  -> optional strict JSON supplement request
  -> bounded vision supplement round
  -> final answer
  -> Responses-compatible result/stream
```

内部统一视觉引用：

```json
{
  "id": "image_1",
  "kind": "vision.image",
  "source": "inline|ref|url",
  "mime": "image/png",
  "sha256": "7f5c2b4f9a1e",
  "width": 1280,
  "height": 720
}
```

Router 可以接收 inline image、image URL 或 SciForge ref，但长期 trace 只保存 ref、hash、尺寸和摘要，不保存 base64。

## 补问协议

Text reasoner 在内部控制轮只能返回两类严格 JSON。

最终回答：

```json
{
  "type": "final_answer",
  "content": "The chart appears to show a rising dose-response curve."
}
```

请求补充视觉信息：

```json
{
  "type": "need_more_visual_info",
  "target": "image_1",
  "question": "Read the chart legend and y-axis label.",
  "reason": "The initial observation did not include exact labels."
}
```

Router 只校验 schema、target 和 round budget。非法 JSON、未知 target 或超过 `maxSupplementRounds` 时，不再调用视觉模型；Router 把控制错误摘要交给 text reasoner 生成最终答案。

## Streaming

默认只流最终答案。

视觉转译、补问、失败诊断和内部控制轮不作为 provider stream 暴露。它们写入 trace bundle。这样外部体验仍接近普通 `/v1/responses` provider，只是首 token 可能包含视觉转译延迟。

## Trace

每次请求写一个本地 trace bundle：

```text
.sciforge/model-router-traces/YYYY-MM-DD/resp_<id>/
  trace.json
  input-modalities.json
  vision-initial-image_1.json
  vision-supplement-1-image_1.json
  final-routing-summary.json
```

Trace 必须记录：

- trace id、response id、workspace id、profile id
- text reasoner provider/model
- translator provider/model
- modality refs、hash、尺寸、mime
- 每轮 initial/supplement/final 的 status、latency、错误摘要
- 是否触发降级回答

Trace 不记录：

- API key
- raw secret headers
- 长期 base64
- 完整 raw provider payload
- 未脱敏私密 URL 或本地敏感路径

## 失败处理

视觉转译失败时，Router 降级回答：

```text
visual_input=image_1
status=unavailable
reason=vision translator timeout
instruction=Answer from text-only context and explicitly state that the image could not be inspected.
```

补问失败时保留已有视觉观察，并把失败摘要交给 text reasoner。文本模型失败时整个 `/v1/responses` 请求失败，因为没有 reasoning owner 可以兜底。

## Single Truth

最终答案的推理真相源是 text reasoner。Router 只提供模态文本上下文和审计记录。

产品路径必须满足：

- `externalSurface=/v1/responses`
- `routerRole=deterministic-orchestrator`
- `reasoningOwner=textReasoner`
- `modalityOutput=textObservation`
- `tracePolicy=refs-first`
- `supplementLoop=bounded-by-profile`
- `secondAgentHost=false`

缺少这些条件时，该服务不能声明为 SciForge 多模态 provider。

## 禁止 fallback

以下行为禁止作为 MVP fallback：

- Router 自己推理最终答案
- Router 自己规划多步任务
- 未注册 provider/model 的请求级任意 override
- 视觉失败后让文本模型假装看过图
- 把 raw image/base64 长期写入 trace
- 把内部视觉阶段作为默认 provider stream 暴露
- 把 protein/audio/table 等未来模态硬编码进 vision path

## 验收

- SciForge Runtime Codex 可以把 provider 指向 Model Router `/v1/responses`。
- 纯文本请求行为等价于当前文本 provider proxy。
- 视觉请求会先调用配置的 vision translator，再调用 text reasoner。
- Text reasoner 可以通过严格 JSON 请求补充视觉信息。
- 默认最多补问 2 次，profile 可改。
- 对外只返回最终 Responses-compatible answer/stream。
- 每次请求生成 `.sciforge/model-router-traces/**` bundle。
- 视觉失败时最终回答明确说明图像无法检查。

## 任务入口

- [`Architecture.md`](Architecture.md)
- [`NativeExtensionOwnershipMap.md`](NativeExtensionOwnershipMap.md)
- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)
- [`../packages/backend/README.md`](../packages/backend/README.md)
- [`../packages/observe/vision/README.md`](../packages/observe/vision/README.md)
