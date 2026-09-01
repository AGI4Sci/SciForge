## Why

SciForge 已把 Project、Task、结果、复审和 Inbox 持久化到 Cloud，但当前 Coordinator 只在 Owner 打开的 Project 页面确认 Plan 时派发无依赖任务；一个已接受结果如果解锁后续 Plan item，页面关闭或进程在 Cloud 提交后重启都会让 Project 永久停住。现在需要先补上一个 renderer-independent、可重放的最小续跑内核，供后续自动复审、HumanNeeded 和最终汇总复用。

## What Changes

- 在 `@sciforge/domain-project-coordinator` 内增加唯一的 Project continuation reconciler；它从 fresh Cloud workspace、confirmed Plan 和包内持久 Worker User assignments 推导当前 ready set，不依赖 renderer 是否挂载。
- 在运行时激活、相关 Coordinator Inbox 消息和 `accept` 复审成功后触发同一个 reconciler；重启时重新扫描可见的非终态 Project，修复“Cloud 已提交、下一步尚未派发”的中断窗口。
- 对所有依赖已完成且尚无 canonical Task 的 Plan item，通过现有 Coordinator Agent command service 和唯一 `task.offer.create` 路径创建 Offer；使用事实派生的稳定幂等键，并在每次写前重读 Project/Plan revision。
- 将 Plan item → Task ID 的确定性推导提升到 collaboration contracts 的公共函数，Cloud server 与 Coordinator 共用，禁止复制哈希规则或新增旁路 Task API。
- 本次纵切不自动接受 Worker 结果、不伪造 HumanAnswer、不自动完成 Project；pending review、HumanNeeded、recovery 和最终 summary 仍保持权威阻塞状态，后续 Agent review turn 将复用本 reconciler。

## Capabilities

### New Capabilities

- `project-coordinator-continuation`: 定义 renderer-independent Coordinator 续跑、fresh-fact ready-set 推导、稳定幂等派发和启动恢复行为。

### Modified Capabilities

<!-- None. The existing Project collaboration capability is still an active, unarchived change; this narrow behavior is specified independently. -->

## Impact

- 影响 `@sciforge/collaboration-contracts` 的 canonical identity helper、`@sciforge/collaboration-server` 对该 helper 的消费、`@sciforge/domain-collaboration` 的 Coordinator Inbox owner 路由，以及 `@sciforge/domain-project-coordinator` 的 main/runtime ports、状态与测试。
- 不增加数据库表、Cloud endpoint、renderer command、Host-private import、Provider 特例或第二套调度服务。
- 与正在开发的 Project invitation/Team provisioning 生产顺序保持正交：Project 未 `active`、Membership/Task Authority 未 ready 时，reconciler 必须零写入并等待现有 Cloud 门禁。
