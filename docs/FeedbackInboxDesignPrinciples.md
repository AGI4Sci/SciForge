# 反馈收件箱设计原则

最后更新：2026-06-07

## 文档目的与约束

这份文档只记录反馈收件箱本身的最新设计原则和沟通口径，目标是让人类和 agent 读完后能快速理解反馈收件箱是什么、能做什么、不能做什么。

原则约束：

- 保持简洁，避免把文档写成 UI spec、数据库 schema 或测试用例。
- 文档只描述反馈收件箱自身的稳定边界、证据原则、审计原则和迁移原则。
- 外部系统只在解释边界时短提，不展开外部编排、模型路由或产品工作流设计。
- 精确字段、bundle schema、renderer、storage 和测试真相源应放在未来对应 package / UI implementation / tests。
- 如果实现细节变复杂，优先更新 contract 和测试；本文件只补能帮助沟通和理解需求的原则。

## 定位

反馈收件箱是反馈管理、证据整理和审计界面，不是任务编排器，不是 repair agent，也不是任务执行器。

反馈收件箱只负责：

- 收集和整理用户反馈。
- 管理 feedback bundle、refs、截图 / crop、annotation 和用户原话。
- 展示状态、优先级、来源、审计记录、repair readiness 和 blocked reason。
- 收集高风险操作确认。
- 让用户和 agent 更容易追踪“问题是什么、证据在哪里、当前状态是什么”。

反馈收件箱不负责：

- 理解完整用户任务。
- 自动规划修复。
- 执行 patch、commit、push、PR、merge 或外部同步。
- 判断 completion truth。
- 生成 final answer。
- 绕过当前模块边界或用户级验收规则。

## 输入与证据边界

反馈收件箱只接受 refs-first feedback evidence。

可记录的对象：

- 用户原话。
- 选区和 annotation refs。
- screenshot / crop refs。
- URL / route / artifact refs。
- DOM / role / label / text 摘要 refs。
- 关联 run / trace / blocked reason refs。
- priority、status、owner、audit metadata。

不能记录的对象：

- raw screenshot/base64。
- raw DOM 大 payload。
- secret / token / API key。
- 未脱敏 provider payload。
- 可直接执行的隐藏 action。

## Annotation 原则

Annotation 负责把用户指出的问题变成可审计 context。

它可以提供：

- 选区。
- 截图 / crop refs。
- 可见文本摘要。
- 用户评论。
- 关联 artifact 或 UI surface refs。

它不能执行复杂修复，不能判断 completion，也不能把截图 replay 当成产品 truth。

## 收件箱原则

收件箱负责管理反馈生命周期：

- open / triaged / blocked / ready / resolved / archived 等状态。
- 优先级、标签、来源和 owner。
- evidence refs 和 audit refs。
- repair readiness 和 blocked reason。
- high-risk confirmation request。

状态变更必须可审计。状态展示不能替代真实修复、验证或用户级验收。

## 风险与确认

反馈收件箱可以收集确认，但不能自己执行高风险副作用。

必须显式确认的典型动作：

- patch apply。
- commit / push / PR / merge。
- 外部同步。
- 删除反馈、删除 artifact 或改变权限。
- 向外部渠道发送消息或上传文件。

确认结果只作为 approval evidence；真实动作由对应模块或调用方执行。

## 迁移口径

迁移目标：

- feedback / annotation 只作为 refs-first context，不作为独立任务入口。
- 低风险即时小改动也必须经过当前模块边界和用户级验收规则。
- 收件箱只管理反馈与审计，不拥有 repair loop。
- 历史截图、projection、fixture 和旧 run 只能作为诊断材料。

## 契约真相源

反馈收件箱尚未作为当前 P0 独立实现。未来如果落地，长期 contract、bundle schema、renderer、storage 和测试应放在对应 package / UI implementation / tests 中。

本文件只保留设计原则和迁移口径。

## 相关文档

- [`TuiGuiProtocol.md`](TuiGuiProtocol.md)：GUI 输入、展示和确认边界。
- [`ComputerUseRuntimeArchitecture.md`](ComputerUseRuntimeArchitecture.md)：截图、窗口和动作 evidence 边界。
- [`Architecture.md`](Architecture.md)：总架构和反馈收件箱上下游边界。
