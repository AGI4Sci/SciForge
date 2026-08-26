# Content Space 本地授权包生成器

本工具为一次受控验收生成纯静态的 Content Space verification-profile domain package。
它复用既有 `main.content-space-verification-profile@2.0.0` 合同，不新增 capability、服务、
IPC、UI、Provider 或业务模块，也不会在生成时安装或激活任何授权。

## 安全边界

- 每个 profile 精确绑定 Provider Instance、完整 Principal snapshot、audience、authority/root、
  operation、transfer limits、有效时间以及必要的 Provider binding attestation。
- 有效期必须为正且最长 24 小时；已经过期的 profile 拒绝生成。
- 写操作、管理操作和非零传输仍必须携带精确 `externalBinding`。只有合同已经明确允许的零传输
  bootstrap/root-scoped read 可以省略。
- 所有生成贡献固定为 `main.extension`、版本 `2.0.0` 和
  `publicRelease: "forbidden"`。Stage 4 receipt 只接受这个精确 profile location/kind/version，
  不能再用无关的私有 contribution 冒充。
- 请求文件和输出目录必须是非 symlink 的规范真实路径；POSIX 请求文件必须为 owner-only
  (`0600` 或更严格)。输出必须尚不存在，生成器绝不覆盖；生成目录和文件分别使用
  `0700` 与 `0600`。
- CLI 只打印包身份、profile 数量和 receipt 摘要，不打印 Principal、root 或 binding 内容。

生成包仍包含敏感的授权事实。请求、输出和 receipt 都不得进入公开 PR、Release、CI artifact、
npm registry 或公共网盘。

## 请求合同

在仓库外创建一个权限受限的 JSON 文件。顶层只能有以下三个字段：

```json
{
  "contractVersion": 1,
  "packageId": "stage4-run0",
  "profiles": [
    {
      "profileId": "stage4.u0.list-containers",
      "providerInstanceRef": "provider-instance-from-installed-composition",
      "principal": {
        "authority": "authority-from-current-host-principal",
        "subject": "subject-from-current-host-principal",
        "assurance": "cloud-authenticated",
        "deviceId": "device-from-current-host-principal",
        "identityVersion": 1
      },
      "audience": "agent",
      "authority": {
        "kind": "provider-instance",
        "providerInstanceRef": "provider-instance-from-installed-composition"
      },
      "operation": {
        "family": "ordinary",
        "operation": "list-containers"
      },
      "transferLimits": {
        "maxUploadBytes": 0,
        "maxDownloadBytes": 0
      },
      "validFrom": "2099-01-01T00:00:00.000Z",
      "expiresAt": "2099-01-01T01:00:00.000Z"
    }
  ]
}
```

示例中的身份、时间和 Provider 值都是占位数据，不能复制到真实验收。必须从当前 packaged
应用的已登录 Principal、当前 Provider composition/root observation 和即时 binding attestation
取得真实值。不得从旧回执、另一台设备、另一个账号或提示词推断。

对于 `upload-new`、`download`、任何非零 transfer、administration、native write/destructive
或 extended write/destructive，profile 还必须包含：

```json
{
  "externalBinding": {
    "externalSubject": "opaque-current-provider-subject",
    "bindingRevision": "opaque-current-connection-revision"
  }
}
```

生成器直接调用当前 checkout 的权威 Zod schema，因此 operation family、operation、root shape、
Principal assurance、transfer 上限和 binding 规则不存在第二份手写兼容表。

## 生成与审查

```bash
chmod 600 '/secure/path/stage4-authorization-request.json'

npm run content-space:authorization:generate -- \
  --request '/secure/path/stage4-authorization-request.json' \
  --output '/secure/path/content-space-authorization-stage4-run0'
```

输出是一个完整但 main-only 的 trusted compile-time domain package，包含：

- `sciforge.domain.json`：唯一权威静态 contribution contracts；
- `src/main.ts`：只把完全相同的合同绑定为 runtime values；
- `authorization-package-receipt.json`：源请求摘要、逐 profile contract 摘要和逐文件 inventory；
- package 自身的 typecheck 与 contract/runtime equality test。

至少由另一位授权审查者逐项核对 manifest 中的 Principal、authority、operation、audience、
limits、validity 与 binding，并复核 receipt 摘要。生成器不会把“生成成功”当作审查成功。

## 通过标准 composition 激活

审查完成后，只能按团队批准的受控源码流程把整个输出目录作为
`packages/domains/*` 的一个直接子包加入目标 acceptance checkout，然后执行：

```bash
npm install --ignore-scripts --package-lock=false
npm run domain-packages:generate
npm run domain-packages:check
npm --workspace '@sciforge-local/content-space-authorization-stage4-run0' run typecheck
npm --workspace '@sciforge-local/content-space-authorization-stage4-run0' test
```

生成的标准 composition 差异和授权包本身必须一起评审；在 exact-commit Stage 4 流程中还必须
按受控源代码策略形成可追踪提交。不要使用 `.gitignore`、`assume-unchanged`、环境变量、Renderer
设置或运行时配置隐藏 profile。移除包后重新运行 `domain-packages:generate` 即完全移除授权。

若团队的源码远端或审查渠道不允许承载这些授权事实，停止在“已生成、未激活”状态，先建立
批准的私有审查路径；不能因此把 profile 降级为运行时 JSON 或绕过 clean/exact-commit 门禁。

## 验证生成器

```bash
npm run content-space:authorization:test
npm run architecture-principles:test
node scripts/collaboration-secret-audit.mjs
```

默认 upstream 仍不包含 active profile，因此普通构建继续保持
`poc_only / verification_profile_required`。这正是预期的 fail-closed 默认状态。
