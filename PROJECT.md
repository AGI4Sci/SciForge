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
2. **Projection terminal 必须可信**：`satisfied` 代表任务完成；`background-running` 代表已有可读前台结果且后台继续；`needs-human` / `repair-needed` / `failed-with-reason` 只能用于真实阻塞，不得用来掩盖 backend 慢或实现缺口。
3. **不能用快失败冒充快**：提前 fail-closed、返回空结果、跳过 provider/tool、跳过验证、直接给 degraded answer，除非 contract 明确证明继续执行不可行。
4. **快的是首个有用反馈和收敛路径**：可以更早展示计划、进度、partial answer、recover action，但不能牺牲最终任务质量、refs grounding、ArtifactDelivery 或 verification boundary。
5. **多轮连续性是成功的一部分**：第二轮必须接住上一轮目标和结果；repair 必须基于当前失败 refs；artifact follow-up 必须基于用户选择的 refs。

### 活动任务

| ID | 状态 | 内容 | 验收 |
|---|---|---|---|
| BM-001 | completed | 清理 `PROJECT.md`，删除旧 SA/SF-STAB 任务正文，建立新的 browser stability sprint 任务板。 | 本文件只包含当前 sprint、issue queue、验证门和 handoff；旧历史只以 archive 链接存在。 |
| BM-002 | completed | 用 in-app browser 跑 fresh -> continue 多轮路径，记录用户可见问题。 | Browser DOM evidence 覆盖新聊天隔离、Projection terminal、continue audit intent。 |
| BM-003 | completed | 修复本轮 browser 发现的最高优先级问题，必须是通用 contract/module 修复。 | 通用修复落在 runtime gateway、UI transport context policy、Agent Harness shadow intent；无 prompt/provider/scenario 特例。 |
| BM-004 | completed | 补齐回归测试和 conformance 证据。 | targeted tests、typecheck、single-agent runtime smoke、web conformance、`verify:single-agent-final` 均通过。 |
| BM-005 | completed | 同步文档和 GitHub。 | `PROJECT.md` 已更新；本次 milestone commit + push `main` 完成。 |
| PBT-001 | todo | 建立并行端口/状态隔离矩阵，让多个进程可同时跑 SciForge Web UI、workspace writer、AgentServer 和 in-app browser。 | 每个进程有唯一 `SCIFORGE_INSTANCE`、UI port、workspace port、AgentServer port、state dir、workspace path、config path；互不覆盖 local state / `.sciforge` / workspace artifacts。 |
| PBT-002 | todo | 建立真实网页成功率 + 速度 baseline：记录任务是否完成，以及从发送到首个可见状态、首个 backend event、Projection terminal、可读结果的耗时。 | 每个路径输出 browser DOM snapshot + console summary + run id + timing + success/failure reason；慢点写入 Issue Queue，不只写“感觉慢”。 |
| PBT-003 | todo | 修复长时间 running / 软等待 / Projection 等待问题，同时保留任务完成能力。 | 有 backend 进展的 run 应继续推动任务完成；确实 stalled 时必须在 bounded 时间内进入 Projection-visible `background-running`（已有可读前台结果）或真实阻塞的 `needs-human` / `repair-needed` / `failed-with-reason`；不能无限显示“主结果等待 ConversationProjection”。 |
| PBT-004 | todo | 优化 fresh -> continue 常规对话成功率和速度。 | fresh/continue 在真实 browser 中完成用户请求并快速显示结构化进度；continue 只复用 bounded Projection/refs，不重放 raw history；首屏结果不被历史 repair/provider 状态污染。 |
| PBT-005 | todo | 优化 provider/tool 路径任务完成率、速度和稳定性。 | ready provider/tool route 必须尽早进入 capability-first authoring contract 并实际完成检索/读取/产物生成；provider unavailable 只有在确认无可用 route 时才快速 Projection-visible 阻塞；不得长时间等待 backend 自行生成直连网络代码。 |
| PBT-006 | todo | 压测 repair from failure 的任务恢复能力和 bounded-stop。 | repair 应优先恢复并完成原任务；只用同 session failure refs/digests；重复失败或 token/静默超限时才返回最小 Projection recover action，不自动无限 repair。 |
| PBT-007 | todo | 验证 refresh/reopen restore 真实浏览器路径。 | reload/reopen 后右侧主结果、recover actions、artifact refs 从 persisted Projection 恢复；不能因 compact storage 丢 projection 而显示等待 Projection。 |
| PBT-008 | todo | 验证 artifact selection 真实交互边界。 | 点击/选择旧 artifact 后追问，request 只带 selected explicit refs；不得混入 latest artifact 或当前 run raw body。 |
| PBT-009 | todo | 把真实 browser evidence 纳入 final gate。 | 至少新增 3 条真实浏览器证据：Projection restore、artifact selection、provider/tool latency；final evidence manifest 不再只有 fixture-managed/mock-only 记录。 |

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

### 并行 Todo 分工

#### Process P1 - Fresh / Continue / Fast First Result

- [ ] 用 in-app browser 打开 `http://127.0.0.1:5173/`，跑 fresh no-exec、fresh normal answer、continue from Projection 三条路径。
- [ ] 记录 timings：send -> first visible progress、send -> first backend event、send -> terminal Projection、send -> readable answer。
- [ ] 验证 fresh 首轮没有旧 failure/ref/current work，continue 显示 `intent=continuation` 且只带 bounded Projection refs。
- [ ] 如果首个可见状态超过 3s 或 terminal Projection 超过 60s，写入 Issue Queue 并定位到 policy/transport/runtime 之一。

#### Process P2 - Provider / Tool / Capability-First

- [ ] 用 in-app browser 打开 `http://127.0.0.1:5273/`，跑 ready provider route、provider unavailable、empty provider result 三条路径。
- [ ] 检查 backend prompt / generated task 是否使用 `sciforge_task.invoke_capability` 或等价 helper；不得生成 `urllib`、`requests`、raw socket 或 worker endpoint 直连。
- [ ] provider unavailable 必须快速返回 Projection-visible failed-with-reason / needs-human，不进入长时间 AgentServer 自循环。
- [ ] 检查 DOM/request/run raw 不泄漏 endpoint、auth、worker private path；只暴露 public provider summary 和 refs。

#### Process P3 - Repair / Bounded Recovery

- [ ] 用 in-app browser 打开 `http://127.0.0.1:5373/`，制造 provider/schema/validation failure，再点 recover 或输入 repair follow-up。
- [ ] 验证 repair mode 来自 current Projection failure refs 或 recover action，不由 prompt 关键词单独触发。
- [ ] 验证 repair handoff refs/digests-only，不携带 raw artifact/log body。
- [ ] 重复失败、silent stream、token guard 或 bounded-stop 时，必须返回最小 Projection recover action，不允许无限 repair loop。

#### Process P4 - Restore / Artifact Selection / Audit Boundary

- [ ] 用 in-app browser 打开 `http://127.0.0.1:5473/`，生成一个 terminal Projection 后 reload/reopen。
- [ ] 验证刷新后右侧主结果、recover actions、artifact refs 仍从 persisted Projection 恢复。
- [ ] 点击旧 artifact，确认它进入 composer explicit refs；再追问，检查 request 只使用 selected refs，不混入 latest artifact。
- [ ] 打开 audit/debug，确认 raw details 可审计但不驱动主结果；audit/diagnostic/internal ArtifactDelivery 不进用户可见主结果。

### 速度验收口径

所有进程统一记录这些指标，避免只凭体感判断“慢”。速度指标必须和成功指标一起看；未完成任务的“快”不计入优化成功。

- `TaskSuccess`：是否完成用户请求；完成必须有 `satisfied` Projection、可读 answer、必要 artifact refs、以及与用户当前轮目标一致的 evidence。
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

- `PBT-SPEED-001` - P1/P2 真实 browser 发现 provider/tool 路径可进入长时间 running：已有 backend event 后反复 soft wait，右侧仍显示“主结果等待 ConversationProjection”。需要通用 bounded stall/terminal Projection 策略，但修复必须优先推动任务完成，不能用快速 degraded/failed-with-reason 代替真实 provider/tool 执行。
- `PBT-EVIDENCE-001` - 当前 `verify:single-agent-final` 的 Web matrix 主要是 fixture/scriptable mock；final manifest 缺真实 in-app/browser screenshot、console、network evidence。需要把至少 3 条真实 browser evidence 纳入 final gate。
- `PBT-RESTORE-001` - refresh/reopen 真实路径需要验证 compact storage 是否保留 Projection；否则可能恢复成 projection wait。
- `PBT-SELECTION-001` - artifact 点击可能只是 focus，不一定进入 explicit refs；需要真实浏览器验证 selected old artifact follow-up 是否隔离 latest artifacts。

#### In Progress

暂无。各进程认领后把 owner、端口和 run/session id 写到这里。

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
- 2026-05-16 - Orchestrator - 新建 Parallel Browser Stability & Speed milestone：按 P1-P4 独立端口/状态/workspace/config 拆分并行真实 browser 调试任务；将“对话结果太慢”拆成 speed metrics、provider/tool latency、bounded stall、refresh restore、artifact selection 和真实 evidence gate。

### Current Handoff

Browser Multiturn Stability Sprint 当前进入 Parallel Browser Stability & Speed milestone。下一步按 P1-P4 同时启动独立端口进程和 in-app browser：P1 测 fresh/continue 速度，P2 测 provider/tool latency，P3 测 repair bounded-stop，P4 测 refresh/artifact selection。所有发现必须记录 run/session id、timing、DOM/console evidence，并把慢点归因到 policy、transport、runtime、AgentServer、Projection 或 UI restore 边界后再修。
