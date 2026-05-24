# 反馈收件箱设计原则

最后更新：2026-05-24

反馈侧栏和反馈收件箱是同一个连续体验的两段，不是两个互斥模式。

用户在页面上指出问题时，先进入侧栏：澄清问题、解释对象关系、整理上下文，并在足够安全时提供低风险的即时修改。需要确认、审计、GitHub 同步、Runtime Codex repair、批量处理或复杂变更时，再进入收件箱，由收件箱管理、确认、执行和留痕。

## 产品定位

### 侧栏：理解问题，处理轻量动作

侧栏是用户指出 UI 问题后的第一现场。它应该帮助用户把“这里不对”变成清楚、可保存、可交接的反馈。

侧栏负责：

- 捕获用户选择的页面对象、截图、URL/route、viewport、DOM/role/label/text 摘要和原始描述。
- 通过简短问答澄清问题、对象关系、期望行为和验收标准。
- 展示将要保存到收件箱的反馈草稿，让用户能确认或补充。
- 承载低风险即时修改，例如文案微调、局部样式修正、非破坏性的轻量属性调整。

即时修改不是独立模式。它只是侧栏中的一个 quick action：只有当影响范围小、可解释、可回退、无需外部同步、无需跨文件推理、无需 repair runner 时才出现。任何不满足这些条件的修改，都必须转入收件箱。

侧栏不能把澄清对话伪装成已执行的 repair，也不能绕过收件箱去做高风险写入、GitHub side effect、repair handoff、commit、push、PR 或 merge。

### 收件箱：管理复杂变更和审计

收件箱是反馈记录、确认边界、执行状态和审计证据的控制面。它处理那些需要被追踪、复核、同步或交给 Runtime Codex 的工作。

收件箱负责：

- 管理本地 feedback bundle、状态、优先级、筛选、批量选择、软删除和恢复。
- 确认复杂变更、外部同步、repair 启动、patch apply、commit、push、PR 等有副作用操作。
- 显示 GitHub sync trace、repair readiness、workspace writer/provider 状态、repair log evidence 和 blocked audit。
- 保留截图、refs、repair run/result/action/guidance、patch、test、browser recheck 和 human verification。
- 执行或编排复杂变更，但默认只产出 patch 和审计；commit/push/PR 必须单独确认，merge 永远不能自动执行。

## 连续体验

用户不应该被要求先选择“侧栏模式”或“收件箱模式”。体验应自然流动：

1. 用户在任意页面点选对象并描述问题。
2. 侧栏捕获上下文，澄清问题和对象关系。
3. 如果是低风险 quick action，侧栏可以立即修改并记录结果。
4. 如果需要复杂处理，侧栏保存为收件箱记录。
5. 收件箱负责后续确认、同步、repair、审计和验收。

同一条反馈可以从侧栏开始，在收件箱完成；也可以先在侧栏完成轻量修改，再把结果和证据保存到收件箱。关键是用户看到的是一条连续的反馈路径，而不是多个互相抢职责的入口。

## 安全原则

### 本地反馈是真相源

本地 feedback bundle、截图证据、GitHub sync state、repair run/result/action/guidance、patch refs 和 repair log refs 是产品真相源。GitHub issue 是协作和同步面，不取代本地记录。

每条反馈必须有稳定本地 ID。关联关系要靠 ID、bundle refs、issue number/url、repair run/result ids 和 evidence refs，而不是标题、截图文件名或可变文本。

### 证据先于叙述

反馈必须尽量捕获用户描述、目标对象快照、页面运行时上下文和截图证据。截图失败时仍可保存，但必须标为 partial evidence，并把原因显示给用户。

公开同步只能使用 scrubbed/public evidence。raw screenshot、local-only refs、token、secret、provider body 和敏感绝对路径不得进入 GitHub issue、公开 JSON 或长期报告。

### 有副作用就要确认

任何会改本地队列状态、启动 repair、上传 evidence、创建或拉取 GitHub issue、apply patch、commit、push 或创建 PR 的操作，都必须有清楚的 action-time confirmation。

确认面板要说明 destination、scope、data type、side effect 和取消后的无副作用结果。取消时不得发送外部请求、不得发送 token、不得改动本地同步缓存，也不得启动后台执行。

### Repair 必须可审计

Runtime Codex repair 是隔离执行角色，不是当前 GUI 对话的延伸。repair 输入只能来自反馈 bundle、evidence refs、repo 当前状态、固定护栏、expected tests、以及用户在收件箱中显式输入并写入 audit 的 guidance。

repair 默认在隔离 worktree/branch 中运行，记录 base commit、dirty state、protected file digest、feedback data digest、patch、test refs、repair result 和 audit。遇到 provider/env/workspace writer 问题时必须 fail closed，并写 durable blocked result。

repair log evidence 用于审计进度，不是第二个工作终端，也不能作为 fixed verdict。成功必须对应真实 patch/test/browser/human verification 证据。

### 状态必须可恢复

反馈状态、筛选、选择、批量操作、软删除、恢复、GitHub sync、repair readiness、blocked result 和 browser recheck 都必须基于本地状态机，刷新后可恢复。

删除只能软删除本地条目或取消选择，不能删除 GitHub issue、repair audit、patch、workspace diff、repair log evidence 或截图原始证据。恢复必须保留原有 refs 和 audit。

### Browser 验收优先

用户级验收优先使用 Codex in-app browser。terminal smoke、unit test、API probe 和 Playwright-style diagnostics 只能补充。

涉及反馈侧栏、收件箱或 repair 的成功声明，必须能对应到真实文件改动、命令输出、browser DOM/截图证据、人类确认或明确 blocked manifest。没有新鲜、严格的 browser evidence 时，不能把 post-repair recheck 标为 passed。

## UI 原则

- 默认展示 summary-first 信息：评论摘要、状态、优先级、证据完整度、目标摘要、截图预览和下一步。
- 复杂 refs、diagnostics、terminal、repair details、GitHub trace 和 audit 放在可展开区域。
- 截图预览是证据对象，不是装饰图；必须能打开高清图、复制 ref，并在缺失时解释原因。
- Lightbox、确认面板、按钮、筛选、批量操作、guidance input 和 repair session header 必须支持键盘和窄屏。
- 禁用按钮旁边要显示禁用原因；长 URL/ref/path 必须截断或换行，不能撑破布局。

## 回归检查

改动反馈侧栏、反馈收件箱、capture、GitHub sync 或 repair backend 后，至少检查：

1. 用户能从工作台页面和非工作台页面进入同一条反馈流程。
2. 侧栏能捕获对象、澄清问题，并把复杂变更保存到收件箱。
3. 低风险即时修改只作为侧栏 quick action 出现，并留下结果记录。
4. 收件箱能显示本地记录、证据、状态、确认边界、GitHub trace 和 repair audit。
5. GitHub body 不包含 inline `data:image/`、raw evidence、secret 或 local-only refs。
6. provider/env/writer/browser evidence 缺失时 fail closed，并写 durable blocked audit。
7. commit/push/PR confirmation boundaries 生效，merge 不会自动执行。
8. soft delete/restore 不破坏 evidence、GitHub sync state、repair audit 或 repair log refs。
9. 窄屏和键盘路径可用，截图 lightbox 能关闭并恢复焦点。
10. `git diff --check` 通过。
