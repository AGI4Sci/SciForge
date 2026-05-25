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

## 当前事实

- 用户已按 `packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md` 启动 KV-Ground-8B 服务；接下来必须用真实 health check 和 predict smoke 记录实际 endpoint。
- 当前代码已有 `packages/actions/computer-use` Python action loop、manifest、safety、trace 和 tests。
- 当前代码仍有 `src/runtime/computer-use` 与 `src/runtime/vision-sense/*computer-use*` 装配和执行逻辑；目标是把通用能力迁到 package，runtime 只做 host adapter。
- 设计文档已明确 native extension 只直连 TUI Host，GUI 只通过 TUI Host 的 `gui.*` 参与展示和确认。

## 不可妥协原则

- 用户级 browser 验收必须使用 Codex in-app browser，从真实可见入口开始；系统浏览器、macOS `open`、外部 Chrome 只能作为辅助诊断。
- 每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`。
- Computer Use 验收分层：L1 基础真实输入 smoke、L2 单 App 用户产物、L3 多 App 用户工作流。L1 通过后仍只能称为 capability smoke；最终 success 至少需要 L2，目标打通需要 L3。
- 所有修改必须通用，不能为当前案例写硬编码补丁。
- codex cli拓展的核心算法部分优先用python写，方便人类查看、修改
- 代码路径保持唯一真相源：发现冗余链路时删除或合并旧链路，避免长期并行实现。
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

## 当前任务板：Computer Use TUI 拓展打通

### CU-00 Preflight 与真实环境确认

- [ ] 记录 KV-Ground endpoint，优先验证 `curl http://127.0.0.1:18081/health`，保存返回摘要。
- [ ] 用一张本机截图走 `/predict/` smoke，确认 `coordinates`、`image_size` 和坐标系符合输入图片尺寸。
- [ ] 确认真实 desktop bridge 配置：`SCIFORGE_VISION_DESKTOP_BRIDGE=1`，并明确是否允许 shared system input。
- [ ] 真实输入前绑定低风险目标窗口；没有独立 input adapter 时，必须显式记录 shared system input acknowledgement。
- [ ] 建立本轮输出目录，例如 `.sciforge/vision-runs/cu-tui-extension-*`，所有截图、trace、audit refs 只写 file refs，不内联 base64。

### CU-01 Package 边界收敛

- [ ] 在 `packages/actions/computer-use` 中定义或提升稳定 `ComputerUseRequest` / `ComputerUseResult` / `ComputerUseHostPorts` contract。
- [ ] 将通用 window target、capture、coordinate mapping、scheduler、executor、trace handoff 策略从 `src/runtime/computer-use` 逐步迁到 `packages/actions/computer-use`，或为迁移登记明确子任务。
- [ ] 保留 `src/runtime` 为薄 Host adapter：只做 config loading、`GatewayRequest` 转换、host port 注入、runtime event 和 `ToolPayload` 包装。
- [ ] 更新 action provider manifest，使对外 surface 表达 `runTask(request, hostPorts)`、refs-first result、approval request 和 trace contract。
- [ ] 删除或合并迁移后冗余链路，避免 `vision-sense runtime loop` 与 `computer-use action provider` 长期并行拥有执行逻辑。

### CU-02 Codex CLI / TUI Planner

- [ ] 明确 Planner contract：输入 `task`、compact observation、visible text、recent actions、verifier feedback；输出 exactly one generic action 或 `done=true`。
- [ ] Planner 由 Codex CLI / TUI 文本 agent 负责，不从 GUI 读取 DOM/accessibility，也不输出坐标。
- [ ] Planner 需要看图时，只能调用 sense provider 获取 observation summary 或 region detail；视觉模型可以作为 sense helper，不成为 action owner。
- [ ] 增加 JSON schema validation：拒绝坐标、app-private shortcut、unsupported action、空 action 和高风险未标注 action。
- [ ] Planner 失败时返回 structured failure 或 repair hint，不假装 GUI action 已执行。

### CU-03 KV-Ground Grounder 接入

- [ ] 将 KV-Ground endpoint 配入 Computer Use grounder provider，默认使用 inline image upload，除非明确存在共享路径映射。
- [ ] Grounder 输入只接受 screenshot ref + target description；输出 window-local / crop-local 坐标、confidence、raw text 和 diagnostics。
- [ ] 实现或验证 coarse-to-fine：整窗 coarse region -> focus crop -> KV-Ground fine point -> executor coordinate mapping。
- [ ] 记录失败诊断：health failure、predict timeout、image path not found、base64 upload failure、坐标越界、低置信度。
- [ ] 确保 trace 只保存 refs、sha256、尺寸、target description、coordinates、provider metadata，不保存 raw screenshot payload。

### CU-04 基础真实输入 smoke

- [ ] 准备 disposable 本地 GUI smoke 页面，包含输入框、按钮和结果文本，避免外部账号/API/网络副作用。
- [ ] 用真实 Computer Use 执行：打开或聚焦目标窗口 -> 点击输入框 -> 输入 `SciForge Computer Use smoke <timestamp>` -> 点击按钮 -> 验证结果文本可见。
- [ ] 全流程必须经过 TUI Host -> `computer_use.runTask(request, hostPorts)`，不能直接用 GUI、Playwright、DOM、accessibility tree 或 app-specific shortcut 偷跑。
- [ ] 记录 trace refs、before/after screenshot refs、focus crop refs、grounding metadata、executor lease、verifier feedback 和 final result。
- [ ] 该任务只标记 `capability-smoke-passed`，不得作为 Computer Use 最终用户级 success。
- [ ] 如果真实输入被权限、焦点、shared input policy 或 desktop bridge 阻断，返回 `blocked` manifest，并写清楚阻断归属。

### CU-05 用户级 Computer Use 验收

- [ ] 设计一个低风险、可重复的单 App 用户产物任务：例如用 PowerPoint、Keynote、LibreOffice Impress 或可离线运行的 slide editor 制作一页 PPT，标题为 `SciForge Computer Use Acceptance <timestamp>`，包含 3 个要点，并保存到 `.sciforge/vision-runs/<run-id>/acceptance-slide.*`。
- [ ] 设计一个多 App 用户工作流：例如 Browser 打开本地资料页或安全网页 -> Computer Use 提取可见要点 -> 切换到 slide app 生成一页 PPT -> Finder/文件对话框保存 -> 回到 GUI 展示 artifact refs 和最终截图 refs。
- [ ] 用户级任务仍必须经过 TUI Host -> `computer_use.runTask(request, hostPorts)`；Planner 由 Codex CLI / TUI 文本 agent 负责，Grounder 用 KV-Ground，Observer/Verifier 用 sense provider 和 layered verifier。
- [ ] 验收证据必须包含：任务文本、App/window 切换 trace、before/after screenshots、focus crops、grounding diagnostics、executor lease、最终 artifact ref、最终可见截图、verifier verdict 和 TUI Host 的 `gui.present` 展示记录。
- [ ] 如果 PPT app、文件保存、跨 App 切换或系统权限不可用，返回 `blocked` manifest；不得降级为 Playwright/DOM/API 生成文件后宣称 Computer Use 成功。

### CU-06 TUI-GUI 通信验收

- [ ] GUI 触发路径只发送 terminal-equivalent text，不直接调用 Computer Use module。
- [ ] TUI Host 接到 Computer Use result 后用 `gui.present` 展示 trace/ref 摘要；GUI 只渲染，不推断 completion/confidence。
- [ ] 构造一个高风险 dry-run 或 blocked action，验证 Computer Use 返回 `needs-confirmation` / `approvalRequest`，TUI Host 再调用 `gui.ask_user`。
- [ ] 用户未确认时不得执行真实高风险动作；确认后必须以新的受控调用携带 `approvalRef`。
- [ ] Codex in-app browser 验收：从 SciForge 可见入口触发 Computer Use 任务，看到 trace/ref 展示和必要的确认交互。

### CU-07 Verification 与回归

- [ ] Python package tests：`python -m pytest packages/actions/computer-use/tests`。
- [ ] Vision tests：至少跑 KV-Ground、coordinates、trace contract 相关 tests，或记录现有阻塞。
- [ ] TypeScript targeted tests：覆盖 runtime adapter、Computer Use policy、trace output、GUI communication guard。
- [ ] `git diff --check`。
- [ ] 如改动 runtime/provider 路径，运行 `npm run smoke:runtime-provider-preflight` 并证明没有 silent fallback。
- [ ] 最终打通前，不得声明 success；只要缺少真实 trace refs、截图 refs 或可见 GUI 展示证据，就标 `partial`。

### CU-08 文档和迁移收口

- [ ] 更新 `docs/Usage.md` 的 Computer Use 操作说明，写清 KV-Ground endpoint、desktop bridge、shared input 风险和 trace 输出。
- [ ] 如新增 contract 或 host port，更新 `docs/Architecture.md` / `docs/NativeExtensionOwnershipMap.md` / package README。
- [ ] 清理旧文案中 “vision-sense 触发真实执行” 的模糊表述，改成 “Computer Use action provider 消费 vision-sense”。
- [ ] 如果 `docs/native-extension-ownership-map.json` 缺失仍阻塞 smoke，补齐或登记为单独 manifest 修复任务。

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
