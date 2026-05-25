# 视觉 Computer Use Agent — MVP 设计文档

版本：v0.2-coarse-to-fine
日期：2026-05-05

---

## 1. 目标

用最少的模块实现一个能 work 的纯视觉 GUI 操作闭环。

目标场景：Chrome 浏览器中的线性任务，如"搜索一篇论文并下载 PDF"。干净环境，不处理弹窗、不涉及高风险操作。基础 smoke 可以先用 disposable 本地页面证明真实输入闭环；最终用户级验收必须进入真实桌面工作流，例如制作一页 PPT 或联合多个 App 产出可检查 artifact。

核心约束不变：纯视觉路线，不读 DOM，不读 accessibility tree，LLM 不输出坐标。

---

## 2. 架构

Computer Use 是 TUI 侧 action provider，不是 GUI 侧功能。它只直接和 TUI Agent Host 通信；GUI 需要展示 trace、收集确认或提示状态时，由 TUI Host 调用 `gui.present`、`gui.ask_user`、`gui.notify` 或 `gui.set_status`。Computer Use 模块不得 import React/UI、renderer registry、Workbench、AnnotationSidebar 或 GUI 私有状态。

对外信息流：

```
User / GUI gesture
  -> terminal-equivalent text
  -> TUI Agent Host
  -> computer_use.run_task(request, host_ports)
  -> refs-first result | needs-confirmation | failed-with-reason
  -> TUI Agent Host
  -> optional gui.present / gui.ask_user / gui.notify
  -> GUI Shell
```

内部仍保持五个模块，串联成单一循环；其中视觉理解统一使用 coarse-to-fine 证据链：

```
TUI Agent Host
  ↓  computer_use.run_task(request, host_ports)
Visual Observer → Planner → Grounder → Executor → Verifier
       ↑                                              │
       └──────────────── 循环 ─────────────────────────┘
```

不做 milestone 拆分、不做多候选竞争、不做恢复。每一步就是：看目标窗口 → 粗定位关键区域 → 局部 focus crop → 精定位/执行 → 局部+整窗验证 → 把反馈写回记忆 → 继续或停止。

包边界：

- `packages/actions/computer-use` 拥有 Computer Use action provider 的主体：request/result schema、action loop、safety/approval policy、trace contract、budget debit、host port contract、executor adapter contract 和 compact handoff。
- `packages/observe/vision` 是可选 sense provider。它负责视觉观察、coarse-to-fine focus region、KV-Ground/visual grounding、verifier 反馈压缩、临时多模态记忆和 trace contract validation；它不执行桌面动作。
- `src/runtime` 只保留 SciForge Host adapter：把 `GatewayRequest` 转成 `ComputerUseRequest`，提供 `host_ports`，把结果转成 `ToolPayload` 和 runtime events。通用 Computer Use 能力不应长期留在 `src/runtime/computer-use`。
- GUI 只展示 refs、折叠 audit/debug、收集确认和发送终端等价文本；它不执行 Computer Use，也不决定 provider、policy、completion 或 confidence。

算法边界：coarse-to-fine 的区域选择、focus region contract、verifier 反馈压缩、临时多模态记忆压缩、trace contract validation 和通用 Computer Use policy 属于 `packages/observe/vision/sciforge_vision_sense`；Computer Use action loop、safety gate、host bridge contract、scheduler、executor 和 trace handoff 属于 `packages/actions/computer-use`。SciForge runtime 只装配 TUI Host ports，负责把截图、裁剪、坐标映射、执行动作和写 trace 的平台能力以接口形式提供给 action provider。长测 runner 只负责 scenario/manifest/report 编排，不再自己维护视觉契约和通用策略。

### 2.1 对外接口

Computer Use 对 TUI Host 暴露窄接口：

```ts
computerUse.getManifest()
computerUse.runTask(request, hostPorts)
computerUse.validateTrace(traceRef)
computerUse.compactResult(result)
```

推荐请求形状：

```ts
type ComputerUseRequest = {
  schemaVersion: 'sciforge.computer-use.request.v1';
  task: string;
  maxSteps?: number;
  riskPolicy?: 'fail-closed' | 'allow-confirmed';
  windowTarget?: WindowTarget;
  providers?: {
    sense?: 'local.vision-sense';
    grounder?: 'kv-ground' | 'vision-grounder';
    executor?: 'desktop-bridge' | 'remote-desktop' | 'dry-run';
  };
  approvalRef?: string;
  trace?: {
    outputDir?: string;
    storagePolicy: 'ref-only';
  };
};
```

推荐结果形状：

```ts
type ComputerUseResult = {
  status: 'completed' | 'failed-with-reason' | 'needs-confirmation' | 'max-steps';
  reason: string;
  traceRefs: string[];
  screenshotRefs: string[];
  finalObservationRef?: string;
  approvalRequest?: {
    reason: string;
    riskLevel: 'high';
    actionSummary: string;
    traceRefs: string[];
  };
  verifierResult?: {
    verdict: 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
    confidence?: number;
    critique?: string;
    repairHints?: string[];
  };
  budgetDebitRefs?: string[];
};
```

`hostPorts` 是 action provider 和宿主平台能力的唯一接触面：

```ts
type ComputerUseHostPorts = {
  capture(target: WindowTarget, scope: 'display' | 'window'): Promise<ScreenshotRef[]>;
  crop(ref: ScreenshotRef, region: FocusRegion): Promise<ScreenshotRef>;
  execute(action: GenericGuiAction, target: ResolvedWindowTarget): Promise<ExecutionOutcome>;
  writeTrace(trace: ComputerUseTrace): Promise<string>;
  emitEvent(event: ComputerUseEvent): void;
};
```

不建议把 `requestApproval` 放进 `hostPorts` 让模块直接弹 UI。高风险动作应返回 `needs-confirmation` 和 `approvalRequest`；TUI Host 决定是否调用 `gui.ask_user`，确认后再以 `riskPolicy='allow-confirmed'` 和 `approvalRef` 发起新的受控调用。

---

## 3. 主循环

**步骤 0：TUI Host 装配。** TUI Host 根据用户文本或 slash/tool 调用构造 `ComputerUseRequest`，注入 `hostPorts`，并选择 sense/grounder/executor provider。GUI 不参与 provider 选择。

**步骤 1：观察。** 通过 `hostPorts.capture` 截图，等待屏幕稳定（连续两帧 diff 低于阈值），生成屏幕摘要和可见文本列表。

**步骤 2：判断是否完成。** 将当前截图、任务描述、已执行的动作历史传给 VLM，直接问"任务是否已经完成"。完成则返回成功。

**步骤 3：规划下一步。** Planner 输出一个动作，包含动作类型和目标视觉描述。不生成多个候选，只生成一个最合理的下一步。对于密集 UI、小图标、表格、菜单和弹窗，Planner 可以额外输出 `targetRegionDescription`；runtime 会把它作为 coarse region 先裁剪观察，再在 crop 内精定位。Planner 也可以输出 `wait + targetRegionDescription` 来请求 observation-only 局部观察。

**步骤 4：定位。** Grounder 根据目标描述在窗口截图上定位。使用 coarse-to-fine：先在整窗截图中得到目标区域或粗中心点，再由 vision-sense 生成 focus-region crop，随后用 KV-Ground 或 visual Grounder 在 crop 内二次精定位，把 crop-local 坐标映射回 window-local/executor 坐标。后续执行和验证都使用精定位结果，并记录 coarse/fine grounding 证据。如果精定位失败，trace 会保留 coarse grounding 和 fine failure，供下一轮规划修正。

**步骤 5：执行。** Executor 通过 `hostPorts.execute` 执行通用鼠标键盘动作。真实桌面输入、远程桌面输入或 dry-run 都是 host port provider；Computer Use 不调用 GUI，也不通过 GUI 间接执行。

**步骤 6：验证。** 截图，对比执行前后的整窗和 focus-region crop。如果 focus 区域或整窗几乎没变化，记录为"动作可能无效"。Verifier 同时压缩 pixel diff、window consistency、grounding 坐标、focus bbox、失败/阻断原因和下一步建议，并调用 `build_region_semantic_verifier` 输出 `regionSemantic` verdict，例如 focused target reacted、off-target/unrelated window change、text-entry unverified。上述反馈供下一轮 Planner 使用。

**步骤 7：记录并继续。** 把这一步的动作、整窗截图 refs、focus crop refs、verifier feedback 和结果追加到历史中。需要跨步或跨轮复用时，调用 `vision-sense.visual_memory` 生成 file-ref-only 的临时多模态记忆块，再回到步骤 1。

**步骤 8：TUI Host 输出。** Computer Use 返回 refs-first result。TUI Host 决定是否把 trace 通过 `gui.present` 展示、是否把高风险 `approvalRequest` 通过 `gui.ask_user` 交给用户确认、或是否把失败包装为 repair hint。

**退出条件**：任务完成、达到最大步数（如 30 步）、Grounding 连续失败 3 次。

**验收契约**：trace 由 `vision-sense.trace_contract` 和 Computer Use action provider trace contract 共同校验：windowTarget、window screenshot refs、window-local 坐标、generic mouse/keyboard input channel、serialized scheduler metadata、window verifier consistency、file-ref-only image memory、host port provider metadata 和 no DOM/accessibility/GUI-private fields。T084/T085 的长测 runner 只把 trace path、workspace path 和 raw trace text 传入该接口。

**验收分层**：L1 是基础真实输入 smoke，只证明 capture -> ground -> execute -> verify 能穿透；L2 是单 App 用户产物任务，例如用可用的 slide app 制作并保存一页 PPT；L3 是多 App 用户工作流，例如 Browser/资料页 -> slide app -> Finder/保存对话框 -> SciForge GUI 展示 artifact refs。只有 L2/L3 可以声明用户级 Computer Use success，L1 只能声明 capability smoke passed。

---

## 4. 五个模块的设计

### 4.1 Visual Observer

**输入**：`hostPorts.capture` 得到的当前目标窗口截图、上一帧截图、可选 focus-region 请求。

**输出**：屏幕摘要（VLM 生成的一句话描述）、可见文本列表（OCR 结果，含位置）、屏幕是否稳定、可选 focus-region screenshot ref。输出只包含文本、坐标、refs 和紧凑 metadata，不包含截图字节、DOM、accessibility tree 或 GUI 私有对象。

**稳定性检测**：截图后等待，每 0.3 秒再截一帧，如果连续两帧差异低于阈值（如变化面积 < 1%）则判定为稳定。最长等待 8 秒。

**MVP 简化点**：不做等待状态三分类，不做完整 UI 区域类型检测；只在 Grounder/Verifier 需要时生成局部 crop，并把 crop 作为文件引用写入 trace。

### 4.2 Planner

**输入**：任务描述、当前屏幕摘要、可见文本列表、最近 N 步动作历史、最近 verifier feedback。

**输出**：一个动作，包含动作类型（click / type_text / press_key / scroll）和目标视觉描述。

**关键约束**：

- Planner 不输出坐标，只输出自然语言的视觉目标描述
- 目标描述必须包含足够的区分信息（如"右下角的蓝色 Export 按钮，不是左侧的 Export 菜单项"）
- 动作历史和 verifier feedback 传入的目的是避免重复执行同一个无效动作
- 如果上一步反馈显示 `pixel=no-visible-effect`、`focus=bbox(...)` 或 `window=lifecycle-changed`，Planner 必须换目标描述、扩大/重选局部区域、换输入 modality，或先恢复窗口状态

**MVP 简化点**：只生成一个动作，不生成多个候选。不做 milestone 拆分，Planner 每步自行判断最合理的下一步。

**Planner Prompt 要点**：

```
你是 GUI 操作规划器。你不能输出坐标。

任务：{task}
当前屏幕摘要：{screen_summary}
可见文本：{visible_texts}
已执行动作：{action_history}
Verifier反馈：{verifier_feedback}

请输出下一步操作。要求：
1. 输出动作类型和目标的视觉描述
2. 目标描述要包含文字内容、位置、颜色等视觉特征，
   足以在屏幕上唯一定位
3. 如果上一步动作没有生效，基于 verifier feedback 换目标、换区域或换输入方式
```

### 4.3 Grounder

**输入**：当前截图、目标视觉描述。

**输出**：目标中心点坐标（归一化）、置信度、准星验证结果。

**Coarse-to-fine 定位**：

阶段一，全局粗定位：在目标窗口截图上找到目标大致区域（bbox）或粗中心点。

阶段二，focus region：调用 `vision-sense` 的 `build_focus_region` / `build_focus_region_from_trace` 生成 clipped bbox，runtime 只负责把 bbox 裁成 `focus-region` screenshot ref。

阶段三，局部精定位：在 crop 图上用 KV-Ground 或 visual Grounder 精确定位中心点。crop-local 坐标换算回 window-local 坐标，再映射到 executor 坐标。trace 中同时记录 `coarseGrounding`、`fineGrounding`、`focusRegion` 和最终执行坐标。

**准星验证**：在预测点绘制十字准星，让 VLM 判断准星是否落在目标上。如果验证失败，让 VLM 重新描述目标后再做一次两阶段定位。最多重试一次。

**坐标转换**：crop-local 坐标 → window-local 截图像素坐标 → 系统鼠标坐标。需要处理 crop bbox、窗口 origin 和 device pixel ratio 缩放。

**MVP 简化点**：不做 Grounding Ensemble，不做 Disambiguation，只用单模型单次定位 + 一次重试。

### 4.4 Executor

**动作空间**：click、type_text（通过 clipboard paste）、press_key（Enter / Esc / Tab 等）、scroll。

**边界**：Executor 是 host port provider，不是 GUI 控件。它可以实现为本机 desktop bridge、remote desktop adapter、browser sandbox adapter 或 dry-run executor，但不能依赖 React/UI，也不能通过 GUI Shell 执行点击或输入。

**执行原则**：

- 文本输入走 clipboard paste，不逐字输入
- 点击后等待屏幕稳定再进入下一步
- scroll 按固定幅度执行
- 真实输入必须持有 scheduler lock，并记录 input channel、target window、executor provider 和 user-device impact
- 没有独立输入 adapter 时，必须显式允许 shared system input，且尽量绑定目标窗口和焦点

**MVP 简化点**：不支持 drag、double_click、right_click、hotkey。

### 4.5 Verifier

**输入**：执行前整窗截图、执行后整窗截图、执行前后 focus-region crop、grounding、windowTarget。

**输出**：整窗是否变化、focus 区域是否变化、窗口是否一致、动作是否可能无效、面向后续规划的 compact feedback。

**验证逻辑**：MVP 仍以像素级对比为主，但优先比较 focus-region crop。整窗变化而 focus 不变，通常意味着点错区域或无关动画；focus 变化而整窗变化很小，通常意味着小控件状态改变。两者都会写入 trace。

**反馈记忆**：调用 `vision-sense` 的 `build_verifier_planning_feedback` 生成短文本，例如：

```
pixel=no-visible-effect ratios=0.0000 | window=same-target-window sameWindow=true |
grounding=provided target="Save button" local=120,44 | focus=bbox(72,0,96,80) |
next=click produced no visible window effect; avoid repeating same target unless screenshot changed
```

**MVP 简化点**：region semantic verifier 先使用 action 类型、focus/window pixel diff、grounding 和 focus bbox 生成可审计语义分类；它不会伪造 OCR 结果。需要精确读取输入框文字、checkbox 状态、菜单项或错误提示文本时，后续可在同一 `regionSemantic` schema 上接入 OCR/VLM 语义检查。Visual Observer 和语义 Verifier 可以复用同一个 VLM provider；Verifier 仍先跑 deterministic checks，再把 compact evidence 交给 Codex CLI / TUI 文本 agent 做完成判断、下一步修复或最终解释。

---

## 5. 任务完成判断

不用 Task Contract，不拆 success_criteria。每轮循环开始时，直接将当前截图和任务描述传给 VLM，问：

```
任务：{task}
当前屏幕如图。
已执行 {n} 步操作。

这个任务是否已经完成？
回答 yes 或 no，并说明理由。
```

这种方式足够处理简单线性任务。它的弱点是对复杂任务可能出现假阳性（过早判定完成），但对 MVP 阶段够用。

---

## 5.1 临时多模态记忆

临时多模态记忆不是聊天长期记忆，也不保存图片字节。它是当前视觉任务 loop 的工作记忆，由 `vision-sense` 的 `visual_memory.py` 统一生成。

**输入**：

- 当前 run 或前几轮的 `vision-trace.json` 文件引用。
- `imageMemory.refs` 中的 window screenshot refs 和 focus-region refs。
- step-level action ledger、grounding、windowTarget、scheduler 和 verifier feedback。

**输出**：`VisionMemoryBlock`

```json
{
  "schemaVersion": "sciforge.vision-sense.visual-memory.v1",
  "mode": "same-run-replan | cross-round-followup | failure-recovery | long-context-compact",
  "policy": "file-ref-only",
  "text": "...budgeted memory block...",
  "traceCount": 3,
  "screenshotRefCount": 12,
  "focusRefCount": 4,
  "omitted": {"screenshotRefs": 20, "focusRefs": 6, "truncatedChars": 0}
}
```

**规则**：

- 只保留路径、sha256、尺寸、displayId、windowTarget、focus bbox、action count 和 verifier feedback。
- 不内联 `data:image`、base64、DOM、accessibility、截图字节或文件内容。
- 所有省略都要显式记录 omitted counts，避免 Planner 误以为记忆完整。
- runtime 只负责传 trace refs 并消费返回的 memory block，不自己决定视觉记忆策略。

---

## 5.2 Trace 契约与通用策略

`vision-sense` 提供视觉策略入口，`computer-use` action provider 提供执行与副作用契约：

- `sciforge_vision_sense.trace_contract`：校验 `vision-trace.json` 是否满足通用视觉 Computer Use 契约，包括 file-ref-only screenshot refs、window metadata、window-local coordinates、generic input channel、scheduler metadata、window verifier、真实 GUI executor lease 和 forbidden private fields。
- `sciforge_vision_sense.computer_use_policy`：输出 planner-only evidence task 判定、dry-run/real GUI matrix execution plan 和默认 window target contract。
- `sciforge_computer_use`：拥有 `ComputerUseRequest` / `ComputerUseResult`、安全门、approval 状态、action loop、execution outcome、budget debit 和 compact handoff。

这些逻辑不属于 `tools/computer-use-long-task-pool.ts`，也不属于 GUI renderer。长测工具只保留任务池、manifest、round prompt、报告和 repair plan；所有可复用视觉理解/定位/记忆/验证/策略判断都通过 vision-sense 接口调用，所有副作用执行、安全门和结果 handoff 都通过 Computer Use action provider 调用。

## 5.3 用户级验收任务

基础 GUI smoke 不足以证明 Computer Use 对用户有用。最终验收必须覆盖真实桌面产物和可见交互链路：

- **L1 capability smoke**：在 disposable 本地页面中点击输入框、输入文本、点击按钮、验证结果文本。该层只验证真实输入链路和 trace contract。
- **L2 single-app artifact**：使用 PowerPoint、Keynote、LibreOffice Impress 或可离线运行的 slide editor 制作一页 PPT/slide，包含任务指定标题和要点，并保存到 `.sciforge/vision-runs/<run-id>/`。验收需要最终文件 ref、保存位置截图 ref、slide 可见截图 ref 和 verifier verdict。
- **L3 multi-app workflow**：联合多个 App 完成一个问题，例如 Browser 打开本地资料页或安全网页，Computer Use 读取可见信息并切换到 slide app 制作一页 PPT，再通过 Finder/保存对话框保存，最后由 TUI Host 调用 `gui.present` 展示 artifact refs 和 trace 摘要。

验收限制：

- 所有用户级任务必须通过 TUI Host -> `computer_use.run_task(request, host_ports)` 进入模块；GUI 只发送 terminal-equivalent text 和展示结果。
- 不允许用 Playwright、DOM、accessibility tree、app-specific private API 或直接文件生成绕过真实 GUI 操作来冒充 Computer Use 成功。
- 真实外部发送、发布、授权、支付、删除或上传不作为默认验收；如必须覆盖，只能走 dry-run 或 `needs-confirmation` / `approvalRequest`。
- 若本机缺少目标 App、系统权限或 shared input policy 阻断，应返回 `blocked` manifest，而不是降级为不可验证的抽象成功。

---

## 6. 失败处理

MVP 不做恢复，遇到以下情况直接返回失败：

- 达到最大步数（30 步）
- Grounding 连续失败 3 次（含重试）
- 连续 5 步屏幕无变化（说明完全卡住了）

返回时附带完整的动作历史和每步截图，供人工分析失败原因。

---

## 7. 完整循环

```
接收任务
  ↓
截图 → 等待稳定 → 生成摘要
  ↓
VLM 判断任务是否完成 ── 是 → 返回成功
  ↓ 否
Planner 生成下一步（动作类型 + 目标描述）
  ↓
Grounder coarse 定位 → vision-sense 生成 focus-region → crop 精定位 + 准星验证
  ↓ 失败 → 重试一次 → 仍失败 → 累计3次则返回失败
  ↓ 成功
Executor 执行
  ↓
截图 → 整窗+focus crop 像素级对比 → 记录 verifier feedback
  ↓
追加到动作历史 → 回到开头
```

---

## 8. MVP 刻意不做的事

| 不做的事 | 为什么可以不做 | 什么时候加回来 |
|---------|-------------|-------------|
| Task Contract / Milestone | 线性任务不需要拆分中间目标 | 任务变复杂、需要处理分支流程时 |
| 多候选动作 + Tournament | 单候选在简单场景下够用 | 成功率不够需要竞争选优时 |
| Mental Simulation | 单候选不需要预判排除 | 引入多候选后 |
| Disambiguation | 简单页面很少有严重歧义 | 处理复杂页面、列表、表格时 |
| Grounding Ensemble | 单模型在简单场景下够用 | 单模型 grounding 成功率不够时 |
| 直接调用 GUI | 会破坏 TUI-owned action provider 边界 | 不加回来；只允许 TUI Host 调用 `gui.*` |
| 在模块内部弹确认 UI | 会让 policy owner 和 presentation owner 混在一起 | 不加回来；返回 `approvalRequest`，由 TUI Host 调用 `gui.ask_user` |
| 完整语义级 Post-action 验证 | focus-region 像素变化 + 下一轮 Planner 能覆盖一部分 | 需要及时检测误操作时 |
| Recovery Manager | 线性任务出错直接失败代价不大 | 任务变长、失败恢复比重启便宜时 |
| Interrupt Handler | 干净环境测试不会遇到弹窗 | 进入真实环境时 |
| Safety Gate | MVP 只跑低风险任务 | 涉及发送/删除/付款时 |
| Stuck Monitor | max_steps + 连续无变化检测兜底 | 需要更细粒度的卡住检测时 |
| Checkpoint | 没有 milestone 就不需要 checkpoint | 引入 milestone 后 |
| 大规模 Visual Memory 检索 | MVP 只保留 trace refs、focus refs 和 compact feedback | 任务变长、需要跨 run 检索 UI 布局经验时 |

---

## 9. 从 MVP 到完整版的演进路径

**MVP（当前）→ 阶段 2 的触发条件**：MVP 能跑通简单线性任务，但成功率不够高。此时加入多候选 + Mental Simulation + Tournament 提升选择质量，加入 Disambiguation 解决相似元素问题。

**阶段 2 → 阶段 3 的触发条件**：成功率上来了，但任务变复杂（分支、表单、多步骤），失败后需要恢复而非重跑。此时加入 Task Contract / Milestone / Recovery Manager / Checkpoint / Stuck Monitor。

**阶段 3 → 阶段 4 的触发条件**：进入真实环境，遇到弹窗、高风险操作、多应用切换。此时加入 Interrupt Handler / Safety Gate / Grounding Ensemble / Visual Memory。

每个阶段的加入顺序由实际遇到的失败模式驱动，不预先实现。
