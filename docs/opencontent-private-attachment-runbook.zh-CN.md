# SciForge OpenContent 私有附件技能安装与运行手册

本文档面向需要在本地开发版 SciForge 中启用 OpenContent 附件技能的团队成员，说明代码准备、附件验签、安装、账号连接、能力验收和常见故障处理流程。

## 1. 适用范围

- SciForge 公开代码：OpenContent Connector、Content Space Provider 和 SciForge 自研 Runtime。
- 私有附件发布：使用团队内部发布记录指定、且与当前 installer/receipt schema 匹配的版本。
- 当前开发分支：`codex/opencontent-mdoc-runtime-upgrade`。
- Node.js：`>= 22.12.0`。
- 本文命令以 macOS/Linux 终端为例。

> OpenContent 是 Content Space 的一个 Provider，不是 Host 的固定依赖。公开仓库保留 SciForge 自研集成代码；只有供应商附件及其内部重打包产物禁止公开。

## 2. 安装后能获得什么

私有附件只增加供应商 Runtime 候选，不产生生产准入。当前 OpenContent 的 `live_verified` 与 `production_ready` 操作均为 **0**。安全形状完整但尚未通过 packaged 真实验收的操作统一声明为 `poc_only / verification_profile_required`；缺少原子并发、不可变检索或 Project 权威合同的操作继续 `blocked_by_contract`。

| 能力类别 | 未安装附件 | 已安装附件 |
| --- | --- | --- |
| 个人库/团队库普通文件能力 | 6 项 PoC，默认不可执行 | 6 项 PoC，默认不可执行 |
| Team Administration | 10 项 PoC，默认不可执行 | 10 项 PoC，默认不可执行 |
| Project Content Directory provisioning | `provision-project` 为 blocked；仅保留 dormant provider-neutral port，无普通 Agent 入口 | 同左 |
| native-document | 不注册 | 20 项候选：10 项 PoC；含 `edit` 在内的 10 项 hash-bound mutation 阻断 |
| extended operations | Team 治理 2 项 PoC；其余 52 项因缺附件阻断 | 53 项 PoC；`updateFileVersion` 阻断 |
| `ArtifactReference` | `observeImmutableVersion` 阻断 | `observeImmutableVersion` 阻断 |
| Team 删除 | 不存在 | 不存在 |

安装附件不会自动安装 PoC 验证策略。Provider 声明的 readiness 只描述逐操作证据；本次 invocation admission 另行核对当前 Principal、Broker authority、audience、platform、transfer limit 和静态 verification profile。即使一次 PoC 调用获准，其 readiness 仍是 `poc_only`，不会变成 `production_ready`。

PoC 操作只有在经过单独评审的静态 profile 精确匹配 Provider Instance、完整 Host Principal snapshot（含 assurance）、authority（Provider Instance 或个人/团队 content root）、operation、audience、可执行的 upload/download 最大字节数和最长 24 小时的有效窗口时，才能通过正式能力链执行。Provider-scoped 操作、mutation、Administration 或非零 transfer 还必须匹配 v2 Provider Binding Attestation：精确 Provider Instance 与 Principal，以及不暴露原始账号标识的 opaque external subject 和 opaque binding revision。Content Space 先通过 pinned Provider 取得并匹配证明；每次业务 dispatch 前，Provider 再把精确期望传给 Connector，由 Connector 对真实当前 session 重新认证、重新计算并精确比较。解绑、重绑、凭据替换、外部账号变化或 revision 漂移都会在业务调用前 fail closed。

调用参数、Renderer、Agent、prompt、Task、普通环境变量/配置、文件类型、附件存在或相邻操作成功都不能启用或扩大 profile；`blocked_by_contract` 永远不能被 profile 放行。Host assurance 不是外部 OpenContent 账号类别，binding attestation 也不是 credential 或 portable authority。

## 3. 安装前准备

### 3.1 获取公开代码

使用团队 fork 中经过评审的功能分支：

```bash
git clone https://github.com/SCU-areszhang/SciForge_Loop.git
cd SciForge_Loop
git switch codex/opencontent-mdoc-runtime-upgrade
npm ci
```

已有仓库的成员可以执行：

```bash
git fetch origin
git switch codex/opencontent-mdoc-runtime-upgrade
git pull --ff-only
npm ci
```

> 公开根 workspace 与 `package-lock.json` 不包含 `internal/**`。建议先完成公开依赖安装，再安装私有 overlay；安装后不要为了创建私有 workspace link 再运行根 `npm install`。overlay 的存在不得改变公开 lockfile。

### 3.2 从群内获取附件

必须同时下载以下两个文件，并将它们保存在公开仓库之外或本机临时下载目录中：

- `sciforge-opencontent-attachment-assets-<OVERLAY_VERSION>.zip`
- `sciforge-opencontent-attachment-assets-<OVERLAY_VERSION>.zip.sha256`

还必须从独立可信的内部发布记录取得该版本的准确 SHA-256，记为
`<TRUSTED_SHA256>`。同包发送的 sidecar 用于一致性复核，不能独自充当信任根。

不要通过公开 Issue、PR、Release、npm 包或公开网盘分发这两个文件。

## 4. 验证并安装私有附件

以下命令必须在 SciForge 仓库根目录执行。先把三个值替换为内部发布记录和附件实际下载目录：

```bash
OPENCONTENT_OVERLAY_VERSION='<OVERLAY_VERSION>'
OPENCONTENT_OVERLAY_SHA256='<TRUSTED_SHA256>'
OPENCONTENT_OVERLAY_DOWNLOAD_DIR='/path/to'
```

### 4.1 验证下载包

```bash
node scripts/internal-overlay-package.mjs verify \
  --archive "${OPENCONTENT_OVERLAY_DOWNLOAD_DIR}/sciforge-opencontent-attachment-assets-${OPENCONTENT_OVERLAY_VERSION}.zip" \
  --sidecar "${OPENCONTENT_OVERLAY_DOWNLOAD_DIR}/sciforge-opencontent-attachment-assets-${OPENCONTENT_OVERLAY_VERSION}.zip.sha256" \
  --sha256 "${OPENCONTENT_OVERLAY_SHA256}"
```

验证成功时，命令会输出 overlay ID、版本、文件清单和归档 SHA-256。若出现摘要不一致、路径逃逸、重复路径或文件清单不完整，必须停止安装并重新从群内获取附件。

### 4.2 安装 overlay

```bash
node scripts/internal-overlay-package.mjs install \
  --archive "${OPENCONTENT_OVERLAY_DOWNLOAD_DIR}/sciforge-opencontent-attachment-assets-${OPENCONTENT_OVERLAY_VERSION}.zip" \
  --sha256 "${OPENCONTENT_OVERLAY_SHA256}" \
  --target .
```

安装器会：

- 将附件 payload 只写入 `internal/opencontent/**`；
- 在写入前验证完整归档；
- 遇到不同内容的现有文件时停止，不强制覆盖；
- 对完全相同的归档重复安装保持幂等；
- 在 `.sciforge/internal-overlays/` 下记录包含 overlay identity、版本、完整文件清单和摘要的本地完整性 receipt。

### 4.3 验证已安装内容

```bash
node scripts/internal-overlay-package.mjs verify-installation \
  --id opencontent-attachment-assets \
  --root internal/opencontent \
  --target .

npm run verify:internal-runtimes
```

两条命令都只执行公开 SciForge 代码。第一条核对安装 receipt、完整 inventory、摘要和路径 containment；第二条通过 manifest-discovered composition 静态核对已收据化资产根、必需入口和摘要，不执行 overlay 自带脚本。所有检查通过后才能启动 SciForge；校验、构建或打包都不得调用供应商 CLI。打包同样会拒绝缺失、额外、变更、路径逃逸或未收据化的文件。

## 5. 启动 SciForge

```bash
npm run dev
```

正常启动时，终端应依次出现类似信息：

```text
[internal-runtime] Statically verified 1 runtime(s).
dev server running for the electron renderer process
start electron app
```

这里不应出现私有 package 的 build 或 verify 脚本输出。当前实现不依赖 `node_modules/@sciforge-internal/...` 链接，也不会沿祖先目录搜索私包。源码模式只从 Host 注入的绝对仓库根下固定路径 `internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1` 加载，并在激活时再次静态核对精确 overlay identity、root、receipt 版本、完整 inventory 和摘要；打包模式只从 `resources/opencontent/opencontent-base-1.0.1` 加载已验证资产。两种模式互不回退。

## 6. 配置个人 OpenContent 连接

附件只提供 Runtime 资产，不包含任何成员的 Token、API Key、Cookie 或登录状态。每位成员必须使用自己的 OpenContent 账号完成连接。

1. 打开 SciForge。
2. 通过应用内 OpenContent 连接流程配置自己的账号；Provider Instance 对应的站点由 Connector 的可信静态配置固定，不接受调用方 endpoint。
3. 确认 Provider Instance `opencontent-edoc2-demo` 可发现。
4. 若提示重新认证，先完成认证，再执行能力发现或文件操作。

禁止在群内附件、代码提交、Issue 或聊天记录中共享真实 Token 和 API Key。

Connector 内置的 `edoc2-test1-verification` 只是把测试 Provider Instance 固定到受审查 endpoint 的 compile-time endpoint profile，不是 Content Space operation verification policy。可发现或选中该 Instance 不会把任何操作提升为 PoC 可执行或生产就绪。

## 7. 安装后的静态与发现验收

普通团队成员安装 overlay 后，只验证 composition、声明的 readiness 与当前 admission，不绕过准入执行 Provider 操作：

1. 确认 Provider Instance `opencontent-edoc2-demo` 可发现；
2. 读取 Content Space capability description，分别核对声明的 readiness 与本次 admission；
3. 核对普通文件 6 项和 Team Administration 10 项均为
   `poc_only / verification_profile_required`；
4. 已安装附件时，核对 native-document 共 20 项，其中 10 项 PoC、含 `edit` 在内
   10 项阻断；extended operations 共 54 项，其中 53 项 PoC、
   `updateFileVersion` 阻断；
5. 核对 `observeImmutableVersion` 阻断、无 `ArtifactReference`；
6. 核对不存在 Team 删除和 `content-space.agent-provision-project` 能力。

默认 composition 没有 active verification profile，因此 PoC readiness 保持可见而 admission 为 blocked 是预期结果。不要通过修改请求、Renderer 状态、环境变量、配置文件或 readiness 文本尝试启用它们。

## 8. 受控 packaged 真实验收

真实调用只由获得授权的验收负责人执行，并且必须先具备：

- 隔离测试租户、明确的 Provider Instance；
- 独立个人库和团队库测试根；
- 最小权限的明确外部账号类别，以及权限/撤权负向测试账号；
- 唯一命名、可清理或明确保留的测试资源；
- 经评审并由可信 composition 安装的精确 verification policy；
- 对 Provider-scoped、mutation、Administration 或非零 transfer，profile 中包含与当前 Connection 精确匹配的 opaque Provider Binding Attestation；
- 当前 packaged SciForge 应用和已验证 overlay；
- 写入限额、有效期、停止条件和凭据外的证据保存位置。

验收必须只走 packaged 应用的唯一 Renderer/Agent → Broker → Content Space → pinned Provider → Connector 路径；native/extended 操作继续从 Connector 进入 public Runtime，再使用已验证 private overlay，不能形成第二条 Agent/鉴权路径。不得用直连 API/CLI、供应商脚本、source-only Electron、mock 或临时 `production_ready` 值代替。

每个操作单独记录 build/commit、Provider Instance、完整当前 Principal snapshot、authority/root、operation、audience、profile 身份与有效期、实际 enforce 的 transfer limits、需要时的 opaque binding attestation、请求摘要、invocation/receipt、时间、结果和 postcondition。证据不得保存 credential、原始外部账号标识或敏感 root 标识。还必须证明 Connector 在业务 dispatch 前重新核对了同一 binding；一次成功只证明该 invocation，不会改写 readiness，也不能批量晋升相邻操作、另一 root 或另一 binding。

Agent 创建共享 Content Container（OpenContent Team）时，输入只能包含 label 和 idempotency key，不能提交 owner。Broker 的 current Principal 注入 owner，Provider 必须证明它映射到当前认证的 OpenContent session；不能把 Agent、自填成员、Coordinator 或任意 Provider 用户当成 owner。这条普通 Administration 路径也不是 Project Content Directory provisioning。

普通文件闭环还必须满足：上传只创建新文件且使用 Workspace 相对路径；下载只写入不存在的新目标；collision 必须 fail closed；取消、超时或 `outcome_unknown` 后不得盲目重试外部写入，必须先观察 Provider 状态。权限验收必须包含错误 Principal/root、撤权和最小权限行为。

### 8.1 同文件 CAS 与 `UPDATE` / `UPGRADE`

在供应商冻结以下合同并完成双写者并发验收前，`updateFileVersion` 与全部 hash-bound native mutation 保持阻断：

1. Provider 返回的准确 immutable version/revision/hash；
2. mutation 请求携带的准确 expected-state 字段；
3. expected-state 比较与 mutation 发生在同一个 Provider 原子事务；
4. stale writer 返回稳定 conflict，并证明文件字节、文档状态、metadata、version 和其他副作用均未变化；
5. 成功响应返回新提交状态的准确 identity；
6. 两个并发 writer 的测试结果为一个成功、一个零 mutation 冲突。

本地 probe、plan receipt、pre-read、写前复读、one-time token 或 post-write digest 都不是原子 CAS。供应商离线文档一处写 `UPGRADE`、另一处写 `UPDATE`；必须书面冻结唯一 wire enum、endpoint、请求字段、是否创建新版本、返回版本 identity 和 conflict error，随后由 SciForge pin 住并拒绝另一拼写，不能增加 alias 或“先读后写”兼容路径。

### 8.2 `ArtifactReference`

只有同时证明稳定 immutable version identity、接受该 identity 的 version-specific retrieval、提交新版本后旧字节仍可逐字节取回、明确 retention/deletion 合同、稳定 missing/retired 行为，并在 packaged 正式路径完成 exact digest 校验后，才能考虑开启 `observeImmutableVersion`。file ID、latest version number、digest 或本地副本都不足以生成 `ArtifactReference`；`ArtifactReference` 本身也不携带权限，解析时仍使用当前 Principal 的 Provider Connection 和当前授权。

完整逐操作晋升证据见 [OpenContent Skill 能力矩阵](./opencontent-skill-capability-matrix.md#evidence-required-for-promotion)。

## 9. 常见问题

### 9.1 校验失败或 SHA-256 不一致

- 不要继续安装。
- 删除本次下载的 ZIP 和 sidecar。
- 从群内重新下载两个文件。
- 确认 ZIP 与 sidecar 来自同一版本。

### 9.2 安装器报告文件冲突

安装器不会覆盖不同内容的现有文件。关闭 SciForge，将现有 `internal/opencontent/` 和对应本地 receipt 移到仓库之外的安全备份位置，再重新执行验证和安装。不要手工混合两个版本的附件文件。

### 9.3 普通能力候选可发现，但附件支持的 feature 未注册

依次检查：

```bash
test -d internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1
node scripts/internal-overlay-package.mjs verify-installation \
  --id opencontent-attachment-assets \
  --root internal/opencontent \
  --target .
npm run verify:internal-runtimes
```

随后完全退出并重新执行 `npm run dev`。如果公开静态验证报告 0 个 runtime 或失败，检查 overlay 是否安装在仓库根目录下的固定路径、receipt 是否存在、公开 composition 所需 manifest 与资产入口是否完整；不应依赖或等待私有资产 build 记录。

### 9.4 找不到 `opencontent-edoc2-demo`

- 确认当前成员已配置自己的 OpenContent 连接。
- 检查账号或站点是否要求重新认证。
- 确认正在运行包含 OpenContent Connector/Provider 的正确代码分支。

### 9.5 上传返回 `source_unavailable`

- 确认使用的是本手册指定的 fork commit/branch。
- 确认源文件位于当前 SciForge Workspace 中。
- 只传 Workspace 相对路径，不传绝对路径、`..` 或 Host transfer handle。
- 先用正式 Workspace 预览能力确认文件存在，再重新发起新的上传调用。

### 9.6 下载返回 `conflict`

这是禁止隐式覆盖的预期行为。选择一个不存在的新 Workspace 相对路径，不要删除或覆盖已有文件来绕过检查。

### 9.7 写操作返回 `outcome_unknown`

不要自动重试。先重新观察目标目录、文件 revision 或 Provider receipt，确认远端是否已经提交写入，再由人工决定下一步。

### 9.8 `package-lock.json` 出现私有 workspace 记录

这是公开依赖边界失效，不是合法的 overlay 安装结果。停止构建/发布，不要提交这些记录；使用 `git diff -- package-lock.json package.json` 定位引入私有 workspace 或根安装副作用的命令。公开 lockfile 必须保持不含 `internal/opencontent` 和 `@sciforge-internal/opencontent-skill-assets`。修复公开依赖图后重新执行 `npm ci`，再通过本手册的 installer 安装 overlay。

### 9.9 PoC 操作返回 unavailable

默认 composition 没有 active verification profile，这是预期的 fail-closed 行为。确认 capability 输出中 readiness 仍为 `poc_only`、admission 为 blocked；不要把 blocked admission 误写成 `blocked_by_contract`。普通用户不能通过设置环境变量、修改 capability 请求或重装附件来开启 PoC。只有验收负责人可以部署经过评审且精确限定的 trusted verification policy；如果该条件不具备，停止真实调用，仅完成静态与发现验收。

### 9.10 调用在 admission 后报告 binding 不再匹配

这通常表示 Connection 在准入与业务 dispatch 之间发生解绑、重绑、凭据替换、外部账号变化或 revision 漂移。不要复用旧 invocation、旧 profile 或旧 Broker resource，也不要重试外部写入。先由当前 Principal 重新完成连接验收，再生成并评审新的短时静态 profile；原始账号标识和 credential 不得进入 profile 或故障记录。

## 10. 更新附件版本

1. 完全退出 SciForge 和开发服务器。
2. 将当前 `internal/opencontent/` 与对应 receipt 移到仓库外备份。
3. 下载新版本 ZIP 和 sidecar。
4. 使用新版本文件执行 `verify`。
5. 使用 `install` 安装新版本。
6. 运行 `verify-installation` 和 `npm run verify:internal-runtimes`，只用公开 SciForge 验证器完成静态验证。
7. 重新执行 `npm run dev` 和静态/发现验收。

不要在原目录中手工覆盖部分文件，也不要把不同版本的资产混合使用。

## 11. 开源与发布边界

公开提交或发布前必须确认：

- `internal/opencontent/**` 未被 Git 跟踪；
- 群内 ZIP 和 `.sha256` 不在仓库、PR、Release 或 npm 包中；
- `package-lock.json` 不包含私有 asset package 记录；
- 公开 tarball、Electron 包和生成物不包含供应商附件；
- 官方公开 release entrypoint 在 internal runtime composition 非空时会于签名、上传或发布前 fail closed；
- 公开 Release 从不含私有 overlay 的 clean checkout 重新构建；
- 本机已有的 ignored `dist/` 可能包含私有附件，禁止直接作为公开 Release 上传。

显式的本地/internal package 可以在静态 receipt 校验后包含 overlay，用于 packaged 真实验收；它不是公开 Release。安装 overlay 不能静默改变官方公开发布物。

OpenContent Connector、Provider、SciForge 自研 Runtime、SDK 文档和能力矩阵属于允许公开的 SciForge 内容，不应随私有附件一起删除。

## 12. 安装检查清单

- [ ] 已切换到正确的 SciForge 代码分支。
- [ ] 已在安装 overlay 前完成 `npm ci`。
- [ ] 已同时取得 ZIP 与 `.sha256`。
- [ ] 已从独立可信发布记录取得版本与 SHA-256，`verify` 通过且摘要一致。
- [ ] `install` 成功且只写入 `internal/opencontent/**`。
- [ ] `.sciforge/internal-overlays/` 中存在对应完整 inventory/digest receipt。
- [ ] `package.json` / `package-lock.json` 未因 overlay 改变，也不存在私有 workspace/link。
- [ ] `verify-installation` 通过，未发现 missing/extra/changed/escaping/unreceipted 文件。
- [ ] `npm run verify:internal-runtimes` 通过，且没有执行 overlay 自带脚本。
- [ ] `npm run dev` 正常启动 Electron。
- [ ] 已使用个人账号配置 OpenContent 连接。
- [ ] 静态/发现验收分别显示 readiness 与 admission，并确认 0 项 production/live、普通/Admin 为 PoC、native 10 PoC + 10 blocked、extended 53 PoC + 1 blocked、无 Team 删除。
- [ ] 受控 mutation/Admin/non-zero transfer 使用 v2 opaque binding attestation，且 Connector 在业务 dispatch 前重新核对；证据中没有原始账号、credential 或敏感 root。
- [ ] Agent 创建共享 root 的输入不含 owner；owner 仅由 Broker current Principal 注入并由 Provider 对当前 session 验证。
- [ ] `edit`、`updateFileVersion`、immutable observation 和 `ArtifactReference` 均保持阻断。
- [ ] 不存在通用 Agent Project provisioning 入口；provider-neutral port 仅 dormant。
- [ ] 未将私有附件、private lock 记录或内部构建产物加入公开提交。

## 相关文档

- [OpenContent 附件分发边界](./opencontent-attachment-distribution.md)
- [Content Space 架构与唯一调用链](./content-space-architecture.md)
- [OpenContent Skill 能力矩阵](./opencontent-skill-capability-matrix.md)
- [ADR-0030：通过 Content Space 激活 Provider Native Documents](./adr/0030-activate-provider-native-documents-through-content-space.md)
