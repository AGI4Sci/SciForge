# Native Extension 归属图

最后更新：2026-05-21

本文是 `[native-extension-ownership-map.json](native-extension-ownership-map.json)` 的可读版摘要。JSON 文件是可验证清单；本文说明每类能力最终归谁拥有、通过什么 surface 暴露，以及 GUI/runtime 的边界在哪里。

运行 `npm run smoke:native-extension-ownership` 可以校验 manifest、`/capabilities` 命令动词和可读策略形状。


| 领域                                 | 归属                                         | 目标 surface                                                                                                                      | GUI/runtime 边界                                                                                 |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Capability discovery               | Codex 原生 plugin / skill / tool / MCP       | `/capabilities search`、`expand`、`plan`、`explain`；展示通过 `gui.present` / `gui.ask_user`                                            | GUI 只发送文本命令；GUI 和 runtime 都不做 capability ranking。                                              |
| GUI 展示组件目录                         | SciForge GUI extension                     | `/gui/capabilities/presentation.json`、`/gui/renderers/<componentId>.json`、`gui.search(scope='/gui/capabilities')`、`gui.present` | `packages/presentation/components` 只声明 renderer/viewer/workbench 能力；不得注册成 TUI task skill/tool。 |
| Confidence / 置信度                   | Codex 原生 verifier / harness / policy       | result payload 的 `confidence`、`confidenceExplanation`，或 MCP verifier 结果                                                         | GUI 只能渲染 TUI 给出的可解释分数；不得补默认值、不得从日志或文案推断可信度。                                                    |
| Harness / policy / budget / repair | Codex TUI 原生扩展                             | Codex policy plugin、skill 或 MCP surface                                                                                         | GUI 可以展示状态或收集确认；不选择策略。                                                                         |
| Provider route                     | Codex provider / MCP / tool 生态             | custom model provider、本地 provider proxy、MCP server、Codex tool                                                                   | Runtime 只审计 profile/provider/model/workspace/command id 并 fail closed；不得静默 fallback 到 OpenAI。  |
| Verifier                           | Codex 原生 verifier tool / skill             | tool、skill、MCP verifier                                                                                                         | Verifier 输出 evidence、verdict、critique 或 repair hint；GUI 不从 raw logs 推断 completion。             |
| Skill promotion                    | Codex skill / plugin / MCP / slash command | Codex 原生扩展 artifact                                                                                                             | Workspace proposal 只是 staging，不是最终 promotion 目标。                                               |
| Computer Use                       | Sense plugin 加上上游 desktop bridge           | `packages/observe/vision`、`packages/actions/computer-use`、desktop bridge                                                        | React/UI 不执行 Computer Use；raw screenshot/log payload 只能进入折叠 audit/debug refs。                  |
| Dual-instance self-repair          | 默认退休；只有 Codex-native 形态可恢复                 | Codex 原生 repair workflow、skill/plugin 或 external supervisor                                                                     | 两个 SciForge app instance 不是默认 repair runtime。                                                  |


边界规则：凡是改变任务能力、选择 provider、修复执行、验证真伪、提升 skill、计算可信度或判断 completion 的功能，都属于 TUI/Codex 原生扩展生态。SciForge GUI 只贡献 presentation、confirmation、focus、folded audit/debug、只读 GUI resource tree 和终端等价文本。

## 当前 packages 归属表

本表描述当前代码形态下 `packages/` 的最终归属；它不是立即移动目录的计划。目录名可以继续兼容现状，但新增 package、README、manifest 和 import 关系应按 owner/role 判断边界。


| 当前路径                                      | Owner  | Role                   | 允许的通信 surface                                                                                                        | 边界说明                                                                                                                                     |
| ----------------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend`                        | TUI    | adapter                | Codex CLI wrapper、Responses proxy HTTP endpoint、isolated `CODEX_HOME` setup、runtime audit/config helpers             | 当前仍被 runtime、desktop sidecar、dev script 和 smoke 引用，不能按“不是最终 backend”直接删除。它不拥有 agent reasoning；只连接 Codex native runtime 和 provider proxy。 |
| `packages/agent-harness`                  | TUI    | policy                 | harness contract、profile、shadow-mode deterministic merge output                                                      | 属于 TUI harness/policy。不得调用 GUI renderer，也不得承担 runtime lifecycle。                                                                         |
| `packages/reasoning/conversation-policy`  | TUI    | policy                 | conversation/recovery/acceptance/context policy request-response                                                     | 属于 TUI 侧确定性策略。可以输出 decision、repair hint、context projection，但不展示 UI、不执行 provider。                                                         |
| `packages/skills`                         | TUI    | catalog + capability   | `SKILL.md`、generated skill catalog、matching/runtime policy                                                           | Skill 是 TUI agent 可发现能力入口。GUI 若触发 skill 选择，只发送终端等价文本；不得读取 skill catalog 做自己的 ranking。                                                    |
| `packages/observe`                        | TUI    | capability             | observe capability manifest、provider request/result、trace/evidence refs                                              | 只读观察能力，输出 auditable observation。不得修改 workspace 或外部环境；副作用执行转到 `packages/actions`。                                                         |
| `packages/actions`                        | TUI    | capability             | action provider manifest、approval/safety/trace contract、execution result                                             | 会改变环境的 action provider。React/UI 不执行 action；GUI 只可收集确认或展示 trace/ref。                                                                      |
| `packages/verifiers`                      | TUI    | capability             | verifier provider manifest、verification request/result、confidence、repair hints                                       | 验证真伪、置信度和 completion evidence 属于 TUI/Codex verifier 或 harness；GUI 只能渲染已给出的结果。                                                            |
| `packages/workers`                        | TUI    | adapter                | standalone worker manifest、health、invoke transport                                                                   | Worker 是 capability 的部署/transport 形态，不是独立任务 owner。若某 worker 只服务单一 capability，可以保留独立发布，也可以后续并回对应 capability 包。                            |
| `packages/contracts/runtime`              | shared | contract               | exported TypeScript types、schemas、pure validators/helpers                                                            | 跨 TUI、GUI、runtime 和 package 的纯契约。不得读取文件、调用 provider、import `src/runtime` 或 `src/ui` 私有实现。                                                |
| `packages/contracts/tool-worker`          | shared | contract               | worker manifest/health/invoke protocol、HTTP helper contract                                                          | 只定义 worker 协议。具体 web worker、browser worker 或其它 provider 仍归 TUI adapter/capability。                                                       |
| `packages/support/object-references`      | shared | contract               | object/file/artifact reference normalization and conversion helpers                                                  | Object reference 是 TUI/GUI/CLI 共享指针。它不渲染 chip、不打开文件、不决定 agent 行动。                                                                        |
| `packages/support/artifact-preview`       | shared | contract               | preview descriptor helpers、derivative normalization                                                                  | 预览 descriptor 是共享契约；实际 workspace file descriptor 由 runtime 生成，placement/rendering 由 GUI 决定。                                              |
| `packages/scenarios/core`                 | shared | catalog                | scenario compiler input/output contracts、skill/UI plan compiler、validation report                                    | Scenario 编译核心不依赖 React 或浏览器状态。它可消费 skill/component manifests 生成计划，但 scenario 不是 GUI runtime。                                             |
| `packages/presentation/components`        | GUI    | presentation + catalog | `/gui/capabilities/presentation.json`、`/gui/renderers/<componentId>.json`、renderer manifests、view events/object refs | 当前 GUI renderer registry 真相源。组件不是 TUI task skill/tool/action/verifier，不能写 workspace、调用 provider 或判断 completion。                          |
| `packages/presentation/interactive-views` | GUI    | presentation alias     | re-exported interactive view manifests                                                                               | 当前是 `packages/presentation/components` 的语义别名和兼容层；不应形成第二套 renderer registry。                                                              |
| `packages/presentation/design-system`     | GUI    | presentation           | React primitives、theme tokens、UI state styling                                                                       | 只提供低层 UI primitives/tokens。不得读取 workspace、调用 runtime、执行 Computer Use 或 verifier verdict。                                                 |


Role 只描述模块通信契约，不描述目录名。当前可用 role 收敛为：


| Role           | 含义                                                               |
| -------------- | ---------------------------------------------------------------- |
| `contract`     | 纯类型、schema、validator 或 ref model；无 IO、无 provider、无 UI rendering。 |
| `adapter`      | 连接外部 host、provider、process、worker 或 transport；不拥有任务推理。           |
| `capability`   | TUI 可发现/可调用的任务能力，包括 observe、action、verify 和 skill。               |
| `policy`       | TUI 侧确定性决策逻辑，例如 routing、budget、repair、acceptance、harness。        |
| `presentation` | GUI 展示、输入、确认、focus、semantic event 和 read-only GUI resource。      |
| `catalog`      | 发现、索引、registry 或 compiler；只组合 manifest/contract，不执行任务。           |


## 模块通信标准

1. **TUI-owned package** 只通过 Codex 原生 plugin / skill / tool / MCP / provider / worker 机制暴露能力。输出必须是 refs-first：artifact refs、evidence refs、verification result、repair hint 或 compact result payload。需要展示或收集输入时，由 TUI host 调用 `gui.present`、`gui.ask_user`、`gui.notify`、`gui.set_status` 或只读 `gui.read/search`，package 自身不得 import GUI implementation。
2. **GUI-owned package** 只通过 GUI extension surface 暴露能力：`/gui/capabilities/presentation.json`、`/gui/renderers/<componentId>.json`、hot-region/resource tree 和 intent-based `gui.*` tools。GUI package 可以发出 view-local event、object ref、edit proposal 或 terminal-equivalent text suggestion，但不得执行 workspace/action/provider，也不得做 completion/verdict/confidence 判断。
3. **Shared package** 只提供纯 contract、schema、validator、normalizer 和 deterministic helper。Shared package 不得 import TUI-owned 或 GUI-owned package，也不得依赖 `src/runtime/`**、`src/ui/**` 私有实现。
4. **Host 装配层例外**：`src/runtime/`** 可以装配 TUI-owned + shared；`src/ui/**` 可以装配 GUI-owned + shared。TUI 和 GUI 之间仍只能走 `[TuiGuiProtocol.md](TuiGuiProtocol.md)` 中定义的文本输入、intent tools 和只读 GUI resource tree。
5. **禁止双向注册**：TUI task capability 不注册 GUI renderer；GUI presentation catalog 不注册 TUI skill/tool/provider。两边可以通过 object refs、artifact refs、resource reads 和 `gui.present` 协作，但不能互相 import 或共享 ranking。

最小可靠发现模型：

1. TUI 任务能力通过 Codex 原生 mechanisms 发现。GUI 只发送 `/capabilities search|expand|plan|explain` 文本。
2. GUI 展示能力通过 `/gui/capabilities/presentation.json` 和 `/gui/renderers/<componentId>.json` 只读暴露。TUI 用 `gui.read/search` 发现，用 `gui.present` 表达展示意图。
3. 两个目录不互相注册、不互相 import、不共享 ranking。这样可以避免 GUI 变成第二个 agent，也避免 TUI 依赖 React 内部实现。
