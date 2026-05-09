# SciForge - PROJECT.md

最后更新：2026-05-09

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- Python conversation-policy package 是多轮对话策略算法的唯一真相源；TypeScript 只能保留 transport、runtime 执行边界和 UI 渲染，不再维护一套并行的策略推断算法。
- T096/T097 的 execution mode 策略只允许来自 Python classifier；TypeScript 的职责是字段透传、runtime shell、guard 调用、ref 持久化和 UI fallback，不允许用 prompt regex 或 provider/scenario 分支重建策略。
- 当 observe、skills、actions、verifiers、interactive views 增多时，主 agent 只消费 capability broker 生成的紧凑 capability brief；能力模块默认是 typed service/adapter，只有开放式、多步推理模块才声明内部 planner/小 agent，interactive views 只负责按 schema 渲染。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。
- Computer Use 必须走 window-based 主路径：观察、grounding、坐标映射和动作执行都绑定目标窗口/窗口内容坐标，而不是全屏全局猜测；并行长测必须隔离目标窗口、输入通道和 trace，不抢占用户真实鼠标键盘。

## 任务板

### T102 真实多轮对话任务矩阵与回归脚本

状态：进行中；目标是把多轮聊天从“单轮 demo 能跑”推进到“真实科研 workspace 连续协作能恢复、能引用、能修复、能验收”。任务必须覆盖真实文件、真实 artifact、真实失败恢复和真实后续追问，不允许用预设回复或固定关键词假装通过。

真实多轮任务清单：

- 文献证据复核：第 1 轮上传/引用论文列表，要求生成 evidence matrix；第 2 轮追问“只保留高置信度机制证据并解释排除项”；第 3 轮要求把上一轮矩阵导出为 report artifact，并能引用具体行/列和来源文件。
- 失败后修复继续：第 1 轮请求运行一个会缺少输入列的分析；backend 必须返回 failureReason、缺失字段和 recoverActions；第 2 轮用户补充列映射或文件引用；第 3 轮继续同一个 attempt history，产出修复后的 ExecutionUnit 和 artifact。
- 基于上一轮对象追问：第 1 轮生成图表或表格 artifact；第 2 轮用户说“把刚才那个图改成按组分面并标注显著性”；系统必须从 workspace refs 找到上一轮对象，而不是靠最近文本猜测。
- 长上下文压缩恢复：连续 4-6 轮加入多个文件、日志和中间结果；触发 context compaction 后，下一轮“继续刚才的验证”仍能读取长期事实、最近意图、失败状态和 artifact refs。
- 多目标实例修复：第 1 轮选中 B workspace 的 issue；第 2 轮用户补充约束；第 3 轮要求验证并写回，过程必须保留 target instance、issue bundle、修改阶段和测试阶段事件。
- Computer Use 长任务：第 1 轮要求观察目标窗口并执行 UI 操作；第 2 轮用户说“继续刚才窗口里的同一个对象”；系统必须使用 window-based trace 和窗口内容坐标恢复，不抢占其他窗口。
- 后端沉默/慢响应恢复：第 1 轮触发长任务或首事件延迟；UI 必须在 5 秒内显示等待原因、最近真实事件、可中止/可继续提示；第 2 轮用户追加引导时排队到下一轮，而不是丢失。
- 验收不通过再修复：第 1 轮生成 artifact 后 verifier 返回失败；第 2 轮用户要求“按验收意见修一下”；系统必须把 verifier result、失败原因和修复策略带入下一轮。

子任务拆分：

- T104 证据矩阵到报告引用链：真实论文/数据文件 -> evidence matrix -> 高置信筛选短追问 -> report artifact，验收 artifact/source/executionUnit refs。
- T105 失败补字段继续执行：缺列/空结果/非零 exitCode 必须进入 repair-needed，下一轮补列映射后沿同一 attempt history 继续。
- T106 Artifact 对象追问：第 2 轮“刚才那个图/表”必须绑定 workspace artifact ref，生成新 revision/UIManifest，不静默覆盖旧对象。
- T107 长上下文压缩后继续验证：压缩后短指令仍能恢复 latestStageRef、artifact refs、failureReason、recoverActions 和 nextStep。
- T108 运行中追加引导：长任务期间用户补充约束进入 guidance queue，后续每条 guidance 都有 adopted/deferred/rejected 和 reason。
- T109 Computer Use 窗口对象连续操作：多轮操作绑定同一目标窗口和对象 trace，窗口丢失时返回 recoverActions。

Todo：

- [ ] 将上述多轮任务整理成可运行的 longform fixtures，输入必须包含真实 workspace refs、artifact refs、execution units 和 failure/recover records。
- [ ] 为每个任务生成最小可复现 smoke：验证消息链、artifact refs、attempt history、context compaction、stream process transcript 和最终结果。
- [ ] 把“继续、修复、上一轮、刚才那个、文件在哪里”等短指令纳入回归集，确保短期意图能绑定长期 workspace refs。
- [x] 为后端沉默路径增加 UI 级回归：提交后立即有 request accepted 进展，5 秒内有 waiting progress，45 秒 silent retry 前保留最后真实事件。
- [ ] 每个任务必须记录失败时下一轮可恢复所需字段：failureReason、missingInputs、recoverActions、nextStep、attemptId、artifact refs、executionUnit refs。
- [x] 新增 `smoke:complex-multiturn-chat` 快速协议回归，覆盖 artifact refs、失败恢复、guidance queue 和多轮 payload 裁剪进入最终 handoff。
- [ ] 将任务运行结果纳入 `longform:status` 或独立 matrix report，显示最近通过/失败、失败阶段和可复现命令。

验收标准：

- [ ] 任一任务不能依赖硬编码 prompt、demo 数据或静态模板答案；结果必须来自 AgentServer/backend、workspace 文件和 runtime contract。
- [ ] 每个多轮任务至少覆盖 3 轮，其中至少 1 轮是短追问或修复指令。
- [ ] 失败恢复任务必须证明下一轮能读取上一轮 failureReason 和 recoverActions。
- [ ] artifact 追问任务必须证明对象引用来自 workspace refs，而不是只从自然语言上下文回忆。
- [ ] 慢响应任务必须证明 UI 在首个 backend event 前有可见进展，并在沉默阈值内给出等待状态。

### T103 多轮聊天首反馈与慢响应体验治理

状态：进行中；当前用户反馈是“回复太慢，半天没反应”。本任务聚焦首个可见反馈、后端沉默诊断、stream retry、追加引导排队和 Computer Use 可观察性，不改变 AgentServer 作为真实回答来源的原则。

Todo：

- [x] 提交后立即展示通用 request accepted 进展卡，避免用户只看到输入框清空或单条队列日志。
- [x] 发送前显式让浏览器先渲染一帧，避免大 payload 构造/序列化挡住“已收到请求”的首屏反馈。
- [x] 将 UI silent stream waiting 阈值从 60 秒降到 5 秒，让慢首事件在用户体感上快速解释清楚。
- [x] AgentServer compact endpoint 增加单端点短超时，避免发送前压缩接口长时间挂起。
- [x] Workspace runtime 进入 gateway 后先 emit request received / conversation policy started 阶段事件。
- [x] UI stream abort 级联到 AgentServer generation fetch，避免静默重试后旧 backend run 继续占资源。
- [x] 普通 AgentServer stream 增加 30 秒 silent guard；带 current-reference digests 的收敛守门仍保留 45 秒。
- [ ] 将 UI 等待阈值改为优先读取 runtime latencyPolicy；没有 policy 时使用安全默认值。
- [x] 用 Computer Use 在真实界面复现提交与等待路径：发送后立即显示 request accepted，后端慢时显示等待原因、最近事件和可中止/可继续提示。
- [ ] 用 Computer Use 继续复现追加引导和中止路径，记录 guidance queue 和 abort 级联效果。
- [ ] 检查 target instance lookup、preflight context compaction、workspace stream fetch 三段是否阻塞首反馈；首反馈必须在这些异步步骤前出现。
- [x] 为 `runPrompt` / handoff 关键路径增加回归，断言 request accepted、payload compaction、abort race 和 text-delta draft 不依赖最终 backend result。
- [ ] 为 backend silent retry 增加端到端 smoke，确保首事件长时间无返回时只重连一次，并保留原请求 payload 和用户可见诊断。
- [x] 将 `text-delta` / `output` stream event 桥接为运行中的 assistant draft；最终 result 到达后再替换或归并。
- [x] 压缩多轮 payload：最近 N 条消息内联，长 artifact/log/stdout 只传 refs、摘要和 digest。

验收标准：

- [x] 用户点击发送后 1 秒内可见“已收到请求/正在准备”类进展，不依赖后端首 token。
- [x] 首个 backend event 延迟超过 5 秒时，运行面板显示等待原因、最近真实事件、可中止/可继续提示。
- [ ] 用户在运行中继续输入时，引导进入 guidance queue，并在当前 run 结束后自动合并为下一轮。
- [ ] Computer Use 实测 trace 证明窗口目标、点击、输入和可见状态变化正确，且不使用全屏坐标猜测。
- [x] `npm run typecheck` 和相关 process/chat tests 通过。

### T101 清空 src/shared 并收敛 src 边界

状态：已完成；`src/shared` 已物理删除，所有旧共享协议已迁入 package/runtime contract 或能力 package，执行编排进入 runtime，boundary smoke 已阻止 `src/shared` 复活。本任务目标是把 `src/shared` 彻底清空：共享协议进入 `packages/contracts/runtime` 或后续 `packages/contracts/*`，执行逻辑进入 `src/runtime/*`，界面逻辑进入 `src/ui/*`。`shared` 这个名字只说明“被多个地方 import”，没有说明 owner、稳定性、依赖方向和安全边界，容易变成杂物间；后续新增代码禁止进入 `src/shared`。

正式原则：

- `src/` 只保留产品实现边界：`src/ui` 是前端产品 app，`src/runtime` 是本地 runtime/gateway/server/adapters。
- 跨 UI/runtime 的稳定协议不放在 `src/shared`，应进入 `packages/contracts/runtime/*`，后续如 T100 落地物理目录，可迁入 `packages/contracts/*`。
- 有执行行为、provider 选择、调用编排、文件/网络/AgentServer 交互的逻辑不放在 shared；它属于 `src/runtime/*`。
- UI state、展示转换、交互模型、React 组件和用户可见 presentation helper 不放在 shared；它属于 `src/ui/*` 或 `packages/presentation/*`。
- packages 不能反向 import `src/shared`。如果 package 需要类型或 fixture，应从 package 自身或 `packages/contracts/runtime` 获取。
- `src/shared` 不保留兼容 re-export；module-boundary smoke 禁止新增 `src/shared/**`。

当前 `src/shared` 文件归宿：

- `src/shared/agentHandoff.ts` -> `packages/contracts/runtime/handoff.ts`：AgentServer handoff source、默认 URL/timeout、shared handoff contract 和 source metadata。
- `src/shared/agentHandoffPayload.ts` -> `packages/contracts/runtime/handoff-payload.ts`：UI/CLI/runtime handoff payload contract、verification/human approval/failure recovery policy set。
- `src/shared/capabilityRegistry.ts` -> `packages/contracts/runtime/capabilities.ts`：capability summary/contract/registry metadata；后续结合 T100 的 lifecycle metadata 和 skill/observe/action/verifier/presentation taxonomy。
- `src/shared/senseProvider.ts` -> `packages/contracts/runtime/observe.ts`：rename sense -> observe，保留 provider capability brief、input modality、request/response、safety/privacy boundary 等纯 contract。
- `src/shared/senseOrchestration.ts` -> 拆分：纯 invocation plan/record 类型进入 `packages/contracts/runtime/observe.ts`；provider 选择和 `runSenseInvocationPlan` 执行逻辑进入 `src/runtime/observe/orchestration.ts`。
- `src/shared/verifiers/agentRubric.ts` -> `packages/verifiers/agent-rubric/index.ts` 或 `packages/verifiers/agent-rubric/contracts.ts`：agent rubric verifier request/result/provider contract 和 mock provider；`packages/verifiers/agent-rubric/fixture.ts` 不再反向 import `src/shared`。
- 对应 tests 迁到目标文件旁边：contract tests 进入 `packages/contracts/runtime/*`，runtime orchestration tests 进入 `src/runtime/observe/*`，verifier tests 进入 `packages/verifiers/agent-rubric/*`。

最终 `src` 目录视图：

```text
src/
  ui/          product app: React, app state, UI adapters, user interactions
  runtime/     local runtime: gateway, server, adapters, execution orchestration
```

已完成迁移：

- `agentHandoff` / `agentHandoffPayload` / `capabilityRegistry` 迁入 `packages/contracts/runtime/{handoff,handoff-payload,capabilities}.ts`，UI/runtime imports 已改为 package subpath。
- `senseProvider` contract 迁入 `packages/contracts/runtime/observe.ts`，`senseOrchestration` 的执行编排迁入 `src/runtime/observe/orchestration.ts`。
- `agentRubric` 迁入 `packages/verifiers/agent-rubric/index.ts`，fixture 不再反向依赖 `src/shared`。
- `src/shared` 目录和旧 tests 已删除。
- docs 与 module-boundary smoke 已更新为“共享协议进 packages contract，执行逻辑进 runtime，界面逻辑进 ui”。

Todo：

- [x] 新增 `packages/contracts/runtime/handoff.ts` 和 `handoff-payload.ts`，迁移 `agentHandoff` / `agentHandoffPayload` contract 与 tests；更新 UI/runtime imports。
- [x] 新增 `packages/contracts/runtime/capabilities.ts`，迁移 capability summary/contract/registry metadata 与 tests；和 T100 lifecycle metadata 对齐。
- [x] 新增 `packages/contracts/runtime/observe.ts`，迁移 sense provider contract 并 rename 为 observe terminology，保留旧 sense 字段兼容策略。
- [x] 新增 `src/runtime/observe/orchestration.ts`，承接 observe invocation provider 选择与运行逻辑；更新 runtime 调用方和 tests。
- [x] 迁移 `src/shared/verifiers/agentRubric.ts` 到 `packages/verifiers/agent-rubric`，修复 `packages/verifiers/agent-rubric/fixture.ts` 的反向依赖。
- [x] 不保留 `src/shared/*` 临时 re-export；所有生产 import 已转向新入口。
- [x] 删除 `src/shared` 目录及其 tests。
- [x] 扩展 `tools/check-module-boundaries.ts`：禁止新增 `src/shared/**`，禁止 `packages/**` import `src/**`，并检查 top-level package lifecycle metadata。
- [x] 更新 `docs/Extending.md`、`packages/README.md`、`docs/README.md`、`docs/Architecture.md`：新增能力决策树明确 contract/runtime/ui 三分法。

验收标准：

- [x] `find src/shared` 返回空或目录不存在；没有生产代码从 `src/shared` import。
- [x] `packages/**` 不再 import `src/shared/**` 或任何 `src/**` 私有文件。
- [x] UI/runtime 共享类型全部来自 `packages/contracts/runtime/*` 或公开 package exports。
- [x] Observe 命名替代 sense 命名进入新 contract；旧 sense 命名只作为兼容字段或能力 id 兼容存在。
- [x] `npm run smoke:module-boundaries` 能阻止新增 `src/shared` 文件和 package 反向依赖。
- [x] `npm run typecheck`、相关 package/runtime tests、`npm run smoke:runtime-contracts`、`npm run smoke:module-boundaries` 通过。
