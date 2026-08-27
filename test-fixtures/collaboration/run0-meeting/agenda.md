# 多用户协作设计评审会议程

> 本文档只包含纯合成数据，用于 SciForge Run-0 验收，不对应任何真实组织、人员或项目。

## 会议目标

在 60 分钟内完成设备协作架构评审，形成架构建议、会议纪要和风险登记表。会议采用单一 Coordinator 和多个 Worker，任务必须指派到精确 Agent。

## 议题

1. 身份、Device、Agent 与 Project 角色的边界。
2. Cloud 任务状态与真实 Content Space 文件权限的分离。
3. Worker 拒绝后改派、HumanNeeded 与 Owner 回答。
4. 结果复审、修订与项目完成。
5. 断线、重启、旧 execution fencing 和外部写不确定的恢复。

## 需要决策

- 是否同意以 OIDC User 为 Owner，以精确 Agent 为 Coordinator/Worker。
- 是否同意 Project Membership、Provider Membership 和 Task authority 独立建模。
- 是否同意所有文件任务都在执行节点用当前 Provider session 重新授权。

## 输出门禁

三份输出必须由 Worker 的真实 Runtime 生成，上传到 Project Content Directory，并经 Coordinator 复审。至少一份直接接受，至少一份要求修订后再接受。
