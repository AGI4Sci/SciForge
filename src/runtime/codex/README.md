# Codex runtime bridge

本目录是 RUNTIME-REWRITE-20260519 的后端薄桥接层，只负责把 SciForge 的 terminal-equivalent 文本命令交给 Runtime Codex app-server，并把 app-server rich-client 事件归一化为稳定事件。

边界：

- 生产 adapter 只调用或连接 `codex app-server --listen stdio://`，并通过 `thread/start` / `thread/resume` + `turn/start` 驱动 runtime。
- `CodexExecJsonAdapter` / `codex exec --json` 只保留为 legacy/test-only 兼容和历史证据，不作为产品自动 fallback。
- 多轮只允许通过上游 Codex app-server thread 语义恢复；GUI 不拼接历史 transcript。
- Runtime Codex 强制使用 `packages/backend/.codex-runtime/codex-home` 作为 `CODEX_HOME`。
- 缺 workspace、runtime profile、DeepSeek proxy key 或 proxy 配置时 fail closed。
- `allowOpenAiRuntime` 未显式开启时，不允许 OpenAI-looking runtime endpoint。
- stderr 和 raw app-server/legacy JSONL 只作为 audit/debug 事件，不进入主回复文本。
- GUI 不得把历史 transcript 拼进 `commandText`；无选中 ref 时 command text 必须是用户原文，有选中 ref 时只能是终端等价 `ask --ref ... "<prompt>"`。

RT-02 realtime 状态：

- 当前主聊天桥接优先使用 WebSocket：`/api/sciforge/runtime/codex/realtime/ws` 发送 terminal-equivalent text，并接收结构化事件。
- `realtimeSession` envelope 是 Codex-native session 语义标记，允许 `eventTransport: "websocket"`；HTTP SSE `POST /api/sciforge/runtime/codex/stream` 仍作为非浏览器/测试 alternate transport，不是 exec runtime fallback。
- WebSocket 完成条件由 focused tests 覆盖：共享 envelope 允许 WebSocket transport，runtime server 接入 HTTP upgrade route，UI client over WebSocket 双向发送请求并读取 structured events。

Legacy exec 条件：

- `CodexExecJsonAdapter` 不再进入默认 runtime 路径；只允许在 focused legacy tests、历史 evidence replay 或显式迁移审计中使用。
- 删除 legacy 细节前必须保留 `NormalizedAgentEvent` 等 GUI-facing 合约，或提供等价迁移层，并跑 targeted runtime tests、`npm run typecheck`、`git diff --check` 和真实浏览器验收。
