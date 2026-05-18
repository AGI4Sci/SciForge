# Codex Runtime Migration

最后更新：2026-05-19

## 结论

SciForge 长期只支持 Codex backend。迁移路线只做两阶段：

1. **Phase 1：`codex exec --json`**
   SciForge 通过一个轻量 bridge 启动 Codex CLI，向 stdin / prompt 发送 terminal-equivalent text，消费 stdout JSONL event stream，并归一化为 GUI event bus。

2. **Phase 2：`AgentCliAdapter`**
   抽象出最小 CLI adapter，使同一条 GUI -> text、CLI -> events 的链路可测试、可 mock、可替换。虽然长期只支持 Codex backend，但 adapter 能避免 SciForge 直接散落 `spawn("codex", ...)` 细节。

暂不把 Codex app-server 作为迁移主路径。app-server 适合后续需要长期 thread、审批、历史和富客户端状态时再接入。当前先用 `codex exec --json` 降低迁移复杂度。

## 不 Fork Codex

默认不 clone、不修改 Codex 源码。

优先级：

1. 使用已安装的上游 Codex CLI。
2. 使用 Codex custom model provider 配置接入 DeepSeek。
3. 如果 DeepSeek API 与 Codex provider wire API 不兼容，新增 SciForge 自己维护的 `codex-provider-proxy`。
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
  model provider: DeepSeek deepseek-v4-flash by default
  cwd: user workspace, not the SciForge repo unless explicitly debugging SciForge
  config/profile: sciforge-runtime-deepseek
  audit: provider/model/run id visible in SciForge UI
```

The runtime instance must never silently inherit the developer Codex profile.

## Profile 隔离

推荐维护一个 runtime profile，例如 `sciforge-runtime-deepseek`：

```toml
model = "deepseek-v4-flash"
model_provider = "sciforge-deepseek"

[model_providers.sciforge-deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.example/v1"
env_key = "DEEPSEEK_API_KEY"
```

如果 Codex custom provider 不能直连 DeepSeek，则把 `base_url` 指向本地 proxy：

```toml
model = "deepseek-v4-flash"
model_provider = "sciforge-deepseek-proxy"

[model_providers.sciforge-deepseek-proxy]
name = "SciForge DeepSeek Proxy"
base_url = "http://127.0.0.1:4765/v1"
env_key = "DEEPSEEK_API_KEY"
```

SciForge 启动 runtime Codex 时必须显式指定 profile：

```bash
codex exec --json \
  --profile sciforge-runtime-deepseek \
  --cd "$SCIFORGE_USER_WORKSPACE" \
  --sandbox workspace-write \
  "$SCIFORGE_USER_TEXT_COMMAND"
```

开发实例可以使用自己的 profile：

```bash
codex --model gpt-5.5 -C /path/to/SciForge
```

## Runtime Cost Guard

SciForge runtime bridge 必须做成本保护：

- 默认 profile 必须是 DeepSeek / proxy。
- 缺少 `DEEPSEEK_API_KEY` 或 runtime profile 时 fail closed。
- 不允许自动 fallback 到 OpenAI provider。
- 只有用户显式设置 `allowOpenAiRuntime=true` 时才允许 OpenAI provider。
- 每个 run 的 provider、model、profile、workspace、command id 必须写入 audit event，并在 GUI 可见。

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

Codex adapter：

```text
spawn codex exec --json --profile <profile> --cd <workspace> <commandText>
stdout JSONL -> NormalizedAgentEvent
stderr -> audit/debug event
exit code -> turn completed / failed
```

Phase 1 不要求长期会话。每次用户任务可以是一个独立 `codex exec --json` turn。

## Phase 2 Adapter

Phase 2 只抽象 CLI 细节，不扩展 backend 范围：

- `AgentCliAdapter` 负责进程生命周期和事件归一化。
- `CodexExecJsonAdapter` 是唯一生产 adapter。
- 其它 adapter 只能用于测试或实验，不进入默认产品路径。
- GUI 只消费 `NormalizedAgentEvent`，不直接解析 Codex JSONL。

## Browser E2E Gate

迁移完成必须通过真实浏览器验证：

- 从默认入口提交真实任务；
- SciForge 显示本轮 provider/model/profile；
- 主回复解决用户 hard requirements；
- artifact 可打开、可追问；
- debug/audit 默认折叠；
- 没有隐藏 OpenAI 请求；
- run audit 能证明使用的是 DeepSeek/profile/proxy。
