# SciForge 项目协议

最后更新：2026-05-26

当前目标：先把 Computer Use 收敛成 **Codex CLI 可独立加载/调用的 action provider 插件拓展**。当前工作面只切到 `packages/actions/computer-use`，必要时只读取 `packages/observe/vision` 中的 sense/VLM helper 契约；先完成独立插件最小闭环，再考虑接回 SciForge `src/runtime` Host adapter、GUI 展示、CU-NEXT L2/L3 和 release 验收。

## 当前决策

- Computer Use 是 TUI-owned extension，不是 GUI 功能；它只直接和 TUI Host 通信。
- GUI 不 import、不调用、不执行 Computer Use、desktop bridge、KV-Ground、connector CLI 或外部 API。
- 所有 GUI 按钮和用户手势只生成 terminal-equivalent text，例如 `/computer-use run ...`。
- TUI Host 是唯一编排者：选择 Computer Use、注入 host ports、包装 `ToolPayload`、调用 `gui.present` / `gui.ask_user`。
- `packages/actions/computer-use` 是 Computer Use action provider 主体，拥有 request/result schema、action loop、safety/approval policy、trace contract、budget debit、host port contract、executor adapter contract 和 compact handoff。
- 当前 active phase 只把 `packages/actions/computer-use` 做稳：它必须能作为独立 Codex CLI 插件/拓展被发现、加载、用 package-local host-port fixture 或本机 host ports 跑通最小任务，并写出 file-ref-only trace/result。
- 在独立插件闭环完成前，默认不修改 `src/runtime`、GUI、CU-NEXT runner、browser acceptance、AgentServer 或 release gate；这些只作为后续集成层。
- `packages/observe/vision` 是可选 sense provider，负责视觉观察、coarse-to-fine focus region、KV-Ground/visual grounding、verifier feedback 和 file-ref-only visual memory；它不执行桌面动作。
- `src/runtime` 只保留 SciForge Host adapter：`GatewayRequest -> ComputerUseRequest`、host ports、runtime events、`ToolPayload`，不得长期拥有通用 Computer Use 能力。
- Planner 默认是 Codex CLI / TUI 文本 agent，而不是 GUI 或 KV-Ground。它消费 compact observation、visible text、action history 和 verifier feedback，输出一个不含坐标的 generic action。
- KV-Ground-8B 只做 Grounder：把目标视觉描述和截图映射为图像坐标；它不决定任务、provider、完成状态或 GUI 呈现。
- 真实输入 smoke 只证明基础鼠标键盘闭环，不等于用户级验收。Computer Use 最终验收必须完成用户可感知的桌面工作流，并产出可检查 artifact、截图 refs、trace refs 和 GUI 展示证据。
- 用户级工作流可以联合多个 App，例如 Browser 收集内容、PowerPoint/Keynote/LibreOffice 制作一页 PPT、Finder 保存/定位产物；这些 App 交互都必须经 Computer Use host ports 执行，而不是由 GUI 或 Playwright/DOM shortcut 代跑。
- 高风险动作默认 fail closed。发送、删除、支付、授权、发布、外部提交、覆盖、上传或真实桌面输入需要返回 `needs-confirmation` / `approvalRequest`，由 TUI Host 决定是否调用 `gui.ask_user`。
- 最终输入隔离目标：Computer Use 应使用独立 simulated input adapter，维护自己的虚拟鼠标指针和键盘输入状态，不移动系统鼠标、不发送全局系统键盘事件，也不影响用户正常使用电脑；shared system input 只能作为迁移期诊断证据，不能作为最终 L3 success。

## 当前事实

- 用户已按 `packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md` 启动 KV-Ground-8B 服务。当前默认本机端口是 `18081`；最新 KV-Ground smoke manifest 应记录在 `.sciforge/vision-runs/kv-ground-smoke-*/kv-ground-smoke.json`。该证据只证明 Grounder service alive，不等于 L2/L3 用户级 Computer Use 验收。
- 当前代码已有 `packages/actions/computer-use` Python action loop、manifest、safety、trace 和 tests。
- 当前代码已删除旧 `src/runtime/vision-sense` 正向 Computer Use loop；`src/runtime/computer-use` 保留 Host adapter、Workspace Gateway 包装和具体 host-port implementation，package 拥有 action loop。
- 设计文档已明确 native extension 只直连 TUI Host，GUI 只通过 TUI Host 的 `gui.*` 参与展示和确认。
- 2026-05-26 scope reset: 当前仓库很大且有大量未提交集成改动，后续执行必须先缩小工作面。除非任务明确进入集成阶段，否则只调试 `packages/actions/computer-use` 独立插件闭环；不要为了插件问题全仓库搜索、读取 `src/runtime` 细节或启动 CU-NEXT 真实长跑。
- 2026-05-26 local model config: Computer Use 独立插件调试使用仓库根目录的 ignored 本地文件 `config.computer-use.local.json`。该文件保存 text LLM / VLM 的 base URL、API key 和模型名，不进入 Git；`PROJECT.md` 只能引用路径和用途，不得写入密钥。调试 Codex CLI / Computer Use 时，text planner 使用便宜的 `bailian/deepseek-v4-flash`，VLM helper 使用 `qwen3.6-plus`。如果该文件缺失，先从 `config.local.json` 或本机 secret store 生成，不要在命令输出或文档中打印 secret。
- Runtime Codex / provider proxy 配置仍必须同时具备本机 `SCIFORGE_RUNTIME_API_KEY` 和 provider proxy upstream base URL（例如 `SCIFORGE_PROXY_UPSTREAM_BASE_URL` 或等价 `upstreamBaseUrl`），缺任一项都只能作为 provider preflight diagnostic，不得 silent fallback。Runtime provider/profile/model/env_key 必须从当前 runtime config 和 service env 解析，不能在验收脚本里写死某个 provider 或模型；config-file secrets 只能作为本机 diagnostic fallback，不能满足 release/browser acceptance。当前 `docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json` 仍是 `blocked` 时，历史 browser pass 或 config-file debug fallback 不能作为当前 release/browser acceptance。
- 2026-05-25 update: CU-NEXT runner/readiness tooling is hardened but task completion remains blocked. `computer-use-next:run-scenario` now projects passed real CU-LONG runs into task-scoped L3 `cu-user-acceptance-manifest.json`; L3 projection rejects dry-run, fixture-mode, missing structured CU-NEXT taskId, shared system input, missing independent input adapter, missing bundle-local evidence files, and weak `gui.present` evidence. CU-LONG round evidence now copies package-bridge sibling files and direct run artifacts into `evidence/round-XX`, rewrites copied JSON refs to bundle-local refs, validates screenshots against the copied trace directory, and points diagnostics at copied trace evidence before projection. Runtime planner now receives a generic refs-first `plannerAcceptanceContract` from task/scenario metadata instead of task-id-specific prompt rules; real independent-input execution trace must include executor scheduler lease acquire/release evidence. Latest focused real probe confirms the acceptance contract and scheduler lease appear in copied trace evidence, but it remains diagnostic-only because it intentionally stops before full CU-LONG/CU-NEXT completion. Current command evidence: `npm run smoke:real-task-matrix`, targeted package bridge / planner / CU-NEXT tests, CU-LONG deep smoke, `npm run typecheck -- --pretty false`, and `git diff --check` pass; `node --import tsx tools/cu-next-run.ts readiness` still reports `blocked` with `0/7` passed because no real L3 task acceptance and current in-app browser release acceptance are complete.
- 2026-05-26 handoff: current patch set is still in progress and must be treated as uncommitted integration work, not release evidence. Runtime side now has generic provider/runtime registry work for AgentServer and generated-task lifecycle, central AgentServer backend/base URL policy, dynamic CU-NEXT task map loading, task-scoped CU-NEXT run/readiness tooling, stronger L3 harness checks, and package bridge propagation for planner acceptance contract plus scheduler lease evidence. Computer Use side now has generic round-scope planner instructions, stricter current-round completion evidence, platform-incompatible hotkey retry guidance, retry diagnostics that preserve the failed initial and retry plans, and independent-input adapter state that records both local pointer coordinates and executor/screen coordinates. These changes are intended to remove hardcoded task/provider assumptions and must remain generic.
- 2026-05-26 real CU-NEXT-04 probes: KV-Ground is live on `http://127.0.0.1:18081`; runtime uses the normal SciForge LLM API key source, `deepseek-v4-flash` for text planning, and `qwen3.6-plus` may be used for visual VLM work. The earlier `max_steps=8` boundary blocker is fixed by a final no-execute completion check in the Python loop: after the action budget is consumed, the loop may observe once more and accept `done=true` without executing an extra action. The latest real 4-round CU-LONG-005 probe passed rounds 1-4, but CU-NEXT-04 `validate-run` remains `repair-needed` because the task-scoped L3 user acceptance manifest is `blocked` on missing `final-artifact-ref`.
- 2026-05-26 next implementation target: follow the递进测试与算法优化策略 below. First add a simple artifact-producing Computer Use task that creates or identifies one visible local file ref and proves bundle-local `final-artifact-ref`; then increase complexity toward CU-NEXT-04's full `index.md` + final file list workflow. Single-window / single-app probes are algorithm and evidence-contract probes only; they do not satisfy CU-NEXT L3 multi-app acceptance. Do not mark CU-NEXT-04 complete until `evidence/round-04/cu-user-acceptance-manifest.json` has status `multi-app-workflow-passed` and `tools/cu-next-run.ts validate-run --task CU-NEXT-04` is ok.
- 2026-05-26 verification already observed on the current patch set: targeted vision planner tests, text planner tests, host adapter/package bridge tests, independent input adapter tests, CU-NEXT runner/readiness/user-acceptance harness tests, gateway AgentServer/provider registry tests, trace-contract tests, CU-LONG deep smoke, `python -m pytest packages/actions/computer-use/tests`, `npm run smoke:agentserver-supplement`, `npm run smoke:runtime-provider-preflight`, `npm run typecheck -- --pretty false`, and `git diff --check` have passed in focused combinations during the integration run. Re-run the affected subset after each next artifact-producing algorithm change.
- 2026-05-26 coordinate finding: negative executor coordinates are normal on macOS multi-display layouts when the target window has negative screen bounds. The bug class to guard is not "negative coordinate" by itself; it is mixing screen/executor coordinates with window-local pointer state. Independent input traces should preserve both coordinate spaces and validators should reject window-local pointer coordinates that are outside the target window-local bounds even if screenshots changed.

## 不可妥协原则

- 用户级 browser 验收必须使用 Codex in-app browser，从真实可见入口开始；系统浏览器、macOS `open`、外部 Chrome 只能作为辅助诊断。
- 每个 claimed success 都要能对应到实际文件改动、命令输出、browser/DOM/截图证据或明确的 blocked manifest；缺任何一项只能标 `partial` / `blocked`。
- 当前独立插件阶段的 claimed success 只以 `packages/actions/computer-use` 内的插件 manifest、Python package API、CLI/fixture run、trace/result refs 和 package-local tests 为准；不得用 SciForge runtime bridge 或 CU-NEXT harness 替代插件闭环证据。
- Computer Use 验收分层：L1 基础真实输入 smoke、L2 单 App 用户产物、L3 多 App 用户工作流。L1 通过后仍只能称为 capability smoke；最终 success 至少需要 L2，目标打通需要 L3。
- Artifact-producing acceptance 必须同时具备 bundle-local `final-artifact-ref`、最终可见产物截图、verifier verdict 和 `gui.present` 展示证据；缺任一项只能算 probe/diagnostic，不得声明产物验收通过。
- 产物任务的 `done=true` 必须由当前轮视觉证据和文件证据支撑，不能只引用 prior-round ledger、历史 `done`、旧截图或旧 trace 摘要当作完成证明。
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

## 当前任务板：Computer Use 独立插件最小闭环

当前唯一 active board 是把 `packages/actions/computer-use` 做成 Codex CLI 可独立调用的插件拓展。后续 agent 必须先完成本节，再进入 SciForge runtime bridge 或 CU-NEXT 任务。默认不要读取整个仓库；优先只看：

- `packages/actions/computer-use`
- `packages/observe/vision` 中被 Computer Use 直接消费的 sense/VLM helper 契约
- 必要的插件 manifest / marketplace / CLI shim 文件

### 独立插件闭环步骤

- [ ] 固化插件边界：`packages/actions/computer-use` 拥有 request/result schema、loop、safety、trace、budget、host-port contract 和 compact handoff；SciForge `src/runtime` 只作为后续 host adapter。
- [ ] 补齐 Codex CLI 插件/拓展发现面：明确插件 manifest、入口命令、package-local CLI 调用方式、host-port fixture 运行方式和输出 trace/result refs。
- [ ] 跑通最小 fixture 闭环：用 package-local fixture host ports 完成一个低风险单步 action，验证 observation、planner、executor、verifier、trace、budget debit 和 compact handoff。
- [ ] 跑通两三步 package-local 闭环：包含 observe -> plan -> execute -> observe -> verify -> done/no-execute completion，不依赖 SciForge runtime bridge。
- [ ] 跑通最小 artifact-producing 闭环：生成或识别一个本地可见文件 ref，证明 `finalArtifactRef` / `finalArtifactRefs` 能从 package trace/result 稳定提升。
- [ ] 再接入可选视觉能力：Planner 仍由 text LLM/CLI 负责动作协议，VLM 只作为视觉摘要/语义 verifier helper；Verifier 先跑 deterministic checks，再用 `qwen3.6-plus` 做可选语义补充。
- [ ] 独立插件闭环完成后，才恢复 SciForge `src/runtime` host adapter、GUI `gui.present` / `gui.ask_user`、CU-NEXT L2/L3 和 release 验收。

### 暂缓的 SciForge 集成与 CU-NEXT 真实复杂任务

以下任务只在独立插件最小闭环稳定后恢复。递进 probe 可以先限制在单窗口或单 App 内，用来修算法、输入、验证和证据契约；CU-NEXT L3 任务必须组合调用多个真实 App 或独立远程会话中的多个应用视图，走 TUI Host -> `computer_use.runTask(request, hostPorts)`，并保留 trace refs、before/after screenshots、focus crops、grounding diagnostics、final artifact refs（bundle-local `final-artifact-ref`）、最终可见产物截图、verifier verdict 和 `gui.present` 记录。不得用 DOM、Playwright、accessibility tree、脚本直接生成文件或单 App 快捷路径替代。

### 递进测试与算法优化策略

- [ ] 先跑最小单步任务：同一目标窗口内执行一个低风险 click、press_key 或 wait，并验证 screenshot refs、grounding、executor、verifier、action ledger 和 `gui.present` 都完整；该层是 single-window probe，不等于 CU-NEXT L3。
- [ ] 再跑两到三步单 App 任务：包含观察 -> 动作 -> 再观察 -> planner done/no-execute 判断，优先暴露 max_steps、重复动作、当前视觉证据和 verifier feedback 问题；如产出文件，必须检查 bundle-local `final-artifact-ref`、最终可见截图、verifier verdict 和 `gui.present` 证据。
- [ ] 再增加动作类型复杂度：逐步加入 double_click、scroll、drag、platform recovery hotkey、type_text；每新增一类动作都先在单 App 内验证，再进入跨 App 工作流。
- [ ] 再增加跨轮记忆复杂度：从 round 1 refs-only memory 开始，逐步加入 round 2/3/4 的 file-ref-only handoff，确认 planner 不能把 prior-round ledger 当作 current-round 完成证据。
- [ ] 最后进入 CU-NEXT L2/L3：只有简单层级通过后，才运行 CU-NEXT-04 这类多轮、多动作、多证据任务；失败时回退到能复现问题的最小层级修算法。CU-NEXT L3 必须证明多 App 工作流和 task-scoped acceptance，不接受单 App probe 顶替。
- [ ] 每次算法优化都必须是通用改动：先补对应最小测试，再跑递进层级中受影响的最小真实 probe，不能直接为了某个 CU-NEXT round 写特例。

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

## 验证规则

- 文档或任务板修改：`git diff --check`。
- 独立插件阶段：默认只跑 `python -m pytest packages/actions/computer-use/tests`、插件 manifest/CLI fixture 验证和 `git diff --check`。不要为了 package-only 改动启动 CU-NEXT、browser acceptance、AgentServer、全仓库 typecheck 或 release gate。
- Computer Use package 修改：`python -m pytest packages/actions/computer-use/tests`、相关 TypeScript targeted tests、`git diff --check`。
- KV-Ground 修改或接入：必须记录 `/health` 和至少一次 `/predict/` 真实结果。
- Computer Use 最终验收：必须完成至少一个 L2 用户产物任务；目标打通需完成 L3 多 App 工作流，且保留 artifact refs、trace refs、截图 refs、verifier verdict 和 `gui.present` 证据。
- GUI 通信修改：必须用 Codex in-app browser 从真实可见入口验收 `gui.present` / `gui.ask_user` 行为。
- Runtime/Codex CLI/provider 修改：再跑 `npm run smoke:runtime-provider-preflight`，并证明 Codex CLI backend 被调用，不能 silent fallback 到当前 Codex App 或其他 provider。
- Release 或大范围迁移：再跑 `npm run smoke:no-hardcoded-success`、`npm run smoke:no-legacy-paths`、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:runtime-provider-preflight`、`npm run verify:single-agent-final`；真正 release 必须跑 `npm run verify:single-agent-release`，必要时 `npm run test` 和 `npm run build`。

## 本地 worktree 策略

- 本项目开发基于 `dev` 分支进行；长期只保留 `main` 和 `dev`。
- `config.local.json`、`.sciforge/**` 和 `packages/backend/.codex-runtime/**` 是本机状态，不进入 git。
- `config.computer-use.local.json` 是 Computer Use 调试专用的本机模型配置，保存 text LLM / VLM base URL、API key 和模型名；它匹配 `.gitignore` 的 `config.*.local.json`，不得提交。
- `docs/test-artifacts/**` 默认只作为本地验收证据；需要入库前必须确认体积、隐私和复现价值。
- 不用 `git reset --hard` 或 `git checkout --` 回退用户改动。
- 清理 worktree 时只删除明确生成的缓存、临时 workspace 和构建产物。

## 历史归档说明

- 旧全局注释侧栏 active task board 已从当前执行面删除；状态由 Git history、相关 docs 和 commits 保留。
- 旧 Codex realtime session、terminal viewer、repair terminal 和真实多轮压测任务已从 active board 删除；当前状态由 Git history、相关 docs 和 commits 保留。
- `docs/archive/` 保存旧 active task boards 和 detailed run histories。
- `docs_old/` 保存迁移前设计快照。
- 除非任务明确证明旧 runtime code 可复用且不是 AgentServer-first debt，否则不要重新引入。
