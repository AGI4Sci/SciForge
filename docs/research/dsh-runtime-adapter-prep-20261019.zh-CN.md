# DSH 作为第三个 Agent Runtime —— 适配前收尾实测报告

日期：2026-10-19。前置报告：`Claude outputs/DSH作为第三个Runtime_可行性实测_20261017.md`（下称"前报"）。
本报告只覆盖前报遗留的计划阶段 0 事项：残留内置项可关性（0.1）、版本与许可证（0.2）、异常路径（0.3）。
实测环境：` _dsh-probe/`（git 已排除），DSH 0.2.0-rc.2，`dsh --profile acp`，`DSH_TELEMETRY_MODE=DISABLED`，`DSH_HOME` 指向隔离目录。

**实测替身说明（诚实声明）**：前报真实对话走 paratera 端点；本次环境无 paratera/官方 key，
改用环境中已有的 `OPENROUTER_API_KEY`（经环境变量传递，未写入任何文件；该变量值内含换行，使用方需自行剥离空白），
`DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1`，模型 `deepseek/deepseek-v4.1-flash`。
OpenRouter 是"严格 Anthropic 兼容"端点，与 DeepSeek 原生 API 有两处差异需要 shim（详见 §4 环境坑），
**官方 DeepSeek API 不需要这些 shim（前报 2026-10-17 已实测通过）**。所有结论均基于 wire 级证据
（本地日志代理抓取 DSH 实际发出的 LLM 请求/响应），不止于模型自述。

## 0. TL;DR（实现 agent 必读的 5 件事）

1. 三个残留内置项**全部可关**，最终 patch 见 `_dsh-probe/sciforge-runtime-final.yml`；关掉后模型工具面只剩宿主 MCP 工具（wire 级验证：5 个工具 → 1 个）。
2. **宿主 MCP 工具不触发 `session/request_permission`**（实测直接执行）。权限门只对沙箱升级类内置操作生效——适配器不能把审批卡片寄托在 DSH 的权限请求上，宿主工具的门控要在 MCP server 侧自己做。
3. **权限请求无 DSH 侧超时**：不应答时 turn 挂起 ≥148s 无任何事件；"stopReason: cancelled"只出现在连接关闭/进程收尾时（前报的"未应答即 cancelled"实为关停假象）。
4. **崩溃无优雅错误**：SIGKILL 后宿主只读到 stdout EOF + exit signal=SIGKILL，进行中的 prompt 请求永远无响应；适配器必须以"子进程退出"事件本身作为崩溃判定依据。
5. **跨进程 resume 可用**：session 持久化在 `$DSH_HOME/sessions`（jsonl），新进程 `initialize → session/resume(同 sessionId)` 后完整记得上下文（实测召回暗号成功）。

## 1. 残留内置项可关性（任务 0.1）

判定方法：DSH 每轮把工具清单放进真实的 LLM 请求体（经本地代理抓包）。以下均给出抓包证据。

### 1.1 `exit_plan_mode` —— 可关

- **patch 片段**：`- id: plan-mode / disabled: true`（插件 `@deepseek-ai/dsh-plan-mode`，dsh-base 行 id `plan-mode`；工具在插件 apply 时无条件 `ctx.tools.register`）。
- **证据**：base patch 请求体 tools=`[exit_plan_mode, list_mcp_resource_templates, list_mcp_resources, mcp__echo__echo, read_mcp_resource]`；加入该行后 tools=`[mcp__echo__echo]`。模型自述工具清单同步变化。
- **对适配器的影响**：无。关掉后无 plan 模式概念，适配器 capabilities 不需要声明 plan 相关能力。

### 1.2 MCP 资源助手（`read_mcp_resource` / `list_mcp_resources` / `list_mcp_resource_templates`）—— 可关

- **patch 片段**：`- id: mcp-resources / disabled: true`（插件 `@deepseek-ai/dsh-mcp-resources`）。
- **证据**：同上抓包，三个工具从请求体消失。
- **静态佐证 + 实测**：消费者 `dsh-mcp-client` 用 `ctx.inject(["mcpResources"], …)` 可选注入，关掉后 MCP 服务器的 **工具调用仍正常**（echo 实测往返通过）。资源（resources）能力随之一并消失——SciForge 宿主若用 MCP resources 传递东西需注意。
- **对适配器的影响**：无功能损失；工具面更干净。

### 1.3 `tool-result-pruner` —— 可关（非模型面，证据为"配置被接受 + 会话正常"）

- **patch 片段**：`- id: tool-result-pruner / disabled: true`（插件 `@deepseek-ai/dsh-compaction-tool-result-pruner`）。
- **证据**：该行不是模型工具，不出现在请求体；其唯一消费者 `dsh-compaction-basic` 用可选 `ctx.get("toolResultPruner")` 读取（源码佐证），关掉后多次会话（prompt/工具调用/取消/resume）全部正常。即"配置生效且无静默故障"——若该行 id 写错会被**静默忽略**（见 3.5），因此这里以"会话功能完整 + 源码消费方可选"作为可关证据。
- **对适配器的影响**：超长工具结果不再被预裁剪，全部内联进上下文；宿主 MCP 工具返回大结果时会更快撑大上下文（`usage_update` 会如实上报 `used/size`），实现时可再评估是否恢复。

## 2. 版本与许可证（任务 0.2）

| 包 | 版本 | license |
| --- | --- | --- |
| `@deepseek-ai/dsh`（CLI） | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-acp-app`（profile 包） | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-acp`（ACP 协议实现） | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-sdk-app` / `dsh-sdk-jsonrpc-server` | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-llm-deepseek`（LLM seam） | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-mcp-client` / `dsh-mcp-resources` | 0.2.0-rc.2 | MIT |
| `@deepseek-ai/dsh-plan-mode` / `dsh-compaction-tool-result-pruner` / `dsh-base` / `dsh-agent` / `dsh-session-persistence-jsonl` | 0.2.0-rc.2 | MIT |
| `@agentclientprotocol/sdk`（ACP 官方 SDK，已随 DSH 装在 _dsh-probe） | 1.4.0 | Apache-2.0 |

- `dsh` LICENSE 文件头实测为 MIT（Copyright 2026 DeepSeek）。前报提到的 `dsh-headless`（BSD-3）**不在本安装中**，ACP 路径不需要它。
- **ACP 协议版本**：`initialize` 返回 `protocolVersion: 1`；`agentInfo = { name: "deepseek-harness-acp", version: "0.0.1" }`；`authMethods: []`。
- 预发布状态未变：**全部 0.2.0-rc.2，需要钉版本**。
- 环境补充：无 `engines` 声明；安装树含 `libreoffice-kit-darwin-arm64` 等平台二进制（体积与打包注意事项，不影响 ACP 功能）。

## 3. 异常路径（任务 0.3）

每步均用真实 turn（模型在跑），事件时间轴来自驱动日志（`probe-drive.mjs`，JSONL 存 `/tmp/dsh-probe-*.jsonl`）。

### 3.a 崩溃：turn 进行中 SIGKILL —— 已实测

- **结论**：宿主侧**没有任何错误事件、没有 JSON-RPC error、没有部分结果**。进行中的 `session/prompt` 请求（id=3）永远收不到响应；唯一信号是 stdout EOF 与 child exit（`signal=SIGKILL`）。
- **证据**：prompt 发出 1.5s 后 SIGKILL；帧记录只有 resp:1/resp:2，exit 事件 `code=null signal=SIGKILL`。
- **对适配器错误映射的影响**：适配器必须监听子进程 `exit`/`close`，把"有未完成 prompt 请求时进程死亡"映射为 runtime 崩溃错误（如 `RuntimeExitedUnexpectedly`），并触发宿主的重连/resume 策略；不能等 JSON-RPC 层报错——它不会来。

### 3.b 取消：turn 进行中 `session/cancel` —— 已实测

- **结论**：取消干净利落地工作，无论 LLM 流是否已开始。取消通知发出后 ≤12ms 收到 prompt 响应 `{"stopReason":"cancelled"}`；可能有一帧竞态的尾部 `agent_message_chunk` 先到；进程保持存活（可继续 prompt）。
- **证据**（两次）：①流式中途取消：1.5s 时 cancel，12ms 后 `stopReason:"cancelled"`，之前有一帧 partial chunk。②首个 chunk 到达前取消：同样 7ms 后 cancelled。
- **对适配器错误映射的影响**：`interruptTurn` 的完成信号就是 prompt 请求响应里的 `stopReason:"cancelled"`；适配器应把它映射为"用户取消"而非错误。注意尾部 chunk 可能晚于 cancel 到达，UI 层需容忍。

### 3.c 跨进程恢复：`session/new` → 杀进程 → 新进程 `initialize` → `session/resume` → 再 prompt —— 已实测

- **结论**：**记得上下文，完整恢复**。会话持久化在 `$DSH_HOME/sessions/<workspace-slug>/<sessionId>/`（jsonl），checkpoint 在每个模型请求前落盘。
- **证据**：进程 A 建立会话、告知暗号 PINEAPPLE-742、正常结束（SIGTERM 退出）；进程 B `initialize → session/resume(sessionId, 同 cwd, 同 mcpServers) → prompt 问暗号 → 模型准确答 "PINEAPPLE-742"`。resume 响应不含 sessionId（符合 ACP 规范），configOptions 完整返回。
- **补充实测**：`session/list` 跨进程可用，返回所有历史会话（含被 SIGKILL 的）；resume 未知 id → `-32602 "Invalid params: session is not resumable: <id>"`（11ms 快速失败）；prompt 未知 id → `-32602 "unknown session: <id>"`。
- **对适配器错误映射的影响**：适配器要持久化三元组 `(sessionId, cwd, mcpServers)`，续接时原样重放（cwd 不一致会走 DSH 的 `cwd mismatch` 错误路径）；resume 失败按 `-32602` 映射为"会话不可恢复"，宿主可选择降级为新建会话。崩溃恢复路径 = 3.a 检测到退出 → 3.c resume。

### 3.d 权限无应答 —— 已实测（结论修正前报）

- **结论**：**DSH 侧没有任何超时**。触发 `session/request_permission` 后宿主不应答，turn 挂起 ≥148 秒无任何事件；前报所说"未应答时 `stopReason: cancelled`"实际是**驱动/连接关停时的产物**——SIGTERM 后优雅退出流程才把 prompt 响应补发为 `cancelled`。
- **证据**：request_permission 到达 t=6.7s（请求 id=0，选项 `allow-once`/`reject-once`，`toolCall` 只带 `toolCallId`）；直至 t=155s 驱动超时 SIGTERM，t=155.07s 收到 `stopReason:"cancelled"`。源码佐证：`dsh-acp` 对 `conn.request(session/request_permission)` 无 timeout 包装。
- **对适配器错误映射的影响（重要）**：宿主**必须**应答每个权限请求（`{outcome:{outcome:"selected",optionId:"allow-once"|"reject-once"}}`，实测两种应答都被接受且行为正确：allow → 工具执行；reject → 模型被告知拒绝、不执行、turn 以 `end_turn` 正常收尾）。宿主审批卡片超时/放弃时应主动回 `cancelled` outcome 或 `session/cancel`，不能等 DSH 自己超时。
- **触发条件补充（对 3.d 与审批设计的共同影响）**：宿主在 `session/new` 里声明的 **MCP 工具调用不经过权限请求**（echo 实测直接执行，`dsh-acp` 只转发沙箱/approval 服务产生的 `approval/request`）。沙箱升级审批链是：内置工具越权 → 工具结果提示可升级 → **模型决定**是否带 `sandbox_permissions` 重试 → 才触发 `request_permission`。SciForge 关闭全部内置工具后，DSH 侧审批链实际上不可达；宿主工具的审批门必须在宿主自己的 MCP server 内实现。

### 3.5 补充实测：patch 对未知行 id 静默忽略

- **结论**：patch 文件里写一个完全不存在的行 id（`_patch-bogus.yml`），DSH 正常启动、`session/new` 照常成功，**无告警无错误**。
- **对适配器错误映射的影响**：部署校验不能依赖"启动失败"来发现 patch 拼写错误；必须以 wire 级工具清单（或模型请求体）为准做回归断言。这也反向加强了 §1.3 的证据口径说明。

## 4. 环境坑记录（OpenRouter 替身特有，官方 API 无此问题）

1. `llm-deepseek` 说 **Anthropic Messages 协议**（默认 `https://api.deepseek.com/anthropic`，可用 `DEEPSEEK_BASE_URL` 覆盖；路径自动补 `/v1`）。请求体带 DeepSeek 私有扩展（`output_config`、`dsh_session_log`、`dsh_plugin_packages`），OpenRouter 会忽略。
2. `thinking:{type:"enabled"}` 不带 `budget_tokens` → 严格网关 400（OpenRouter 实测拒绝；DeepSeek 原生接受）。**解法**：patch 里 `llm-deepseek.config.thinking: disabled`（副作用：reasoning_effort 只剩 off）。
3. OpenRouter 流式 usage 里 cache token 字段为 null → dsh-llm-deepseek 报 `invalid cache_read_input_tokens`。**解法**：探针用代理把 null 改 0（仅探针需要）。
4. `session/new` 对 MCP server 的要求与前报一致：command 必须绝对路径；启动失败整轮回滚（fail-closed）。
5. 事件词汇表（补充前报）：turn 终结信号是 **prompt 的 JSON-RPC 响应 `{stopReason}`**，全程未观察到独立的 `end_turn` 型 `session/update`；事件类型实测有 `agent_thought_chunk`、`agent_message_chunk`、`usage_update`、`tool_call`、`tool_call_update`、`session/request_permission`。

## 5. 未实测 / 遗留事项

- **官方 DeepSeek key 复测**：仍未做（密钥由使用者自配）。OpenRouter 替身已覆盖全部协议路径，但模型目录/计费/thinking 行为以官方 API 为准。
- 前报能力声明维持：不支持 fork/steer/transcript 回放/会话删除/图片/additional directories。
- 建议实现期补的回归测试：①假 ACP 子进程注入 EOF/异常退出，覆盖 3.a 的映射；②权限请求应答案构 fuzz（id=0 的请求、options 为空等）；③"内置工具确实不可见"的 wire 级断言（直接断言 LLM 请求体，而非问模型）。

## 6. 交付文件

- 本报告：`Claude outputs/DSH-runtime-adapter-prep-20261019.md`
- 最终 patch：`_dsh-probe/sciforge-runtime-final.yml`（18 个原有禁用行 + 3 个新禁用行；模型 seam 保持默认，附非默认端点的配置模板与兼容性说明）
- 探针工件（均不入 git）：`_dsh-probe/probe-drive.mjs`（驱动）、`_dsh-probe/proxy-log.mjs`（日志代理+shim）、`_dsh-probe/err-probe.mjs`（错误形态）、`_dsh-probe/_patch-{base,final,perm,bogus}.yml`、帧记录 `/tmp/dsh-probe-*.jsonl`

## 7. 残留风险清单（给实现 agent）

1. 全部包为 0.2.0-rc.2 预发布，升级前重跑本报告 §1 的 wire 级工具面断言（row id 改名/语义变更不会报错，见 3.5 静默忽略）。
2. `session/request_permission` 的请求 id 实测为 **0**：适配器若按 id 追踪在途请求，需把"agent 发来的请求"与"宿主发出的请求"分命名空间，否则 id 会与宿主自己的 JSON-RPC id 冲突。
3. 权限不应答 = 永久挂起（§3.d）：宿主审批卡片必须有自己超时，且超时后主动 `cancel` 会话或回 `cancelled`。
4. MCP 工具无审批门（§3.d 触发条件）：能力声明（capabilities）里不要承诺"所有工具调用都经宿主审批"——实际上只有宿主 MCP server 自己能做到这一点。
5. patch 行对未知 id 静默忽略（实测：bogus id 的 patch 正常起会话）：**验证 patch 效果的唯一可靠方式是抓模型请求体/工具清单**。
