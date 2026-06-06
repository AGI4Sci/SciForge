# 运行手册：Runtime Codex 与 Model Router

最后更新：2026-06-06

本文记录 Runtime Codex 使用 Model Router 的最小运行边界。产品语义以 [`../../PROJECT.md`](../../PROJECT.md)、[`../Architecture.md`](../Architecture.md) 和 [`../ModelRouterArchitecture.md`](../ModelRouterArchitecture.md) 为准。

## 默认路径

```text
Runtime Codex
  -> public router alias
  -> Model Router /v1/responses
  -> profile-selected text reasoner / vision translator
```

公开 UI 和 audit surface 可以展示 router alias、profile、capability、role coverage 和 readiness。不得展示私有 provider URL、API key、secret env 名称、raw upstream model slug 或 raw provider payload。

## 配置原则

- Runtime Codex 使用稳定 public alias，例如 `sciforge-router`。
- Model Router profile 拥有真实 provider、base URL、key env 和 model slug。
- workspace override 只改变文件 / action scope，不能改变 provider、secret 或 raw model selection。
- trace root 默认使用当前 workspace 下的 refs-first 目录，例如 `.sciforge/model-router-traces`。

## Trace 要求

trace bundle 可以包含 profile id、public alias、role names、latency、status、modality refs、hash、尺寸和脱敏错误摘要。

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
