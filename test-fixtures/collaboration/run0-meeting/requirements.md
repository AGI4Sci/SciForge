# 多用户协作需求

> 本文档只包含纯合成数据。验收过程不得把 fixture label 或用户数量硬编码进产品实现。

## 业务需求

- User 是动态的；每个非终态 Project 必须有且只有一个精确 Coordinator Agent。
- Coordinator Human 通过 HCI 按 User 分组查看 Worker availability，但最终选择值必须是精确 Agent ID。
- 每个 Agent Device 本地独立保存 manual 或 automatic 接单策略；Cloud 不保存策略字段。
- Worker 只能在本机 Device、Runtime、Membership、Provider readiness 和 execution fence 都通过时接单。
- 拒绝后改派必须创建新 execution，旧 execution 不得写回。
- Worker 可创建 HumanNeeded，但只有 Project Owner 的 OIDC Human 可回答。
- 结果必须经 Coordinator 复审；request revision 会产生新的当前 execution/revision。

## 文件需求

- 每个参与文件任务的 Human 先在自己 Desktop 绑定 OpenContent，然后发布非秘密 Provider Directory Principal Fact。
- Project 创建时原子保存 explicit members、content owner、exact principal fact revisions 和 provisioning intent。
- Owner Desktop 通过真实 Content Space 逐项创建 shared container、添加成员并重新读取完整成员集。
- Provider metadata 只验证定位和层级；下载必须先通过真实 DownloadCheck，上传必须到达真实 no-overwrite Provider write。
- 生产路径缺少 Provider binding 时必须 fail closed，不得使用 Mock 或 fallback。

## 恢复需求

验收必须覆盖 accept 后重启、Inbox refill、重复 offer/ACK、Device revoke、Coordinator transfer、Provider member removal 和 outcome_unknown 人工恢复；没有证据的项不得记为通过。
