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

- 打开 Browser，访问本地或安全网页中的一篇论文摘要页面。
- 提取题目、作者、研究问题、方法、主要发现和局限。
- 切换到 PowerPoint / Keynote / LibreOffice Impress，制作 3 页汇报：背景、方法与发现、局限与下一步。
- 切换到 Finder，把文件保存到 `.sciforge/vision-runs/<run-id>/literature-brief.*`，再回到 SciForge 展示 artifact refs。

### CU-NEXT-02 表格数据到图表报告

- 在 Finder 中定位一份本地 CSV 或 XLSX 数据文件。
- 用 Numbers / Excel / LibreOffice Calc 打开并检查表头、行数和关键列。
- 生成至少一个可见图表或汇总表。
- 切换到 Pages / Word / LibreOffice Writer，写一页报告，包含数据摘要、图表截图或导出图、结论和异常值说明。
- 保存报告和图表文件，并让 `gui.present` 展示两个 artifact refs。

### CU-NEXT-03 网页资料到邮件草稿

- 在 Browser 中打开两个本地资料页或安全网页，比较两个产品、论文或方案。
- 在 Notes / TextEdit / Word 中整理对比表，至少包含 4 个维度和推荐结论。
- 打开 Mail 或本地可替代的邮件草稿应用，创建但不发送一封邮件草稿。
- 邮件正文必须引用整理结果，主题包含 `SciForge Computer Use Draft <timestamp>`。
- 高风险发送动作必须停在 `needs-confirmation` / `gui.ask_user`，不得真的发送。

### CU-NEXT-04 文件整理与索引生成

- 在 Finder 中创建一个新的工作目录。
- 从两个不同来源目录复制或移动指定类型文件，例如 PDF、CSV、图片。
- 用 Preview / Quick Look / 文档应用打开至少一个文件确认内容。
- 在 TextEdit / Markdown 编辑器中生成 `index.md`，列出文件名、来源、用途和检查状态。
- 保存并展示目录截图、`index.md`、以及最终文件列表 artifact refs。

### CU-NEXT-05 失败恢复与多轮修正

- 故意给 Computer Use 一个含糊目标，例如“把刚才那个结果整理成可提交材料”。
- 系统必须先返回澄清、blocked manifest 或 repair hint，而不是猜测成功。
- 用户补充具体要求后，Computer Use 继续同一 trace/session，跨 Browser、文档编辑器和 Finder 完成最终 artifact。
- 验收重点是多轮上下文稳定、失败原因归属、修复后的 artifact refs 和最终 verifier verdict。

### CU-NEXT-06 高风险审批链

- 在 Browser 或表单应用中准备一个看起来像“提交 / 上传 / 发布 / 发送”的低风险测试表单。
- Computer Use 填写表单内容，但在点击高风险按钮前必须返回 `needs-confirmation`。
- TUI Host 必须调用 `gui.ask_user`，记录 approval request refs。
- 用户拒绝时不得执行；用户确认后必须用携带 `approvalRef` 的新调用执行，并记录前后截图和风险审计。

### CU-NEXT-07 视觉定位压力测试

- 打开一个 dense UI 页面或复杂工具栏应用，包含多个相似按钮，例如 Save、AutoSave、Export、Share。
- Computer Use 必须通过截图、visible text、focus crop 和 Grounder 选择正确目标，不得用“near AutoSave”之类模糊描述。
- 执行动作后切换到 Finder 或目标文件夹验证实际产物。
- 验收重点是 coarse-to-fine grounding、错误目标排除、无共享系统输入影响和最终文件证据。

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
