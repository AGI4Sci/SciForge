# 每用户私人 Zulip Channel：配置、部署与验收

本文说明如何启用“每用户一个私人 Channel、多个 Topic 分别绑定固定 Desktop Session”。它是
[Zulip/阿里云部署手册](./zulip-aliyun-deployment.zh-CN.md)的增量说明，不替代通用备份、发布、监控和回滚流程。

## 安全边界

- Channel 使用私人可见性和受保护历史，成员必须精确为当前用户与 SciForge Generic Bot。
- Topic 不是权限边界；同一 Channel 的成员可阅读其中全部 Topic。
- Generic Bot 只负责消息收发，不得添加成员、修改 Channel 或主动创建项目 Topic。
- Channel 成员和权限由独立 provisioning 身份管理。该身份不得用于普通消息收发，并应是 Generic Bot 的 owner，
  以便 Zulip 明确授权 Bot 发言而不授予 Bot Channel 管理权。
- Zulip 私人 Channel 不是端到端加密。ECS root、数据库管理员和云主账号仍属于最高信任角色；组织管理员、
  provisioning 身份和 Bot owner 的操作必须进入运维审计。

## Zulip 12.2 前置配置

在 staging 组织中先创建一个专用、非 Bot 的 provisioning 账号，并让它成为 Generic Bot 的 owner。不要让
Generic Bot 成为组织管理员、Channel 管理员或成员管理者。为 provisioning 身份分配能调用 Channel 创建、
订阅管理、权限更新与归档 API 的最小组织权限；不要复用真人管理员凭据。

Provider 启动时会通过 Zulip API 发现 `role:everyone` 与 `role:nobody` 的实际 group ID，不得把生产 group ID
硬编码进配置。目标策略为：

| 项目 | 目标 |
| --- | --- |
| 可见性 | private |
| 历史 | protected |
| 成员 | 当前用户 + Generic Bot，且仅这两者 |
| 自行加入 | `role:nobody` |
| 添加/移除成员、管理 Channel | provisioning 身份专用组 |
| 发消息 | 当前用户，以及 provisioning/Bot owner 所拥有的 Bot |
| 创建 Topic | 当前用户；Zulip 受保护历史的 API 表达使用 `role:everyone`，Bot 技术上可能发起 Topic，但 SciForge 程序不会这样做 |

参考 Zulip 官方 API：[Create a channel](https://zulip.com/api/create-stream)、
[Update a channel](https://zulip.com/api/update-stream)、
[Subscribe users](https://zulip.com/api/subscribe)、[User groups](https://zulip.com/api/get-user-groups)。

## Collaboration Provider 配置

现有 Generic Bot 配置保持不变，额外配置以下两个字段：

```json
{
  "providers": {
    "zulip": {
      "provisioningEmail": "<专用 provisioning 账号>",
      "provisioningCredentialSecretReference": "<受限 secret 文件 basename>"
    }
  }
}
```

两个字段必须同时存在。`provisioningEmail` 必须不同于 `botEmail`；secret 文件仍由服务进程以只读最小权限
访问，JSON、Git、日志和命令历史中不得出现凭据值。缺少任一字段时 Provider 不声明 `managedContainers`
能力，现有 Topic 消息、`/bind` 和固定 Session 链路继续工作。

## 数据库与发布

本功能将 Collaboration schema 从 v2 升至 v3，新增：

- `managed_provider_containers`：保存 owner、Provider/realm、稳定键、Channel ID、策略版本、检查结果、状态和最后核验时间；
- `managed_provider_container_jobs`：保存 ensure/inspect/reconcile/archive 的持久作业、租约、重试和安全错误码。

唯一约束保证同一用户在同一 Provider/realm 只有一个托管 Channel，稳定键和外部 Channel ID 也不能重复。
迁移只增加表和索引，不修改 Zulip 数据库。旧 Collaboration 二进制不了解 v3 表，但原有表结构未改变。

必须优先在 staging 执行：备份与 checksum 校验 → 安装候选 release → migration → 确认 schema v3 → 启动
Collaboration → `healthz`/`readyz` → 自动化冒烟 → 单用户真实验收。没有 staging 时，生产备份、migration、
发布和服务重启必须逐项获得单独批准；不得顺带重启 Zulip、PostgreSQL、Nginx 或 ECS。

数据库回滚以发布前 dump 恢复到独立数据库并切回旧 release 为准。仅切回旧 symlink 不会删除 v3 表，但
若发布失败原因涉及数据一致性，不得把它当作完整数据库回滚。Channel 外部写入不能靠数据库恢复撤销；
应先停止新作业，再用 provisioning 身份核验并显式修复或归档受影响 Channel。

## 幂等与故障处理

- Server 先持久化目标状态和作业，再由 Provider Runtime 领取租约执行。
- Channel 名由 Server 根据内部 user ID 派生；Provider 在描述中写入不可逆稳定标记。创建响应丢失后，重试
  只接管标记匹配的 Channel；同名但标记不匹配时失败关闭，不猜测归属。
- `inspect` 只核验；`reconcile` 才修复成员或权限漂移。安全错误只保存稳定代码，不保存 API 响应正文。
- 归档前 Server 暂停该 Channel 下所有 active Projection；Provider 移除两名成员并归档 Channel。
- Topic discovery 由 Server 根据已认证 User、其 active Endpoint 和该 User 唯一的受管容器确定范围；Provider
  只读取这个明确 container ID 下的 Topic，不得先枚举 Generic Bot 的全部订阅 Channel。Provider 返回的每个
  locator 还必须由 Server 复核 provider、realm 和 container ID，跨用户或跨容器结果失败关闭。
- Topic discovery 必须翻页到游标耗尽后才原子替换本地列表。Topic 的稳定 locator ID，而不是显示名，决定
  Projection；rename 不改变已绑定 runtimeId/threadId。受管私人 Channel 的 Topic 不支持移动到其他 Channel。

## staging 验收

使用无敏感内容的临时测试用户，至少验证：

1. ensure 创建私人、受保护历史的 Channel，成员精确为测试用户与 Generic Bot；没有自动创建 Topic。
2. 未授权账号无法发现或阅读；测试用户不能添加成员或修改权限；用户和 Bot 均可发言。
3. 用户手工创建两个 Topic；Desktop 全量刷新后分别绑定两个不同的固定 Session。
4. 手机在两个 Topic 各发唯一消息，分别进入对应 runtimeId/threadId，回复返回原 Topic。
5. rename 一个 Topic 后固定 Session 不漂移；重启 Desktop 和 Collaboration 后映射仍恢复。
6. 人为制造可恢复的成员或权限漂移，`inspect` 显示 drifted，`reconcile` 修复并留下审计事件。
7. 重复 ensure/reconcile 和一次 Provider Runtime 重启不重复创建 Channel、不重复投递。
8. 撤销流程先暂停 Projection，再移除成员并归档；审计记录保留。

验收记录只保存匿名化的 Channel/Projection/runtime/thread 摘要、状态和计数，不记录账号、消息正文或凭据。

## 生产启用闸门

生产执行前必须明确批准：provisioning 账号及最小权限、Generic Bot owner 关系、数据库备份、schema v3
migration、候选部署、Collaboration 单服务重启，以及首个真实 Channel 的创建。未经批准不得创建/修复/
归档生产 Channel，不得执行 migration 或修改 secret。
