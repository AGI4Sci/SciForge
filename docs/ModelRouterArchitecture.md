# Model Router 设计

最后更新：2026-06-07

## 文档目的与约束

这份文档只记录 Model Router 本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解 Model Router 是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成 provider config、API schema 或测试用例。
- 文档只描述 Model Router 自身的稳定边界、路由原则、trace 原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、界面呈现或产品工作流设计。
- 精确字段、profile 配置、provider metadata、trace redaction 和测试真相源放在 `packages/workers/model-router` 及相关 runtime contract。
- 如果实现细节变复杂，优先更新 package contract 和测试；本文件只补能帮助沟通和理解需求的原则。

## 定位

Model Router 是 `/v1/responses` 兼容的模型 facade，不是任务编排器，不是 verifier，也不是任务执行器。

Model Router 只负责：

- 按 workspace / profile / role 选择已注册模型。
- 调用 text reasoner、vision translator 或其它受控 provider。
- 接收统一 `input_object` 多模态输入，并在 Router 内部完成模态识别、读取、翻译和必要的局部补充。
- 把截图、crop、页面片段、文本上下文等输入转成 bounded model output。
- 维护 Router 内部的多模态对象 descriptor 缓存，减少同一会话/同一对象的重复 translator 调用。
- 写 refs-first trace 和 provider-safe diagnostics。
- 阻止未注册 provider、未授权 profile 或不安全 payload。

Model Router 不负责：

- 用户任务规划。
- 模块选择。
- risk policy。
- approval。
- repair。
- completion truth。
- final answer ownership。
- GUI / Browser / Desktop 动作执行。

## 外部边界

Model Router 不直接面向用户完整任务。调用方必须先给出明确 profile、role、输入 refs、预算和用途。

Model Router 返回 bounded model output、trace refs、diagnostics 和 blocked reason；调用方负责解释这些输出、选择下一步、验证和生成最终答复。

Model Router 输出只是候选信号，不是可执行动作、坐标、文件写入、授权结果或用户级完成证明。

## 能力面

| 能力 | 作用 | 边界 |
| --- | --- | --- |
| Profile routing | 根据 workspace / profile / role 选择已注册 provider。 | 不静默 fallback 到未注册模型或私有 provider。 |
| Text reasoning | 生成局部文本推理、候选解释或摘要。 | 不拥有任务计划、最终答案或验收结论。 |
| Multimodal input_object | 外部只传对象 ref / mime / title 等结构化对象，Router 内部选择合适 translator。 | 外部调用方不能为视觉、音频、文档等模态另建旁路链路。 |
| Region-grounded descriptor | 为视觉对象积累 `object + summary + regions + gaps`，其中 `regions.anchor` 使用归一化 bbox 表达空间位置。 | descriptor 是 Router 内部证据，不是公开 provider payload，不包含 base64。 |
| Vision translation | 把截图、crop、页面片段转成区域锚定 descriptor 或 descriptor patch。 | 不输出最终执行坐标，不绕过目标绑定。 |
| Trace / diagnostics | 记录 refs-first trace、耗时、provider-safe error。 | 不记录 API key、raw provider payload、base64 或 secret。 |

## 路由原则

- 生产默认模型必须来自注册 profile / public alias。
- profile 负责声明 role、provider、能力、预算、fallback eligibility 和 redaction policy。
- 未注册模型、未注册 provider、缺失凭据或超预算请求必须 fail closed。
- 本地调试 fallback 不能冒充 release / product evidence。
- provider diagnostics 只能暴露 method、path、elapsed、retry、error category 等安全信息。
- 多模态对象必须按对象 id / ref / content hash 绑定，不能按附件顺序猜测用户目标。
- 同一视觉对象优先复用 region-grounded descriptor；只有缺少所需事实、bbox 区域不确定或置信度不足时，Router 才能调用 translator 做 targeted refinement。
- targeted refinement 必须绑定到具体 `modality_input` 和可选 bbox / region 线索，不能重新读取所有对象。

## 局部辅助原则

Model Router 可以作为其它模块的局部辅助，例如：

- 截图 / crop / 页面片段描述。
- 候选目标消歧。
- 候选 next intent 解释。
- before / after 差异说明。
- 不确定性解释。

这些输出必须保持 refs-first 和 bounded。真正的可执行 binding、坐标、input lease、文件写入、浏览器导航和真实动作必须来自对应模块或 adapter。

## 禁止事项

Model Router 不能：

- 改变 risk policy。
- 决定跨模块下一步。
- 绕过 confirmation。
- 自动 repair。
- 产出用户级 completion truth。
- 生成用户可见 final answer。
- 静默 fallback 到未注册 provider / model / profile。
- 让 Agent Host、UI、Browser、Computer Use 或其它外部模块直接调用视觉 translator 形成旁路。
- 让外部 prompt 承担“如何读取图片/音频/文档”的模态翻译职责。
- 根据多模态对象出现顺序决定用户询问的是哪一个对象。
- 把 raw provider payload、base64、API key、secret 或未脱敏请求体写入 public trace。

## 迁移口径

迁移目标：

- 旧的硬编码 provider / model name 收敛到注册 profile / public alias。
- text reasoner 和 vision translator 通过明确 role 区分。
- 旧的视觉旁路、Agent Host 视觉专用链路和外部模态 prompt 收敛到统一 `input_object` -> Model Router。
- Browser、Computer Use、artifact verifier 等模块只能把 Model Router 当局部辅助，不能把模型输出当产品 truth。
- release / product 验收必须使用 refs-first trace 和注册 provider metadata，不能依赖本地调试 fallback。

## 契约真相源

长期 contract、profile metadata、router implementation、trace redaction 和测试应放在：

- `packages/workers/model-router/src`
- `packages/contracts/runtime/capability-provider-policy.ts`
- `tests/smoke/*model-router*`
- `tools/*model-router*`

本文件只保留设计原则和迁移口径。

## 相关文档

- [`BrowserRuntimeArchitecture.md`](BrowserRuntimeArchitecture.md)：Browser 如何使用局部模型辅助。
- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：Computer Use 如何使用局部感知辅助。
- [`Architecture.md`](Architecture.md)：总架构和 Model Router 上下游边界。
