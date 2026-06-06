# 反馈收件箱设计原则

最后更新：2026-06-06

## 定位

反馈收件箱是未来的反馈管理和审计界面，不是当前 P0，也不是 Agent Host。

它可以管理用户反馈、截图、refs、修复状态和审计记录，但不能绕过 Codex backend 直接规划或执行任务。

## 侧边栏 / Annotation

侧边栏负责把用户指出的问题整理成 context：

- 选区。
- 截图 / crop。
- URL / route。
- DOM / role / label / text 摘要。
- 用户原话。
- refs。

它不执行复杂修复，不判断 completion。

## 收件箱

收件箱负责：

- 管理 feedback bundle。
- 展示状态、优先级、筛选和审计。
- 展示 repair readiness、evidence refs 和 blocked reason。
- 收集高风险操作确认。

复杂执行仍由 Codex backend 拥有。

## 当前边界

- feedback / annotation 只能作为普通聊天 turn 的 refs 输入。
- 低风险即时小改动也必须遵守当前模块边界和用户级验收规则。
- commit、push、PR、merge、外部同步、patch apply 等副作用必须显式确认。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
