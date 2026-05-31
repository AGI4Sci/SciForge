# 视觉 Computer Use Agent 设计文档

版本：v0.4-multi-screen-actor-cursor
日期：2026-05-31

---

## 1. 核心目标

Computer Use agent 的目标不是抢占用户当前桌面，而是在任务空间里创建独立、可观察、可回放的虚拟显示组。一个显示组可以包含多块虚拟屏幕；每块屏幕可以显示多个参与者光标。用户、agent 和自动化成员都通过自己的 actor cursor 表达 presence、指向和操作意图；真正改变 GUI 状态的输入由 screen/window scoped executor adapter 调度提交，不移动用户真实鼠标，也不向用户当前桌面发送全局键盘事件。

目标架构：

```text
Task / Collaboration Space
-> VirtualDisplayGroup
   -> VirtualScreen A
      -> ActorCursor(user)
      -> ActorCursor(agent-1)
      -> ScreenExecutor(pointer/keyboard/focus adapter)
   -> VirtualScreen B
      -> ActorCursor(agent-2)
      -> ScreenExecutor(pointer/keyboard/focus adapter)
User real desktop
-> real display / real mouse / real keyboard
```

这个方向有四个收益：

- **可见**：用户能看到每个任务空间的虚拟屏幕、参与者光标、键盘输入、动作时间线和最终产物。
- **隔离**：agent 不移动用户真实鼠标，不向用户当前桌面发送全局键盘事件。
- **协作**：多位成员可以同时在同一块虚拟屏幕上指向、标注和提出操作意图，执行动作仍经过可审计调度。
- **通用**：算法面向任意 GUI 软件，不把 PowerPoint、Word、浏览器或某个页面写成特例。

当前 `package-owned target-bound host` 继续保留，但它只是 deterministic test harness。它可以验证 action loop、输入隔离、trace、artifact validator、viewer 和 evidence contract；它不能替代真实虚拟桌面、真实应用或用户级验收。

---

## 2. 设计原则

### 2.0 L2/L1/L0 边界先行

Computer Use 是 TUI-owned action provider，不是第二个任务大脑。一个 active task 只能有一个 L2 Root Agent Host；在 SciForge 生产路径中，这个 L2 是 Codex app-server，在调试路径中可以是 Codex CLI/native plugin host。Computer Use package 可以维护 domain-local observe/ground/execute/verify loop，但不能决定跨模块下一步、不能选择 browser/file/gui/verifier pipeline、不能拥有 repair 策略，也不能宣布用户级任务完成。

推荐放置：

```text
L2 Root Agent Host
  -> Codex app-server production path
  -> owns task planning, module selection, approval, repair, completion, pipeline trace

L1 Computer Use Resource Adapter
  -> display group/session/screen/cursor/lease/evidence/replay refs
  -> backend/provider/version/resource lifecycle
  -> exposes only Codex native tool/plugin/MCP or module.* surface

L0 Computer Use Handlers
  -> capture | crop | ground | propose scoped action | execute | verify | writeTrace | emitEvent
  -> one handler does one action and does not call unrelated modules
```

L1 的边界必须具体：它可以管理同一 Computer Use 资源域内的 session、cache、refs、events、adapter readiness、backend lifecycle 和 L0 handler routing；它不做跨模块 planning，不做 capability ranking，不做 prompt route，不做用户级 completion，不直接调用 GUI renderer。L0 handler 只能完成一个明确动作，例如 capture、ground、execute、verify 或 writeTrace；如果需要组合多个无关模块，那是 L2 semantic pipeline 的职责。

### 2.1 纯视觉优先

agent 主要通过截图、crop、OCR、VLM 视觉描述、屏幕变化和文件产物证据理解 GUI。默认不读取 DOM、accessibility tree、应用私有 API 或隐藏状态。

这不是因为这些接口没有价值，而是为了让算法保持跨应用通用性：同一套 observe、explore、act、verify 机制应能迁移到浏览器、Office、LibreOffice、设置面板、文件管理器和其他普通桌面软件。

### 2.2 Planner 不直接输出坐标

Planner 负责决定“要探索什么”或“要做什么动作”，不直接决定屏幕坐标。坐标属于 grounder / executor adapter 的职责。这样可以避免 LLM 把截图上的某个偶然像素当成稳定接口，也方便未来替换不同的虚拟桌面 backend。

Planner 的输出应是通用意图，例如：

- 再观察或等待界面稳定
- 放大检查某个区域
- 识别几个相似按钮的区别
- 点击“保存”按钮
- 在当前输入框输入文本
- 用标准保存快捷键保存文件
- 完成或阻塞，并说明证据

### 2.3 VLM 是感知工具，不是执行者

VLM 可以帮助描述图片、识别图标、比较 before/after、理解表格/图表/图片内容，也可以解释为什么当前证据不够清楚。

VLM 不应该：

- 直接执行动作
- 绕过 grounder 输出最终坐标
- 单独宣布任务完成
- 用旧截图或 prior memory 替代当前证据
- 写入 raw provider payload、inline image、base64、secret 或 Authorization 信息

VLM 的输出必须变成可引用的 evidence record，由 completion guard 和 planner query 使用。

### 2.4 完成判断必须 fail closed

任务完成不是一句 LLM 判断，而是 evidence query 的结果。尤其是会产生文件的任务，完成必须至少有：

- 当前视觉证据，证明界面处在合理状态
- 当前 artifact/file evidence，证明文件确实出现在 run bundle 或目标目录
- validator 结果，例如 PPTX/DOCX/CSV 结构校验
- action causality，证明产物来自当前轮 GUI 操作，而不是历史文件或脚本直写
- 没有阻塞级 uncertainty

如果缺证据，应继续探索或返回 blocked，不能用旧截图、旧 trace summary 或“我刚才点过保存”直接宣布成功。`finalArtifactRef` / `visibleArtifactRefs` 证明当前任务产物已经可见或落盘，`completionEvidenceRef` 证明 isolated L3 workflow 已由同轮 canonical evidence 验收；两者缺口不能互相代称。

---

## 3. 多屏多光标虚拟桌面架构

每个任务或协作空间拥有一个 `VirtualDesktopSession`，其中可以包含一个 `VirtualDisplayGroup`、多块 `VirtualScreen`、多个 `ActorCursor`、文件系统工作区、capture stream、replay bundle 和输入 lease。多鼠标在产品语义上优先表示多 actor cursor：它们可并行移动、标注和表达意图；它们不是默认等价于 OS 内注册的多个真实 pointer 设备。

推荐分层：

- **SessionManager**：创建、租用、暂停、关闭每个虚拟桌面 session。
- **Display Group Manager**：管理 display group、screen identity、screen geometry、screen lifecycle 和 screen-to-session 绑定。
- **Capture Adapter**：从指定 screen/window 获取整屏截图、窗口截图、局部 crop 和录屏帧。
- **Actor Cursor Layer**：维护每个 actor cursor 的 `actorId`、`cursorId`、颜色、标签、screen/window 坐标、状态和轨迹。
- **Action Scheduler**：把 mutating action 按 screen/window scope 排队，分配 executor lease，并记录 actor/cursor provenance。
- **Executor Adapter**：把 click/type/drag/scroll/hotkey 等动作提交给目标 screen/window 的真实 backend，不触碰用户真实输入设备。
- **User Control Plane**：记录 session permission、app/window allowlist、risk preview、confirmation、stop/cancel lease 和截图/数据可见性 refs；GUI 只能展示和回传确认文本，不能扩大权限或执行动作。
- **Platform Sidecar Adapter**：封装 macOS Accessibility、Windows UI Automation、Linux/noVNC/RDP capture/input、focused-window binding 和 permission/preflight；只返回 refs、executor events、isolation flags 和 diagnostics，不做 planning 或 completion。
- **Artifact Observer**：观察 run bundle、保存目录、文件列表和最终产物。
- **Replay Viewer**：展示虚拟屏幕帧、多光标轨迹、点击、键盘输入、动作时间线和证据 refs。
- **Computer Use Action Provider**：运行 domain-local observe/explore/act/verify guard，不直接依赖 GUI renderer；它输出 evidence、blocked、approval request 或 candidate completion refs，由 L2 Root Agent Host 组合其它模块后判断用户级完成。

优先 backend：

- 第一阶段：Linux desktop + noVNC + LibreOffice/browser，先得到可隔离、可观看、可自动化验证的真实 GUI 环境。
- 后续阶段：Windows/RDP 或 macOS/VNC，用于真实 Microsoft Office、Keynote、Pages 等软件。
- 测试阶段：package-owned target-bound host，继续作为 deterministic harness。

关键约束：

- 每个 screen 有自己的 executor lease；window-local action 可以有 window lease，但任何会改变 OS focus、全局菜单、窗口层级或系统状态的动作必须持有 screen lease。
- actor cursor 的 move/point/annotate 可以并行记录；click/type/drag/scroll/hotkey/save/open_menu 等 mutating action 必须进入 scheduler，并由 executor adapter 提交。
- 同一 screen 的真实 GUI focus 默认只有一个。多个 actor 可以同时提出 action proposal，但提交顺序必须可审计、可回放、可取消。
- 所有输入事件必须记录到 run bundle，包括 `actorId`、`cursorId`、`screenId`、可选 `windowId`、lease scope、pointer、keyboard、scroll、focus 和保存动作。
- 每个真实 mutating run 必须有 session permission ref、app/window allowlist ref、risk preview/ref、cancel path 和 data visibility refs；这些 refs 只能由 TUI Host / Computer Use scheduler 解释，GUI 不得把它们转成直接执行入口。
- isolation flags 必须明确记录：`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。
- viewer 里的可见性必须来自真实或可解释的 frame refs，不应只生成空白 PNG。
- 真实 OS multi-pointer / multi-seat 只是未来 backend adapter，不进入 planner、schema 或 GUI 的核心假设。产品层多鼠标始终先表达为 actor cursor、proposal、lease owner 和 replay overlay。

### 3.1 Codex 风格 action adapter 模型

Computer Use 不应把“鼠标设备”作为核心抽象。更可扩展的模型是 Codex 风格的 action adapter：planner 选择 app/window/element/region 等目标，grounder 把目标绑定到 screen/window-local coordinate 或 host element ref，executor adapter 再负责把动作落到目标 backend。

推荐输入模型：

```text
ActorCursor
  -> presence / pointer movement / intent proposal
ActionTarget
  -> screen | window | element | region | artifact intent
ActionScheduler
  -> screen lease | window lease | approval gate
ExecutorAdapter
  -> host-specific click/type/drag/scroll/hotkey
EvidenceLedger
  -> actor/cursor/screen/window/action causality
```

scope 规则：

- `observe`、`crop`、`OCR`、`VLM describe`、`cursor move`、`point`、`annotate` 是只读或 presentation 行为，不需要 executor lease。
- window-local 的 click/type/scroll/drag 可以申请 window lease，但执行时仍必须证明目标 window、target bounds、focus 和 before/after evidence。
- screen-global 的 app switch、window switch、system menu、global hotkey、save dialog、permission prompt 和高风险确认必须申请 screen lease。
- 如果 backend 将来支持真实 multi-pointer/multi-seat，可以把某个 window executor 升级为独立 backend adapter；package contract 仍按 actor cursor + scheduler + evidence 表达，不把多 pointer backend 写死进 planner。

真实 multi-pointer backend 研究结论：

- XInput MPX 可以在部分 Linux/X11 环境暴露多个 master pointer/keyboard，但桌面环境和应用兼容性不稳定，focus、菜单、拖拽、文本输入和远程观看链路容易退化成单 active focus；只能作为 Linux executor backend 的 opt-in 能力。
- Wayland seats 的隔离语义更接近多用户输入，但 compositor、portal、远程桌面协议和应用支持差异大；Computer Use contract 只能读取 adapter readiness、seat binding refs 和 executor event refs，不能把 seat 当作 planner 层抽象。
- RDP/remote desktop protocol 往往更适合 production：每个 remote session/window executor 可以提供隔离 pointer/keyboard、capture stream 和 replay frame，但仍必须通过 screen/window scoped lease 串行动作，并记录 before/after evidence。
- macOS/VNC/Accessibility 默认更容易变成 shared system input；没有 target-bound isolated adapter 时只能作为 diagnostic/blocked evidence，不能生成 user-acceptance completion。

因此真实多指针能力只允许挂在 `ExecutorAdapter` 之后，作为可替换 backend 宣告 `inputIsolation`、`screenId`、`windowId`、`leaseScope`、`executorEventRef` 和 replay refs；planner、GUI 和 acceptance validator 继续只依赖 actor cursor、scheduler lease 与 evidence/replay contract。

### 3.2 Codex 产品化经验的迁移边界

Codex bundled Computer Use 的可取之处是：标准 plugin/MCP 包装、小而稳定的 UI action tool surface、先观察再动作、细粒度 confirmation policy、用户可控的真实 app access，以及独立 native sidecar 承担平台能力。SciForge 应吸收这些产品化经验，但不能把它们变成 GUI direct action 或第二个 task brain。

迁移原则：

- **Plugin/MCP 包装**：`sciforge.computer-use` 应有可被 Codex app-server / CLI 发现的 local plugin 或 MCP server，tool surface 保持窄入口，例如 `observe`、`propose_action`、`execute_scoped_action`、`get_replay_refs`。内部仍调用 package host ports、scheduler、evidence ledger 和 validator。
- **小而稳定的工具面**：公共工具可以包含 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action` 和 `get_replay_refs`；其中 click/type/scroll/press_key 只是 L2 友好的 action adapter facade，内部必须投影成 scoped action proposal、lease、executor event 和 evidence refs。公共工具不得接受裸全局坐标、provider route、GUI private state 或 scheduler internals。
- **先 observe 后 mutate**：任何 click/type/drag/scroll/hotkey/save 前必须有当前 screen/window observation ref、state snapshot ref、grounding ref 和 freshness check。没有当前 observation 的 mutating action fail closed。
- **细粒度 confirmation policy**：删除、上传、发送消息、登录/权限、支付/金融、安装软件、敏感数据传输、系统设置、验证码/安全屏障和医疗/法律/HR 等类别必须分别映射到 `needs-confirmation`、approval request 或 hand-off required；确认发生在 action-time，第三方内容不能作为授权。
- **用户控制面**：run start 写 session permission manifest，包含 allowed apps/windows/screens、forbidden apps、input modality、risk class、screenshot/data policy、stop/cancel lease ref 和 approval mode。GUI 只展示这些 refs，并把用户确认作为 terminal-equivalent text 或 confirmation result 返回。
- **Platform sidecar**：macOS/Windows/Linux 的真实 UI 操作放在 sidecar/MCP/backend adapter。sidecar 只能执行 capture/state/input/preflight L0 动作，必须返回 refs-first evidence 和 isolation flags；禁止 planning、completion、GUI rendering、workspace policy 和 artifact shortcut。
- **产品化 smoke**：package diagnostic 只证明 contract；真实通过标准至少包括 app-server/native plugin 调用、platform sidecar/noVNC/RDP、单 app artifact、multi-app workflow、高风险 confirmation stop、blocked recovery、viewer real frames 和 bundle-local evidence。

### 3.3 当前 session skeleton 边界

当前 package 已有 `VirtualDesktopSession` / `SessionManager` skeleton，但它是 refs-first session contract，不启动 noVNC、RDP、LibreOffice、浏览器或任何真实 GUI backend。它的职责是为每个 task/collaboration space 预留可审计资源、写 manifest、管理 display/screen/cursor/executor lease refs，并在输入隔离能力不足时 fail closed。

`SessionManager.create(task_or_thread_id)` 成功时会创建独立 session root，并写入：

```text
<session-root>/
  virtual-desktop-session-manifest.json
  virtual-display-group.json
  virtual-display.json
  virtual-screens.json
  actor-cursors.jsonl
  virtual-input-queue.jsonl
  filesystem-root/
  capture-stream.json
  replay-bundle.json
  input-adapter-manifest.json
  leases/<lease-id>.json
```

创建前必须有 target-bound isolated input adapter manifest。`build_target_bound_input_adapter_manifest(..., input_channel="remote-desktop-isolated-session")` 这类声明可以通过 skeleton 校验；state-only `get_virtual_input_adapter_manifest()` 不能通过，因为它不改变目标环境、`realWindowEvidenceCapable=false`。缺少 adapter、adapter 不是 target-bound、重复 lease、release 错 lease、session 已关闭或 session 不存在时，skeleton 写 `virtual-desktop-session-blocked-manifest.json` 或 `blocked/*.json`，状态为 `blocked`，并保留 refs-first 诊断。

这个 skeleton 的边界必须写清楚：

- 它可以验证 session root 分离、资源 refs、lease 独占、blocked manifest、no secrets、no inline payload 和输入隔离 flags。
- 它不会声明真实桌面已启动，也不会声明真实应用完成。
- manifest 固定记录 `diagnosticOnly=true`、`realWindowEvidence=false`、`inputExecuted=false`、`osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。
- 只有未来 backend 真正把 capture、execute、verify 绑定到 isolated virtual desktop 后，session manifest 才能从 skeleton contract 进入 L1/L2/L3 验收。

---

## 4. 主动视觉探索算法

旧范式是线性循环：

```text
observe -> plan -> act -> verify
```

新的范式是主动视觉探索，但边界要清楚：只有不改变屏幕、窗口、viewport、focus、菜单、tab 或应用状态的操作，才属于 evidence loop。任何会改变可见界面状态的操作，即使风险很低，也必须进入 action loop，经过 ground、execute、verify 和 evidence 记录。

```text
Evidence Loop:
  observe -> inspect/crop/VLM/OCR -> update evidence graph
  repeat until evidence is enough or blocked

Action Loop:
  plan action -> ground -> execute -> verify -> update evidence graph

Task Loop:
  evidence loop -> action loop -> evidence loop -> ... -> complete/blocked
```

这里的 `complete/blocked` 是 Computer Use action provider 的 domain-local verdict：它说明当前桌面动作链路是否具备足够 refs、artifact evidence 和 verifier evidence。用户级任务是否完成，仍由 L2 Root Agent Host 在 semantic pipeline 中结合其它模块结果决定。

也就是说，agent 不必每次观察后立刻行动。它可以先补充证据：重新截图、等待稳定、crop 局部、OCR、请求 VLM 描述图像、比较 before/after、检测 UI 区域、阅读视觉表格，直到信息足够成熟再行动。但如果下一步需要 scroll、hover、打开菜单、切换面板、缩放视图或改变 focus，它已经不是 evidence loop 的探索，而是一次正式 action。

当前 package loop 会在 grounding 成功后、execute 之前尝试调用可选 `hostPorts.crop(observation, region)`。region 来自 grounding metadata 的 `cropRegion` / `focusRegion` / `targetRegion` / bounds 字段，缺省时退化为 grounding point 周边区域；返回的 crop observation 以 `query="focus-crop"` 写入 evidence ledger，并把 `focusRefs` 合并回 step 的 before observation 和 grounding diagnostics，供 trace / user acceptance 使用。Grounder diagnostics 可能是 provider 传回的 object、list 或 scalar；focus-crop 合并必须保留原始 diagnostics，不得因 list-shaped KV-Ground diagnostics 让 package loop 崩溃。`crop` 仍是只读 evidence enrichment：host 没有实现、region 不足或调用失败时不阻塞原动作；失败只写 `focus-crop` / `optional-evidence` uncertainty。任何会改变可见状态的 focus、hover、scroll、菜单或键鼠输入仍必须走 action loop。若 mutating executor action 返回失败，ledger 仍必须把该 action 记为 state-changing、invalidate 旧 visible evidence，并尽力捕获 `query="after-failed-action"` 的 after screenshot；失败动作不能伪装成 observation-only，因为底层输入可能已经部分改变屏幕。

通用窗口目标算法必须先把 generic app label 解析成稳定 app identity，再做 activation、window probing 或 target binding。类似 `Browser` / `browser` / `浏览器` 这样的标签不能直接当作可激活窗口名；runtime window-target 层应把它们映射到当前平台稳定身份（例如 macOS 上优先 bundle id，如 Safari 的 bundle id），再用该 identity 激活和探测窗口。若环境显式提供 app alias（例如 `Browser -> Google Chrome`），bundle id 必须从 alias 解析后的真实 app 取得，再回退到 generic label 默认值，避免默认浏览器标签覆盖用户/环境绑定。解析失败或只能得到模糊标签时应写 `WindowTarget` grounding diagnostics 并 fail closed，而不是靠反复 probe 猜中窗口。

### 4.1 什么时候探索

以下情况应优先探索，而不是冒险点击：

- 目标对象没找到
- 同名或相似目标太多
- OCR 置信度低
- 目标在边缘、被遮挡、太小或部分不可见
- 点击后没有可见变化
- 当前截图和历史证据冲突
- 完成判断缺最终视觉证据或文件证据
- 页面里有表格、图表、图片、公式、缩略图等 OCR 不擅长的内容

evidence loop 中允许的探索必须是只读的：

- recapture
- wait until stable
- crop
- OCR
- VLM describe
- VLM compare
- region detection
- visual table/image inspection

以下操作即使看起来低风险，也不属于 evidence loop，必须进入 action loop：

- scroll
- hover
- focus
- save
- open dropdown/menu
- switch panel/tab/window
- zoom view
- page down / page up
- any key or pointer input

这条规则让 action 的起点更干净：每次真正改变界面状态，都有明确 action causality、before/after evidence 和 verification。无需额外区分“低风险探索后要不要回退”；只要它改变状态，它就是 action。

### 4.2 行动后也要补证据

每次 action 之后，agent 不只问“有没有完成”，还要把新信息写入 evidence ledger：

- 屏幕有没有变化
- focus 区域有没有变化
- 目标是否仍存在
- 新的文本、按钮、菜单、文件是否出现
- 上一步 grounding 是否可信
- 是否产生新的 uncertainty
- 该动作是否支撑某个 artifact 或 completion claim

这样探索前得到的信息和行动后暴露的信息都会进入同一个证据系统，而不是散落在临时 prompt 里。

---

## 5. Evidence Ledger

这里的 Evidence Graph 是逻辑图，不要求一开始使用图数据库。MVP 推荐使用 append-only structured text，也就是 `evidence-log.jsonl`。每条 evidence record 有稳定 ID，并通过引用字段表达关系。

推荐存储：

```text
.sciforge/vision-runs/<run-id>/
  evidence-log.jsonl
  evidence-snapshot.json
  evidence-index.json
  screenshots/
  crops/
  artifacts/
  traces/
```

其中：

- `evidence-log.jsonl` 是唯一真相源，append-only。
- `evidence-snapshot.json` 是当前状态快照，可从 log 重建。
- `evidence-index.json` 是查询缓存，不是真相源。
- 图片、视频、artifact、trace 只存 refs，不内联大对象。

当前 package MVP 对应 `sciforge_computer_use.evidence_ledger.EvidenceLedger`。它可以作为 standalone package-local API 写出上述四个文件；如果 request metadata 提供 `evidenceOutputDir`、`evidenceLedgerDir` 或 `traceOutputDir`，ledger 使用该目录，否则保持 in-memory diagnostics。它是 evidence contract 和 planner brief query 的实现基础；不应把它单独解释成真实 GUI 验收。

每条 record 的最小结构是：

```text
schemaVersion = sciforge.computer-use.evidence-record.v1
id            = ev-000001...
sequence      = append-only sequence
runId
type
loopPhase     = evidence | action | task
actionIndex
ref / refs
summary
confidence
tags
current
derivedFrom / supports / contradicts / usedForAction / verifiedBy / invalidates
metadata
```

所有大对象必须通过 `ref` / `refs` 引用；metadata 也必须保持可序列化、可审计，不能写 secret、raw screenshot、data URL、base64 或 provider raw payload。Ledger 的共同入口必须先做通用脱敏，再写 `evidence-log.jsonl`、`evidence-index.json`、`evidence-snapshot.json` 和 `planner-brief.json`：`Authorization` / header / body / raw payload / token / secret / password / credential / inline image / base64 blob 都不能落盘，也不能进入 `byRef` 索引；`_refs_from_value` 只能提取安全 refs，例如 bundle-local 文件 refs 或明确允许的 `artifact:` / `trace:` / `approval:` refs。

### 5.1 记录哪些证据

核心 evidence 类型：

- **observation**：一次整屏或窗口观察。
- **region**：从观察中截出的局部区域。
- **text**：OCR 或可验证文本。
- **visual-object**：按钮、输入框、菜单、图标、图片、表格等视觉对象。
- **vlm-claim**：VLM 对截图或 crop 的描述/比较结论。
- **grounding**：把目标描述绑定到某个可执行目标的结果。
- **action**：一次点击、输入、滚动、拖拽、快捷键或等待。
- **verification**：动作后的变化、成功、失败或不确定判断。
- **artifact**：保存文件、目录列表、文件 hash、validator 结果。
- **uncertainty**：缺失目标、歧义目标、低置信 OCR、完成证据缺口等。
- **completion-claim**：完成判断及其支持证据。

MVP record type 固定为：

```text
observation
region
text
visual-object
vlm-claim
grounding
action
verification
artifact
uncertainty
completion-claim
```

其中当前代码会直接落地 observation、text、artifact、grounding、action、verification、uncertainty 和 completion-claim；grounding 后的可选 focus crop 会作为 `query="focus-crop"` 的 observation 落地并提升 `focusRefs`。region、visual-object、vlm-claim 仍是 schema/contract 预留类型，供 OCR/VLM/region detector 或更细的 crop 分析写入。预留类型可以进入 ledger，但不能被 README 写成当前真实视觉能力已完成。

每条记录至少需要回答：

- 这是什么证据
- 它来自哪张截图、哪个 crop、哪个 artifact 或哪个动作
- 它支持或反驳什么
- 它是否仍然 current
- 它的置信度如何
- 它是否因为后续动作变 stale

### 5.2 用文本表达图关系

不需要一开始引入 graph database。结构化文本已经能表达图的核心信息：

- `derivedFrom`：这条证据从哪些证据推导出来
- `supports`：它支持哪些目标、动作或完成判断
- `contradicts`：它反驳哪些旧结论
- `usedForAction`：哪些证据被用于某次动作
- `verifiedBy`：哪些验证记录确认了它
- `invalidates`：哪些后续动作或观察让它失效

图结构的好处保留在逻辑层；物理存储先保持简单、可 diff、可审计、可重建。

### 5.3 查询方式

Planner 不应该读完整 evidence log。系统应先用 deterministic query 生成 compact evidence brief，再交给 Planner。

常用查询：

- 当前最新观察
- 当前可见文本
- 当前可见对象
- 目标候选列表
- 阻塞级 uncertainty
- 最近动作和验证结果
- artifact/file evidence
- visible artifact refs / visible artifact summaries
- completion 缺口

MVP query 是 `build_planner_brief(records, recent_action_limit=5)`，输出 `planner-brief.json`：

```text
schemaVersion = sciforge.computer-use.planner-brief.v1
latestObservation
currentText              # 最多 20 条
currentObjects           # 最多 20 条
candidateTargets         # current visual-object / grounding，最多 20 条
blockingUncertainty      # 最多 10 条
recentActions            # 最近 action，默认 5 条
artifactEvidence         # 最多 20 条
visibleArtifactRefs      # 当前 observation / sidecar 中可见的 artifact-like refs
visibleArtifacts         # current visible artifact summaries，最多 20 条
completionGaps
```

MVP brief 先使用 `evidence-index.json.current` 过滤 stale record，再按 recency 做紧凑截断。下面的排序原则是目标设计；当前实现还不是完整 ranker。

排序原则：

```text
freshness > directness > confidence > spatial relevance > textual relevance > source reliability
```

source reliability：

```text
deterministic file validator
> current screenshot/OCR
> crop VLM claim
> whole-screen VLM claim
> prior memory
> action history
```

prior memory 和 action history 可以帮助解释、修复和重新定位，但不能单独支撑完成。

### 5.4 Freshness 规则

每个会改变界面的动作都可能让旧证据 stale：

- click、type、press key、scroll、drag 后，旧截图、旧 OCR、旧对象位置默认 stale。
- crop、OCR、VLM describe 不改变屏幕，不会让旧观察 stale。
- wait 后如果 screen diff 很小，可以延长 observation freshness。
- 切窗口、导航、切 tab、打开新应用后，旧 window subtree stale。
- 保存文件后，旧目录 listing stale，必须重新 observe artifact/file evidence。

这个规则很重要：它避免 agent 用过期截图“证明”当前状态。

MVP 里的实际规则是：

- `action_mutates_visible_state(action_kind)` 对 `open_app`、`click`、`double_click`、`drag`、`type_text`、`press_key`、`hotkey`、`scroll`、`focus`、`save`、`hover`、`open_menu`、`open_dropdown`、`switch_tab`、`switch_window`、`switch_panel`、`zoom`、`page_down`、`page_up` 返回 true。
- `recapture`、`wait_until_stable`、`crop`、`ocr`、`vlm_describe`、`vlm_compare`、`region_detection`、`visual_table_inspection`、`visual_image_inspection` 以及 `observationOnly=true` 的 action 不会让旧可见状态证据 stale。
- state-changing action record 会把当时 current 的 visible state record ids 写入 `invalidates`。`evidence-index.json.staleBy` 记录 stale record id 到 invalidating action id 的映射，`current` 排除这些 stale id。
- 当前可见状态集合只包括 `observation`、`region`、`text`、`visual-object`、`vlm-claim`、`grounding`。artifact、verification、completion-claim 不因为一次点击自动 stale；它们必须由新的 artifact evidence、verification 或 completion guard 重新解释。
- 保存动作后目录/file-list evidence 必须重新观察；旧 listing 不能单独支撑 completion。

---

## 6. Visible Viewer Placeholder

Visible replay viewer 不能用空白 PNG 假装有画面。MVP 的 frame 只有两种合法类型：

- `kind="screenshot"`：必须有非空本地 `screenshotRef`，并且不能是 `data:`、`base64:` 或 inline payload。
- `kind="placeholder"`：明确声明这不是截图，不能带 `screenshotRef`，必须包含 `reason`、`explanation`、`sourceRefs` 和 `sourceContext`；如果有 `missingScreenshotRef`，也必须是普通 ref，不能是 inline payload。

当 result 没有 screenshot refs、截图 ref 指向缺失/空文件，或候选截图只有 inline image payload 时，viewer 生成可解释 placeholder frame，并在 validation 里给出 `frameCounts.screenshot` / `frameCounts.placeholder`。Placeholder 只能说明“为什么这里没有可渲染截图”，不能作为视觉完成证据；completion 仍需要当前截图、artifact/file evidence 和 verifier/validator。

Viewer 仍必须保持：

- `rawPayloadWritten=false`
- `inlineImageWritten=false`
- `secretsWritten=false`
- `sharedSystemInputUsed=false`
- `systemPointerMoved=false`
- `systemKeyboardEventsSent=false`

---

## 7. Uncertainty 是一等公民

系统不只记录“看到了什么”，也要记录“哪里没看清、哪里不确定”。这能让 agent 在困惑时主动探索，而不是硬点。

常见 uncertainty：

- missing target：目标没找到
- ambiguous target：候选太多
- low-confidence OCR：文字不可靠
- stale evidence：证据可能过期
- completion gap：完成证据不足
- visual content unclear：图片/图表/表格看不清
- artifact not visible：产物没有当前可见或文件证据

blocking uncertainty 会阻止 completion。只有通过新观察、新 crop、新 OCR/VLM、文件证据或验证结果解决后，completion guard 才能放行。

---

## 8. 通用动作与应用能力

核心动作空间保持通用。下面是 package/conceptual action space；CU-LONG TS runtime planner/executor 的严格 action schema 仍是 `open_app`、`click`、`double_click`、`drag`、`type_text`、`press_key`、`hotkey`、`scroll`、`wait`。Quota filler 只能使用所在层级支持的安全 generic action；package-level `focus` / `save` 兼容不代表 TS runtime completion evidence 接受这些 action。

- click / double click
- focus
- type text
- press key
- save
- scroll
- drag
- wait

PPTX、DOCX、CSV、PDF、图片等文件格式能力不应进入核心鼠标键盘算法。它们应该作为 artifact renderer / validator / previewer 插件存在。

例如“做 PPT”不是特殊 planner；它只是：

- 在某个可视桌面里使用通用 GUI 动作
- 通过保存动作产生 `.pptx`
- 用 PPTX validator 检查结构、页数、宏风险和内容
- 用 replay/viewer/artifact refs 证明过程

同理，Word、Excel、浏览器、多应用工作流也应复用同一套 observe、explore、act、verify、evidence ledger。

---

## 9. 安全与用户确认

高风险动作默认 fail closed，例如：

- 发送消息或邮件
- 删除文件或账户数据
- 支付或购买
- 发布内容
- 上传外部文件
- 修改权限、账户、安全设置
- 对外提交表单

遇到高风险动作时，Computer Use action provider 不直接弹 UI，也不执行动作。它返回 `needs-confirmation` 和 refs-first approval request。TUI Host 或 GUI 再决定如何向用户展示确认。

Runtime package bridge 会把这些确认语义落为专用 sidecars：未确认停止写 `approval-request.json` 和 `risk-audit.json`，恢复确认请求写 `confirmed-request.json` 与更新后的 `risk-audit.json`。Confirmed retry 还必须把 prior fail-closed request 复制为当前 bundle-local `approval-source-request.json` / `approval-source-gui-ask-user.json` / `approval-source-risk-audit.json`，并写 `approval-decision.json` 绑定 `approvalRequestId`、`riskActionHash` 和 canonical `approvalRef`；只有 `approvalRef` 的自造闭环不能通过 CU-NEXT-06。Blocked run 的修复连续性另写 `blocked-manifest.json`、`repair-hint.json`、`continuation-request.json`。这些文件由 TUI Host side bridge 写入，package 仍不得直接调用 `gui.present` / `gui.ask_user`。Sidecar 和 task marker 中的 `deniedExecuted=false` 表示被拒绝或等待确认的高风险动作没有执行；`CU-NEXT-03 status=needs-confirmation` 是正确停在外部发送前的成功 high-risk stop projection，不应被降级成 diagnostic failure。`CU-NEXT-06` 的审批链还要求 sidecar 内容交叉验证：`approval-request.json`、`gui-ask-user.json`、`confirmed-request.json`、`risk-audit.json`、source sidecars 和 approval decision 必须共享同一个 `approvalRequestId`、`riskActionHash` 和 canonical `approvalRef`，互相引用对应 sidecar refs，并显式声明 `packageMayCallGuiDirectly=false`；session、trace 或 request 派生的 approval token 不能作为完成证据。

当前确认/审批的 canonical refs-first 记录是 TUI Host bridge sidecars；package loop 仍在 evidence ledger 中记录高风险动作、uncertainty、截图/动作 refs 和执行结果。若后续需要 ledger-backed confirmation receipt，它必须引用这些 sidecar refs 和同一轮 trace refs，而不是让 package 直接调用 GUI 或把 sidecar 复制成完成证据。

---

## 10. 验收分层

### 10.1 Package-local 层

验证 package contract：

- CLI/API/stdio contract
- target-bound deterministic host
- virtual input state refs
- visible replay viewer
- artifact renderer/validator
- evidence ledger schema
- isolation flags

这一层证明包的协议和算法骨架，不证明真实 GUI 成功。

### 10.2 L1 isolated desktop smoke

在 disposable virtual desktop 中完成最小真实 GUI 操作：

- `acceptanceTier=l1-isolated-smoke`
- `backendKind=linux-novnc-libreoffice-browser`
- `captureSource=isolated-virtual-display`
- `inputChannel=remote-desktop-isolated-session`
- 点击输入框
- 输入文字
- 点击按钮
- 验证屏幕变化
- 记录 virtual pointer/keyboard logs
- 生成 live/replay frames
- 读取 completed result/trace、真实 screenshot frames、viewer refs、session refs、noVNC viewer ref、backend readiness proof、backend process proof、runtime resource allocation proof 和 evidence ledger current completion claim

`isolated_desktop_backend_probe` 的 `status=ready` 只是依赖 readiness。只有 `validate_isolated_desktop_l1_smoke_evidence` 通过时，才可以把一次 run 作为 L1 smoke evidence；它会读取 `preflightRef` 并要求 backend probe schema、`status=ready`、Linux platform、匹配 backend kind、required observed components、`noVncWebRoot` 和全 ok 的 `preflightChecks`。L1 允许 backend probe 的 `diagnosticOnly=true` 作为依赖 readiness，但拒绝 shape-only preflight、`readinessOnly=true`、`executeFailClosed=true`、非 Linux、错 backend、缺组件、缺 noVNC root 或 failed checks。它还会拒绝 package-owned target-bound channel、placeholder-only viewer、prior-round done、stale completion supports、缺失或无效 `backendReadinessProofRef`、缺失 queryable X display proof、缺失 noVNC localhost HTTP viewer proof、缺失 browser desktop window/page ready proof、缺失或不匹配的 `executorCommandEventLogRef`、缺失 `targetWindowRef` / `windowBoundPointerProofRef`、缺失 `processRef` / `resourceAllocationRef`、裸全局 pointer command、相同初始/最终截图内容、inline screenshot payload 和任何 shared/system/real OS input flag。`processRef` 必须解析为 `sciforge.computer-use.backend-processes.v1`，覆盖 virtual-display/window-manager/vnc-server/novnc-proxy/browser 角色，并提供存在的 stdout/stderr log refs；`resourceAllocationRef` 必须解析为通用 `sciforge.computer-use.isolated-runtime-resource-allocation.v1` 并证明 isolated display 与 VNC/noVNC localhost 端口分配，端口在存在时要与 readiness proof 匹配，session refs 声明 sessionId 时也必须匹配；二者都不能携带 shared/system side-effect flags。每个 pointer/keyboard input event 必须能追到成功的 isolated input executor command event，`commandEventLogRef` / `commandEventRef` 必须指向同一个 command log，且 action index、modality、returncode、no shared/system side-effect flags 和 isolated `DISPLAY` 与 workflow/session 一致。Pointer event 还必须声明 `coordinateSpace=window`、window-local hit point、target bounds、target window/proof refs，并匹配 executor command 中的 `xdotool mousemove --window <windowId>`。

L1 validator 默认要求 refs 存在且 `filesystemRootRef` 是目录；target-bound package harness 只能声明 `acceptanceTier=package-diagnostic` 与 `userAcceptanceEligible=false`，不能把自身升级为 L1/L2/L3。

### 10.3 L2 single-app artifact

在 isolated desktop 中使用真实应用或可离线 GUI 应用生成 artifact：

- LibreOffice Impress/Writer 或真实 Office
- 保存 PPTX/DOCX/CSV 等文件
- 获取最终可见截图、文件证据、validator 结果和 replay viewer

### 10.4 L3 multi-app workflow

在同一个 virtual session 中跨应用完成任务：

- 浏览器读取资料
- 文档或演示软件写报告/做 PPT
- 文件管理器确认保存
- viewer 展示全过程
- evidence ledger 支撑最终完成

L3 isolated multi-app workflow evidence contract 描述真实完成时必须提交什么。`isolated_desktop_l3_workflow_probe` 默认只写 fail-closed readiness manifest；传入 `--execute` 且 Linux noVNC + LibreOffice/browser、isolated input、截图工具和 file-preview 工具都 ready 时，会运行真实 same-session source -> writer -> file-preview runner，并且只有 `validate_isolated_desktop_l3_workflow_evidence(require_existing_refs=true)` 接受现有 refs 后才写 completed evidence。依赖缺失、GUI 动作失败或 validator 不通过时仍保持 blocked，不能用 shell 直写文档或 target-bound fixture 冒充完成。L3 probe 的 constants、JSON/runtime/evidence payload helpers 和 file-preview helper 已拆到 `isolated_desktop_l3_workflow_probe_helpers.py`，主 probe 文件只保留 CLI、manifest builder、completed/partial runner 主流程；拆分不改变验收边界。`validate_isolated_desktop_l3_workflow_evidence` / `build_isolated_desktop_l3_workflow_evidence` 要求：

- `acceptanceTier=l3-multi-app-workflow`
- `backendKind=linux-novnc-libreoffice-browser`
- `targetEnvironmentKind` 是真实 isolated desktop backend，不是 package-owned、fixture、mock、virtual 或 state-only target
- `captureSource=isolated-virtual-display`
- `inputChannel=remote-desktop-isolated-session`
- `userAcceptanceEligible=true`
- `diagnosticOnly=false`
- 所有 OS/shared/system input、inline/raw payload 和 secrets flags 为 `false`
- `l3Workflow.sameVirtualSession=true`
- `workflowRequirements.minimumAppCount>=3`
- pointer / keyboard input logs 覆盖对应 modality 的每个 workflow action index
- 共享 isolated desktop runtime proof refs：`backendReadinessProofRef`、`executorCommandEventLogRef`、`targetWindowRef`、`windowBoundPointerProofRef`、`processRef`、`resourceAllocationRef`；`processRef` 与 `resourceAllocationRef` 必须携带匹配 `sessionManifestRef` / `virtualDisplayRef` 的 sessionId 和 display；manifest 的 `resourceAllocationSchemaRef` 指向通用 `sciforge.computer-use.isolated-runtime-resource-allocation.v1`，`legacyResourceAllocationSchemaRef` 仅保留旧 `l1-runtime-resource-allocation.v1` 兼容 alias
- 每个 pointer/keyboard input event 必须追到 successful isolated executor command event，command 的 action index、modality、returncode 和 isolated `DISPLAY` 必须匹配；pointer event 还必须提供 window-bound pointer proof，证明 window-local coordinate dispatch、target bounds hit-testing 和 `xdotool mousemove --window <windowId>` 命令绑定；L3 `targetWindowRef` 使用通用 `sciforge.computer-use.isolated-target-window.v1` schema
- source / writer / file-preview 三类 `applicationEvidence`
- 至少两次有当前截图支撑的 `crossAppTransitions`
- source observation / source fact refs
- derived content 对 source facts 的引用
- final artifact、artifact validator、directory file-list、preview、viewer、session、noVNC、input log、evidence ledger、planner brief 和 `guiPresentRef`
- 保存动作的 action index、`savedByCommandEventRef`、`finalArtifactRef`、`artifactValidationRef`、`savedThroughGui=true`、`shellDirectArtifactWrite=false` 与 keyboard input causality
- directory preview 必须声明 `previewedByActionIndex`、`previewedByInputModality=pointer`、`previewedThroughGui=true`、`shellDirectoryListingOnly=false`，并由 pointer input event 支撑，不能只用 shell listing 代替 GUI 预览
- preflight payload 必须证明 Linux isolated backend ready，包含 backend kind、Linux platform、observed backend components 和 noVNC web root，且不得是 diagnostic-only、readiness-only、user-acceptance-ineligible 或 fail-closed probe
- session/noVNC/capture/replay refs 必须共享同一 session/display identity，noVNC 只能暴露 localhost，capture stream 必须包含 workflow screenshot refs
- existing refs 模式下至少三种不同截图文件 hash，证明 source / writer / file-preview 不是复制同一帧冒充
- artifact validation 的 `textRuns` / normalized text 必须包含每个 `supportedFactRef.fact`，证明声明使用的 source facts 真进入最终文档或演示稿

Validator 默认要求 existing refs，并读取 preflight payload、result/trace completed 状态、每步当前截图、viewer real frames、session ref schemas 与 session/display 绑定、session-bound `processRef` / `resourceAllocationRef`、`backendReadinessProofRef`、`executorCommandEventLogRef`、`targetWindowRef`、`windowBoundPointerProofRef`、pointer/keyboard logs、artifact validation、GUI 保存 causality、GUI directory preview causality、file-list/gui.present payload、截图文件 hash 多样性、supported source fact 文本进入 artifact 的证明和 current evidence ledger completion claim；`require_existing_refs=false` 只可用于诊断错误收集，不能得到用户级 L3 ok。

下面提到的 `/tmp/sciforge-cu-isolated-l3` 与容器内 `/evidence/l3/...` 是 pre-localization historical evidence，只证明 standalone Docker L3 runner 能完成。当前 CU-NEXT completion evidence 只能来自同一任务 round evidence bundle 顶层的 canonical `isolated-desktop-l3-workflow-evidence.json`，不能引用旧 `/tmp` 外部证据、跨轮 ref、绝对路径或 pseudo ref。

严格 Docker L3 gate 已产出真实 Linux isolated same-session completed run：`/tmp/sciforge-cu-isolated-l3/l3/isolated-desktop-l3-workflow-probe-manifest.json` 为 `status=completed`、`diagnosticOnly=false`、`userAcceptanceEligible=true`，`completionEvidenceRef=/evidence/l3/isolated-desktop-l3-workflow-evidence.json`；容器内独立复验 `validate_isolated_desktop_l3_workflow_evidence('/evidence/l3/isolated-desktop-l3-workflow-evidence.json')` 返回 `{'ok': True, 'errorCount': 0}`。该 run 在同一 isolated X display/session 中读取 source browser，切到 LibreOffice Writer，用 GUI Save As 保存 `source-summary.docx`，再用 Chromium directory preview 展示输出目录；executor command log、window-bound pointer proof、keyboard provenance、source facts -> DOCX textRuns、file-list/gui.present 和 evidence ledger completion claim 都来自当前 run。随后 completed evidence writer 已改成 bundle-local canonical 输出：`isolated_desktop_l3_workflow_result.py` 在 completed validator 接受后，把 output bundle 内 JSON/JSONL 的绝对 refs 规范化为相对 refs，并把 `completionEvidenceRef` 写成 `isolated-desktop-l3-workflow-evidence.json`；`isolated_desktop_l3_workflow_evidence.py` 按 evidence 文件所在目录解析这些 refs，`visible_viewer.py` 按 viewer manifest 所在目录解析 frame/input refs。严格 Docker L3 gate 复跑到 `/tmp/sciforge-cu-isolated-l3-localized-20260528b/l3`，Python validator 返回 `ok=True` / `errorCount=0`，TS completion-grade 返回 0 issues，ref scan `badRefCount=0`。Blocked/partial manifest 仍不能通过 completed L3 validator；partial refs 必须留在 partial 命名空间，不能复制到 completed L3 的 top-level `resultRef`、`inputEventLogRef`、`finalArtifactRef`、`artifactValidationRef`、`guiPresentRef` 或 `completionEvidenceRef`。`target-bound-cross-app-document-workflow.json` 只覆盖 package-owned source reader -> Word-compatible writer -> file browser/preview 的诊断形状；它必须保持 `acceptanceTier=package-diagnostic` 和 `userAcceptanceEligible=false`，不能替代真实 Docker L3 evidence。

CU-NEXT 的任务级真实验收在 L3 completed evidence 之外再加任务语义 gate。`tools/computer-use-next/live-acceptance-validator.ts` 要求每个 `cu-user-acceptance-manifest` 有 exact `taskId`、映射内 `scenarioId`、TUI Host / action provider / `gui.present` refs、before/after screenshots、focus crops、grounding diagnostics、executor lease、final artifact、verifier refs、independent input session refs，并拒绝 fixture、dry-run、shared system input、shell direct artifact write、DOM / Playwright / accessibility substitutes。七个 CU-NEXT 任务必须额外提供 top-level 结构化 `evidenceMarkers`：briefing deck、chart report、needs-confirmation、file index、repair continuity、approvalRef、dense grounding；只在 `taskText` 或任意 nested object 里写这些词不算证据，marker refs 必须是 evidence-bundle-local file refs 或允许的 `approval:` token。`tools/computer-use-next/acceptance-projection.ts` 是通用投影层：它从当前 CU-LONG passed round 的 package-bridge trace、independent-input-adapter、TUI Host sibling refs 和 verifier ref 生成任务 marker，不读取 DOM/Playwright/accessibility，也不把 fixture 或 target-bound refs 提升为完成。审批、修复连续性和目录 listing marker 必须来自专门 sidecar refs：`approval-request.json` / `gui-ask-user.json` / `confirmed-request.json` / `risk-audit.json`、`approval-source-request.json` / `approval-source-gui-ask-user.json` / `approval-source-risk-audit.json` / `approval-decision.json`、`blocked-manifest.json` / `repair-hint.json` / `continuation-request.json`、`directory-listing.json`；投影层不得用 `vision-trace.json`、request 或 verifier ref 兜底这些专门 marker。`CU-NEXT-07` 的 dense grounding marker 同样必须来自 dedicated `dense-grounding-rejections` sidecar（例如 `dense-grounding-rejections.json`），记录被拒绝的 shortcut / fallback candidates；不得用 verifier ref、generic grounding diagnostics、trace/request ref 或普通 marker 字符串兜底。审批链必须读取 sidecar records，而不只是检查 ref 字符串：`CU-NEXT-03` 的 needs-confirmation phase 校验 `approval-request.json` / `gui-ask-user.json` / `risk-audit.json`，并拒绝任何 confirmed-request；`CU-NEXT-06` 的 confirmed phase 额外要求 `confirmed-request.json`、source approval sidecars 和 approval decision；canonical `approvalRef` 必须来自 sidecar 内容，并与 approval request、GUI ask-user record、confirmed request、risk audit、source sidecars 和 decision 中的 `approvalRequestId` / `riskActionHash` 一致。source approval sidecar 只能是 prior fail-closed approval sidecar 的 verbatim copy，except bundle-local refs，不得改写 payload 语义；copy 必须保留 original identity/hash/ref，包括原始 `approvalRequestId`、`riskActionHash`、canonical `approvalRef`、source sidecar ref 和内容 hash。`tools/cu-l3-independent-input-acceptance-harness.ts` 会把该投影写入 `cu-user-acceptance-input.json` / `cu-user-acceptance-manifest.json`，并只从当前 round evidence 目录中的 canonical `isolated-desktop-l3-workflow-evidence.json` 或同目录 L3 assembly/probe manifest 的 bundle-local canonical `completionEvidenceRef` 自动投影 completion evidence；absolute/outside refs、跨轮相对 refs、reserved manifest 名、`artifact:` 伪 ref、symlink/realpath 逃逸和旧 `/tmp/sciforge-cu-isolated-l3` evidence 都不能被当作当前 CU-NEXT run 的完成证据。`completionEvidenceRef` 还必须在 completion evidence payload 中显式绑定当前任务的 `finalArtifactRef`，且当前轮 `gui.present` 必须展示同一 artifact ref；`finalArtifactRef` / `gui.present` / verifier / completion evidence 不能互相 fallback 或指向不同产物。`CU-NEXT-03` 必须使用 top-level `status=needs-confirmation` 和显式 `explicitStatus={status: "needs-confirmation", scope: "high-risk-stop"}` 表示正确停在发送前；该状态只有在完整 L3 pass evidence 同时存在时才会写出，避免把缺证据 blocked 或普通 ready 误报成 high-risk stop。Runtime Codex browser acceptance 可以作为全局 release prerequisite：当前 `docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json` 只有在 Codex in-app Browser 的 default chat single-turn、selected-ref follow-up 和 multi-turn 第二轮都可见通过时才算 passed；这条全局证据不能替代任何 CU-NEXT task manifest。Readiness 只把同时通过 live acceptance validator、marker refs 落地和 completion-grade isolated-L3 classifier 的 manifest 当作 strong evidence；classifier 要求 `completionEvidenceRef` 精确指向当前 evidence bundle 内真实存在、validator-accepted 的 canonical isolated desktop L3 workflow evidence JSON，且该 payload 为 completed、`l3Workflow.completed=true`、same-session、source -> writer -> file-preview causality、`realWindowEvidence=true`、`diagnosticOnly=false`、`userAcceptanceEligible=true`，并带齐 result/input/pointer/keyboard/executor/backend/process/resource/window/final artifact/file-list/gui.present/viewer/evidence ledger refs 与非空 screenshot/trace refs；inline `completionEvidence` 只能作摘要，不能单独证明完成。`tools/cu-next-run.ts validate-run` 也会在 CU-LONG manifest、scenario-summary 和任务映射通过后运行同一 gate，拒绝缺 marker、task/scenario 不匹配、缺 completion-grade metadata、没有 non-dry-run Computer Use trace 或 acceptance manifest 中 required refs 未在 evidence bundle 落地的伪 live evidence；`--json` 会输出稳定 `repairDiagnostics`，包含 action shortfall、missing refs、失败轮 diagnostics refs、trace metrics 和 next repair focus，供下一次真实 rerun 修复。Readiness 的 PROJECT checklist acknowledgement 只读取 `PROJECT.md` 中 CU-NEXT 段落下的顶层 checkbox 行；所有 checkbox 必须为 `[x]`，且每条已勾选行自身必须含 `20xx-xx-xx` 日期和 evidence/status/passed/blocked/partial/证据/状态之一。该 gate 和投影层不运行真实任务，也不凭 checkbox 替代 task evidence。

截至 2026-05-28，真实 CU-NEXT-01..07 均已通过 task-level validate-run：01 `cu-next-01-real-final-artifact-gate-20260528T111428Z`，02 `cu-next-02-real-final-artifact-gate-20260528T113244Z`，03 `cu-next-03-real-approval-sidecar-gate-20260528T121738Z`，04 `cu-next-04-real-parallel-20260528T0647Z`，05 `cu-next-05-real-20260528T133144Z`，06 `cu-next-06-real-confirmed-20260528T134624Z`，07 `cu-next-07-real-final-artifact-gate-20260528T1028Z`；每个最终 round bundle 都带 task marker、final artifact / `gui.present` / verifier refs 和 same-round canonical `completionEvidenceRef=isolated-desktop-l3-workflow-evidence.json`。其中 CU-NEXT-03 的 `highRiskAction` 来自 `risk-audit.json`，CU-NEXT-06 额外绑定 source approval sidecars 与 `approval-decision.json`。最终 readiness manifest `/tmp/sciforge-cu-next-readiness-final-provenance-latest.json` 已在同一组 evidence、Runtime Codex browser evidence、KV-Ground smoke 和 PROJECT checklist acknowledgement 下返回 `7/7 passed`、`completionEligible=true`。

Runtime package bridge 每轮还会写 `tui-host-run-task-chain.json`，以 refs-first 形式绑定 `computer-use-request.json`、`host-ports.json`、`tool-payload.json`、`vision-trace.json` 和可选 `gui-present.json` / `gui-ask-user.json`。它还会为对应 run 写 refs-first sidecar：`directory-listing.json` 总是存在；高风险停止写 `approval-request.json` / `gui-ask-user.json` / `risk-audit.json`；blocked/repair run 写 `blocked-manifest.json` / `repair-hint.json` / `continuation-request.json`；带 `approvalRef` 的重试写 `confirmed-request.json` / `risk-audit.json`，并在收到 prior fail-closed provenance 时写 bundle-local source approval copies 与 `approval-decision.json`。审批 sidecar 会携带 `approvalRequestId`、`riskActionHash`、canonical `approvalRef` 和对应 sidecar refs，让 validator 可以证明“请求确认 -> 用户确认 -> 风险审计 -> 继续执行”是同一条链。Trace 的 `packageBridge.tuiHostRunTaskChainRef` 指向该清单，独立输入验收 harness 可把它并入 TUI Host / `gui.present` evidence claims，并发现这些专门 sidecar refs。相关写文件、approval/risk helpers 和 chain builder 已拆到 `src/runtime/computer-use/package-bridge-evidence.ts`，主 bridge 文件只保留运行编排和 trace 组装职责。该清单和 sidecar 只证明 TUI Host 调用 package `run_task`、GUI intent metadata 和 evidence-bundle 索引链路，不能替代真实截图、输入、artifact、verifier 或 CU-NEXT task completion。

Package bridge 的 trace / payload 还会暴露 artifact presentation 面：`artifactRefs`、`finalArtifactRef`、`finalArtifactRefs`、`cuUserAcceptance.visibleArtifactRefs`、`virtualRemoteSession.visibleArtifactRefs` 和 `visibleArtifacts`。`gui-present.json` 是 presentation sidecar，不是 final artifact 本身；真正的任务产物必须是 artifact-like bundle-local ref，例如 `report.md`，并由 trace / `gui.present` / verifier 引用。

窗口目标 probe、bundle id 激活成功、Swift JIT 可用性或其失败诊断都只能说明 runtime 能否定位/驱动候选窗口；它们不能替代 package-level acceptance。CU-NEXT task acceptance 仍必须经过任务级 manifest、真实截图/输入/artifact/verifier refs 和 completion-grade gate，不能因为 probe 显示某个 generic `Browser` label 已映射到稳定 app identity 就自动通过。

真实 CU-LONG/CU-NEXT preflight 必须对 configured KV-Ground endpoint 执行 live `/health` 检查；只存在 `SCIFORGE_VISION_KV_GROUND_URL` 或 `visionSense.grounderBaseUrl` 不足以进入真实 run。Dry-run 和 fixture action 路径可以只验证配置存在，但 real task preflight 对 `ECONNREFUSED`、timeout、非 JSON 或 `ok !== true` 都要 fail closed，并给出启动 KV-Ground 或 SSH tunnel 的 repair action。Preflight diagnostics、matrix summary 和 repair plan 只能打印去掉 userinfo、query、hash 和 bearer/token/secret/password 参数的 endpoint label；真实 provider URL、token 或 prompt query 不能进入日志。Readiness 的 global KV-Ground evidence 还需要独立 `sciforge.kv-ground-smoke.v1` manifest，同时包含 `/health ok` 和 `/predict/` 返回的坐标；可用 `npm run smoke:kv-ground -- --endpoint <loopback-endpoint> --image <screenshot.png> --text "Click the target"` 写入默认 `docs/test-artifacts/kv-ground-smoke/kv-ground-smoke.json`。该工具必须 inline 上传图片、manifest 只保留 image hash/size/mime，不保留 base64，并脱敏 endpoint userinfo/query/hash。该 health/predict smoke 仍只是依赖可用性证明，不能替代每个任务自己的 grounding diagnostics、window-local coordinates、executor lease 或 task acceptance evidence。

TS Runtime Codex planner/executor 的 CU-LONG acceptance action schema 仍是 `open_app`、`click`、`double_click`、`drag`、`type_text`、`press_key`、`hotkey`、`scroll`、`wait` 的严格子集；package loop 兼容 `focus` / `save` 是 package-level capability，不代表 TS runtime validate-run 已接受这些 action。文档、planner prompt 和 trace validator 必须显式说明所在层级的 action set，避免把 package 扩展 action 当成 CU-LONG completion evidence。

若 scenario acceptance 明确写出最低 generic / non-wait action count，CU-LONG runner 会把该最小值投影为本轮 `acceptanceProgress` quota 给 planner，并在 scenario status 写出后重新运行 aggregate validation；动作数、非 wait 动作数或 required refs 不足时，即使各 round 曾返回 passed，也要把 scenario manifest / summary 改回 `repair-needed`。`acceptanceProgress` 必须携带已观察到的 scenario action / non-wait action 数、剩余数量、当前轮是否 action-eligible 和剩余 action-eligible 轮数；refs-only summary/report round 不再吸收 scenario action shortfall，但仍必须至少产生一个当前轮非 wait GUI action evidence，避免只凭旧 screenshot refs 或旧 action history 完成。

Runtime done gates 是累积约束：当前轮 quota 未达且仍有 step budget 时，planner 的 `done=true` 会被 `quota-unmet` 拒绝；当前轮无非 wait GUI evidence 时会被 `current-round-action-missing` 拒绝；artifact/report/summary/index/field-control/visual-evidence intent 缺当前可见 final artifact/report ref 时会被 `visible-artifact-missing` 拒绝。有 visible artifact 不免除当前轮 action evidence，满足 action quota 也不免除 final artifact/report ref。Action-ledger completion 也不能清空队列或结束 round，必须继续执行安全 low-risk action 或返回结构化 failure。低风险控件、inspection、视觉证据或 action quota 不能用 Export、Share、Save、Submit、Send、Delete、Pay、Authorize、Publish、Upload 等高风险或外部化控件凑数；planner 应优先选择 text/search/filter field、checkbox/radio/dropdown/menu/tab/toggle/scroll/focus/blank-content selection 等可见安全目标，若只剩高风险控件则返回结构化 failure。

KV-Ground 恢复后的历史 `CU-NEXT-07` repair run `/tmp/sciforge-cu-next-real/CU-LONG-004/cu-next-07-real-kv-recovered-20260528T0859Z` 已消除 action shortfall，但当时仍缺当前 round final artifact、`gui-present-record` evidence claim / verifier pass 和 canonical completed-L3 `completionEvidenceRef`，所以 `repair-needed`。后续真实 run `/tmp/sciforge-cu-next-real/CU-LONG-004/cu-next-07-real-final-artifact-gate-20260528T1028Z` 已通过 final artifact gate：round-04 产出 `report.md`，`gui.present` 引用该 artifact，acceptance manifest 为 `multi-app-workflow-passed`，并写出 same-round canonical `completionEvidenceRef=isolated-desktop-l3-workflow-evidence.json`；`validate-run --json` 返回 `status=ok`。若未来 run 再 repair-needed，必须精确区分是缺 `finalArtifactRef` / `visibleArtifactRefs` / `gui.present`，还是缺 same-round canonical L3 `completionEvidenceRef`，不能把二者混称。

当当前 round、expectedTrace 或 requirements 要求 final artifact、evidence summary、action mapping、字段/控件视觉证据总结或 refs-first report 时，planner 不能只凭截图/点击结束，必须先尝试通过安全 generic action 产出可见 typed/exported artifact；simulated remote-desktop session 会把 `总结`、`视觉证据`、`动作映射`、`字段证据`、`控件证据` 识别为 artifact intent，并 materialize bundle-local `report.md`，但该 artifact 仍必须经过 `gui.present`、live acceptance 和 completion-grade gates。

Runtime Codex direct-chat planner fallback 必须使用 OpenAI-compatible `/chat/completions`、显式 `Accept-Encoding: identity`、脱敏 diagnostics 和 bounded retry；如果 provider/proxy 错标压缩响应导致默认 fetch 解码失败，fallback 可以用同一 request body 重试 raw identity HTTP transport，但仍只返回 planner JSON，不能绕过 schema validation、风险确认、grounding、executor 或 evidence gate。Direct-chat fallback 只能修复 OpenAI-compatible transport/encoding；planner prompt、response schema、risk policy 和 evidence gate 必须复用同一套通用协议，不能为 CU-NEXT-07 或某个 provider 增加特例 prompt，避免 protocol drift。

`validate-run` 读取 `completionEvidenceRef` 时必须先确认 canonical ref 是当前 acceptance evidence bundle 内的 regular file，拒绝 symlink、realpath 逃逸、绝对路径、URL、reserved/pseudo refs；该文件本身和 nested refs/screenshotRefs/traceRefs 都必须落在同一 bundle。Repair-needed 输出不能只保留人类可读 issue 字符串；scenario summary、matrix summary、`cu-next-diagnostic-summary.json` 和 `validate-run --json` 必须保留机器可读 `repairDiagnostics`，至少覆盖 action shortfall、missing refs、失败轮 diagnostics refs、round trace metrics、failure reasons 和 next repair focus。

禁止用 Playwright DOM、accessibility tree、shell 直写文件、package fixture 或旧 trace 替代这些层级的验收。

---

## 11. Roadmap

### 阶段 0：当前 package contract

- EvidenceLedger standalone API 可以写 `evidence-log.jsonl`、`evidence-index.json`、`evidence-snapshot.json` 和 `planner-brief.json`。
- Visible viewer contract 支持 screenshot frame 和可解释 placeholder frame，拒绝 inline image/raw payload。
- `VirtualDesktopSession` / `SessionManager` skeleton 可以创建 refs-first session root、display group/screen/cursor refs、blocked manifest 和 scoped executor lease。
- `isolated_desktop_backend_probe` 可以写 Linux noVNC + LibreOffice/browser readiness/blocked manifest，但不启动真实 backend，不截图，不执行输入。
- `isolated_desktop_backend_bundle` 可以写 package-owned Linux/noVNC Docker bundle spec manifest，记录 Dockerfile ref、package-root build context、apt dependency 清单、localhost-only noVNC port policy、backend readiness run 命令、L1 smoke run 命令和 L3 workflow run 命令。仓库级 `smoke:cu-isolated-l1:docker` / `smoke:cu-isolated-l1:opt-in` / `smoke:cu-isolated-l3:docker` / `smoke:cu-isolated-l3:opt-in` 只提供真实 Linux/Docker evidence 的 opt-in gate，不进入默认 verify；`SCIFORGE_DOCKER_BASE_IMAGE` 只允许替换 Python base image 拉取来源，`SCIFORGE_DOCKER_DEBIAN_APT_MIRROR` / `SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR` / `SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES` 只允许替换 apt 下载来源和重试次数，`SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR` / `SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR` 只允许替换 Docker host evidence volume 的宿主机目录，不放宽 evidence gate。严格 Docker L1 gate 已用 ECR Python base image、清华 Debian apt mirror 和 `/tmp/sciforge-cu-isolated-l1` host evidence dir 产出首个真实 Linux/noVNC completed L1 run；严格 Docker L3 gate 已用同类镜像/mirror 产出真实 Linux/noVNC same-session completed L3 run，当前 canonical bundle-local 复验路径为 `/tmp/sciforge-cu-isolated-l3-localized-20260528b/l3`，`completionEvidenceRef=isolated-desktop-l3-workflow-evidence.json`。Dockerfile、build command、workflow 定义或 readiness manifest 仍不能单独替代 completed evidence refs。
- `isolated_desktop_l1_smoke_probe` 可以写 L1 smoke entrypoint manifest，记录 readiness、isolated input/screenshot runtime components 和 completed evidence contract；只有 Linux + deps ready + `--execute` 时才尝试启动 Xvfb/window manager/VNC/noVNC/browser，并把 xdotool/import 绑定 isolated `DISPLAY`。Runner 会先清理 output dir 下自己生成的上一轮 `isolated-l1-session` / viewer 状态，避免复用 evidence dir 时 Chromium profile lock、旧截图或旧日志污染本轮结果，再分配本轮可用 X display、VNC/noVNC localhost 端口并写通用 `isolated-runtime-resource-allocation.json`；也支持 `--display`、`--vnc-port`、`--novnc-port`、`--timeout-seconds` 和 `--resource-lock-root` 记录真实 Linux/CI 调试请求值。Runner 用独立进程组隔离 backend 子进程，为每个长生命周期进程写 stdout/stderr log refs，检测进程早退，用 `xdotool getdisplaygeometry` bounded polling 证明 isolated X display 可查询，再等待 VNC TCP 与 noVNC localhost `/vnc.html` HTTP viewer ready，写 `backend-readiness-proof.json`、`backend-processes.json` 和 `isolated-runtime-resource-allocation.json`；HTTP viewer proof 只保存 status、bytesRead、sha256 与 HTML/noVNC marker，不保存 raw HTML。Chromium-family 启动会抑制首启/后台 UI，并在 root/container 环境自动使用 `--no-sandbox` 与 `--test-type`，避免 root/no-sandbox 横幅改变 smoke page 坐标。Browser 启动后必须通过页面设置的 ready title marker 被 isolated `xdotool search --onlyvisible --name` 找到，并记录 `getwindowgeometry --shell` 的 visible window geometry；找不到窗口或 page marker 就在输入前 fail closed。Pointer click 必须用 `xdotool mousemove --window <windowId>` 发送到 window-local coordinate space，并写通用 `targetWindowRef` / `windowBoundPointerProofRef` 证明 hit point 位于目标 bounds 内且绑定对应 executor command event；button target 使用真实按钮区域的 window-local bounds/hit point，裸全局坐标或 page-only 坐标点击不能作为 L1 证据。对每个 isolated input 命令写 `l1-executor-command-events.json`，让 pointer/keyboard input logs 引用具体 executor command event。L1 completed evidence 要求 `processRef` 的 backend-processes payload 和 `resourceAllocationRef` 的 isolated-runtime-resource-allocation payload 语义有效；清理后把 session/noVNC/capture/replay refs 标成 `closedAfterRun=true`；validator 要求每个 state-changing step 的 before/after 截图内容变化，任何资源分配、启动、输入、截图、viewer、ledger 或 validator 条件不满足都会保持 blocked。L1 probe 的纯 helper 已拆到 `isolated_desktop_l1_smoke_probe_helpers.py`，主 entrypoint 继续保留 CLI/manifest/run orchestration，不改变 evidence contract。
- `isolated_desktop_l1_smoke_evidence` 定义真实 L1 completed evidence 的强 validator；它防止 readiness 或 package diagnostic 假通过，并已用于复验首个真实 Docker/Linux/noVNC completed L1 evidence。
- `isolated_desktop_l3_workflow_probe` 写真实 L3 workflow readiness/execute manifest，检查 backend、isolated input、screenshot 和 file-preview readiness；`--execute` 且依赖 ready 时会启动同一 isolated session，清理 run-owned session/profile/viewer 状态，记录 `isolated-desktop-l3-runner-execution-boundary.json`，并按 source browser -> LibreOffice Writer -> Chromium directory preview 执行 GUI workflow。Runner 使用同一 X display/session、client-area window-bound pointer coords、`xdotool mousemove --window <windowId>` proof、keyboard command provenance、LibreOffice GUI Save As、键盘选择 DOCX 类型、当前 screenshot refs、DOCX validator、file-list/gui.present、visible viewer 和 evidence ledger；只有 completed evidence assembler + validator 接受 existing refs 后 manifest 才能为 `status=completed` / `diagnosticOnly=false` / `userAcceptanceEligible=true`。失败路径仍写 blocked manifest；partial refs 只能保留在 partial 命名空间，不能提升为 completed refs。
- `isolated_desktop_l3_workflow_plan` 定义 L3 runner 的 diagnostic-only action plan schema：source -> writer -> save -> preview -> validate，每步有 monotonic `actionIndex`、app role、expected modality 和 screenshot/observation required refs。它不执行 GUI、不读取 shell artifact、不写 completed evidence，只用于让 runner 在输入前拥有可审计动作索引和 refs 要求。
- `isolated_desktop_l3_workflow_result` 提供 fail-closed completed evidence assembler：先用 completed L3 validator 和 existing refs 校验候选 payload，只有通过才写 canonical `isolated-desktop-l3-workflow-evidence.json` / `completionEvidenceRef`；写出前会把同一 output bundle 内 JSON/JSONL refs 规范化为 bundle-local refs。shape-only、无效 payload 或 partial namespace refs 只会生成 blocked assembly manifest。
- `source_fact_evidence` 提供 refs-first source observation -> supported fact -> derived content helper，payload 声明兼容 L3 `source-fact.v1`，但自身保持 diagnostic-only，拒绝 completion/user-acceptance、shell refs 和 raw payload refs。
- `l3_artifact_bundle_evidence` 提供 refs-first artifact/file-list/gui.present bundle helper，校验 top-level refs 与 artifact causality、directory evidence、presentation evidence 一致，但不读取文件、不执行 GUI/shell、不写 completed evidence。
- `isolated_desktop_l3_workflow_evidence` 定义真实 L3 isolated multi-app completed evidence 的 contract / validator；completed evidence 必须读取 target window/window-bound pointer proof refs，拒绝裸全局 pointer command 或未绑定 target refs 的 pointer event。它已用于复验严格 Docker L3 completed run，并继续防止 package fixture、旧 trace、readiness-only probe 或 target-bound diagnostic 被提升成用户级 L3。
- `tools/computer-use-next/live-acceptance-validator.ts` 定义 CU-NEXT-01..07 的任务级语义 marker gate，并已接入 `smoke:real-task-matrix`、CU-NEXT readiness 和 `tools/cu-next-run.ts validate-run`；`tools/computer-use-next/acceptance-projection.ts` 从真实 run refs 通用投影 task marker，`tools/cu-l3-independent-input-acceptance-harness.ts` 负责写入 acceptance input/manifest，并通过显式 high-risk stop 支持 `CU-NEXT-03 status=needs-confirmation`。审批、repair continuity 和 directory listing marker 必须绑定 dedicated sidecar refs，不得由 trace/request/verifier refs 兜底。`tools/computer-use-next/completion-grade.ts` 被 readiness 和 validate-run 共用，拒绝 acceptance-shaped target-bound/package-local evidence；只有当前 round bundle-local、validator-accepted、带齐 completed-L3 refs 的 canonical same-round `isolated-desktop-l3-workflow-evidence.json` 可成为 strong evidence。这些工具只验证或组织真实 run 产出的 refs 是否可作为下一轮实测证据，不执行 GUI、不把 target-bound/fixture/旧 `/tmp` 证据提升为完成。
- `src/runtime/computer-use/package-bridge.ts` 写 package-backed run 的 `tui-host-run-task-chain.json` 和 refs-first sidecars：`directory-listing.json`、按需 `approval-request.json` / `risk-audit.json` / `confirmed-request.json` / `blocked-manifest.json` / `repair-hint.json` / `continuation-request.json`。这些文件让 TUI Host -> `run_task(request, hostPorts)` -> `gui.present` / `gui.ask_user` intent metadata、approval retry、blocked repair continuity 和 evidence bundle listing 有稳定 refs-first 清单；它们是链路/索引证据，不是 L1/L2/L3 成功证据。
- runtime window-target 加固会把 generic app labels 先归一到 app identity，再 activation/probing；浏览器类目标应映射到稳定 bundle id 并优先用 bundle id 激活，避免 CU-NEXT-07 这类 `Browser` 目标卡在模糊 WindowTarget。WindowTarget diagnostics 应区分 label resolution、bundle id activation、window probing 和 Swift JIT failure cleanup，便于判断是身份解析失败还是后续窗口定位失败。
- target-bound visible diagnostics 覆盖高风险 confirmation demo 和 source-reader -> writer -> file-preview 的跨应用形状；这些仍是 package-owned contract evidence。
- target-bound host 继续作为 deterministic test harness。

除严格 Docker `--execute` 已产出的 completed L1/L3 evidence 外，本阶段的 package-owned probes、helpers、bridge、projection 和 target-bound diagnostics 都只是 contract/diagnostic 层；即使具备完成形状，也不能替代 CU-NEXT task-specific completion。

### 阶段 1：隔离虚拟桌面

- 首个 backend 使用 Linux desktop + noVNC + LibreOffice/browser。
- capture、execute、verify 全部绑定到 virtual display/input queue。
- 确认用户真实鼠标键盘不受影响。

### 阶段 2：主动视觉探索

- Planner 支持 explore / act / complete / blocked。
- 接入 crop、OCR、VLM describe、VLM compare、table/image inspection。
- 用 uncertainty 驱动补观察。
- 用 evidence ledger freshness 规则阻止过期证据完成任务。

### 阶段 3：真实办公软件

- 在 isolated session 中测试 PPT、Word、Excel 或 LibreOffice。
- 做多页 PPT、DOCX 文档、表格编辑和预览确认。
- 用 artifact validator 和 viewer 证明全过程。

### 阶段 4：复杂长任务

- Task Contract / milestone
- 多候选 action
- simulation / tournament
- recovery manager
- checkpoint
- grounding ensemble
- 长任务 visual memory

---

## 12. 刻意不做

MVP 暂时不做：

- 图数据库：先用 JSONL + rebuildable index 表达逻辑图。
- 读 DOM/accessibility tree：保持纯视觉通用性。
- 控制用户真实鼠标键盘：默认只用虚拟 session input。
- 把多 actor cursor 直接等同于多个 OS 级真实鼠标：MVP 先做协作光标、意图队列和 executor 调度，真实 multi-pointer backend 只作为可替换 adapter。
- app-specific private API：避免把算法写成特例。
- VLM 直接执行动作：执行必须经过 grounder/executor/verification。
- VLM 单独宣布完成：completion 必须由 evidence guard 放行。
- GUI 内部执行 Computer Use：GUI 只展示和收集确认，策略由 action provider 拥有。
- 高风险动作自动执行：必须 fail closed 或等待用户确认。

---

## 13. 最终判断

推荐架构是：

```text
one task / collaboration space
-> one virtual display group
-> one or more virtual screens
-> many actor cursors for presence / intent
-> scoped executor adapters for mutating input
-> one replay/evidence bundle
```

推荐算法是：

```text
active visual exploration
-> evidence ledger
-> generic GUI action
-> verification
-> refreshed evidence
-> guarded completion
```

这能同时满足四个目标：用户能看到、用户不被打扰、多成员可以在同一屏幕协作、算法不会被写死在某个软件或某个 demo 场景里。

### 未来发展方向：容器化运行环境 + sandbox policy + isolated desktop

后续长期形态建议采用：

```text
Host / Orchestrator
-> task-scoped sandbox policy
-> ephemeral container runtime
-> isolated virtual display group
-> virtual screens + actor cursors + scoped executor input
-> evidence capture
```

其中容器负责提供可复现、可销毁、可并发的运行环境；sandbox policy 应由宿主机或编排器在启动容器时施加，而不是依赖容器内部进程自我约束。策略至少应覆盖挂载白名单、网络开关或 allowlist、secret 注入、resource limits、Linux capabilities、seccomp / AppArmor / SELinux profile，以及 evidence/artifact 输出目录。

isolated desktop/display group 仍是 Computer Use 的默认执行目标：任务在虚拟 screen、actor cursor、executor adapter 和独立应用会话中运行，不直接控制用户真实桌面。容器负责可复现和可销毁，screen/cursor/executor contract 负责协作和输入隔离；任务结束后销毁容器并保留 replay/evidence bundle。高风险或不可信二进制任务可升级到 VM / microVM，但常规 Computer Use 不应默认操作宿主机桌面。
