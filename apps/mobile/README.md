# SciForge Mobile

本目录是 SciForge 原生手机端的预留入口。目前没有可构建的手机应用；生产用户继续使用官方 Zulip
App，通过云端协作服务连接桌面 SciForge。

## 目标

未来手机端将面向分布式 Agent 协作提供原生体验，包括：

- 个人 Session 消息与最终回复；
- Project、Task、HumanNeeded 和人工回答；
- Agent 在线状态、顺序队列、离线恢复与明确错误；
- 与本地权限边界一致的审批和安全提示。

手机端直接使用版本化的 SciForge Collaboration API。身份、Session 映射、Project 状态、权限、去重
和 receipt 仍以 `@sciforge/collaboration-server` 为事实源，不在手机端复制第二套状态机。

## 开源复用方向

首选评估复用或派生 Apache-2.0 许可的
[`zulip-flutter`](https://github.com/zulip/zulip-flutter)，以利用其 Android/iOS Flutter 工程、消息界面、
编辑器、通知和平台适配经验。Zulip 仍作为可选 Human Endpoint Provider；原生手机端不应把 Zulip
Channel/Topic 数据模型固化成 SciForge 的核心合同。

在引入任何上游代码前必须：

1. 记录来源 commit，并审计 LICENSE、NOTICE、第三方依赖和素材许可；
2. 保留所有许可证要求的版权与归属声明；
3. 替换未经授权的上游名称、图标、商标和应用商店标识；
4. 使用 SciForge 自己的 bundle ID、签名、APNs/FCM 配置和隐私政策；
5. 不把密码、API Key、私钥、设备 token 或生产配置写入源码、日志、文档和 Git。

## 仓库与发布边界

- `gui` 是桌面、云端、手机端和共享合同的唯一长期主分支；
- 手机端代码放在本目录，不建立永久 mobile 分支；
- 共享协议来自 `packages/collaboration-contracts/`；
- 云端实现位于 `packages/collaboration-server/`；
- Zulip 接入位于 `packages/collaboration-provider-zulip/`；
- 手机安装包独立构建、签名和发布，但必须记录兼容的合同版本与来源 commit。

正式加入 Flutter 工程时，应先提交架构决策记录，明确采用“上游 Fork”还是“新建 Flutter Shell 并
选择性复用”，然后再把本目录注册为 workspace/build target。
