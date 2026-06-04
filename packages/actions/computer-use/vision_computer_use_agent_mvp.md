# Computer Use 插件算法设计文档

版本：v0.8-plugin-algorithm
日期：2026-06-04

---

## 1. 文档边界

本文只描述 `packages/actions/computer-use` 插件本身的算法和 contract。它不是外层标注、证据展示、窗口会话或 Desktop shell 的产品设计文档。

Computer Use 插件的职责是：

- 消费 Host 提供的 observation、target、adapter、input 和 artifact refs。
- 运行通用 GUI action loop：observe、inspect、plan、ground、execute、verify、complete/blocked。
- 维护 refs-first evidence ledger、trace、planner brief 和 replay material。
- 输出 domain-local verdict、action evidence、uncertainty 和 repair hints。

Computer Use 插件不负责：

- 创建 annotation。
- 判断用户消息意图或启动外层产品会话。
- 管理外层产品会话生命周期。
- 渲染 GUI 或证据展示 pane。
- 直接调用 `gui.present` / `gui.ask_user`。
- 判定用户级任务完成。

上层 Agent Host 可以把 annotation refs、target refs、actor refs 或 input adapter refs 作为请求上下文传入；Computer Use 只把它们当作可审计输入和输出引用。

---

## 2. 核心目标

Computer Use 算法要在未知 GUI 环境中执行通用动作，同时保持可审计和可回放。

核心输入：

```text
ComputerUseRequest
  task
  maxSteps
  workspace/session/thread refs
  target refs?
  observation refs?
  scopedInputAdapter refs?
  artifact requirements?
  metadata

HostPorts
  capture
  crop?
  plan
  locate
  execute
  verify
  writeTrace?
  emitEvent?
```

核心输出：

```text
ComputerUseResult
  status: completed | blocked | max-steps
  steps
  traceRef
  evidenceLedgerRef
  plannerBriefRef
  artifactRefs
  completionEvidenceRef?
  repairHintRef?
  failureDiagnostics
```

算法设计目标：

- **通用**：动作空间面向普通 GUI，不把 Browser、PPT、Word、Jupyter 或某个页面写成特例。
- **视觉优先**：以截图、crop、OCR、VLM、screen diff、file/artifact evidence 为主要依据。
- **refs-first**：大对象只用 refs；禁止 raw screenshot、base64、provider raw payload、secret。
- **fail closed**：证据不足时继续探索或 blocked，不用旧截图、旧 trace 或模型自信宣布完成。
- **adapter-first**：底层执行由 Host adapter 完成；插件只发 generic action intent 和验证要求。

---

## 3. 算法分层

```text
Task Loop
  -> Evidence Loop
  -> Action Loop
  -> Verification Loop
  -> Completion Guard
```

### Evidence Loop

只读地补充证据：

- recapture
- wait until stable
- crop
- OCR
- VLM describe
- VLM compare
- region detection
- visual table/image inspection

这些操作不能改变 visible state。它们只写 evidence ledger，不占用 mutating input lease。

### Action Loop

任何会改变 GUI 状态的操作都进入 Action Loop：

- click / double click
- drag
- type_text
- press_key / hotkey
- scroll
- focus
- save
- open menu/dropdown
- switch tab/window/panel
- zoom
- page down / page up

Action Loop 必须产生 before evidence、grounding evidence、executor event、after evidence 和 verification。

### Verification Loop

动作后验证：

- screen 是否变化。
- focus/target 是否变化。
- 文本、按钮、菜单、文件或 artifact 是否出现。
- 上一步 grounding 是否被证实或反驳。
- 是否产生新的 uncertainty。
- 是否满足 artifact validator 或 completion guard。

### Completion Guard

完成判断必须基于 evidence query，而不是 planner 的一句结论。

完成至少需要：

- 当前 observation 或 artifact evidence。
- action causality。
- verifier 或 validator evidence。
- 没有 blocking uncertainty。
- 产物型任务要有 file/artifact refs 和格式 validator。

---

## 4. Planner 边界

Planner 不直接输出屏幕坐标。坐标属于 `locate` / grounder / executor adapter 的职责。

Planner 输出通用意图：

- 再观察或等待界面稳定。
- 检查某个区域。
- 识别几个相似候选的区别。
- 点击可见目标。
- 在当前输入框输入文本。
- 使用标准快捷键保存。
- 返回 blocked 并说明缺什么证据。
- 返回 completed 并列出支持证据 refs。

Planner 输入不应是完整 evidence log，而是 `planner-brief.json`：

```text
latestObservation
currentText
currentObjects
candidateTargets
blockingUncertainty
recentActions
artifactEvidence
visibleArtifactRefs
completionGaps
```

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

prior memory 和 action history 可以帮助解释，但不能单独支撑 completion。

---

## 5. Grounding 和 locate

`locate` 负责把 planner 的目标描述绑定到可执行目标。

Grounding 输出：

```text
groundingRef
targetDescription
coordinateSpace
targetBounds?
targetPoint?
candidateRefs
confidence
ambiguity
diagnostics
```

规则：

- 多候选或低置信时优先进入 Evidence Loop，补 crop/OCR/VLM，而不是冒险点击。
- planner 不得手写裸全局坐标。
- `locate` 可以使用 screenshot、OCR、VLM、window metadata、AX/DOM hint 或 adapter-specific hint，但输出必须转成 refs-first grounding record。
- Generic app label 必须解析成稳定 app/window identity；解析失败要写 diagnostics 并 fail closed。
- Grounding 成功后、execute 前可以调用可选 `crop` 获取 focus evidence。

可选 focus crop 是 evidence enrichment，不是 action。crop 失败不阻塞原动作；失败写 `optional-evidence` uncertainty。

---

## 6. VLM 边界

VLM 是感知工具，不是执行者。

VLM 可以：

- 描述截图或 crop。
- 比较 before/after。
- 解释图表、表格、公式、图片。
- 帮助识别视觉对象。
- 给 uncertainty 提供解释。

VLM 不可以：

- 直接执行动作。
- 绕过 grounder 输出最终执行坐标。
- 单独宣布任务完成。
- 用旧截图或 prior memory 替代当前证据。
- 写入 raw provider payload、inline image、base64、secret 或 Authorization 信息。

VLM 输出必须成为 `vlm-claim` evidence record，并接受 freshness、confidence 和 completion guard 约束。

---

## 7. Evidence Ledger

MVP 使用 append-only structured evidence，而不是图数据库。

推荐存储：

```text
.sciforge/vision-runs/<run-id>/
  evidence-log.jsonl
  evidence-snapshot.json
  evidence-index.json
  planner-brief.json
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

每条 record 的最小结构：

```text
schemaVersion = sciforge.computer-use.evidence-record.v1
id
sequence
runId
type
loopPhase
actionIndex?
ref / refs
summary
confidence
tags
current
derivedFrom
supports
contradicts
usedForAction
verifiedBy
invalidates
metadata
```

核心 evidence 类型：

- `observation`
- `region`
- `text`
- `visual-object`
- `vlm-claim`
- `grounding`
- `action`
- `verification`
- `artifact`
- `uncertainty`
- `completion-claim`

所有 ledger 写入都必须先脱敏。禁止写入：

- raw screenshot/base64/data URL
- provider raw payload
- Authorization/header/body/token/secret/password/credential
- raw clipboard/IME/user text
- unbounded window list
- unrelated full-screen sensitive content

---

## 8. Freshness 和 stale evidence

每个会改变界面的动作都会让旧 visible evidence 变 stale：

- click、type、press key、scroll、drag 后，旧截图、旧 OCR、旧对象位置默认 stale。
- crop、OCR、VLM describe 不改变屏幕，不会让旧观察 stale。
- wait 后如果 screen diff 很小，可以延长 observation freshness。
- 切窗口、导航、切 tab、打开新应用后，旧 window subtree stale。
- 保存文件后，旧目录 listing stale，必须重新 observe artifact/file evidence。

当前 visible state record 类型：

```text
observation
region
text
visual-object
vlm-claim
grounding
```

state-changing action record 必须把当时 current 的 visible state record ids 写入 `invalidates`。`evidence-index.json.staleBy` 记录 stale record id 到 invalidating action id 的映射。

artifact、verification、completion-claim 不因为一次点击自动 stale；它们必须由新的 artifact evidence、verification 或 completion guard 重新解释。

---

## 9. Action Schema

插件算法只使用 generic action schema。底层 Host adapter 决定如何执行。

核心 action：

```text
observe
wait
click
double_click
drag
type_text
press_key
hotkey
scroll
focus
save
```

动作请求应包含：

```text
actionKind
targetRef?
groundingRef?
inputIntentRef
actorRef?
scopedInputAdapterRef?
beforeObservationRef
expectedAfter
```

动作结果应包含：

```text
executorEventRef
inputExecuted
adapterKind
targetRef
beforeRef
afterRef
verificationRef
sideEffectFlags
diagnostics
```

Computer Use 不直接决定是否移动系统鼠标、是否使用 Accessibility、是否用 Browser/CDP 或 focused system input。它只要求 Host 返回可验证 executor event 和 side-effect flags。

---

## 10. Host Port Contract

Computer Use package 通过窄 host ports 接触外部世界。

```text
capture()  -> observation refs
crop()     -> focus-region observation refs
plan()     -> generic action plan
locate()   -> grounding refs
execute()  -> executor event refs
verify()   -> verification refs
writeTrace()
emitEvent()
```

禁止 host port：

- GUI direct executor。
- raw screenshot/base64 transfer into main payload。
- provider raw payload passthrough。
- clipboard/IME raw text leak。
- app-private shortcut hidden inside package algorithm。
- shell direct artifact write as GUI completion evidence。

Host adapter 可以是 browser session、window-session host、terminal、app-native command、Accessibility/UIA/AT-SPI、focused system input 或 future isolated backend。Computer Use 插件只依赖其 refs-first contract。

---

## 11. Uncertainty

Uncertainty 是一等 evidence。它让 agent 在困惑时继续探索或 blocked，而不是硬点。

常见 uncertainty：

- missing target
- ambiguous target
- low-confidence OCR
- stale evidence
- completion gap
- visual content unclear
- artifact not visible
- adapter unavailable
- execution failed

blocking uncertainty 会阻止 completion。只有通过新 observation、crop、OCR/VLM、file evidence 或 verification 解决后，completion guard 才能放行。

---

## 12. Artifact 和 validator

PPTX、DOCX、CSV、PDF、图片等格式能力不进入核心鼠标键盘算法。它们作为 artifact renderer / validator / previewer 插件存在。

例如“做 PPT”不是特殊 planner；它只是：

- 通过通用 GUI action 操作目标应用。
- 通过保存动作产生 `.pptx`。
- 用 PPTX validator 检查结构、页数、宏风险和内容。
- 用 artifact refs、before/after evidence、replay refs 证明过程。

同理，Word、Excel、浏览器、多应用工作流也复用 observe、inspect、ground、act、verify、ledger。

---

## 13. Completion 和 result compaction

Completion guard 读取 planner brief、verification、artifact validator、current observation 和 uncertainty。

完成输出必须包含：

```text
completionEvidenceRef
supportingRefs
artifactRefs?
verificationRefs
remainingUncertaintyRefs
```

`compactResult(result)` 面向上层 Host / GUI，只保留：

- status
- short summary
- refs
- bounded diagnostics
- artifact summaries
- next-step hints

它不能内联大对象、raw trace、raw screenshots、provider payload 或 secret。

---

## 14. Package-local 与真实 Host 的验收边界

Package-local tests 证明算法和 contract：

- request/response schema
- host-port stdio loop
- evidence ledger
- planner brief
- freshness invalidation
- visible viewer placeholder
- target-bound deterministic harness
- artifact validator
- sanitizer
- fail-closed diagnostics

这些测试不证明真实 GUI 桌面成功。

真实 Host 验收应由上层项目定义，例如 browser session、window-session host、Desktop native bridge 或 future isolated backend。Computer Use 插件只要求真实 Host 提供：

- current observation refs
- target/window/session refs
- executor event refs
- before/after evidence refs
- verification/artifact refs
- side-effect flags

旧 VirtualAppScreen、noVNC、Xpra、virtual display 和 native-driver smoke 可以保留为 historical compatibility、diagnostic 或 backend research；它们不能单独作为当前 Computer Use 产品 pass。

---

## 15. 最终判断

Computer Use 插件的核心不是“创建屏幕”，而是：

```text
refs-first observation
-> active visual evidence gathering
-> generic intent planning
-> grounded action execution through Host adapter
-> after-action verification
-> stale evidence invalidation
-> fail-closed completion guard
```

这份文档只约束插件算法。产品层如何消费 annotation、如何展示证据、如何管理 actor cursor 和焦点接管，应写在对应产品架构文档中。
