# SciForge 项目协议

最后更新：2026-05-21

本文件是当前执行任务板，保留 2026-05-21 GUI-as-TUI-extension 任务和当前验收状态。详细历史证据、parallel worker 细账和旧 P1-P6 run log 不再保留在主入口；需要追溯时看 Git history、`docs/archive/` 或对应 `docs/test-artifacts/**`。

当前目标：完整实现 2026-05-21 更新后的 GUI-as-TUI-extension 方案。

- GUI 是 TUI agent 的 extension，不是 agent host。
- GUI -> TUI 只发送 terminal-equivalent text command。
- TUI -> GUI 通过 normalized events、只读 GUI resources 和 intent-based `gui.*` tools。
- TUI 任务能力和 GUI 展示能力分目录发现。
- 可解析 artifact/file/run 引用必须能在右侧面板预览。
- `confidence` 只能来自 TUI/verifier/harness 的可解释输出，GUI 不制造默认百分比。

## 当前事实

- Runtime Codex 是当前优先路线；SciForge GUI 保留现有 React/Vite 页面体验和 `packages/**` 可复用资产。
- `packages/presentation/components` 是 GUI 展示能力目录，只描述 renderer/viewer/workbench 能力。
- Codex 原生 plugin/skill/tool/MCP/provider/verifier/harness 是 TUI 任务能力目录。
- 短中期桌面化选择 Electron；Tauri 只作为后续长期优化项。
- `docs/` 是产品/架构/协议/用法真相源；backend runtime migration 真相源是 `packages/backend/CodexRuntimeMigration.md`。

LLM/API 注意事项：

- Runtime secret env: `SCIFORGE_RUNTIME_API_KEY`，不要把 API key、token 或 credential 写入仓库文件。
- Runtime upstream env: `SCIFORGE_PROXY_UPSTREAM_BASE_URL`，本机调试使用 ignored local config 或 shell 环境变量。

## 不可妥协原则

- 成本透明，provider/model/profile/workspace/command id 必须可见、可审计、可测试。
- Runtime Codex 默认使用 DeepSeek / provider proxy：`sciforge-runtime-deepseek` profile，当前集成使用 `bailian/deepseek-v4-flash`。
- Runtime Codex 不得静默继承 Developer Codex profile，不得 silent OpenAI fallback。
- raw provider SSE、raw Codex JSONL、stdout、stderr、plugin warning 只进 audit/debug，默认折叠。
- 用户级 browser 验收必须使用 Codex in-app browser，从默认聊天入口开始。
- 多 agent / 多 server 验收前必须做端口预检，并记录实际端口。
- 所有修改必须通用，可泛化到 task type、provider、artifact name 和用户输入变化，不能硬编码当前案例。
- 代码路径保持唯一真相源；发现冗余链路时删除或合并旧链路。
- 不用 `git reset --hard`、`git checkout --` 或等价 destructive command 回退用户改动。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口和核心边界。
- [`docs/Architecture.md`](docs/Architecture.md)：总架构真相源，包含双目录能力发现、引用预览和 confidence 契约。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：TUI/GUI 协议真相源，包含只读 GUI resources、`gui.*` tools、对象引用和 confidence payload。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native extension 归属说明。
- [`docs/native-extension-ownership-map.json`](docs/native-extension-ownership-map.json)：可验证 ownership manifest。
- [`docs/Usage.md`](docs/Usage.md)：当前启动、配置、运维和迁移期兼容说明。
- [`packages/backend/CodexRuntimeMigration.md`](packages/backend/CodexRuntimeMigration.md)：Runtime Codex 迁移路线。
- [`packages/backend/CODEX_COMPATIBILITY.md`](packages/backend/CODEX_COMPATIBILITY.md)：Codex CLI 兼容层说明。

## 实现任务板

本节列任务和当前完成状态；只有已经由代码、targeted tests 或验收 gate 证明的任务才打勾。

### P0：协议实现闭环

- [x] GUI-TUI-01 展示能力目录资源：在 GUI protocol controller 中新增 `/gui/capabilities/presentation.json`、`/gui/renderers/` 和 `/gui/renderers/<componentId>.json` resource tree。数据来源必须是 `packages/presentation/components` 的现有 manifest/registry；TUI 只能通过 `gui.list/read/search/stat/watch` 发现，不得 import React 组件或读取 GUI 私有对象。

- [x] GUI-TUI-02 Runtime Codex MCP/resource 注入：把新增 presentation catalog resources 纳入 Runtime Codex 注入的 `gui.*` MCP/resource surface。`gui.read('/gui/capabilities/presentation.json')`、`gui.search({ scope: '/gui/capabilities' })` 和单个 renderer resource 必须在 Codex runtime path 可用，且保持只读，不产生 workspace mutation。

- [x] GUI-TUI-03 展示目录搜索语义：为 presentation catalog 建立 bounded semantic search index，支持按 component id、title、artifact type、preview kind、agent summary 搜索。搜索结果只能描述 renderer/viewer 能力，不能输出 task capability ranking、provider route 或算法建议。

- [x] GUI-TUI-04 对象引用统一解析：扩展消息和报告渲染中的 object reference pipeline，支持显式 `artifact:`、`file:`、`folder:`、`run:` 等 ref，也支持能精确匹配当前 session artifact 或 workspace file 的裸文件名。无法解析到真实对象的 inline code 必须保持普通文本，不能伪装成可点击引用。

- [x] GUI-TUI-05 右侧面板预览聚焦：点击可解析 artifact/file/run 引用时必须聚焦右侧面板，并通过 GUI 展示能力目录选择合适 renderer。Markdown 文件例如 `arxiv_multi_agent_report_20260521.md` 应能进入 report/markdown 预览；预览失败只能显示展示错误，不能改变 task success/failure 判断。

- [x] GUI-TUI-06 `gui.present` 与本地点击一致性：TUI 显式调用 `gui.present({ intent: 'focus-existing', ref, hint })` 与用户点击 inline object reference 必须走同一右侧预览/focus 路径，返回 applied/deferred/rejected/suggestion 结果，并遵守 revision/precondition。

- [x] GUI-TUI-07 Confidence 来源收敛：移除 GUI/normalizer 中所有默认 `0.78` 或类似默认百分比。`message.confidence`、claim confidence 和 result confidence 只有在 TUI/verifier/harness payload 明确给出时才展示；缺失时隐藏百分比或显示“未评分”。

- [x] GUI-TUI-08 Confidence explanation contract：新增或补齐 `confidenceExplanation` 结构化契约，至少覆盖 `evidenceLevel`、`sourceScore`、`evidenceDefault`、`evidenceCap`、`penalties` 和 `summary`。GUI 只渲染 explanation，不计算 truth；TUI/verifier/harness 负责公式、扣分和 evidence refs。

- [x] GUI-TUI-09 旧 AgentServer/UI 文案清理：清理当前 UI/workbench/runtime 中把 `availableComponentIds`、component allowlist 或能力发现描述成 AgentServer/capability gateway 的文案。最终表述必须区分 GUI presentation catalog 与 TUI-native task capabilities。

- [x] GUI-TUI-10 TUI--GUI 接口通信排查：逐项审计 Runtime Codex path，确认 GUI -> TUI 只发送 terminal-equivalent `commandText`，TUI -> GUI 只通过 normalized events、`gui.*` intent tools 和只读 GUI resources 通信。发现 direct business function、hidden payload、GUI ranking 或 GUI truth judgment 时登记并修复。

### P1：测试与验收任务

- [x] GUI-TUI-11 Protocol controller 单测：为 `/gui/capabilities/presentation.json`、`/gui/renderers/<componentId>.json`、`gui.list/read/search/stat` 新增 focused tests，验证 schema、bounded output、只读语义、search scope 和不存在 component 的错误返回。

- [x] GUI-TUI-12 Runtime Codex MCP 注入测试：新增或扩展 `src/runtime/codex` targeted tests，证明新增 GUI resources/tools 注入到 Codex runtime，且不会携带 workspace mutation、task capability ranking 或 React component internals。

- [x] GUI-TUI-13 Inline reference 渲染测试：更新 message/report markdown tests，覆盖显式 refs、裸 markdown filename、重复 basename、不可解析 inline code、URL、artifact/file provenance 和点击后 `onObjectReferenceFocus`。旧测试若断言“绝不扫描文本 ref”，必须改为“只升级可解析真实对象”。

- [x] GUI-TUI-14 右侧预览 browser 验收：用 Codex in-app browser 从默认聊天入口验证真实 artifact filename inline code 可点击并聚焦右侧预览；同时验证不可解析 code 片段不可点击。证据需包含 DOM、截图、selected refs、focused panel、renderer id 和 command/run id。
  状态：passed；证据：`docs/test-artifacts/runtime-codex-browser-acceptance/inline-reference-right-panel-dom.txt`、`docs/test-artifacts/runtime-codex-browser-acceptance/inline-reference-right-panel.png`、`docs/test-artifacts/runtime-codex-browser-acceptance/r-proto-05-click-real-inline-structured-refs-dom.txt`。

- [x] GUI-TUI-15 Confidence browser 验收：用 default-chat 触发一个没有 TUI/verifier confidence 的 native assistant message，确认不显示默认 78%；再触发一个带 `confidence` + `confidenceExplanation` 的结果，确认显示百分比、解释和 evidence refs，且 GUI 没有本地计算。
  状态：passed；证据：`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-unscored-dom.txt`、`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-positive-dom.txt`、`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-partial-dom.txt`、`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-three-turn-summary.json`。

- [x] GUI-TUI-16 Release gate 串联：把新增协议/渲染/confidence 测试纳入 touched-area gate。完成代码实现后至少跑 `npm run typecheck`、targeted tests、`npm run smoke:native-extension-ownership`、`git diff --check`，Runtime/GUI 修改还需跑匹配的 in-app browser 验收。
  状态：passed；证据：targeted UI/normalizer/object-ref tests、`npm run smoke:real-task-matrix`、`npm run smoke:native-extension-ownership`、`npm run smoke:runtime-codex-browser-acceptance`、`npm run smoke:web-multiturn-final`、`npm run smoke:single-agent-final-evidence`。

### P2：真实多轮压测新增场景

- [x] R-PROTO-04 GUI presentation catalog discovery：第一轮生成多类型 artifacts；第二轮要求 agent 通过 `gui.list/read/search` 说明 GUI 当前能用哪些 renderer 预览这些 artifacts；第三轮让 TUI 调 `gui.present` 聚焦其中一个 artifact。必须证明 discovery 来自 `/gui/capabilities/presentation.json` 或 `/gui/renderers/<componentId>.json`，不是 React import、AgentServer gateway 或 GUI task ranking。
  状态：passed；证据：`docs/test-artifacts/real-tasks/R-PROTO-04/manifest.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/r-proto-04-summary.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/r-proto-04-three-turn-dom.txt`。

- [x] R-PROTO-05 Inline artifact reference right-panel preview：第一轮生成至少两个 markdown/table artifacts，其中一个在 assistant 文本里以裸文件名 inline code 出现；第二轮点击该裸文件名并验证右侧面板预览；第三轮切换到不可解析 inline code 和重复 basename 场景。必须证明只有可解析真实对象会升级为引用，且预览不改变 task truth。
  状态：passed；证据：`docs/test-artifacts/real-tasks/R-PROTO-05/manifest.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/r-proto-05-summary.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/r-proto-05-click-real-inline-structured-refs-dom.txt`。

- [x] R-VERIFY-02 Confidence source and explanation：第一轮生成无 verifier confidence 的普通回答，必须不显示默认百分比；第二轮生成 tool-backed 或 verifier-backed result，要求输出 `confidenceExplanation`；第三轮制造 partial/blocked 或 contradictory evidence，验证 confidence 降低并列出 penalties。必须证明 GUI 不计算 confidence，所有分数来自 TUI/verifier/harness payload。
  状态：passed；证据：`docs/test-artifacts/real-tasks/R-VERIFY-02/manifest.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-three-turn-summary.json`、`docs/test-artifacts/runtime-codex-browser-acceptance/confidence-three-turn-dom.txt`。

## 验收规则

- 文档或任务板修改：`git diff --check`。
- 代码修改：`npm run typecheck`、touched areas 的 targeted tests、`git diff --check`。
- Runtime/GUI 修改：再跑 `npm run smoke:runtime-provider-preflight`、`npm run smoke:runtime-codex-browser-acceptance` 和至少一个匹配 touched area 的 Codex in-app browser 验收。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。
- 真实 browser E2E 是最终验收；terminal smoke 只能补充。
- Pass 必须同时有 visible UI、workspace artifact 或明确无产物理由、audit refs、命令/测试输出；缺一项不能打勾。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。
