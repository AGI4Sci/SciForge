# SciForge Computer Use 当前任务

最后更新：2026-06-08

## 用户真正要什么

用户希望 Codex 能在本地桌面 / GUI 上可靠完成低风险局部操作，并给出可验证的动作证据。

Computer Use 不是独立 agent。它只提供可迁移、可验收、可清理的 GUI primitive runtime；Agent Host 负责理解用户任务、选择目标、收集确认、判断 completion truth 和生成 final answer。

## 总体决策

- [x] Public surface 只保留 primitive：`bind`、`observe`、`act`、`run_procedure`、`control`。
- [x] `run_procedure` 只执行 Host 已明确给出的局部结构化步骤，用来降低往返成本。
- [x] `run_procedure` 不接受自然语言 task / goal / instruction，不负责 plan / locate / verify / repair / final answer。
- [x] 旧 `runTask`、`perform_local_action`、`fill_fields` 不作为新 public surface 保留。

## Invariant Audit

每次阶段打勾前都要重新确认这些不可变原则。

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- [x] 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- [x] 业务代码单文件超过约 2000 行时，必须拆分或登记拆分任务。
- [x] 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- [x] LLM API 配置使用 `/Applications/workspace/ailab/research/app/SciForge/config.local.json`。
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。

## 简化架构

长期只保留五层，每层职责要窄。

- [ ] Primitive Contract：schema、validator、result envelope、risk gate、refs-first 规则。
- [ ] Session Runtime：`bind -> active -> paused -> released/stopped/cancelled` 生命周期。
- [ ] Input Adapter：每个 session 一个独立 adapter；共享系统输入只能作为全局独占 adapter 串行使用。
- [ ] Platform Adapter：macOS Accessibility、远程桌面、未来 native sidecar 等平台实现。
- [ ] Acceptance Harness：TextEdit / demo app / 多 session live test，只用于验收，不进入 product core。

## 算法简化原则

- [ ] 用 action table 声明每种 action 的 required fields、risk rule、handler name 和 evidence requirement。
- [ ] 用有限状态机管理 session，不做隐式 repair。
- [ ] 用 discriminated union 表达 action，不接受自由 JSON。
- [ ] 坐标只做机械转换，不做语义 locate。
- [ ] `run_procedure` 只是顺序执行 primitive；遇到 `blocked`、`needs-confirmation` 或 `failed` 立即停止。
- [ ] Product path 优先使用 focus-free / session-local input adapter；`CGEvent` / 全局键鼠只能通过全局 lease 串行接管，并记录恢复 evidence。

## 推荐推进策略

- [ ] 每项能力按 `contracted -> unit-proven -> live-diagnostic -> product-ready` 推进，不能跳级宣传。
- [ ] 新增 action 必须先补 action table、validator、MCP schema、service delegation test 和 evidence test。
- [ ] live test 只证明真实桌面行为；只有不依赖共享键鼠且清理干净时，才能升级为 product-ready。
- [ ] 复杂需求优先拆到 Host、Platform Adapter 或 Acceptance Harness，Computer Use core 只保留 primitive 管线。
- [ ] `run_procedure` 保持本地顺序执行；如果实现里出现旧 task engine / planner / verifier port，直接删除或迁移出 Computer Use。
- [ ] 每轮实现结束都更新本文件的成熟度和验收缺口，避免“测试通过”和“产品可用”混在一起。

## 拆分登记

- [x] `packages/actions/computer-use/live-acceptance-validator.ts` 已拆分：主入口保留 live acceptance 主流程，task/rule 常量进入 `live-acceptance-rules.ts`，task marker/ref helper 进入 `live-acceptance-marker-validator.ts`。拆分后单文件均低于约 2000 行，package focused suite 已覆盖 public validator 入口。

## 近期聚焦：P3 / P4 / P6

这三个阶段按顺序推进，避免一边补真实桌面能力，一边继续扩大 legacy surface。

- [x] P3 先证明真实桌面 diagnostic harness 可靠：默认 skip、显式 env、运行前清理、失败后清理、运行后断言无副作用。
- [x] P3 只把当前 macOS 共享系统输入路径标为 `live-diagnostic`；在 session-local adapter 证明前，不打 product-ready 勾。
- [x] P4 只接 primitive bridge：MCP schema 与 TS validator 对齐，runtime 默认注册 primitive service，真实 Host ports 缺失时 fail closed。
- [x] P4 Agent Host 默认 WindowAction materializer 已经走 `computer_use.bind -> observe -> act`，普通聊天单步低风险 GUI action 有 turn-loop 测试覆盖。
- [x] P4 普通聊天验收必须由 Agent Host 基于 Computer Use evidence 判断；Computer Use 自己的 completed status 不能成为 final truth。
- [x] P6 清理旧路径时优先删除冲突代码；只有历史诊断必须保留时，才放在明确标记的 legacy / diagnostic 区域。
- [x] P6 legacy 检查要覆盖 package manifest、runtime registry、Agent Host 工具名、docs 和 product claim，避免旧 `runTask` 口径回流。

## P0：Session 输入隔离

目标：Computer Use 不能把用户真实鼠标键盘伪装成独立后台输入；如使用共享系统输入，必须全局独占、串行、可取消、可恢复。

Build Tasks：

- [x] 定义 `inputAdapterRef`、`cursorRef`、`scopedInputLeaseRef` 的 contract 含义。
- [x] `bind` 成功必须返回 session-scoped `inputAdapterRef`、`cursorRef`、`scopedInputLeaseRef`。
- [x] 同一进程内多个 session 的 input adapter / cursor marker 必须唯一。
- [x] `act` evidence 必须记录实际使用的 `inputAdapterRef` 和 `cursorRef`。
- [x] `act` 必须拒绝 adapter scope 不匹配、lease 已释放或 session 串用。
- [x] `control(release/stop/cancel)` 必须释放 input lease、adapter 和 cursor marker。
- [x] `shared-system-input` action 必须拿到全局 focus/input lease；冲突会话必须排队或 blocked，不能并发抢用户键鼠。

Acceptance Gates：

- [x] Contract test 证明两个 session bind 后 adapter/cursor 不同。
- [x] Contract test 证明跨 session act 被拒绝。
- [x] Contract test 证明 Computer Use primitive port 在显式 shared-system-input 模式下全局串行，冲突会话 blocked 且不会调用 executor。
- [x] Live acceptance 证明共享系统输入执行前后能恢复鼠标位置 / 前台焦点，并记录该动作期间会短暂影响用户输入。
- [x] Live acceptance 证明两个共享系统输入会话不会并发抢键鼠；第二个会话必须排队或 blocked。
- [x] 验收后桌面无测试窗口、测试文稿、测试进程、临时 artifacts。

## P1：原子操作完备性

目标：`act` 足以表达常见低风险 GUI 原子动作，但不扩张成任务执行器。

Build Tasks：

- [x] 固化 action table：click、double_click、type、key/keys、scroll、wait、app_command、drag。
- [x] 判断是否补充 `move` / `hover`；当前不补充，等出现明确 adapter / UX 需求时再作为单个原子输入事件加入。
- [x] 每个 action 都有最小合法 payload validator。
- [x] 每个 action 都有缺字段、越界、未绑定 target 的 fail-closed validator。
- [x] `type` 只能接受 `textRef`，不能内联 raw text。
- [x] 高风险 `app_command` 必须 action-time confirmation。

Acceptance Gates：

- [x] 每个原子动作都有 validator、MCP schema、service delegation 和 evidence test。
- [x] Live acceptance 覆盖低风险动作子集。
- [x] 未覆盖动作必须写明原因，不能暗示已经 product-ready。

当前状态：P1 已达到 `live-diagnostic`。Package contract 测试覆盖 8 个 action type 的 validator、MCP schema、service delegation 和 evidence refs；TextEdit live acceptance 覆盖 click、double_click、type、key、scroll、wait、app_command 和 drag。该覆盖证明 action type 完备，不代表每个 `app_command` 值、每种快捷键组合或每个平台 adapter 都已 product-ready。

## P2：Observation 与 Evidence

目标：每个动作都有 current-run、target-bound、可追溯证据。

Build Tasks：

- [x] `observe` 产出 screenshotRef、accessibilityRef、elementRefs、textRefs。
- [x] `act` 产出 actionRef、executorEventRef、inputEventRef、before/after observation refs、stale invalidation refs。
- [x] `run_procedure` 保留每个 step 的 refs，不能只返回 procedure summary。
- [x] stale observation 必须显式 invalidated，不能被后续判断复用。
- [x] cursor marker 作为 evidence overlay / ref 存在，但不能移动用户真实 cursor。

Acceptance Gates：

- [x] 证据链能回答：哪个 session、哪个 target、哪个 adapter、哪个 cursor、哪个动作、动作前后看到什么。
- [x] Evidence 中没有 raw screenshot、raw AX tree、base64、data URL、secret 或 raw typed text。

## P3：真实桌面验收

目标：用真实桌面应用验证 primitive，而不是只做 package probe。

Build Tasks：

- [x] 保留默认 skip 的 live acceptance，需要显式 env 才运行。
- [x] live acceptance 运行前清理旧的 Computer Use 测试残留。
- [x] live acceptance 运行后断言无测试窗口、测试文稿、测试进程、临时 artifacts。
- [x] 增加 session isolation live test：至少两个 session 的 cursor/input adapter 独立。
- [x] 如果 macOS 平台只能通过共享系统输入完成某类动作，该动作只能标为 diagnostic gap。

Acceptance Gates：

- [x] 从干净桌面启动，live test 通过。
- [x] 失败时也能清理副作用。
- [x] 验收由 agent 自动读取桌面状态判断，不依赖用户手动观察。

当前状态：P3 已达到 `live-diagnostic`。2026-06-07 显式运行
`SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1 node --import tsx --test packages/actions/computer-use/textedit-live-acceptance.test.ts`
通过 8/8，包括真实 TextEdit 原子动作链、双 session adapter / cursor 隔离，以及 shared-system-input 并发冲突 blocked。运行后检查 TextEdit
进程不存在、live artifact 目录为空、drag Swift 临时源文件不存在、前台应用恢复到 Electron / Codex。该验收仍使用
System Events / CGEvent 共享系统输入，所以会短暂接管用户键鼠。

补充状态：shared-system-input 并发冲突 live 子项已通过，证明第一个真实 TextEdit 共享输入 action 持有 lease 时，第二个会话 blocked 且不调用 executor；executor event 记录 `sharedSystemInputUsed` 和用户输入影响说明。该能力仍是共享输入 `live-diagnostic`，不是后台无感或 session-local `product-ready`。

## P4：Host / MCP 集成

目标：Computer Use package 能被 Agent Host 和 MCP-style caller 稳定调用。

Build Tasks：

- [x] MCP tool schema 与 TS validator 保持一致。
- [x] Host port adapter 提供真实 target binding、observe、act、control 实现。
- [x] Agent Host 负责 task understanding、target choice、semantic locate、approval collection、artifact validation 和 final answer。
- [x] `/computer-use` 只能作为 debug / diagnostic 入口，不能成为产品语义入口。

Acceptance Gates：

- [x] 普通聊天 turn 能经 Agent Host 调用 Computer Use primitive 完成低风险局部 GUI 操作。
- [x] final answer 基于 action evidence，而不是 Computer Use 自报成功。
- [x] blocked / needs-confirmation 能给出用户可理解的恢复路径。

当前状态：P4 已达到 unit-proven。证据来自 WindowAction primitive port 测试、default Computer Use materializer 测试和 Agent Host turn-loop 普通聊天测试。它证明单步低风险 GUI action 能通过 `bind -> observe -> act -> control(release)` primitive chain 完成，并在 final result 保留 action evidence、artifact validator refs 和 release evidence；workflow loop blocked 时也会保留已完成原子步骤 refs。该状态不代表完整用户级 workflow 或真实桌面 product-ready。

## P5：安全与确认

目标：高风险动作默认 fail closed。

Build Tasks：

- [x] submit / send / publish / upload / delete / pay / authorize 必须 action-time confirmation。
- [x] 未确认不得执行 port。
- [x] approvalRef 必须绑定当前 action risk envelope。
- [x] 超出当前 session scope、触达外部账号/状态或不可逆的跨 app / 跨窗口 / 跨账号副作用必须 blocked 或 needs-confirmation；P9 full-access 下真实文件保存、批量或跨文件本身不作为确认条件。
- [x] 删除、提交、支付等动作不能藏在 `run_procedure` 内绕过确认。

Acceptance Gates：

- [x] 单步 `act` 和 `run_procedure` 都能阻止未确认高风险动作。
- [x] 测试证明 blocked 时 executor port 没有被调用。

当前状态：P5 已达到 `unit-proven`。Package tests 证明内置高风险 `app_command` 列表默认 needs-confirmation、Host 标记为超出当前 session scope 的 cross-app / cross-window / cross-account / irreversible risk categories 默认 needs-confirmation、错误 approvalRef 不能绕过 risk envelope、单步 `act` 和 `run_procedure` blocked 时不会调用 executor。该状态依赖 Host 正确标注 risk categories；Computer Use core 不做跨 app / 跨账号语义推断，也不把 P9 full-access 下的真实文件保存、批量或跨文件本身升级成 confirmation gate，所以不能声明 product-ready。

## P6：迁移与清理

目标：旧 Computer Use 路径不再污染新设计。

Build Tasks：

- [x] 删除旧 `runTask`、`perform_local_action`、`fill_fields` public surface。
- [x] 删除未使用的旧组合执行 port / alias；`run_procedure` 在 Computer Use 内只能是 primitive for-loop。
- [x] 不新增 legacy compatibility wrapper；历史引用只能用于拒绝、迁移审计或 evidence invalidation。
- [x] 删除旧 VirtualAppScreen / Python / noVNC / diagnostic product claims。
- [x] 更新文档引用到 `docs/ComputerUseRuntimeArchitecture.md` 和 `packages/actions/computer-use`。
- [x] 防止 legacy path 回流到 package scripts、manifest、runtime registry。

Acceptance Gates：

- [x] legacy path 检查通过。
- [x] 新文档和 package README 不再把旧路径描述成目标能力。
- [x] 没有 compatibility wrapper 被当成 completion truth。

## P7：用户级验收链路

目标：证明 Computer Use 能服务用户请求，但不自己宣布用户任务完成。

Build Tasks：

- [x] 从普通聊天入口触发一个低风险 GUI 局部操作。
- [x] Agent Host 选择 target、调用 bind/observe/act/control。
- [x] Computer Use 返回 action evidence。
- [x] Agent Host 基于 evidence 生成 final answer。
- [x] 如果任务要求产物，还必须有 artifact refs / validator refs。

Acceptance Gates：

- [x] 用户能从 final answer 理解操作是否完成、证据是什么、还有什么没做。
- [x] Completion truth 不来自 `act.status=completed` 或 `run_procedure.status=completed` 本身。
- [x] 证据不足时 final answer 必须 partial / blocked。

当前状态：P7 已达到 `unit-proven`。Agent Host turn-loop 测试证明普通聊天可触发默认 WindowAction Computer Use materializer，并在 final answer 保留 action evidence、release control ref、input lease / adapter / cursor refs；blocked / product-completion-gate 场景仍保留 refs 和恢复语义。TextEdit chat bridge 和 live acceptance runner 证明普通聊天 save 目标能进入 scoped Appium adapter，产出 sanitized manifest，并在缺少 current-run product completion bundle 时 blocked，而不是把 `act.status=completed` 当成用户任务完成。

补充验收：2026-06-07 focused regression 通过 116/119，3 个真实桌面子项默认 skip；随后显式运行
`SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1 node --import tsx --test packages/actions/computer-use/textedit-live-acceptance.test.ts`
通过 8/8。运行后检查 TextEdit 进程不存在、live artifact 目录为空、drag Swift 临时源文件不存在、前台应用恢复到 Codex。普通聊天到真实 TextEdit/Appium 的完整 live 验收仍依赖 loopback Appium 环境，不能声明 `product-ready`。

本轮验收：2026-06-07 重新跑通 `npm run typecheck`、Computer Use package focused suite、Model Router refs-first multimodal routing suite、UI Computer Use policy suite 和 `git diff --check`。真实桌面 TextEdit 子项仍默认 skip，必须显式 env 才运行；因此当前结论仍是 `unit-proven` / `live-diagnostic`，不是 `product-ready`。

## P8：VSCode / IDE 视觉验收

目标：用 VSCode 这类复杂真实桌面软件验证 Computer Use 的观察、操作、视觉确认和清理能力，补齐 TextEdit 只能覆盖简单编辑器窗口的缺口。

Build Tasks：

- [x] 新增默认 skip、显式 env 才运行的 VSCode live acceptance runner。
- [x] runner 优先使用 VSCode；如果实现支持其它 IDE，必须通过通用 app discovery / env 配置接入，不能把产品逻辑写死到单一安装路径。
- [x] 为验收创建临时 workspace 和测试文件；按用户最新 co-work 要求复用用户 VSCode profile / 当前权限，不创建临时 user data dir。该路径必须显式标记 `userProfileUsed`，不能宣称 profile-isolated。
- [x] 通过 Host-side acceptance controller 选择下一步原子动作，并经 Computer Use primitive 链路完成 `bind -> observe -> act -> observe -> control(release)`；不能把 task planning 放进 Computer Use core，不能绕过 primitive 直接写文件冒充 GUI 操作。
- [x] `observe` 必须产出当前 VSCode 窗口的 screenshotRef、accessibilityRef / AX tree ref、visible text refs 和目标 window/session refs。
- [x] `act` 至少覆盖一次真实 IDE 低风险编辑动作：聚焦编辑区、输入 sentinel 文本、保存当前文件。
- [x] after observe 必须用视觉/AX/text evidence 证明 sentinel 文本出现在编辑器中，并证明目标仍是当前 VSCode 测试窗口。
- [x] 文件内容校验只能作为补充 artifact validator，不能替代 GUI before/after evidence。
- [x] 验收后必须关闭测试文件 tab / 测试窗口视图、删除临时 workspace、释放 input lease / cursor / adapter，并恢复前台焦点和鼠标位置；不得杀用户 VSCode 进程或清用户 profile。

Acceptance Gates：

- [x] 无显式 env 时返回 blocked/skip manifest，不启动 VSCode、不改变桌面。
- [x] 有显式 env 时，agent 自动观察真实 VSCode 窗口并判断 before/after 视觉状态，不依赖用户肉眼确认。
- [x] 证据链能回答：哪个 VSCode 窗口、哪个临时 workspace、哪个 session、哪个 adapter、哪个 cursor、哪个编辑动作、动作前后看到了什么。
- [x] 验收不能留下 VSCode 测试文件 tab、临时 workspace、临时 artifacts 或共享系统输入 lease；因为复用用户 profile，不能把用户 VSCode 进程和 profile 状态当作可清理测试残留。
- [x] 如果执行仍依赖共享系统鼠标 / 键盘，只能标为 `live-diagnostic`，不能声明 `product-ready`。
- [x] 如果 VSCode 当前平台 adapter 不足以完成真实 GUI 操作，必须 fail closed，并记录缺失 adapter / observation / visual verification refs。

当前状态：P8 已达到 `live-diagnostic`，不是 `product-ready`。2026-06-08 显式运行
`SCIFORGE_COMPUTER_USE_VSCODE_PRIMITIVE_ACCEPTANCE=1 node --import tsx --test packages/actions/computer-use/vscode-live-acceptance.test.ts`
通过 4/4。runner 默认 skip；显式 env 时复用用户 VSCode profile，用临时 workspace/test file 走 `bind -> observe -> act -> act -> act -> observe -> control(release)`，完成聚焦编辑器、GUI clipboard paste sentinel、保存、after observe 和补充文件内容校验。manifest 保留 screenshotRef、accessibilityRef、visible text refs、target window/session refs、input adapter / cursor / lease release refs，并标记 `userProfileUsed=true`、`sharedSystemInputUsed=true`、`productReady=false`。不带 keep-artifacts 的 live run 结束后 `docs/test-artifacts/computer-use-vscode-live` 无残留文件；测试 workspace 被删除，用户 VSCode 进程不被杀，用户 profile 不被清理。

P8 当前口径已按用户 co-work 要求从“临时 user data dir 隔离验收”改为“复用用户 profile 的真实协作诊断验收”。因此它证明真实 VSCode co-work 路径可被 primitive evidence 追踪，但不能证明 profile-isolated cleanup，也不能声明 product-ready。若后续需要恢复 profile-isolated IDE 验收，应作为单独 gate 追加。

## P9：已打开 VSCode / IDE co-work

目标：用户已经打开 VSCode 时，Codex 能绑定当前用户窗口并进行低风险局部协作，而不是另起一个假测试窗口或要求用户切到专门 profile。

阶段拆分：

- `P9a refs-first contract / unit-proven`：把已打开 VSCode co-work 的 Host decision、目标绑定、权限范围和 cleanup evidence 规则固化并测试。
- `P9b ordinary-chat live-diagnostic`：从普通聊天入口绑定用户当前 VSCode，先完成无写入低风险动作，例如 `read-visible-text` 或 `focus-editor`，并完整 release / restore。
- `P9c full-access single-file mutation live-diagnostic`：在 Agent Host 明确目标、范围和用户请求后，对当前单文件做一个小范围 GUI 修改 / 可选保存，并用 before/after refs 与补充 validator 证明。
- `P9d product-ready adapter gap`：session-local / focus-free adapter 通过真实 co-work 验收前，不把 P9 宣称为 `product-ready`；这不是 P9 live-diagnostic 的阻塞条件。

本轮决策：SciForge / Agent Host 应拥有当前 co-work 的完整访问权限；该 full-access permission envelope 覆盖本地文件系统、用户 VSCode profile 和用户已打开工作区的正常编辑协作，P9 不再把 macOS/TCC 权限、VSCode profile 权限、真实文件可访问性、保存、批量替换或跨文件修改本身当作 confirmation 阶段阻塞。完整访问权限不改变 refs-first 约束：Host 仍必须绑定当前 window / session / editor / file refs，声明权限 envelope 和 action evidence，并在每一步只给 Computer Use 一个 primitive；批量 / 跨文件修改不作为 batch action 交给 Computer Use core，而由 Agent Host 基于每次 observe refs 拆成多次单步 primitive 调用。提交、发布、删除、支付、外部发送或其它不可逆外部副作用仍沿用 P5 hard-confirm policy；目标窗口、文件、编辑范围或用户意图不明确时，先用 SciForge 视觉 / AX / text / title / visible file / editor refs 尝试确认唯一目标，证据不足或冲突时才 `needs-confirmation` / `blocked`。

Build Tasks：

- [x] P9a：新增 Host-side current VSCode co-work acceptance controller，覆盖 window/file target、operation allowlist、fresh observe refs、editor visibility、editor element、cursor move、selection replacement、draft text、real-file target/session/permission envelope 和 cleanup policy。
- [x] P9a：新增 Runtime Codex native-route VSCode co-work bridge，只接受 Host-owned `CU-NEXT-09` + `current-vscode-cowork` + `refs-first` intent，并把 sanitized refs 交给 package-local controller；Computer Use core 不做 task planning。
- [x] P9a：目标绑定 contract 要求 window/session refs、process/app refs、frontmost/focus refs、可见文件 refs 和 editor element refs；raw title、raw path、raw AX/text、截图路径、provider payload 或 raw/refs 混用必须 fail closed。
- [x] P9a：Host 可以基于最新 observe refs 选择下一步原子能力：`focus-editor`、`read-visible-text`、`move-cursor`、`insert-draft`、`replace-selection`、`save-current-file` 或 `undo-last-action`；Computer Use core 仍只执行 Host 指定 primitive。
- [x] P9a：真实文件修改的目标、active session、file evidence 和 full-access permission envelope 已 refs-first 化，raw path / 裸文件名不能作为目标继续执行；旧 real-file confirmation gate 已替换为 Host full-access permission envelope gate，缺失或未绑定当前 session/file 时 fail closed。
- [x] P9a：live manifest / cleanup validator 要求 current-run before/after screenshot refs、AX/text refs、Host decision/action/control refs、input adapter / cursor / lease refs、stale invalidation refs、release refs 和 front app / mouse restoration refs；禁止杀用户 VSCode 或清用户 profile。
- [x] P9b：普通聊天 HTTP/SSE -> AgentCli -> CodexAppServerAdapter -> CodexAppServerClient -> native route 已能透传 refs-first current VSCode co-work Host input；无 explicit runtimeIntent 时也能由 Host input 包装成 `CU-NEXT-09` + `current-vscode-cowork` + `refs-first` intent，但不会从裸 commandText 直接派生权限。
- [x] P9b：默认 Agent Host Computer Use Act materializer 已增加 current VSCode co-work Host producer 单元路径；它从 Host / runtimeTruth 已有的 tokenized target、observation、permission refs 组装 `CU-NEXT-09 current-vscode-cowork` runtime intent，先支持 `read-visible-text` refs-only observe decision，不走通用 WindowAction planner，不让 Computer Use core 做 task planning；act primitive live runner 未接入时仍 fail closed。
- [x] P9b：新增 Host-side current VSCode `read-visible-text` live diagnostic runner 单元路径；它按 `bind -> observe -> Host decision -> observe -> control(release)` 调 Computer Use primitive service，Host 只用 primitive 返回的 refs 构造 co-work Host input / runtimeTruth，多窗口或目标不唯一时不执行第二次 observe 并仍释放 input lease / adapter / cursor 与 restore refs。
- [x] P9b：新增 current VSCode observe-only primitive ports 与 Host wrapper；默认 env-gated，不启动测试文件、不执行 act、不杀用户 VSCode、不清 profile，显式运行时只绑定当前 VSCode 窗口、产出 app/process/window/title/frontmost/AX/text/editor/freshness refs，并在 release 时恢复 front app / mouse refs。
- [ ] P9b：Agent Host live producer 负责从真实当前 VSCode 观察中识别窄 co-work 意图、风险边界和目标窗口候选，并生成 refs-first Host input / runtime intent。
- [ ] P9b：支持绑定用户当前前台 VSCode 窗口，或在多个 VSCode 窗口中先用视觉 / AX / text / window title / visible file / editor refs 自动确认唯一目标；无法唯一确认时再 `needs-confirmation`。
- [ ] P9b：完成第一个无写入 live-diagnostic：`bind -> observe -> Host decision -> read-visible-text` 或 `focus-editor -> observe -> control(release)`，final answer 给出 refs-first evidence。
- [ ] P9c：在 Agent Host 明确当前文件目标、修改范围和 full-access permission envelope 后，对当前单文件执行一个小范围 GUI 修改 / 可选保存；批量、跨文件不进入可执行 batch，必须由 Host 多次调用单步原子 primitive；提交、删除、发布等外部或不可逆动作仍走 P5 hard-confirm。

Acceptance Gates：

- [x] P9a：package focused tests 证明 current VSCode co-work contract 和 native-route bridge 在目标不明确、observe refs 不新鲜、raw/refs 混用、editor 不可见、缺少 editor element、缺少 refs-first action input、缺少 full-access permission envelope 或 permission 未绑定当前 session/file 时 fail closed。
- [x] P9a：live manifest validator 证明 bind / before observe / Host decision / action / after observe / control evidence 必须绑定同一 session、target window、editor element、必要 file target、input resources、release refs 和 visual refs。
- [x] P9a：shared-system-input / user-profile path 只能标为 `live-diagnostic`，manifest 必须显式 `userProfileUsed=true`、`sharedSystemInputUsed=true`、`productReady=false`，不能宣称 profile-isolated 或 product-ready。
- [x] P9a：真实用户文件相关保存、撤销、替换选区、批量替换和跨文件修改已具备 refs-first 目标 / session / file / permission envelope 证据检查；full-access 决策下不再因为这些 operation 本身要求 confirmation，旧 approval gate 已改成 full-access permission envelope gate。
- [x] P9b：unit tests 证明 Host-side read-visible-text live diagnostic runner 会先 bind/observe，再让 Agent Host co-work materializer 基于 observe refs 选一个 refs-only observe primitive，最后 control(release) 释放 scoped input lease / adapter / cursor 并保留 front app / mouse restoration refs；多个 VSCode window refs 时返回 `needs-confirmation` 且不执行第二次 observe。
- [x] P9b：unit tests 证明 current VSCode observe-only primitive ports 默认 env-gated，不会宣称 product-ready，不启动/关闭 VSCode，不清用户 profile；在注入的当前窗口观察源下，Host wrapper 能走 `bind -> observe -> Host decision -> observe -> control(release)` 并保留 release / restoration refs。
- [ ] P9b：用户在普通聊天中说“操作我已经打开的 VSCode”时，Host 能通过 `bind -> observe -> act/observe -> observe -> control(release)` 完成一个无写入低风险局部动作，并在 final answer 中给出 refs-first 证据。
- [ ] P9b：如果存在多个 VSCode 窗口，Host 必须先利用 SciForge 视觉 / AX / text / title / visible file / editor refs 观察并尝试确认正确窗口；只有证据冲突、无法唯一确认、目标文件不明确、编辑区不可见或 observation refs 不新鲜时，才返回 `needs-confirmation` / `blocked`。
- [ ] P9c：Agent Host 在 full-access permission envelope 下能对当前单文件执行一个小范围 GUI 修改 / 可选保存，并通过 before/after refs、action refs、release refs 和补充 validator 证明；不得借此声明 Computer Use core 拥有批量或跨文件 batch planning 能力。

本轮推进：新增 `packages/actions/computer-use/vscode-cowork-acceptance.ts` 和 focused tests，登记 `CU-NEXT-09 current-vscode-cowork`。该 Host-side acceptance controller 只把 current VSCode co-work 的下一步选择规则固化为 refs-first 契约：多 VSCode 窗口或目标不明确返回 `needs-confirmation`，缺少 fresh observe refs / editor 不可见 / refs 陈旧返回 `blocked`，fresh observe refs 可产出一个低风险 `focus-editor` 原子 `act`，真实文件的 target file、active session、permission envelope / action evidence 已经 refs-first 化，raw path、裸文件名、raw AX/text 或 provider payload 不能进入 public events。cleanup validator 要求 release input lease / cursor / adapter，并要求 front app / mouse position restoration refs，拒绝 release/restoration evidence 中的 raw payload、secret-like、URL 或本地路径形态，且禁止杀用户 VSCode 或清用户 profile。旧 real-file confirmation gate 已替换为 Host full-access permission envelope gate；该契约仍为 `unit-proven`，不是真实桌面 co-work live 完成。

本轮补充：新增 Runtime Codex native-route 的 VSCode co-work Host bridge。只有 schema/kind/source 均为 Host-owned native route、taskId 为 `CU-NEXT-09` 且带 `current-vscode-cowork` + `refs-first` semantic markers 的 runtime intent 会选择该 bridge；它只消费 Host 传入的 sanitized refs / operation / full-access permission envelope，legacy `confirmationRef` 字段仅为兼容旧输入保留，不再作为 P9 real-file gate，调用 package-local acceptance controller 后返回一个 refs-first route payload。多 VSCode window 候选且未选择 windowRef 时，ordinary/native route 现在会返回 `needs-confirmation`，并把 requestRef 与 candidate windowRefs 保留到 evidenceRefs；window/app/process/title/frontmost refs 与 observation/image/AX/text/element/freshness refs 都必须是 tokenized refs，raw VSCode title、raw AX/text、截图路径、provider payload、base64 和 secret sidecars 不进入 public events。bridge 现在还会把“合法 window ref + raw window 候选”的混合输入视为 `blocked` / `vscode_cowork_window_candidate_refs_invalid`，不会静默丢弃 raw 候选后把目标误收敛成单窗口 ready。该 bridge 不执行 primitive、不做 task planning、不新增 MCP public surface，也不产生用户级 completion truth。

本轮补充：Host-side controller 和 native-route bridge 现在也把目标文件不明确作为 fail-closed 条件。对于 `insert-draft`、`save-current-file`、`bulk-replace`、`cross-file-modify` 和 `undo-last-action`，如果 current observe refs / window refs 中出现多个 `file-ref:` 形态 visible file refs 且 Host 没有提供 selectedFileRef，则返回 `needs-confirmation`，不返回 primitive/action，并保留 candidate file refs。Host 提供的 selectedFileRef 必须来自当前 `file-ref:` refs；即使当前只看到一个 visible file ref，selectedFileRef 不匹配也会 blocked；raw path / 裸文件名不算 refs-first file ref，不能作为目标继续执行。

本轮补充：native-route bridge 现在不会把 raw selected target refs 静默丢成“未选择”。如果 Host 提供 raw VSCode window title 作为 selectedWindowRef，或 raw path / 裸文件名作为 selectedFileRef，即使当前只有一个合法 window/file 候选，也会返回 `blocked` / `vscode_cowork_selected_window_ref_invalid` 或 `vscode_cowork_selected_file_ref_invalid`，并只保留 requestRef 与当前合法候选 refs；不能自动选择唯一候选继续执行。

本轮补充：P9 window candidate 的 bind identity evidence 现在也是强制 refs-first。每个 current VSCode window candidate 除 `window:` 和 `macos-app:` 外，还必须带 `process:`、title `text:` / `window:` 和 `frontmost:` / `window:` refs；缺少这些身份 refs 时 controller / native-route bridge 返回 `blocked` / `vscode_cowork_window_candidate_identity_refs_required`，不消费 observe refs、不返回 primitive/action，防止 Host 只凭一个窗口 token 就把用户当前 VSCode 目标当成已绑定。

本轮补充：Host-side controller 现在在消费 observe refs 前先校验 co-work operation allowlist。Host 传入未知 operation 或 task-shaped raw 字符串时，controller 返回固定 `blocked` / `vscode_cowork_operation_required`，只保留 requestRef 与 refs-first window candidate refs，不拼接或回显 raw operation，也不把该字符串当成 Computer Use task plan 继续推理；native-route bridge 继续通过 sanitizer 保证 public events 不泄漏 raw operation。

本轮补充：Host-side controller 和 native-route bridge 现在也拒绝“合法 refs + raw payload”混用的 observe evidence。`textRefs` / `elementRefs` 中混入 raw visible text、raw AX/element label，或 current window / observe 的 visible file refs 中同时出现 `file-ref:` 与 raw path / 裸文件名时，会返回 `blocked` / `vscode_cowork_observe_refs_invalid` 或 `vscode_cowork_visible_file_refs_invalid`，不返回 primitive/action，并且 public events / decision refs 只保留 tokenized refs。纯 raw file target 仍按“没有 refs-first file refs”或“selectedFileRef 非法”处理，不能靠 sanitizer 静默丢弃 raw 后继续执行。

本轮补充：`insert-draft` 的文本输入也被收紧为 refs-first。Host 必须提供当前 run 生成的 `text-ref:` 形态 `draftTextRef`，controller/native route 才会返回 `type` 原子 `act`；缺少 `draftTextRef` 或把 raw draft body 塞进该字段时返回 `blocked` / `vscode_cowork_draft_text_ref_required`，不返回可执行 action，也不允许把 raw draft text、clipboard payload 或 provider payload 嵌入 Computer Use decision。

本轮补充：`read-visible-text` 已作为 refs-only co-work 能力接入。Host 提供 fresh observe refs 后，controller/native route 返回 `ready` + `primitive=observe`，只保留 observation/text/AX refs，不返回 `act` action、不嵌入 visible text 原文，也不触发用户 VSCode 输入或文件修改。

本轮补充：`move-cursor` 已作为 Host-selected 单步光标移动接入。Host 必须先基于 fresh observe refs 选择一个 `cursor-move:` 形态 `cursorMoveRef`，controller/native route 才会返回单个 `key` 原子 `act`；缺少 cursorMoveRef、使用 raw 自然语言方向、或把移动计划塞入 runtime intent 时返回 `blocked` / `vscode_cowork_cursor_move_ref_required`，不返回可执行 action。该能力只表达一次明确 arrow-key movement，不做语义 locate、不规划多步路径，也不读取或保存用户文件。

本轮补充：`replace-selection` 已作为 refs-first 的选区替换能力接入。Host 必须基于 latest observe refs 提供 `selection-ref:` 形态 `selectionRef`、`text-ref:` 形态 `replacementTextRef` 和当前 `file-ref:` 目标；缺少 selection ref、把 raw 选区描述或 raw replacement body 塞入 runtime intent 时返回 `blocked` / `vscode_cowork_selection_ref_required` 或 `vscode_cowork_replacement_text_ref_required`，不返回 action，也不泄露 raw 文本。最新 full-access P9 决策下，替换用户文件选区不再因为“修改真实文件”本身要求 confirmation；它需要 Host 提供 full-access permission envelope、当前 active observe session、目标 file ref、selection ref 和 replacement text ref。Computer Use core 不负责生成 replacement、不定位选区、不判断修改是否完成。

本轮补充：真实文件保存与撤销的 route-level 证据链保持 refs-first，但不再把 confirmationRef 作为 P9 full-access 的阶段阻塞。`save-current-file` / `undo-last-action` 仍必须绑定当前 active observe session、目标 `file-ref:`、Host decision refs、action refs 和 full-access permission envelope；Host 把 raw path 或裸文件名作为目标时仍会 `blocked`，自然语言 / raw risk 描述不会成为 confirmation key，sanitizer 会丢弃且不会把原始文件路径写入 public events。Computer Use core 只执行 Host 指定的单个 primitive，不自行决定保存/撤销是否完成。

本轮补充：P9 full-access 不再需要用 `userFile=false` 或 `non-user-file-scope:` 豁免真实文件 confirmation。`userFile=false` 仍只是 Host/observe 给出的分类结果，不能替代目标 file refs、active session refs 或 permission envelope；保存、撤销或替换选区必须基于当前 observe refs 执行。`bulk-replace` / `cross-file-modify` 即使在 full-access 下也仍然需要 Host 拆成单步原子 primitive。

本轮补充：full-access 不会把批量或跨文件请求升级成 Computer Use core 的可执行批处理。`bulk-replace` / `cross-file-modify` 不再因为缺少 confirmation 而阻塞，但仍必须返回 `blocked` / `vscode_cowork_non_atomic_operation_requires_host_decomposition` 或等价状态，要求 Agent Host 基于最新 observe refs 拆成明确的单步 editor primitive。Computer Use core 和 native-route bridge 不做批量编辑计划、不生成跨文件修改计划，也不返回可执行 batch action。

本轮补充：新增 P9 co-work live acceptance manifest validator。一个 passed manifest 必须保持 `live-diagnostic` / `productReady=false`，并显式标记 `userProfileUsed=true`、`sharedSystemInputUsed=true`；记录 `bind -> observe -> Host decision -> one primitive -> observe -> control(release)`，保留 bind / before observe / Host decision / act 或 observe / after observe / control refs，包含 before/after screenshot、AX 和 text refs，释放 input lease / cursor / adapter，恢复 front app 和 mouse position，并禁止杀用户 VSCode 或清 profile；bind evidence 必须包含 session、当前 target window、app、process 和 frontmost/focus refs；target window 必须是 `window:` 形态 ref，文件目标 / 真实文件操作还必须有 `file-ref:` 形态 selectedFileRef 和 full-access permission envelope refs。before observe evidence 必须绑定同一个 target window ref，证明 Host 用来决策的观察来自当前用户 VSCode 窗口；act evidence 还必须显式包含 actionRef、同一个 bind session ref、executorEventRef、inputEventRef、input adapter ref、cursor marker ref、scoped input lease ref 和 stale invalidation ref，并且 action 使用的 input adapter / cursor / lease refs 必须精确绑定本次 release evidence 中释放的同一组资源，防止 live manifest 只用一个泛泛 action 字符串或另一组输入资源替代真实 GUI action 证据链；visual evidence 必须是对应类别 refs，且 screenshot / AX / text 都至少包含 before 与 after 两个 current-run refs；before/after observe evidence group 还必须分别绑定本组对应的 screenshot / AX / text refs，不能只把视觉 refs 放在全局 evidence 列表里。validator 会在所有 evidence group 拒绝 rawScreenshot、providerPayload、data URL、base64、URL、token/password/secret-like 值以及本地路径形态；raw path / URL / secret-like 值即使带有 `risk:`、`approval:` 或 permission 前缀，也不能作为有效 evidence ref。

本轮补充：P9 cleanup / live manifest validator 现在会 fail closed 校验用户 profile 与共享系统输入标记。manifest 若没有明确 `userProfileUsed=true` 或 `sharedSystemInputUsed=true`，即使 release refs、restoration refs 和 cleanup flags 都完整，也会返回 validation issue；这防止复用用户 VSCode profile / 共享键鼠输入的诊断路径被误写成 profile-isolated 或 product-ready 证据。

本轮补充：P9 full-access live manifest 不再要求真实文件保存、撤销或替换选区携带 approval evidence；它要求 permission envelope、Host decision evidence、action evidence 同时绑定同一个 selected `file-ref:` 和本次 bind active session。validator 已要求 `permission:current-vscode-cowork:full-access:...` 形态 permission ref，并校验其中绑定当前 active session 与 selected file ref。

本轮补充：P9 Host-side controller / native-route bridge 已把真实文件 `confirmationRef` gate 替换为 full-access permission envelope gate。保存、撤销、替换选区、批量替换或跨文件修改不再因为缺少 approval token 而 `needs-confirmation`；它们必须绑定当前 observe session、当前 selected/唯一 visible `file-ref:`、Host decision/action evidence 和 full-access permission refs，缺少 permission 或 permission 未绑定当前 session/file 时 `blocked`。

本轮补充：P9 full-access 下 riskActionHash 不再作为真实文件保存 / 批量 / 跨文件的 confirmation key。Host 仍可记录 tokenized `risk:` / scope refs 作为审计 evidence，但执行 gate 应以 selected `file-ref:`、active session、permission envelope、Host decision/action refs 为准；泛泛 risk 文本、raw path 或裸文件名仍不能进入 public events。

本轮补充：P9 full-access 下 `non-user-file-scope:` 不再是绕过真实文件确认的必要豁免 evidence。Host 可以继续提供该 ref 说明目标是临时草稿或非用户文件，但它不能替代 selected `file-ref:`、active session、permission envelope 或 action evidence。

本轮补充：P9 live manifest 的 Host decision evidence 现在也必须绑定当前 requestRef、bind evidence 中的同一个 active session ref、target window、before observe ref、freshness ref；文件目标操作还必须绑定 selected `file-ref:`，真实文件修改还必须绑定 full-access permission envelope refs。只有泛泛的 `decision:` ref 或另一条合法 session ref 不足以证明 Host 是在本次 VSCode co-work session 内根据当前 observe refs 选择下一步原子能力。

本轮补充：P9 live manifest 的 Host decision evidence 现在还必须绑定 action evidence 中的同一个 action ref。Host 只给 `decision:` ref、或 decision 指向另一条合法 `action:` ref，都不足以证明实际执行的 act 就是 Host 基于 before observe refs 选出的下一步原子能力；缺失或不匹配时 validator 返回 `missing-host-decision-ref:action`。

本轮补充：Host-side controller / native-route bridge 的 latest observe refs 现在也必须绑定 active `window-action-session:` / `computer-use-session:` ref。缺少 sessionRef 时，controller 返回 `blocked` / `vscode_cowork_observe_session_ref_required`，不返回 primitive/action；ready 的 Host decision refs 和 ordinary route evidenceRefs 会保留该 session ref，证明“根据 observe refs 选择下一步原子能力”发生在本次绑定的 VSCode co-work session 内，而不是只凭窗口 ref 或旧 observation。

本轮补充：P9 editor visibility gate 现在覆盖所有 co-work operation，包括 refs-only `read-visible-text`。如果 latest observe refs 标记 `editorVisible=false`，Host-side controller / native-route bridge 会返回 `blocked` / `vscode_cowork_editor_not_visible`，不返回 primitive/action；不能因为只是读取可见文本就绕过“编辑区不可见必须 blocked / needs-confirmation”的目标明确性要求。

本轮补充：P9 editor target gate 现在要求 latest observe refs 中存在结构化 editor element ref。`editorVisible=true` 只说明观察声明编辑区可见，不能让 controller 把 `element:vscode:file-tabs` 等非 editor 元素当成 action target；如果缺少 `element:` 形态且名称包含 editor 的目标 ref，Host-side controller / native-route bridge 返回 `blocked` / `vscode_cowork_editor_element_ref_required`，不返回 primitive/action。该 gate 覆盖 refs-only 读取和所有 editor action，防止目标不明确时 fallback 到任意可见元素。

本轮补充：P9 live manifest 现在也要求 editor element target 进入证据链。before observe evidence 必须包含结构化 editor element ref，Host decision evidence 和 action evidence 必须绑定同一个 editor element ref，证明 Host 是基于当前观察到的编辑器目标选择下一步原子能力，且实际 act 没有脱离该目标；缺失时 validator 返回 `missing-before-observe-ref:editor-element`、`missing-host-decision-ref:editor-element` 或 `missing-action-ref:editor-element`。

本轮补充：P9 live manifest 的 after observe evidence 现在也必须绑定同一个 editor element ref。动作后只重新绑定 target window 和 freshness 仍不足以证明 after observe 看到的是同一个编辑器目标；如果 after observe 缺少该 editor element target，validator 返回 `missing-after-observe-ref:editor-element`，防止用同窗口的其它面板或松散视觉证据替代动作后的编辑器观察。

本轮补充：P9 live manifest 的 after observe evidence 现在必须重新绑定同一个 target window ref，并携带 after freshness ref。只有一个 `observation:` ref 不足以证明动作后仍在当前用户 VSCode 窗口，也不足以证明 after observe 是新鲜证据。

本轮补充：P9 live manifest 的 after observe evidence 现在必须绑定同一个 selected `file-ref:`。文件目标操作的动作后观察不能只证明仍在同一个窗口/编辑器；after observe evidence 也必须直接包含同一个 selectedFileRef，否则 validator 返回 `missing-after-observe-ref:target-file`，防止用同窗口其它文件的观察替代动作后的目标文件观察。

本轮补充：P9 live manifest 的 control evidence 现在必须绑定同一 session，并精确包含本次 release/restoration evidence 中的 scoped input lease、input adapter、cursor marker、front-app restore 和 mouse-position restore refs。只有 `control:` ref 不足以证明 release control 真的释放并恢复了用户桌面状态。

本轮补充：P9 live manifest 的 control evidence 现在必须绑定 bind evidence 中的同一个 active session ref。只有 release/restoration refs 不足以证明 `control(release)` 发生在本次 VSCode co-work session 内；control refs 里出现另一条合法 session ref 也会 fail closed。

本轮补充：P9 live manifest 的 bind evidence 现在必须声明本次 run 分配的 scoped input lease、input adapter 和 cursor marker refs，并且这些 refs 必须精确绑定本次 release evidence 中释放的同一组资源。只有 action/control/release refs 不足以证明这些输入资源是在本次 VSCode co-work bind 时建立的。

本轮补充：P9 live manifest 的 before/after observe evidence 现在必须分别绑定对应 screenshot、AX 和 text refs。全局 visual refs 存在但未进入 observe evidence 分组时会 fail closed，防止用松散视觉证据替代当前 run 的 before/after observe。

本轮补充：P9 live manifest 的 before/after observe evidence 现在必须绑定 bind evidence 中的同一个 active session ref。只有 target window、freshness 和 visual refs 不足以证明 observe 是本次 VSCode co-work session 内的 current-run observation；observe refs 里出现另一条合法 session ref 也会 fail closed。

本轮补充：P9 live manifest 的 before observe evidence 现在必须绑定同一个 target window ref。只有 before `observation:` / `freshness:` / visual refs 不足以证明 Host 是基于当前用户 VSCode 窗口做下一步原子能力选择。

本轮补充：P9 live manifest 的 before observe evidence 现在必须绑定同一个 selected `file-ref:`。文件目标操作不能只让 target / Host decision 声明目标文件；before observe evidence 也必须直接包含当前观察到的同一个 selectedFileRef，否则 validator 返回 `missing-before-observe-ref:target-file`。

本轮补充：P9 live manifest 的 action evidence 现在必须绑定本次 release evidence 中释放的 scoped input lease、input adapter 和 cursor marker refs。action refs 里出现另一组合法 input refs 会 fail closed，防止“执行用 A 资源、释放 B 资源”的证据断链。

本轮补充：P9 live manifest 的 action evidence 现在必须绑定 bind evidence 中的同一个 active session ref。只有 action/input/release refs 不足以证明 act 发生在本次绑定的 VSCode co-work session 内。

本轮补充：P9 live manifest 的 action evidence 现在必须绑定同一个 target window ref。只有 active session 和 editor element ref 不足以让 manifest 直接证明实际 act 没有漂移到其它 VSCode 窗口；缺失时 validator 返回 `missing-action-ref:target-window`。

本轮补充：P9 live manifest 的 action evidence 现在必须绑定同一个 selected `file-ref:`。文件目标操作不能只让 Host decision 绑定目标文件；actual act evidence 也必须直接包含同一个 selectedFileRef，否则 validator 返回 `missing-action-ref:target-file`，防止真实 act 证据与 Host 选择的文件目标断链。

本轮补充：P9b ordinary-chat Host input bridge 已达到 `unit-proven`。HTTP/SSE 入口现在会把 refs-first `agentHostInput` 透传给下游 adapter，CodexAppServerAdapter 会继续传给 client，CodexAppServerClient 在看到 Host 标记的 `current-vscode-cowork` refs 时走 native package bridge 而不是启动普通 app-server 子进程；native route 则把 Host input 中的 `target.vscodeCoWork` / `observation.vscodeCoWork` 包装为 `CU-NEXT-09` + `current-vscode-cowork` + `refs-first` intent，并复用现有 VSCode co-work controller。若 Host producer 只给通用 `target.refs`，native route 也能从 tokenized `macos-app:` / `process:` / `window:` / title `text:` / `frontmost:` / `file-ref:` refs 与 `observation.vscodeCoWork` 合成最小 co-work binding；raw path / raw title sidecar 会被丢弃且不会进入 public events。partial `target.vscodeCoWork` 可以只承载 Host 基于 observe refs 选出的 operation / action refs，并与 generic `target.refs` 合并成单步 co-work binding；显式 raw selected/window/file refs 仍会覆盖并 fail closed，不能被 generic refs 静默修复。该合成只在单一 `window:` ref 且与 latest observe window 一致时进入 ready；多个 generic window refs 或绑定身份不足时只保留 requestRef 并 fail closed。该桥只接受 Host input 中已有的 refs-first target / observation，不从裸 commandText 直接派生 runtime intent；无 Host refs 的普通文本仍走普通 Codex / Agent Host 路径。

本轮补充：P9b 默认 Agent Host Computer Use Act materializer 现在有 current VSCode co-work Host producer 单元路径。该路径只在 Host input / runtimeTruth 已经带 `intent:current-vscode-cowork`、target refs、current observe refs 和 permission refs 时触发；它从 tokenized refs 组装 `CU-NEXT-09 current-vscode-cowork refs-first` runtime intent，并调用现有 co-work controller 产出一个 `read-visible-text` refs-only observe decision。它不会调用通用 WindowAction planner，不从裸 commandText 猜目标，不执行 act，不保存文件；如果 co-work controller 给出 act primitive 或证据不足，则仍返回 blocked / needs-confirmation，等待后续 live primitive runner。Agent Host sanitizer 已允许 `macos-app:`、`process:`、`frontmost:`、`file-ref:`、`text:`、`image:`、`accessibility:`、`element:`、`freshness:` 等 tokenized co-work refs 作为 evidence，同时继续拒绝 raw、URL、base64、secret-like 和 provider payload。

本轮补充：P9b Host-side `read-visible-text` live diagnostic runner 现在有 unit-proven 路径。runner 调用 Computer Use primitive service 的 `bind` 和第一次 `observe`，把 primitive 返回的 window/session/image/AX/text/element/freshness/file/input-resource refs 归一成 `current-vscode-cowork` Host input 与 runtimeTruth，然后交给现有 co-work materializer 做 Host decision；若 Host 选择 refs-only `observe` primitive，runner 再执行第二次 `observe` 并最终 `control(release)`。如果 target/observe refs 中有多个 VSCode window，materializer 不再取第一个 window ref 自动收敛，runner 返回 `needs-confirmation`，不执行第二次 observe，但仍 release scoped input lease / adapter / cursor 并保留 front-app / mouse-position restore refs。该路径不调用真实 VSCode adapter，不声明 P9b live-diagnostic 完成。

本轮补充：P9b current VSCode observe-only primitive ports 与 Host wrapper 已达到 `unit-proven`。`packages/actions/computer-use/vscode-cowork-live-diagnostic.ts` 默认 env-gated，显式启用后只绑定用户当前 VSCode 窗口并产出 refs-first app/process/window/title/frontmost/AX/text/editor/freshness evidence；它不启动测试文件、不执行 act、不保存文件、不杀 VSCode、不清 profile。`src/runtime/codex/agent-host-vscode-cowork-current-live-diagnostic.ts` 将这些 primitive ports 接到现有 Host-side runner，证明 Host 能基于 observe refs 选择 refs-only `read-visible-text` primitive，并最终 release scoped input lease / adapter / cursor 与 front app / mouse restoration refs。该状态仍未证明普通聊天到真实当前 VSCode 的显式桌面验收，也不代表 product-ready。

当前状态：P9a 已达到 `unit-proven`，P9b ordinary-chat Host input bridge、Agent Host current VSCode co-work producer、Host-side read-visible-text live diagnostic runner、current VSCode observe-only primitive ports 和 Host wrapper 也达到 `unit-proven`；P9b 显式真实桌面 co-work `live-diagnostic` 与 P9c 仍未完成。已完成的 P9a 覆盖 policy / acceptance-controller contract、native-route bridge、window bind identity refs gate、operation allowlist gate、target-file ambiguity gate、mixed raw/refs-first observe evidence gate、observe active-session refs gate、editor visibility gate、editor element target refs gate、cursor movement refs gate、selection replacement refs gate、real-file refs-first target/session/permission envelope gate、live-manifest bind/target refs validator、live-manifest bind input-resource refs validator、live-manifest editor-element target refs validator、Host decision observe-context refs validator、Host decision active-session refs validator、Host decision action refs validator、Host decision permission refs validator、before observe target-window refs validator、before observe target-file refs validator、before/after observe active-session refs validator、after observe target/freshness refs validator、after observe target-file refs validator、after observe editor-element refs validator、control release/restoration refs validator、control active-session refs validator、action session refs validator、action target-window refs validator、action target-file refs validator、action permission refs validator、action input/stale evidence validator、action release input-resource binding refs validator、before/after visual refs validator 和 before/after observe visual binding refs validator。旧 real-file approval / confirmation gate 已替换为 Host full-access permission envelope gate，并有 package / native-route focused tests 覆盖。下一步不继续扩 validator，优先跑通 P9b 普通聊天 / current VSCode env-gated live diagnostic：从真实当前 VSCode 观察生成 Host input，绑定当前真实 VSCode，用视觉 / AX / text refs 确认窗口，每一步只给 Computer Use 一个 primitive，释放 input lease / cursor / adapter、恢复焦点和鼠标位置，最后由 Agent Host 基于 refs-first 证据生成 final answer。P8 只证明临时 workspace/test file 的 VSCode 诊断验收；P9b live producer 才证明用户已打开 VSCode 的普通聊天 co-work。

## P10：论文修改 / 润色 GUI 协作

目标：用户在 VSCode / IDE 中打开论文草稿时，Codex 能基于当前文件或选区生成可审阅修改，并在 full-access permission envelope 与明确编辑范围下通过 GUI primitive 把修改落到编辑器。

Build Tasks：

- [ ] Agent Host 识别论文编辑范围：当前选区、当前文件可见段落、用户指定章节，或全文 artifact；范围不明确时先 `needs-confirmation`。
- [ ] 支持 LaTeX、Markdown、纯文本论文草稿和可导出文本的文档内容；Host 负责解析上下文、保留引用标记、公式、代码块、表格、术语和学术含义。
- [ ] 默认生成 draft / diff artifact refs，Host 基于用户明确编辑意图和 refs-first scope 决定是否应用；Computer Use 每次只执行 Host 指定的一个 primitive。
- [ ] Host 将局部 patch 拆成 Computer Use primitive：绑定目标窗口、观察当前文本、选择范围、替换文本、after observe、可选保存、release。
- [ ] 修改结果必须有 source text refs、draft/diff refs、GUI before/after refs、action refs、保存后的 file validator refs 和 final answer 变更摘要。
- [ ] 对事实性改写、引用补全、实验结果解释、作者贡献、结论增强等高影响论文内容必须降级为建议或 `needs-confirmation`，不得静默生成新事实。
- [ ] 文件太长、格式不可解析、引用上下文不足、当前窗口不是论文文件或用户编辑意图 / 目标范围不明确时，final answer 必须是 `partial` / `needs-confirmation` / `blocked`。

Acceptance Gates：

- [ ] 用户说“帮我润色当前选区”时，Host 能读取选区/可见文本 refs，生成 diff preview，并在 final answer 中说明未应用到文件。
- [ ] 在 full-access permission envelope 和明确编辑范围下，Computer Use 通过 `bind -> observe -> act -> observe -> control(release)` 在当前 VSCode 编辑区替换选区，并用 GUI refs 和补充文件 validator 证明变化。
- [ ] LaTeX 引用、公式和命令不会被普通润色破坏；不能验证时必须保留原文或返回 blocked reason。
- [ ] 保存文件、跨章节批量修改或全文替换不因真实文件 / 批量 / 跨文件本身要求 confirmation；但必须有明确用户编辑意图、refs-first file / section scope、full-access permission envelope，并由 Host 拆成多次单步 primitive。

当前状态：P10 已登记为下一阶段任务，尚未实现，不能打勾。它是 P9 co-work 入口之上的用户级场景，最终完成判断仍由 Agent Host 基于 evidence 和用户确认生成，Computer Use 不能自报论文润色完成。

## 非目标

- [ ] 不做 Computer Use agent。
- [ ] 不做跨应用 workflow engine。
- [ ] 不在 Computer Use 内做 task planning、semantic locate、repair、verification 或 final answer。
- [ ] 不用 GUI projection、screenshot replay、fixture、历史 run 或 package probe 替代真实产品验收。
- [ ] 不让测试或验收长期占用用户桌面。

## 打勾规则

- [ ] `[x]` 只能表示该阶段的 Build Tasks、Acceptance Gates 和 Invariant Audit 都通过。
- [ ] 单元测试通过但没有 live acceptance，不能打真实桌面完成勾。
- [ ] live acceptance 通过但留下窗口、进程、临时文件或 artifacts，不能打勾。
- [ ] 如果某能力仍依赖共享系统鼠标 / 键盘，不能打 product path 完成勾。
- [ ] blocked 也可以作为验收结果，但必须说明缺失条件、保留 refs，并给出恢复路径。

## 文档地图

- [`PROJECT.md`](PROJECT.md)：SciForge 总体用户级验收边界。
- [`docs/ComputerUseRuntimeArchitecture.md`](docs/ComputerUseRuntimeArchitecture.md)：Computer Use 最新设计原则。
- [`packages/actions/computer-use`](packages/actions/computer-use)：Computer Use contract、MCP adapter、tests 和 package metadata。
