# SciForge Computer Use 当前任务

最后更新：2026-06-07

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

- [ ] `packages/actions/computer-use/live-acceptance-validator.ts` 约 3000 行，后续拆成 required refs、product path、artifact completion、replay/marker、shared helpers 等小模块。

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

当前状态：P4 已达到 unit-proven。证据来自 WindowAction primitive port 测试、default Computer Use materializer 测试和 Agent Host turn-loop 普通聊天测试。它证明单步低风险 GUI action 能通过 primitive chain 完成；不代表完整用户级 workflow 或真实桌面 product-ready。

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

- [ ] 从普通聊天入口触发一个低风险 GUI 局部操作。
- [ ] Agent Host 选择 target、调用 bind/observe/act/control。
- [ ] Computer Use 返回 action evidence。
- [ ] Agent Host 基于 evidence 生成 final answer。
- [ ] 如果任务要求产物，还必须有 artifact refs / validator refs。

Acceptance Gates：

- [ ] 用户能从 final answer 理解操作是否完成、证据是什么、还有什么没做。
- [ ] Completion truth 不来自 `act.status=completed` 或 `run_procedure.status=completed` 本身。
- [ ] 证据不足时 final answer 必须 partial / blocked。

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
