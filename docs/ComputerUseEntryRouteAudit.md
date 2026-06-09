# Computer Use Entry Route Audit

最后更新：2026-06-09

## 目的

这份审计固定 `PROJECT_CU.md` P2 的入口清单：ordinary chat、native route、runtime gateway、slash command 和旧 VSCode co-work hook 只能进入 Codex / Agent Host 拥有的链路，不能直接触发 VSCode module、Computer Use act、local completion 或 final answer。

结论：

- 默认 ordinary chat 唯一入口是 Codex App Server turn。
- Host-owned Computer Use native route 只接受 explicit Host intent 或 refs-first Agent Host input。
- 裸自然语言、terminal output、palette item、action completed status 和 GUI presentation ack 不能成为 app module operation、Computer Use action、completion truth 或 final answer。
- runtime `gui` module 和 legacy GUI dynamic completion tools 已退役；旧请求必须 fail closed。

## 入口清单

| 入口 | 当前边界 | 决策 | 证明 |
| --- | --- | --- | --- |
| 默认 ordinary chat | `CodexAppServerClient.startTurn` 启动 Codex App Server；输入作为 App Server text / input_object。 | Host bridge。SciForge 不本地解析用户任务，不直接调用 VSCode module 或 Computer Use act。 | `src/runtime/codex/codex-app-server-client.test.ts` 覆盖 `/computer-use` 普通文本仍走 App Server。 |
| Host-owned Computer Use runtime intent | `CodexAppServerClient.startComputerUseNativeRoute` 只在 `runtimeIntent.source=host-owned` 时进入 native route。 | Host bridge。允许投影 refs-first native diagnostic / package bridge events；不拥有 final answer。 | `codex-app-server-client.test.ts` 覆盖 host-owned intent 才路由 native bridge。 |
| refs-first ordinary VSCode Agent Host input | `agentHostInput.schemaVersion=sciforge.codex-agent-host-input.v1` 且 target / refs 表达 current VSCode co-work。 | Host bridge。允许根据 Host input 进入 VSCode co-work readiness / live diagnostic；裸文本不触发。 | `computer-use-native-route.test.ts` 覆盖 refs-first Host input 可进入，裸 ordinary VSCode 文本不进入。 |
| `/computer-use diagnostic` slash | `isComputerUseNativeRouteCommand` 只认 diagnostic slash。 | Diagnostic-only。可进入 native route，但只能是诊断 / package bridge；不能声明 product-ready。 | `computer-use-native-route.test.ts` 和 `codex-app-server-client.test.ts` 覆盖非 diagnostic slash 不被 native route claim。 |
| `/computer-use click ...`、`/computer-use approve ...` 等普通 slash 文本 | 不满足 diagnostic slash，也没有 Host-owned intent。 | App Server ordinary input 或 fail closed；不作为 native Computer Use command。 | `codex-app-server-client.test.ts` 覆盖 GUI `/computer-use` 文本仍进 App Server。 |
| legacy GUI completion dynamic tools | `gui.present` / `gui.ask_user` / provider-safe aliases。 | Fail closed。只能作为 Host event projection 或 evidence metadata，不是模型可调用 completion tool。 | `codex-app-server-client.test.ts` 和 `tools/check-computer-use-no-bypass.test.ts` 覆盖 unsupported dynamic tool / static guard。 |
| retired runtime `gui` module | `module.invoke { moduleId: "gui", intent: "present" }`。 | Deleted / fail closed。runtime registry 不注册 `gui`，外部注入也忽略。 | `src/runtime/modules/dispatcher.test.ts` 覆盖 `module_not_found:gui`。 |
| legacy narrow ordinary VSCode text shortcut | 裸文本如“读取我当前打开的 VSCode 可见文本”曾可在 runner 存在时直接启动 live diagnostic。 | Deleted / fail closed。必须先成为 Host-owned intent 或 refs-first Agent Host input。 | `computer-use-native-route.test.ts` 覆盖 bare ordinary VSCode text 不启动 runner。 |
| Host input text-derived VSCode operation | `intentText` / `commandText` / prompt 文本曾可被本地 helper 推断成 `read-visible-text` / `focus-editor` / `insert-draft`。 | Deleted / fail closed。只有 structured app-module target operation，例如 `target.computerUseAppModule.operation` / `target.appModule.operation` 加 operation ref，可以选择 VSCode operation；旧 `target.vscodeCoWork.operation` 不作为兼容 alias。 | `computer-use-native-route.test.ts` 和 `agent-host-vscode-cowork-live-diagnostic.test.ts` 覆盖 generic Host text 不推断 operation；targeted search 无 text-derived helper。 |
| TextEdit WindowActionSession bridge | explicit Host-owned native route + opt-in TextEdit/Appium env 后可进入 Agent Host turn loop。 | Host bridge / diagnostic-only。保留为 env-gated diagnostic；没有 Host-owned route 不触发。 | `computer-use-native-route.test.ts` 覆盖 opt-in bridge，输出 sanitized refs。 |
| runtime gateway / package bridge projection | native route fallback 可调用 `tryRunVisionSenseRuntime` 并投影 `WorkspaceRuntimeEvent` / ToolPayload。 | Host bridge now, final-answer gate pending。P4 必须把 `done` 收敛为 Host final-answer envelope 或 blocked / partial。 | P2 只固定入口清单；P4 继续补 final-answer gate。 |

## 事件边界

Ordinary chat 的事件边界是 Codex App Server protocol events。SciForge 可以归一化：

- assistant message / done / error / approval / tool lifecycle。
- Host-owned final answer envelope。
- refs-first evidence、artifact refs、blocked / partial 状态。

SciForge 不能归一化为用户级完成的对象：

- completed `gui.present` / `gui.ask_user` tool call。
- `module.invoke gui.*` result。
- Computer Use action / `run_procedure.status=completed`。
- VSCode app module readiness。
- native route local ack。
- runtime gateway fallback text。

## P2 后续归属

- P3：把 ordinary chat Host-only bridge 写成强 contract；裸 `commandText` / `intentText` / terminal / palette / action refs 只能作为 evidence，不能推断 operation。
- P4：native route 只能接受 Host final-answer envelope；没有 same-run Host final-answer evidence 时必须 `blocked` / `partial`。
- P5：统一 public event sanitizer，确保 native route / runtime gateway / app module readiness 不泄漏 raw payload。
