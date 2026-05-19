# Codex runtime bridge

本目录是 RUNTIME-REWRITE-20260519 的后端薄桥接层，只负责把 SciForge 的 terminal-equivalent 文本命令交给 Runtime Codex，并把 `codex exec --json` 的 stdout JSONL 归一化为稳定事件。

边界：

- 生产 adapter 只调用 `codex exec --json --profile sciforge-runtime-deepseek --cd <workspace> <command>`。
- 多轮只允许通过上游 Codex 原生 `codex exec resume --json <codexSessionId> <command>` 恢复；`codexSessionId` 来自 Codex JSONL/session store。
- Runtime Codex 强制使用 `packages/backend/.codex-runtime/codex-home` 作为 `CODEX_HOME`。
- 缺 workspace、runtime profile、DeepSeek proxy key 或 proxy 配置时 fail closed。
- `allowOpenAiRuntime` 未显式开启时，不允许 OpenAI-looking runtime endpoint。
- stderr 和 raw JSONL 只作为 audit/debug 事件，不进入主回复文本。
- GUI 不得把历史 transcript 拼进 `commandText`；无选中 ref 时 command text 必须是用户原文，有选中 ref 时只能是终端等价 `ask --ref ... "<prompt>"`。

退役条件：

- 当 SciForge 默认路径切到 Codex app-server 或上游 Codex 提供长期 thread 的稳定结构化事件 API 后，可以退役 `CodexExecJsonAdapter` 的进程/JSONL 细节。
- 退役前必须保留 `NormalizedAgentEvent` 等 GUI-facing 合约，或提供等价迁移层，并跑 targeted runtime tests、`npm run typecheck`、`git diff --check` 和真实浏览器验收。
