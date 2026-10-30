# 领域 Package 与扩展架构

SciForge 只有一种领域扩展模型：**domain package**。领域后端、可选 UI、Skills、资源与迁移随同一个 package 版本发布，并共同构成安装、启用、升级、回滚和卸载单元。内置能力和将来的第三方能力使用同一个严格 `sciforge.domain.json` 合同；它们的差异是代码来源、加载时机与隔离等级，不是两套插件系统。

```text
@sciforge/domain-<name>
├── package.json
├── sciforge.domain.json
├── dist/
│   ├── main.js            # 可选；后端贡献
│   └── renderer/index.html # 可选；UI 贡献
├── skills/                 # 可选；agent 指令
└── assets/                 # 可选；包拥有的资源
```

manifest 的 `kind` 明确选择一种执行模型：

| `kind` | 来源与发现 | 后端执行位置 | UI 执行位置 |
| --- | --- | --- | --- |
| `trusted-compile-time` | 随 SciForge 构建，由 manifest 生成静态 composition | Electron main 中的 package `./main` 入口 | privileged renderer 中的 package `./renderer` 入口 |
| `sandboxed-runtime` | 从签名 `.sciforge-plugin` 安装到 `userData` store | 独立 extension host；manifest 中必须为 `extension-host` | sandboxed webview；manifest 中必须为 `sandboxed-webview` |

“可信编译期”只描述构建选择和 privileged 入口；“运行期 sandbox”只描述执行边界。发布者身份、签名是否可信、权限是否批准和安装状态均由 Host 持有，manifest 不能自行声明。

## 公共合同

`@sciforge/domain-sdk` 是唯一 manifest 和 Host 扩展合同。所有定义都包含稳定的 package 名、module ID、版本、Host API 范围、进程分离入口、contribution 声明和可选的纯数据 `contributionContracts`。

1. package 的 manifest 声明 contribution，进程入口提供与声明逐项一致的实际值。缺失、额外、重复或 Host API 不兼容必须在激活前失败，不能部分注册。
2. 后端与 UI 使用不同入口。共享 `contract` 只能包含 schema、类型、ID 和无副作用 helper，不能导入 Electron、Node 文件系统、React 或领域 service。
3. UI 与后端随同一个 package 版本发布，但 UI 是可选贡献。renderer 不能反向导入 main/worker 源码，main 也不能导入 renderer 或 React。
4. package 只能依赖 SDK 公共导出和其他包的公共导出，不能导入 Host 私有的 `src/main`、`src/renderer`、`src/shared`、`@main`、`@renderer` 或 `@shared` 路径。
5. contribution ID、command ID、view ID、permission ID 和 capability ID 必须稳定且命名空间化。Host 不按领域 ID、文件类型或当前包写 switch 和特例。
6. 注册必须带 owner，顺序必须确定，批量激活必须原子化，dispose 必须逆序且幂等。

## 可信编译期 composition

根应用只有一个由 manifest 自动生成的 installed-domain definition 集合；main 与 renderer 的静态 projection 也由同一生成器输出。添加或移除领域只增删 `packages/domains/*` package，不修改核心 feature map、domain-ID switch、IPC allowlist 或页面条件分支。

主进程只静态导入 `./main`，渲染进程只静态导入 `./renderer`。已经编入 main/renderer bundle 的领域代码不再以 TypeScript 源码形式作为第二套 release runtime 打包。生成器按 `packageName` 稳定排序，只为 manifest 声明的进程生成入口；定义、实现和生成结果漂移时构建失败。

可信 package 默认使用 `"composition": "production"`。只服务于开发或合同测试的 fixture 必须显式声明 `"composition": "development-only"`；生成器仍验证并测试该 package，但会从生产 definition 与各进程静态 composition 中统一排除，Host 不维护领域特例。

可信 package 可以在 Electron 进程中运行，是因为它已经通过 SciForge 源码审查和构建链，而不是因为 manifest 写了一个“trusted”字段。运行期下载的包永远不能切换到这条 privileged 路径。

## Sandboxed runtime package

运行期 package 使用 `kind: "sandboxed-runtime"`。其 manifest 必须声明：

- 所声称的 publisher ID 与展示名；
- 兼容的 Host API 半开版本范围；
- 每个 main/renderer 入口的 package 相对路径、格式和固定隔离方式；
- 按进程划分的权限请求、理由、是否必需及受限参数；
- contribution 及其纯数据合同。

`publisher.id` 只是包内声明，不是信任证明。严格 schema 不接受 `trusted`、`verified`、`official`、`grantedPermissions` 等自我授权字段。Host 只有在以下外部事实全部成立后才可激活：

1. 完整 artifact 通过 Host 官方 keyring 中 Ed25519 公钥的验证；
2. 签名绑定的 publisher、package、version 与 `package.json`、manifest 完全一致；
3. Host API 兼容；
4. 每个必需权限都由 Host policy 识别并获得可接受的 grant；
5. active version 在 install store 中存在且复验完整性通过。

第一阶段 keyring 只包含 SciForge 官方发布者密钥，因此只接受 SciForge 官方签名 artifact。合同、store 和隔离边界从第一天不依赖 `publisherId === "sciforge"` 的硬编码；未来开放第三方时只扩展 Host 拥有的发布者信任策略，不改 manifest，不让第三方进入 Electron main 或 privileged renderer。

## Capability Broker 与 UI 槽

业务操作统一经过 Capability Broker。preload 只提供通用 capability transport；领域不能增加专属 IPC facade。Agent、内置 UI 和 sandboxed extension 使用同一个 action definition、授权、审计和 external-write 路径。

运行期 main contribution 由独立 extension host 加载。它不能持有 Electron main 对象、直接文件系统 authority 或任意网络 authority，只能向 broker 请求 manifest 已声明且 Host 已批准的 capability。installer/verifier/store 只处理不透明文件、合同、签名与安装记录，绝不把安装目录中的 JavaScript 动态导入 Electron main。

运行期 renderer contribution 只在 sandboxed webview 中执行，通过窄、版本化、可撤销的消息合同访问 Host。它不能作为 React 模块动态导入 privileged renderer，也不能取得 preload 的完整 `window.sciforge` API。工具栏、菜单、设置、viewer 和 panel 应贡献数据化命令或受控 view，不允许任意组件取得 Host 私有上下文。

## Workspace Preview 与领域 wire

Workspace Preview 使用两种进程分离、内容完整的贡献：`main.workspace-preview-plugin` 绑定 canonical manifest 与完整 provider，`renderer.workspace-preview-plugin` 绑定同一 canonical manifest 与 render/actions/inspector。同一 preview 在两个入口声明相同、命名空间化的 contribution ID，并只在顶层 `contributionContracts` 保存一份 canonical manifest；生成、入口绑定和 Host 激活任一阶段发现漂移都会拒绝。

完整纯数据合同来自 `@sciforge/domain-sdk/workspace-preview`。核心 Host 只负责 session、文件安全、审计和生命周期，不按 plugin ID 或文件类型分派领域逻辑。

领域 observation/selection 只能通过 SDK 的命名空间扩展槽传输。具体 schema 和编解码器属于领域 package；核心层不增加 `molecular`、`sequence` 等联合类型分支，也不保留旧 wire decoder。

## 安装与生命周期

签名 artifact 的规范见 [领域扩展打包与签名](./domain-extension-packaging.zh-CN.md)。安装流程只有一条：

```text
用户明确选择 artifact
  → 有界读取 ZIP/目录
  → 路径、文件类型与大小检查
  → 完整文件集 SHA-256 校验
  → 官方 Ed25519 keyring 验签
  → manifest、身份、Host API 和权限检查
  → userData staging
  → 原子移动到版本目录并提交 registry
  → 隔离环境激活
```

install store 固定属于应用 `userData`：

```text
<userData>/extensions/
├── registry.json
├── packages/<base64url(packageName)>/<version>/...
├── .staging/
└── .trash/
```

registry 由 Host 记录实际 signer、integrity digest、权限请求、隔离策略、启用状态、active version 和历史版本。升级保留旧版本以支持回滚；禁用和 active-version 切换只改变 Host registry。安装内容损坏时必须 fail closed。

首个落地里程碑先交付完整的官方验签与安装管理链路，运行期包状态为“已安装”，不会在 Electron main 或 privileged renderer 中执行。独立 extension host、sandboxed webview 和权限批准 UI 接通后，才允许把通过复验且已授权的 active version 转为“运行中”；这不是通过重启或动态 import 绕过隔离的兼容路径。

工作区不是信任根。打开一个目录、发现 `.agents/skills`、`sciforge.domain.json`、依赖声明或推荐列表都不能自动安装或执行代码。工作区最多记录推荐项和用户已经确认的启用选择；每次新增安装权限都需要显式用户操作和 Host 校验。

artifact 必须预构建且自包含。安装器不运行 npm/yarn/pnpm，也不执行 `preinstall`、`install`、`postinstall`、`prepare`、publish hooks 或任何 `postinstall` 等价机制。依赖和运行时资源必须在打包阶段解析并进入签名文件集。

## 依赖方向

```text
domain contract          --> domain SDK / shared wire schemas
trusted domain main      --> domain contract + main Host SDK + public worker exports
trusted domain renderer  --> domain contract + renderer Host SDK
runtime extension host   --> domain contract + capability client
runtime sandboxed UI     --> domain contract + sandbox bridge
host composition         --> trusted installed-domain process projection
installer/verifier       --> domain SDK public contract + public Node APIs
```

禁止：

- domain renderer → main、Node/Electron privileged API 或 worker 私有 `src`；
- domain main → renderer 或 React；
- runtime artifact → Electron main 或 privileged renderer 的动态 import；
- installer → 某个具体领域实现、领域 ID 或 extension 代码入口；
- Host core → 具体领域 ID、viewer/provider 或权限特例；
- package → 根应用中的领域实现文件；
- 为同一 capability、preview、状态变更或 external write 添加第二套 IPC、MCP、service 或 fallback。

## 新增领域

### 随应用发布的可信领域

1. 在 `packages/domains/*` 创建 package，定义纯 `definition`/`contract`、`main` 与可选 `renderer` 入口。
2. 使用 `kind: "trusted-compile-time"`，声明全部 contribution 和稳定 ID。
3. 分别导出 `domainPackageDefinition`、`createDomainMainEntry` 与可选 `createDomainRendererEntry`。
4. 运行 `npm run domain-packages:generate`；目录增删即可信 package 增删。
5. 运行 `domain-packages:check/test/typecheck`、架构边界测试、完整测试、构建和 Electron smoke。

### 可安装领域

1. 使用同一个 SDK 创建 `kind: "sandboxed-runtime"` manifest；main 固定为 `extension-host`，renderer 固定为 `sandboxed-webview`。
2. 只请求实际需要的 capability 权限，并让 contribution 使用通用 Host 扩展点。
3. 预构建全部入口和资源，用 `package.json.files` 明确签名 payload。
4. 按打包规范生成 `.sciforge-plugin` 并由 SciForge 官方 Ed25519 key 签名。
5. 验证 package、installer/store 测试、extension-host/webview 隔离、权限拒绝、升级/回滚和 packaged application 路径。
