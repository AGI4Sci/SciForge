# 视觉 Computer Use Agent 算法设计文档

版本：v2.0
日期：2026-05-03

---

## 1. 项目定位

在已有纯文本 Agent（含任务规划、记忆机制、工具调用框架）的基础上，新增一个纯视觉 Computer Use 工具，让 Agent 能通过截图、视觉定位、鼠标键盘动作完成 GUI 操作。

**核心约束**

- 不训练新模型，直接调用现有 LLM / VLM / GUI Grounding 模型 / OCR
- 纯视觉路线：不读 DOM、不读 accessibility tree、不调用应用内部 API，只依赖截图与鼠标键盘
- 优先保证任务完成质量与稳定性，暂不优化调用开销

**核心设计目标**

构建一个可验证、可恢复、可控的视觉操作闭环，而不是简单的"LLM 看截图 → 输出坐标 → 点击"。

---

## 2. 架构总览

系统分为三层：主 Agent 层、视觉工具层、桌面环境层。

主 Agent 层负责理解用户任务、维护长期记忆、进行高层规划、决定是否调用 computer_use 工具、接收执行结果后继续推理。

视觉工具层作为自治子系统，内部包含 11 个核心模块：Task Contract Builder、Visual Observer、Candidate Planner、Foveated Grounder（含 Disambiguation）、Mental Simulator、Action Tournament、Crosshair Verifier、Safety Gate、Executor、Post-action Verifier（三层）、Recovery Manager（含 Milestone Checkpoint）。辅助模块包括 Stuck Monitor、Interrupt Handler、Visual Memory、Trace Recorder。

桌面环境层提供截图、鼠标、键盘接口。

主 Agent 通过 `computer_use.run_task(task, constraints, context)` 调用视觉工具。视觉工具内部自主执行 observe → plan → ground → simulate → select → verify → act → verify → recover 的完整循环，最终返回 success / failed / partial / need_confirmation / need_agent_intervention。主 Agent 不需要关心每个坐标细节，只处理高层任务结果。

---

## 3. 工具调用接口

### 3.1 高层任务接口（推荐）

主 Agent 传入任务描述、执行约束（纯视觉模式、最大步数、最大时长、是否允许高风险动作、需要确认的动作类型列表）、上下文信息（用户目标、已知应用、语言偏好）。

返回包含：执行状态、摘要、最终屏幕观察与可见证据、trace ID、步数、失败原因、需要确认的内容、以及需要回传给主 Agent 记忆系统的经验更新。

### 3.2 低层单步接口（调试用）

传入单步指令、预期变化描述、风险等级。返回动作执行状态、实际动作坐标、执行前后摘要、验证结果。

---

## 4. 核心数据结构

### 4.1 Task Contract

任务契约是整个执行过程的约束骨架，包含以下要素：

**Success Criteria（带正反面验证）**：每条成功标准同时定义"应该看到什么"（positive）和"如何区分真正完成 vs. 表面相似"（negative_check）。这是为了防止 VLM 出现假阳性匹配——例如页面标题中恰好包含 ".pdf" 字样就被误判为下载完成。每条标准附带置信度阈值。

**Milestones（带双向判据）**：每个 milestone 是一个可通过截图视觉验证的中间状态，同时包含 visual_success_predicate（什么样算到达）和 visual_failure_predicate（什么样算未到达）。Milestone 支持运行时动态调整——当执行中发现实际 GUI 流程与预设不匹配时，允许动态插入或跳过。

**Forbidden Actions**：明确禁止的动作类型列表。

**Recovery Policy**：允许的恢复手段（Esc / Back / Undo / 请求用户确认）。

### 4.2 Visual Observation

屏幕的结构化描述，包含：时间戳、截图 ID、屏幕尺寸、活动窗口区域、屏幕摘要（VLM 生成）、可见文本列表（OCR，含 bbox）、候选 UI 区域（含类型和 bbox）、与上一帧的差异（变化比例和主要变化区域）、稳定性判断、等待状态分类（idle / transitioning / long_processing）。

### 4.3 Candidate Action

候选动作不包含坐标，只包含：动作类型、目标视觉描述（自然语言）、预期视觉变化、风险等级、可逆性评估、前提条件、失败时的 fallback 策略、对哪个 milestone 有推进作用。

### 4.4 Grounded Action

经过 Grounding 模型定位后的动作，在 Candidate Action 基础上增加：目标中心点坐标（归一化）、目标 bbox、Grounding 置信度、准星验证结果、是否使用了消歧流程。

### 4.5 Milestone Checkpoint

每个 milestone 完成时保存的状态快照，包含：milestone ID、截图、屏幕摘要、应用状态描述、到达该状态的导航路径描述、时间戳、到达所用步数。用于后续恢复时参考。

---

## 5. 核心设计原则

### 5.1 LLM 与 Grounding 模型职责分离

LLM 的空间推理能力远不如它的语义理解能力。因此 LLM / VLM 只负责理解屏幕状态、生成操作意图、生成精确的视觉目标描述（自然语言）、预判操作结果、验证操作效果。Grounding 模型只负责接收视觉目标描述和截图，输出目标元素的坐标。两者严格分工，LLM 永远不直接输出坐标。

### 5.2 每一步闭环验证

操作前检查：当前状态是否适合执行、目标元素是否明确、坐标是否经过准星验证、动作是否触发安全门控。

操作后验证（三层独立判断）：像素级变化检测、语义变化匹配、Milestone 推进判断。三层独立运行，即使某层判断出错，其他层仍能提供有用信号。

### 5.3 多候选竞争 + 模拟推演

每一步生成多个候选动作（3-5 个），覆盖不同操作路径（直接点击、键盘快捷键、Tab/Enter 焦点路线、处理弹窗、等待/滚动）。所有候选经过 Grounding、Mental Simulation、Tournament 综合评分后选择最优，不直接执行第一个想到的动作。

### 5.4 恢复策略基于代价评估

不同场景下最优恢复策略差异很大。填写了一半的长表单中"刷新页面"会丢失所有输入，但在浏览器导航中"刷新"的代价几乎为零。因此恢复策略选择必须考虑当前状态的"价值"——已完成多少 milestone、是否有未保存的输入、距离上次 checkpoint 多少步。

---

## 6. 主执行算法

主循环按以下顺序执行，每一步都有明确的进入条件和退出条件：

**步骤 1：边界检查。** 如果已达到最大步数限制，返回失败。

**步骤 2：观察。** 截图并生成 Visual Observation。

**步骤 3：等待判断。** 根据等待状态三分类决定行为。如果是 transitioning（短时过渡动画），高频轮询等待稳定（间隔 0.3 秒，最长 8 秒）。如果是 long_processing（有 spinner / 进度条），切换到低频轮询模式（间隔 2-3 秒，最长 60 秒）。如果是 idle，继续下一步。

**步骤 4：任务完成检测。** 用 success_criteria 的 positive 和 negative_check 双重验证。通过则返回成功。

**步骤 5：中断检测。** 检测弹窗等中断，如有则进入 Interrupt Handler 处理后回到步骤 2。

**步骤 6：卡住检测。** 包括表面信号（重复动作、无变化、重复错误）和语义级停滞（有动作有变化但 milestone 不推进）。如果卡住，进入 Recovery Manager。

**步骤 7：生成候选动作。** Candidate Planner 生成 3-5 个候选。

**步骤 8：Grounding + 消歧。** 每个候选经过三阶段 Foveated Grounding。如果存在多个高置信候选点或目标附近有相似元素，触发 Disambiguation。通过准星验证的进入下一步。如果全部 Grounding 失败，进入 Grounding 失败恢复。

**步骤 9：Mental Simulation。** 对每个通过验证的 grounded action，VLM 做五维结构化预判。

**步骤 10：Action Tournament。** 综合 Grounding 质量、准星验证、Mental Simulation、风险评估打分，选择最优动作。如果最高分低于阈值，请求主 Agent 介入。

**步骤 11：Safety Gate。** 对选中动作做安全检查。未通过则请求确认。

**步骤 12：执行。** 执行鼠标键盘动作。

**步骤 13：等待并观察。** 等待屏幕稳定后截图。

**步骤 14：三层 Post-action 验证。** 根据验证结果决定：milestone 推进则保存 checkpoint 并继续；语义匹配但未推进则继续；未达预期则进入 Recovery Manager。

循环直到任务完成、达到步数限制、或需要人工介入。

---

## 7. Visual Observer

### 7.1 职责

将原始屏幕截图转为结构化的视觉状态描述。输入包括当前截图、上一帧截图、最近 N 步动作、当前鼠标位置、屏幕尺寸、设备缩放比例。输出包括屏幕摘要、可见文本、候选 UI 区域、活动窗口区域、弹窗检测结果、屏幕变化区域、稳定性判断、等待状态分类。

### 7.2 截图稳定性检测

GUI 动作后不能立刻截图判断，因为可能有动画、加载、弹窗延迟。基本策略是连续两帧 diff 低于阈值即判定为稳定。

### 7.3 等待状态三分类

普通稳定性检测只处理短时动画。实际 GUI 操作还有长等待场景（文件上传下载、后台处理），需要区分三种状态：

- **idle**：屏幕几乎无变化，页面静止，可以操作
- **transitioning**：有变化但没有 loading 指示器，是过渡动画，需要短等待（高频轮询，间隔 0.3 秒）
- **long_processing**：检测到 spinner / 进度条 / loading 指示器，需要长等待（低频轮询，间隔 2-3 秒）

区分的意义在于避免两种错误：在长加载场景中用高频轮询浪费资源，或在长加载场景中因为进度条变化率很小而过早判定为"稳定"。

### 7.4 视觉区域解析

纯视觉路线下使用 OCR、图标检测、按钮 / 输入框 / 菜单 / 弹窗候选区域检测、图像分割、VLM 屏幕摘要。所有区域来自视觉解析，不依赖 DOM 或 accessibility tree。

---

## 8. Task Contract Builder

### 8.1 职责

将用户任务转换为可视觉验证的执行约束。

### 8.2 关键设计决策

**Success Criteria 必须带反面验证。** 每条标准同时定义 positive 和 negative_check。原因：VLM 容易出现假阳性匹配，比如页面内容中恰好包含和成功状态相似的文字，就被误判为任务完成。反面验证要求 VLM 显式区分"真正完成"和"表面相似"。

**Milestone 采用"模板 + 生成"混合策略。** 维护常见应用场景的 milestone 模板库（浏览器下载文件、填写表单、菜单导航等通用模式），LLM 优先从模板库匹配和组合，无匹配时才自由生成。这比纯 LLM 生成更可靠，因为自由生成容易产出不可视觉验证的 milestone（如"系统已保存数据"）或粒度不当的 milestone。

**Milestone 支持运行时动态调整。** 两种情况：一是检测到跳过了某个 milestone（直接到达后续状态），此时标记中间 milestone 为已完成；二是在某个 milestone 上停留过久，检测到出现了预期之外的中间步骤（如某应用多了一步确认），此时动态插入新 milestone。

### 8.3 Contract Builder 的生成要求

- success_criteria 每一条必须包含 positive 和 negative_check
- milestones 应该是中间可观察状态，每个包含成功和失败的视觉判据
- forbidden_actions 包含所有不允许的危险动作
- 所有判据必须能通过截图判断，不假设可以读取 DOM、API 或文件系统

---

## 9. Candidate Planner

### 9.1 设计目标

Candidate Planner 不输出坐标，只输出候选动作和视觉目标描述。每个候选必须包含：动作类型、目标视觉描述（包含文字、位置、上下文、视觉特征）、预期视觉变化、风险等级、失败 fallback、对 milestone 的推进说明。

### 9.2 候选动作生成策略

每一步生成 3-5 个候选，覆盖不同操作路径：最直接的视觉点击、键盘快捷键路线、Tab / Enter 焦点路线、处理弹窗或错误提示、等待 / 滚动 / 搜索目标。多路径覆盖的目的不是做选择题，而是确保在主路径被堵死时有备选方案。

### 9.3 生成约束

- 优先选择可逆、低风险动作
- 不允许点击 delete / pay / send / publish 等危险按钮，除非任务明确要求
- 如果当前状态不确定，生成观察、等待或恢复动作而不是盲目操作

---

## 10. Foveated Grounding + Disambiguation

### 10.1 三阶段定位

**阶段一：全局粗定位。** 输入整屏截图和 target_description，输出目标大致 bbox。

**阶段二：局部裁剪精定位。** 将全局 bbox 扩大 1.5-2 倍得到 crop，在 crop 图上精确定位目标中心点和 bbox。crop 内坐标需换算回整屏归一化坐标。

**阶段三：准星验证。** 在预测点绘制十字准星生成验证图。Verifier 判断准星是否落在正确目标上、是否落在了相邻的错误元素上、点击是否安全、是否建议执行。输出包含 is_correct、actual_target、risk、recommendation（click / reground / reject / ask_user）。

### 10.2 Grounding Disambiguation

Grounding 错误是系统最高频的失败原因，尤其在以下场景：页面上有多个视觉相似的元素（多个 "Download" 按钮）、目标元素很小（工具栏图标、下拉箭头）、目标没有文字只有图标、页面滚动或缩放后坐标漂移。

**核心思路**：当 Grounding 模型返回多个高置信候选点，或准星验证发现目标附近有相似元素时，不靠 confidence score 盲选，而是做显式消歧——将所有候选元素分别 crop 出来、编号标注后拼成一张图，让 VLM 回答"你要操作的是哪一个"。这把消歧从坐标回归问题转化为视觉理解问题，后者是 VLM 擅长的。

**触发条件**：单个候选且 confidence > 0.9 时跳过消歧。否则触发。

**消歧失败处理**：如果 VLM 判断所有候选都不是目标，用 VLM 生成更精确的目标描述后重新 Grounding。

### 10.3 Grounding Ensemble

为提高鲁棒性，可使用多个 Grounding 模型或多种 prompt。多个模型的结果做聚类，如果有共识（多个点距离小于阈值）则取聚类中心；如果分散则说明目标描述不清或界面复杂，触发目标描述重新生成。

---

## 11. Mental Simulation

### 11.1 设计定位

Mental Simulation 是在选择动作之前，让 VLM 对每个候选动作做"假如执行了会怎样"的思维预演。它的价值不在于精确预测结果（VLM 无法准确预测特定应用的行为），而在于低成本地排除明显的坏选项。

**典型场景**：任务是"保存文档"，屏幕上有 "Save" 和 "Save As"。两个都能被正确 Grounding，准星验证也都通过。但 "Save As" 会多弹出文件选择框，增加步骤和出错概率。Mental Simulation 能识别这个区别，而 Grounding confidence 和准星验证无法区分。

### 11.2 五维结构化提问

不使用开放式预测（"你觉得会发生什么"），而是五个结构化的 yes/no 判断：

1. **推进性**：这个操作是否能推进当前 milestone？
2. **死胡同风险**：这个操作是否可能导致进入无关页面或死胡同？
3. **不可逆风险**：这个操作是否可能触发不可逆后果（数据丢失、发送、付款）？
4. **可恢复性**：如果操作结果不符合预期，能否通过 Esc / Undo / Back 恢复？
5. **前提满足**：当前屏幕是否满足执行这个操作的前提条件？

结构化提问比开放式提问的回答质量高很多，也更容易转化为数值评分。

### 11.3 评分转换

五个维度转为 [0, 1] 的数值分数，权重分配：推进性（0.35）> 死胡同风险（0.25）> 不可逆风险（0.15）= 前提满足（0.15）> 可恢复性（0.10）。推进性权重最高因为它直接关系到任务完成；死胡同风险次之因为进入死胡同的恢复代价很大。

### 11.4 在主流程中的位置

发生在 Grounding + 准星验证之后、Action Tournament 之前。所有通过准星验证的 grounded actions 都经过 simulation。

---

## 12. Action Tournament

### 12.1 综合评分

结合六个维度和一个惩罚项：

- target_match_score（0.15）：目标描述与屏幕元素的匹配度
- grounding_confidence（0.15）：Grounding 模型的定位置信度
- crosshair_score（0.15）：准星验证得分
- simulation_score（0.30）：Mental Simulation 综合分，**权重最高**
- reversibility_score（0.10）：操作的可逆程度
- state_precondition_score（0.15）：当前状态是否满足动作前提
- risk_penalty（-0.25）：风险惩罚

Mental Simulation 权重最高的原因：它提供了其他维度无法覆盖的语义级判断——Grounding 只管"定位到了哪"，准星验证只管"位置对不对"，而 simulation 判断的是"这个操作该不该做"。

### 12.2 选择策略

最高分低于阈值时，判定为没有可行动作，请求主 Agent 介入。Simulation 标记了不可逆风险时，即使分数最高也要求额外确认。

---

## 13. Post-action Verifier（三层验证）

### 13.1 设计原理

不使用单个 VLM 调用做开放式判断，而是拆成三个独立判断层。原因：VLM 的开放式判断不稳定，容易出现"页面闪了一下就认为变化已发生"的误判。三层独立运行，每层提供不同信号，互为校验。

### 13.2 三层定义

**第一层：像素级变化检测。** 纯视觉对比，不需要 VLM。检测变化发生的区域、变化面积占比。如果变化率低于阈值（如 0.5%），直接判定为动作未生效，不需要后续 VLM 判断。

**第二层：语义变化匹配。** 将 before 和 after 截图同时传给 VLM（关键：两张图同时传入，而不是只传 after），判断观察到的变化是否与 expected_visual_change 语义一致。同时传入第一层检测到的变化区域，引导 VLM 聚焦于正确区域。

**第三层：Milestone 推进独立判断。** 只看 after 截图，判断当前屏幕是否满足当前或下一个 milestone 的 visual_success_predicate。这个判断独立于"动作是否生效"——因为有时动作生效了但没推进 milestone（需要更多步骤），有时一个动作直接跳过了多个 milestone。

### 13.3 各层组合解读

| 像素变化 | 语义匹配 | Milestone 推进 | 解读与处理 |
|---------|---------|--------------|-----------|
| 有 | 匹配 | 推进了 | 完美执行，保存 checkpoint，进入下一 milestone |
| 有 | 匹配 | 未推进 | 动作生效但还需更多步骤，正常继续 |
| 有 | 不匹配 | 未推进 | 屏幕变了但不是预期变化，可能误操作，进入恢复 |
| 有 | 不匹配 | 推进了 | 意外地直接达到目标（跳过中间步骤），接受结果 |
| 无 | — | — | 动作完全无效，需要恢复或重试 |

---

## 14. Stuck Monitor

### 14.1 表面信号检测

以下情况判定为卡住：连续 N 步截图几乎不变、连续 N 次点击同一区域无效果、连续 N 次生成相似动作、同一弹窗或错误反复出现、目标元素多次 Grounding 失败。

### 14.2 语义级停滞检测

表面信号之外，还有一种更隐蔽的卡住模式：系统每一步都在做不同的动作，屏幕也在变化，但任务没有实质性推进。比如 Agent 在网页上反复滚动、点击不同链接，看起来很忙但始终没有接近目标。

**检测方法**：追踪 milestone 推进间隔。如果超过一定步数（如 6 步）milestone 没有推进，让 VLM 做一次高层评估："看最近 N 步的动作和当前屏幕，系统是否还在朝目标前进？如果偏了，偏到哪了？是否需要回退？"

这类高层判断 VLM 通常比具体坐标定位可靠得多，因为它考验的是语义理解而非空间推理。

### 14.3 卡住处理策略

按侵入性从低到高排列：等待屏幕稳定 → 重新截图 → 重新生成目标描述 → 使用 crop-level grounding → 换一个候选动作 → 使用键盘 fallback（Tab / Enter / 快捷键）→ Esc / Back / Undo → 回退到上一个 milestone checkpoint → 请求主 Agent 介入 → 请求用户确认。

---

## 15. Interrupt Handler

### 15.1 常见中断类型

权限弹窗、登录弹窗、Cookie banner、下载确认、文件覆盖确认、网络错误、系统通知、应用崩溃、保存冲突、未填写必填项。

### 15.2 已知类型的处理规则

- Cookie banner：尝试点击拒绝或关闭
- 权限弹窗：如果权限是任务所需则请求用户确认，否则关闭
- 错误弹窗：提取错误信息，规划恢复
- 确认弹窗：高风险则请求确认，否则验证后继续

### 15.3 未知弹窗的通用处理

对于不在预定义类型中的弹窗，先让 VLM 理解弹窗内容（在说什么、要求用户做什么、与任务是否相关、有哪些可选操作、每个操作的风险），然后再决策。

**核心原则：不理解就不操作。** 如果弹窗是纯信息性质且有安全的关闭按钮，关闭；如果阻塞任务但不涉及高风险，尝试安全处理；如果需要用户输入或涉及高风险，上报给用户或主 Agent；兜底策略永远是上报而非猜测性操作。

---

## 16. Recovery Manager

### 16.1 恢复原则

所有恢复动作必须满足：低风险、可逆、局部修复、不扩大错误、不跳过验证。

### 16.2 基于代价评估的恢复策略选择

每个恢复动作有一个基础代价，但实际代价需根据当前状态调整。影响代价的因素：

- **已完成的 milestone 是否会丢失**：刷新页面可能让已完成的表单回到初始状态
- **已输入的数据是否会丢失**：在填写了一半的表单中，刷新的代价远高于在导航页面
- **距离上次 checkpoint 的步数**：checkpoint 恢复的代价与中间丢失的步数成正比
- **当前是否在表单/编辑器中**：表单场景中大部分恢复动作的代价都更高

恢复时按调整后的代价从低到高尝试，选择对当前状态代价最小且适用于当前失败类型的恢复动作。

### 16.3 Milestone Checkpoint 恢复

每个 milestone 完成时保存 checkpoint（截图、屏幕摘要、应用状态描述、导航路径描述）。当简单恢复（Esc / Undo / Back）连续失败 2-3 次后，启动 checkpoint 恢复。

**恢复方法**：让 VLM 参考 checkpoint 的截图和路径描述（如"File > Export > 选择 PDF"），规划从当前状态重新导航回 checkpoint 状态的步骤，然后逐步执行并验证。这比盲目按 Esc / Back 可靠得多，因为它有明确的目标状态作为参照。

### 16.4 失败类型与恢复策略速查

| 失败类型 | 表现 | 首选恢复 | 备选恢复 |
|---------|------|---------|---------|
| Grounding 错误 | 点错元素 | Undo / Back | Checkpoint 恢复 |
| 输入失败 | 文本未出现 | 重新聚焦 + 粘贴 | 全选重输 |
| 弹窗阻塞 | modal 出现 | 分类后处理 | Esc |
| 页面未响应 | 点击后无变化 | 等待 + 重试 | 键盘 fallback |
| 状态漂移 | 进入错误页面 | Back / 面包屑 | Checkpoint 恢复 |
| 任务歧义 | 多个相似目标 | Disambiguation | 请求确认 |
| 高风险动作 | 即将发送/删除 | 停止 | 请求确认 |

---

## 17. Safety Gate

### 17.1 语义级安全判断

不依赖单纯的按钮文本关键词匹配（"Send" / "Delete" / "Pay"），因为同一个关键词在不同上下文中风险完全不同。"Submit a form" 在很多场景下无害，但 "Submit payment" 是高风险的；一个 "Confirm" 按钮的风险取决于它确认的是什么。

安全判断综合以下信号：

- **规则匹配**：动作的语义类型是否在 forbidden_actions 中
- **Simulation 不可逆判断**：Mental Simulation 阶段已经产出了 irreversible_risk 判断，直接使用
- **Milestone 位置判断**：如果当前 milestone 还不是最后一步，但动作是提交类，说明太早了
- **VLM 上下文语义分析**：让 VLM 结合屏幕上下文判断操作的实际后果

### 17.2 高风险动作集合

Send、Submit、Delete、Pay、Purchase、Transfer、Overwrite、Publish、Share、Grant permission、Install、Uninstall、Run command、Expose secret。

### 17.3 安全门控条件

高风险动作必须同时满足：用户任务明确要求此类操作、当前 milestone 已到达提交前状态、Grounding + 准星验证确认目标按钮正确、Mental Simulation 评估后果可接受、必要时请求用户确认。

---

## 18. Executor

### 18.1 动作空间

click、double_click、right_click、drag、type_text、press_key、hotkey、scroll、wait。

### 18.2 执行原则

- 点击前必须经过 Grounding + 准星验证
- 文本输入优先使用 clipboard paste，长文本不逐字输入
- 点击后等待屏幕稳定
- 高风险动作必须经过安全门控
- 快捷键执行后也必须视觉验证
- scroll 后必须确认目标是否更接近

### 18.3 坐标转换

三套坐标必须统一：模型归一化坐标 [0, 1]、截图像素坐标、系统鼠标逻辑坐标。转换时需处理 macOS Retina 缩放、Windows DPI scaling、浏览器缩放、远程桌面缩放、多显示器、窗口偏移。

---

## 19. Visual Memory

### 19.1 Episode 级局部记忆

视觉工具在执行过程中维护 episode 级别的局部记忆，包含：当前 milestone、已保存的 checkpoints、最近动作列表、视觉地标（如"屏幕中央的白色弹窗标题为 Export"）、已知目标的上次位置和置信度、负面记忆（如"左下角的 Export 是菜单标题不是确认按钮"）。

### 19.2 返回给主 Agent 的记忆更新

视觉工具结束后只返回压缩后的经验：任务摘要、有用的 UI 地标、学到的恢复经验、需要避免的操作。不把所有截图写入长期记忆。

---

## 20. Trace Recorder

### 20.1 每步记录内容

每一步记录：步骤编号、截图 ID、等待状态、当前 milestone、候选动作列表、Grounding 结果、是否使用消歧、Mental Simulation 结果、Tournament 评分、选中的动作、准星验证结果、执行结果、三层 Post-action 验证结果（分别记录像素变化层、语义匹配层、milestone 检查层）、恢复记录、是否保存了 checkpoint。

### 20.2 Trace 可视化资产

建议保存：原始截图、准星验证图、crop 图、执行前后 diff 图、动作 JSON、Verifier 输出、失败恢复记录、Mental Simulation 输出。这对调试极其重要。

---

## 21. 评测指标

### 21.1 任务级

Task Success Rate、Partial Success Rate、Average Steps、Average Duration、Human Intervention Rate、Failure Recovery Rate、High-risk Action Block Rate。

### 21.2 步骤级

Grounding Success Rate、Disambiguation Trigger Rate、Crosshair Verification Pass Rate、Mental Simulation Accuracy（预测 vs. 实际）、Post-action Expected Change Rate、Stuck Detection Precision、Recovery Success Rate、Repeated Action Rate、No-op Action Rate。

### 21.3 坐标级

Click Target Accuracy、Distance to Element Center、Wrong Element Click Rate、Small Element Accuracy、Menu Item Accuracy、Input Box Focus Accuracy。

---

## 22. MVP 实现路径

按场景覆盖切分，每个阶段产出可实际使用的能力。

### 阶段 1：单应用线性任务（2-3 周）

目标场景：Chrome 浏览器中的"搜索 → 点击 → 下载"线性流程，在干净环境中测试。

实现模块：Visual Observer（含稳定性检测 + 等待状态分类）、Foveated Grounder（三阶段定位）、Grounding Disambiguation、Candidate Planner、Mental Simulation、Action Tournament、Executor、Post-action Verifier（三层验证）、Trace Recorder。

暂不需要：Interrupt Handler（干净环境无弹窗）、完整 Recovery Manager（线性任务出错少）。

### 阶段 2：单应用分支任务（2-3 周）

增加场景：弹窗处理、表单填写、滚动定位。

增加模块：Task Contract Builder（含 milestone 模板库）、Milestone Checkpoint、Stuck Monitor（含语义级停滞检测）、Interrupt Handler（含未知弹窗处理）、Recovery Manager（含代价评估）、基本安全门控。

### 阶段 3：多应用切换（3-4 周）

支持：浏览器 + 系统文件管理器 + 常用桌面应用。

增加模块：Grounding Ensemble、Visual Memory（episode 级）、Milestone 运行时动态调整、完整安全门控。

### 阶段 4：稳定性与产品化

增加：长期 UI 经验沉淀（记忆更新回传主 Agent）、自动评测集、失败轨迹回放 / Trace Viewer、多模型动态调度。

---

## 23. 完整执行闭环

```
主 Agent 给出任务
  ↓
构建 Task Contract（带正反面验证 + 动态 milestone）
  ↓
观察当前屏幕 → 分类等待状态
  ↓
判断任务是否完成（正反面双重验证）
  ↓
检测中断（含未知弹窗理解）
  ↓
检测卡住（含语义级停滞）
  ↓
Planner 生成 3-5 个候选动作
  ↓
Foveated Grounder 定位 + Disambiguation 消歧
  ↓
准星验证
  ↓
Mental Simulation 五维结构化预判
  ↓
Action Tournament 综合评分选择最优
  ↓
Safety Gate 语义级安全门控
  ↓
Executor 执行鼠标键盘动作
  ↓
等待屏幕稳定
  ↓
三层 Post-action 验证（像素 / 语义 / Milestone）
  ↓
成功 → 保存 Checkpoint → 下一 milestone
  ↓
失败 → Recovery Manager（代价评估 → Checkpoint 恢复）
  ↓
循环直到任务完成或需要人工介入
```

---

## 24. 核心设计要点总结

1. **LLM 不输出坐标，只输出视觉目标描述。** Grounding 模型负责坐标定位。职责分离基于一个事实：LLM 的语义理解远强于空间推理。
2. **Grounding 歧义必须显式消歧。** 多候选时 crop 标注让 VLM 选择，把消歧从坐标回归问题转化为视觉理解问题。
3. **Mental Simulation 排除坏选项。** 五个结构化 yes/no 问题预判推进性、死胡同风险、可逆性。价值在于排除，不在于精确预测。
4. **每一步执行后三层独立验证。** 像素变化、语义匹配、Milestone 推进各自独立判断、互为校验。
5. **Stuck 检测包含语义级停滞。** 检测"有动作有变化但 milestone 不推进"的隐蔽卡住模式。
6. **恢复策略基于代价评估。** 根据当前状态价值（未保存输入、已完成进度）选择代价最小的恢复路径。
7. **Milestone Checkpoint 支持状态回退。** 简单恢复失败后参考 checkpoint 截图和路径重新导航。
8. **Success Criteria 带反面验证。** 防止 VLM 的假阳性匹配导致提前终止。
9. **未知弹窗先理解再决策。** 不理解就不操作，兜底策略永远是上报。
10. **安全判断基于语义而非关键词。** 结合 Simulation 的不可逆判断、milestone 位置、上下文理解综合决策。
