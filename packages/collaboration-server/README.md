# SciForge 云端协作服务

`@sciforge/collaboration-server` 是 SciForge 用户、手机 Human Endpoint 与桌面 Agent 之间的云端协作内核。本说明以中文为主；命令、环境变量和公共入口保持英文，便于自动化部署和开源集成。

## 定位与架构边界

服务端负责身份与设备绑定、个人 Topic 与桌面 Session projection、Project/Task/Record、顺序 inbox/outbox、幂等回执、审计、provider 事件游标和连接通知。生产状态以单个 PostgreSQL schema 为唯一事实源；状态变更、审计、收件箱消息和幂等回执在同一事务内提交。

它刻意不负责以下能力：

- 不运行模型、桌面 Session、本地工具或科研工作流；这些仍由本地 SciForge Agent runtime 管理。
- 不在核心中识别 Zulip 或其他 provider ID。已安装 adapter 通过 manifest 与 generated composition 注入，核心只使用 `@sciforge/collaboration-contracts` 的 provider-neutral contract。
- 不把 WebSocket 当作消息事实源。WebSocket 只通知 `connection.ready` 和 `inbox.available`；客户端仍按 sequence 拉取并 ack，因此断线和重启不会跳过正文。
- 不提供第二套内存或文件生产后端。测试可注入 fake repository，但生产只有 PostgreSQL 路径。

公共包入口如下：

| 入口 | 用途 |
| --- | --- |
| `@sciforge/collaboration-server` | 服务、HTTP/WebSocket runtime、provider runtime 与公共组合入口 |
| `@sciforge/collaboration-server/api` | HTTP API 入口类型 |
| `@sciforge/collaboration-server/postgres` | PostgreSQL repository、pool 与迁移集成 |
| `@sciforge/collaboration-server/repository` | 可注入 repository contract |
| `@sciforge/collaboration-server/service` | canonical domain service |

Bearer 解析与 OIDC verifier 是 server-owned 私有 network boundary，不是包
export。公开 service/API 类型只使用不含凭据的 Actor facts。

跨包协议、实体和 wire schema 必须从 `@sciforge/collaboration-contracts` 的公共入口导入；不要依赖本包 `src/` 私有路径。

Cloud 的 Provider Instance identity 只有
`{ schemaVersion: 1, type: "provider_instance_reference", providerInstanceRef }`。
其中 `providerInstanceRef` 直接复用 Domain SDK 的 canonical opaque、non-authorizing
Provider Instance Ref；Cloud 不再维护或推断 `authority + instanceId`，Content Space
调用必须原值传递该引用。

Project-scoped visible recovery 只有两条 canonical 路径：对
`outcome_unknown` journal 提交 fresh `external_operation.observe`，或由当前 Owner
以 `project.content.recovery.abandon` 精确 CAS Project、provisioning intent、recovery
action 与 journal。abandon 会完成 action、取消当前 intent，并只在 journal 仍为
`outcome_unknown` 时把它终结为 `abandoned`；既有 `observed_failure` journal 保持事实不变。
它不会恢复 `membership_removal_pending`、Task fence、binding 或 readiness，也没有
project resume/link/兼容命令。后续尝试必须创建新的 provisioning/reconcile intent。

## 前置条件

- Node.js `>=22.12.0`。
- PostgreSQL 17；schema-v12 的 fresh、v4、v5、v9 与 A-v11 升级路线均以 PostgreSQL 17 作为发布门禁。
- npm workspace 安装的仓库依赖。生产发布还必须包含版本完全匹配的 contracts、provider adapter 与 server 包。
- 反向代理必须支持 HTTP/1.1 WebSocket Upgrade；应用默认只监听 loopback。

## 发布来源与桌面/云端版本对齐

仓库只维护一个长期主分支：`gui`。协作云服务不是另一条长期源码分支；功能分支只能短期开发并通过
评审合入 `gui`，不得把功能分支、服务器本地分支、未记录的 `gui` 漂移 HEAD 或 cherry-pick 工作树
直接部署到生产。

每次生产构建先批准一个位于 `gui` 历史中的完整 Git commit，并在该 commit 的同一干净 worktree 中
同时构建、打包以下三个版本匹配的包：

- `@sciforge/collaboration-contracts`
- `@sciforge/collaboration-provider-zulip`
- `@sciforge/collaboration-server`

ECS 的应用代码只允许来自这三个 tarball。服务器不 clone SciForge 仓库，不部署 Electron、renderer、
桌面 domain 源码或整个 workspace，也不在服务器上重新解析另一份源码状态。

桌面应用与协作云服务使用独立的版本号、tag 和 release，可以按各自节奏发布；两端的发布记录都必须
包含完整的 `contractCommit`，兼容配对时该值必须相同。云端 bundle 的 `contractCommit` 就是上述获批的
`gui` commit；桌面 release 也记录同一 commit。两个端的 tag 可以独立指向这个 commit，但 tag 名称或
版本号相同不能代替 commit 校验。

发布记录至少保存：桌面 tag/release、云端 tag/release、完整 `contractCommit`、三个 tarball 的版本和
SHA-256。commit 和 checksum 不是 secret，可以进入发布证明；任何 credential 都不能进入其中。

## 从源码开发

在仓库根目录安装依赖并先构建共享 contract 与 provider composition：

```sh
npm install
npm --workspace @sciforge/collaboration-contracts run build
npm --workspace @sciforge/collaboration-provider-zulip run build
node scripts/collaboration-providers.mjs --generate
npm --workspace @sciforge/collaboration-server run build
```

为开发进程注入专用测试数据库连接后，显式迁移并启动：

```sh
npm --workspace @sciforge/collaboration-server run migrate
npm --workspace @sciforge/collaboration-server run dev
```

`dev` 会读取包目录中可选的 `.env`。该文件只适合本机、必须被 Git 忽略，并且不应保存共享或生产凭据。更安全的做法是由 shell 的临时环境或本地 secret manager 向进程注入数据库连接。

迁移是显式、forward-only、失败即非零退出的发布步骤。schema-v12 只接受五条冻结路线：fresh、共同基线 v4、旧公网 v5、隔离 staging v9、A-v11；v4/v5/v9 先核对机械 catalog fingerprint 并执行 `0011_a_content_space_execution_identity.sql`，随后所有 v11 路线执行 `0012_oidc_only_endpoint_agent_authority.sql`。v12 是唯一 ready 状态；未知、混合或部分 lineage 必须保持 `/readyz` 失败。

`0012` 删除匿名 endpoint challenge、非 Agent credential 与 `agent_nodes.installation_id`，并要求每个 Active Agent 精确绑定一个 Active Device、每个 Device 最多拥有一个 Active Agent。它不会把 installation-only Agent 猜测迁移为 Device authority；存在未绑定 Agent 时迁移会 fail closed。升级前必须在隔离副本验证数据并保留可恢复备份。不要在应用 worker 启动时隐式迁移，也不要让多个 migration unit 并发执行。

构建产物的等价生产命令是：

```sh
npm --workspace @sciforge/collaboration-server run build
node packages/collaboration-server/dist/cli.js migrate
node packages/collaboration-server/dist/cli.js
```

已安装 tarball 时可使用 `sciforge-collaboration-server migrate` 和 `sciforge-collaboration-server`。

## 配置

`.env.example` 与 `deploy/collaboration-server.env.example` 只列变量名和非敏感默认值。生产值应由 systemd credential、secret manager 或权限受限的环境文件注入。

| 变量 | 必需性与默认值 | 说明 |
| --- | --- | --- |
| `SCIFORGE_COLLABORATION_DATABASE_URL` | 必填 | 专用 PostgreSQL 连接串；敏感，禁止输出到诊断 |
| `SCIFORGE_COLLABORATION_DATABASE_POOL_SIZE` | 默认 `10` | 正整数连接池上限 |
| `SCIFORGE_COLLABORATION_LISTEN_HOST` | 默认 `127.0.0.1` | 应保持 loopback，由反向代理对外服务 |
| `SCIFORGE_COLLABORATION_LISTEN_PORT` | 默认 `8787` | 本地监听端口 |
| `SCIFORGE_COLLABORATION_BASE_PATH` | 默认空 | 服务自身处理的路径前缀；代理 strip-prefix 时保持空 |
| `SCIFORGE_COLLABORATION_ALLOWED_ORIGINS` | 默认空 | WebSocket 允许的逗号分隔 Origin；浏览器接入时生产必须显式设置 |
| `SCIFORGE_COLLABORATION_OIDC_ISSUER` | User 操作必填 | 固定 HTTPS issuer；未设置时所有 OIDC User 命令不可用，不能借用其他环境 issuer |
| `SCIFORGE_COLLABORATION_OIDC_AUDIENCE` | 默认 `sciforge-cloud-api` | Access Token 必须包含的目标 audience |
| `SCIFORGE_COLLABORATION_OIDC_ALLOWED_AUTHORIZED_PARTIES` | 默认 `sciforge-desktop,sciforge-web-mobile` | `azp` 精确 allowlist；不能由 token 或请求覆盖 |
| `SCIFORGE_COLLABORATION_PROVIDER_CONFIG_FILE` | 可选 | 非敏感 provider JSON 的绝对路径；未设置时 provider runtime 不启动 |
| `SCIFORGE_COLLABORATION_SECRET_DIRECTORY` | 启用 provider 时必填 | provider secret 文件目录 |

`BASE_PATH` 若设为 `/collaboration`，探针和 API 都位于该前缀下。仓库 Nginx 示例会移除外部 `/collaboration/` 后再反代，所以其对应服务配置应保持空。

### Provider 配置与 secret-file 注入

Provider JSON 只能包含非敏感配置以及指向 secret 文件的 `...SecretReference`。以下内容仅是不可用的结构示例：

```json
{
  "providers": {
    "zulip": {
      "realmUrl": "https://chat.example.invalid",
      "botEmail": "collaboration-bot@example.invalid",
      "credentialSecretReference": "zulip-bot-credential",
      "endpointBindingAssurance": "verified"
    }
  }
}
```

Secret reference 必须是安全 basename，不能包含路径分隔符。Collaboration Server 只把目录与 reference 传给 owning provider；Zulip runtime 会通过 `realpath` 验证目标仍位于 `SCIFORGE_COLLABORATION_SECRET_DIRECTORY` 内，并用 no-follow file descriptor 读取。secret 文件应由服务账号拥有且使用 `0400`/`0600`；group/other 可读或逃逸目录的链接都会 fail closed。API key 只在 Zulip runtime 内形成 Authorization header，并由该 runtime 直接发起 outbound request。

`endpointBindingAssurance` 是 provider 对 endpoint 绑定事实的 assurance，默认为 `verified`。只有部署管理员确认 realm 的登录和账号保护符合强认证政策时才可设为 `strong`；它不会签发 User credential，也不能替代 OIDC Principal。

当前每个已安装 provider contribution 在一个服务实例内只管理一份配置和一个 realm，事件 cursor 也按 provider 持久化。同一 provider 需要多个 realm 时，应使用彼此隔离的服务实例与数据库；运行时检测到跨 realm cursor 会 fail closed。

## 探针、API 与停止

- `GET /healthz`：纯 liveness，只表示进程可响应，不披露环境、数据库或 provider 信息。
- `GET /readyz`：检查 PostgreSQL 可访问且 schema version 已到当前版本；迁移前或数据库故障时不应接流量。
- `POST /v1/commands`：严格 REST command envelope。
- `GET /v1/events`：WebSocket Upgrade，仅发送连接和 inbox 可用性通知。

Loopback 核验示例：

```sh
curl --fail http://127.0.0.1:8787/healthz
curl --fail http://127.0.0.1:8787/readyz
```

收到 `SIGTERM` 或 `SIGINT` 后，进程会停止接受新连接，并依次关闭 provider pump、WebSocket、HTTP 与 PostgreSQL pool。外部服务管理器仍应配置有界停止超时。

## OIDC Endpoint 绑定、Agent 注册与消息同步摘要

User 先由 Identity 模块完成 OIDC/PKCE 登录和 Device 注册。Access Token 只由 Identity 私有运行边界持有；协作包通过无令牌的内部 Cloud transport 发起 OIDC User 命令，调用方不能传入 bearer、任意 URL、method 或 header。

绑定 Human Endpoint 时，已登录 User 通过 `endpoint.challenge.create` 提交精确的 provider、realm 与 provider user ID。服务返回一次性 challenge code；界面提示同一个 provider 身份在 Zulip 私聊 SciForge Bot 发送完整绑定命令：

```text
/bind SF1.<challengeId-material>.<challenge-response>
```

Desktop 使用同一 OIDC Principal 调用 `endpoint.challenge.get` 读取 `pending`、`verified` 或 `expired` 状态；Cloud 会核对 challenge owner，流程没有 poll secret、匿名 redeem、User bearer credential 或第二种角色账号。Provider 事件只在 provider、realm、provider user ID 与 challenge 全部精确匹配时绑定到现有 User。Bot 的成功或安全失败回复进入 provider-identity durable inbox，并沿用 provider delivery ledger、retry、reconciliation 与 ack，不由命令 parser 旁路发送。私聊 `/bind SF1...` 是唯一绑定命令入口；公开 Topic 消息不会验证 challenge。

Agent 注册同样是 OIDC User 命令，必须引用该 User 的 Active Device，并提交一次性的 X25519 bootstrap public key。Cloud 只返回绑定 Agent、Device 和 credential generation 的 `sealedCredential`；协作包在自己的私有运行边界解封，并把 Agent machine credential 写入原生安全存储。响应、IPC、日志、Git 和验收回执都不得携带明文 credential；幂等重放只返回脱敏结果，不会再次下发 sealed material，恢复时必须显式旋转 credential。

个人 Topic 绑定到固定 projection 与 Agent，顺序 inbox/outbox、receipt 和 provider cursor 都持久化在 PostgreSQL。Topic 整体重命名或移动时，provider adapter 保留稳定 topic identity，云端先排入 revision 更新通知，再继续同一个桌面 Session；歧义、部分移动、冲突或旧 revision 都会 fail closed。

HumanNeeded 请求只允许当前 Project Owner 通过 OIDC 已认证的 SciForge Desktop
回答。Provider 消息端点仅用于通知和讨论，不产生权威 Human answer；云端会重新
核对 Owner、Project、Task execution、request revision 与 TTL。

## 测试、构建与打包

常用发布门禁：

```sh
npm --workspace @sciforge/collaboration-contracts run test
npm --workspace @sciforge/collaboration-provider-zulip run test
npm --workspace @sciforge/collaboration-server run typecheck
npm --workspace @sciforge/collaboration-server run test
npm --workspace @sciforge/collaboration-server run build
node scripts/collaboration-providers.mjs --check
npm pack --workspace @sciforge/collaboration-server --dry-run
```

正式 release 应从前述同一精确 `gui` commit 分别打包版本匹配的 contracts、provider adapter 与 server
tarball，生成含完整 `contractCommit` 的 manifest 和校验和，并在空目录通过 clean `npm install`/`npm
ci`、`npm ls`、CLI help、migration loader 和探针 smoke。`npm pack --dry-run` 清单必须包含 `dist/`、
`migrations/`、`deploy/`、`.env.example` 与本 README；不要从源码路径启动发布包，也不要在 ECS 上
构建或补齐缺失产物。具体 bundle 与香港 ECS 安装步骤见
[中文运维手册](../../docs/operations/zulip-aliyun-deployment.zh-CN.md)。

## `deploy/` 文件索引

这些模板随 npm tarball 发布，不包含可用账号或凭据。安装前应按发行版路径、服务账号和备份政策审核。

| 文件 | 用途 |
| --- | --- |
| `collaboration-server.env.example` | 主服务非敏感环境变量模板 |
| `provider-config.example.json` | provider 非敏感配置与 secret reference 模板 |
| `sciforge-collaboration.sysusers` | 创建无登录服务账号与组 |
| `sciforge-collaboration.tmpfiles` | 创建 release、配置、secret 与备份目录及权限 |
| `sciforge-collaboration-migrate.service` | 单次显式数据库迁移 unit |
| `sciforge-collaboration.service` | 主服务 systemd unit，使用 `/usr/bin/env node` 并启用进程隔离 |
| `nginx-app-snippet.conf` | `/collaboration/` strip-prefix、WebSocket Upgrade 与 body/timeouts 示例 |
| `backup-collaboration-db.sh` | `pg_dump` custom-format 原子备份、校验和与本地保留策略 |
| `sciforge-collaboration-backup.service` | 以独立数据库用户执行备份的 oneshot unit |
| `sciforge-collaboration-backup.timer` | 带随机延迟的每日备份 timer |

建议安装顺序是 sysusers、tmpfiles、不可变 release、配置和 secret、migration unit、主服务、Nginx、备份 timer。启动前先运行 migration unit；只有 `/readyz` 成功后才切换外部流量。

备份脚本默认使用 custom format、`--no-owner --no-privileges`、临时文件后原子改名以及 SHA-256 sidecar。生产备份还应复制到加密的异机存储，并定期在隔离环境做恢复演练；只有“能恢复”的备份才算有效。

## 升级与回滚

升级建议使用不可变 release 目录：

1. 核对桌面与云端 release 记录同一 `contractCommit`，并记录三个 tarball 的精确版本和校验和；完成数据库备份并验证 sidecar。
2. 在新 release 空目录 clean 安装，运行测试过的 Node 版本和 CLI smoke。
3. 停止写流量或进入维护窗口，只运行一次显式 migration。
4. 原子切换当前 release，重启服务，等待 `/readyz` 成功后恢复流量。
5. 保留上一份不可变应用 release，确认 provider pump、inbox sequence 与备份 timer 正常。

迁移按前向演进设计，不要把逆向 SQL 当作普通回滚。只有新 schema 与旧应用已验证向后兼容时，才可仅切回上一应用 release；否则应保持维护窗口，根据已演练的恢复流程从迁移前备份恢复数据库，再启动匹配版本。不要让不同版本 worker 同时写同一 schema。

## 安全禁忌

- 不得把数据库口令、API key、私钥、token、Authorization header、endpoint challenge code、Agent machine credential 或解封后的明文写入代码、JSON、日志、文档、Git、shell history、工单或截图。
- 不得把 secret 内联到 provider 配置；只允许权限受限、越界检查后的 secret-file 注入。
- 不得在公开示例中放真实域名、公网 IP、账号、主机路径或现场拓扑；使用 `.invalid`、loopback 和占位名称。
- 不得把应用端口直接暴露到公网。使用 TLS 反向代理、可信 Origin allowlist、请求体上限、速率限制和 WebSocket Upgrade 校验。
- 不得记录 provider 异常的 message、cause、stack、header 或 body。诊断只保留有界安全错误码和白名单名称。
- 不得在 Project Record 或消息中上传本地绝对路径、工作区文件内容或 secret；只同步 contract 明确允许的协作数据。
- 不得从不可信备份直接恢复；校验完整性、限制读取权限，并在隔离环境验证后再进入恢复窗口。
- 不得从 `gui` 以外的长期分支、未合入功能分支、未固定 branch HEAD 或服务器工作树发布；生产输入只能是获批 `gui` commit 构建的三个 tarball。

本包采用 MIT 许可证；部署者仍需自行满足数据库、消息 provider、数据保留和用户隐私方面的合规要求。
