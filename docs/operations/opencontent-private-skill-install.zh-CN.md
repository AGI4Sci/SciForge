# OpenContent 私有技能包安装手册

## 先确认两件事

1. **没有安装 `opencontent-base`，也能使用 SciForge 的 OpenContent
   Provider。** Provider 的选择、个人库/团队库浏览、普通文件操作和已经声明的
   Team 能力走 SciForge 自己的 Broker → Content Space → Provider → Connector
   路径。用户仍需使用自己的 SciForge 身份、自己的 OpenContent 连接以及对应的
   Provider 权限，但不需要任何技能包或静态 verification profile。
2. **`opencontent-base` 是可选的 Agent 增强包。** 它增加面向 Agent 的操作说明和
   私有 CLI，方便使用更多 OpenContent 功能。安装它不会注册 Provider、创建连接、
   提升 readiness、授予权限或激活 Connector 的可选 supplier runtime；卸载它也不会
   让 Content Space 中的 OpenContent Provider 消失。

本手册适用于团队成员从任意完成 Stage 1–4 并包含通用私有技能安装器的 SciForge
版本部署私有 ZIP。ZIP 字节不得进入 GitHub、公开 npm 包或公开发行物。

## 交付方需要发送什么

通过受控的私有渠道分别发送：

- 原始技能 ZIP；
- 该 ZIP 的 SHA-256 摘要；
- 本手册，或包含同样命令的团队安装说明。

ZIP 和摘要最好不要放在同一条消息中。不要发送 `.env`、API Key、Token、密码或
任何其他用户的凭据。每位接收者必须使用自己的 OpenContent 账号与权限。

交付方可在发送前执行只读校验：

```bash
cd /absolute/path/to/SciForge
npm run private-skill:verify -- \
  --archive "/absolute/path/to/opencontent-base.zip" \
  --expected-sha256 "<发送方提供的64位SHA-256>"
```

成功输出会包含技能名、版本、文件数、总大小和 ZIP 摘要；校验器不会解压到仓库，
也不会执行 ZIP 内脚本。

## 接收方安装

先确认当前 SciForge 工作区是要使用该技能的 Workspace，然后从该 SciForge 源码根
目录执行：

```bash
cd /absolute/path/to/SciForge
npm run private-skill:install -- \
  --archive "/absolute/path/to/opencontent-base.zip" \
  --workspace "/absolute/path/to/target-workspace" \
  --expected-sha256 "<发送方提供的64位SHA-256>"
```

成功时状态为 `installed`，目标为：

```text
/absolute/path/to/target-workspace/.codex/skills/opencontent-base/
```

同一 ZIP 再次安装会返回 `already-installed`，不会产生第二份副本。目标目录已经存在
但没有 SciForge 回执、内容被修改、或摘要不同，安装器会拒绝覆盖；先由接收方确认
旧目录的来源并手工备份/移走，不能用强制覆盖绕过校验。

安装器会拒绝目录穿越、符号链接、CRC 错误、超限压缩包、重复文件、缺少根
`SKILL.md`、不安全的技能名，以及 ZIP 中携带 `.env` 或其他运行时凭据。它只允许
无秘密的 `.env.example` 模板。

## 配置接收方自己的凭据

SciForge Provider 使用 Connector 管理的当前用户连接，不读取技能包内的共享凭据。
如果只使用 Content Space Provider，不需要为该技能创建 `.env`。

如果接收方明确要使用技能自带的直接 CLI，并且运行环境没有注入所需配置，可在已
安装技能目录中根据 `.env.example` 创建本机 `.env`，只填写接收方自己的站点与
API Key：

```bash
cd "/absolute/path/to/target-workspace/.codex/skills/opencontent-base"
cp .env.example .env
```

随后由接收方在本机编辑 `.env`。`.env` 已被仓库忽略，但仍不得提交、发送、截图或
复制给其他用户。不要把甲方、管理员或交付方凭据预装进 ZIP。

## 发现与验收

安装后重新打开该 Workspace，或新建一次 Agent 会话以触发技能重新发现。验收应分成
两个彼此独立的场景：

1. 临时使用一个未安装该技能的干净 Workspace，登录用户自己的账号并建立
   OpenContent 连接；确认 Content Space 中可以选择 OpenContent，并完成一次有权限的
   个人库或团队库读取。
2. 对另一个干净 Workspace 执行上述安装命令；确认 SciForge 发现
   `opencontent-base`，再由同一用户使用自己的配置完成一个技能说明中支持的只读
   操作。安装失败不得影响第 1 个场景的 Provider 使用。

这两个场景同时通过，才证明“Provider 无技能也可用”和“私有技能收到后可部署”两个
目标均已闭环。

当前甲方提供的 `opencontent-base` 样包已经完成不执行脚本的真实 ZIP 校验、安装、幂等
复装与标准 skill 发现；脱敏回执见
[OpenContent private Agent skill package acceptance](./opencontent-private-skill-real-package-acceptance.md)。

## 常见失败

| 现象 | 处理 |
| --- | --- |
| `SHA-256 does not match` | 停止安装，重新向交付方核对原始 ZIP 和独立摘要。 |
| `must not contain runtime credentials` | 交付包混入了 `.env`；由交付方清理并重新出包，不能放宽校验。 |
| `already exists with different or unreceipted bytes` | 目标技能目录有旧包或手工文件；先确认并备份来源，再安装。 |
| Provider 可见但调用失败 | 检查私有 Provider deployment configuration、当前用户连接、Provider ACL 与网络；这与技能是否安装无关。 |
| 技能未被发现 | 核对 `--workspace` 是否是当前 Workspace，并重新打开 Workspace/新建会话。 |
| 技能 CLI 认证失败 | 只检查接收方自己的本机配置和账号权限，不复制其他人的凭据。 |
