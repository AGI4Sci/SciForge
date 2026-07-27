# 领域 Package 架构

SciForge 的领域扩展采用可信的编译期 package。一个领域是一个版本、安装和回滚单元，但 Electron 主进程与渲染进程必须使用不同入口，不能把两端实现打进同一个运行时模块。

```text
@sciforge/domain-<name>
├── sciforge.domain.json
├── src/
│   ├── contract.ts   # 两端可共享的纯数据契约
│   ├── main/         # capability、service、preview provider
│   ├── renderer/     # 可选的 panel、viewer、action、inspector
│   └── wire.ts       # 可选的领域数据编码/解码；由 package 自己拥有
└── package.json
```

## 核心规则

1. 根应用只有一个由 manifest 自动生成的 installed-domain definition 集合；main 与 renderer 的静态 projection 也由同一生成器输出。添加或移除领域只增删 `packages/domains/*` package，不修改核心 feature map、switch、IPC allowlist 或页面条件分支。
2. package 的 manifest 声明 contribution，进程入口提供与声明逐项一致的实际值。缺失、额外、重复或 host API 不兼容都必须在激活前失败，不能部分注册。
3. 主进程只导入 `main`，渲染进程只导入 `renderer`。`contract` 只能包含 schema、类型、ID 和无副作用 helper，不能导入 Electron、Node 文件系统、React 或领域 service。
4. UI 与后端默认随同一个 package 版本发布，但 UI 是可选贡献。它们共享契约，不共享进程实现，也不允许 renderer 反向导入 main/worker 源码。
5. 业务操作统一经过 Capability Broker。preload 只提供通用 capability transport；领域不能增加专属 IPC facade。Agent 与 UI 使用同一 action definition。
6. Workspace Preview 使用两种进程分离、内容完整的贡献：`main.workspace-preview-plugin` 绑定 canonical manifest 与完整 provider，`renderer.workspace-preview-plugin` 绑定同一 canonical manifest 与 render/actions/inspector。同一 preview 在两个入口声明同一个命名空间化 contribution ID，并只在 manifest 顶层 `contributionContracts` 保存一份 canonical manifest；生成、入口绑定和 Host 激活任一阶段发现漂移都会拒绝。完整纯数据合同统一来自可发布的 `@sciforge/domain-sdk/workspace-preview`，领域 package 不依赖根应用私有 `@shared`。核心 Host 只负责 session、文件安全、审计和生命周期，不按 plugin ID 或文件类型分派业务逻辑。
7. 注册必须带 owner，顺序必须确定，批量激活必须原子化，dispose 必须逆序且幂等。
8. 领域 observation/selection 只能通过 SDK 的命名空间扩展槽传输。具体领域 schema 和编解码器属于领域 package；核心层不增加 `molecular`、`sequence` 等联合类型分支，也不保留旧 wire decoder。
9. 编译期 package 的代码由 Electron 构建产物承载。已经编入 main/renderer bundle 的领域依赖不再以 TypeScript 源码形式作为第二套 release runtime 打包。

## 依赖方向

```text
domain contract  --> domain SDK / shared wire schemas
domain main      --> domain contract + main host SDK + worker public exports
domain renderer  --> domain contract + renderer host SDK
host composition --> installed-domain main 或 renderer 投影
```

禁止以下依赖：

- renderer → main、Node/Electron privileged API、worker 私有 `src` 路径；
- main → renderer 或 React；
- host core → 具体领域 ID、具体 viewer/provider；
- package → 根应用中的领域实现文件。

## 新增领域的最小流程

1. 在 `packages/domains/*` 创建 package，并定义纯 `definition`/`contract`、`main` 与可选 `renderer` 入口。
2. 在 manifest 中声明所有 contribution，并为每项提供稳定、命名空间化的 ID。
3. 分别导出统一名称 `domainPackageDefinition`、`createDomainMainEntry` 与可选的 `createDomainRendererEntry`；使用 host SDK 贡献 capability、preview provider、viewer 或 Workbench panel，不要新增 transport。
4. 运行 `npm run domain-packages:generate`。生成器扫描 `packages/domains/*/sciforge.domain.json`、按 `packageName` 稳定排序，并且只为 manifest 声明的进程生成静态 import；目录的增删就是可信领域 package 的增删。
5. 运行 `domain-packages:check/test/typecheck`、架构边界测试、完整测试、构建和 Electron smoke。构建与 capability 治理会先校验生成文件新鲜度。

运行期下载、第三方 JavaScript、签名校验、权限提示和热卸载不属于当前可信编译期阶段。未来若支持非可信扩展，必须使用签名、权限和独立 sandbox UI，不能复用 privileged renderer 的可信入口。
