# SciForge - PROJECT.md

最后更新：2026-05-09

## 根本方向

SciForge 的最终形态是 **Backend-first, Contract-enforced, Capability-driven**。完整设计以 [`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture) 为准；本文件只保留围绕最终形态重构的任务板。

核心定位：

- SciForge 是 downstream scenario adapter，不是第二套 agent。
- Agent backend 负责用户意图理解、多轮指代、能力选择、任务规划、胶水代码生成、artifact 内容读取、失败诊断、继续执行和修复。
- SciForge 负责协议、capability registry、capability broker、workspace refs、执行边界、contract validation、artifact 持久化、view 渲染和机器可读错误回传。
- Packages 不只是代码复用单元，而是 capability contract 单元；observe、skills、actions、verifiers、views、memory、import/export 都应暴露可声明、可校验、可组合、可替换、可修复的 capability。
- 重构时必须删除历史遗留链路，只保留最新唯一逻辑和唯一真相源；不得为了兼容旧实现长期保留并行路径、prompt regex、场景特例、provider 特例或 UI 语义兜底。

## 重构守则

- 每个重构任务都必须先声明新的唯一真相源，再删除旧入口、旧 adapter、旧 fallback 和旧测试夹具。
- 临时兼容层必须有删除任务、删除条件和 smoke guard；没有删除计划的兼容层不允许合入。
- Backend-first 优先级高于 UI 侧聪明化：SciForge 不判断“用户是不是想看报告/上一轮/markdown”，只传 refs、capability brief 和 contract。
- 所有 capability 输出都必须可代码校验；校验失败生成 `ContractValidationFailure` 返回 backend 修复，不在 SciForge 侧改写成成功。
- 高频稳定路径可以固化为 composed capability，但仍必须暴露 manifest、validator、repair hints 和 fallback，下钻后可由 backend 重新组合原子能力。
- 历史任务不再单独维护；如果仍有价值，必须并入下面的最终形态重构任务。

## 倒叙任务板

### T120 Final Cutover：删除遗留链路并锁定唯一真相源

状态：规划中；目标是在最终形态完成后做全项目 cutover，删除所有历史并行实现，只保留 capability-first / backend-first 的唯一逻辑。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#最终形态backend-first-capability-architecture)。

Todo：

- [ ] 列出所有旧链路：UI prompt regex、场景 id 分支、provider 特例、旧 payload normalizer、旧 fallback、旧 preview resolver、旧 task adapter、旧 compatibility re-export。
- [ ] 为每条旧链路标注新的唯一真相源：capability manifest、broker、resolver、validator、runtime executor 或 backend tool。
- [ ] 删除旧链路和对应测试夹具；只保留验证新路径的 tests/smoke。
- [ ] 增加 `no-legacy-paths` smoke，禁止重新引入 UI 语义兜底、provider/scenario/prompt 特例和重复 source of truth。
- [ ] 更新 docs/Architecture、docs/Extending、packages/README，删除旧架构描述。

验收标准：

- [ ] 全项目只有一条 backend-first request path 和一套 capability registry/broker/validation loop。
- [ ] 搜索不到已列入删除清单的 legacy symbols、旧 adapter、旧 fallback 和旧特例分支。
- [ ] `npm run typecheck`、runtime contract smoke、package boundary smoke、frontend rendering tests 和多轮 fixtures 全部通过。

### T119 UI Thin Shell：UI 只做展示、引用和安全边界

状态：规划中；目标是把 UI 从语义路由层降级为 thin shell。UI 只负责 session 可视化、object refs、artifact views、execution units、validation errors、recover actions 和用户交互安全边界。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#角色边界)。

Todo：

- [ ] 删除 UI 侧自然语言意图判断、报告/markdown/上一轮结果等语义 fallback。
- [ ] UI 只从 backend response、workspace refs、UIManifest 和 capability result projection 渲染结果。
- [ ] 将“backend 不可达/stream 断开/validation failed”统一显示为诊断和 recover actions，不合成最终答案。
- [ ] 结果面板只依赖稳定 object refs；不直接依赖临时 `agentserver://` preview。
- [ ] 增加 UI smoke，断言 report 追问、artifact 追问、失败修复都由 backend/capability path 产生结果。

验收标准：

- [ ] UI 不含 prompt regex、scenario id 分支或 artifact type 特例来决定用户语义。
- [ ] UI 能完整展示 `ContractValidationFailure`、recoverActions、related refs 和 backend repair state。
- [ ] 删除旧 UI fallback 后，多轮 report/artifact/repair fixtures 仍通过。

### T118 Backend-first Artifact and Run Tools

状态：规划中；目标是让 backend 通用读取、解析、渲染和继续 workspace 事实，解决多轮对话依赖 SciForge 猜测的问题。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#backend-first-多轮-artifact-使用)。

Todo：

- [ ] 定义并暴露 backend 工具 contract：`list_session_artifacts`、`resolve_object_reference`、`read_artifact`、`render_artifact`、`resume_run`。
- [ ] 支持 workspace refs、artifact refs、executionUnit refs、run refs、file refs 和 `agentserver://` refs 的统一解析。
- [ ] run completed 前将 backend 输出 materialize 到 `.sciforge/task-results/*.json|md` 并返回稳定 object refs。
- [ ] backend completed contract 禁止 “I will retrieve...” 这类计划句伪装完成；必须交付文本、artifact 或稳定 ref。
- [ ] 建立三条最小多轮 fixtures：生成 report 后要 markdown、基于刚才 artifact 继续处理、按 failed run 原因修复。

验收标准：

- [ ] “给我 markdown 格式报告”由 backend 读取已有 artifact 后返回真实 Markdown 或稳定 report ref。
- [ ] “重新检索/再跑/最新”不会误用旧 artifact；backend 自主决定复用、扩展或重跑。
- [ ] `agentserver://` 输出不再成为 UI 预览稳定性的唯一依赖。

### T117 ContractValidationFailure and Repair Loop

状态：规划中；目标是把所有 schema、ref、artifact、UIManifest、WorkEvidence 和 verifier 错误统一为机器可读 validation failure，交回 backend 修复。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#validation-and-repair-loop)。

Todo：

- [ ] 定义 `ContractValidationFailure` contract：schema path、contract id、capability id、expected/actual、missing fields、invalid refs、unresolved URI、failureReason、recoverActions、nextStep、related refs。
- [ ] 将现有 payload validation、artifact validation、UIManifest validation、WorkEvidence guard、verifier failure 映射到该 contract。
- [ ] repair prompt/handoff 只消费结构化 failure，不读取散乱错误文本。
- [ ] 删除旧的分散 repair-needed/failed-with-reason 组装逻辑，保留统一 validation-to-repair 管线。
- [ ] 增加 fixtures：schema 缺字段、invalid ref、artifact 空结果、verifier fail、stdout/stderr 指向修复。

验收标准：

- [ ] 任一 contract 错误都能被统一序列化并带回 backend。
- [ ] backend 修复后同一 run/attempt history 可继续，而不是开新失败链路。
- [ ] 没有旧 validation error 文案分支继续作为业务逻辑入口。

### T116 Capability Broker and Layered Meta Exposure

状态：规划中；目标是让 backend 每轮只消费相关、紧凑的 capability brief；调用或修复时再按需展开 contract、examples、repair hints 和日志 refs。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#meta-暴露与热路径固化)。

Todo：

- [ ] 建立 capability broker 输入：prompt、object refs、artifact index、failure history、scenario policy、runtime policy、available providers。
- [ ] broker 输出 compact capability brief 列表，默认不展开 full schema。
- [ ] 定义 expansion API：`brief -> contract summary -> full schema/examples/repair hints`。
- [ ] 将 backend request payload 改为消费 broker 输出，而不是散落的 skills/views/tools 列表。
- [ ] 删除旧 capability 拼接逻辑和重复 prompt context builder。

验收标准：

- [ ] backend 默认只看到相关能力 brief，而不是全量协议。
- [ ] 选择能力后可按需展开 schema；失败修复时可展开 repair hints 和日志 refs。
- [ ] 旧的多处 capability list 构造逻辑被删除或合并到 broker。

### T115 Unified CapabilityManifest Registry

状态：规划中；目标是建立所有 packages/modules 的统一 capability manifest，使每个模块都可声明、校验、组合、替换和修复。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#一切模块都是-capability)。

Todo：

- [ ] 定义 `CapabilityManifest` contract：name、version、owner package、brief、routing tags、inputSchema、outputSchema、sideEffects、safety、examples、validator、repairHints、providers、lifecycle metadata。
- [ ] 梳理现有模块并分类：observe、skills、actions、verifiers、views、memory/context、importers/exporters、runtime adapters。
- [ ] 为首批核心能力补 manifest：artifact resolver/read/render、workspace read/write、run command、Python task、vision observe、computer-use action、report viewer、evidence matrix、schema verifier。
- [ ] 建立 registry loader 和 package boundary smoke，禁止核心能力无 manifest 暴露。
- [ ] 删除旧 registry、旧 skill list、旧 view registry 中与 manifest 重复的真相源。

验收标准：

- [ ] 至少 8 个核心能力拥有 manifest，并能由 registry 统一加载。
- [ ] 同一 capability 可声明多个 provider，但 contract 保持唯一。
- [ ] package boundary smoke 能阻止无 contract 的核心能力扩散。

### T114 Scenario Packages as Policy Only

状态：规划中；目标是把 scenario package 收敛为领域 policy 和能力选择约束，不再承载执行逻辑、多轮判断或 prompt 特例。

设计文档：[`docs/Architecture.md`](docs/Architecture.md#角色边界)。

Todo：

- [ ] 定义 scenario package 允许字段：artifact schemas、default views、allowed/required capabilities、domain vocabulary、verifier policy、privacy/safety boundaries。
- [ ] 删除 scenario 中的执行逻辑、prompt 特例、多轮语义判断和 provider 分支。
- [ ] scenario 只影响 capability broker 的筛选和 policy，不直接决定 backend 回答。
- [ ] 增加 scenario package smoke，禁止新增执行代码或 prompt regex。

验收标准：

- [ ] 所有 scenario package 都能被解释为 capability policy。
- [ ] backend 使用 scenario policy 选择能力，但任务理解和执行仍走通用 backend/capability path。
- [ ] 旧 scenario-specific execution path 被删除。

### T113 Immediate Stabilization Without New Architecture Debt

状态：规划中；目标是在开始大重构前，用最少改动稳定服务，同时不新增长期债务。

Todo：

- [ ] 暂停新增 UI 语义 fallback、prompt regex、provider/scenario 特例。
- [ ] 所有新修复必须记录未来唯一真相源和删除旧路径的后续任务。
- [ ] 对现有多轮 report/artifact/repair 问题，只允许通过 backend tools、stable refs、validation repair loop 或诊断提示推进。
- [ ] 新增 smoke 优先覆盖最终形态关键路径，而不是给旧路径补测试。

验收标准：

- [ ] 稳定化补丁不会扩大旧架构面积。
- [ ] 新增代码都能归入 T115-T120 的最终形态任务。
- [ ] 没有新的临时兼容层缺少删除计划。
