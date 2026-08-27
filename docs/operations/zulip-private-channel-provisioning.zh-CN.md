# 每 Desktop 安装私人 Zulip Channel：发现、占用与验收

本文说明“用户在 Zulip Web 创建多个私人 Channel，SciForge 只发现并绑定”的最终方案。Zulip 原生手机 App 当前不能创建 Channel；用户可使用手机浏览器或电脑浏览器访问 Web 版。
同一用户即使在多台电脑连接同一个 Zulip 账号，也不能复用已被另一 Desktop 安装占用的 Channel、Topic
或固定 Session。通用备份、发布、监控和回滚仍以
[Zulip/阿里云部署手册](./zulip-aliyun-deployment.zh-CN.md)为准。

## 安全边界

- Channel 必须为私人且不是 Web public。
- Bot 通过自己的订阅列表发现 Channel；订阅响应必须包含完整成员列表。
- 成员列表必须同时包含当前已验证 Zulip 用户和 SciForge Generic Bot；缺字段、公开 Channel 或缺少任一
  成员时失败关闭。
- Topic 不是权限边界；同一 Channel 的成员可以阅读其中全部 Topic。
- SciForge Desktop 不暴露 Channel 创建、修复、归档或成员管理能力。用户在 Zulip Web 完成这些原生操作。
- Zulip 私人 Channel 不是端到端加密；受信任的服务器与组织管理员仍位于安全边界内。

## Provider 与 Server 合同

Zulip Provider 声明 provider-neutral `privateContainerDiscovery` 能力。Server 只向 Provider 传递已验证的
Endpoint identity、realm、当前 Agent installation、查询和分页游标。Provider 使用 Bot 凭据调用：

- `GET /api/v1/users/me/subscriptions?include_subscribers=true`；
- 对每个合格私人 Channel 调用 Topic 列表 API。

Provider 返回的 locator 必须带稳定 Channel ID、稳定 Topic ID和当前显示名。Server 为每页结果写入十分钟
有效的 `provider_private_container_discoveries` 证明；证明绑定 owner、Endpoint、installation、Provider、realm
和 Channel ID，不能由 Desktop 自报替代。

用户真正选择 Topic 创建 Projection 时，Server 在同一事务中：

1. 对 `(provider, realm, Channel ID)` 取得数据库事务锁；
2. 接受当前安装的 active legacy managed Channel，或核验尚未过期的 provider 发现证明；
3. 首次使用时写入 `provider_private_container_claims`；
4. 依靠唯一约束禁止另一个用户、Endpoint 或 Desktop installation 复用该 Channel；
5. 再创建精确 Topic Projection。

一个安装可以 claim 多个私人 Channel，同一已 claim Channel 可以建立多个不同 Topic Projection。发现本身不
claim Channel，避免电脑 A 刷新列表时抢占本来为电脑 B 创建的 Channel。

## 数据库与发布

schema v7 新增两张 additive 表：

- `provider_private_container_discoveries`：短期、安装级、Provider 证明的候选 Channel；
- `provider_private_container_claims`：永久安装级 Channel 占用，唯一键为 Provider + realm + Channel ID。

迁移不删除或修改旧 Projection、Provider cursor、claim、delivery 或审批记录。旧代码可以忽略新表；严格
数据库回滚仍必须把发布前备份恢复到隔离数据库并切换连接，不能手工删除生产表。

## Desktop Session 永久绑定

Desktop 本地持久化 `local_session_projection_binding`。首次把现有 Session 绑定到 Topic 时即写入；旧本地
Projection 在打开 store 时回填。无论 Projection 后续 active、paused、error 或 closed：

- 同一 runtimeId/threadId 不能再绑定另一 Topic；
- 同一 Projection 不能换到另一 Session；
- 更换手机登录身份不会清除本机绑定；
- 并发点击由串行门控收敛，最多一个云端 `projection.create`；
- UI 只有暂停/恢复和错误重试，没有解绑、关闭、恢复或换绑。

## staging 验收

使用无敏感内容的测试账号，至少验证：

1. 使用 Zulip Web 创建两个私人 Channel，并把已验证用户与 Generic Bot 加为成员；Desktop 能发现两个 Channel 的 Topic。
2. 公开 Channel、缺 Bot、缺用户或成员列表缺失的 Channel 均不可见。
3. 同一 Desktop 可以分别 claim 两个私人 Channel，并在每个 Channel 绑定多个不同 Topic。
4. 另一 Desktop 或另一手机账号即使能看到同一 Channel，也无法创建 Projection。
5. 同一 Session 的两个并发绑定请求只有第一个成功；暂停、重启与旧 closed 历史均不能换绑。
6. 两个 Topic 的手机消息分别进入固定 thread，回复返回原 Topic；Desktop 与 Collaboration 重启后不漂移或重复。
7. reaction-v1 审批、普通消息、折叠进展和最终报告链路不回归。

生产执行仍必须逐项通过数据库备份、隔离恢复、不可变 release、单服务切换、schema v7 和真实手机验收闸门。
