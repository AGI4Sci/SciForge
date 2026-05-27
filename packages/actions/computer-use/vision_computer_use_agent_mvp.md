# 视觉 Computer Use Agent 设计文档

版本：v0.3-active-visual-session
日期：2026-05-27

---

## 1. 核心目标

Computer Use agent 的目标不是抢占用户当前桌面，而是在每个任务线程里创建一个独立、可观察、可回放的虚拟桌面。agent 使用自己的虚拟鼠标和虚拟键盘完成真实 GUI 工作；用户继续使用自己的真实屏幕、鼠标和键盘，两者互不干扰。

目标架构：

```text
Thread A -> virtual display A -> virtual mouse A -> virtual keyboard A
Thread B -> virtual display B -> virtual mouse B -> virtual keyboard B
User     -> real display/user desktop -> real mouse -> real keyboard
```

这个方向有三个收益：

- **可见**：用户能看到每个 agent 线程的虚拟屏幕、鼠标移动、键盘输入、动作时间线和最终产物。
- **隔离**：agent 不移动用户真实鼠标，不向用户当前桌面发送全局键盘事件。
- **通用**：算法面向任意 GUI 软件，不把 PowerPoint、Word、浏览器或某个页面写成特例。

当前 `package-owned target-bound host` 继续保留，但它只是 deterministic test harness。它可以验证 action loop、输入隔离、trace、artifact validator、viewer 和 evidence contract；它不能替代真实虚拟桌面、真实应用或用户级验收。

---

## 2. 设计原则

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

如果缺证据，应继续探索或返回 blocked，不能用旧截图、旧 trace summary 或“我刚才点过保存”直接宣布成功。

---

## 3. 每线程虚拟桌面架构

每个任务线程拥有一个 `VirtualDesktopSession`。这个 session 包含虚拟屏幕、虚拟输入队列、文件系统工作区、capture stream、replay bundle 和输入 lease。

推荐分层：

- **SessionManager**：创建、租用、暂停、关闭每个虚拟桌面 session。
- **Capture Adapter**：从虚拟屏幕获取整屏截图、窗口截图、局部 crop 和录屏帧。
- **Input Adapter**：向该 session 的虚拟鼠标/键盘发送动作，不触碰用户真实输入设备。
- **Artifact Observer**：观察 run bundle、保存目录、文件列表和最终产物。
- **Replay Viewer**：展示虚拟屏幕帧、鼠标轨迹、点击、键盘输入、动作时间线和证据 refs。
- **Computer Use Action Provider**：运行 observe/explore/act/verify/completion 算法，不直接依赖 GUI renderer。

优先 backend：

- 第一阶段：Linux desktop + noVNC + LibreOffice/browser，先得到可隔离、可观看、可自动化验证的真实 GUI 环境。
- 后续阶段：Windows/RDP 或 macOS/VNC，用于真实 Microsoft Office、Keynote、Pages 等软件。
- 测试阶段：package-owned target-bound host，继续作为 deterministic harness。

关键约束：

- 每个 session 有自己的 input lease。agent 输入和用户 takeover 不能同时写同一个虚拟输入队列。
- 所有输入事件必须记录到 run bundle，包括 pointer、keyboard、scroll、focus 和保存动作。
- isolation flags 必须明确记录：`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。
- viewer 里的可见性必须来自真实或可解释的 frame refs，不应只生成空白 PNG。

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

也就是说，agent 不必每次观察后立刻行动。它可以先补充证据：重新截图、等待稳定、crop 局部、OCR、请求 VLM 描述图像、比较 before/after、检测 UI 区域、阅读视觉表格，直到信息足够成熟再行动。但如果下一步需要 scroll、hover、打开菜单、切换面板、缩放视图或改变 focus，它已经不是 evidence loop 的探索，而是一次正式 action。

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
- completion 缺口

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

---

## 6. Uncertainty 是一等公民

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

## 7. 通用动作与应用能力

核心动作空间保持通用：

- click / double click
- focus
- type text
- press key
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

## 8. 安全与用户确认

高风险动作默认 fail closed，例如：

- 发送消息或邮件
- 删除文件或账户数据
- 支付或购买
- 发布内容
- 上传外部文件
- 修改权限、账户、安全设置
- 对外提交表单

遇到高风险动作时，Computer Use action provider 不直接弹 UI，也不执行动作。它返回 `needs-confirmation` 和 refs-first approval request。TUI Host 或 GUI 再决定如何向用户展示确认。

确认记录也必须进入 evidence ledger，包含用户确认来源、确认范围、相关截图/动作 refs 和最终执行结果。

---

## 9. 验收分层

### 9.1 Package-local 层

验证 package contract：

- CLI/API/stdio contract
- target-bound deterministic host
- virtual input state refs
- visible replay viewer
- artifact renderer/validator
- evidence ledger schema
- isolation flags

这一层证明包的协议和算法骨架，不证明真实 GUI 成功。

### 9.2 L1 isolated desktop smoke

在 disposable virtual desktop 中完成最小真实 GUI 操作：

- 点击输入框
- 输入文字
- 点击按钮
- 验证屏幕变化
- 记录 virtual pointer/keyboard logs
- 生成 live/replay frames

### 9.3 L2 single-app artifact

在 isolated desktop 中使用真实应用或可离线 GUI 应用生成 artifact：

- LibreOffice Impress/Writer 或真实 Office
- 保存 PPTX/DOCX/CSV 等文件
- 获取最终可见截图、文件证据、validator 结果和 replay viewer

### 9.4 L3 multi-app workflow

在同一个 virtual session 中跨应用完成任务：

- 浏览器读取资料
- 文档或演示软件写报告/做 PPT
- 文件管理器确认保存
- viewer 展示全过程
- evidence ledger 支撑最终完成

禁止用 Playwright DOM、accessibility tree、shell 直写文件、package fixture 或旧 trace 替代这些层级的验收。

---

## 10. Roadmap

### 阶段 0：当前 package work

- 让 visible viewer 不再出现不可解释的空白帧。
- 展示虚拟鼠标、点击、键盘输入、滚动、保存动作和 action timeline。
- 补 evidence ledger JSONL、index、snapshot 和 planner brief。
- 保持 target-bound host 作为 deterministic test harness。

### 阶段 1：隔离虚拟桌面

- 引入 `VirtualDesktopSession` 和 `SessionManager`。
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

## 11. 刻意不做

MVP 暂时不做：

- 图数据库：先用 JSONL + rebuildable index 表达逻辑图。
- 读 DOM/accessibility tree：保持纯视觉通用性。
- 控制用户真实鼠标键盘：默认只用虚拟 session input。
- app-specific private API：避免把算法写成特例。
- VLM 直接执行动作：执行必须经过 grounder/executor/verification。
- VLM 单独宣布完成：completion 必须由 evidence guard 放行。
- GUI 内部执行 Computer Use：GUI 只展示和收集确认，策略由 action provider 拥有。
- 高风险动作自动执行：必须 fail closed 或等待用户确认。

---

## 12. 最终判断

推荐架构是：

```text
one user-visible thread
-> one isolated virtual desktop
-> one virtual mouse
-> one virtual keyboard
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

这能同时满足三个目标：用户能看到、用户不被打扰、算法不会被写死在某个软件或某个 demo 场景里。
