# 领域扩展打包与签名

本文定义 `kind: "sandboxed-runtime"` domain package 的可分发 artifact。架构与贡献规则见 [领域 Package 与扩展架构](./domain-package-architecture.zh-CN.md)。

第一阶段只接受 SciForge 官方 Ed25519 keyring 中的签名，但格式不把“官方”写进 package manifest。签名验证结果和发布者信任属于 Host 安装记录；未来第三方使用相同 artifact 和 manifest 合同。

## 源 package

源目录至少包含：

```text
package.json
sciforge.domain.json
dist/main.js             # manifest 声明 main 时
dist/renderer/index.html # manifest 声明 renderer 时
```

`package.json` 的 `name` 和 `version` 必须分别等于 manifest 的 `packageName` 与 `module.version`。`files` 是非空的运行时 payload allowlist；`package.json` 和 `sciforge.domain.json` 始终隐式包含。打包器不收集 `node_modules`、版本控制目录、日志、临时文件、`META-INF`、私钥材料或 allowlist 外文件。

安装包必须预构建、自包含。任何嵌套 `package.json` 都不能声明以下 lifecycle script：

```text
preinstall, install, postinstall, prepare,
prepublish, prepublishOnly, postpublish
```

安装器不会运行 package manager，也不会补依赖。每个 manifest entrypoint 必须已经存在于签名 payload 中。

## Artifact 格式

扩展名为 `.sciforge-plugin`，内容是确定性 ZIP：

```text
<signed payload files>
META-INF/sciforge-integrity.json
META-INF/sciforge-signature.json
```

路径必须是规范的 package 相对 POSIX 路径，不允许绝对路径、`\`、`.`、`..`、空片段、符号链接、非普通文件、重复路径，或在 Unicode NFC + 不区分大小写文件系统上冲突的路径。ZIP 不允许加密、多磁盘、ZIP64、尾随数据和未声明 metadata。Host 对压缩大小、解压大小、单文件大小和文件数量设置硬上限。

### 完整性 manifest

`META-INF/sciforge-integrity.json` 是无尾随换行的 canonical UTF-8 JSON。对象键递归按 Unicode code point 排序；数组保持顺序。结构固定为：

```json
{
  "files": {
    "dist/main.js": "<lowercase-sha256-hex>",
    "package.json": "<lowercase-sha256-hex>",
    "sciforge.domain.json": "<lowercase-sha256-hex>"
  },
  "packageName": "@sciforge/domain-example",
  "publisherId": "sciforge",
  "schemaVersion": 1,
  "version": "1.0.0"
}
```

`files` 必须以词典序逐项列出除两个 `META-INF` 文件外的**全部且仅有** payload 文件，每项值是文件原始 bytes 的 SHA-256 小写十六进制摘要。添加未声明文件、遗漏文件或修改任一 byte 都会使安装失败。

### Detached signature

`META-INF/sciforge-signature.json` 结构固定为：

```json
{
  "algorithm": "ed25519",
  "keyId": "sciforge-release-2026",
  "schemaVersion": 1,
  "signature": "<canonical-base64>"
}
```

`signature` 是对 `sciforge-integrity.json` **精确 bytes** 的 Ed25519 detached signature，canonical base64 解码后固定为 64 bytes。Host 用 `keyId` 从自身官方 keyring 取公钥，并检查该 key 绑定的 publisher 与完整性 manifest 的 `publisherId` 相同。随后再检查该 publisher、package 和 version 与 package manifest、domain manifest 一致。

manifest 中的 `publisher.id` 是签名所绑定身份的声明，不是公钥、证书或 trust flag。artifact 不能携带并选择自己的信任根。

## 官方打包与离线验证

仓库工具从 `package.json.files` 收集 payload、验证 sandbox manifest 和 entrypoint、生成完整性 manifest，再用 Ed25519 私钥签名：

```bash
node scripts/extension-package.mjs pack \
  --source <package-dir> \
  --output <artifact.sciforge-plugin> \
  --publisher-id sciforge \
  --key-id <official-key-id> \
  --private-key-file <ed25519-private.pem>
```

使用对应公钥独立验证：

```bash
node scripts/extension-package.mjs verify \
  --archive <artifact.sciforge-plugin> \
  --public-key-file <ed25519-public.pem> \
  --publisher-id sciforge \
  --key-id <official-key-id>
```

密钥也可通过工具帮助中列出的 `SCIFORGE_PLUGIN_*` 环境变量提供。私钥只属于发布系统，不得进入源 package、artifact、应用 keyring、测试 fixture 输出或日志。应用只携带可轮换、按 publisher 绑定的官方公钥。

Host keyring 使用以下严格 JSON，只包含公钥：

```json
{
  "schemaVersion": 1,
  "keys": [
    {
      "keyId": "sciforge-release-2026",
      "publisherId": "sciforge",
      "algorithm": "ed25519",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

开发环境通过 `SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE` 指向该文件。正式打包使用同一环境变量，构建器只把公钥复制到应用资源 `extensions/official-keys.json`；运行时不读取 artifact 自带的公钥。未配置、文件无效或 key 不匹配时，本地安装 fail closed，但不影响内置扩展启动。

## Host 安装流程

Host 对用户明确选择的 artifact 执行：

1. 在资源上限内读取 ZIP 或开发/测试目录，拒绝 symlink、路径穿越和异常文件类型。
2. 要求两个 metadata 文件存在，严格解析 canonical 完整性 JSON 和 signature descriptor。
3. 比较实际 payload 与 `files` 的精确集合，验证每个 SHA-256。
4. 拒绝全部 install/publish lifecycle hooks。
5. 从 Host 官方 keyring 选择 `keyId`，校验 key-publisher 绑定并验 Ed25519 signature。
6. 用 `@sciforge/domain-sdk` 严格解析 `sciforge.domain.json`，只接受 `sandboxed-runtime`，校验 Host API 和三处身份。
7. 将已验证 bytes 写入 `<userData>/extensions/.staging/<random>/payload`，再原子移动到版本目录。
8. 最后原子更新 `registry.json`；失败时清理 staging 或回滚文件移动。

已安装版本位于：

```text
<userData>/extensions/packages/<base64url(packageName)>/<version>/
```

Host 在状态检查和回滚前重新验证 artifact 与 registry 中保存的 integrity digest。损坏或缺失版本不能激活。旧版本可保留用于显式回滚；卸载通过 Host 管理路径执行，工作区文件不能覆盖 install store。

## 激活边界

成功安装不赋予 privileged execution：

- `main` entrypoint 只能由独立 extension host 从已验证 active version 加载；
- `renderer` entrypoint 只能作为 sandboxed webview 文档加载；
- 所有外部能力由 Capability Broker 按 permission request、Host grant 和当前启用状态提供；
- Electron main、preload 和 privileged renderer 不动态导入 artifact JavaScript；
- 打开工作区、发现 manifest、Skill 或推荐项不会自动安装或执行 artifact。

当前落地阶段开放验签、安装、列举、禁用、升级版本保留、回滚和卸载，运行期包在 UI 中显示为“已安装”而不是“运行中”。独立 extension host、sandboxed webview 与权限批准界面接通前，Host 不执行 artifact 入口；registry 中的 `enabled` 仅保存用户的启用意图。内置 `trusted-compile-time` 包仍由生成的静态 composition 激活。

未来接受第三方发布者时，必须新增 Host-owned publisher policy、key lifecycle、撤销和权限 UX；不得放宽上述 artifact、隔离和 broker 规则，也不得为第三方增加第二套 loader。
