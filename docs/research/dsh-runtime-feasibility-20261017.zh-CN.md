# DeepSeek Harness（DSH）能否作为 SciForge 第三个 Agent Runtime —— 可行性报告

日期：2026-10-18（实测于 2026-10-17）。适用对象：向老师汇报、决定是否开发适配器。

## 一、先说结论（给不看技术细节的人）

**可以加，建议推进，但先把"写适配器之前"的几项收尾。**

- 之前没有同事署名做过这项调研。仓库里只有一份 9 月 21 日由 AI 生成的评估（`Claude outputs/ADR_001_*`，未提交），
  结论是"停止集成"。**这份结论已经过时**：当时没发现 DSH 自带标准的 ACP 接入口，也没验证过"把它自带的工具关掉、
  只用 SciForge 提供的工具"这件事。
- 这次实测后：DSH 可以像现有的 Codex 一样，作为一个子进程接进来；它自带的 shell、文件、联网、子 agent 等工具能被关掉，
  模型只能使用 SciForge 宿主提供的工具，所以"权限和写操作由宿主控制"这一底线能守住。
- 没验证、也不能夸大的部分：真实对话是用已有的 paratera 端点（服务 DeepSeek-V4.1-Flash）代替官方 DeepSeek API 跑的；
  DSH 所有包都是预发布版，接口可能变。

## 二、之前的调研与它为什么过时

| 项目 | 内容 |
| --- | --- |
| 来源 | `ADR_001_DeepSeek_Integration_Decision.md`、`FEASIBILITY_ASSESSMENT_FINAL_REPORT.md`、`ADR_001_决策文档_中文.md`（2026-09-20/21，AI 生成，未提交，无人署名） |
| 当时结论 | 停止集成，Q1 2027 复审 |
| 三条阻塞点 | 1) 无工件版本管理；2) 无逐操作权限；3) 无受控写声明 |
| 为什么过时 | 评估依据是文档阅读；没发现 `dsh --profile acp`；没有验证关闭内置工具后模型的工具面；也没有考虑宿主已有的 artifact-versions 提交端口 |

注意：仓库里的"DeepSeek-GUI / Kun"运行时已在最新主线中删除；当前主线只有 Codex 和 Claude Code 两个可执行 runtime
（`docs/agent-runtime-contract.md`）。插件改造用到的 `@deepseek-ai/dsh-*` 是 DSH 宿主库，与"把 DSH 当 agent runtime"是两件事。

## 三、实测了什么

环境：`_dsh-probe/`（隔离目录，已本地排除，未进 git），`@deepseek-ai/dsh@0.2.0-rc.2` 与 `dsh-acp-app`、`dsh-sdk-app`，
`DSH_HOME` 指向隔离目录。

【技术】

| 项目 | 结果 |
| --- | --- |
| 启动 `dsh --profile acp` | 空 `DSH_HOME` 下正常；stdout 只有 ACP 帧 |
| `initialize` | ACP v1；支持 `session/list`、`session/resume`、`session/close`、HTTP MCP；不支持图片/音频 |
| `session/new` + 外部 stdio MCP | 成功；返回模型选项（v4-flash / v4-pro）与 `reasoning_effort`（off/low/high/max） |
| MCP command 为相对路径 | 拒绝（必须绝对路径） |
| MCP 命令不存在 | 整个 `session/new` 回滚（fail-closed） |
| `--patch` 关闭内置工具 | 生效；bash/pwsh/fs/fs-search/web 搜索与抓取/subagent/workflow/skill/jobs 行 OFF |
| 真实 `session/prompt` | `initialize → session/new → session/prompt → end_turn` 全链路通过 |
| 事件类型 | `agent_thought_chunk`、`usage_update`、`tool_call`、`tool_call_update`、`agent_message_chunk` |
| 模型实际工具清单 | 只剩 `exit_plan_mode` + `read_mcp_resource`/`list_mcp_resources`/`list_mcp_resource_templates` + 宿主 MCP 工具；内置 bash/fs/web/subagent/workflow 等不可见 |
| `session/request_permission` | 真实载荷：`toolCall.toolCallId` + 选项 `allow-once` / `reject-once`；客户端未应答时 `stopReason: cancelled` |
| 沙箱行为 | `workspace-write` 下工作区内读、`/tmp` 写免审批；工作区外写被拒并提示升级，升级时才触发审批 |
| 遥测 | 默认 `FEEDBACK_ONLY`（用户显式反馈后才上传）；`DSH_TELEMETRY_MODE=DISABLED` 可关闭 |

真实 prompt 的复现方式：`DEEPSEEK_BASE_URL` 指向 paratera，`DEEPSEEK_API_KEY` 由使用者自配（不写入文件和日志），
用 `sciforge-full.patch.yml`（含关闭内置工具与模型名对齐：`llm-deepseek.config.models` 与 `acp.config` 的
provider+model 需整体给出）和 `acp-drive.mjs` 驱动。

## 四、旧三条阻塞点现状

| 阻塞点 | 现状 | 依据 |
| --- | --- | --- |
| 工件版本管理 | 不阻塞 | 宿主 artifact-versions 提交端口在 runtime 之外，适配器不涉及 |
| 逐操作权限 | 基本解开 | 工具面只剩宿主 MCP；审批为一次性允许/拒绝，宿主可应答；内置工具可 patch 关闭 |
| 受控写语义 | 基本解开 | 同上；残留内置项见下 |

## 五、没有解决或没验证的（诚实清单）

- 真实对话用 paratera 替身，**未用官方 DeepSeek key 复测**；官方接入时模型目录与 base URL 要回到默认。
- 仍启用的内置项：`exit_plan_mode`、3 个 MCP 资源助手、`tool-result-pruner`（上下文压缩）。尚未评估能否关闭。
- 未测异常路径：子进程崩溃、中途 `session/cancel`、跨进程 `session/resume`、权限请求超时无应答。
- 全部预发布版（`dsh` 0.2.0-rc.2、`dsh-acp-app` 0.1.2-alpha.2），接口可能变，需钉版本。
- 协议不支持：fork、steer、transcript 回放、会话删除、图片、additional directories。

## 六、还要做什么

写适配器之前：
1. 评估并关闭残留内置项（`exit_plan_mode`、MCP 资源助手、`tool-result-pruner`）。
2. 官方 DeepSeek key 复测（密钥由使用者自配）。
3. 测异常路径：崩溃、取消、跨进程恢复、审批超时。
4. 钉版本，核对 ACP 协议版本与许可证（`dsh` MIT、`dsh-headless` BSD-3）。
5. 凭据与遥测：密钥仅经环境变量交给子进程、不落日志；宿主强制 `DSH_TELEMETRY_MODE=DISABLED`。

写适配器时：
6. 与宿主负责人对齐：`AgentRuntimeId` 加一项、设置页助手选项；`capabilities` 如实声明上述不支持项。宿主改动走正常评审。
7. 按 AGENTS.md 做成独立 runtime 包（自带 backend 入口），不写进 `src/main`，不加兼容层或第二条 IPC。
8. 测试：协议冒烟、审批往返、取消、崩溃恢复，以及"内置工具确实不可见"的回归测试。

另有一个独立问题需先修：仓库 `node_modules/@deepseek-ai/*` 的符号链接指向已被系统清理的 `/tmp/dsh-deps`，
DSH 相关插件测试目前跑不了。

## 七、适配器草图

【技术】
- 子进程：`dsh --profile acp --patch <sciforge.patch.yml>`，环境由宿主构造，`DSH_TELEMETRY_MODE=DISABLED`。
- 客户端：`@agentclientprotocol/sdk`（未安装、未评估）。
- 映射：`session/new`→`startThread`；`session/list`→`listThreads`；`session/resume`→续接；
  `session/prompt`→`startTurn`；`session/cancel`→`interruptTurn`；`session/update`→`AgentRuntimeEvent`；
  `session/request_permission`→宿主审批卡片。
- 参照：`src/main/runtime/codex/`（`jsonrpc_stdio`）与 `claude-code/`（`cli_process`）。

## 八、文件

- 本报告：`Claude outputs/DSH作为第三个Runtime_可行性实测_20261017.md`
- 复现材料（`_dsh-probe/`，未进 git）：`sciforge.patch.yml`、`sciforge-full.patch.yml`、`mcp-echo.mjs`、`acp-drive.mjs`
- 旧评估（已过时，未修改）：`Claude outputs/ADR_001_*`
