# Codex Runtime Migration

最后更新：2026-05-30

## 结论

SciForge 长期只支持 Codex backend。生产 runtime 的默认入口必须是上游 Codex app-server：

1. **Product path：Codex app-server**
   SciForge 启动或连接 `codex app-server`，通过 `thread/start`、`turn/start`、`item/started`、`item/agentMessage/delta`、`item/completed`、approval request 和 dynamic tool request 等 rich-client 事件驱动 GUI。

2. **Adapter boundary：`AgentCliAdapter`**
   `AgentCliAdapter` 只隔离 runtime 进程、JSON-RPC/event normalization 和测试替身；它不得把 `codex exec --json` 重新引入产品默认路径。

`CodexExecJsonAdapter` / `codex exec --json` 只保留为 legacy/test-only 兼容和历史证据。新产品入口不能自动 fallback 到 exec；缺 app-server、runtime profile、Model Router 或必要配置时必须 fail closed。

## 不 Fork Codex

默认不 clone、不修改 Codex 源码。

优先级：

1. 使用已安装的上游 Codex CLI。
2. 使用 Codex custom model provider 配置接入 SciForge Model Router public alias/profile。
3. 如果某个 provider API 与 Codex provider wire API 不兼容，在 SciForge 维护 provider-specific compatibility adapter。
4. 只有配置和 proxy 都无法满足时，才 fork Codex。

如果必须 fork，必须新增 `docs/CodexUpstreamPatchLog.md`，记录：

- upstream commit；
- 修改文件；
- 修改原因；
- rebase 步骤；
- 验证命令；
- 回滚策略。

## 两个 Codex 实例

开发 SciForge 和 SciForge 运行期服务必须隔离。

```text
Dev Codex
  purpose: edit SciForge repo
  model: GPT-5.5 or developer-selected model
  cwd: SciForge repo
  config/profile: developer profile
  audit: git commit / tests / browser evidence

Runtime Codex
  purpose: serve SciForge user tasks
  model provider: SciForge Model Router profile by default
  cwd: user workspace, not the SciForge repo unless explicitly debugging SciForge
  config/profile: sciforge-runtime-default
  audit: model-router profile, role aliases, workspace, and command id visible in SciForge UI
```

The runtime instance must never silently inherit the developer Codex profile.

## Profile 隔离

推荐维护一个 runtime profile，例如 `sciforge-runtime-default`。当前 release smoke gate 以 Model Router public alias/profile 路径为准；文档只描述公开 alias 和 role，不把 provider URL、API key 或 raw model slug 写成产品默认值：

```toml
model = "textReasoner"
profile = "sciforge-runtime-default"

[profiles.sciforge-runtime-default]
model = "textReasoner"
model_provider = "sciforge-model-router"
model_reasoning_effort = "low"
model_reasoning_summary = "none"

[model_providers.sciforge-model-router]
name = "SciForge Model Router"
base_url = "<service-managed-model-router-responses-url>"
env_key = "SCIFORGE_RUNTIME_API_KEY"
wire_api = "responses"
```

这个文件由本地 setup 命令生成或刷新：

```bash
npm run backend:codex-runtime:setup -- --overwrite --model-router-base-url <local-model-router-v1-url>
```

用于 browser/release acceptance 的 `SCIFORGE_RUNTIME_API_KEY` 不写入 `config.toml`、`config.local.json` 或仓库文件。只在启动 Runtime Codex / Model Router 的 service 环境里设置；ignored local config 中的 LLM key 只能作为 Model Router 成员模型配置，不能满足 Runtime Codex acceptance：

```bash
export SCIFORGE_RUNTIME_API_KEY="<provider-api-key>"
```

SciForge 启动 runtime Codex app-server 时必须使用隔离 runtime profile。app-server thread/turn 请求负责携带 workspace、model/provider、approval policy 和 sandbox：

```bash
codex app-server --listen stdio://
```

文献检索、PDF/full-text 读取、PubMed/网页核查等任务依赖 Runtime Codex shell 内可用 DNS/HTTP。保持 `workspace-write` sandbox，但显式配置 `sandbox_workspace_write.network_access=true`；不要用 host shell 成功替代 Runtime Codex live evidence。

开发实例可以使用自己的 profile：

```bash
codex --model gpt-5.5 -C /path/to/SciForge
```

## Runtime Cost Guard

SciForge runtime bridge 必须做成本保护：

- 默认 profile 必须是 SciForge Model Router public alias/profile。
- 缺少 `SCIFORGE_RUNTIME_API_KEY`、Model Router service route、runtime profile 或 runtime provider table 时 fail closed。
- 当前 smoke gate 要求 provider `sciforge-model-router`、model alias `textReasoner`、`env_key = "SCIFORGE_RUNTIME_API_KEY"` 和 `wire_api = "responses"`。
- 不允许自动 fallback 到 OpenAI provider。
- 不提供 `allowOpenAiRuntime` 绕过；OpenAI 或其它成员模型只能作为 Model Router 成员配置。
- 每个 run 的 provider、model、profile、workspace、command id 必须写入 audit event，并在 GUI 可见。

## Model Router Runtime Endpoint

`packages/backend` 的 Model Router 对外暴露 OpenAI-compatible `/v1/responses`。Runtime Codex profile 的 `base_url` 指向 service-managed router endpoint；provider URL 和 raw model slug 由 router profile 解析，不作为产品默认公开契约。

解析顺序：

1. `SCIFORGE_MODEL_ROUTER_BASE_URL`
2. `SCIFORGE_MODEL_ROUTER_URL`
3. `SCIFORGE_MODEL_ROUTER_PORT`，解析为 `http://127.0.0.1:<router>/v1`
4. 开发 shell 托管的默认 Router 端口，不解析 Runtime 直连 provider URL

推荐 no-secret setup：

```bash
export SCIFORGE_RUNTIME_API_KEY="<runtime-api-key>"
export SCIFORGE_MODEL_ROUTER_BASE_URL="http://127.0.0.1:<router>/v1"
npm run backend:model-router -- --host 127.0.0.1 --port <router>
```

`config.local.json` 只作为 Model Router 成员模型配置来源：

```json
{
  "modelRouter": {
    "profiles": {
      "sciforge-runtime-default": {
        "text": {
          "provider": "openai-compatible",
          "baseUrlEnv": "SCIFORGE_TEXT_BASE_URL",
          "apiKeyEnv": "SCIFORGE_TEXT_API_KEY",
          "modelEnv": "SCIFORGE_TEXT_MODEL"
        },
        "vision": {
          "provider": "openai-compatible",
          "baseUrlEnv": "SCIFORGE_VISION_BASE_URL",
          "apiKeyEnv": "SCIFORGE_VISION_API_KEY",
          "modelEnv": "SCIFORGE_VISION_MODEL"
        }
      }
    }
  }
}
```

本地 parser 仍能读取成员模型配置作为显式调试 fallback，但 release acceptance 和团队文档路径不得依赖明文 secret 文件。Browser acceptance gate 会显式拒绝只存在于 `config.local.json` 或 `.sciforge/**/config.local.json` 的 secret-like key；没有 Model Router `/v1` base URL 时，Runtime/API 服务必须 blocked；没有 service 环境 `SCIFORGE_RUNTIME_API_KEY` 时，Runtime Codex wrapper 和 browser acceptance gate 都必须 fail closed。

Model Router 的 `GET /healthz` 和 `npm run smoke:runtime-provider-preflight` 只做 live default-chat 前分诊：它会以短超时检查 Router readiness，输出 `config-missing` / `provider-auth` / `rate-limited` / `upstream-outage` / `repo-bug` / `ready`，并 scrub raw provider body、header 和 token。`verify:single-agent-final` 与 `verify:single-agent-release` 会在 browser acceptance 前运行该 preflight，但结果的 `releaseAcceptance` 固定为 `not-evaluated`，不能替代 Codex in-app browser strict acceptance。

## Phase 1 Adapter

最小实现：

```ts
type AgentCliAdapter = {
  startTurn(input: {
    commandText: string;
    workspacePath: string;
    profile: string;
  }): AsyncIterable<NormalizedAgentEvent>;
  cancel(turnId: string): Promise<void>;
};
```

Codex app-server adapter：

```text
spawn/connect codex app-server --listen stdio://
initialize -> thread/start or thread/resume -> turn/start
thread/turn/item/approval/dynamic-tool JSON-RPC events -> NormalizedAgentEvent
stderr/process lifecycle -> audit/debug event
```

新会话走 `thread/start`，多轮上下文走 `thread/resume` + `turn/start`。GUI 历史 transcript、provider route、capability policy 或 artifact body 不得拼进 `commandText`；上下文恢复必须依赖 Codex app-server thread 语义。

## Adapter Boundary

Adapter 只抽象 runtime host 细节，不扩展 backend 范围：

- `AgentCliAdapter` 负责进程生命周期和事件归一化。
- `CodexAppServerAdapter` 是唯一生产 runtime adapter。
- `CodexExecJsonAdapter` 只能用于 legacy/test-only 兼容和历史回归，不进入默认产品路径，也不能作为自动 fallback。
- GUI 只消费 `NormalizedAgentEvent`，不直接解析 Codex JSON-RPC 或 legacy JSONL。

## Desktop Runtime Productization

短中期桌面封装以 Electron 为生产壳，runtime 迁移必须提前收敛到可被 Electron main process 嵌入和管理的形态。这个阶段不引入新的 agent backend，也不把 Tauri 作为主线。

短期 POC 必须证明：

- Electron main 可以加载 `vite build` 产物，而不是启动 Vite dev server。
- Electron main 可以启动、停止并观测 workspace server、Model Router 和 Runtime Codex 进程。
- Renderer 只通过稳定 IPC 或 loopback API 发送用户命令、读取 normalized events 和 audit events。
- 一次真实 Codex-backed run 能在桌面窗口内完成，并展示 provider/model/profile/workspace/command id。

中期 runtime 边界必须具备：

- Production runtime launcher：统一管理端口或 IPC、进程生命周期、崩溃退出、stderr/stdout audit、ready/health 状态和 graceful shutdown。
- App data layout：应用全局配置、Runtime Codex home、日志、缓存和用户 workspace `.sciforge/` 状态分离；路径使用系统 app data 目录，而不是依赖仓库内临时路径。
- Platform service：集中封装 open external、reveal in folder、terminal command、path quoting、kill process、permission probe 等 macOS/Windows/Linux 差异。
- Secret storage：provider API key 默认进入系统 keychain/credential store；明文配置只能作为显式调试 fallback。
- Packaging gates：桌面 smoke 至少覆盖 cold start、runtime health、真实 run、artifact open/follow-up、debug/audit folded、provider fallback 禁止和退出清理。

开发期端口约定仍可用于 Vite/browser 验收；生产桌面端不得把 `5173` 或其它固定开发端口写成用户可见契约。实际使用 loopback 端口时，launcher 必须选择空闲端口并把绑定信息只通过受控配置传给 renderer。

## Browser E2E Gate

迁移完成必须通过真实浏览器验证：

- 从默认入口提交真实任务；
- SciForge 显示本轮 provider/model/profile；
- 主回复解决用户 hard requirements；
- artifact 可打开、可追问；
- debug/audit 默认折叠；
- 没有隐藏 OpenAI 请求；
- run audit 能证明使用的是 SciForge Model Router profile 和 role aliases。

当前 package smoke gate 中，`npm run verify:single-agent-final` 包含 `npm run smoke:runtime-provider-preflight`、`npm run smoke:runtime-codex-browser-acceptance`、`npm run smoke:fixed-platform-boundary` 和 `npm run smoke:single-agent-final-gate`。preflight 只用于在 browser acceptance 前分诊 provider/upstream 状态；默认浏览器 acceptance smoke 允许写出 blocked evidence 来证明 fail-closed。`npm run verify:single-agent-release` 额外先执行 `npm run desktop:package:dir`，再进入 strict browser acceptance，保证 release 前 packaged/production Electron lifecycle 也被验证。release rerun 必须使用 strict gate：

```bash
npm run smoke:runtime-codex-browser-acceptance:strict
```

strict mode 只接受真实 Codex in-app browser evidence 产生的 `manifest.status === "passed"`。blocked、partial、failed、seed/demo evidence、缺少 DOM/screenshot、缺少 command id、缺少 task result，或 multi-turn 第二轮答案不可见，都不能作为 release acceptance。

## AgentServer 遗留清理地图

当前 AgentServer-first 清理清单已经并入仓库级任务板和 package gate。删除或 quarantine
AgentServer gateway 模块与 smoke 脚本前，必须先满足 `PROJECT.md` 中的 Runtime Codex
真实 R-* 验收、`npm run smoke:runtime-codex-truth-source`、`npm run smoke:no-legacy-paths`
和显式 `npm run verify:legacy-agentserver-compat` 退役检查。默认 `smoke:all` 和
`smoke:real-task-matrix` 不再把 AgentServer-first 脚本作为 release truth source；`smoke:real-task-matrix`
还会执行 `smoke:real-task-offline-gates`，把所有 no-secret R-* 类别 gate 纳入同一个矩阵检查。
旧 AgentServer 脚本只能作为显式兼容覆盖运行。
