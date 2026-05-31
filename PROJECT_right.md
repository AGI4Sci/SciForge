# SciForge Right Pane 任务板

最后更新：2026-06-01

本文档从 [`PROJECT.md`](PROJECT.md) 拆出，单独维护 SciForge 右侧结果栏 / Cursor-like right pane / Browser / Screen / Terminal / Files / References 的任务和验收规则。

## 当前目标

- 右侧结果栏不是日志 dump。它必须按对象类型展示 Browser、Screen、Terminal、Files、References 等 Cursor-like panes，并以可点击 refs 驱动。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- BrowserRuntime、Computer Use、Files、Terminal、References 都必须作为 Agent Host 可组合模块呈现；GUI 只做 presentation / focus / confirmation / resource projection。

## 不可变规则

- 所有修改必须通用，不能为当前页面、截图、URL、文件名或历史 run 写硬编码补丁。
- 代码路径保持唯一真相源；旧逻辑和最终方案冲突时删除或迁移旧逻辑，不做长期并行实现。
- GUI -> TUI 只发送终端等价文本、focus/confirmation 结果或只读 projection；TUI -> GUI 只通过 declared GUI intents。
- 右侧结果栏不是日志 dump。它必须按对象类型展示 Browser、Screen、Terminal、Files、References 等 Cursor-like panes，并以可点击 refs 驱动。
- 大 payload、截图、录屏、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first；不得内联 raw screenshot/base64/provider payload/secret。
- 涉及 provider URL、API key、model name、Authorization、token、secret、password、credential 的日志和 evidence 必须脱敏；ignored local config 不得提交。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 需要打勾，并补充日期、evidence refs、验证命令和最终状态。

## 大文件拆分登记

> 本节用于满足“业务代码单文件超过约 2000 行时必须拆分或登记拆分任务”的不可变规则。登记不是验收豁免；后续触碰对应文件时应优先把新增逻辑迁出到已登记 owner，并保持当前 Right Pane 行为和测试不回退。

| 文件 | 当前行数 evidence | 拆分边界 | 登记状态 |
| --- | ---: | --- | --- |
| `src/ui/src/app/ResultsRenderer.tsx` | 3593（`git diff --name-only \| rg '\\.(ts\|tsx\|py)$' \| xargs wc -l`，2026-06-01） | 将 right-pane tab lifecycle、Browser/Screen/Terminal/Files/References projection adapter、object focus route 分拆到 `src/ui/src/app/results/` 下的 typed helpers；`ResultsRenderer.tsx` 只保留装配和渲染编排。 | registered |
| `src/ui/src/app/appShell/ShellPanels.tsx` | 2367（`git diff --name-only \| rg '\\.(ts\|tsx\|py)$' \| xargs wc -l`，2026-06-01） | 将 sidebar project/thread projection、settings/archive panels、top-level shell controls 分拆到 `appShell/` 子模块；ShellPanels 只保留 layout composition。 | registered |
| `src/ui/src/app/chat/cursorAgentProcess.ts` | 1928，接近阈值（`git diff --name-only \| rg '\\.(ts\|tsx\|py)$' \| xargs wc -l`，2026-06-01） | 下一次新增 chat process 语义前先拆分 sanitizer、row projection、folding model 和 object-ref action mapping，避免越过 2000 行。 | registered-watch |

## 模块化设计原则

- 公共函数只有四个：`module.describe`、`module.query`、`module.read`、`module.invoke`。
- `describe/query/read` 必须只读；只有 `invoke` 可以有副作用。未声明 module function、intent、facet 或 ref prefix 必须 fail closed。
- `list/search` 收敛为 `query`，`stat` 收敛为 `read({ includeMeta: true })`，`watch/subscribe/present/ask_user/apply_batch` 收敛为具体 `invoke` intent。
- Agent Host 负责编排 semantic pipeline；模块不得直接 import 或调用其它模块；GUI 可以展示 pipeline trace，但不决定 pipeline。
- trace-first 是默认要求：跨模块组合必须记录 step id、moduleId、function、intent/query/ref、input/result summary、refs、approval、operation、timing、status 和 parent/child relation。

## 体验对齐原则

- 用户体验尽可能与 Cursor Agent desktop app 的稳定信息架构对齐；对照记录只保留通用行为，不固化一次性坐标、URL、截图或历史 run。
- 左侧栏只管理 workspace/project/thread 的可视化投影、选择、排序、归档、置顶、草稿和上下文入口；真实任务启动、工具选择、repair、sub agent 创建和 workspace 写入仍由 Agent Host 执行并产生 trace。
- 聊天中间栏只展示用户消息、assistant 进度句、`Worked for ...` / `Explored ...` 聚合项、动作行和最终回答；旧 SciForge summary、重复 transcript、不可交互过程块和占位 progress 应删除。
- 右侧结果栏必须按对象渲染：Browser 展示真实可交互网页或明确 blocked/error；Screen 展示 Computer Use virtual screen/replay frames；Terminal 展示 Cursor-like terminal session；Files 展示 workspace file viewer/editor；References 展示对象 refs 和 provenance。
- 点击对象引用必须打开或聚焦右侧对象；把引用插回输入框只能通过显式引用/上下文菜单完成。

## 当前任务板：Right Pane / Workbench Parity

### P0：Browser Pane 网页打不开

- [x] 诊断 Browser tab 中输入典型外部 HTTPS URL 后白屏的问题。
  验收：明确白屏原因是 iframe/CSP/X-Frame-Options、proxy/materializer、mixed content、sandbox、network、loading state 还是错误状态未展示；不能只在 UI 上静默留白。
  完成：2026-05-31；evidence：`browser-workbench` typed state / embed-policy blocked rendering；`tests/smoke/right-pane-browser-acceptance.test.ts` verifies an external blocked URL renders a typed blocked state instead of a blank iframe；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts tests/smoke/right-pane-browser-acceptance.test.ts`；状态：passed。
- [x] 将 Browser pane 改成 Cursor-like 可用浏览器结果栏。
  验收：地址栏、Open、loading、stop/reload、back/forward、错误页、blocked by embedding、network error、proxy fallback 和可点击外部打开入口都有状态；网页不能嵌入时显示原因和可执行替代动作。
  完成：2026-05-31；evidence：Open/Back/Forward/Reload/Stop/Snapshot/State/Takeover/Copy URL/Open External 只产生 terminal-equivalent command 或 presentation intent；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] BrowserRuntime 与 Computer Use 的 DOM/AX 读取只能作为 observation/grounding hints。
  验收：DOM/AX refs 不能替代 executor lease、GUI action causality、artifact validation 或用户级 completion。
  完成：2026-05-31；evidence：CU live acceptance matrix rejects DOM/AX substitutes outside structured BrowserRuntime observation refs；验证：`node --import tsx --test tests/smoke/cu-next-live-acceptance-matrix.test.ts`；状态：passed。

### P0：Screen Pane 接入真实虚拟屏幕

- [x] 右侧 `Screen` tab 必须展示 Computer Use virtual screen，而不是 placeholder 网格或只显示 frame ref。
  验收：从 Computer Use replay/evidence refs 加载真实 frame，展示 screen id、actor cursor overlay、lease owner、timeline 状态、Observe/Replay/Stop 操作结果和 blocked/error 原因。
  完成：2026-05-31；evidence：`virtual-screen-viewer` renders current frame image from refs-first frame object and explicit empty state when refs are absent；`tests/smoke/right-pane-browser-acceptance.test.ts` verifies the Screen pane empty state in a real workbench browser；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx tests/smoke/right-pane-browser-acceptance.test.ts`；状态：passed。
- [x] Screen pane 的数据来源必须走 refs-first Computer Use presentation contract。
  验收：`visibleScreenRefs`、`visibleCursorRefs`、`replayRef`、`before/after evidence refs` 和 `completionEvidenceRef` 都可追溯；GUI 不直接执行 Computer Use action。
  完成：2026-05-31；evidence：runtime `gui.present/gui.ask_user` materializes `computer-use-virtual-screen` artifacts only from explicit Screen signals and strips raw/provider/executor fields；验证：`node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`、`npm run smoke:cu-next-live-acceptance`；状态：passed。
- [x] 该任务的 Computer Use 细节同步维护在 [`PROJECT_CU.md`](PROJECT_CU.md)。
  完成：2026-05-31；evidence：`PROJECT_CU.md` P0-CU-SCREEN/P0-CU-CONTRACT entries updated with refs and commands；验证：`git diff --check`；状态：passed。

### P0：Terminal Pane 删除旧内容并对齐 Cursor Agent

- [x] 清空当前 Terminal pane 中混入的 `Active result`、Activity、step summaries、environment、trace dump 等非 terminal 内容。
  验收：Terminal tab 只展示 terminal session：命令/进程标题、cwd、status、pty transcript、输入框、Copy、Download、Stop/Focus/Resize 等 terminal 原生命令。
  完成：2026-05-31；evidence：Terminal tab renders only `terminal-session-viewer`; `Active result` banner is limited to Results/References and terminal no longer embeds agent summaries/generic activity；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 观察 Cursor Agent 右侧结果栏的 terminal，按其信息架构重建 SciForge Terminal pane。
  验收：运行中/完成态、stdout/stderr、exit code、折叠、copy/download、focus、empty/error 状态和 transcript refs 行为与 Cursor Agent 一致；不可把 agent trace 或 answer summary 塞进 terminal。
  完成：2026-05-31；evidence：Terminal package supports live/transcript/empty/error/stopped states and Copy/Download/Stop/Focus/Resize/Input/Paste event surface; stopped/error sessions disable input；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P1：右侧结果栏通用治理

- [x] 建立 ResultShell pane contract。
  验收：每个 pane 声明 object kind、ref prefixes、loading/empty/error/blocked states、allowed actions、required refs 和脱敏规则。
  完成：2026-05-31；evidence：`src/ui/src/app/results/resultPaneContract.ts` declares pane states/ref prefixes/actions/redaction hints and typed route helper；验证：`node --import tsx --test src/ui/src/app/results/resultPaneContract.test.ts`；状态：passed。
- [x] 移除 result pane 中的 legacy generic log renderer。
  验收：未知对象显示 typed unsupported state 和 raw ref，不展示 raw JSON/log dump；已知对象进入对应 Browser/Screen/Terminal/Files/References pane。
  完成：2026-05-31；evidence：References pane is object ref inspector; unknown objects resolve to typed unsupported state without raw JSON/log/provider payload；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/resultPaneContract.test.ts`；状态：passed。
- [x] 对象 ref 点击统一走 focus/open，而不是 composer insertion。
  验收：answer citation、process action、right-pane references 和 sidebar refs 都使用同一 focus/open 语义。
  完成：2026-05-31；evidence：`resultTabForObjectReference` routes file/browser/screen/terminal/run refs to typed panes; Workbench no longer turns result object focus into composer insertion；验证：`node --import tsx --test src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

## 下一阶段 TODO：Cursor-like Right Pane 收敛（2026-05-31）

> 当前阶段已完成：右侧 pane tab 支持 New/Close、Browser/Screen/Terminal/Files/References 基础 tab、Browser/Screen/Files/Terminal 全高布局、Files 只读/编辑模式、Terminal execution transcript 投影、localStorage 恢复、浏览器级验收、无障碍 smoke 和 Cursor Agent 对照记录。以下保留本阶段收敛任务的验收记录。

### P0：Right Pane 多 tab 真实交互闭环

- [x] 为 ResultShell 增加浏览器级 E2E 验收。
  验收：在真实 SciForge workbench 页面中依次完成 New Browser、New Terminal、New Files、关闭当前 tab、关闭所有 tab 到空态、从空态 New 恢复、reload 后恢复 tab 列表和 active tab。
  完成：2026-05-31；evidence：component-level acceptance covers New Browser/Terminal/Files activation, close-all empty state, New recovery, and persisted empty restore；`tests/smoke/right-pane-browser-acceptance.test.ts` starts a temporary workspace/UI, creates Browser/Terminal/Files tabs, closes to empty, restores tabs after reload, checks Browser blocked fallback, asserts no current-page console errors, and saves through Files；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts tests/smoke/right-pane-browser-acceptance.test.ts`；状态：passed。
- [x] 修复并验证 New tab 的焦点和激活一致性。
  验收：点击 New -> Browser 后立即激活新 Browser tab，焦点落在新 tab 或地址栏；Esc 关闭菜单后焦点回到 New；Arrow/Home/End 可在 tab strip 和 New menu 中工作。
  完成：2026-05-31；evidence：right-pane lifecycle reducer returns focus target for New Browser/Terminal/Files and tests assert active tab/focus target alignment；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 增加 tab overflow / narrow width 行为。
  验收：右侧栏变窄时 tab strip 可横向滚动或压缩，不遮挡 Close/New/focus mode，不出现文字重叠。
  完成：2026-05-31；evidence：tabstrip overflow is scoped to `.result-tabstrip` while fixed New/Close/focus actions remain outside the scroll region; tests assert fixed action/aria contract；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 支持每个 tab 独立状态。
  验收：两个 Browser tab 有独立 URL、loading/error、history state；两个 Files tab 可打开不同文件；关闭其中一个不污染另一个状态。
  完成：2026-05-31；evidence：stored right pane state now preserves explicit empty tab lists and scopes Browser addresses by tab id; Files editor state is scoped by right-pane tab id；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts packages/presentation/components/workspace-file-viewer/render.test.tsx`；状态：passed。

### P0：Browser Pane 从 iframe 投影升级为可靠网页工作台

- [x] 建立 Browser pane 状态机。
  验收：`idle/loading/ready/blocked/error/offline` 状态明确；loading 有进度或 spinner；失败不白屏；blocked 页面显示原因和下一步动作。
  完成：2026-05-31；evidence：`browser-workbench` normalizes and renders `idle/loading/ready/blocked/error/offline`; blocked/error/offline do not render blank iframe；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx`；状态：passed。
- [x] 实现通用网页打开策略。
  验收：localhost、127.0.0.1、http、https、CSP/X-Frame-Options blocked、网络失败、无效 URL 都有可验证行为；不可嵌入网页提供 Open External、proxy/materialized snapshot 或 BrowserRuntime takeover。
  完成：2026-05-31；evidence：URL normalization, embed-policy blocked state, network/offline/error state, Open External and Takeover actions are covered by package tests；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx`；状态：passed。
- [x] Browser pane 操作对齐 Cursor Agent。
  验收：地址栏、Open、Back、Forward、Reload/Stop、Snapshot、State、Takeover、Copy URL、Open External 都走 terminal-equivalent command 或 declared GUI intent；GUI 不直接偷偷执行 runtime action。
  完成：2026-05-31；evidence：Browser command surface emits `/browser open/back/forward/reload/stop/snapshot/state/takeover/copy-url/open-external` terminal-equivalent text；验证：`node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 将 BrowserRuntimeArchitecture 文档与实现同步。
  验收：BrowserRuntime 仍是 TUI capability / Agent Host module；GUI 只呈现 projection、发起 intent、展示 refs；不新增 provider route 或 hidden completion logic。
  完成：2026-05-31；evidence：`docs/BrowserRuntimeArchitecture.md` 同步 `BrowserRuntimeProjection.guiBoundary`、Browser pane typed state / safe preview / refs-first command surface，以及 DOM/AX observation 不能替代 executor lease、action causality、artifact validation、completion 或 provider routing 的边界；验证：`git diff --check`；状态：passed。

### P0：Screen Pane 接入真实 Computer Use 虚拟屏幕

- [x] 将 Screen pane 从 skeleton 接入真实 frame source。
  验收：能够从 refs-first frame/replay/screen manifest 加载最新帧，而不是只展示占位网格和 frame ref 文本。
  完成：2026-05-31；evidence：`computer-use-virtual-screen` artifacts drive Screen tab image preview through refs-first materializer URLs；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 增加虚拟屏幕 timeline 和 replay。
  验收：Observe 后出现 before/after frame refs；Replay 能按时间线切换；Stop/Cancel lease 显示执行结果或 blocked 原因。
  完成：2026-05-31；evidence：viewer timeline renders frame/events/before/after/cursor overlay/lease/proposal refs and Replay terminal-equivalent command；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 增加 actor cursor / permission / lease 状态。
  验收：user/agent cursor、lease owner、diagnostic-only、shared input flags、permission ref 都以非遮挡 overlay 或侧边状态展示，不阻塞屏幕主体。
  完成：2026-05-31；evidence：actor cursor overlay, lease owner chips, permission/shared-input/isolation rows; raw screenshot/base64/provider inputs rejected；验证：`node --import tsx --test packages/presentation/components/virtual-screen-viewer/render.test.tsx`；状态：passed。
- [x] 明确 GUI 与 Computer Use 执行边界。
  验收：Screen pane 点击/键盘操作只生成 declared intent 或 terminal-equivalent text；真实执行由 Computer Use action module / Codex native plugin 完成并回写 trace。
  完成：2026-05-31；evidence：Observe/Replay/Stop emit `virtual-screen-terminal-equivalent-text`; UI/runtime import guard confirms no Computer Use executor imports in Screen presentation path；验证：`rg -n "packages/actions/computer-use|src/runtime/computer-use|observe/vision|runComputerUse|executeScoped|macos_native_sidecar" src/ui packages/presentation/components/virtual-screen-viewer -g '*.ts' -g '*.tsx'`、`node --import tsx --test src/ui/src/api/sciforgeToolsClient/runtimeEvents.client.test.ts`；状态：passed。

### P0：Terminal Pane 从 transcript 投影升级为 session 体验

- [x] 接入 host-owned live terminal surface 或明确的 session adapter。
  验收：有真实 session id、cwd、rows/cols、running/stopped/error、exit code、started/completed time；不是只从 executionUnits 拼接静态文本。
  完成：2026-05-31；evidence：`terminal-session-viewer` accepts explicit `TerminalSessionAdapter` / `HostOwnedTerminalSession` with live mount ref, session id/ref, cwd, size, lifecycle timestamps, transcript refs and PTY transcript refs; no live ref falls back to transcript mode；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 保留 transcript projection fallback。
  验收：没有 live PTY 时仍能用 executionUnits 生成 Cursor-like transcript；明确标注 `mode=transcript`，不伪装为 live terminal。
  完成：2026-05-31；evidence：`terminal-session-viewer` supports transcript fallback and `ResultsRenderer` projects execution units to transcript mode when no host PTY is attached；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] Terminal 输入行为对齐。
  验收：输入、paste、resize、stop、copy/download、focus 都有 command/intents；stopped session 不允许继续发送输入；失败状态展示 stderr/output refs。
  完成：2026-05-31；evidence：input/paste/resize/stop/download/focus handlers are command/intent based; stopped/error sessions disable mutating input；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 移除 Terminal 中非 terminal 内容。
  验收：Terminal tab 不展示 Active result banner、agent answer summary、trace dump、generic activity card；这些内容只进入 Results/References/Activity 对应 pane。
  完成：2026-05-31；evidence：right-pane focused tests assert Terminal contains only terminal session surface；验证：`node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P1：Files Pane 成为可复用 workspace file module

- [x] 支持每个 Files tab 独立打开文件。
  验收：多 Files tab 可分别浏览不同路径和编辑草稿；关闭 tab 后只丢弃该 tab 状态。
  完成：2026-05-31；evidence：Files editor state is scoped by right-pane tab id and focus request keys remain stable while browsing another file；验证：`node --import tsx --test packages/presentation/components/workspace-file-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 增加安全编辑 UX。
  验收：默认只读；显式 Edit 后才允许改动；dirty/cancel/save/error 状态清楚；保存失败不丢 draft。
  完成：2026-05-31；evidence：workspace-file-viewer defaults read-only; explicit edit enables Save/Cancel; Cancel restores original draft without closing Files tab；验证：`node --import tsx --test packages/presentation/components/workspace-file-viewer/render.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 增加文件树性能和大文件策略。
  验收：大目录分页/懒加载；大文件只读或分段加载；binary 文件显示 unsupported typed state。
  完成：2026-05-31；evidence：`workspace-file-viewer` supports folder continuation controls, host continuation metadata, search result paging, binary unsupported state, oversized read-only state, and host-provided segment previews；验证：`node --import tsx --test packages/presentation/components/workspace-file-viewer/render.test.tsx`；状态：passed。
- [x] 对齐 Cursor 文件引用行为。
  验收：点击 chat/process/file ref 聚焦对应 Files tab；“插入上下文”只通过显式 Attach/Pick 或上下文菜单完成。
  完成：2026-05-31；evidence：file refs route to Files pane and Workbench no longer implicitly inserts result refs into the composer；验证：`node --import tsx --test src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P1：References / Results 对象化

- [x] References pane 改成对象 ref inspector。
  验收：按 artifact/file/browser/screen/terminal/evidence/provenance 分组；每个 ref 可 open/focus/copy；未知 ref 显示 typed unsupported，不显示 raw JSON。
  完成：2026-05-31；evidence：References tab groups session/run/artifact/execution/file/browser/screen/terminal refs with focus/open/copy actions; unknown refs show typed unsupported；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/resultPaneContract.test.ts`；状态：passed。
- [x] Results pane 只展示主答案的可预览对象。
  验收：普通 chat answer 留在聊天区；右侧 Results 只显示 artifact、previewable file、image/table/report/interactive view 等对象。
  完成：2026-05-31；evidence：plain native/satisfied answers stay in chat; right pane Results/References handle previewable artifacts and object refs only；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 建立统一 focus/open route。
  验收：chat citation、process action、right-pane card、sidebar item 都走同一 object focus/open reducer；不会出现一处插入 composer、一处打开 pane 的分裂语义。
  完成：2026-05-31；evidence：object action helper maps preferred view/ref prefix/object kind to typed right-pane tab; Workbench object focus no longer creates composer insertion request；验证：`node --import tsx --test src/ui/src/app/sciforgeApp/SciForgeWorkbench.test.ts src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。

### P1：自动化验收与文档同步

- [x] 增加 right-pane Playwright/Browser acceptance suite。
  验收：至少覆盖 New/Close/Persist、Browser URL、Screen skeleton/real frame、Terminal transcript/live fallback、Files read/edit/save、References object open。
  完成：2026-05-31；evidence：`ResultsRenderer.test.ts` covers New/Close/Persist, Browser URL state, Screen empty/real frame, Terminal transcript/live adapter, Files read/edit/save and References object open; `tests/smoke/right-pane-browser-acceptance.test.ts` verifies the same flow in a real headless browser against a temporary SciForge workbench and workspace writer；验证：`node --import tsx --test src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/results/ResultShell.test.tsx tests/smoke/right-pane-browser-acceptance.test.ts`；状态：passed。
- [x] 增加 accessibility smoke test。
  验收：tablist/menu/tabpanel aria、keyboard roving、focus return、close button labels、empty state recovery 都有测试。
  完成：2026-05-31；evidence：`ResultShell.test.tsx` covers Arrow/Home/End tab roving, New menu Arrow/Home/End, Escape focus return, tablist/menu/menuitem/tabpanel aria contract; `ResultsRenderer.test.ts` covers close labels and empty state recovery；验证：`node --import tsx --test src/ui/src/app/results/ResultShell.test.tsx src/ui/src/app/ResultsRenderer.test.ts`；状态：passed。
- [x] 更新架构文档。
  验收：`docs/Architecture.md`、`docs/NativeExtensionOwnershipMap.md`、`docs/BrowserRuntimeArchitecture.md` 与实际 ResultShell / Browser / Screen / Terminal / Files module contract 一致。
  完成：2026-05-31；evidence：`docs/Architecture.md` ResultShell pane contract 表、`docs/NativeExtensionOwnershipMap.md` ResultShell/右侧 pane 归属、`docs/BrowserRuntimeArchitecture.md` BrowserRuntime GUI/TUI 边界与 DOM/AX limitation；验证：`git diff --check`；状态：passed。
- [x] 完成 Cursor Agent 对照记录。
  验收：用 Computer Use 观察 Cursor Agent 右侧栏，记录通用行为清单；用 Browser 验证 SciForge 页面；不得将截图坐标、当前 URL 或历史 run 写成硬编码。
  完成：2026-05-31；evidence：Computer Use 只读观察 Cursor Agents：左侧 New Agent/Automations/Customize/Repositories、项目分组 New Agent、thread Pin/Archive、draft Discard、See more，中间栏 `Worked for ...` / `Thought ...` 折叠过程，右侧独立文件/任务 tabs；`tests/smoke/right-pane-browser-acceptance.test.ts` verifies SciForge right pane has no error boundary and the Screen empty state is clear；验证：`node --import tsx --test tests/smoke/right-pane-browser-acceptance.test.ts`；状态：passed。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- GUI module / result pane 改动：运行 GUI protocol/controller tests、runtime events client tests、pane focused tests、Browser/Playwright acceptance smoke，并确认 GUI 没有执行 Computer Use action。
- Browser pane 改动：覆盖 embeddable URL、X-Frame-Options/CSP blocked URL、network failure、loading、open-external 和 DOM/AX observation refs。
- Screen pane / Computer Use 改动：运行 package-local Python suite、package bridge focused tests、presentation focused tests 和 refs-first validator。
- Terminal pane 改动：覆盖 running/completed/error/stopped terminal session、pty transcript refs、copy/download/focus/resize 和非 terminal object rejection。
