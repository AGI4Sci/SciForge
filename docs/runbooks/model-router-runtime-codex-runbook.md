# 运行手册：Runtime Codex 与 Model Router

最后更新：2026-06-08

本文记录 Runtime Codex 使用 Model Router 的最小运行边界。产品语义以 [`../../PROJECT.md`](../../PROJECT.md)、[`../Architecture.md`](../Architecture.md) 和 [`../ModelRouterArchitecture.md`](../ModelRouterArchitecture.md) 为准。

## 默认路径

```text
Runtime Codex / Agent Host
  -> model_provider=sciforge-model-router
  -> base_url=http://127.0.0.1:<router>/v1
  -> model=sciforge-router public alias
  -> Model Router /v1/responses
  -> profile-selected text reasoner / vision translator
```

Agent Host 的模型能力来自 Model Router。Model Router 只是多模态 API 边界，不是 workflow owner；Browser、Computer Use、artifact/verifier 都是 Agent Host 可调用能力，不由 Router 决定是否调用。SciForge UI 只消费 Codex App Server protocol events，并由 assistant final message 生成 `FinalAnswerEnvelope`。

公开 UI 和 audit surface 可以展示 router alias、profile、capability、role coverage 和 readiness。不得展示私有 provider URL、API key、secret env 名称、raw upstream model slug 或 raw provider payload。

## 启动顺序

先启动 Model Router，再启动或准备 Runtime Codex。

```bash
npm run backend:model-router -- --host 127.0.0.1 --port <router>
```

开发桌面 / dev shell 可以使用托管 Router；`npm run dev` 会按 `SCIFORGE_MODEL_ROUTER_PORT` 或默认 `3892` 启动 / 复用 Router，并输出 `http://127.0.0.1:<router>/v1`。

Runtime Codex setup 必须指向 Router，而不是 raw provider：

```toml
[profiles.sciforge-runtime-default]
model = "sciforge-router"
model_provider = "sciforge-model-router"

[model_providers.sciforge-model-router]
name = "SciForge Model Router"
base_url = "http://127.0.0.1:<router>/v1"
env_key = "SCIFORGE_RUNTIME_API_KEY"
wire_api = "responses"
```

验收和 local dogfood 中看到的 Runtime Codex request URL 应该是 `http://127.0.0.1:<router>/v1/responses`，model 应该是 `sciforge-router` 或等价 public alias。不能把 Runtime Codex base URL 指向成员模型 provider，也不能把 Runtime Codex model 写成 raw upstream model slug。

## 配置原则

- Runtime Codex 使用稳定 public alias，例如 `sciforge-router`。
- Model Router profile 拥有真实 provider、base URL、key env 和 model slug。
- `config.local.json` 只作为 Model Router 成员模型配置来源，用来填充 text / vision role 的 provider、base URL、model 和 key env；它不是 Runtime Codex 直连 provider 配置。
- workspace override 只改变文件 / action scope，不能改变 provider、secret 或 raw model selection。
- trace root 默认使用当前 workspace 下的 refs-first 目录，例如 `.sciforge/model-router-traces`。
- Codex app-server 启动参数不得注入 GUI MCP、`gui.present` shim、`SCIFORGE_GUI_EXTENSION_STATE` 或 `moduleId=gui` completion surface；旧 GUI dynamic tool 请求必须返回 unsupported。
- GUI projection 不是 Agent Host 工具调用结果，也不代表 turn completion；最终是否继续或结束由 Codex App Server turn lifecycle 决定。

## 验收口径

- release / strict acceptance 先要求 Router 可用，再要求 Runtime Codex 配置指向 `http://127.0.0.1:<router>/v1` 和 `sciforge-router` public alias。
- local ignored config 可以证明 Router 成员模型 env 已存在且被脱敏处理，不能单独证明 release acceptance。
- provider preflight、trace audit 和 runtime audit 都只能展示 Router public metadata、role readiness 和 refs-first trace；不得把 raw upstream endpoint、raw model slug、secret env 名称或 provider payload 提升为产品证据。
- 用户级 final answer、blocker、needs-human 和 completion truth 必须由 Agent Host 产出；Router output 只能作为模型输出或 evidence input。

## Trace 要求

trace bundle 可以包含 profile id、public alias、role names、latency、status、modality refs、hash、尺寸和脱敏错误摘要。

vision translation cache 命中可以记录 `cacheStatus`、content hash 和 bounded observation summary。trace 不得把 cache 描述成对象记忆、workflow state 或 final answer。

trace bundle 不得包含：

- API key 或 Authorization。
- secret header。
- raw provider request / response。
- 长期保存的 base64 image payload。
- 私有 endpoint URL。
- raw upstream model slug。
- 本机绝对路径。

## 修改后检查

修改 Runtime Codex 默认配置、Model Router public metadata 或 trace redaction 时，优先运行相关 focused tests，并至少运行：

```bash
git diff --check -- docs packages/backend packages/workers/model-router src/runtime
```

如果需要 release 级 live provider 证据，再单独运行 trace audit；live provider audit 不能替代 Browser / Computer Use 用户级最小闭环。
