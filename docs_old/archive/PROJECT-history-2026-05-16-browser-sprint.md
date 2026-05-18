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
- 代码路径保持唯一真相源：发现冗余链路时删除、合并，避免长期并行实现。
- 设计和实现保持同一真相源：真实 browser、conformance、性能或用户体验证明关键设计不满足需求时，必须在同一 milestone 同步修改设计文档、代码和本文件；不能只改代码绕过 contract，也不能只改文档掩盖缺口。
- Capability 必须在生成层成为可执行 authoring contract：当系统已有 ready provider/tool route 时，Backend prompt 不能只收到抽象规则或诊断摘要，必须收到标准 helper/API 签名、任务输入字段和可复制 adapter skeleton；运行时 preflight/guard 只作为最后防线。
- 新增 tool 的最小接入闭环是：CapabilityManifest -> ProviderManifest/route resolver -> HarnessContract decision -> compact context envelope -> authoring contract/helper SDK -> Gateway.execute -> validator/preflight -> ArtifactDelivery/Projection -> conformance fixture。
- 多轮记忆采用 Single-Agent runtime 边界：Workspace Kernel 的 append-only ledger/ref store 是可恢复事实源；AgentServer Context Core 负责 context orchestration、retrieval、compaction 和 backend handoff；agent backend 只消费 cache-aware projection/task packet 并按需读取 refs。
- 不需要保护旧兼容行为；旧逻辑如果与最终版本冲突，默认删除、合并。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 2000 行优先拆分；超过 3000 行视为维护风险。
- 长文件拆分必须按职责命名，不能机械切成 part1/part2；主入口只做流程编排。

## 当前任务：Browser Multiturn Stability Sprint

状态：active
总控：Codex Orchestrator
工作分支：`main`

目标：用 Codex in-app browser 对真实 Web UI 做 fresh、continue、repair、provider/tool、refresh restore、artifact selection、audit/debug 路径测试；发现问题后写入本任务板，并做通用修复，直到最终方案稳定运行。

当前 milestone：Parallel Browser Stability & Speed。重点不是再证明 fixture smoke 能过，而是多开独立端口和独立 workspace/state 的真实网页进程，在能成功完成对话任务的前提下，压测多轮对话是否稳定、足够快。每个进程必须只改通用模块，不允许为某个 prompt、端口、backend、provider 或浏览器会话写特例。

### 阶段门

1. **PROJECT Cleanup Gate**：本文件只保留当前目标、原则、活动任务、issue queue、验证门和 handoff；旧任务正文删除或移入 archive。
2. **Browser Discovery Gate**：每轮至少用 in-app browser 跑一个真实多轮路径；不能只用 terminal smoke 代替用户可见验证。
3. **Root-Cause Fix Gate**：每个 P0/P1 必须定位到 contract/module 边界，优先修架构薄腰；preflight/retry 只能作为最后防线。
4. **Projection Gate**：用户可见 terminal state 必须来自 ConversationProjection + ArtifactDelivery；raw run、stream delta、ExecutionUnit 只进 transient/audit/debug。
5. **Conformance Gate**：修复后至少跑相关 targeted tests、`npm run typecheck`、`npm run smoke:single-agent-runtime-contract`；milestone 完成前跑 `npm run verify:single-agent-final`。
6. **Sync Gate**：完成 milestone 后更新本文件、提交并 push 到 `origin/main`。

### 成功底线

稳定、快速的前提是多轮对话任务能真正完成。任何速度优化都必须遵守以下优先级：

1. **完成任务优先**：fresh、continue、repair、provider/tool、artifact follow-up 必须在真实 browser 中产出用户请求的有效结果，或在确实缺少权限/证据/输入时给出可恢复的下一步。
2. **准确回答才算成功**：`TaskSuccess=true` 必须代表用户问题被准确、完整、可核查地回答；只恢复 UI、只保留 refs、只显示 `satisfied`、只没有 raw leak、只没有 Projection wait，都不能单独算成功。如果回答空泛、答非所问、只复述 refs、提示 `Reference path was not readable`、出现 failed/repair-needed 污染，或没有真正利用用户选择的 artifact/provider evidence，必须记为 `TaskSuccess=false`。
3. **Projection terminal 必须可信**：`satisfied` 只能在任务内容真实完成时出现；`background-running` 代表已有准确且有用的前台结果且后台继续；`needs-human` / `repair-needed` / `failed-with-reason` 只能用于真实阻塞，不得用来掩盖 backend 慢、回答质量不足或实现缺口。
4. **不能用快失败冒充快**：提前 fail-closed、返回空结果、跳过 provider/tool、跳过验证、直接给 degraded answer，除非 contract 明确证明继续执行不可行。
5. **快的是首个有用反馈和收敛路径**：可以更早展示计划、进度、partial answer、recover action，但不能牺牲最终任务质量、refs grounding、ArtifactDelivery 或 verification boundary。
6. **多轮连续性是成功的一部分**：第二轮必须接住上一轮目标和结果；repair 必须基于当前失败 refs；artifact follow-up 必须基于用户选择的 refs，并给出基于该 selected artifact 的实质回答。

### 活动任务

### BM-001..005 Browser Stability Sprint 初始化闭环

状态：完成；旧 SA/SF-STAB 活动正文已移入历史归档或吸收到当前原则、验证门和 issue queue。首轮 browser discovery、Projection terminal 修复、continue audit intent、回归验证和 GitHub 同步已经完成。

调试环境：历史闭环任务，不需要独立 browser 端口；如需复验，用 P1 默认环境，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `5174`，AgentServer `18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`。

Todo：

- [x] 清理 `PROJECT.md`，只保留当前 sprint、issue queue、验证门和 handoff。
- [x] 用 in-app browser 跑 fresh -> continue 多轮路径，记录用户可见问题。
- [x] 修复首轮 browser 发现的最高优先级问题，且修复落在通用 contract/module 边界。
- [x] 补齐 targeted tests、typecheck、single-agent runtime smoke、web conformance 和 `verify:single-agent-final`。
- [x] 更新文档并同步到 `origin/main`。

验收标准：

- [x] 旧历史只以 archive 链接存在，活动 backlog 不再混入旧任务正文。
- [x] Browser DOM evidence 覆盖新聊天隔离、Projection terminal 和 continuation audit intent。
- [x] 修复无 prompt/provider/scenario 特例。

### PBT-001 并行端口与状态隔离矩阵

状态：完成；P1 已使用独立 `SCIFORGE_INSTANCE=p1`、UI `5173`、workspace writer `5174`、AgentServer `18080`、`workspace/parallel/p1`、`.sciforge/parallel/p1` 和 `.sciforge/parallel/p1/config.local.json` 跑出 evidence。P2/P3/P4 后续修正记录见 Issue Queue 与 Verified。

调试环境：全进程任务。仓库统一为 `/Applications/workspace/ailab/research/app/SciForge`；P1 Browser `http://127.0.0.1:5173/` / writer `5174` / AgentServer `18080` / workspace `workspace/parallel/p1` / state `.sciforge/parallel/p1`；P2 `5273/5274/18180` / `workspace/parallel/p2` / `.sciforge/parallel/p2`；P3 `5373/5374/18280` / `workspace/parallel/p3` / `.sciforge/parallel/p3`；P4 `5473/5474/18380` / `workspace/parallel/p4` / `.sciforge/parallel/p4`。

Todo：

- [x] 建立 P1-P4 独立 UI、workspace writer、AgentServer、workspace path、state dir 和 config path。
- [x] 在真实 browser evidence 中记录进程 owner、端口、workspace path 和 state dir。
- [x] 发现只隔离端口未隔离 workspace 的证据时，标记 invalid 并用 corrected manifest 重跑。

验收标准：

- [x] 每个进程互不覆盖 local state、`.sciforge` 和 workspace artifacts。
- [x] P1 evidence 见 `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json`。
- [x] P2/P3 corrected workspace evidence 已写入 Issue Queue / Verified。

### PBT-002 真实网页成功率与速度 baseline

状态：进行中；P1 已输出 browser timing/evidence manifest。fresh no-exec 成功，fresh normal 成功但 `T_first_backend_event` / `T_terminal_projection` 约 126s 超预算，final rerun 被 UI hydrate + AgentServer first-event stall 阻断。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。扩展 baseline 时同时使用 P2/P3/P4 对应端口和 workspace。

Todo：

- [x] 记录 fresh no-exec、fresh normal、answer-only continue 的 browser DOM、console summary、run id、session id 和 timing。
- [x] 将慢点归因到 AgentServer / Projection / UI hydrate，并写入 Issue Queue。
- [ ] 将 baseline 扩展到 P2 provider/tool、P3 repair/bounded-stop、P4 restore/selection。
- [ ] 将 timing manifest 接入 final / companion gate，避免只靠人工体感判断。

验收标准：

- [x] Manifest 包含 `T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`T_readable_answer` 和 `T_stall_bound`。
- [ ] 所有 P1-P4 关键路径都有真实 in-app browser evidence。
- [ ] 超阈值路径自动进入 Issue Queue，并带 policy / transport / runtime / AgentServer / Projection / UI hydrate 归因。

### PBT-003 长时间 running、软等待与 Projection 等待治理

状态：待办；当前仍需要把 backend 进展、前台可读结果、bounded stall 和 terminal Projection 的关系收敛成稳定策略。

调试环境：主进程 P3，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5373/`，Workspace Writer `http://127.0.0.1:5374`，AgentServer `http://127.0.0.1:18280`，workspace `workspace/parallel/p3`，state `.sciforge/parallel/p3`，config `.sciforge/parallel/p3/config.local.json`。P1/P2 的 slow evidence 可作为复现输入，但修复验收以 P3 bounded-stop browser path 为准。

Todo：

- [ ] 识别已有 backend event 后反复 soft wait 的真实 browser 路径。
- [ ] 有可读前台结果时进入 `background-running`，并保留后台继续执行状态。
- [ ] 无真实 blocker 时不得把 backend 慢包装成 `failed-with-reason`、`needs-human` 或 `repair-needed`。
- [ ] synthetic wait 事件不得把 stall bound 延长到 120s 之外。

验收标准：

- [ ] 有 backend 进展的 run 会继续推动任务完成。
- [ ] stalled run 在 bounded 时间内进入 Projection-visible terminal / background state。
- [ ] terminal 时 `ProjectionWaitAtTerminal=0`，不再显示“主结果等待 ConversationProjection”。

### PBT-004 Fresh -> Continue 常规对话成功率和速度

状态：进行中；answer-only continuation policy/direct-context contract 与 Projection persistence 已有修复，真实 browser 仍暴露 AgentServer first-event stall 和 UI hydrate blocker，需要下一轮复验。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。

Todo：

- [x] 修复 answer-only continuation 不应进入 generated workspace task 的 policy/direct-context 路径。
- [x] 修复 persisted response 与 Projection 可见答案不一致。
- [ ] 修复 UI hydrate blocker 后，重跑 fresh answer -> answer-only continue -> selected artifact/ref follow-up。
- [ ] 将普通 fresh/continue terminal 目标压到 60s 内。

验收标准：

- [x] Targeted Python/TS tests 覆盖 answer-only transform、direct-context fast path 和 Projection persistence。
- [ ] 真实 browser continue `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`。
- [ ] 首屏结果不被历史 repair/provider 状态污染。

### PBT-005 Provider/Tool 路径成功率、速度和稳定性

状态：待办；P2 已完成部分 provider preflight、helper contract 和 runtime hook 修复，但 ready -> follow-up -> artifact / unavailable / empty 的完整真实矩阵仍未全绿。

调试环境：主进程 P2，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5273/`，Workspace Writer `http://127.0.0.1:5274`，AgentServer `http://127.0.0.1:18180`，workspace `workspace/parallel/p2`，state `.sciforge/parallel/p2`，config `.sciforge/parallel/p2/config.local.json`。

Todo：

- [ ] 跑通 ready provider/tool route，确认 capability-first authoring contract 实际完成检索、读取或产物生成。
- [ ] provider unavailable 只在确认无可用 route 时 fail-closed，并返回 Projection-visible blocker / recover action。
- [ ] empty provider result 成为可信 terminal Projection，并支持 refined query follow-up。
- [ ] 禁止 backend 生成 `urllib`、`requests`、raw socket 或 worker endpoint 直连代码。

验收标准：

- [ ] Ready provider 首轮 `TaskSuccess=true`、`satisfied`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [ ] Provider/tool `T_first_progress<=3s`、`T_first_backend_event<=15s`、`T_terminal_projection<=120s`。
- [ ] Follow-up 只复用 public provider refs / ArtifactDelivery，不带 raw run/history。

### PBT-006 Repair from Failure 与 bounded-stop

状态：待办；P3 已有多条 repair/Projection 修复证据，但仍需按本任务压测失败恢复能力和重复失败 bounded-stop。

调试环境：主进程 P3，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5373/`，Workspace Writer `http://127.0.0.1:5374`，AgentServer `http://127.0.0.1:18280`，workspace `workspace/parallel/p3`，state `.sciforge/parallel/p3`，config `.sciforge/parallel/p3/config.local.json`。

Todo：

- [ ] 用 in-app browser 制造 provider/schema/validation failure，再点 recover 或输入 repair follow-up。
- [ ] 验证 repair mode 只来自 current Projection failure refs 或 recover action。
- [ ] repair handoff 只携带 refs/digests，不带 raw artifact/log/stdout/stderr body。
- [ ] 重复失败、silent stream、token guard 或 bounded-stop 时返回最小 Projection recover action。

验收标准：

- [ ] Repair 优先恢复并完成原任务。
- [ ] Prompt 关键词不能单独触发 repair。
- [ ] 不出现无限 repair loop。

### PBT-007 Refresh/Reopen Restore 真实浏览器路径

状态：边界已验证；P4 restore/reopen 证据证明 persisted Projection 可恢复，但 Golden Path 成功回答仍由 `golden-path` evidence 单独判定。

调试环境：主进程 P4，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5473/`，Workspace Writer `http://127.0.0.1:5474`，AgentServer `http://127.0.0.1:18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`，config `.sciforge/parallel/p4/config.local.json`。

Todo：

- [x] 在 P4 环境生成 terminal Projection 后 reload/reopen。
- [x] 验证右侧主结果、recover actions、artifact refs 从 persisted Projection 恢复。
- [x] 区分 restore boundary pass 与 `TaskSuccess=true`，不可把 failed/repair-needed 历史当成成功。

验收标准：

- [x] Reload/reopen 后 `ProjectionWaitAtTerminal=0`。
- [x] Restore source 为 ConversationProjection + ArtifactDelivery，不读 raw run body。
- [x] 主结果不显示 endpoint、auth、private path 或 raw stdout/stderr body。

### PBT-008 Artifact Selection 真实交互边界

状态：修复待整链路复验；P4 已修复 queued selected refs、selected-only direct-context 摘要和 diagnostic claim 过滤，真实 UI 旧 persisted run 仍保留 pre-fix unreadable evidence。

调试环境：主进程 P4，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5473/`，Workspace Writer `http://127.0.0.1:5474`，AgentServer `http://127.0.0.1:18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`，config `.sciforge/parallel/p4/config.local.json`。

Todo：

- [x] 点击旧 artifact，确认它进入 composer explicit refs。
- [x] 立即 fill/send 时不得因 React state stale 丢失 pending refs。
- [x] Follow-up request 只带 selected refs，不混入 latest artifact 或当前 run raw body。
- [x] 如果 selected artifact 不可读，必须返回真实 blocker，不能标记 `TaskSuccess=true`。

验收标准：

- [x] Request/persisted record references 仅包含 selected artifact refs。
- [x] Follow-up 基于 selected artifact 给出实质回答的 gateway path 已通过 targeted test 与 workspace-writer evidence；UI full Golden Path 仍需后续复验。
- [x] `RawLeak=false`，audit-only artifacts 不进主结果。

### PBT-009 真实 Browser Evidence 纳入 Final Gate

状态：已修 gate；P4 final evidence validator 现在拒绝 failed/repair-needed/diagnostic-only 或 non-accurate release blocker。

调试环境：主进程 P4，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5473/`，Workspace Writer `http://127.0.0.1:5474`，AgentServer `http://127.0.0.1:18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`，config `.sciforge/parallel/p4/config.local.json`。最终 evidence gate 还需引用 P1/P2/P3 产出的 manifest。

Todo：

- [x] 将真实 Codex in-app browser evidence 写入 `tests/fixtures/real-browser-evidence/manifest.json`。
- [x] 验证 required categories、截图/DOM 文件存在、`ProjectionWaitAtTerminal=0` 和 `RawLeak=false`。
- [x] 扩展 final / companion gate，要求 `AnswerQuality=accurate` 且 `TaskSuccess=true`。
- [x] 禁止 failed/repair-needed/diagnostic-only evidence 作为 Golden Path release blocker。

验收标准：

- [ ] 至少一条 fresh -> artifact -> follow-up -> reload/reopen -> follow-up 的真实 evidence 成为 release blocker。
- [ ] 缺 browser evidence、`AnswerQuality!=accurate` 或 `TaskSuccess!=true` 时 final gate fail。
- [ ] Final manifest 不再只有 fixture-managed/mock-only 记录。

### PBT-010 Multiturn Browser Golden Path Gate

状态：待办；P3 已有 corrected Golden Path gate 第一版 evidence，但 Golden Path 仍需扩展为 release blocker，并确保准确回答用户问题。

调试环境：主进程 P3，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5373/`，Workspace Writer `http://127.0.0.1:5374`，AgentServer `http://127.0.0.1:18280`，workspace `workspace/parallel/p3`，state `.sciforge/parallel/p3`，config `.sciforge/parallel/p3/config.local.json`。Provider/unavailable 扩展 case 可并行交给 P2，restore/selection 扩展 case 可并行交给 P4。

Todo：

- [x] 在 P3 环境跑 fresh artifact -> reload restore -> context-only follow-up -> selected artifact follow-up 第一版。
- [x] 输出 corrected manifest，记录 DOM、timing、TaskSuccess、UsefulPartial、BlockingTruth、MultiturnContinuity、ProjectionWaitAtTerminal、RawLeak。
- [ ] 补齐 `AnswerQuality=accurate` 语义校验，避免只恢复 refs 或只列诊断。
- [ ] 将 provider unavailable/recover、slow backend bounded-stop 纳入同一真实 browser 矩阵。

验收标准：

- [ ] 每个 case 输出 URL、run id、session id、prompt、DOM evidence、console/network summary、timing 和 success/failure reason。
- [ ] Direct-context sufficient 时不得 dispatch AgentServer。
- [ ] Summary follow-up 不得只吐 refs；selected artifact follow-up 必须准确回答 selected artifact 相关问题。

### MTG-001 真实网页多轮 Golden Path

状态：待办；这是当前 P0 主线，要求 fresh 成功生成用户可读结果 -> 选择 artifact -> follow-up 只用 selected refs -> reload/reopen 后继续追问 -> audit/debug 不污染主结果。

调试环境：跨进程主线。P1 负责 fresh/continue 起点，Browser `http://127.0.0.1:5173/`，writer `5174`，AgentServer `18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`；P4 负责 selected artifact、reload/reopen 和 audit boundary，Browser `http://127.0.0.1:5473/`，writer `5474`，AgentServer `18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`；P3 汇总 gate evidence，Browser `http://127.0.0.1:5373/`，writer `5374`，AgentServer `18280`，workspace `workspace/parallel/p3`。仓库统一为 `/Applications/workspace/ailab/research/app/SciForge`。

Todo：

- [ ] 用 Codex in-app browser 跑完整链路，不用 terminal smoke 代替。
- [ ] 每轮记录 URL、run id、session id、selected refs、request summary、DOM、console/network 和 timing。
- [ ] 失败时按 MTG-002/003/004/005 四个边界定位根因。
- [ ] 把 P1/P3/P4 的 evidence 合并成可被 final gate 消费的 manifest。

验收标准：

- [ ] 全链路 `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [ ] 任何 failed/repair-needed、不可读 selected artifact、只列 refs、空泛总结或未回答用户问题都使 Golden Path 失败。
- [ ] Audit/debug raw details 可审计但不驱动主结果。

### MTG-002 主结果真相源统一

状态：待办；P3 已修复 satisfied Projection visible answer 压过 stale wrapper/backend failure diagnostics 的一部分路径，仍需补齐 Golden Path 和 reload/reopen 验收。

调试环境：主进程 P3，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5373/`，Workspace Writer `http://127.0.0.1:5374`，AgentServer `http://127.0.0.1:18280`，workspace `workspace/parallel/p3`，state `.sciforge/parallel/p3`，config `.sciforge/parallel/p3/config.local.json`。

Todo：

- [x] 修复 chat `message.content`、persisted `run.response` 和 completed status 优先使用 satisfied `ConversationProjection.visibleAnswer`。
- [x] 保持 raw failure diagnostics 只进入 `run.raw` / audit。
- [ ] 构造 satisfied Projection 但 wrapper/backend raw 为 failure 的 reload/reopen 回归用例。
- [ ] 验证 stale `taskOutcomeProjection` 不覆盖 ResultPresentation/ArtifactDelivery。

验收标准：

- [ ] 网页端所有 terminal 主结果只从 ConversationProjection + ResultPresentation + ArtifactDelivery 渲染。
- [ ] DOM、records 和 reload/reopen 均显示 Projection answer。
- [ ] 旧 backend failure 只进 audit/debug，不进入主结果。

### MTG-003 AgentServer Generated Task 输出契约

状态：待办；P2 已修复 adapter skeleton compact 截断、provider preflight 和部分 ToolPayload normalization，但 ready backend 真实 Golden Path 仍需复验。

调试环境：主进程 P2，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5273/`，Workspace Writer `http://127.0.0.1:5274`，AgentServer `http://127.0.0.1:18180`，workspace `workspace/parallel/p2`，state `.sciforge/parallel/p2`，config `.sciforge/parallel/p2/config.local.json`。

Todo：

- [x] 将 canonical Python adapter 改为 multiline copyable skeleton。
- [x] 修复 string confidence、array reasoningTrace 等常见 backend 类型偏差的 normalization / validation 顺序。
- [ ] Ready backend 生成任务必须写标准 `ToolPayload`，包含 `message`、`claims`、`uiManifest`、`executionUnits`、`artifacts` 和合法 outputPath 写入。
- [ ] 在真实 browser fresh artifact run 中复验不再因缺 ToolPayload envelope 失败。

验收标准：

- [ ] Capability-first authoring contract 提供 copyable adapter/helper。
- [ ] Preflight 在昂贵执行前阻断明显非法代码。
- [ ] Backend 不生成 raw network / worker endpoint 直连代码。

### MTG-004 Conversation-policy Timeout 与误路由收敛

状态：进行中；Python/TS contract tests 已覆盖 answer-only continuation transform、selected refs direct-context、fresh/provider/tool dispatch。Browser 修复前误路由已消除为 direct-context，但最终复验被 UI hydrate blocker 截断。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。Provider/tool dispatch 负例可在 P2 `5273/5274/18180` 复验。

Todo：

- [x] 修复 `_infer_task_relation` 默认 `"new-task"` 导致 continue isolate。
- [x] 合并 Python policy 多 tsx 子进程为 batch bridge，降低 timeout 风险。
- [x] 为 policy timeout 的 continue turn 添加 transport-level fallback。
- [x] 修复 answer-only continuation direct-context transform。
- [ ] 修复 UI hydrate blocker 后重跑 P1 browser 复验。

验收标准：

- [x] Python policy 整体 < 1000ms。
- [x] Continue turn 正确返回 `"continue"`。
- [ ] Fresh work 和 provider/tool work 不被误判成 direct answer。
- [ ] Selected refs + no-rerun/no-tools/context-only 进入 direct-context。

### MTG-005 Timing 指标产品化

状态：进行中；`docs/test-artifacts/web-e2e/P1-MT-003/manifest.json` 已记录 P1 timing、DOM evidence、console summary，并按 AgentServer / Projection / UI hydrate 归因。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。后续统一 schema 时纳入 P2/P3/P4 对应 parallel workspace。

Todo：

- [x] 为 P1 browser runs 记录 `T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`T_readable_answer` 和 `T_stall_bound`。
- [ ] 将 P2/P3/P4 真实 browser evidence 统一到同一 manifest schema。
- [ ] 超阈值自动写入 Issue Queue。
- [ ] 接入 final / companion gate。

验收标准：

- [ ] Evidence manifest 可按 policy / transport / runtime / AgentServer / Projection / UI hydrate 聚合慢点。
- [ ] 超过阈值有 visible waiting reason 和 root boundary。
- [ ] 不再只靠人工体感判断慢点。

### MTG-006 Golden Path 纳入 Final Gate

状态：待办；当前 final evidence gate 已能引用真实 browser evidence，但仍缺 `AnswerQuality=accurate` / `TaskSuccess=true` 的 release blocker 语义。

调试环境：主进程 P4，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5473/`，Workspace Writer `http://127.0.0.1:5474`，AgentServer `http://127.0.0.1:18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`，config `.sciforge/parallel/p4/config.local.json`。最终 gate 消费的 release blocker evidence 需要来自 P1/P3/P4 合并 manifest。

Todo：

- [x] 让 final manifest 引用真实 Codex in-app browser evidence。
- [x] 强制 required categories、截图/DOM 文件存在、`ProjectionWaitAtTerminal=0` 和 `RawLeak=false`。
- [ ] 扩展 gate：缺 `AnswerQuality=accurate` 或 `TaskSuccess=true` 时失败。
- [ ] 至少一条完整 Golden Path 成为 release blocker。

验收标准：

- [ ] `verify:single-agent-final` 或 companion final gate 必须引用真实 in-app browser evidence。
- [ ] Evidence 不能只是 restore/selection/audit 边界通过，必须准确回答用户问题。
- [ ] 缺 browser evidence 或成功语义不达标时 final gate fail。

### P1-MT-001 Answer-only Continuation 路由

状态：进行中；通用修复已落在 Python policy answer-only transform + TS direct-context fast path，targeted tests 通过。真实 browser 最终复验被 UI hydrate blocker 截断。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。

Todo：

- [x] 当 follow-up 可由上一轮 visible answer / bounded refs 直接回答且无外部 IO、代码执行、文件写入或 provider side effect 时，走 direct continuation answer。
- [x] 跳过场景默认 expected-artifact gate，避免 checklist/summary 类 follow-up 被错误阻断。
- [ ] 修复 UI hydrate blocker 后重跑 `compress previous answer into checklist no search/no code`。
- [ ] 验证 handoff 只带 bounded Projection/refs，不重放 raw history。

验收标准：

- [ ] Browser run `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [ ] Direct-context sufficient 时不进入 generated workspace task。
- [ ] 不为 prompt 文本写特例。

### P1-MT-002 Persisted Response 与 Projection 一致

状态：完成；UI response normalization 保留 transport wrapper `displayIntent`，task-attempt materialization 支持 `displayIntent.resultPresentation.conversationProjection`，raw endpoint/stdout/stderr 不进入主结果。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。Reload/restore 复验可交给 P4 `5473/5474/18380`。

Todo：

- [x] `messages.content` / `runs.response` 优先来自 `displayIntent.resultPresentation` / `ConversationProjection.visibleAnswer`。
- [x] 只有没有有效 Projection/presentation 时才显示 backend failure summary。
- [x] 增加 targeted tests，覆盖 Projection answer 压过 stale backend wrapper failure。

验收标准：

- [x] Fresh/continue terminal 后，DOM、session records、reload/reopen 恢复内容一致。
- [x] 成功答案不持久化成 `后端运行未完成：backend failure`。
- [x] Raw endpoint/stdout/stderr 仍不进入主结果。

### P1-MT-003 网页端多轮流畅度 Gate

状态：进行中；P1 manifest 已覆盖 fresh no-exec、fresh normal、answer-only continue blocker 和 console/network summary，仍需稳定 DOM/test hook 与 final-gate 自动化。

调试环境：主进程 P1，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。

Todo：

- [x] 覆盖 fresh answer、answer-only continue 和 selected artifact/ref follow-up 的初版 evidence。
- [x] 记录成功率、首进度、首 backend event、terminal Projection、可读结果和最长静默。
- [ ] 补稳定 DOM/test hook，减少人工从 DOM 推断 success/timing。
- [ ] 将 evidence manifest 接入 final / companion gate。

验收标准：

- [ ] 三轮 in-app browser evidence 包含 URL、run id、session id、prompt、DOM evidence、console/network summary。
- [ ] 目标 `T_first_progress<=3s`、`T_first_backend_event<=15s`、普通 terminal <=60s。
- [ ] 失败必须归因到 policy / transport / runtime / AgentServer / Projection / UI restore 边界。

### P2-MT-001..010 Provider/Tool 多轮矩阵

状态：待办；P2 已完成部分基线、corrected workspace、runtime-visible-state hook、provider preflight 和 helper contract 修复，但 ready/unavailable/empty 多轮完整矩阵仍需继续并行推进。

调试环境：主进程 P2，仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5273/`，Workspace Writer `http://127.0.0.1:5274`，AgentServer `http://127.0.0.1:18180`，workspace `workspace/parallel/p2`，state `.sciforge/parallel/p2`，config `.sciforge/parallel/p2/config.local.json`。

Todo：

- [ ] `P2-MT-001`：ready provider 首轮 `satisfied` 后，连续两轮 follow-up 复用 public provider refs / ArtifactDelivery。
- [ ] `P2-MT-002`：provider unavailable 后 recover-to-ready，不被旧 failed Projection 污染。
- [ ] `P2-MT-003`：empty provider result 后 refined query 重新走 ready provider route。
- [ ] `P2-MT-004`：provider/tool 等待理由、首个可见进度、backend event 和 terminal Projection 变成稳定用户体验。
- [ ] `P2-MT-005`：ready/unavailable/empty 任一 terminal 后 reload/reopen restore。
- [ ] `P2-MT-006`：跑通 ready provider golden path。
- [ ] `P2-MT-007`：建立 public outcome continuation compact envelope。
- [ ] `P2-MT-008`：建立 controlled unavailable fixture。
- [ ] `P2-MT-009`：定义 empty provider terminal contract。
- [x] `P2-MT-010`：提供 browser runtime state/test hook，读取 run/session/status/timing/projection/raw-leak。

验收标准：

- [ ] Ready -> ask-for-details -> ask-for-artifact 三轮 `TaskSuccess=true` 或真实 blocker。
- [ ] `MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [ ] Public outcome envelope 不携带 raw run body、stdout/stderr、endpoint、auth、worker private path 或 audit-only artifact。
- [ ] Provider/tool terminal <= 120s，超过时有 visible waiting reason。

### MT-001..006 多轮 Policy 与 ToolPayload 根因修复

状态：完成；多轮 policy 默认隔离、policy spawn 慢、timeout fallback、Python policy 单测、ToolPayload confidence coercion 和 schema validation 顺序已完成修复。

调试环境：根因修复任务主要在本地仓库 `/Applications/workspace/ailab/research/app/SciForge` 通过 targeted tests / `verify:single-agent-final` 验证；不需要独立 browser 端口。需要 browser 回归时使用 P1 `5173/5174/18080` 验证 continue，使用 P2 `5273/5274/18180` 验证 provider/tool generated task。

Todo：

- [x] `MT-001`：`_infer_task_relation` 在有 prior context 且无明确 new-task 信号时返回 `"continue"`。
- [x] `MT-002`：将多个 tsx 子进程合并为 `conversation-policy-batch.ts` + `batch.py`。
- [x] `MT-003`：policy timeout 的 continue turn 允许 transport-level fallback。
- [x] `MT-004`：补充多轮路径 Python policy 单测。
- [x] `MT-005`：`normalizeToolPayloadShape()` 将 string confidence 强转为 number。
- [x] `MT-006`：schema validation 先尝试 normalization coercion，再判断是否 reject。

验收标准：

- [x] `_infer_task_relation('Can you elaborate?', False, True)` 返回 `"continue"`。
- [x] Python policy 整体 < 1000ms。
- [x] string confidence + array reasoningTrace payload 通过 validation。
- [x] `verify:single-agent-final` 995/995 通过。

### ARC-001..016 架构合规与多轮稳定收敛

状态：待办；基于对三个设计文档（SingleAgent Architecture、Architecture、AgentHarnessStandard）和四层代码（Python policy、Runtime gateway、UI transport、Session transforms）的系统交叉审计，发现 16 条架构违规直接阻断多轮稳定性、速度和准确性。按 P0/P1/P2 分级，修复必须通用且符合设计文档 contract。

**跨任务一致性约束**：当代码层面改变了设计文档描述的行为、边界或 contract 时，必须同步更新对应设计文档（`docs/SciForge-SingleAgent-Architecture.md`、`docs/Architecture.md`、`docs/AgentHarnessStandard.md`）的相关章节，并在本文件记录变更摘要。不允许只改代码绕过 contract，也不允许只改文档掩盖缺口。

#### ARC-P0 — 当前直接阻断多轮成功

### ARC-P001 `normalizeToolPayloadShape` 改为 mandatory normalization safety net

状态：已完成；`generated-task-runner-output-lifecycle.ts:104` 只在 `payloadErrors.length > 0` 时才调用 coercion。当 payload 原本通过 schema（如 confidence 恰好是 number），但 reasoningTrace 是空数组、NaN confidence 等语义偏差，normalization 被完全跳过，导致后续下游收到未归一化字段。

设计文档违规：C06（Pipeline executor 无业务条件分支）+ Architecture.md "validation 先跑完再决定下一步"。

主修路径：MTG-003 的 capability-first authoring contract 让 AgentServer 产出 conforming ToolPayload；normalization 是防止 authoring contract 缺口时系统硬崩的 safety net，不应作为 primary correctness mechanism。验收应包含：authoring contract 生效后 AgentServer 产出 string confidence 的 case count 逐步降到 0，届时 normalization safety net 只处理真正罕见的 edge case。

Todo：

- [x] 将 `normalizeToolPayloadShape` 改为在 `validateAndNormalizePayload` 之前无条件执行的 mandatory step，不依赖 schema error count 作为 gate。
- [x] 删除 `payloadErrors.length ? deps.normalizeToolPayloadShape(payload) : payload` 条件分支，改为 `const normalizedInput = deps.normalizeToolPayloadShape(payload)`。
- [x] 增加 targeted test：payload schema 合法但含空数组 reasoningTrace → normalization 仍执行并归一化。
- [ ] `verify:single-agent-final` 全绿。

验收标准：

- [x] `normalizeToolPayloadShape` 对所有 payload 均执行，不依赖前置 schema 检查结果。
- [x] Schema 合法但语义偏差的 payload 经 normalization 后字段类型归一化。
- [x] 无条件分支控制 normalization 是否执行。
- [ ] Authoring contract 生效后 string confidence case count 持续下降（监控指标，非 blocking）。

### ARC-P002 Projection status-first trust model

状态：已完成；`responseNormalization.ts:352` — `looksLikeRawFailureText` 对 `visibleAnswer.text` 做检查，如果文本含 `https://` URL（如 DOI 或 citation link），整个 Projection 被丢弃。科学回答几乎必然包含 URL，导致 Projection satisfied 但 UI 显示"后端运行未完成"。更根本的问题是：当前系统对 Projection text 做 heuristic 分类来决定是否信任，但 Projection 的 status 字段本身就是可信分层——只要 status 存在且合法，text 就应该无条件信任，不需要 heuristic 二次甄别。

设计文档违规：C12（Projection 胜过 stream delta）+ Architecture.md "UI 只消费 Projection"。

改进点：比原方案 "合法 status 跳过 heuristic" 更根本——改为 **status-first trust model**：只要 `status` 字段存在且不是 `undefined/null`，Projection answer 就是可信的，**永远不对其 text 做 heuristic 分类**。`looksLikeRawFailureText` 只用于 **没有 Projection** 时的 fallback——即 raw backend response 的 failure summary 甄别，不用于 Projection text。这把信任边界从 "status + text heuristic 双重检查" 简化为 "status 是唯一信任信号"，消除所有 text heuristic 误判（URL、关键词、JSON fragment）的根因。

Todo：

- [x] 重构 `projectionVisibleAnswer`：只要 `status` 存在且不是 `undefined/null`，直接返回 `{ status, text }`，不做 `looksLikeRawFailureText` 检查。
- [x] `looksLikeRawFailureText` 仅用于 `projectionVisibleAnswer` 返回 `undefined`（即无 Projection 或无 status）时的 fallback chain。
- [x] 增加 targeted test：satisfied Projection visibleAnswer 含 `https://doi.org/...` URL → 不被丢弃，返回 `{ status: 'satisfied', text: ... }`。
- [x] 增加 targeted test：satisfied Projection visibleAnswer 含统计 "standard error" → 不触发 `looksLikeRawFailureText` 的 error 关键词误判。
- [x] 增加 targeted test：无 Projection 的 raw backend response → `looksLikeRawFailureText` 正常甄别 failure。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` 中 Projection-only UI 章节，明确 status-first trust model：Projection status 是唯一信任信号，UI 不对 Projection text 做 heuristic 分类。

验收标准：

- [x] Projection visibleAnswer 的信任决策只看 status 字段，不看 text heuristic。
- [x] 科学回答含 DOI/citation URL 时 UI 主结果显示 Projection answer，不显示"后端运行未完成"。
- [x] `looksLikeRawFailureText` 仅用于无 Projection 的 fallback 场景。
- [x] `SciForge-SingleAgent-Architecture.md` 已同步更新 status-first trust model 描述。

### ARC-P003 UI 不做 mode 决策，Python policy 为唯一 mode authority

状态：已完成；当前系统有 **两个独立 mode 决策者**：(1) UI transport 的 `buildTransportContextReusePolicy` 在发送请求之前决定 `mode='fresh'/'continue'/'repair'`；(2) Python policy 在收到请求之后决定 `taskRelation` 和 `executionMode`。两者可以冲突：UI 因 ref title 含 "Diagnostic accuracy of MRI..." 触发 `mode='repair'`，Python 因无真实 failure refs 返回 `mode='continue'`，gateway 用 Python 结果覆盖 UI 结果——但 request payload 的上下文选择已按 repair 模式构建。更根本的修法是 UI 不做 mode 决策，只发送原始 session 状态，Python policy 作为唯一 authority 产出 typed `ContextReusePolicy`，gateway 直接应用。

此任务同时解决原 ARC-P003（ref title regex repair trigger）、ARC-P006（bounded-stall 合成 Projection）和 ARC-P007（contextReusePolicy/contextIsolation 双写）：UI 不需要知道 mode，就不需要伪造 Projection 来暗示 mode，也不需要双写 alias。

设计文档违规：C06（Pipeline executor 无业务条件分支）+ Architecture.md "repair mode 只由 Projection 中有效 RecoverAction 或同 session failureRef 触发" + AgentHarnessStandard "conversation policy 是 harness 的输入之一，不是最终决策者"。

Todo：

- [x] UI transport `buildTransportContextReusePolicy` 改为只发送原始 session 状态（有哪些 runs、哪些 projections、用户选了哪些 refs），不产出 mode 字段。
- [x] Python policy 作为唯一 mode authority 产出 typed `ContextReusePolicy`，gateway 在 `apply.ts` 直接应用。
- [x] 删除 `currentProjectionRepairTargetAvailable` 中对 ref title/summary 的 regex scan。
- [x] `boundedStallRecoveryResponse` 不合成 `conversationProjection`，改为写入 bounded-stall marker event（status=`background-running`），下一轮 Python policy 按正常 `continue` 处理。
- [x] 统一为 `contextReusePolicy` 单一字段，删除 `contextIsolation` alias 和双写行。
- [x] 增加 targeted test：(a) 文献引用标题含 "Diagnostic accuracy" → 不触发 repair mode；(b) bounded-stall 后 session 不含伪造 Projection；(c) context reuse mode 只从 `contextReusePolicy` 读取，不 fallback 到 `contextIsolation`。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/Architecture.md` 请求链路章节，明确 UI 只发送 session 状态、Python policy 是唯一 mode authority 的架构边界。同步更新 `docs/SciForge-SingleAgent-Architecture.md` Context Reuse Policy 章节，删除 "UI 决定 mode" 的描述（如有）。同步更新 `docs/AgentHarnessStandard.md` conversation policy 与 harness 关系章节。

验收标准：

- [x] `contextReusePolicy.mode` 只由 Python policy 决定，UI 不写入 mode。
- [x] UI transport 无 ref title/summary regex scan、无合成 Projection、无 `contextIsolation` 双写。
- [x] Bounded-stall marker 不被 Python policy 当成 backend terminal Projection。
- [x] 文献引用标题含 "diagnostic"/"failed" 不影响 mode。
- [x] `Architecture.md`、`SingleAgent-Architecture.md`、`AgentHarnessStandard.md` 已同步更新 mode authority 边界描述。

#### ARC-P1 — 影响多轮速度和稳定性的架构违规

### ARC-P004 answer-only transform 归入 harness L1 hook

状态：已完成；`direct-context-fast-path.ts:448–452` 用三段 regex (`compress|summari[sz]e|...` AND `previous|prior|...` AND NOT `rerun|execute|...`) 判断 answer-only transform。按 Harness Standard L1，intentMode 是 harness profile 的 classify intent hook 决策，不是 Python policy 直接决策或 prompt regex 匹配。answer-only transform 判断应归入 harness L1 hook，hook 输入包括 Python policy 的结构化信号和 session refs，输出是 `DirectContextDecision.transformMode`。

设计文档违规：C06 + AgentHarnessStandard L1 "classify intent → select profile → select context" + "新增行为策略必须先写 callback/profile，不能先改 prompt string"。

改进点：比原方案 "Python policy 新增 transformMode 字段" 更正确——按 Harness Standard，transformMode 是 harness hook 的局部输出（HarnessDecision），不是 Python policy 的全局输出。Python policy 提供信号（如 `executionMode`、`contextOnly` flag、`turnExecutionConstraints`），harness hook 在这些信号基础上做 transformMode decision。

Todo：

- [x] Harness profile 新增 `classifyDirectContextTransform` L1 hook，输入为 Python policy 信号（`executionMode`、`contextOnly`、`turnExecutionConstraints`）和 session refs，输出为 `DirectContextDecision.transformMode`（值：`answer-only-compress`/`answer-only-summary`/`answer-only-checklist`/`none`）。
- [x] TS gateway `direct-context-fast-path.ts` 从 `DirectContextDecision.transformMode` 读取，不再对 prompt 做 regex。
- [x] 当前 regex 保留为 legacy fallback（仅当 harness hook 未产出 decision 时），标注为 baseline 并在 `check-no-legacy-paths` 跟踪。
- [x] 增加 targeted test：harness hook 返回 `transformMode='answer-only-compress'` → TS 不执行 prompt regex → 直接使用 transform。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/AgentHarnessStandard.md` L1 hooks 章节，新增 `classifyDirectContextTransform` hook 描述和 decision schema。

验收标准：

- [x] Answer-only transform 类型来自 harness L1 hook decision，不来自 Python policy 直接输出或 prompt regex。
- [x] Legacy regex fallback 仅在 hook 未产出 decision 时触发，且被 no-legacy-paths baseline 跟踪。
- [x] 新增 transform 类型（如 `answer-only-timeline`）只需修改 harness profile hook，不需修改 TS gateway regex。
- [x] `AgentHarnessStandard.md` 已同步更新 L1 hook 列表和 decision schema。

### ARC-P005 summary intent 归入 harness L1 hook

状态：已完成；`direct-context-fast-path.ts:479` — `riskSummaryAnswer` 只识别 "risk" 主题，`methodSummaryAnswer` 等其他领域无法扩展。按 Harness Standard，领域 intent 分类是 harness profile 的 classify intent hook 决策，不应硬编码在 TS gateway。

设计文档违规：C06 + Architecture.md "所有修改必须通用、可泛化" + AgentHarnessStandard L1。

Todo：

- [x] Harness profile 新增 `classifyDirectContextIntent` L1 hook，输入为 Python policy 信号和 session refs，输出为 `DirectContextDecision.intent`（值：`context-summary:risk`/`context-summary:method`/`context-summary:timeline`/`run-diagnostic`/`artifact-status`）。
- [x] TS fast path 只根据 intent 字段选择 template，不再用 prompt regex 识别领域。
- [x] 增加 targeted test：intent=`context-summary:method` → 使用 method summary template；intent=`context-summary:risk` → 使用 risk summary template。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/AgentHarnessStandard.md` L1 hooks 章节，新增 `classifyDirectContextIntent` hook 描述。

验收标准：

- [x] Summary intent 类型来自 harness L1 hook decision，不来自 prompt regex。
- [x] 新增领域 summary 只需修改 harness profile hook，不需修改 TS regex。
- [x] `direct-context-fast-path.ts` 不含领域硬编码分支。
- [x] `AgentHarnessStandard.md` 已同步更新 L1 hook 列表。

### ARC-P006 intent keyword 归入 harness profile 配置

状态：已完成；`goal_snapshot.py` 15+ regex 常量（`REPORT_HINTS`、`VISUAL_HINTS`、`CONTINUE_HINTS`、`ANSWER_ONLY_TRANSFORM_HINTS` 等）全部是 Python 代码内 compiled pattern。按 Harness Standard，intent classification 是 harness L1 hook 决策，关键词只是 hook 的一个输入信号，不应独立成 manifest——否则关键词和 harness profile 的 weight/threshold/budget 配置脱节。

改进点：比原方案 "独立 intent-keywords.v1.json manifest" 更符合 Harness Standard——关键词 list 归入 harness profile 配置（每个 profile 有自己的 intent keyword map + weight table），不同 profile（balanced-default / latency-first / deep-research）可以有不同的关键词权重和触发阈值。

Todo：

- [x] 将关键词 list 归入 harness profile 配置（每个 profile 有 `intentKeywordMap` 字段，包含各 intent 类型的 keyword list、language tag 和 weight）。
- [x] Python `goal_snapshot.py` 从当前 active profile 的 keyword map 加载 regex，不再硬编码。
- [x] 不同 harness profile 可以有不同的关键词权重和触发阈值。
- [x] 增加 targeted test：profile A 的 keyword map 包含领域 X → policy 自动加载；profile B 无领域 X → 不触发对应 intent。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/AgentHarnessStandard.md` HarnessProfile 章节，新增 `intentKeywordMap` 配置字段描述和 schema。同步更新 `docs/Architecture.md` Python vs TypeScript 职责分工章节，明确关键词归入 profile 配置。

验收标准：

- [x] Intent keyword regex 从 harness profile 配置加载，不在 Python 代码内硬编码。
- [x] 新增触发词只需修改 profile 配置，不需改 policy 源码。
- [x] 不同 profile 可有不同关键词权重和触发阈值。
- [x] `AgentHarnessStandard.md` 和 `Architecture.md` 已同步更新 profile 配置 schema。

### ARC-P007 `_direct_context_decision` 结构化负面 decision + 单一 canonical key

状态：已完成；当 direct-context 条件不满足时，`service.py:_direct_context_decision` 返回 `{}`。TS gateway 无法区分 "不适用"、"适用但证据缺失" 和 "未被评估"。另外，`direct-context-fast-path.ts` 搜索三个 key path（`uiState.directContextDecision`、`uiState.conversationPolicy.directContextDecision`、`uiState.conversationPolicy.executionModePlan.directContextDecision`）来找 DirectContextDecision，Python 和 TS 对 decision 存放位置没有统一约定。

设计文档违规：Architecture.md "Contract 是可信边界" + C16 "direct context gated（必须有 decision ref 和 supporting refs）" + Architecture.md "代码路径保持唯一真相源"。

Todo：

- [x] 改为返回结构化负面 decision：`{sufficiency: "insufficient", reason: "no-prior-context" | "evidence-missing" | "execution-not-forbidden", allowDirectContext: False}`。
- [x] 定义单一 canonical key（建议 `uiState.conversationPolicy.harnessContract.directContextDecision`，为 ARC-P016 Phase 1 做准备），Python 和 TS 都只写/只读这个 key。
- [x] 删除三路 fallback search。
- [x] 增加 targeted test：(a) no prior context → reason="no-prior-context"；(b) prior context but no constraint → reason="execution-not-forbidden"；(c) constraint but missing refs → reason="evidence-missing"；(d) TS 只从 canonical key 读取，不 fallback 到其他 path。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` direct-context 章节，明确单一 canonical key 和结构化负面 decision schema。同步更新 `docs/Architecture.md` LLM-gated direct context 章节。

验收标准：

- [x] `directContextDecision` 不返回空 dict `{}`，所有路径返回结构化 decision。
- [x] TS gateway 只从单一 canonical key 读取 DirectContextDecision，无 fallback search。
- [x] Audit trace 可区分三种负面原因。
- [x] C16 direct-context gate 完整覆盖。
- [x] `SingleAgent-Architecture.md` 和 `Architecture.md` 已同步更新 DirectContextDecision canonical key 和 schema。

### ARC-P008 Gateway 对 policy output 做 typed validation before consuming

状态：已完成；当前 gateway 的 `uiState.conversationPolicy` 整体是 `Record<string, unknown>`，所有下游消费者用 string key 读取（`uiState.conversationPolicy.executionMode`、`uiState.conversationPolicy.applicationStatus` 等）。gateway 无法在 compile-time 保证 policy 输出符合预期 schema。这是 `GoalSnapshot` 只有 4 字段但实际 15+ 字段、`DirectContextDecision` 三路 fallback search、`executionModeDecision` 弱类型 record 等问题的共同根因。

设计文档违规：Architecture.md "Contract 是可信边界" + "设计和实现保持同一真相源" + C06 "Pipeline executor 无业务条件分支"。

Todo：

- [x] 定义 TS `ConversationPolicyApplication` interface（匹配 Python `ConversationPolicyResponse` dataclass 的完整 schema），包含 `goalSnapshot`/`contextPolicy`/`executionModePlan`/`capabilityBrief`/`handoffPlan`/`latencyPolicy`/`directContextDecision`/`recoveryPlan`/`currentReferences`/`recentFailures` 全部 typed 字段。
- [x] Gateway 在 `apply.ts` 中先验证 policy response 是否符合 `ConversationPolicyApplication` interface（runtime shape check），验证通过后才写入 `uiState`，验证失败时走 `policyFailureAllowsTransportContinuation` 路径。
- [x] 删除下游对 `uiState.conversationPolicy.*` 的 string key 散读，改为 typed field 读取。
- [x] 增加 targeted test：(a) policy 输出缺 `executionMode` → validation 失败 → fallback 路径；(b) policy 输出完整 → typed 读取成功；(c) 下游不使用 string key 散读。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` Runtime Bridge 章节，明确 gateway 对 policy output 做 typed validation 的边界。同步更新 `docs/Architecture.md` Runtime Bridge 职责描述。

验收标准：

- [x] Policy response 在 gateway 消费前经过 typed shape validation。
- [x] 下游消费者使用 typed interface 读取，不散读 string key。
- [x] Validation 失败时有可观测的 audit trace 和 graceful fallback。
- [x] `SingleAgent-Architecture.md` 和 `Architecture.md` 已同步更新 typed validation boundary。

### ARC-P009 Pipeline stage names 常量 + audit trace

状态：已完成；`runWorkspaceRuntimeGateway` 是 8 个 `if (payload) return` 的 sequential waterfall，没有显式 stage names。新增 intercept 需要知道精确位置。这不符合 Harness Standard L0-L7 hooks as declared lifecycle 的方向。

设计文档违规：AgentHarnessStandard "Runtime declares critical, audit, external hook stages without overlap" + Architecture.md "Pipeline executor 无业务条件分支"。

改进点：不做 big-bang pipeline registry migration，先做 **声明式 stage names**——给每个 `if` block 一个 `STAGE_*` 常量名和 audit trace entry，让 pipeline 的执行顺序可观测。这为未来迁移到 declared registry 做准备，但当前不改 execution 逻辑。

Todo：

- [x] 给 `runWorkspaceRuntimeGateway` 的每个 early-return gate 定义 `STAGE_*` 常量名（如 `STAGE_PROVIDER_PREFLIGHT`、`STAGE_DIRECT_CONTEXT`、`STAGE_EXECUTION_FORBIDDEN`、`STAGE_VISION_SENSE`、`STAGE_DISPATCH_FORBIDDEN`、`STAGE_AGENTSERVER_DISPATCH`）。
- [x] 每个 gate 进入时写入 audit trace entry（stage name + 是否短路返回 + payload summary）。
- [x] 当前不改 execution 逻辑，只增加可观测性。
- [x] 增加 targeted test：gateway 执行时 audit trace 包含 stage name sequence，可追溯实际执行路径。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/AgentHarnessStandard.md` L0 Runtime Lifecycle 章节，新增 pipeline stage name 常量列表和 audit trace schema。

验收标准：

- [x] 每个 gate 有 `STAGE_*` 常量名和 audit trace entry。
- [x] Gateway 执行路径可从 audit trace 追溯。
- [x] 不改 execution 逻辑，只增加可观测性。
- [x] `AgentHarnessStandard.md` 已同步更新 stage name 常量列表。

#### ARC-P2 — 影响长期可扩展性和准确性

### ARC-P010 tool manifest 自行声明 requiredCapabilities

状态：已完成；`capability-provider-preflight.ts:83–91` 只有 7 个 hardcoded tool→capability 映射（`REQUIRED_BY_TOOL_ID`）。新 tool 必须手动修改静态 map。

设计文档违规：Architecture.md "新增 tool 的最小接入闭环是 CapabilityManifest → ProviderManifest" + "所有修改必须通用"。

Todo：

- [x] `CapabilityManifest` 增加 `requiredCapabilities: string[]` 字段。
- [x] Tool manifest 自行声明其 capability 需求。
- [x] Preflight 从 manifest 读取 `requiredCapabilities`，不再查静态 map。
- [x] 删除 `REQUIRED_BY_TOOL_ID` 静态 map。
- [x] 增加 targeted test：新 tool manifest 声明 `requiredCapabilities: ['web_search']` → preflight 自动识别，不需修改代码。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` Capability Gateway 章节，明确 CapabilityManifest.requiredCapabilities 字段。同步更新 `docs/Architecture.md` 四层工具生态章节。

验收标准：

- [x] Tool→capability 映射由 manifest 字段声明，不在代码内硬编码。
- [x] 新 tool 只需声明 manifest 字段，不需改 preflight 源码。
- [x] `REQUIRED_BY_TOOL_ID` 静态 map 已删除。
- [x] `SingleAgent-Architecture.md` 和 `Architecture.md` 已同步更新 CapabilityManifest schema。

### ARC-P011 删除 prompt text capability scan

状态：已完成；`capability-provider-preflight.ts:258–266` 扫描 prompt 中的 capability ID 字符串。用户在 status question 中提到 "web_search" 会错误地添加为 required capability。当 ARC-P010 完成后，capability 需求有三个结构化来源，prompt text scan 应完全删除。

设计文档违规：C06（Pipeline executor 无业务条件分支）+ Architecture.md "Capability-first 执行约束，prompt 不能做 routing"。

Todo：

- [x] Capability 需求只来自三个结构化来源：(a) `DirectContextDecision.requiredCapabilities`、(b) Python policy `executionModePlan`、(c) tool manifest `requiredCapabilities`。
- [x] 删除 `explicitCapabilityIdsFromPrompt` prompt text scan path。
- [x] 增加 targeted test：用户 prompt 含 "web_search" 但 policy/manifest 未声明 → 不添加为 required capability。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` Capability Gateway 章节，明确 capability 需求只来自结构化来源。同步更新 `docs/Architecture.md` Capability-first 执行约束章节。

验收标准：

- [x] Capability routing 不依赖 prompt text scan。
- [x] 用户文本中的 capability 关键词不影响 routing。
- [x] Capability 需求只来自结构化 policy/manifest/decision。
- [x] 设计文档已同步更新 capability 需求来源边界。

### ARC-P012 ConversationMode 统一为 4 值

状态：已完成；`contracts.py` 的 `ConversationMode` 包含 8 值（4 个 snake_case 旧值 + 4 个新值），下游需处理全部 8 种情况。

设计文档违规：Architecture.md "不需要保护旧兼容行为" + "代码路径保持唯一真相源"。

Todo：

- [x] 一次性迁移到 4 值：`fresh`/`continue`/`repair`/`isolate`。
- [x] 删除 `new_task`/`continue_previous`/`repair_previous`/`ambiguous` 旧 alias。
- [x] TS 侧同步更新 enum，删除旧值 fallback。
- [x] 增加 targeted test：policy 输出只有 4 种 mode 值；下游只处理 4 种值。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` Context Reuse Policy 章节，统一为 4 值描述。同步更新 `docs/AgentHarnessStandard.md` 中引用 mode 的章节。

验收标准：

- [x] `ConversationMode` 只有 4 个值，无旧 alias。
- [x] TS/Python 两侧 enum 一致，无 fallback chain。
- [x] 无新旧混合歧义。
- [x] 设计文档已同步更新为 4 值。

### ARC-P013 Policy response typed boundary（含 GoalSnapshot）

状态：已完成；`contracts.py` 的 `GoalSnapshot` dataclass 只有 4 字段（text, mode, explicitRefs, acceptanceHints），但 `goal_snapshot.py:build_goal_snapshot` 返回 15+ 字段。`ConversationPolicyResponse` 的多个字段（`goalSnapshot`、`contextPolicy`、`executionModePlan`、`directContextDecision`）是 `JsonMap`。TS gateway 没有 compile-time 类型保证。这是 ARC-P008 (gateway typed validation) 的上游前提——policy 输出端必须先有完整 dataclass，gateway 才能做 shape validation。

设计文档违规：Architecture.md "Contract 是可信边界" + "设计和实现保持同一真相源"。

Todo：

- [x] 将 `GoalSnapshot` dataclass 扩展为完整 `build_goal_snapshot` 输出 schema，包含 `taskRelation`/`goalType`/`requiredFormats`/`requiredReferences`/`referencePolicy`/`turnExecutionConstraints`/`freshness` 等全部字段。
- [x] `ConversationPolicyResponse.goalSnapshot` 从 `JsonMap` 改为 typed `GoalSnapshot`。
- [x] `ConversationPolicyResponse.contextPolicy` 从 `JsonMap` 改为 typed `ContextPolicy`。
- [x] `ConversationPolicyResponse.directContextDecision` 定义为 typed dataclass（含 ARC-P007 的结构化负面 decision）。
- [x] TS 侧新增对应 TypeScript interface，保证 compile-time 类型检查。
- [x] 增加 targeted test：Python policy 返回 typed response → TS gateway 可按 typed field 读取，无需 `isRecord` 判断。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/SciForge-SingleAgent-Architecture.md` Runtime Bridge 章节，明确 ConversationPolicyResponse typed schema。同步更新 `docs/Architecture.md` Python vs TypeScript 职责分工，明确 dataclass 与 TS interface 对齐要求。

验收标准：

- [x] `GoalSnapshot` dataclass 包含 `build_goal_snapshot` 全部字段。
- [x] `ConversationPolicyResponse` 核心字段（`goalSnapshot`/`contextPolicy`/`directContextDecision`）是 typed，不是 `JsonMap`。
- [x] TS gateway 有 compile-time 类型保证。
- [x] 设计文档已同步更新 policy response typed schema。

### ARC-P014 HarnessContract 合一 phased (3 phase)

状态：Phase 1 已完成，Phase 2/3 待办；设计文档声明 "HarnessContract 是本轮唯一行为契约"，但当前代码中 context builder、broker、prompt renderer 各自独立推断行为，没有一个统一的 HarnessContract 对象被所有下游消费者共享。

设计文档违规：AgentHarnessStandard "Runtime owns lifecycle and enforcement. Harness owns decisions." + Architecture.md "所有修改必须通用"。

改进点：原方案 "一次性合并" 风险太大。改为 **三阶段渐进合并**，每阶段可独立验证。

Todo：

**Phase 1 — 输出端合并（Python policy）**：
- [x] `ConversationPolicyResponse` 新增 `harnessContract` 字段，包含 `executionModePlan + contextPolicy + capabilityBrief + handoffPlan + latencyPolicy + directContextDecision` 的合集。
- [x] 各独立字段仍保留（双写过渡期），不改 downstream 消费者。
- [x] 增加 targeted test：`harnessContract` 字段包含所有子字段的合集，digest 可 replay。
- [ ] `verify:single-agent-final` 全绿。

**Phase 2 — TS downstream 逐步迁移**：
- [ ] 每个 downstream 消费者改为从 `harnessContract` 读取，删除对 `uiState.*` 散读的依赖。
- [ ] 按模块逐个迁移，每步跑 `verify:single-agent-final`。
- [ ] 迁移完成后，`uiState.*` 散读 key 不再被任何 downstream 使用。

**Phase 3 — 删除双写，HarnessContract 成为唯一 truth source**：
- [ ] Python policy 只写 `harnessContract`，不再双写独立字段。
- [ ] `ConversationPolicyResponse` 删除 `executionModePlan`/`contextPolicy`/`capabilityBrief`/`handoffPlan`/`latencyPolicy` 独立顶层字段（全部在 `harnessContract` 内）。
- [ ] `uiState.*` 散读 key 删除，所有 downstream 只从 `uiState.harnessContract` 读取。
- [ ] `verify:single-agent-final` 全绿。

- [ ] 同步更新 `docs/AgentHarnessStandard.md` HarnessContract 章节，明确 phased 合一路径和最终 schema。同步更新 `docs/Architecture.md` harness-governed 方向章节。同步更新 `docs/SciForge-SingleAgent-Architecture.md` Runtime Bridge 和 Capability Gateway 章节。

验收标准：

- [x] Phase 1：`harnessContract` 字段存在且 digest 可 replay，各独立字段仍保留。
- [ ] Phase 2：所有 downstream 从 `harnessContract` 读取，不散读 `uiState.*`。
- [ ] Phase 3：独立顶层字段删除，`harnessContract` 是唯一 truth source。
- [ ] 设计文档在每个 Phase 完成后同步更新。

### ARC-P015 DirectContextDecision 单一 canonical key

状态：已完成；`direct-context-fast-path.ts` 搜索三个 key path 来找 DirectContextDecision（`uiState.directContextDecision`、`uiState.conversationPolicy.directContextDecision`、`uiState.conversationPolicy.executionModePlan.directContextDecision`）。Python 和 TS 对 decision 存放位置没有统一约定。

此任务已纳入 ARC-P007 Todo，独立列出以明确验收标准。

设计文档违规：Architecture.md "代码路径保持唯一真相源" + C16。

Todo：

- [x] 定义单一 canonical key：`uiState.conversationPolicy.harnessContract.directContextDecision`（为 ARC-P014 Phase 1 做准备）。
- [x] Python `service.py` 和 TS `direct-context-fast-path.ts` 都只写/只读这个 key。
- [x] 删除三路 fallback search 和其他 key path 写入。
- [x] 增加 targeted test：TS 只从 canonical key 读取，不 fallback 到其他 path。
- [ ] `verify:single-agent-final` 全绿。

验收标准：

- [x] DirectContextDecision 只有单一 canonical key。
- [x] 无三路 fallback search。
- [x] Python 和 TS 写/读路径一致。

### ARC-P016 Pipeline stage declared registry（长期方向）

状态：已完成；`runWorkspaceRuntimeGateway` 的 8 个 `if (payload) return` sequential waterfall 不符合 Harness Standard L0-L7 hooks as declared lifecycle 的方向。ARC-P009 先做 stage names 常量 + audit trace 增加可观测性；ARC-P016 是长期方向，将 waterfall 改为 declared stage registry，每个 stage 有显式 input/output contract。

设计文档违规：AgentHarnessStandard "Runtime declares critical, audit, external hook stages without overlap" + Architecture.md "Pipeline executor 无业务条件分支"。

Todo：

- [x] 前置条件：ARC-P009（stage names 常量）完成。
- [x] 定义 `GatewayPipelineStage` interface：`{ name: string; execute: (input) => Payload | undefined; auditTrace: StageAuditEntry }`。
- [x] 将当前 waterfall 的每个 `if` block 注册为 `GatewayPipelineStage`。
- [x] Pipeline runner 按声明顺序执行 stages，early-return 由 stage output 决定。
- [x] 每个阶段可独立测试和替换。
- [x] 增加 targeted test：pipeline 执行顺序可从 declared registry 追溯；新增 stage 只需注册，不需手动插入 waterfall。
- [ ] `verify:single-agent-final` 全绿。
- [x] 同步更新 `docs/AgentHarnessStandard.md` L0 Runtime Lifecycle 章节，明确 declared pipeline stage registry 和 `GatewayPipelineStage` interface。同步更新 `docs/SciForge-SingleAgent-Architecture.md` Runtime Bridge 章节，明确 pipeline 是 declared stage 而非 hardcoded waterfall。

验收标准：

- [x] Pipeline stages 是 declared registry，不是 hardcoded waterfall。
- [x] 新增 intercept 只需注册 stage，不需手动插入 `if` block。
- [x] 每个阶段有显式 input/output contract。
- [x] Audit trace 自动记录所有 stage 的执行顺序和结果。
- [x] 设计文档已同步更新 declared pipeline registry 架构。

### 并行进程矩阵

每个调试进程独立启动一套端口、workspace、state 和 config。建议 4 个进程同时跑，必要时继续向后加 `P5/P6`。

| 进程 | 目标 | UI | Workspace Writer | AgentServer | Workspace Path | State Dir | Config Path |
|---|---|---:|---:|---:|---|---|---|
| P1 | fresh/continue speed baseline | 5173 | 5174 | 18080 | `workspace/parallel/p1` | `.sciforge/parallel/p1` | `.sciforge/parallel/p1/config.local.json` |
| P2 | provider/tool latency + fail-closed | 5273 | 5274 | 18180 | `workspace/parallel/p2` | `.sciforge/parallel/p2` | `.sciforge/parallel/p2/config.local.json` |
| P3 | repair bounded-stop + failure recovery | 5373 | 5374 | 18280 | `workspace/parallel/p3` | `.sciforge/parallel/p3` | `.sciforge/parallel/p3/config.local.json` |
| P4 | refresh/reopen + artifact selection | 5473 | 5474 | 18380 | `workspace/parallel/p4` | `.sciforge/parallel/p4` | `.sciforge/parallel/p4/config.local.json` |

启动模板：

```bash
SCIFORGE_INSTANCE=p2 \
SCIFORGE_INSTANCE_ID=p2 \
SCIFORGE_UI_PORT=5273 \
SCIFORGE_WORKSPACE_PORT=5274 \
SCIFORGE_AGENT_SERVER_PORT=18180 \
SCIFORGE_WORKSPACE_PATH=workspace/parallel/p2 \
SCIFORGE_STATE_DIR=.sciforge/parallel/p2 \
SCIFORGE_LOG_DIR=.sciforge/parallel/p2/logs \
SCIFORGE_CONFIG_PATH=.sciforge/parallel/p2/config.local.json \
SCIFORGE_WORKSPACE_WRITER_URL=http://127.0.0.1:5274 \
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18180 \
npm run dev
```

如果本机模型/AgentServer 太重，可以共享一个 AgentServer，但必须仍隔离 UI/workspace/state，并显式记录：

```bash
SCIFORGE_AGENT_SERVER_AUTOSTART=0
SCIFORGE_AGENT_SERVER_URL=http://127.0.0.1:18080
```

### P1-P4 并行 Todo 分工

### Process P1 Fresh / Continue / Fast First Result

状态：进行中；认领 `PBT-001`, `PBT-002`, `PBT-004`, `MTG-001`, `MTG-004`, `MTG-005`, `P1-MT-001`, `P1-MT-002`, `P1-MT-003`。P1 已完成 fresh no-exec -> answer-only continuation 的真实 in-app browser 复验；fresh/continue 均 `satisfied`，answer-only follow-up 走 direct continuation，Projection 与 persisted response 口径一致。MTG-001 selected-ref/reload 主线仍待后续继续推进。

调试环境：仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5173/`，Workspace Writer `http://127.0.0.1:5174`，AgentServer `http://127.0.0.1:18080`，workspace `workspace/parallel/p1`，state `.sciforge/parallel/p1`，config `.sciforge/parallel/p1/config.local.json`。

Todo：

- [x] 用 in-app browser 打开 `http://127.0.0.1:5173/`，重跑 fresh no-exec、fresh normal answer、continue from Projection 三条路径。
- [x] 记录 timings：send -> first visible progress、send -> first backend event、send -> terminal Projection、send -> readable answer。
- [x] 验证 fresh 首轮没有旧 failure/ref/current work，continue 显示 `intent=continuation` 且只带 bounded Projection refs。
- [x] 超过 3s 首个可见状态或超过 60s terminal Projection 的路径已写入 Issue Queue，并归因到 policy / transport / runtime / AgentServer / Projection / UI hydrate。
- [x] 跑 `MTG-001` Golden Path 主线首版：fresh 成功结果 -> selected-ref follow-up；selection/reload 边界移交 P4 复验。
- [x] 修复 `P1-MT-001` / `P1-MT-002`：answer-only follow-up 不进 generated workspace task，persisted response 与 Projection 可见答案一致。
- [x] 将 `P1-MT-003` 与 `MTG-005` 合并为可读 timing/evidence manifest。

验收标准：

- [x] P1 browser evidence `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`。
- [x] `ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- [x] 所有失败都带 root boundary 和下一步修复任务。

### Process P2 Provider / Tool / Capability-First

状态：进行中；认领 `PBT-005`, `MTG-003`, `P2-MT-001`..`P2-MT-010`。P2 已更正 workspace isolation，建立 runtime-visible-state/test hook，并完成 provider preflight、helper contract、empty/unavailable helper execution contract 和 raw leak 防护的部分基线；ready provider browser golden path 仍被 backend 生成直连网络代码阻断，已写 Issue Queue。

调试环境：仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5273/`，Workspace Writer `http://127.0.0.1:5274`，AgentServer `http://127.0.0.1:18180`，workspace `workspace/parallel/p2`，state `.sciforge/parallel/p2`，config `.sciforge/parallel/p2/config.local.json`。

Todo：

- [x] 更正 P2 browser workspace：`http://127.0.0.1:5273/` 使用 `workspace/parallel/p2` 和 `.sciforge/parallel/p2`。
- [x] 检查 backend prompt / generated task 是否使用 `sciforge_task.invoke_capability` 或等价 helper，禁止 raw network / worker endpoint 直连。
- [x] Provider unavailable 快速返回 Projection-visible failed-with-reason / needs-human，不进入长时间 AgentServer 自循环。
- [x] DOM/request/run raw 不泄漏 endpoint、auth、worker private path，只暴露 public provider summary 和 refs。
- [x] 增加 `data-testid="runtime-visible-state"`，可读 run/session/status/projection/timing/raw-leak。
- [x] 跑 `P2-MT-006` ready provider browser path，确认 generated task 收到完整 helper/API 签名和 adapter skeleton；当前阻断为 backend strict retry 仍绕过 helper 生成 `urllib`/`socket`，runtime preflight fail-closed 到 Projection-visible `repair-needed`。
- [x] 实现 `P2-MT-007` public outcome continuation。
- [x] 补 `P2-MT-008` controlled unavailable helper execution fixture：provider invocation 失败时 generated task 只写 failed-with-reason ToolPayload，不回落到 direct network。
- [x] 补 `P2-MT-009` empty provider terminal contract：empty provider output 写 terminal empty-result ToolPayload，带 recover/refine action 和 public route ref。
- [x] Ready provider 首轮 `satisfied` 后连续追问两轮：解释/引用 provider refs；生成或更新 artifact。
- [x] Provider unavailable 后执行 recover action 或切换可用 route，下一轮不得继承 raw stdout/stderr、endpoint、旧 run body。
- [x] Empty provider result 后做 query refinement，重新走 ProviderManifest / route resolver / Gateway.execute。
- [x] Reload/reopen provider terminal session，验证 ready/unavailable/empty 三类结果恢复。

验收标准：

- [x] P2 多轮 evidence 写回 Issue Queue 或 Verified，包含 URL、run id、session id、prompt/task、DOM evidence、console/network summary 和 timing。
- [x] 每轮记录 `TaskSuccess`、`UsefulPartial`、`BlockingTruth`、`MultiturnContinuity`、`ProjectionWaitAtTerminal`、`RawLeak`。
- [x] Provider/tool 成功与 unavailable/empty blocker 都来自通用 route/contract，不写 provider、prompt 或端口特例。

### Process P3 Repair / Bounded Recovery

状态：进行中；认领 `PBT-003`, `PBT-006`, `PBT-010`, `MTG-002`。P3 已修复主结果真相源、repair trigger、corrected PBT-010 workspace evidence 和 duplicate-key console warning，但还需要把 Golden Path gate 升级为准确回答语义。

调试环境：仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5373/`，Workspace Writer `http://127.0.0.1:5374`，AgentServer `http://127.0.0.1:18280`，workspace `workspace/parallel/p3`，state `.sciforge/parallel/p3`，config `.sciforge/parallel/p3/config.local.json`。

Todo：

- [x] 用 in-app browser 打开 `http://127.0.0.1:5373/`，制造 provider/schema/validation failure，再点 recover 或输入 repair follow-up。
- [x] 验证 repair mode 不由 prompt 关键词单独触发。
- [x] 验证 repair handoff refs/digests-only，不携带 raw artifact/log body。
- [x] 重复失败、silent stream、token guard 或 bounded-stop 时，必须返回最小 Projection recover action。
- [x] 在 P3 环境跑 Multiturn Browser Golden Path Gate 第一版：fresh artifact -> reload restore -> context-only follow-up -> selected artifact follow-up。
- [x] 为 direct-context-first 增加真实 browser 验收：current Projection/ArtifactDelivery refs 足够时直接回答，不启动 AgentServer。
- [x] 把前台结果和慢后台任务解耦成可验收策略：已有可读 Projection 时允许 `background-running`，缺少真实 blocker 时不得伪装失败。
- [x] 为每条 Golden Path 输出 evidence manifest，并补 `AnswerQuality=accurate` 校验。

验收标准：

- [x] Terminal 等待 Projection、raw body 主结果泄漏、direct-context sufficient 仍 dispatch、summary follow-up 只列 refs、synthetic wait 延长 stall 时，必须进入 Issue Queue。
- [x] P3 evidence `TaskSuccess=true` 必须证明回答准确，而不只是 Projection/restoration 边界通过。
- [x] 所有修复归因到 Projection terminal、context handoff、repair policy、bounded stop、UI recover action 或 ArtifactDelivery 边界。

### Process P4 Restore / Artifact Selection / Audit Boundary

状态：进行中；认领 `PBT-007`, `PBT-008`, `PBT-009`, `MTG-006`。P4 已捕获 restore/selection/audit/final evidence gate 边界证据，但这些证据目前不能单独证明 Golden Path 准确回答成功。

调试环境：仓库 `/Applications/workspace/ailab/research/app/SciForge`，Browser `http://127.0.0.1:5473/`，Workspace Writer `http://127.0.0.1:5474`，AgentServer `http://127.0.0.1:18380`，workspace `workspace/parallel/p4`，state `.sciforge/parallel/p4`，config `.sciforge/parallel/p4/config.local.json`。

Todo：

- [x] 用 in-app browser 打开 `http://127.0.0.1:5473/`，生成 terminal Projection 后 reload/reopen。
- [x] 验证刷新后右侧主结果、recover actions、artifact refs 从 persisted Projection 恢复。
- [x] 点击旧 artifact，确认它进入 composer explicit refs；再追问，request 只使用 selected refs。
- [x] 打开 audit/debug，确认 raw details 可审计但不驱动主结果。
- [x] 支援 `MTG-001` 的 selected artifact -> reload/reopen -> follow-up 后半段。
- [x] 将 `PBT-009` / `MTG-006` 落成 final evidence gate：缺少真实 in-app browser evidence 时 companion gate fail。
- [x] 扩展 final gate，使 failed/repair-needed/diagnostic-only evidence 不能作为 Golden Path release blocker。
- [x] 对 selected artifact follow-up 增加准确回答验收，不能只显示 `Reference path was not readable` 或 refs。

验收标准：

- [x] Reload/reopen evidence、selected refs request boundary、audit-only artifact 过滤都由真实 in-app browser 证明。
- [x] Final gate 同时检查 `AnswerQuality=accurate` 与 `TaskSuccess=true`。
- [x] P4 evidence 可以支撑 MTG-001 后半段的 restore/selection/audit gate；准确回答 release blocker 仍必须来自 `golden-path` evidence。

### 速度验收口径

所有进程统一记录这些指标，避免只凭体感判断“慢”。速度指标必须和成功指标一起看；未完成任务的“快”不计入优化成功。

- `TaskSuccess`：是否准确完成用户请求。`TaskSuccess=true` 必须同时满足：回答直接解决当前用户问题；内容准确、具体、非空泛；必要时正确使用 selected refs/provider/tool/artifact evidence；没有 failed/repair-needed/degraded 污染当前主结果；没有 `Reference path was not readable`、只列 refs、只说恢复动作、只给诊断、只输出“后端运行未完成”；并有 DOM/record evidence 证明用户可见答案与当前轮目标一致。`satisfied` Projection、可读文本、artifact refs、无 raw leak、无 Projection wait 只是必要条件，不是成功充分条件。
- `AnswerQuality`：`accurate` / `partial` / `diagnostic-only` / `failed`。只有 `accurate` 可以与 `TaskSuccess=true` 同时出现；`partial` 可以计入 `UsefulPartial`，但不能算 Golden Path 成功；`diagnostic-only` 和 `failed` 必须进入 Issue Queue 或 recover path。
- `UsefulPartial`：如果任务进入 `background-running`，前台必须已有有用 partial answer 或 artifact；不能只是空壳进度。
- `BlockingTruth`：如果进入 `needs-human` / `repair-needed` / `failed-with-reason`，必须有真实 blocker、recover action 和 refs；不能只是 timeout 包装。
- `MultiturnContinuity`：continue/repair/follow-up 是否保留当前目标并只使用合法 refs。

- `T_first_progress`：发送后到 UI 出现结构化 progress 的时间，目标 <= 3s。
- `T_first_backend_event`：发送后到第一个 workspace/runtime/backend event 的时间，目标 <= 15s；超过要有 visible waiting reason。
- `T_terminal_projection`：发送后到 terminal ConversationProjection 的时间；普通 fresh/continue 目标 <= 60s，provider/tool/repair 目标 <= 120s。
- `T_stall_bound`：已有 backend event 后再次静默的最长时间；必须 bounded，不能无限软等待。
- `ProjectionWaitAtTerminal`：terminal run 中必须为 0；terminal 时仍显示“主结果等待 ConversationProjection”就是 P0。
- `RawLeak`：主结果区不得出现 raw JSON、endpoint、secret、stdout/stderr body 或 audit-only artifact。

### 本轮 PBT Issue Queue

#### Open

- `MT-ROOT-001` - **[P0] Python policy `_infer_task_relation` 默认 `"new-task"` 导致全部 continue turn `MultiturnContinuity=false`**：根因定位完成。调用链：`goal_snapshot.py:127` `_infer_task_relation` 在 `has_prior_context=True` 且 prompt 无明确 continuation 关键词时返回 `"new-task"` → `conversation-context-policy.ts:69` `inferMode("new-task")` → `mode: 'isolate'` → `apply.ts:152-153` 覆盖 transport `contextReusePolicy` → `agent-harness-continuity-decision.ts:15` `policyAllowsReuse=false` → `agentserver-generation-dispatch.ts:366` `reconcileExisting:false`。复现：`python3 -c "_infer_task_relation('Can you elaborate?', False, True)"` → `'new-task'`。修复在 MT-001。

- `MT-ROOT-002` - **[P1] Python policy 每次请求启动多个 tsx 子进程，整体耗时 3-5 秒**：`context_policy.py:45` 和 `reference_digest.py` 各自 `subprocess.run tsx` 启动 TypeScript 评估；实测 fresh turn 3462ms，continue turn 4690ms。接近 8000ms 硬超时（`python-bridge.ts:40`）。超时后 `apply.ts:44-59` 标记 `applicationStatus='failed'`；continue turn 的 `policyFailureAllowsStatelessFreshGeneration`（`generation-gateway.ts:323`）固定返回 `false`（因为有 refs/history），直接 fail-closed。修复在 MT-002 + MT-003。

- `PBT-SPEED-001` - P1/P2 真实 browser 发现 provider/tool 路径可进入长时间 running：已有 backend event 后反复 soft wait，右侧仍显示“主结果等待 ConversationProjection”。P1 追加证据：owner=P1，ports=5173/5174/18080，URL=`http://127.0.0.1:5173/`，fresh no-exec run=`project-literature-evidence-review-mp839pcy-d19dxp` session=`session-literature-evidence-review-mp83912n-ssjra2`，T_first_progress=1380ms，T_first_backend_event=1380ms，T_terminal_projection=29672ms，ProjectionWaitAtTerminal=0，TaskSuccess=true；fresh normal run=`project-literature-evidence-review-mp83aeg2-137ww9` session=`session-literature-evidence-review-mp83a6oq-8h1s1a`，T_first_progress=1575ms，T_first_backend_event=1575ms，T_terminal_projection=9334ms，ProjectionWaitAtTerminal=0，但主结果为 `conversation policy timed out after 8000ms` fail-closed 而非 primer design answer，TaskSuccess=false，根因边界=`policy`；continue run=`project-literature-evidence-review-mp83d9ay-j21srm` session=`session-literature-evidence-review-mp83a6oq-8h1s1a`，intent=continuation 但只继承失败 Projection，MultiturnContinuity=false，根因边界=`policy -> Projection`；另见 OpenTeam 401/diagnostic 路径把 raw JSON/error body 暴露到主结果，RawLeak=true，根因边界=`AgentServer -> UI restore/presentation sanitization`。P2 追加证据：owner=P2，ports=5273/5274/18180，run=`project-literature-evidence-review-mp83esmo-j0zz31`，session=`session-literature-evidence-review-mp83eomk-ht9bm4`，provider discovery 已返回 unavailable，但 gateway 仍 dispatch 并显示 `Dispatched protocol=protocol-success` / `EU-p2-unavailable-1`，根因边界=`provider route resolver -> gateway dispatch preflight`。需要通用 bounded stall/terminal Projection 策略，同时 provider unavailable/policy timeout 必须在确认无可用 route 后快速 Projection-visible failed-with-reason，但修复不能替代 ready provider/tool 的真实执行，不能用快速 degraded/empty result 冒充 TaskSuccess。
- `PBT-SPEED-001/P1-latest` - owner=P1，ports=5173/5174/18080，URL=`http://127.0.0.1:5173/`，root boundary=`policy -> runtime gateway -> UI presentation`。最新 in-app browser 复验：fresh no-exec run=`project-literature-evidence-review-mp86fqm3-vy25sq`，session=`session-literature-evidence-review-mp86ffw1-lmw6b0`，prompt=`fresh no exec baseline answer in two sentences why conversationprojection should be the only user visible result source no search no code`，T_first_progress=1186ms，T_first_backend_event=1186ms，T_terminal_projection=8857ms，T_readable_answer=1186ms，T_stall_bound=769ms，ProjectionWaitAtTerminal=0，RawLeak=false，DOM 主结果显示 `ConversationProjection should be the only user-visible result source...` 和 `research-report` refs。fresh normal run=`project-literature-evidence-review-mp86g3cq-2ym67y`，session=`session-literature-evidence-review-mp86fraw-rl3ew1`，prompt=`fresh normal answer baseline give three points why primer design checks gc content and specificity no search no code`，T_first_progress=1121ms，T_first_backend_event=1121ms，T_terminal_projection=11114ms，T_readable_answer=1121ms，T_stall_bound=779ms，ProjectionWaitAtTerminal=0，RawLeak=false，DOM 主结果显示 GC/Tm、hairpin/primer-dimer、specificity/BLAST 三点。continue run=`project-literature-evidence-review-mp86gv8p-ds21yn`，same session，prompt=`continue previous answer compress the three points into one checklist and explicitly reuse previous conclusion no new search`，T_first_progress=1230ms，T_first_backend_event=1230ms，T_terminal_projection=1230ms，T_readable_answer=1230ms，T_stall_bound=888ms，ProjectionWaitAtTerminal=0，RawLeak=false，**原 TaskSuccess=false 但根因已修复**：`confidence must be a number; reasoningTrace must be a string` 现在通过 `normalizeToolPayloadShape()` coercion 解决（MT-005 + MT-006）；dispatch 路由问题仍需 P1-MT-001 修复。Additional risk: persisted `messages/runs.response` for fresh successes is still normalized to `后端运行未完成：backend failure...` while DOM projection renders the readable answer; fix should align response normalization with `displayIntent.resultPresentation` without using raw run body。
- `P1-MT-ROOT-001` - **[P1 → fixed, keep regression watch]** answer-only continuation schema validation / dispatch 阻断：早期真实 browser continue run 因 `confidence: "0.85"` 和 `reasoningTrace: [...]` 在 normalization 前被 schema reject，随后 answer-only 仍可能误进 generated workspace task。Fix：`normalizeToolPayloadShape()` 先做 confidence/trace coercion；direct-context fast path 对 answer-only transform 只使用 prior visible answer / bounded claims，过滤 unreadable digest、path-only ref 和 audit-only ref；continuation claim text 从用户可见答案派生。最新 in-app browser：run=`project-literature-evidence-review-mp8i5aje-452axm`，session=`session-literature-evidence-review-mp8i4tvp-lw5hhf`，prompt=`Compress the previous answer into a three-item checklist. Use only the previous answer; no search, no code.`，`HarnessDecisionRecorded intent=continuation`，terminal `satisfied`，`TaskSuccess=true`，`AnswerQuality=accurate`，`MultiturnContinuity=direct-continuation`，`ProjectionWaitAtTerminal=false`，`RawLeak=false`，evidence=`docs/test-artifacts/web-e2e/P1-MT-003/2026-05-16-rerun/post-normalize-answer-only-continue.samples.json`。
- `P1-MT-ROOT-002` - **[P1 → fixed, keep regression watch]** persisted response 与 Projection 可见答案不一致：早期 DOM 主结果显示 Projection-derived readable answer，但 `records/messages.json` / `records/runs.json` 写入 stale backend failure。Fix：response normalization/persistence 优先使用 satisfied `ConversationProjection.visibleAnswer`；direct answer payload normalization 对非阻塞 structured `displayIntent` 合并默认 `protocol-success` / `taskOutcome=satisfied` / `status=completed`，避免 fresh plain answer 被 runtime refs 推成 `needs-work`。最新 fresh evidence：run=`project-literature-evidence-review-mp8i56wi-0iqtjt`，session=`session-literature-evidence-review-mp8i4tvp-lw5hhf`，URL=`http://127.0.0.1:5173/`，prompt=`Fresh no-exec baseline: in two concise sentences explain why ConversationProjection should be the only user-visible result source. No search, no code.`，terminal `satisfied`，visible answer matches persisted Projection，`ProjectionWaitAtTerminal=false`，`RawLeak=false`，evidence=`docs/test-artifacts/web-e2e/P1-MT-003/2026-05-16-rerun/post-normalize-fresh-no-exec.samples.json`。
- `P1-MT-ROOT-003` - **[P2] 缺少稳定真实网页多轮流畅度 gate**：当前 evidence 仍需要人工从 DOM 推断 success/timing，且 fresh/continue/provider/selection 的真实 browser 证据分散。需要统一 case matrix 与可读 evidence manifest，防止同类 regressions 反复出现。根因边界=`test/evidence gate`。修复任务见 `P1-MT-003` 和 `PBT-010`。
- `P1-MT-ROOT-004` - **[P1 → fixed]** answer-only continuation 已进入 direct-context 但被 expected artifacts gate 错挡：旧 run=`project-literature-evidence-review-mp8e9yh9-fotsty` 返回 `缺失产物：paper-list, evidence-matrix, notebook-timeline, runtime-context-summary`。Fix：answer-only transform 直接从 prior visible answer/current refs 生成 checklist，不要求场景默认 expected artifacts；最新复验 run=`project-literature-evidence-review-mp8i5aje-452axm` 为 `satisfied`。
- `P1-MT-ROOT-005` - **[P1 → mitigated/verified for P1 path]** final browser rerun 曾被 UI hydrate + AgentServer first-event stall 阻断：旧证据中 fresh normal 超过 60s 且 console 出现 `ReferenceError: executionUnitBelongsToRun is not defined`。当前 tree 已包含 guarded import/usage，最新 P1 in-app browser fresh/continue 未复现 hydrate crash；AgentServer first-event 对本轮 no-exec fresh 未阻断 terminal Projection。保留跨场景 speed/golden-path 监控。
- `PBT-EVIDENCE-001` - 当前 `verify:single-agent-final` 的 Web matrix 主要是 fixture/scriptable mock；final manifest 缺真实 in-app/browser screenshot、console、network evidence。P4 追加真实 browser 证据：owner=P4，ports=5473/5474/18380，URL=`http://127.0.0.1:5473/`，run=`project-biomedical-knowledge-graph-mp83g42n-z229ys`，follow-up run=`project-literature-evidence-review-mp83mmxt-fy7y15`，session=`session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp83bd44-mp83bd4s-nnci7j`，artifact refs=`artifact:knowledge-runtime-result`,`artifact:verification-f6f4f84c9a6f`,`artifact:research-report`，selected explicit ref=`message:msg-mp83g42o-49pg5w`，T_first_backend_event≈4.3s，T_terminal_projection≈149s，follow-up terminal≈8.3s，reload/reopen `ProjectionWaitAtTerminal=0`，main result `RawLeak=false`，DOM/console/network evidence captured from Codex in-app browser。P4-latest 追加 machine-enforced evidence manifest：`tests/fixtures/real-browser-evidence/manifest.json`，包含 projection-restore、artifact-selection、provider-tool-latency、audit-boundary 四条真实 in-app browser 记录，截图/DOM 位于 `tests/fixtures/real-browser-evidence/p4-2026-05-16/`；本轮原始本地捕获另保留在 `docs/test-artifacts/real-browser-evidence/p4-2026-05-16/`。重要更正：这些 P4 证据目前只能证明 restore/selection/audit 边界，不证明 SciForge 已准确回答用户问题；页面仍可见 failed/repair-needed 历史和不可读 selected artifact 迹象，因此不能作为 `TaskSuccess=true` Golden Path release blocker。下一步必须让 final gate 同时校验 `AnswerQuality=accurate`。
- `PBT-P4-002` - owner=P4，ports=5473/5474/18380，root boundary=`selected artifact direct-context / diagnostic claim filtering / final gate`：真实 P4 UI reload/reopen 复验仍能恢复旧 pre-fix Projection，但旧 run 主结果含 `Reference path was not readable inside the workspace`，因此被归类为 boundary evidence 而非 Golden Path success。修复：queued running guidance 保留 explicit selected refs；direct-context selected artifact 摘要只使用显式 selected ref 匹配的 artifact/reference 项，并过滤 unreadable/unavailable、diagnostic claim、execution-unit/audit 项；artifact-policy 从 structured artifact data (`summary` / `keyFindings` / `conclusion` / `limitations`) 生成摘要。Workspace Writer verification：`tests/fixtures/real-browser-evidence/p4-2026-05-16-selected-artifact-fix/workspace-writer-selected-artifact.json`，prompt=`use selected artifact only no rerun no tools summarize what it says in five bullets`，selectedRefs=`artifact:research-report-kras-g12d`，checks=`hasSummaryHeader=true`, `hasSelectedContent=true`, `hasUnreadable=false`, `hasUnavailable=false`, `taskSuccess=true`。Codex in-app browser reload screenshot/DOM/console evidence 位于 `tests/fixtures/real-browser-evidence/p4-2026-05-16-selected-artifact-fix/`，记录旧 UI persisted run 仍是 pre-fix state；后续需要用 fresh UI Golden Path rerun 替换旧 persisted bad answer。

#### In Progress

暂无。各进程认领后把 owner、端口和 run/session id 写到这里。

### Issue Queue

#### Open

暂无。

#### In Progress

暂无。

#### Fixed Pending Verification

- `PBT-P4-003` - owner=P4，root boundary=`final evidence gate / Golden Path release blocker eligibility`：`tests/smoke/web-e2e/real-browser-evidence.ts` 现在要求 `goldenPathReleaseBlocker` 同时满足 `category='golden-path'`、`TaskSuccess=true`、`AnswerQuality='accurate'`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`、`diagnosticOnly!==true`，并拒绝 `terminalStatus` 为 `failed` / `repair-needed` / `needs-human` / `diagnostic-only`。Regression：`real-browser-evidence.test.ts` 新增 diagnostic-only blocker reject，`smoke:single-agent-final-evidence` 通过。
- `PBT-P2-005` - owner=P2，ports=5273/5274/18180，URL=`http://127.0.0.1:5273/`，root boundary=`authoring contract / backend handoff prompt`：ready provider browser run `project-biomedical-knowledge-graph-mp85ppgk-m79b4z` / session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85o4xa-9ql96d` 进入 ready `web_search`/`web_fetch` route，但 AgentServer generated task returned static/non-interface code and failed with `does not write the SciForge outputPath argument`; handoff evidence showed `canonicalPythonAdapter` array was compacted to `[truncated ... entries]`, so the backend did not receive a copyable adapter skeleton. Fix: `capabilityFirstPolicy.canonicalPythonAdapter` is now a single multiline copyable Python skeleton with `failed_with_reason_payload`, `success_payload`, `invoke_capability`, and `write_payload(output_path, ...)`; `agentserver-prompts.test.ts` asserts helper definitions survive prompt rendering. Targeted tests passed.
- `PBT-P2-006` - owner=P2，ports=5273/5274/18180，URL=`http://127.0.0.1:5273/`，root boundary=`provider route resolver / gateway execution order`：provider-unavailable browser attempt prompt=`P2 unavailable require web_search provider...` showed first progress/backend event at ~27s and `ProjectionWaitAtTerminal` still visible during running because provider preflight was after direct-context / sense / dispatch-side gates. Fix: `generation-gateway` now runs `capabilityProviderUnavailablePayload` immediately after conversation policy + harness + provider discovery and before direct-context, vision-sense, AgentServer dispatch, or generated task execution; regression test `provider preflight blocks before sense or backend dispatch for explicit provider tasks` passed. Full unavailable browser recheck still needs a genuinely non-ready route because current P2 browser environment resolved `sciforge.web-worker.web_search` as ready.
- `PBT-P2-007` - owner=P2，ports=5273/5274/18080，URL=`http://127.0.0.1:5273/`，root boundary=`P2 workspace isolation / browser runtime state contract / raw-debug boundary`：用户指出 Web 端工作目录疑似错误，复核确认早期 P2 dev 只隔离了端口，没有隔离 workspace root。已重启 P2 dev with `SCIFORGE_WORKSPACE_PATH=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p2`、`SCIFORGE_STATE_DIR=/Applications/workspace/ailab/research/app/SciForge/.sciforge/parallel/p2`，browser 左侧显示 `p2` / `.sciforge`，Workspace Writer 为 `http://127.0.0.1:5274`。Fix：新增通用 `runtime-visible-state` / `runtime-timing-progress` / `runtime-execution-process` DOM hook，字段包含 `runId`、`sessionId`、run status、Projection status、`T_first_progress`、`T_first_backend_event`、`T_terminal_projection`、`ProjectionWaitAtTerminal`、`RawLeak`；raw audit/debug 输出经 scrubber 脱敏，DOM hook 只保留 `artifact:*` 与 `runtime://capability-provider-route/*` public refs。Browser evidence after correction：run=`project-literature-evidence-review-mp85zynq-ea8utx`，session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85x35v-2nvl49`，prompt=`P2 unavailable require web_search provider. No ready route should fail closed with recover action no backend dispatch.`，hook shows `data-projection-status=degraded-result`、`data-run-status=completed`、`data-projection-wait-at-terminal=false`、`data-raw-fallback-used=false`、`data-raw-leak=false`、visible raw-run/log leak=false。Verification：`node --import tsx --test src/runtime/gateway/capability-provider-preflight.test.ts src/runtime/gateway/generated-task-runner-execution-lifecycle.test.ts src/ui/src/app/results-renderer-execution-model.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/streamEventPresentation.test.ts` passed 93/93；`npx tsc --noEmit --pretty false` passed；`npm run smoke:single-agent-runtime-contract` passed；`smoke-web-multiturn-final --tag smoke:browser-provider-preflight` passed SA-WEB-05/SA-WEB-06. Remaining browser matrix gap：this corrected browser capture is unavailable/diagnostic hook evidence, not full ready -> two follow-ups -> empty refined-query satisfied matrix.
- `PBT-P2-008` - owner=P2，ports=5273/5274/18180，URL=`http://127.0.0.1:5273/`，root boundary=`ready provider authoring contract / backend retry`：after fixing P2 config to use AgentServer `18180`, real in-app browser ready provider run with OpenTeam backend reached ready `web_search`/`web_fetch` route and wrote handoff to `18180`, but AgentServer generated direct network code twice. First preflight blocked `urllib`; strict retry still emitted malformed artifacts plus `socket`, so runtime returned Projection-visible `repair-needed` instead of executing direct network. Evidence: `docs/test-artifacts/web-e2e/P2-MT-006/manifest.json`, DOM `openteam-ready-contract-failure.dom.txt`, screenshot `openteam-ready-contract-failure.png`, run=`project-literature-evidence-review-mp8h8uha-6pat0o`, session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp8h44z6-lsr6wt`, `TaskSuccess=false`, `UsefulPartial=true`, `BlockingTruth=backend generated task violated provider-first authoring contract after strict retry`, `ProjectionWaitAtTerminal=0`, `RawLeak=false`. Fix this round: provider-first prompt now applies to any ready capability id, not only `web_search`/`web_fetch`; prompt-only capability id scanning was removed so status/prose mentions do not force provider routes; helper execution tests now cover ready invoke, empty result terminal payload, unavailable failed-with-reason payload, and direct-network preflight. Remaining gap: backend must actually emit `sciforge_task.invoke_capability` code for ready path before P2-MT-001/006 can become `TaskSuccess=true`.
- `PBT-RESTORE-001` - owner=P4，ports=5473/5474/18380，root boundary=`compact storage / UI hydration`：browser run `project-biomedical-knowledge-graph-mp83g42n-z229ys` / session `session-workspace-biomedical-knowledge-graph-我想比较kras-g12d突变相关文献证据-并在场景-mp83bd44-mp83bd4s-nnci7j` reload/reopen 后恢复 `repair-needed` Projection、recover action 和 artifact refs，`ProjectionWaitAtTerminal=0`。修复：compact storage 优先保留 `displayIntent` / `resultPresentation` / Projection contract keys，P4 instance config 从 build env 注入并隔离 storage key。
- `PBT-SELECTION-001` - owner=P4，ports=5473/5474/18380，root boundary=`artifact selection / request boundary / ArtifactDelivery visibility`：browser point-select 写入 composer explicit ref `message:msg-mp83g42o-49pg5w`，follow-up run `project-literature-evidence-review-mp83mmxt-fy7y15` 的 handoff `2026-05-16T08-42-47-629Z-agentserver-generation-dd3ee042c4.json` 只携带 selected ref，未混入未选择的 `artifact:knowledge-runtime-result`、`artifact:verification-f6f4f84c9a6f` 或新 run `artifact:research-report`。修复：explicit refs 统一设置 `selectedRefsOnly`，UI request payload 和 gateway artifact context 按 selected refs allowlist 过滤。
- `PBT-AUDIT-001` - owner=P4，ports=5473/5474/18380，root boundary=`ArtifactDelivery visibility / audit-debug boundary`：audit/debug raw details 可审计但不驱动主结果；generic result presentation paths previously projected all payload artifacts into inline citations/actions without checking explicit ArtifactDelivery role/preview policy. 修复：ResultPresentation contract adapter and gateway adapter now keep legacy no-delivery artifacts visible while filtering explicit non-user-facing `audit` / `diagnostic` / `internal` or `json-envelope` deliveries from human-facing citations/actions.
- `PBT-RESTORE-001/P4-latest` - owner=P4，ports=5473/5474/18380，URL=`http://127.0.0.1:5473/`，session=`session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp83bd44-mp84kgal-tqsw1l`，run=`project-literature-evidence-review-mp87qpij-i2o4sm`，artifact ref=`artifact:research-report-kras-g12d`。真实 in-app browser reload + new-tab reopen 后选中 persisted latest run，右侧主结果恢复 direct-context answer、recover actions、artifact ref 和审计摘要；DOM evidence 包含 `当前聚焦 run project-literature-evidence-review-mp87qpij-i2o4sm · completed`、`基于当前会话已有上下文直接回答，不启动新的 workspace task。`、`research-report-kras-g12d`、`0 EU` / `No runtime execution units yet.`；`ProjectionWaitAtTerminal=0`，主结果 RawLeak=false，audit raw/details 只在折叠审计区。验收更正：这是 restore/audit boundary pass，不是用户问题成功回答；当前页面仍可见 failed/repair-needed 历史和不可读 artifact 提示，`TaskSuccess=false` / `AnswerQuality=diagnostic-only`，不得作为 Golden Path 成功。
- `PBT-SELECTION-001/P4-latest` - owner=P4，ports=5473/5474/18380，root boundary=`artifact selection / request boundary / conversation policy direct-context`：旧 artifact click 现在同时 focus right pane 并写入 composer explicit ref；立即 fill/send 也不会因 React state stale 丢失 pending refs。follow-up prompt=`use selected artifact only no rerun no tools summarize what it says in five bullets`，selected explicit refs=`artifact:research-report-kras-g12d`，terminal run=`project-literature-evidence-review-mp87qpij-i2o4sm`，request/persisted record references 仅包含 selected artifact ref（无 latest artifact allowlist 扩散）；conversation policy 修复 dataclass capability manifest normalization、`turn.text`/`turn.refs` alias seed、structured no-exec selected-ref direct decision，并把 selected tool/capability hints 保持为 no-exec 上下文限制而非强制 workspace execution。验收更正：selected-ref boundary pass，但回答含 `Reference path was not readable` / 未真正总结 selected artifact 内容，不能算准确回复；`TaskSuccess=false`、`AnswerQuality=failed`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。
- `PBT-EVIDENCE-001/P4-final-gate` - owner=P4，root boundary=`final evidence gate / browser evidence manifest`：`verify:single-agent-final` 的 final manifest now references real Codex in-app browser evidence at `tests/fixtures/real-browser-evidence/manifest.json` and requires projection-restore、artifact-selection、provider-tool-latency categories. Validator currently rejects missing categories, missing screenshot/DOM files, terminal Projection waits, or RawLeak=true. 验收更正：这仍不足以证明 release readiness，因为 gate 尚未强制 `AnswerQuality=accurate` 和用户问题准确回答；必须追加 companion gate 或扩展 manifest schema，使 failed/repair-needed/diagnostic-only evidence 不能作为 Golden Path release blocker。已有验证命令只证明边界 gate 通过，不证明任务成功。

#### Verified

- `PBT-P1-001` - owner=P1，ports=5173/5174/18080，URL=`http://127.0.0.1:5173/`，root boundary=`runtime direct-answer payload normalization / direct-context continuation / Projection persistence`：真实 in-app browser fresh no-exec -> answer-only continuation 已通过。Fresh run=`project-literature-evidence-review-mp8i56wi-0iqtjt`，session=`session-literature-evidence-review-mp8i4tvp-lw5hhf`，prompt=`Fresh no-exec baseline: in two concise sentences explain why ConversationProjection should be the only user-visible result source. No search, no code.`，`T_first_progress=0ms`，`T_first_backend_event=` blank direct path，`T_terminal_projection=0ms`，`T_readable_answer=0ms`，`T_stall_bound=0ms`，`TaskSuccess=true`，`AnswerQuality=accurate`，`ProjectionWaitAtTerminal=false`，`RawLeak=false`。Continue run=`project-literature-evidence-review-mp8i5aje-452axm`，same session，prompt=`Compress the previous answer into a three-item checklist. Use only the previous answer; no search, no code.`，`HarnessDecisionRecorded intent=continuation`，direct continuation without generated workspace task，`TaskSuccess=true`，`AnswerQuality=accurate`，`MultiturnContinuity=direct-continuation`，`ProjectionWaitAtTerminal=false`，`RawLeak=false`。Evidence: `docs/test-artifacts/web-e2e/P1-MT-003/2026-05-16-rerun/post-normalize-fresh-no-exec.samples.json` and `post-normalize-answer-only-continue.samples.json`; screenshots/DOM/HTML/log summaries share the same prefix.
- `BM-BROWSER-001` - Projectionless fail-closed terminal result：browser fresh no-exec run 曾在右侧主结果卡在“主结果等待 ConversationProjection”。修复：`finalizeGatewayPayload` 统一为所有 terminal payload 附加 ResultPresentation/ConversationProjection contract。验证：browser fresh run 显示“只得到部分结果” Projection，不再等待 raw run；`generation-gateway.policy.test.ts` 增加 fail-closed Projection 断言；`verify:single-agent-final` 通过。
- `PBT-P2-001` - owner=P2，ports=5273/5274/18180，root boundary=`provider route resolver / gateway dispatch preflight`：CapabilityProviderPreflight now uses structured selected tools / capability policy / external IO flags for required routes, not prompt prose mentions; `generation-gateway` fail-closes before AgentServer dispatch when required routes are not ready. Browser verification: unavailable run=`project-literature-evidence-review-mp845kfy-02w6pd` showed `Capability provider route preflight blocked AgentServer dispatch`, recover actions, `ProjectionWaitAtTerminal=0`, and mock AgentServer `/runs/stream` count stayed `5 -> 5`.
- `PBT-P2-002` - owner=P2，ports=5273/5274/18180，root boundary=`UI config/session isolation`：P2 Browser showed file tree `p2`, Workspace Writer `http://127.0.0.1:5274`, AgentServer `http://127.0.0.1:18180` after instance-scoped config/workspace storage and build-env defaults.
- `PBT-P2-003` - owner=P2，ports=5273/5274/18180，root boundary=`UI exposure / ArtifactDelivery`：ready/empty/unavailable browser checks showed `RawLeak=false` in main result; audit refs remain folded as `audit ref(s) retained for debug details`.
- `PBT-P2-004` - owner=P2，ports=5273/5274/18180，root boundary=`ResultPresentation -> TaskOutcomeProjection`：ready provider route with complete evidenced ResultPresentation now projects `protocol=protocol-success; task=satisfied` instead of `DegradedResult`. Browser verification run=`project-biomedical-knowledge-graph-mp84v78l-5whmyn` showed `Satisfied`, `T_first_progress=769ms`, `T_first_backend_event=4513ms`, `T_terminal_projection=4513ms`, `ProjectionWaitAtTerminal=0`, `RawLeak=false`.
- `PBT-P3-001` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`bounded stop / Projection terminal / UI recover action`：provider failure/recover browser path now terminates as recoverable Projection instead of indefinite `主结果等待 ConversationProjection`. Evidence: provider failure run=`project-literature-evidence-review-mp846tds-8szvgn`, repair run=`project-literature-evidence-review-mp84ai6h-d6iub1`, session=`session-literature-evidence-review-mp841lbz-2h9wdb`; DOM shows `RepairNeeded`, `HarnessDecisionRecorded ... intent=repair`, recover actions scoped to current refs/digests, `ProjectionWaitAtTerminal=0`, `RawLeak=false` for raw stdout/stderr/log bodies. Fix: pre-response AgentServer silent guard aborts with structured audit, UI transport bounded stall recovery returns minimal `repair-needed` ConversationProjection with refs/digests-only recover actions, synthetic wait events no longer reset the stall bound, and P3 config/workspace storage is instance-scoped.
- `PBT-P3-002` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`Projection terminal / multiturn continuity / UI recover action`：repair/terminal Projection execution events no longer display placeholder epoch timestamps such as `1970-01-01T00:00:00.000Z`. Fix: ConversationProjection view-model normalizes invalid/epoch execution event timestamps to the active run completed/created time while preserving valid backend timestamps. Browser verification after reload showed P3 endpoints `5374`/`18280`, `hasEpochTimestamp=false`, `ProjectionWaitAtTerminal=0`; targeted renderer/projection/direct-context tests passed, `npm run typecheck`, `npm run smoke:single-agent-runtime-contract`, and `npm run smoke:web-final-conformance` passed.
- `PBT-P3-003` - owner=P3，ports=5373/5374/18280，root boundary=`multiturn continuity / harness intent / backend handoff`：structured direct-context run-status follow-up no longer misroutes to AgentServer when current refs are sufficient, while generation/repair/tool-status-insufficient still route to AgentServer. Fix: direct-context fast path requires an explicit `DirectContextDecision`; it accepts ref-backed run-diagnostic context, records `decisionRef` in audit params, and does not synthesize a direct answer from implicit turn constraints or prompt text. Verification: `tests/smoke/web-e2e/cases/direct-context-gate.test.ts` passed both direct run-status and routed generation/repair/tool-status branches; static contract guard stayed clean.
- `PBT-P3-004` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`TaskOutcomeProjection / ResultPresentation finalization / multiturn success`：browser fresh artifact run `project-literature-evidence-review-mp86fgah-l0g4ij` previously exposed the generic failure mode: AgentServer produced a readable artifact and `resultPresentation.status=complete`, but a stale pre-presentation `taskOutcomeProjection` was restored as `DegradedResult`, yielding `TaskSuccess=false` without a real blocker. Fix: current request finalization recomputes TaskOutcomeProjection after ResultPresentation is attached, while request-less restore still replays persisted event logs. Targeted regression asserts stale `needs-work` projection becomes `satisfied` only when current complete presentation has answer blocks plus artifact/citation evidence; message-only and missing expected artifact cases remain `needs-work`.
- `PBT-P3-005` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`UI response normalization / Projection terminal / raw-debug boundary`：browser multiturn evidence showed outer `displayIntent.conversationProjection.visibleAnswer.status=satisfied` while chat/run response still displayed `后端运行未完成：backend failure` from an inner backend wrapper. Fix: `normalizeAgentResponse` now prefers Projection visible answer text over stale wrapper failure text, and only uses backend failure summaries when no valid Projection answer is present. Regression asserts satisfied Projection text wins without leaking HTTP endpoint/stdout refs; existing raw backend failure tests still pass.
- `PBT-P3-006` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`conversation policy / UI transport current-turn isolation / harness intent`：真实 browser 新聊天首轮曾被 optimistic current user message 污染为 continuation/repair-like 上下文，示例 run=`project-literature-evidence-review-mp8842ro-bihhn1`，session=`session-literature-evidence-review-mp8842ro-bihhn1`，DOM 含 `HarnessDecisionRecorded ... intent=continuation`。Fix：UI transport 发送 `currentTurnId`，runtime policy 过滤当前 optimistic user turn；如果 structured `sessionMessages` 全部被过滤，不回退到 `recentConversation`。
- `PBT-P3-007` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`conversation policy direct-context refs / multiturn continuity`：context-only follow-up 曾未提升 current artifact refs，误 dispatch AgentServer 并触发 convergence guard；成功 fresh run=`project-literature-evidence-review-mp88d91d-50ufrv` 后 follow-up 出现 token guard `315996 total tokens`。Fix：goal snapshot 扩展 current/existing artifact/context-only 识别，gateway 在 context-only 且无 explicit refs/digests 时把同 session artifact refs 提升为 current references；direct-context 仍必须来自 structured `DirectContextDecision`。
- `PBT-P3-008` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`Projection terminal / session bundle restore / bounded stop`：browser fresh run `P3 terminal projection validation...` 写出 task attempt 与 artifacts，但 `records/runs.json=[]`，UI 停在 `主结果等待 ConversationProjection`；后端 terminal 证据在 session=`session-literature-evidence-review-mp89c8nr-zktgsb`，attempt=`generated-literature-adfb70b1be82`。Fix：`appendTaskAttempt` 在同 session bundle 中物化最小 terminal run、`materializedConversationProjection` 和 projection map，只携带 ConversationProjection/TaskRunCard/refs，不复制 raw output/log/stdout/stderr body；UI stall guard 排除 backend-wait synthetic events，并把 `stallBoundMs` capped at 120s。Browser reload DOM 显示 `Satisfied P3 终端投影验证完成...`，`ProjectionWaitAtTerminal=0`，`RawLeak=false`。
- `PBT-P3-009` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`direct-context handoff / refs-digests-only continuity / ArtifactDelivery`：同 session context-only 风险概括 initially terminal 但只列 refs，TaskSuccess=false。Fix：continuation payload 携带 bounded claims 和 ref-backed artifact digest preview（hash + short preview），direct-context answer 可从当前 Projection/ArtifactDelivery 可见 claims/digests 生成短回答，仍不传 raw artifact/log/stdout/stderr body；repair/dispatch 仍要求 `DirectContextDecision`。Browser evidence：run=`project-literature-evidence-review-mp8aj69d-wf0fk2`，session=`session-literature-evidence-review-mp89c8nr-zktgsb`，DOM 显示 `Answered directly from current-session context without starting a new workspace task. 上下文投影块数量超过缓存预算时可能导致投影漂移; 多阶段任务中 eventIndex/refIndex 同步不完整可能导致状态恢复不一致.`；T_first_progress≈23589ms，T_first_backend_event≈23589ms，T_terminal_projection≈23589ms，ProjectionWaitAtTerminal=0，RawLeak=false，AgentServer dispatch=false。
- `PBT-P3-010` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`MTG-002 main result truth source / UI response normalization`：satisfied `ConversationProjection.visibleAnswer` now wins over stale wrapper/backend failure diagnostics and stale `ContractValidationFailure` for chat `message.content`, persisted `run.response`, and completed status; raw failure diagnostics remain in `run.raw` / audit. Regression: `responseNormalization.test.ts` covers satisfied Projection over stale backend wrapper failure and stale ContractValidationFailure.
- `PBT-P3-011` - owner=P3，ports=5373/5374/18280，root boundary=`repair trigger / UI transport context policy`：repair mode no longer comes from prompt keywords alone. UI transport enters `contextReusePolicy.mode='repair'` only when current structured failure/recover refs are present in recent runs/execution units or selected failure refs; prompt-only `repair/retry/recover` with no current failure target remains bounded `continue`. Regression: `sciforgeToolsClient.policy.test.ts` covers keyword-only non-repair and failure-ref repair without repair keywords.
- `PBT-P3-012` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`PBT-010 Multiturn Browser Golden Path / direct-context-first / Projection restore`：First PBT-010 capture was invalidated because the Web UI workspace root was the main repo root instead of `workspace/parallel/p3`; invalid diagnostic retained at `docs/test-artifacts/web-e2e/p3-golden-path-manifest.json`. Corrected P3 evidence is `docs/test-artifacts/web-e2e/p3-golden-path-manifest.corrected.json`: browser left tree shows `p3` / `.sciforge`, services use P3 ports, workspace path is `/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p3`; session=`session-literature-evidence-review-mp89c8nr-zktgsb`; fresh terminal run=`project-literature-evidence-review-mp89jqxt-6qqald` shows `P3 终端投影验证完成...` and created artifact refs including `artifact:artifact-research-report-001`; reload restore shows `runtime-visible-state` with `data-run-status=completed`, `data-projection-status=satisfied`, `data-projection-wait-at-terminal=false`, `data-raw-leak=false`; context-only/direct follow-up run=`project-literature-evidence-review-mp8aj69d-wf0fk2` shows `Answered directly from current-session context without starting a new workspace task...`, `0 EU` / `No runtime execution units yet`, no new AgentServer handoff beyond the original four handoff/slimming files; selected artifact/object-ref follow-up evidence run=`project-literature-evidence-review-mp89qkkc-a2op32` retains bounded artifact objectReferences for `artifact-chinese-memo-001` and `artifact-research-report-001` without raw artifact/log/stdout/stderr body. All corrected manifest cases record `TaskSuccess=true`, `MultiturnContinuity=true`, `ProjectionWaitAtTerminal=0`, `RawLeak=false`; console duplicate-key warning is tracked separately as `PBT-P3-013`.
- `PBT-P3-013` - owner=P3，ports=5373/5374/18280，URL=`http://127.0.0.1:5373/`，root boundary=`browser evidence hygiene / direct-context claim rendering`：corrected P3 browser reload initially produced repeated React duplicate-key console errors for `direct-context-claim-session-literature-evidence-review-mp89c8nr-zktgsb-turn-1ljfuto`. Fix：`RunKeyInfo` now keys rendered claim rows as `claim.id + index`, preserving persisted claim ids/refs while making the React render key unique. Verification：targeted `RunExecutionProcess.test.ts` passed; in-app browser reload after 2026-05-16T14:13:01.837Z produced `newDuplicateLogCount=0`; runtime hook still `projectionStatus=satisfied`, `ProjectionWaitAtTerminal=false`, `RawLeak=false`.
- `BM-BROWSER-002` - UI transport did not explicitly classify fresh/continue/repair：continue turn 依赖 prompt 文本和残留 refs 推断上下文，容易出现真实 runtime context 与 UI handoff 不一致。修复：`sciforgeToolsClient` 为每轮请求写入 `contextReusePolicy` / `contextIsolation`，fresh 禁止历史复用，continue/repair 只复用 bounded refs。验证：UI policy tests 覆盖 fresh/continue；browser continuation persisted context 显示 `context=continue` 与 Projection continuation ref。
- `BM-BROWSER-003` - Agent Harness audit summarized continuation as fresh：runtime 已按 continue 复用，但 `HarnessDecisionRecorded` 仍显示 `intent=fresh`。修复：Agent Harness shadow input 从 transport `contextReusePolicy` 派生 `continuation` / `repair` intent。验证：browser continuation DOM 显示 `HarnessDecisionRecorded profile=balanced-default; intent=continuation; exploration=minimal`；新增 `agent-harness-shadow.test.ts` 覆盖 continue/repair policy seed。
- `SF-STAB-001..008` 历史问题已关闭并吸收到当前原则、conformance 和设计文档：新聊天隔离、provider-first authoring contract、Projection-only UI、repair bounded-stop 和 capability-first preflight 均由最终 contract 覆盖。详细事故链路见 git history 与 archive。

### Browser Test Matrix

每轮至少覆盖其中一条真实路径：

- Multiturn Golden Path：fresh 成功生成准确、可核查、用户可用的结果 -> 选择 artifact -> follow-up 只使用 selected refs 且准确回答 selected artifact 相关问题 -> reload/reopen -> 再次 follow-up 仍准确回答；全链路 `TaskSuccess=true`、`AnswerQuality=accurate`、`MultiturnContinuity=true`、`ProjectionWaitAtTerminal=0`、`RawLeak=false`。任何 failed/repair-needed/degraded、不可读 ref、空泛 direct-context、只列 refs 或只显示审计诊断都不是 Golden Path 成功。
- Fresh chat isolation：新聊天首轮不能继承旧 failure、repair context、current work 或 stable AgentServer session id。
- Fresh provider/tool task：ready provider/tool route 必须进入 capability-first authoring contract；如果 backend/tool 不可用，Projection 可见 failed-with-reason。
- Continue from result：第二轮必须保留 current user goal，不被旧 artifact 或 raw run 污染。
- Direct-context-first：当前 session 的 Projection/ArtifactDelivery refs、digest preview 或 bounded claims 足够回答时，follow-up 必须直接给出可读结果；不足时才进入 task/repair/recover，且不得靠 prompt 关键词单独触发。
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
- 2026-05-16 - Orchestrator - 新建 Parallel Browser Stability & Speed milestone：按 P1-P4 独立端口/状态/workspace/config 拆分并行真实 browser 调试任务；将“对话结果太慢”拆成 speed metrics、provider/tool latency、bounded stall、refresh restore、artifact selection 和真实 evidence gate。
- 2026-05-16 - P3 - 将 direct-context-first、前台/后台解耦、真实 in-app browser evidence gate 收敛为 `PBT-010` Multiturn Browser Golden Path Gate，并加入 P3 todo 与 Browser Test Matrix。
- 2026-05-16 - P2 - 执行 provider/tool 多轮稳定任务：browser ready route 暴露 authoring contract skeleton 被 compact 截断，修复为 multiline copyable adapter；provider preflight 前移到 harness/discovery 后第一道执行 gate；targeted tests、typecheck、single-agent runtime smoke、web final conformance 均通过。ready/unavailable/empty 多轮完整 satisfied matrix 仍需下一轮用真实 non-ready/empty provider route 复验。
- 2026-05-16 - P1 - 修复 answer-only continuation：Python policy 识别 no-search/no-code 的上一轮答案改写为 direct-context，TS direct-context fast path 从 prior visible answer/context 生成 checklist，并跳过场景默认 expected-artifact gate；同时修复 Projection/resultPresentation 优先持久化。新增 evidence manifest `docs/test-artifacts/web-e2e/P1-MT-003/manifest.json`。Targeted Python/TS tests 与 `npm run typecheck` 通过；真实 browser final rerun 被 `UI hydrate` (`executionUnitBelongsToRun is not defined`) + `AgentServer` first-event stall 阻断，已写 Issue Queue。
- 2026-05-16 - P2 - 将“网页端多轮对话稳定、流畅、成功运行”的下一步建议落成任务：新增 P2-MT-006 ready provider golden path、P2-MT-007 public outcome continuation、P2-MT-008 controlled unavailable fixture、P2-MT-009 empty provider terminal contract、P2-MT-010 browser runtime state contract，并把 Process P2 todo 调整为先打通一轮真实 provider 成功，再验证 follow-up、fail-closed、empty terminal 和 DOM/timing evidence。
- 2026-05-16 - P2 - 更正 P2 browser workspace：首次 5273 调试只隔离端口但 workspace root 仍指主仓，已停掉错误 dev server 并用 `workspace/parallel/p2` + `.sciforge/parallel/p2` 重启；browser 左侧显示 `p2` / `.sciforge`。本轮同时补齐 provider/capability contract：provider preflight 支持 configured/fallback routes、unauthorized/rate-limited fail-closed 只暴露 public refs；generated task helper 增加 `provider_result_is_empty` / `empty_result_payload`；UI runtime hook 暴露 run/session/status/timing/projection/raw-leak 且过滤 raw refs。验证：targeted P2 tests 93/93、typecheck、single-agent runtime contract smoke、browser-provider-preflight smoke SA-WEB-05/SA-WEB-06 通过；corrected browser hook evidence run=`project-literature-evidence-review-mp85zynq-ea8utx` / session=`session-workspace-biomedical-knowledge-graph--kras-g12d----mp85idt0-mp85x35v-2nvl49`，`ProjectionWaitAtTerminal=false`、`RawLeak=false`。
- 2026-05-16 - P4 - 用 Codex in-app browser 在 `http://127.0.0.1:5473/` 捕获 reload/reopen settled evidence：`project-literature-evidence-review-mp87qpij-i2o4sm` / `session-workspace-biomedical-knowledge-graph-_kras-g12d_-_-mp83bd44-mp84kgal-tqsw1l` 恢复 selected `artifact:research-report-kras-g12d` direct-context answer，`ProjectionWaitAtTerminal=0`、`RawLeak=false`、console warning/error count=0；截图和 DOM 写入 `docs/test-artifacts/real-browser-evidence/p4-2026-05-16/`。
- 2026-05-16 - P4 - 将真实 in-app browser evidence 纳入 final gate：`smoke:web-multiturn-final` final manifest 引用 `tests/fixtures/real-browser-evidence/manifest.json`，`smoke:single-agent-final-evidence` 强制 required categories、截图/DOM 文件存在、`ProjectionWaitAtTerminal=0` 和 `RawLeak=false`；缺真实 evidence 时 final gate fail。后续更正：该 gate 还必须继续扩展 `AnswerQuality=accurate` 校验，当前 P4 evidence 只能算边界证据，不能算准确回答成功。
- 2026-05-16 - P4 - 收紧 selected artifact / audit boundary：queued guidance 保留 selected refs；selected artifact direct-context 摘要只使用匹配 selected ref 的 artifact/reference 内容，过滤 unreadable/unavailable 与 diagnostic claim；final evidence gate 拒绝 diagnostic-only / repair-needed / failed Golden Path blocker。验证：`direct-context-fast-path.test.ts` 26/26、artifact-selection/reload smoke 10/10、`smoke:single-agent-final-evidence` 通过；P4 in-app browser reload 仍显示旧 persisted bad answer，因此新增 workspace-writer evidence `tests/fixtures/real-browser-evidence/p4-2026-05-16-selected-artifact-fix/workspace-writer-selected-artifact.json` 证明新 gateway path 已输出 KRAS/MRTX1133 selected artifact bullets 且无 unreadable/unavailable sentinel。
- 2026-05-16 - P3 - 修复 `MTG-002` 主结果真相源：`normalizeAgentResponse` 让 satisfied Projection visible answer 压过 stale wrapper failure / stale ContractValidationFailure，并保持 raw diagnostics 只进 audit/raw；修复 `PBT-006` repair trigger：UI transport 不再因 prompt keyword 单独进入 repair，只看当前 failure/recover refs。验证：`node --import tsx --test src/ui/src/api/agentClient/responseNormalization.test.ts`、`node --import tsx --test src/ui/src/api/sciforgeToolsClient.policy.test.ts`。
- 2026-05-16 - P3 - 更正 PBT-010 browser workspace：首次 P3 capture 只隔离了端口但 workspace root 仍是主 repo，已标记 invalid；重启 P3 dev server with `SCIFORGE_WORKSPACE_PATH=/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p3`，browser 左侧仅显示 `p3` / `.sciforge`。Corrected evidence manifest: `docs/test-artifacts/web-e2e/p3-golden-path-manifest.corrected.json`；session=`session-literature-evidence-review-mp89c8nr-zktgsb`；fresh restore 和 context-only direct answer 均 `ProjectionWaitAtTerminal=0`、`RawLeak=false`、direct-context `0 EU` / no AgentServer dispatch。
- 2026-05-16 - P3 - 补齐 corrected PBT-010 manifest 为四段 Golden Path evidence：fresh terminal run=`project-literature-evidence-review-mp89jqxt-6qqald`、reload restore runtime hook、context-only/direct follow-up run=`project-literature-evidence-review-mp8aj69d-wf0fk2`、selected artifact/object-ref follow-up run=`project-literature-evidence-review-mp89qkkc-a2op32`；manifest 记录 DOM、timing、TaskSuccess、UsefulPartial、BlockingTruth、MultiturnContinuity、ProjectionWaitAtTerminal、RawLeak、console/network summary。修复并验证 `PBT-P3-013` direct-context claim duplicate-key console warning。
- 2026-05-16 - Root-Cause Analysis - 定位多轮对话持续失败的两个根因：(1) `goal_snapshot.py:127` `_infer_task_relation` 在 `has_prior_context=True` 时默认返回 `”new-task”` 而非 `”continue”`，经 `conversation-context-policy.ts:69` → `mode:'isolate'` → `apply.ts:152` 覆盖 transport policy → `policyAllowsReuse=false` 导致 AgentServer `reconcileExisting=false`；(2) Python policy 每次请求启动多个 `tsx` 子进程（context_policy.py + reference_digest.py），MacOS 实测 3.4-4.7 秒，接近 8000ms 硬超时，复杂 continue turn 超时后 fail-closed。已新增任务 MT-001/002/003/004 和 issue MT-ROOT-001/002。
- 2026-05-16 - Root-Cause Fix - MT-005: 修复 `normalizeToolPayloadShape` 缺少 confidence 类型强转：AgentServer 输出 `confidence: "0.85"` (string) 时 schema validation 立即标记 "confidence must be a number"，阻止 payload 通过验证。修复后 `parseFloat()` coercion + fallback 0.72。MT-006: 修复 schema validation 顺序 — `generated-task-runner-output-lifecycle.ts` 先尝试 `normalizeToolPayloadShape()` coercion 再判断是否 reject。同时修复 `executionUnitBelongsToRun` 类型错误（`run` 参数 `SciForgeRun | undefined` → guarded filter）。更新 `smoke:no-legacy-paths` baseline：capability-provider-preflight 29→31，direct-context-fast-path 9→16，generated-task-runner-execution-lifecycle 0→1。`verify:single-agent-final` 全部通过：995 tests + 16 web e2e + no-legacy guard + final evidence。
- 2026-05-16 - P1 - 完成 fresh no-exec -> answer-only continuation 真实 in-app browser 复验：修复 plain/structured direct answer payload 在非阻塞 `displayIntent` 下未合并 satisfied defaults 的问题，避免 fresh answer 被 runtime refs 推成 `needs-work`；direct-context answer-only 过滤 unreadable/path-only/audit refs，并从 Projection 可见答案生成 continuation。Evidence 写入 `docs/test-artifacts/web-e2e/P1-MT-003/2026-05-16-rerun/`，fresh run=`project-literature-evidence-review-mp8i56wi-0iqtjt`、continue run=`project-literature-evidence-review-mp8i5aje-452axm`、session=`session-literature-evidence-review-mp8i4tvp-lw5hhf`，两轮均 `TaskSuccess=true`、`AnswerQuality=accurate`、`ProjectionWaitAtTerminal=false`、`RawLeak=false`；targeted TS tests 53/53 通过。

### Current Handoff

Browser Multiturn Stability Sprint 当前进入 MTG Golden Path 收敛阶段。最新 P1 fresh no-exec -> answer-only continuation 已通过真实 in-app browser，P1-MT-001/P1-MT-002/P1-MT-003 对该路径已可回归监控。下一步优先认领 `MTG-001`：用 Codex in-app browser 跑通 fresh 成功结果 -> 选择 artifact -> selected-ref follow-up -> reload/reopen -> 再 follow-up 的完整链路；若失败，按 `MTG-002` 主结果真相源、`MTG-003` ToolPayload 输出契约、`MTG-004` conversation-policy 误路由、`MTG-005` timing 归因四个边界定位根因。P1-P4 并行进程仍可继续扩展 provider/tool、repair、restore、selection，但所有修复必须服务于 Golden Path 先全绿，再纳入 `MTG-006` final gate browser evidence。
