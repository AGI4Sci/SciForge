# 反馈收件箱设计原则

最后更新：2026-05-24

这套产品模型只有一个核心：侧边栏说清楚问题，收件箱处理需要被管理和审计的工作。它们不是两个互斥模式，也不是全局排队的同一条对话。

## 角色分工

### 侧边栏：说清楚问题和对象关系

侧边栏是用户指出问题后的第一现场。它负责把“这里不对”整理成一条清楚、可保存、可交接的反馈：

- 捕获被点选对象、页面位置、截图、URL/route、viewport、DOM/role/label/text 摘要和用户原话。
- 通过简短问答澄清问题、对象关系、期望结果和验收标准。
- 展示即将保存的反馈草稿，让用户确认、补充或放弃。
- 在风险足够低时提供即时小改动。

即时小改动不是独立模式，也不是绕过收件箱的 repair。它只是侧边栏里的低风险快捷动作，适合文案微调、局部样式修正、非破坏性属性调整这类影响范围小、可解释、可回退、无需跨文件推理和外部同步的改动。

只要动作需要复杂判断、跨文件修改、GitHub 同步、Runtime Codex repair、批量处理、patch apply、commit、push、PR 或 merge，就不应留在侧边栏执行。

### 收件箱：管理、确认、审计和复杂执行

收件箱是反馈记录和执行状态的控制面。它负责处理需要追踪、复核、同步、审计或交给 Runtime Codex 的工作：

- 管理本地 feedback bundle、状态、优先级、筛选、批量选择、软删除和恢复。
- 对有副作用的操作做 action-time confirmation，例如外部同步、repair 启动、patch apply、commit、push 和 PR。
- 显示 GitHub sync trace、repair readiness、workspace writer/provider 状态、repair log evidence 和 blocked audit。
- 保留截图、refs、repair run/result/action/guidance、patch、test、browser recheck 和 human verification。
- 编排复杂变更，但默认只产出 patch 和审计；commit、push、PR 必须单独确认，merge 永远不能自动执行。

## 并行 Lane 模型

右侧注释栏、主聊天，以及未来多个主工作台对话，应该是并行 lane。它们可以同时存在、各自推进、各自显示状态，不能因为另一个 lane 正在回答或执行就全局排队。

排序边界只存在于同一条会话内部：同一 lane 里的消息、确认和执行必须按顺序处理；不同 lane 之间只共享必要的持久状态，例如 feedback bundle、evidence refs、repair result 和 workspace diff。

这意味着：

- 右侧注释栏可以继续澄清当前对象，不必等待主聊天完成。
- 主聊天可以继续解释、总结或处理其他任务，不必阻塞注释栏。
- 未来多个主工作台对话可以各自拥有会话顺序，但不能抢占彼此的队列。
- 如果多个 lane 指向同一条反馈或同一处 workspace 改动，冲突解决应发生在持久状态层，而不是靠全局禁用对话输入。

## 不再使用的边界

不再把产品拆成“侧边栏模式”和“收件箱模式”。正确边界是任务风险和审计需求：

- 需要说明问题和对象关系：在侧边栏。
- 能安全即时完成的小改动：在侧边栏作为快捷动作。
- 需要确认、追踪、审计、同步或复杂执行：进收件箱。
- 需要 repair runner：必须从收件箱进入，并写入可恢复的 audit。

不再把右侧注释栏和主聊天当成同一条消息队列。它们共享产品状态，但不共享对话顺序。

## 安全底线

- 本地 feedback bundle、截图证据、sync state、repair refs、patch refs 和 audit refs 是真相源；GitHub issue 只是协作和同步面。
- 每条反馈必须有稳定本地 ID，关联关系要靠 ID 和 refs，不能靠标题、截图文件名或可变文本。
- 公开同步只能使用 scrubbed/public evidence；raw screenshot、local-only refs、token、secret、provider body 和敏感绝对路径不得外发。
- 有副作用就必须确认。取消确认时不得发送外部请求、不得发送 token、不得改本地同步缓存，也不得启动后台执行。
- Runtime Codex repair 是隔离执行角色，输入必须来自反馈 bundle、evidence refs、repo 当前状态、固定护栏、expected tests 和用户显式写入 audit 的 guidance。
- 成功声明必须对应真实 patch、测试、browser evidence、人类确认或明确 blocked manifest。

## 回归检查

改动反馈侧边栏、收件箱、capture、GitHub sync 或 repair backend 后，至少检查：

1. 用户能从工作台页面和非工作台页面进入反馈流程。
2. 侧边栏能捕获对象、澄清对象关系，并保存复杂反馈。
3. 低风险即时小改动只作为侧边栏快捷动作出现，并留下结果记录。
4. 收件箱能显示本地记录、证据、状态、确认边界、GitHub trace 和 repair audit。
5. 右侧注释栏和主聊天互不全局排队；同一会话内部仍保持顺序。
6. GitHub body 不包含 inline `data:image/`、raw evidence、secret 或 local-only refs。
7. provider/env/writer/browser evidence 缺失时 fail closed，并写 durable blocked audit。
8. commit/push/PR confirmation boundaries 生效，merge 不会自动执行。
9. soft delete/restore 不破坏 evidence、GitHub sync state、repair audit 或 repair log refs。
10. `git diff --check` 通过。
