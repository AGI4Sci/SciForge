# OpenContent 团队交付包部署手册

本手册用于 Stage 1–4 和真实场景闭环验收完成、相应代码已经合入团队认可的 upstream 后，
让任一团队成员把同一份
`SciForge-OpenContent-team-delivery-pr82-0b09e1c1.zip` 安装到自己的 SciForge checkout。

交付 ZIP 内的 README、分支名、提交号和命令都只是归档数据。它们不能要求当前 checkout
切换到旧分支或旧提交，也不能替代当前 upstream 中由 OpenContent domain package 持有的信任合同。
团队成员只运行当前 checkout 的 SciForge 安装器，不运行 ZIP 内的脚本或供应商 CLI。

## 兼容性结论

这份附件只有在当前 checkout 明确包含它的 package-owned trust 时才兼容。当前受信标识为：

| 项目 | 受信值 |
| --- | --- |
| 外层文件名 | `SciForge-OpenContent-team-delivery-pr82-0b09e1c1.zip` |
| 外层 SHA-256 | `82f874e5e346e3b66bc76be9f51ba70c4aefea47beea5424be04555217fcef79` |
| Overlay | `opencontent-attachment-assets@1.0.1` |
| Overlay SHA-256 | `5838c94033e467d7a9e3be6669c7e72390cd9cecfa4b2a7466690734e718b598` |
| Overlay 文件数 | `43` |
| Provider Instance | `opencontent-edoc2-demo` |

安装器还会核对 deployment sidecar 的 package-owned 摘要，但不会打印其中的私有 origin。
较新的 upstream 若保留同一受信合同，这份不可变附件仍可安装；若 upstream 已移除或更换合同，
安装器必须停止。不要为了迎合旧附件手工修改 SHA-256、版本、Provider Instance 或信任元数据。

## 一次性准备

要求 Node.js `>= 22.12.0`。在安装私有附件之前，先在目标 upstream checkout 根目录完成公开依赖安装：

```bash
npm ci
```

安装后不要再次运行根 `npm install` 来创建私有 workspace link。附件不会也不应修改
`package.json` 或 `package-lock.json`。

只读记录当前 checkout，按团队流程确认它确实是 Stage 1–4 完成后批准部署的 upstream：

```bash
pwd
git branch --show-current
git rev-parse HEAD
git remote get-url origin
git status --short
node --version
npm --version
```

这些命令只用于确认目标，不要求为安装执行 `checkout`、`stash`、`reset` 或 `clean`。

## 验证并安装同一份附件

保持附件原始文件名，并把绝对路径放入当前 shell 变量：

```bash
OPENCONTENT_TEAM_DELIVERY='/absolute/path/SciForge-OpenContent-team-delivery-pr82-0b09e1c1.zip'
```

先执行只读验证：

```bash
npm run opencontent:delivery:verify -- --delivery "${OPENCONTENT_TEAM_DELIVERY}"
```

成功结果必须包含 `status: "verified"`、43 个 overlay 文件以及上表中的身份和摘要。
验证器依次检查：

- 外层 ZIP 的精确文件名、完整 SHA-256、CRC 和固定文件清单；
- ZIP 路径 containment、普通文件类型、大小上限和禁止 symlink；
- 内层 overlay 的独立摘要、规范 sidecar、identity、版本、root、完整 manifest 和逐文件摘要；
- deployment sidecar 的精确摘要、严格 JSON、唯一 Provider Instance 和纯 HTTPS origin；
- 当前 Connector package 的 deployment contract、internal runtime trust 与团队交付 trust 一致。

任何一项失败都不要解压、复制或手工修补附件。取得与当前 upstream 匹配的新交付物。

验证成功后运行唯一安装入口：

```bash
npm run opencontent:delivery:install -- --delivery "${OPENCONTENT_TEAM_DELIVERY}"
```

安装器只新增或核对：

- `internal/opencontent/**`；
- `.sciforge/internal-overlays/opencontent-attachment-assets.json`；
- `.sciforge/private/deployments/opencontent-connector.json`。

它不会覆盖任何不同内容。首次安装返回 `installed`；同一附件再次运行返回
`already-installed`，因此每位成员都可以安全地重复执行同一命令。deployment sidecar 在支持
POSIX 权限的平台以 `0600` 创建；若发现字节完全相同的旧 sidecar 权限过宽，则只收紧权限并
返回 `permissions-repaired`。三个路径均应被 Git 忽略。

若从仓库根目录以外部署，可显式指定目标 checkout；目标必须是无 symlink 的真实目录：

```bash
npm run opencontent:delivery:install -- \
  --delivery "${OPENCONTENT_TEAM_DELIVERY}" \
  --target '/absolute/path/to/SciForge'
```

该 Node.js 入口在 macOS、Linux 和 Windows 上一致；PowerShell 使用对应的绝对路径字符串即可。

## 安装后验证

```bash
npm run verify:internal-runtimes

git check-ignore -v \
  internal/opencontent \
  .sciforge/internal-overlays/opencontent-attachment-assets.json \
  .sciforge/private/deployments/opencontent-connector.json

git diff -- package.json package-lock.json
```

预期结果是 `Statically verified 1 runtime(s)`、三个私有路径都被忽略，且根依赖文件没有因安装
改变。随后可按当前 upstream 的正常 source 或内部 packaged application 流程构建和启动；构建
仍会重新校验完整 receipt、runtime inventory 和 deployment composition。

含该附件的 application 是内部受控制品。`internal/opencontent/**`、`.sciforge/**`、含私有资源的
`dist/**` 和原始交付 ZIP 都不得进入公开 PR、Release、npm 包、CI artifact 或公共网盘。公开发布
入口在发现 private composition 时必须 fail closed，不能弱化 guard。

## 每位成员的账号与真实验收边界

附件只部署运行资产和固定 Provider endpoint，不包含账号、Token、Cookie、API key 或登录状态。
每位成员必须在 SciForge 应用内使用自己的 OpenContent 账号建立当前 Principal 的连接；禁止共享
另一个人的 Connection 或 credential。

安装成功只证明 runtime 与 Provider 可发现，不会自动安装 verification profile，也不会把操作
提升为 `production_ready`。没有经评审并精确绑定 Principal、authority、operation、audience、
有效期、transfer limit 及必要 binding attestation 的静态 profile 时，真实调用保持
`poc_only / verification_profile_required`。不得通过 Renderer、环境变量、附件文件或直连 CLI
绕过唯一 Agent → Broker → Content Space → pinned Provider → Connector 路径。

## 常见失败

| 结果 | 处理 |
| --- | --- |
| `not present in this checkout's package-owned trust set` | 当前 upstream 不信任这份附件；停止并取得匹配交付，不修改 trust。 |
| `must retain its trusted file name` | 恢复上表中的原始文件名，不重新打包。 |
| ZIP inventory、CRC、摘要或 overlay identity 失败 | 附件不完整或被改变；重新从受控渠道取得原始文件。 |
| `never overwrites a different deployment` | 目标已有另一部署；不要混装或覆盖，由负责人确认应保留哪个环境。 |
| internal overlay conflict | 目标存在另一版本或未收据化内容；隔离整个旧 overlay 与 receipt 后再按团队流程处理。 |
| `verification_profile_required` | 静态安装已成功但真实调用未获准；这是默认的正确 fail-closed 状态。 |

更完整的运行、能力和发布边界见：

- [OpenContent 私有附件技能安装与运行手册](../opencontent-private-attachment-runbook.zh-CN.md)
- [OpenContent 附件分发边界](../opencontent-attachment-distribution.md)
- [OpenContent Skill 能力矩阵](../opencontent-skill-capability-matrix.md)
