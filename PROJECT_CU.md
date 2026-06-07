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
- [x] 跨 app、跨窗口、跨账号或不可逆副作用必须 blocked 或 needs-confirmation。
- [x] 删除、提交、支付等动作不能藏在 `run_procedure` 内绕过确认。

Acceptance Gates：

- [x] 单步 `act` 和 `run_procedure` 都能阻止未确认高风险动作。
- [x] 测试证明 blocked 时 executor port 没有被调用。

当前状态：P5 已达到 `unit-proven`。Package tests 证明内置高风险 `app_command` 列表默认 needs-confirmation、Host 标记的 cross-app / cross-window / cross-account / irreversible risk categories 默认 needs-confirmation、错误 approvalRef 不能绕过 risk envelope、单步 `act` 和 `run_procedure` blocked 时不会调用 executor。该状态依赖 Host 正确标注 risk categories；Computer Use core 不做跨 app / 跨账号语义推断，所以不能声明 product-ready。

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

Build Tasks：

- [ ] 从普通聊天入口触发“操作我已经打开的 VSCode / IDE”这类请求，Agent Host 负责识别用户意图、风险边界和目标窗口候选。
- [ ] 支持绑定用户当前前台 VSCode 窗口或用户明确选择的 VSCode 窗口；绑定证据必须包含 window/session refs、process/app refs、frontmost/focus refs 和可见文件/编辑区 refs。
- [ ] Agent Host 可以根据最新 observe refs 决定下一步原子能力，例如聚焦编辑区、读取当前可见文本、移动光标、替换选区、插入草稿、保存或撤销；Computer Use core 仍只执行 primitive，不做 task planning。
- [ ] 复用用户 VSCode profile、扩展、账号和当前权限来支持真实 co-work；manifest / evidence 必须显式标记 `userProfileUsed=true` 和共享系统输入影响，不能宣称 profile-isolated。
- [ ] 对用户已有文件的修改默认只做草稿或 diff preview；保存、撤销、批量替换、跨文件修改、提交、发布、删除或不可逆动作必须 `needs-confirmation`。
- [ ] 每个 GUI action 都必须有 current-run before/after screenshot refs、AX/text refs、action refs、input adapter / cursor / lease refs 和 stale invalidation refs；文件内容读取只能作为补充 validator。
- [ ] 会话释放时必须释放 input lease / cursor / adapter、恢复焦点和鼠标位置；不得杀用户 VSCode 进程、关闭用户原有窗口、清理用户 profile 或擅自保存无关文件。

Acceptance Gates：

- [ ] 用户在普通聊天中说“操作我已经打开的 VSCode”时，Host 能通过 `bind -> observe -> act -> observe -> control(release)` 完成一个低风险局部动作，并在 final answer 中给出 refs-first 证据。
- [ ] 如果当前有多个 VSCode 窗口、目标文件不明确、编辑区不可见或 observation refs 不新鲜，必须返回 `needs-confirmation` / `blocked`，不能猜窗口或猜文件。
- [ ] 对用户真实文件的改动必须先给预览或确认；未确认时 executor 不得执行保存、撤销、批量替换或跨文件修改。
- [ ] shared-system-input 路径只能标为 `live-diagnostic`；只有 session-local / focus-free adapter 通过真实 co-work 验收且无副作用时，才允许升级为 `product-ready`。

本轮推进：新增 `packages/actions/computer-use/vscode-cowork-acceptance.ts` 和 focused tests，登记 `CU-NEXT-09 current-vscode-cowork`。该 Host-side acceptance controller 只把 current VSCode co-work 的下一步选择规则固化为 refs-first 契约：多 VSCode 窗口或目标不明确返回 `needs-confirmation`，缺少 fresh observe refs / editor 不可见 / refs 陈旧返回 `blocked`，fresh observe refs 可产出一个低风险 `focus-editor` 原子 `act`，用户真实文件的保存、撤销、批量替换和跨文件修改在缺少 matching confirmationRef 时返回 `needs-confirmation` 且不返回可执行 action；确认后的真实文件保存/撤销会把 `riskActionHash` 绑定到后续 `act` 的 risk envelope 和 approvalRef。cleanup validator 要求 release input lease / cursor / adapter，并要求 front app / mouse position restoration refs，且禁止杀用户 VSCode 或清用户 profile。该契约为 `unit-proven`，仍不是真实桌面 co-work live 完成。

本轮补充：新增 Runtime Codex native-route 的 VSCode co-work Host bridge。只有 schema/kind/source 均为 Host-owned native route、taskId 为 `CU-NEXT-09` 且带 `current-vscode-cowork` + `refs-first` semantic markers 的 runtime intent 会选择该 bridge；它只消费 Host 传入的 sanitized refs / operation / confirmationRef，调用 package-local acceptance controller 后返回一个 refs-first route payload。多 VSCode window 候选且未选择 windowRef 时，ordinary/native route 现在会返回 `needs-confirmation`，并把 requestRef 与 candidate windowRefs 保留到 evidenceRefs；raw screenshot、provider payload、base64 和 secret sidecars 不进入 public events。该 bridge 不执行 primitive、不做 task planning、不新增 MCP public surface，也不产生用户级 completion truth。

本轮补充：Host-side controller 和 native-route bridge 现在也把目标文件不明确作为 fail-closed 条件。对于 `insert-draft`、`save-current-file`、`bulk-replace`、`cross-file-modify` 和 `undo-last-action`，如果 current observe refs / window refs 中出现多个 `file-ref:` 形态 visible file refs 且 Host 没有提供 selectedFileRef，则返回 `needs-confirmation`，不返回 primitive/action，并保留 candidate file refs。Host 提供的 selectedFileRef 必须来自当前 `file-ref:` refs；即使当前只看到一个 visible file ref，selectedFileRef 不匹配也会 blocked；raw path / 裸文件名不算 refs-first file ref，不能作为目标继续执行。

本轮补充：`insert-draft` 的文本输入也被收紧为 refs-first。Host 必须提供当前 run 生成的 `text-ref:` 形态 `draftTextRef`，controller/native route 才会返回 `type` 原子 `act`；缺少 `draftTextRef` 或把 raw draft body 塞进该字段时返回 `blocked` / `vscode_cowork_draft_text_ref_required`，不返回可执行 action，也不允许把 raw draft text、clipboard payload 或 provider payload 嵌入 Computer Use decision。

本轮补充：`read-visible-text` 已作为 refs-only co-work 能力接入。Host 提供 fresh observe refs 后，controller/native route 返回 `ready` + `primitive=observe`，只保留 observation/text/AX refs，不返回 `act` action、不嵌入 visible text 原文，也不触发用户 VSCode 输入或文件修改。

本轮补充：真实文件保存与撤销的 route-level approval chain 也改为 refs-first。未确认的 `save-current-file` / `undo-last-action` 在 native route 上保持 `needs-confirmation`，不返回 primitive/action，并把 `riskActionHash` 放进 evidenceRefs；如果 Host 只提供 approvalRef 但没有先提供 `riskActionHash`，route 会 `blocked`，不返回 primitive/action；只有带精确绑定的 confirmationRef（`approval:<riskActionHash>:` 前缀）的保存/撤销才返回一个 Host 指定的原子 `act`，并把 `riskActionHash` 与 `approvalRef` 都保留到 evidenceRefs / execution unit；仅仅在 approvalRef 中嵌入或包含 risk hash 不算授权。

本轮补充：新增 P9 co-work live acceptance manifest validator。一个 passed manifest 必须保持 `live-diagnostic` / `productReady=false`，并显式标记 `userProfileUsed=true`、`sharedSystemInputUsed=true`；记录 `bind -> observe -> act -> observe -> control(release)`，保留 bind / before observe / Host decision / act / after observe / control refs，包含 screenshot / AX / text refs，释放 input lease / cursor / adapter，恢复 front app 和 mouse position，并禁止杀用户 VSCode 或清 profile；真实文件操作还必须带 riskActionHash 与 approvalRef evidence refs。validator 会在所有 evidence group 拒绝 rawScreenshot、providerPayload、data URL、base64、URL、token/password/secret-like 值，只允许 refs-first 证据进入 live manifest。

本轮补充：P9 cleanup / live manifest validator 现在会 fail closed 校验用户 profile 与共享系统输入标记。manifest 若没有明确 `userProfileUsed=true` 或 `sharedSystemInputUsed=true`，即使 release refs、restoration refs 和 cleanup flags 都完整，也会返回 validation issue；这防止复用用户 VSCode profile / 共享键鼠输入的诊断路径被误写成 profile-isolated 或 product-ready 证据。

当前状态：P9 policy / acceptance-controller contract、native-route window ambiguity bridge、target-file ambiguity gate、real-file save/undo approval refs gate 和 live-manifest validator 已达到 `unit-proven`；用户已打开 VSCode 的真实 co-work live acceptance 仍未完成，不能打 P9 阶段完成勾。P8 只证明临时 workspace/test file 的 VSCode 诊断验收；P9 还需要证明普通聊天 Host 入口能绑定真实当前用户窗口，并通过 `bind -> observe -> act -> observe -> control(release)` 完成低风险局部动作、释放 input lease / cursor / adapter、恢复焦点和鼠标位置，最后由 Agent Host 基于 refs-first 证据生成 final answer。

## P10：论文修改 / 润色 GUI 协作

目标：用户在 VSCode / IDE 中打开论文草稿时，Codex 能基于当前文件或选区生成可审阅修改，并在确认后通过 GUI primitive 把修改落到编辑器。

Build Tasks：

- [ ] Agent Host 识别论文编辑范围：当前选区、当前文件可见段落、用户指定章节，或全文 artifact；范围不明确时先 `needs-confirmation`。
- [ ] 支持 LaTeX、Markdown、纯文本论文草稿和可导出文本的文档内容；Host 负责解析上下文、保留引用标记、公式、代码块、表格、术语和学术含义。
- [ ] 默认生成 draft / diff artifact refs，不直接覆盖用户文件；用户确认前，Computer Use 只能执行观察、选区读取、草稿插入到临时位置或打开预览等低风险动作。
- [ ] 用户确认后，Host 将已确认的局部 patch 拆成 Computer Use primitive：绑定目标窗口、观察当前文本、选择范围、替换文本、after observe、可选保存、release。
- [ ] 修改结果必须有 source text refs、draft/diff refs、GUI before/after refs、action refs、保存后的 file validator refs 和 final answer 变更摘要。
- [ ] 对事实性改写、引用补全、实验结果解释、作者贡献、结论增强等高影响论文内容必须降级为建议或 `needs-confirmation`，不得静默生成新事实。
- [ ] 文件太长、格式不可解析、引用上下文不足、当前窗口不是论文文件或用户未确认应用修改时，final answer 必须是 `partial` / `needs-confirmation` / `blocked`。

Acceptance Gates：

- [ ] 用户说“帮我润色当前选区”时，Host 能读取选区/可见文本 refs，生成 diff preview，并在 final answer 中说明未应用到文件。
- [ ] 用户确认应用后，Computer Use 通过 `bind -> observe -> act -> observe -> control(release)` 在当前 VSCode 编辑区替换选区，并用 GUI refs 和补充文件 validator 证明变化。
- [ ] LaTeX 引用、公式和命令不会被普通润色破坏；不能验证时必须保留原文或返回 blocked reason。
- [ ] 保存文件、跨章节批量修改或全文替换必须有明确 confirmation refs；没有确认时不能执行。

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
