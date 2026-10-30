# 多用户协作需求

> 本文档只包含纯合成数据。验收过程不得把 fixture label 或用户数量硬编码进产品实现。

## 业务需求

- User 是动态的；每个非终态 Project 必须有且只有一个精确 Coordinator Agent。
- Coordinator Human 通过 HCI 查看由 Worker availability 聚合的 User 列表，最终选择值必须是 Worker User ID；Agent/Device 只是可派发证据。
- 所有 Agent Device 仅支持 Human 手动接单，升级清理旧 automatic 配置；全局拒绝与本地忽略继续独立。
- Cloud 向 Worker User 的所有有效已注册 Agent Device 持久投递同一 Offer，覆盖离线设备和有效期内新增的设备；原子 claim 校验身份、设备归属、Membership、Task 授权和内容权限。Runtime 和实际 Task capability 在执行前检查；已领取但未就绪时等待原设备恢复。
- 单台 Device 的 local dismiss 不得关闭 User Offer。Coordinator withdraw/reassign 后才创建新 User Offer；execution 只在成功 claim 时创建，旧 execution 不得写回。
- 三项结果通过复审后，Coordinator 以 `coordinator_project` 发起一次 HumanNeeded；只有 Project Owner 的 OIDC Human 可回答。Worker execution HumanNeeded 只在 focused/recovery tests 覆盖，不进入本次 live happy path。
- 结果必须经 Coordinator 复审；request revision 会产生新的当前 execution/revision。

## 文件需求

- 每个参与文件任务的 Human 先在自己 Desktop 绑定 OpenContent，然后发布非秘密 Provider Directory Principal Fact。
- Project 创建时原子保存 explicit members、content owner、exact principal fact revisions 和 provisioning intent。
- Owner Desktop 通过真实 Content Space 逐项创建 shared container、添加成员并重新读取完整成员集。
- Provider metadata 只验证定位和层级；下载必须先通过真实 DownloadCheck，上传必须到达真实 no-overwrite Provider write。
- 生产路径缺少 Provider binding 时必须 fail closed，不得使用 Mock 或 fallback。

## 恢复需求

默认 24h Offer 只允许 Coordinator 显式延期，重连和重试不延长。完全离线的手动接受先保存“接受待同步”，Cloud 确认前不运行。

验收必须覆盖离线接受、accept 后重启、Inbox refill、重复 offer/ACK、Device revoke、Coordinator transfer、Provider member removal 和 outcome_unknown 人工恢复；没有证据的项不得记为通过。
