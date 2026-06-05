# Computer Use 插件算法设计

版本：v0.9-principles
日期：2026-06-04

## 文档边界

本文只描述 `packages/actions/computer-use` 插件本身的算法原则和需求边界。它不描述 Annotation、Image / Evidence Pane、WindowActionSession、Desktop shell 或具体 UI。

Computer Use 插件是 Agent Host 的 GUI I/O augmentation layer：增强 Host 对 GUI 的观察输入和操作输出。它接收 Host 给定的局部 GUI 目标 / generic intent、当前 evidence 和 host ports，输出可审计的局部 GUI 行动、局部目标达成信号、blocked signal 或 approval request。外层 Agent Host 负责理解用户意图、选择产品会话、管理窗口、跨模块规划、approval 决策、repair 和用户级任务完成判断。

因此，Computer Use 不重新解释完整用户任务，不选择 Browser/file/verifier/connector 等跨模块下一步，也不把局部完成信号升级成用户级 completion。

## 核心原则

### 1. 可见状态关键，但证据获取 cheap-first

可见像素、当前截图、crop、OCR、Model Router vision translator observations、屏幕变化和 before/after 对比，是判断 GUI 当前可见状态、遮挡、布局、点击命中、人类可见结果和视觉内容的重要证据，因为这些信号最通用，能跨 Browser、Office、文件管理器、Jupyter、仪器 GUI 和自研应用复用。

但这不表示每一步都先调视觉模型。Computer Use 应先使用已有 fresh observation、window/app metadata、session/target refs 和结构化精确信号；当目标不唯一、画面过期、结构化信号与可见像素冲突、或动作风险/验证要求升高时，再升级到 crop、OCR、Model Router vision translator 或 verifier explanation。

只要 Host 提供 refs-first、可审计、当前有效的证据，Computer Use 可以使用：

- window / app metadata
- accessibility tree 或 UI Automation hints
- DOM / browser runtime hints
- terminal / PTY transcript
- file / artifact evidence
- validator result
- adapter readiness
- prior action timeline

这些信号必须进入统一 evidence ledger。它们可以帮助定位、验证和补全视觉理解，但不能绕过 action loop、before/after evidence 和 Host completion guard。prior action timeline 只解释因果链，不能单独证明当前完成。

证据组合不是固定链路，而是按用途选择：

- 文本、label、value、role、selected/disabled 状态优先使用 DOM/AX/UIA/PTY/file 等结构化精确证据。
- 可见存在、遮挡、焦点、布局、点击可达性和人类可见结果优先使用 fresh screenshot / target crop。
- 可执行坐标和 binding 必须来自 Host adapter / grounder；模型输出只能作为候选描述或消歧 evidence。
- 保存、导出和产物内容必须由 artifact refs、hash/metadata 和 validator 支持。
- 证据冲突时遵循 freshness > confidence，并重新 observe、裁剪检查或 blocked。

### 2. Planner 不直接控制坐标

Computer Use 内部的 planner 只是局部 next-action selector：基于当前 observation snapshot 和 Host 给定的局部目标，决定下一步通用 GUI 意图，不手写裸坐标。坐标、命中目标和可执行 binding 属于 grounder / Host adapter。

Planner 应输出类似：

- 再观察一下。
- 检查这个区域。
- 区分几个相似按钮。
- 点击保存按钮。
- 在当前输入框输入文本。
- 等待界面稳定。
- 证据不足，返回 blocked。

这样算法不会把偶然像素当稳定接口，也便于替换不同 Host adapter。

### 3. Vision Translator 是感知工具，不是执行者

Model Router vision translator 可以描述截图、比较变化、解释图表/表格/公式、识别视觉对象和说明不确定性。

Vision translator 不直接执行动作，不输出最终执行坐标，不单独宣布完成，不用旧截图或记忆替代当前证据。视觉结论必须写成 evidence record，并接受 freshness、confidence 和 completion guard 约束。

Computer Use 的所有模型参与点统一使用 Model Router `/v1/responses` capability surface，并通过 workspace/profile role 选择 `textReasoner` 或 `translators.vision`。这包括局部 next-action selector、screenshot/crop 描述、before/after 比较、复杂视觉解释、候选目标消歧、需要模型参与的 grounding translator 和 verifier explanation。插件不得接触 provider URL、API key、raw model slug 或未注册 provider/model/profile。旧的 KV-Ground 或其它 grounding 服务名只能作为显式 opt-in 兼容 provider 壳或调用路径，不代表默认模型；进入 evidence 的具体 provider/model 只能作为 router 决议结果或 legacy adapter metadata。

### 4. 改变界面的动作必须可追溯

只读探索和改变状态的动作必须分开。

只读探索包括：

- recapture
- wait until stable
- crop
- OCR
- Model Router vision describe / compare
- region / table / image inspection

会改变可见状态的操作必须进入 action loop：

- click / double click
- drag
- type text
- press key / hotkey
- scroll
- focus
- open menu / dropdown
- switch tab / window / panel
- save

每个 action 都要有 before evidence、grounding evidence、executor event、after evidence 和 verification。失败动作也要记录，因为底层输入可能已经部分改变界面。

### 5. Evidence 是唯一算法记忆

Computer Use 不靠临时 prompt 记忆判断当前状态。所有关键事实都写入 refs-first evidence ledger：

- 当前观察到了什么。
- 目标候选是什么。
- 哪些证据支持或反驳某个动作。
- 哪些动作让旧证据 stale。
- 哪些 artifact 或 validator 支持完成。
- 哪些 uncertainty 阻止完成。

大对象永远只写 refs。禁止把 raw screenshot、base64、provider raw payload、secret、Authorization、token、password、raw clipboard/IME text 写入主 payload、trace 或长期 evidence。

### 6. Freshness 优先于模型自信

任何改变界面的动作都可能让旧截图、旧 OCR、旧对象位置和旧 grounding 失效。保存、导航、切窗口、滚动、输入、点击之后，completion guard 必须重新检查当前证据。

旧 action history 可以解释“曾经做过什么”，但不能证明“现在已经完成”。完成判断必须依赖当前 evidence、artifact evidence、validator result 和 action causality。

### 7. 完成判断必须 fail closed

完成不是一句 LLM 断言。若证据不足，Computer Use 应继续探索或返回 blocked。

Computer Use 只产出局部目标达成信号或 candidate completion refs；用户级 completion 仍由 Agent Host 判定。局部达成至少需要：

- 当前 observation 或 artifact evidence。
- 结果来自本轮 action 的因果链。
- verifier 或 validator 支持。
- 没有 blocking uncertainty。
- 文件产物任务要有文件 refs、hash/metadata 和格式 validator。

### 8. 效率与证据预算

可靠完成、安全和证据可信度是硬约束，效率是约束内优化。Computer Use 应减少不必要 GUI 操作、全屏观察、视觉模型调用和重复验证。

建议证据成本分层：

```text
T0 session/window/action metadata
T1 DOM/AX/UIA/PTY/file structured state
T2 target crop / OCR
T3 fresh window screenshot
T4 Model Router vision translator
T5 before/after vision compare or verifier explanation
```

默认使用 target-bound 的最小足够证据：已有 windowRef/targetRef 时优先 window-local capture 或 crop；只有 target 丢失、遮挡、多窗口冲突、用户选择 screen region 或 verifier 需要时才升级到全屏或更重模型。

同一 target、同一 lease、同一低风险局部目标内，可以批量执行短序列动作，例如连续输入字段、Tab 导航、轻量滚动或普通导航；每个 mutating action 仍必须写 action ledger。导航、提交、保存/导出、上传/删除、窗口切换、modal、target moved、focus takeover、高风险动作和 verifier failure 后必须 checkpoint，并 stale 相关 screenshot、OCR、object location、grounding、role/state 和 completion candidate。

## 标准循环

```text
observe/enrich current target-bound state
-> write evidence ledger
-> build observation snapshot
-> build compact local controller brief
-> select generic next-action intent or blocked
-> ground target through Host adapter
-> execute action through Host adapter
-> verify after state with tiered evidence
-> update evidence freshness
-> local-goal-reached or continue or blocked
```

这个循环可以多轮运行。算法应该先补足证据，再行动；行动后再补证据，而不是每次观察后立刻点击。

## Host 边界

Computer Use 通过窄 Host ports 接触外部环境：

- capture：获取当前观察证据。
- crop：补充局部证据。
- plan：基于 Host 给定局部目标和 observation snapshot 生成通用下一步意图。
- locate：把目标描述绑定到可执行目标。
- execute：执行通用 GUI 动作。
- verify：验证动作后的状态。
- writeTrace / emitEvent：写 refs-first trace 和事件。

Host adapter 可以是 browser session、window-session host、terminal、app-native command、Accessibility/UIA/AT-SPI、focused system input 或未来 isolated backend。Computer Use 不关心具体执行机制，只要求 Host 返回可审计 refs、side-effect flags 和 before/after evidence。

## 动作空间

Computer Use 的核心动作保持通用：

- observe
- wait
- click
- double click
- drag
- type_text
- press_key
- hotkey
- scroll
- focus
- save

PPTX、DOCX、CSV、PDF、图片等格式能力不进入鼠标键盘算法。它们作为 artifact renderer、validator 或 previewer 提供证据。比如“做 PPT”仍然是通用 GUI 动作 + 保存动作 + PPTX validator + evidence refs。

## 不确定性

Uncertainty 是一等证据。常见阻塞包括：

- 找不到目标。
- 同名目标太多。
- OCR 或视觉 verifier 置信度低。
- 证据已过期。
- 目标被遮挡或离屏。
- action 执行失败。
- artifact 或 validator 证据缺失。

blocking uncertainty 必须阻止 completion。只有新观察、新 crop、新 OCR/vision translator observation、Host adapter evidence、文件证据或验证结果解决它后，completion guard 才能放行。

## 验收边界

Package-local 验收只证明插件算法和 contract：

- host-port 调用闭环。
- evidence ledger 和 planner brief。
- freshness / stale invalidation。
- sanitizer 和 refs-first policy。
- generic action loop。
- artifact validator 接入。
- fail-closed diagnostics。

真实 GUI、真实窗口、真实 Browser、Desktop native bridge 或未来 isolated backend 的验收属于上层 Host 项目。Computer Use 只要求真实 Host 提供当前 observation、target/session refs、executor event、before/after evidence、verification/artifact refs 和 side-effect flags。

## 最终判断

Computer Use 插件的核心是：

```text
refs-first evidence
-> cheap-first, multi-signal input enhancement
-> local generic intent selection
-> grounded action through Host adapter
-> after-action verification
-> stale evidence invalidation
-> fail-closed local result / blocked handoff
```

Agent 读完本文应理解：实现时不要把产品 UI、窗口生命周期、跨模块规划、provider route 或用户级 completion 写进插件；要围绕证据、通用动作、Host adapter、验证、stale 规则和 fail-closed handoff 来写代码。
