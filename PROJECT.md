# SciForge - PROJECT.md

最后更新：2026-05-16

## 当前目标

在网页端持续测试、优化和修复 SciForge 多轮对话机制，使最终 Single-Agent runtime 稳定、流畅、可扩展。所有修改必须通用；多轮运行时以 [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md) 为最终 contract，产品/实现背景参考 [`docs/Architecture.md`](docs/Architecture.md)。

## 必读边界

实现前先读：

- [`docs/SciForge-SingleAgent-Architecture.md`](docs/SciForge-SingleAgent-Architecture.md)：最终多轮 runtime contract，包含 Workspace Kernel、AgentServer Context Core、Runtime Bridge、Capability Gateway、Projection-only UI、conformance 和长期防污染边界。
- [`docs/Architecture.md`](docs/Architecture.md)：SciForge 总体架构、Backend-first / Capability-driven / Harness-governed 方向、`src` 与 `packages` 边界。
- [`docs/AgentHarnessStandard.md`](docs/AgentHarnessStandard.md)：harness runtime、profile、stage hook、contract、trace、merge 规则和行为治理入口。

历史任务归档：2026-05-14/15 的旧 CAP/PKG/GT/PSM/MEM/H022 长段在 [`docs/archive/PROJECT-history-2026-05-14-15.md`](docs/archive/PROJECT-history-2026-05-14-15.md)。旧 `SF-STAB-*` 事故链路已吸收到当前任务板，不再作为活动 backlog。

## 不变原则

- 所有修改必须通用、可泛化到任何场景，不能在代码里为当前案例、prompt、provider、backend、文件名或错误文本打补丁；skills/tools 等插件化能力必须尽可能即插即用、易扩展。
- 有多种方案时，优先实现最简洁、通用、可验证的方案。
- 算法相关代码优先用 Python 实现，方便人类用户优化和检查。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级为 audit-only，避免长期并行实现。
- 设计和实现保持同一真相源：真实 browser、conformance、性能或用户体验证明关键设计不满足需求时，必须在同一 milestone 同步修改设计文档、代码和本文件；不能只改代码绕过 contract，也不能只改文档掩盖缺口。
- Capability 必须在生成层成为可执行 authoring contract：当系统已有 ready provider/tool route 时，Backend prompt 不能只收到抽象规则或诊断摘要，必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton；运行时 preflight/guard 只作为最后防线。
- 新增 tool 的最小接入闭环是：CapabilityManifest -> ProviderManifest/route resolver -> HarnessContract decision -> compact context envelope -> authoring contract/helper SDK -> Gateway.execute -> validator/preflight -> ArtifactDelivery/Projection -> conformance fixture。
- 多轮记忆采用 Single-Agent runtime 边界：Workspace Kernel 的 append-only ledger/ref store 是可恢复事实源；AgentServer Context Core 负责 context orchestration、retrieval、compaction 和 backend handoff；agent backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 不需要保护旧兼容行为；旧逻辑如果与最终 contract 冲突，默认删除、合并或标注为 audit-only migration helper。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；主入口只做流程编排。

## 当前任务：Browser Multiturn Stability Sprint

状态：stable-candidate
总控：Codex Orchestrator
工作分支：`main`

目标：用 Codex in-app browser 对真实 Web UI 做 fresh、continue、repair、provider/tool、refresh restore、artifact selection、audit/debug 路径测试；发现问题后写入本任务板，并做通用修复，直到最终方案稳定运行。

### 阶段门

1. **PROJECT Cleanup Gate**：本文件只保留当前目标、原则、活动任务、issue queue、验证门和 handoff；旧任务正文删除或移入 archive。
2. **Browser Discovery Gate**：每轮至少用 in-app browser 跑一个真实多轮路径；不能只用 terminal smoke 代替用户可见验证。
3. **Root-Cause Fix Gate**：每个 P0/P1 必须定位到 contract/module 边界，优先修架构薄腰；preflight/retry 只能作为最后防线。
4. **Projection Gate**：用户可见 terminal state 必须来自 ConversationProjection + ArtifactDelivery；raw run、stream delta、ExecutionUnit 只进 transient/audit/debug。
5. **Conformance Gate**：修复后至少跑相关 targeted tests、`npm run typecheck`、`npm run smoke:single-agent-runtime-contract`；milestone 完成前跑 `npm run verify:single-agent-final`。
6. **Sync Gate**：完成 milestone 后更新本文件、提交并 push 到 `origin/main`。

### 活动任务

| ID | 状态 | 内容 | 验收 |
|---|---|---|---|
| BM-001 | completed | 清理 `PROJECT.md`，删除旧 SA/SF-STAB 任务正文，建立新的 browser stability sprint 任务板。 | 本文件只包含当前 sprint、issue queue、验证门和 handoff；旧历史只以 archive 链接存在。 |
| BM-002 | completed | 用 in-app browser 跑 fresh -> continue 多轮路径，记录用户可见问题。 | Browser DOM evidence 覆盖新聊天隔离、Projection terminal、continue audit intent。 |
| BM-003 | completed | 修复本轮 browser 发现的最高优先级问题，必须是通用 contract/module 修复。 | 通用修复落在 runtime gateway、UI transport context policy、Agent Harness shadow intent；无 prompt/provider/scenario 特例。 |
| BM-004 | completed | 补齐回归测试和 conformance 证据。 | targeted tests、typecheck、single-agent runtime smoke、web conformance、`verify:single-agent-final` 均通过。 |
| BM-005 | completed | 同步文档和 GitHub。 | `PROJECT.md` 已更新；本次 milestone commit + push `main` 完成。 |

### Issue Queue

#### Open

暂无。

#### In Progress

暂无。

#### Fixed Pending Verification

暂无。

#### Verified

- `BM-BROWSER-001` - Projectionless fail-closed terminal result：browser fresh no-exec run 曾在右侧主结果卡在“主结果等待 ConversationProjection”。修复：`finalizeGatewayPayload` 统一为所有 terminal payload 附加 ResultPresentation/ConversationProjection contract。验证：browser fresh run 显示“只得到部分结果” Projection，不再等待 raw run；`generation-gateway.policy.test.ts` 增加 fail-closed Projection 断言；`verify:single-agent-final` 通过。
- `BM-BROWSER-002` - UI transport did not explicitly classify fresh/continue/repair：continue turn 依赖 prompt 文本和残留 refs 推断上下文，容易出现真实 runtime context 与 UI handoff 不一致。修复：`sciforgeToolsClient` 为每轮请求写入 `contextReusePolicy` / `contextIsolation`，fresh 禁止历史复用，continue/repair 只复用 bounded refs。验证：UI policy tests 覆盖 fresh/continue；browser continuation persisted context 显示 `context=continue` 与 Projection continuation ref。
- `BM-BROWSER-003` - Agent Harness audit summarized continuation as fresh：runtime 已按 continue 复用，但 `HarnessDecisionRecorded` 仍显示 `intent=fresh`。修复：Agent Harness shadow input 从 transport `contextReusePolicy` 派生 `continuation` / `repair` intent。验证：browser continuation DOM 显示 `HarnessDecisionRecorded profile=balanced-default; intent=continuation; exploration=minimal`；新增 `agent-harness-shadow.test.ts` 覆盖 continue/repair policy seed。
- `SF-STAB-001..008` 历史问题已关闭并吸收到当前原则、conformance 和设计文档：新聊天隔离、provider-first authoring contract、Projection-only UI、repair bounded-stop 和 capability-first preflight 均由最终 contract 覆盖。详细事故链路见 git history 与 archive。

### Browser Test Matrix

每轮至少覆盖其中一条真实路径：

- Fresh chat isolation：新聊天首轮不能继承旧 failure、repair context、current work 或 stable AgentServer session id。
- Fresh provider/tool task：ready provider/tool route 必须进入 capability-first authoring contract；如果 backend/tool 不可用，Projection 可见 failed-with-reason。
- Continue from result：第二轮必须保留 current user goal，不被旧 artifact 或 raw run 污染。
- Repair from failure：repair 必须 bounded、refs/digests-only，并返回 minimal adapter task 或合法 failed-with-reason Projection。
- Refresh/reopen restore：刷新或重开后，右侧主结果、recover actions、artifact refs 必须来自 persisted Projection。
- Artifact selection：显式选择旧 artifact 后追问，只能使用 selected refs，不混入最新 artifact。
- Audit/debug：raw details 可审计，但不能驱动主结果。

### 验证命令

常用：

```bash
npm run typecheck
npm run smoke:single-agent-runtime-contract
npm run smoke:no-legacy-paths
npm run smoke:web-final-conformance
```

Milestone 完成门：

```bash
npm run verify:single-agent-final
```

Browser 验证必须使用 Codex in-app browser，不用普通 terminal smoke 替代。

### Activity Log

- 2026-05-16 - Orchestrator - 重置 `PROJECT.md` 为 Browser Multiturn Stability Sprint：删除旧 SA/SF-STAB 活动正文，只保留当前目标、原则、活动任务、issue queue、browser matrix 和验证门。
- 2026-05-16 - Orchestrator + subagents - 并行完成模块勘察、dev startup 勘察和预修复 smoke：定位多轮路径主链路在 `runOrchestrator`、UI handoff、runtime gateway、ConversationProjection、Agent Harness shadow 与 session persistence。
- 2026-05-16 - Browser - in-app browser fresh no-exec run 发现右侧结果等待 ConversationProjection；修复后 fresh run 显示 Projection-derived partial/degraded result，`projectionWaitCount=0`。
- 2026-05-16 - Browser - in-app browser continuation run 验证 context reuse 与审计一致：runtime handoff 为 continue，右侧 Projection terminal 可见，`HarnessDecisionRecorded` 显示 `intent=continuation`。
- 2026-05-16 - Verification - 通过 targeted tests、`npm run typecheck`、`npm run smoke:single-agent-runtime-contract`、`npm run smoke:no-legacy-paths`、`npm run smoke:web-final-conformance`、`npm run verify:single-agent-final`。`smoke:no-legacy-paths` 仅报告既有 baseline warnings，无新增 legacy findings。

### Current Handoff

Browser Multiturn Stability Sprint 当前 milestone 已完成并进入 stable-candidate：fresh terminal Projection、continue context reuse、Agent Harness audit intent、targeted tests、typecheck、smoke、final evidence gate 和 GitHub sync 已验证。下一步继续扩展 repair/provider/tool/refresh restore 的真实 browser matrix。
