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

## 通过隔离的标准 build composition 使用

授权事实不得复制进公开 checkout。审查完成后，把仓库外 package 的规范绝对路径显式交给
Stage 4 artifact builder：

```bash
npm run stage4:artifact:mac:arm64 -- \
  --private-domain-package '/secure/path/content-space-authorization-stage4-run0'
```

builder 仍要求当前源码 worktree 干净、HEAD 已推送且与 `git ls-remote` 返回的同名远端分支
完全一致。它先验证 package 根目录和全部子目录/文件均为 owner-only，拒绝相对路径、非规范
路径、symlink、硬链接、额外文件、越界结构和非 canonical generator bytes；随后使用当前 exact
commit 的 Domain SDK manifest schema 与 Content Space verification-profile schema，重验 profile
有效期、main-only entrypoint、`publicRelease: "forbidden"` 和逐文件 receipt inventory。

验证通过的 bytes 只复制到本次创建、权限为 `0700` 的系统临时 build workspace 中，成为该
workspace 的 `packages/domains/*` 子包。之后调用唯一的 `scripts/domain-packages.mjs` discovery/
generated-composition 路径，再在同一隔离 workspace 中完成 source build 与 Electron packaging。
workspace installer 完成后，builder 只清除该临时 package 副本下明确的 package-local
`node_modules` installer state（该路径若为 symlink 则拒绝而不跟随），再把已知 staging 路径
重新封为目录 `0700`、文件 `0600`，然后再次执行完整 package verifier；原始外部 package 不会
被 chmod 或修改，除此之外的新增文件、链接或 byte drift 仍然 fail closed。
隔离 checkout 不继承当前工作树的 ignored workspace build outputs；builder 会先在临时 workspace
调用既有 `build:agent-support` 公共脚本，再进入 canonical `npm run build`，因此 source composition
不依赖调用者机器上残留的 `dist` 或测试状态。
它不会修改受 Git 管理的生成文件，不会安装或激活原始 package，也不增加运行时 JSON、环境变量、
Renderer 设置或第二套 composition。结束时只删除本次明确创建的临时 workspace；原始私有 package
和任何用户目录都不删除。

缺少 `--private-domain-package` 时 builder 在公共 CLI 边界保持
`verification_profile_required` fail closed。无效、过期或已漂移的 package 同样在 Electron
Builder 启动前失败。不要用 `.gitignore`、`assume-unchanged`、伪造 remote ref 或隐藏未跟踪
文件把授权事实塞进源码树。

正式 architecture gate 必须再次提供同一外部 package，并从原路径重新校验其当前 bytes 和
有效期，再与 sealed artifact receipt 中的脱敏摘要逐字节比较：

```bash
npm run architecture-principles:gate -- \
  --packed-artifact '/absolute/path/SciForge-<version>-mac-arm64.zip' \
  --artifact-receipt '/absolute/path/stage4-artifact-mac-arm64.json' \
  --packaged-executable-locator 'SciForge.app/Contents/MacOS/SciForge' \
  --private-domain-package '/secure/path/content-space-authorization-stage4-run0'
```

公开 artifact/architecture receipt 对每个外部私有包只记录 package name、version、package
SHA-256、`verification-profile-verified` 状态和 `external-local-package` 脱敏 provenance；不记录
package 路径、profile/contribution ID、Principal、Device、binding 或 Provider credential。

## 验证生成器

```bash
npm run content-space:authorization:test
npm run architecture-principles:test
node scripts/collaboration-secret-audit.mjs
```

默认 upstream 仍不包含 active profile，因此普通构建继续保持
`poc_only / verification_profile_required`。这正是预期的 fail-closed 默认状态。
