# Native Extension 归属图

最后更新：2026-06-03

本文是 [`native-extension-ownership-map.json`](native-extension-ownership-map.json) 的可读版摘要。JSON 文件是可验证清单；本文说明每类能力最终归谁拥有、通过什么 surface 暴露，以及 GUI/runtime 的边界在哪里。

运行 `npm run smoke:native-extension-ownership` 可以校验 manifest、`/capabilities` 命令动词和可读策略形状。


| 领域                                 | 归属                                         | 目标 surface                                                                                                                      | GUI/runtime 边界                                                                                 |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Capability discovery               | Agent Host 原生 plugin / skill / tool / MCP  | `module.query/read/invoke(moduleId='capabilities')`；迁移期可保留 `/capabilities search`、`expand`、`plan`、`explain` 文本命令，旧 tool alias 只能作为 adapter shim。 | GUI 只发送文本命令或展示 host 结果；GUI 和 runtime 都不做 capability ranking。                                  |
| GUI 展示组件目录                         | SciForge GUI module                        | `module.query/read(moduleId='gui')` 读取 `gui:/capabilities/presentation.json`、`gui:/renderers/<componentId>.json`；`module.invoke(moduleId='gui', intent='present')` | `packages/presentation/components` 只声明 renderer/viewer/workbench 能力；不得注册成 TUI task skill/tool。 |
| 右侧结果交互模块                         | SciForge GUI presentation packages + Host adapters | `ResultShell` pane contract；`packages/presentation/components/browser-workbench`、`image-evidence-viewer`、`terminal-session-viewer`、`workspace-file-viewer`；References object inspector；`packages/presentation/interactive-views` registry slot policy | Browser/Image/Terminal/Files/References 都是可组合 presentation module。GUI 只渲染 projection、refs、buffer、tree、draft 和 view-local intents；真实 browser provider、Window Action adapter、PTY/process、workspace read/write 和 ref materializer 由 TUI/Host adapter 执行。 |
| Confidence / 置信度                   | Codex 原生 verifier / harness / policy       | result payload 的 `confidence`、`confidenceExplanation`，或 MCP verifier 结果                                                         | GUI 只能渲染 TUI 给出的可解释分数；不得补默认值、不得从日志或文案推断可信度。                                                    |
| Harness / policy / budget / repair | Codex TUI 原生扩展                             | Codex policy plugin、skill 或 MCP surface                                                                                         | GUI 可以展示状态或收集确认；不选择策略。                                                                         |
| Provider route                     | Codex provider / MCP / tool 生态             | custom model provider、SciForge Model Router `/v1/responses` facade、本地 provider proxy、MCP server、Codex tool                                                                   | Runtime 只公开审计 router alias/profile、capabilities、role coverage、readiness、workspace/command id 并 fail closed；不得公开 provider URL、API key、secret env 名或 raw model slug，也不得静默 fallback 到 OpenAI。  |
| Verifier                           | Codex 原生 verifier tool / skill             | tool、skill、MCP verifier                                                                                                         | Verifier 输出 evidence、verdict、critique 或 repair hint；GUI 不从 raw logs 推断 completion。             |
| Skill promotion                    | Codex skill / plugin / MCP / slash command | Codex 原生扩展 artifact                                                                                                             | Workspace proposal 只是 staging，不是最终 promotion 目标。                                               |
| External app connectors            | Codex TUI 原生 connector / tool / MCP / worker | `packages/connectors`、Agent Host input intake、ChannelMessageEnvelope、MCP resources/tools、tool-worker manifest/health/invoke、`/connectors ...` 文本命令                             | GUI 不直接调用飞书、微信、CLI、SDK、API 或桌面自动化；connector 只直连 TUI Host。外部消息可作为输入 envelope 直接进入 Agent Host thread ledger，并由 Web chat projection 呈现；GUI 只发送文本、展示 refs/audit、收集确认。        |
| Browser runtime                    | Codex TUI observe capability + host-owned BrowserHostSession + SciForge GUI presentation | TUI: `packages/observe/web` 的 `browser_runtime` manifest/provider wrapper；shared: `@sciforge-ui/runtime-contract/browser-runtime`；host: `BrowserHostSession` session/action/native-or-streaming live surface/search refs、`computer-use-actions` 输入通道、desktop native embedded adapter、非桌面 `frame-stream` websocket-binary transport 和 Workspace Writer `/health` capability；GUI: `packages/presentation/components/browser-workbench`、writer preflight/autostart adapter 和 `/browser ...` 终端等价文本；Tauri/Electron/Web 仅为 shell/adapter | `BrowserHostSession` 是唯一 live browser owner，持有外部 HTTP/HTTPS 导航、back/forward/reload/stop、click/double-click/mouse-down/mouse-move/mouse-up/drag/type/press/scroll/cursor-hit-test、snapshot/state/takeover refs、screenshot/DOM/AX/console/network/search refs 和 browser_search。桌面最终 live path 是 Electron `WebContentsView` native embedded surface（未来可替换 WebView2/WKWebView/独立 Chromium surface），它只作为同一个 session 的 display/input adapter，通过 `SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL` 供 workspace-server 的 `BrowserHostSession` driver 调用；GUI 只 attach bounds，不拥有网页。Web shell 的 `frame-stream` 是同一 owner 的非桌面 stream/diagnostic/evidence transport，不是 native 桌面替代 live path；`/frame` route 只作 evidence/manual inspection。preflight 必须拒绝缺少 `computer-use-actions` 或 `frame-stream` endpoint 的 stale Workspace Writer，不得把无 live pixels 的 state 当作 ready；不得 import `@sciforge-observe/web/browser-runtime`、选择 provider、读取跨域 DOM 或保存 base64/完整 DOM/log。外部 HTML 不得用 iframe/proxy/`<webview>`/snapshot/旧 frame/系统 popup 冒充 live browser、第二画面真相源或替代交互路径；静态 snapshot/PDF/document 只能作为独立证据或文档对象。 |
| Computer Use / Window Action       | Codex TUI 原生 action provider；可选消费 sense provider | Codex app-server native tool/plugin/MCP production path；Codex CLI/native plugin debug path；`WindowActionSession` action router；BrowserRuntime DOM/AX observation refs as hints；research workflow user-acceptance manifest；`module.invoke(moduleId='actions', intent='execute')`；`packages/actions/computer-use` 的 `runTask(request, hostPorts)`、`packages/observe/vision` 的 observation/grounding/verifier 输出、desktop/remote/dry-run host ports | Computer Use action provider 拥有 scheduler、lease、approval、automation barrier 和 action/evidence contract，但不是第二个 L2。`vision-sense` 不拥有真实桌面动作。React/UI/Image viewer 只做 GUI presentation，不执行 Computer Use；raw screenshot/log payload 不进入主结果或长期 trace；snapshot/replay/PDF/document 只能是 evidence/artifact，不得作为第二个交互 truth；legacy gateway/exec/docker/noVNC/RDP/M6 multi-screen 只能是 diagnostic/test-only、historical evidence、historical regression 或 backend packaging，不能作为当前 active gate。 |
| Desktop Window Action adapters     | Agent Host adapter / platform bridge | `WindowActionSession`、windowRef、app/process metadata、bounds/scale/screen id、actorCursor、adapter route、accessibility/UI Automation/AT-SPI、app-native command、BrowserHostSession/CDP/Playwright、shared-system-input evidence | Host adapters 操作真实 app/window，不要求 app 隔离，也不承诺多只 OS 鼠标。GUI 只展示 actorCursor、状态和 refs；Image/Evidence 只展示截图、crop、replay 和 provenance。旧 `VirtualAppScreen` host 只能作为 deprecated compatibility/historical regression，不是 active product owner。 |
| Dual-instance self-repair          | 默认退休；只有 Codex-native 形态可恢复                 | Codex 原生 repair workflow、skill/plugin 或 external supervisor                                                                     | 两个 SciForge app instance 不是默认 repair runtime。                                                  |


边界规则：凡是改变任务能力、选择 provider、修复执行、验证真伪、提升 skill、计算可信度、判断 completion，或接触外部账号/API/消息/桌面 app 的功能，都属于 Agent Host 原生扩展生态。SciForge GUI 只贡献 presentation、confirmation、focus、folded audit/debug、只读 GUI resource tree 和终端等价文本。拓展模块只直接和 Agent Host 通信；需要 GUI 展示或确认时，由 Agent Host 调用 `module.invoke({ moduleId: 'gui', intent })`。迁移期 `gui.present`、`gui.ask_user`、`gui.notify` 和 `gui.set_status` 只能作为 host-specific adapter alias。

### ResultShell / 右侧 pane 归属

右侧结果栏不是 native capability，也不是第二个 runtime。`ResultShell` 是 GUI presentation contract，负责把 object kind、ref prefix、pane state、allowed action 和 redaction hint 路由到对应 renderer；它不得读取 provider 私有状态、执行 workspace/desktop/browser 操作、推断任务完成或把未知对象降级为 raw JSON。

| Pane | GUI 可做 | TUI/Host 拥有 |
|---|---|---|
| Browser | 展示 typed browser projection、Desktop Electron `WebContentsView` live surface、host-returned cursor/caret/pointer projection、writer health/preflight 诊断、blocked/error/offline 状态、snapshot/search/log evidence refs 和 `/browser ...` terminal-equivalent command。桌面 shell 只 attach `WebContentsView` bounds；外部 HTML 的 proxy/snapshot/PDF/document 不能作为 live browser、第二画面真相源或替代交互路径。 | `BrowserHostSession` live session/tab/action/cursor/pointer/surface/snapshot/DOM/AX/console/network/search refs、Workspace Writer `/api/sciforge/browser-host/*` host routes、`/computer-use-actions` 输入通道、desktop native embedded adapter、非桌面 `/frame-stream` diagnostic/evidence transport、`/frame` evidence route、`browser_runtime` provider route、human takeover 和 high-risk approval；Tauri/Electron/Web 仅为 shell/adapter。 |
| Image / Evidence | 展示 refs-first screenshot、crop、window capture、Browser evidence image、artifact preview、replay/history image、annotation overlay 和 provenance；不展示 live control surface。 | Image refs、annotation refs、WindowActionSession evidence refs、BrowserHostSession evidence refs、artifact preview refs 和 ref materializer。Computer Use / Window Action owner 只返回 bounded evidence，不把 Image pane 变成 executor。 |
| Terminal | 展示 host-owned live terminal mount 或 transcript fallback、cwd/status/exit code、copy/download/stop/focus/resize/input intents。 | PTY/process/socket lifecycle、stdin/paste、resize、stop、transcript materialization 和 session persistence。 |
| Files | 展示 workspace tree projection、file preview、read-only default、explicit edit draft、save/cancel/error states 和 open/copy intents。 | Workspace list/read/write、path policy、large/binary file handling、conflict detection、persistence 和 audit。 |
| References | 展示 artifact/file/browser/screen/terminal/evidence/provenance refs 分组和 focus/open/copy/pin actions。 | Ref minting、bundle-local validity、provenance、redaction、materialization 和 audit trail。 |

大对象必须 refs-first：截图、录屏、terminal transcript、DOM/AX snapshot、provider payload、audit、trace、replay 和 artifact 不得内联到 pane state；projection 只保留 ref、摘要、尺寸/hash、live surface handle/ref 和脱敏 diagnostics。GUI 按钮只能生成 focus/open、declared GUI intent、confirmation result 或 terminal-equivalent text；Computer Use、Window Action、BrowserRuntime、Terminal 和 Files 的真实副作用仍由 Agent Host 通过对应 native module 执行。Browser pane 的交互真相源只能是 BrowserHostSession owner-owned live surface；Window Action 的交互真相源是目标 window/app + adapter route；Image/Evidence artifact 不得变成第二套可交互 UI，也不得作为替代交互路径。

Computer Use / Window Action 的内部拆分必须保持单一执行 owner，但不能形成第二个 Root Agent Host：`packages/actions/computer-use` 拥有 request/result schema、domain-local action loop、safety/approval、WindowActionSession/actorCursor contract、scheduler/executor adapter contract、trace contract 和 compact handoff；用户级 planning、跨模块 pipeline、repair 和 completion 仍归 Codex TUI Agent Host。`packages/observe/vision` 只提供 sense、coarse-to-fine focus region、Model Router vision translator/grounding 输出、verifier feedback 和 file-ref-only visual memory。Computer Use 不按具体上游模型类型做产品级分叉；router profile 的 `textReasoner` 是 reasoning owner，`translators.vision` 只把截图、crop 或 ref 转译成文本观察。当前输入目标是 Host-owned real window/app action：SciForge Host 维护 target app/window/session refs、actorCursor、annotation overlay、human stop/cancel、automation barrier、scoped executor state 和 before/after evidence；底层优先使用 app-command、BrowserHostSession/native surface、terminal PTY、editor extension、accessibility/UI Automation/AT-SPI、vision-grounded 或 shared-system-input adapter。真实 OS multi-pointer / multi-seat 只允许作为未来可替换 executor backend，不进入 planner、GUI 或 schema 的核心假设。真实输入如果没有独立 app/window scoped adapter，就属于 shared system input，只能作为迁移期诊断、blocked 或 explicit handoff evidence，不能替代 adapter-owned action evidence。Trace 输出只保存 refs、sha256、尺寸、target description、screen/window/crop-local coordinates、actor/cursor ids、lease scope、公开 router profile/alias、diagnostics、approval/audit refs，不保存 raw screenshot/base64、私有 provider URL、API key 或 raw model slug。

Computer Use 的 L0/L1/L2 放置必须显式登记。L2 是 Codex app-server 生产路径或 Codex CLI/native plugin 调试路径；它负责选择模块、串联 browser/file/verifier/gui、approval、repair、completion 和 pipeline trace。L1 是 Computer Use resource/session adapter，只管理 display group、screen、actor cursor、lease、evidence、replay refs、adapter readiness、backend lifecycle 和 L0 handler routing；它不得做跨模块 planning、capability ranking、prompt route 或用户级 completion。L0 是单动作 handler，例如 capture、crop、ground、execute、verify、writeTrace、emitEvent；L0 不直接调用 GUI、renderer registry、Workbench、AnnotationSidebar 或其它任务模块。历史 AgentServer、runtime gateway、`codex exec --json` 和 GUI `/computer-use` special route 只能作为 legacy/test-only/diagnostic adapter，不得成为新增 public API。

Computer Use 当前仍处于 `migrating`，剩余拆分不再用笼统 partial 记录，而是登记在 `docs/native-extension-ownership-map.json` 的 `computer-use.remainingMigrationSubtasks`。新增 active backlog 以 `PROJECT_desktop_actions.md` 为准：WindowActionSession action router、真实 window capture/action、actorCursor、Global Annotation、Image/Evidence projection、Codex app-server production path、legacy/test-only gateway/exec 降级、Docker/container/noVNC/RDP backend packaging 降级和 import boundary guard。JSON manifest 中保留的 M6/multi-screen/VirtualAppScreen 条目是 historical compatibility 或 regression 登记；不得让这些旧条目阻塞当前路线或替代 Browser/Window/Image/Annotation 验收。

### Computer Use 文件责任表

| 路径或区域 | 层级 | 允许责任 | 禁止责任 |
|---|---|---|---|
| Codex app-server native tool/plugin/MCP | L2 production host | 生产调用面、跨模块 semantic pipeline、approval、repair、用户级 completion、pipeline trace。 | 把 package action loop、runtime gateway 或 GUI special route 变成第二个任务大脑。 |
| Codex CLI/native plugin | L2 debug host | 本地调试、smoke 和 production surface 的最小闭环验证。 | 被描述为 rich-client 产品 fallback。 |
| `packages/actions/computer-use` | L1/L0 owner | request/result schema、WindowActionSession/ActorCursor、ActionProposal、ExecutorLease、ExecutorAdapter、domain-local loop、safety、trace、compact handoff、user-acceptance manifest 和 L0 handler routing。 | 直接 import/call GUI、browser、file、verifier；选择跨模块下一步；判断用户级 completion；直接实现 OS display/capture/input host。 |
| `packages/actions/computer-use/virtual-app-screen-host` | deprecated compatibility | 历史 VirtualAppScreen trace / fixture / regression 的兼容读取和迁移辅助。 | planning、completion、GUI import、scheduler policy、workspace write policy、第三方虚拟屏幕 UI 作为 product truth，或作为当前 active product gate。 |
| `packages/observe/vision` | L0 sense/grounding provider | observation、focus region、OCR、Model Router vision translator/grounding 输出、verifier feedback、file-ref-only visual memory。 | 真实桌面输入、scheduler lease、executor adapter、desktop bridge 或 completion 判断。 |
| `src/runtime/computer-use` | host adapter / migration shim | workspace/session context 注入、platform host ports、runtime event projection、legacy diagnostic compatibility。 | generic Computer Use policy、public production API、cross-module planning、GUI direct calls。 |
| `src/runtime/modules` | module dispatcher host adapter | 暴露 `actions` module 的 describe/invoke 边界并 fail closed 未声明 intent。 | 内嵌 Computer Use planner 或绕过 native tool/plugin/MCP。 |
| `src/ui/**` and future viewer package | GUI presentation | Image/Evidence refs、actor cursor overlay、WindowActionSession proposal/lease/evidence/ref 展示、confirmation UI、terminal-equivalent text 和 `gui.present` 投影。 | import action provider、observe provider implementation、runtime bridge、executor 参数或执行 desktop action。 |
| ownership smoke fixtures/tests | validator / governance | 校验 manifest 形状、required migration ids、allowed/forbidden policy 和 import boundary fixture。 | 伪造 runtime success 或替代 Computer Use acceptance。 |

### Computer Use L1 allowed/forbidden 矩阵

| L1 resource adapter allowed | L1 resource adapter forbidden |
|---|---|
| 管理 display group、screen、actor cursor、input queue、executor lease、evidence ledger、replay refs。 | planning、capability ranking、prompt route、provider route、workspace write policy。 |
| 跟踪 backend/provider readiness、version compatibility、sandbox/container lifecycle 和 resource limits。 | GUI renderer dependency、Workbench/AnnotationSidebar dependency、React/UI import。 |
| 路由 L0 capture、crop、ground、propose、execute、verify、writeTrace、emitEvent handlers。 | 调 browser/file/verifier/gui 或其它任务模块来决定下一步。 |
| 处理 approval stop、lease timeout/cancel/reject、stale evidence invalidation 和 fail-closed diagnostics。 | retry/repair policy、用户级 completion、把 domain-local completion 当最终成功。 |
| 输出 refs-first evidence、blocked、approvalRequest、repairHint、candidateCompletionRefs 和 compact result。 | inline raw screenshot/base64/provider payload、跨 bundle refs、placeholder-only acceptance。 |

### Computer Use import boundary

- `packages/actions/computer-use` 可以 import shared contracts、package-private policy/helper 和 host-port types；不得 import `src/ui/**`、GUI renderer registry、Workbench、AnnotationSidebar、`src/runtime/computer-use` implementation 或 observe provider implementation internals。
- `packages/observe/vision` 可以输出 read-only observation/grounding/verifier feedback contract；不得 import executor、scheduler、desktop bridge 或 GUI code。
- `src/runtime/computer-use` 可以 import package contracts and host adapters；不得成为 package policy 真相源，也不得新增 public production route。
- `src/ui/**` 只能 import shared contract 与 GUI presentation package；不得 import Computer Use action provider、observe provider wrapper、runtime bridge、executor 或 scheduler。
- Validator/test fixture 可以 read manifest/schema and synthetic bundles；不得执行真实 desktop action 或把 fixture success 记成 acceptance evidence。

### Legacy 和 backend 降级分类

| 路径 | 分类 | 规则 |
|---|---|---|
| `CodexAppServerAdapter` + native tool/plugin/MCP | production | 默认产品路径。新增 public Computer Use surface 必须能映射到这里。 |
| Codex CLI/native plugin | debug/smoke | 允许验证同一 native surface，不作为 GUI rich-client fallback。 |
| `CodexExecJsonAdapter` / exec-MCP | legacy/test-only | 只用于 fixture、历史 evidence、diagnostic 或迁移 replay。 |
| AgentServer / runtime gateway | legacy migration shim | 不扩展新增 public API，不承载 Computer Use policy。 |
| GUI `/computer-use` Workspace Gateway | diagnostic shim | GUI 只能发 terminal-equivalent text；special gateway 不执行 production action。 |
| Docker/container/noVNC/RDP | legacy diagnostic / historical evidence / backend packaging | 只负责 sandbox、deps、resource limits、filesystem/network policy、viewer transport 和 lifecycle；并发协作模型来自 Native Host display group、actor cursor、scheduler lease、automation barrier 和 executor adapter。不得作为当前 active gate、产品验收 owner 或 rich-client fallback。 |

## 当前 packages 归属表

本表描述当前代码形态下 `packages/` 的最终归属；它不是立即移动目录的计划。目录名可以继续兼容现状，但新增 package、README、manifest 和 import 关系应按 owner/role 判断边界。


| 当前路径                                      | Owner  | Role                   | 允许的通信 surface                                                                                                        | 边界说明                                                                                                                                     |
| ----------------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend`                        | TUI    | adapter                | Codex CLI wrapper、Responses proxy HTTP endpoint、isolated `CODEX_HOME` setup、runtime audit/config helpers             | 当前仍被 runtime、desktop sidecar、dev script 和 smoke 引用，不能按“不是最终 backend”直接删除。它不拥有 agent reasoning；只连接 Codex native runtime 和 provider proxy。 |
| `packages/agent-harness`                  | TUI    | policy                 | harness contract、profile、shadow-mode deterministic merge output                                                      | 属于 TUI harness/policy。不得调用 GUI renderer，也不得承担 runtime lifecycle。                                                                         |
| `packages/reasoning/conversation-policy`  | TUI    | policy                 | conversation/recovery/acceptance/context policy request-response                                                     | 属于 TUI 侧确定性策略。可以输出 decision、repair hint、context projection，但不展示 UI、不执行 provider。                                                         |
| `packages/skills`                         | TUI    | catalog + capability   | `SKILL.md`、generated skill catalog、matching/runtime policy                                                           | Skill 是 TUI agent 可发现能力入口。GUI 若触发 skill 选择，只发送终端等价文本；不得读取 skill catalog 做自己的 ranking。                                                    |
| `packages/observe`                        | TUI    | capability             | observe capability manifest、provider request/result、trace/evidence refs                                              | 只读观察能力，输出 auditable observation、grounding/verifier feedback 和 file-ref-only memory。不得修改 workspace、外部环境或桌面输入；副作用执行转到 `packages/actions`。       |
| `packages/observe/web`                    | TUI    | capability             | web/browser observe manifests、Playwright MCP provider wrappers、`browser_runtime` capability wrapper                    | 只拥有 TUI browser observe/action contract 的 provider-facing 部分。可 re-export shared browser runtime contract，但 GUI 不得直接 import 本包的 runtime wrapper。 |
| `packages/actions`                        | TUI    | capability             | action provider manifest、approval/safety/trace contract、execution result、host port contract                         | 会改变环境的 action provider。Computer Use 能力主体应收敛在这里；它可以消费 observe/vision，但执行、审批和 trace contract 归 action provider；GUI 只可由 TUI Host 编排来收集确认或展示 trace/ref。 |
| `packages/connectors`                     | TUI    | connector              | Agent Host input intake、ChannelMessageEnvelope、Codex tool / MCP / worker adapter、connector manifest、resource refs、draft/approval/audit contract                    | 第三方 app 扩展目录，例如飞书、微信、企业微信。连接器可以把外部消息规范化为 Agent Host 输入，也可以读外部资源或发起受控副作用；Web chat 呈现来自 thread ledger projection；GUI 不 import connector，也不直接调用外部 SDK/CLI/API。                                   |
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
| `connector`    | TUI 可发现/可调用的第三方 app 连接器；包装外部 API、CLI、账号或桌面 bridge，并输出 refs/audit。 |
| `policy`       | TUI 侧确定性决策逻辑，例如 routing、budget、repair、acceptance、harness。        |
| `presentation` | GUI 展示、输入、确认、focus、semantic event 和 read-only GUI resource。      |
| `catalog`      | 发现、索引、registry 或 compiler；只组合 manifest/contract，不执行任务。           |


## 模块通信标准

1. **TUI-owned package** 只通过 Agent Host 原生 plugin / skill / tool / MCP / provider / worker 机制暴露能力，并且只直接和 Agent Host 通信。小型 compact result 可以 inline；大 payload、敏感内容、可复用对象和审计材料必须输出 refs，例如 artifact refs、external refs、evidence refs、trace refs、draft refs、audit refs。需要展示或收集输入时，由 Agent Host 调用 `module.invoke({ moduleId: 'gui', intent })` 或只读 `module.query/read(moduleId='gui')`，package 自身不得 import 或调用 GUI implementation。
2. **GUI-owned package** 只通过 GUI module surface 暴露能力：`gui:/capabilities/presentation.json`、`gui:/renderers/<componentId>.json`、hot-region/resource tree 和 presentation/input intents。GUI package 可以发出 view-local event、object ref、edit proposal 或 terminal-equivalent text suggestion，但不得执行 workspace/action/provider，也不得做 completion/verdict/confidence 判断。
3. **Shared package** 只提供纯 contract、schema、validator、normalizer 和 deterministic helper。Shared package 不得 import TUI-owned 或 GUI-owned package，也不得依赖 `src/runtime/`**、`src/ui/**` 私有实现。
4. **Host 装配层例外**：`src/runtime/**` 可以装配 TUI-owned + shared；`src/ui/**` 可以装配 GUI-owned + shared。TUI 和 GUI 之间仍只能走 [`TuiGuiProtocol.md`](TuiGuiProtocol.md) 中定义的文本输入、intent tools 和只读 GUI resource tree。
5. **禁止双向注册**：TUI task capability 不注册 GUI renderer；GUI presentation catalog 不注册 TUI skill/tool/provider。两边可以通过 object refs、artifact refs、resource reads 和 Agent Host 发起的 `module.invoke(moduleId='gui', intent='present')` 协作，但不能互相 import、互相调用或共享 ranking。
6. **副作用先返回意图**：Computer Use、飞书/微信连接器、外部 API connector 等高风险或外部副作用模块，遇到发送、删除、支付、授权、发布、提交、桌面输入等动作时，应返回 `needs-confirmation`、`approvalRequest`、`draftRef` 或 `auditRef`。TUI Host 负责调用 `gui.ask_user` 收集确认，并在确认后发起新的受控调用。
7. **Computer Use / Window Action 用户级验收**：一次点击输入框的 smoke 只能证明基础链路。最终 success 至少需要真实用户产物，例如报告、notebook、figure、CSV、PPT/DOCX 或实验日志；目标打通需要 WindowActionSession、adapter readiness、真实 app/window capture/action refs、input intent、automation barrier、before/after evidence、annotation/image refs、BrowserRuntime DOM/AX observation refs/hints、`gui.present` 和 refs-first 证据链。GUI 不因参与展示或确认而拥有 Computer Use 执行权；Docker/noVNC/RDP/M6 multi-screen 只能作为 legacy diagnostic/historical/backend packaging 或 sidecar/ref historical regression 证据来源，不能替代当前 user-acceptance manifest。

最小可靠发现模型：

1. TUI 任务能力通过 Agent Host 原生 mechanisms 发现。GUI 只发送文本，或展示 `module.query/read/invoke(moduleId='capabilities')` 的结果。
2. GUI 展示能力通过 `gui:/capabilities/presentation.json` 和 `gui:/renderers/<componentId>.json` 只读暴露。TUI 用 `module.query/read(moduleId='gui')` 发现，用 `module.invoke(moduleId='gui', intent='present')` 表达展示意图。
3. 外部 app 连接器和 Computer Use 通过 TUI 原生 connector/tool/MCP/worker/action provider 发现。通讯 connector 还可以作为 Agent Host input intake，把外部消息等价成 Web/GUI composer 输入；GUI 侧按钮仍只发送 `/connectors ...`、`/computer-use ...` 等终端等价文本。高风险确认由 TUI Host 调用 `gui.ask_user` 或外部通道显式确认收集，connector/action provider 不直接调用 GUI。
4. 这些目录不互相注册、不互相 import、不共享 ranking。这样可以避免 GUI 变成第二个 agent，也避免 TUI 依赖 React 内部实现。
