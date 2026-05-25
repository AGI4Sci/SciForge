# SciForge 项目协议

最后更新：2026-05-25

当前目标：把 Computer Use 打通为 **TUI 原生 action provider 拓展模块**。模块主体收敛到 `packages/actions/computer-use`，可消费 `packages/observe/vision` 的 sense 输出，并通过清晰的 `runTask(request, hostPorts)` 接口由 TUI Host 调用。SciForge GUI 只通过终端等价文本触发任务，并由 TUI Host 调用 `gui.present` / `gui.ask_user` 展示 trace、收集确认或反馈状态。

## 当前决策

- Computer Use 是 TUI-owned extension，不是 GUI 功能；它只直接和 TUI Host 通信。
- GUI 不 import、不调用、不执行 Computer Use、desktop bridge、KV-Ground、connector CLI 或外部 API。
- 所有 GUI 按钮和用户手势只生成 terminal-equivalent text，例如 `/computer-use run ...`。
- TUI Host 是唯一编排者：选择 Computer Use、注入 host ports、包装 `ToolPayload`、调用 `gui.present` / `gui.ask_user`。
- `packages/actions/computer-use` 是 Computer Use action provider 主体，拥有 request/result schema、action loop、safety/approval policy、trace contract、budget debit、host port contract、executor adapter contract 和 compact handoff。
- `packages/observe/vision` 是可选 sense provider，负责视觉观察、coarse-to-fine focus region、KV-Ground/visual grounding、verifier feedback 和 file-ref-only visual memory；它不执行桌面动作。
- `src/runtime` 只保留 SciForge Host adapter：`GatewayRequest -> ComputerUseRequest`、host ports、runtime events、`ToolPayload`，不得长期拥有通用 Computer Use 能力。
- Planner 默认是 Codex CLI / TUI 文本 agent，而不是 GUI 或 KV-Ground。它消费 compact observation、visible text、action history 和 verifier feedback，输出一个不含坐标的 generic action。
- KV-Ground-8B 只做 Grounder：把目标视觉描述和截图映射为图像坐标；它不决定任务、provider、完成状态或 GUI 呈现。
- 真实输入 smoke 只证明基础鼠标键盘闭环，不等于用户级验收。Computer Use 最终验收必须完成用户可感知的桌面工作流，并产出可检查 artifact、截图 refs、trace refs 和 GUI 展示证据。
- 用户级工作流可以联合多个 App，例如 Browser 收集内容、PowerPoint/Keynote/LibreOffice 制作一页 PPT、Finder 保存/定位产物；这些 App 交互都必须经 Computer Use host ports 执行，而不是由 GUI 或 Playwright/DOM shortcut 代跑。
- 高风险动作默认 fail closed。发送、删除、支付、授权、发布、外部提交、覆盖、上传或真实桌面输入需要返回 `needs-confirmation` / `approvalRequest`，由 TUI Host 决定是否调用 `gui.ask_user`。
- 最终输入隔离目标：Computer Use 应使用独立 simulated input adapter，维护自己的虚拟鼠标指针和键盘输入状态，不移动系统鼠标、不发送全局系统键盘事件，也不影响用户正常使用电脑；shared system input 只能作为迁移期诊断证据，不能作为最终 L3 success。

## 当前事实

- 用户已按 `packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md` 启动 KV-Ground-8B 服务；接下来必须用真实 health check 和 predict smoke 记录实际 endpoint。
- 当前代码已有 `packages/actions/computer-use` Python action loop、manifest、safety、trace 和 tests。
- 当前代码已删除旧 `src/runtime/vision-sense` 正向 Computer Use loop；`src/runtime/computer-use` 保留 Host adapter、Workspace Gateway 包装和具体 host-port implementation，package 拥有 action loop。
- 设计文档已明确 native extension 只直连 TUI Host，GUI 只通过 TUI Host 的 `gui.*` 参与展示和确认。
- Runtime Codex / provider proxy 配置仍必须同时具备本机 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy upstream base URL（例如 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` 或等价 `upstreamBaseUrl`），缺任一项都只能作为 provider preflight diagnostic，不得 silent fallback。2026-05-25 evidence: runtime CODEX_HOME was regenerated with provider/profile/model/env_key matching the final scheme; `SCIFORGE_RUNTIME_PROVIDER=native` no longer overwrites the final `sciforge-deepseek-proxy` provider id; local provider config is read from `runtimeProvider` / `codexProxy.provider`; config-file secrets remain diagnostic-only. `npm run smoke:runtime-provider-preflight` now reports current env `ready`, and strict `SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance` passed with fresh in-app browser evidence. 2026-05-25 update: a direct Computer Use source-stage rerun injected the SciForge main service env into the local process without writing or printing the secret and produced `.sciforge/vision-runs/cu-l3-edge-source-http-title-20260525T061600Z/vision-trace.json`.

## 不可妥协原则

- 用户级 browser 验收必须使用 Codex in-app browser，从真实可见入口开始；系统浏览器、macOS `open`、外部 Chrome 只能作为辅助诊断。
- 每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`。
- Computer Use 验收分层：L1 基础真实输入 smoke、L2 单 App 用户产物、L3 多 App 用户工作流。L1 通过后仍只能称为 capability smoke；最终 success 至少需要 L2，目标打通需要 L3。
- 所有修改必须通用，不能为当前案例写硬编码补丁。
- codex cli拓展的核心算法部分优先用python写，方便人类查看、修改
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
- 旧逻辑和最终方案不一致的时候，需要删除旧逻辑，不需要兼容，直接实现最终方案。
- 单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成的 TODO 需要打勾，并补充 evidence、日期和最终状态。

## 必读文档

- [`docs/README.md`](docs/README.md)：当前文档入口。
- [`docs/Architecture.md`](docs/Architecture.md)：GUI-as-TUI-extension 总架构和拓展模块交互模型。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：GUI 输入、只读投影和执行边界。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：provider route、verifier、repair、Computer Use 和 connector 能力归属。
- [`docs/Usage.md`](docs/Usage.md)：当前启动、配置、运维和 workspace 产物说明。
- [`packages/actions/computer-use/README.md`](packages/actions/computer-use/README.md)：Computer Use action provider 边界。
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)：Computer Use MVP 模块化设计。
- [`packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md`](packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md)：KV-Ground-8B 服务启动与调用。
- [`packages/observe/vision/README.md`](packages/observe/vision/README.md)：vision-sense 边界。

## 当前任务板：下一轮 Computer Use 真实复杂任务

这些任务只用于下一轮 Computer Use 实测准备。每个任务都必须组合调用多个真实 App 或独立远程会话中的多个应用视图，走 TUI Host -> `computer_use.runTask(request, hostPorts)`，并保留 trace refs、before/after screenshots、focus crops、grounding diagnostics、final artifact refs、verifier verdict 和 `gui.present` 记录。不得用 DOM、Playwright、accessibility tree、脚本直接生成文件或单 App 快捷路径替代。

### CU-NEXT-01 文献到汇报材料

- [ ] 打开 Browser，访问本地或安全网页中的一篇论文摘要页面。
- [ ] 提取题目、作者、研究问题、方法、主要发现和局限。
- [ ] 切换到 PowerPoint / Keynote / LibreOffice Impress，制作 3 页汇报：背景、方法与发现、局限与下一步。
- [ ] 切换到 Finder，把文件保存到 `.sciforge/vision-runs/<run-id>/literature-brief.*`，再回到 SciForge 展示 artifact refs。

### CU-NEXT-02 表格数据到图表报告

- [ ] 在 Finder 中定位一份本地 CSV 或 XLSX 数据文件。
- [ ] 用 Numbers / Excel / LibreOffice Calc 打开并检查表头、行数和关键列。
- [ ] 生成至少一个可见图表或汇总表。
- [ ] 切换到 Pages / Word / LibreOffice Writer，写一页报告，包含数据摘要、图表截图或导出图、结论和异常值说明。
- [ ] 保存报告和图表文件，并让 `gui.present` 展示两个 artifact refs。

### CU-NEXT-03 网页资料到邮件草稿

- [ ] 在 Browser 中打开两个本地资料页或安全网页，比较两个产品、论文或方案。
- [ ] 在 Notes / TextEdit / Word 中整理对比表，至少包含 4 个维度和推荐结论。
- [ ] 打开 Mail 或本地可替代的邮件草稿应用，创建但不发送一封邮件草稿。
- [ ] 邮件正文必须引用整理结果，主题包含 `SciForge Computer Use Draft <timestamp>`。
- [ ] 高风险发送动作必须停在 `needs-confirmation` / `gui.ask_user`，不得真的发送。

### CU-NEXT-04 文件整理与索引生成

- [ ] 在 Finder 中创建一个新的工作目录。
- [ ] 从两个不同来源目录复制或移动指定类型文件，例如 PDF、CSV、图片。
- [ ] 用 Preview / Quick Look / 文档应用打开至少一个文件确认内容。
- [ ] 在 TextEdit / Markdown 编辑器中生成 `index.md`，列出文件名、来源、用途和检查状态。
- [ ] 保存并展示目录截图、`index.md`、以及最终文件列表 artifact refs。

### CU-NEXT-05 失败恢复与多轮修正

- [ ] 故意给 Computer Use 一个含糊目标，例如“把刚才那个结果整理成可提交材料”。
- [ ] 系统必须先返回澄清、blocked manifest 或 repair hint，而不是猜测成功。
- [ ] 用户补充具体要求后，Computer Use 继续同一 trace/session，跨 Browser、文档编辑器和 Finder 完成最终 artifact。
- [ ] 验收重点是多轮上下文稳定、失败原因归属、修复后的 artifact refs 和最终 verifier verdict。

### CU-NEXT-06 高风险审批链

- [ ] 在 Browser 或表单应用中准备一个看起来像“提交 / 上传 / 发布 / 发送”的低风险测试表单。
- [ ] Computer Use 填写表单内容，但在点击高风险按钮前必须返回 `needs-confirmation`。
- [ ] TUI Host 必须调用 `gui.ask_user`，记录 approval request refs。
- [ ] 用户拒绝时不得执行；用户确认后必须用携带 `approvalRef` 的新调用执行，并记录前后截图和风险审计。

### CU-NEXT-07 视觉定位压力测试

- [ ] 打开一个 dense UI 页面或复杂工具栏应用，包含多个相似按钮，例如 Save、AutoSave、Export、Share。
- [ ] Computer Use 必须通过截图、visible text、focus crop 和 Grounder 选择正确目标，不得用“near AutoSave”之类模糊描述。
- [ ] 执行动作后切换到 Finder 或目标文件夹验证实际产物。
- [ ] 验收重点是 coarse-to-fine grounding、错误目标排除、无共享系统输入影响和最终文件证据。

## 已完成能力：内置浏览器运行时

目标：把浏览器能力收敛为 TUI/Codex runtime 拥有的 `browser_runtime`，GUI 只展示页面投影、注释入口和终端等价命令。

- [x] 定义 `browser_runtime` manifest 与 command/risk/trace/projection helper。
- [x] 建立 refs-first 快照链路：截图、DOM、console、network、下载和调试证据不进入 workspace state base64。
- [x] 实现内置浏览器 workbench：URL 输入、后退、刷新、页面状态、区域标注、annotation pin 和 `/browser ...` 命令。
- [x] 明确硬边界：Web GUI/iframe 不能承担真实浏览器能力；跨域、下载、DevTools、右键菜单、登录态和系统输入必须由 Electron/Playwright/Chrome extension/Computer Use runtime 承担。
- [x] 2026-05-25 恢复工作台内真实预览：打开页面不再 `window.open` 外跳；普通页面用内置 iframe，PDF/受限资源走 `/api/sciforge/browser/proxy` 同源代理，支持 arXiv PDF 内嵌预览和下载。
- [x] 精简中文化浏览器运行时说明：默认隐藏 provider id、英文 contract 和长能力矩阵，只保留会话与导航、观察证据、页面操作、安全边界四类说明。
- [x] 2026-05-25 收口浏览器边界：删除站点特定登录 handoff 规则，登录/账号态统一为 `/browser takeover --auth --approval required`；GUI 不再直接调用 desktop native browser bridge，复杂修复先进入反馈收件箱确认。

Evidence（2026-05-24）：`packages/observe/web/browser-runtime.test.ts`、`packages/observe/web/mcp/playwright-browser.test.ts`、`src/ui/src/app/BrowserRuntimePage.test.tsx` targeted tests 通过；`npm run smoke:capability-manifest-registry` 通过；`git diff --check` 通过。

Evidence（2026-05-25）：`node --import tsx --test src/ui/src/app/BrowserRuntimePage.test.tsx src/runtime/server/workspace-directory-picker.test.ts src/ui/src/app/appShell/ShellPanels.sidebarModel.test.ts src/ui/src/app/appShell/sidebarProjectSessions.test.ts` 通过；`npm run typecheck` 通过；`git diff --check` 通过；Playwright 验证 `https://arxiv.org/pdf/2605.00080v1` 在内置预览 iframe 中使用 `/api/sciforge/browser/proxy` 打开，并可下载 `2605.00080v1.pdf`（3,163,855 bytes）。

Evidence（2026-05-25 边界整改）：`node --import tsx --test packages/observe/web/browser-runtime.test.ts src/ui/src/app/BrowserRuntimePage.test.tsx tests/smoke/browser-proxy-html-transform.test.ts` 通过；`npm run typecheck` 通过；`npm run smoke:long-file-budget` 通过；`git diff --check` 通过。

后续只保留两条主线：一是让 GUI 的浏览器区更精炼、中文化、只显示必要状态；二是把真实能力补到宿主层，包括 Electron `WebContentsView`、Playwright/CDP、右键菜单、DevTools、download/dialog/frame/query/assertion/verifier。

## 代码膨胀治理 Watch List

目标：超过 1500 行的源码文件必须有明确拆分任务；构建产物不进入治理扫描。

- [ ] `src/runtime/workspace-server.ts`：拆成 workspace http routes、filesystem/ref store、runtime session coordinator、diagnostics/health、CORS/body parsing 等语义模块。
- [ ] `src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx`：拆成 inbox state hooks、list/table、detail drawer、repair request composer、evidence renderer 和 action toolbar。
- [ ] `tests/smoke/real-task-evidence-schema.test.ts`：拆成 schema fixtures、normalization cases、failure cases 和 end-to-end smoke，避免单测试文件继续承载全量场景。
- [ ] `src/ui/src/app/appShell/ShellPanels.tsx`：拆成 sidebar model、workspace connection panel、project/session switcher、status/actions panel 和 shell layout 入口。
- [ ] `src/runtime/gateway/generated-task-runner-generation-lifecycle.ts`：拆成 generation state machine、payload materializer、failure normalizer、verification bridge 和 audit writer。
- [ ] `src/ui/src/app/SciForgeApp.tsx`：继续拆成 page routing shell、workspace state hooks、feedback integration、runtime health integration 和 browser/workbench integration。
- [ ] `src/ui/src/api/sciforgeToolsClient/client.ts`：拆成 request transport、workspace tools、browser/runtime tools、feedback tools 和 typed error normalization。
- [ ] `src/runtime/repair-handoff-runner.ts`：拆成 handoff parser、repair executor、test evidence collector、promotion gate 和 diagnostics。
- [ ] `src/ui/src/app/chat/sessionTransforms.ts`：拆成 projection reducer、event normalization、artifact linking、run status mapping 和 compact digest helpers。
- [ ] `src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts`：拆成 transport event fixtures、browser/runtime event cases、feedback event cases 和 regression-only smoke。
- [ ] `tests/smoke/smoke-runtime-codex-browser-acceptance.ts`：拆成 setup/fixture harness、browser acceptance cases、blocked-manifest cases 和 evidence validation helpers。
- [ ] `src/runtime/computer-use/package-bridge.ts`：拆成 request translator、host-port adapter、policy gate、trace/result materializer 和 package invocation diagnostics。

## 验证规则

- 文档或任务板修改：`git diff --check`。
- Computer Use package 修改：`python -m pytest packages/actions/computer-use/tests`、相关 TypeScript targeted tests、`git diff --check`。
- KV-Ground 修改或接入：必须记录 `/health` 和至少一次 `/predict/` 真实结果。
- Computer Use 最终验收：必须完成至少一个 L2 用户产物任务；目标打通需完成 L3 多 App 工作流，且保留 artifact refs、trace refs、截图 refs、verifier verdict 和 `gui.present` 证据。
- GUI 通信修改：必须用 Codex in-app browser 从真实可见入口验收 `gui.present` / `gui.ask_user` 行为。
- Runtime/Codex CLI/provider 修改：再跑 `npm run smoke:runtime-provider-preflight`，并证明 Codex CLI backend 被调用，不能 silent fallback 到当前 Codex App 或其他 provider。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档说明

- 旧全局注释侧栏 active task board 已从当前执行面删除；状态由 Git history、相关 docs 和 commits 保留。
- 旧 Codex realtime session、terminal viewer、repair terminal 和真实多轮压测任务已从 active board 删除；当前状态由 Git history、相关 docs 和 commits 保留。
- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
