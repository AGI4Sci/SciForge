# Computer Use Action Provider

本目录是 Computer Use 的唯一 action provider 真相源，包含 provider manifest、Python action loop、contract、safety gate、trace helper 和 pytest。

Python 包名继续是 `sciforge_computer_use`，方便旧代码和人类开发者保持稳定 import；物理目录已收敛到 `packages/actions/computer-use`。

## 边界

- Computer Use 是 action provider，不是 sense。
- Computer Use 是 TUI-owned extension，只直接和 TUI Host 通信；GUI 参与展示或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`。
- 它可以消费 `packages/observe/vision` 的 observation、OCR、focus region、Model Router vision/grounding translator observations 和 verifier feedback。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径；`vision-sense` 不拥有 executor、scheduler、desktop bridge 或完成判断。
- 它只执行通用 GUI action schema，并输出可验证 trace。
- Package 仍是 Computer Use contract、loop、safety gate 和 trace policy 的真相源；`src/runtime` 只承载 TUI Host adapter / package bridge、`GatewayRequest` 转换、host ports、`ToolPayload` 包装、runtime event 接入，以及尚未迁出的 macOS 截图/输入/文件 IO host implementation。runtime bridge 可以写 refs-first chain/sidecar evidence，但不能把 runtime-only shortcut、shell artifact write 或 app-private automation 放进 action provider 主路径。
- `packages/actions/computer-use/virtual-app-screen-host` 现在只保留为 legacy VirtualAppScreen compatibility package，用来复验历史 host protocol、permission/preflight、virtual display/app surface lifecycle、surface transport descriptor、host grant、human fire-and-release input queue、automation barrier、pause/resume/stop 和 host-owned evidence writer。当前产品路线由 Desktop native Host / WindowActionSession / target-window Computer Use adapter 接入承载；新增通用 host 语义应面向 refs-first host-port 和 WindowAction evidence 投影，而不是把 legacy VirtualAppScreen 写回 blocking product route。
- `provider-policy.ts` 记录稳定 host-port schema、display/target-window capture provider、executor provider、trace writer、event port 和 trace handoff target 命名；Host adapter 只实现这些命名后的平台端口。

## 对外交互

Computer Use 对外只暴露窄接口：

```text
getManifest()
runTask(request, hostPorts)
validateTrace(traceOrLocalPath, resolver?)
compactResult(result)
validateRepairManifest(manifestOrLocalPath, resolver?, require_existing_refs?)
buildRepairReplayEvidence(failureManifestOrRef, replayResultOrRef, replayTraceOrRef?)
validateRepairReplayEvidence(evidenceOrLocalPath, resolver?)
buildViewportRecoveryEvidence(failureManifestOrRef, replayResultOrRef, replayTraceOrRef?)
validateViewportRecoveryEvidence(evidenceOrLocalPath, resolver?)
buildTargetBoundRealWindowProbeEvidence(preflightManifestOrRef, resultOrRef, traceOrRef, ...)
validateTargetBoundRealWindowProbeEvidence(evidenceOrLocalPath, requireExistingRefs?)
buildIsolatedDesktopL1SmokeEvidence(preflightManifestOrRef, resultOrRef, traceOrRef, ...)
validateIsolatedDesktopL1SmokeEvidence(evidenceOrLocalPath, requireExistingRefs?)
buildIsolatedDesktopL3WorkflowEvidence(payload, requireExistingRefs?)
validateIsolatedDesktopL3WorkflowEvidence(evidenceOrLocalPath, requireExistingRefs?)
buildTargetBoundInputAdapterManifest(...)
validateInputAdapterManifestForRealDesktop(adapterManifestOrLocalPath)
buildVisibleRunViewer(...)
validateVisibleRunViewerManifest(manifestOrLocalPath, requireExistingRefs?)
getNativeToolManifest()
dispatchNativeTool(tool, payload, output_dir?)
validateNativeToolPayload(tool, payload)
```

另有两个 package-local contract module 只作为诊断/设计边界，不是 TUI Host 的稳定 runtime surface：

```text
sciforge_computer_use.evidence_ledger.EvidenceLedger
sciforge_computer_use.evidence_ledger.build_evidence_index(records)
sciforge_computer_use.evidence_ledger.build_evidence_snapshot(records)
sciforge_computer_use.evidence_ledger.build_planner_brief(records, recent_action_limit=5)
sciforge_computer_use.virtual_desktop_session.SessionManager
sciforge_computer_use.virtual_desktop_session.VirtualDesktopSession
sciforge_computer_use.virtual_desktop_session.VirtualDesktopSessionBlocked
```

这些 API 可以验证 refs-first evidence ledger、planner brief、session refs 和 input lease skeleton。它们不启动真实虚拟桌面 backend，不移动真实鼠标键盘，不声明真实 GUI app acceptance。

`hostPorts` 是模块和平台能力的唯一接触面，负责截图、裁剪、桌面/远程/dry-run 执行、trace 写入和事件上报。高风险动作不在模块内部弹 UI；模块返回 `needs-confirmation`、`approvalRequest`、trace refs 或 audit refs，由 TUI Host 决定是否调用 `gui.ask_user`，确认后再发起新的受控调用。

稳定 host-port 命名来自 `provider-policy.ts`：`display-capture` / `target-window-capture`、`model-router.capability.computer-use.planner`、`model-router.capability.computer-use.screenshot-translator`、`model-router.capability.computer-use.crop-translator`、`model-router.capability.computer-use.grounding-translator`、`model-router.capability.computer-use.verifier-translator`、`host-focus-region-crop`、`<desktopPlatform>-host-port-executor`、`<desktopPlatform>-generic-gui-executor`、`workspace-file-ref-trace-writer` 和 `workspace-runtime-events`。Legacy grounding adapter 只在显式配置兼容 endpoint 时作为 metadata 暴露。Trace handoff 目标固定为 `computer-use.trace-summary` 与 `computer-use.approval-request`，payload 只允许 refs 和 compact summary。

迁移期的边界规则是：package 拥有 contract、loop、safety gate、trace handoff 名称和通用策略；`src/runtime` 的当前职责是 TUI Host bridge 和平台 host-port implementation 适配，例如 macOS `screencapture`、Swift/AppleScript/shared-input executor、workspace 文件写入和 runtime event transport。新增 Computer Use 通用策略必须进入 package 或 observe provider；runtime adapter 只能暴露 refs-first evidence 和 host-port plumbing。

历史 VirtualAppScreen backlog 只作为 compatibility/regression 语境保留：package-owned Native VirtualAppScreen Host、legacy product-gate wording、adapter-first background app control、annotation-to-proposal、background native window capture/action、research workflow/live acceptance matrix。当前 blocking product route 以 `PROJECT_desktop_actions.md` 为准：Desktop native Host、WindowActionSession、target/session refs、before/after evidence、executor events、verification/artifact/trace refs 和 side-effect flags。BrowserRuntime 的 DOM/AX refs 只能作为 observation、target hint、freshness check、adapter source 或 verifier context；DOM/AX/Playwright 不得绕过 Computer Use 的 lease、before/after evidence 和 validator 单独证明完成。Docker/noVNC/RDP/M6 multi-screen、DeskPad、BetterDisplay、Mirage 和 Sunshine/Moonlight 只保留为 legacy diagnostic、historical evidence、backend packaging、reference/benchmark 或 sidecar/ref 回归，不再写成 active product gate、并发模型或产品验收 owner。

Legacy VirtualAppScreen real-driver compatibility smoke 只通过显式 opt-in script 进入：`npm run smoke:virtual-app-screen-macos-real-driver:opt-in`、`npm run smoke:virtual-app-screen-macos-real-human-input:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in`、`npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in`、`npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in` 和 `npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in`。它们不属于普通 `verify`，也不是当前 blocking product route；平台、权限、driver、target app/window 或 isolated input/control hook 不满足时必须 blocked/fail-closed，不能升级成 active product pass。macOS 入口还要求真实 runtime hooks opt-in：`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1|true|yes|on`，target app 使用 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_*` 标量环境变量或 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 指定；macOS human-input 仍需要外部 isolated hook command，且该 command 在 `capabilityProbe=true` 时返回安全 `inputAdapterCapability`，正常调用返回 refs-first evidence 和隔离字段。Linux Xpra real-driver opt-in 验证 attach、readFrame 和 Host-owned native refs；Linux Xpra real-human-input opt-in 还要求 `SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1`、`xpra`、`xdotool` 和 agent-owned Xpra display。Linux input hook 只能使用 `DISPLAY=<session.display>`，不能使用宿主真实 DISPLAY、shared system input 或焦点抢占。Windows IDD npm scripts use the shell-neutral `tools/run-virtual-app-screen-real-opt-in-smoke.ts` launcher and can receive `--linux-manifest` / `--evidence-manifest` args; Windows IDD real-driver opt-in verifies attach, readFrame, Host-owned native refs, `diagnosticOnly=false` evidence and Host ledger replay, and requires Windows `win32`, real driver/permission/target app readiness. Windows IDD real-human-input opt-in also requires a passed Linux real closed-loop manifest, human input, takeover/pause, resume/readFrame, isolated sidecar evidence and Windows platform/driver conditions. If opted-in attach blocks, the smoke verifies fail-closed evidence and then fails the compatibility command. Dogfood product smoke 与 legacy real-driver opt-in 是不同证据面，不能互相替代。

后续 runtime 集成里的 planner 必须通过 `model-router.capability.computer-use.planner` 或 Host 暴露的等价 Model Router capability 使用统一 provider。只有明确的 transport/protocol failure（502/gateway/upstream/proxy/network/timeout 等）才允许写 blocked diagnostics；不得静默 fallback 到未注册 provider/model/profile，也不得绕过 DOM/accessibility/tool 禁令。当前 package-only 闭环不调试 runtime planner fallback。

进程边界下，TUI Host 可以通过 JSON CLI 调用同一个 package loop：

```bash
python -m sciforge_computer_use --request-json '{"task":"click visible search box"}' --host-port-stdio
```

`--host-port-stdio` 使用 JSONL 协议：package 在 stdout 发出 `hostPortCall`，Host 在 stdin 返回 `hostPortResult`，最终输出 `finalResult`。这让 `run_task(request, hostPorts)` 仍然拥有 action loop，同时截图、planner、grounder、executor、verifier、trace writer 和 runtime event 仍由 TUI Host 注入。fixture 模式只用于 package tests 和 dry-run diagnostics，不能作为真实 Computer Use 成功证据。

Runtime package bridge 会在 run bundle 内写 `tui-host-run-task-chain.json`，记录 `computer-use-request.json`、`host-ports.json`、`tool-payload.json`、`vision-trace.json` 以及可选 `gui-present.json` / `gui-ask-user.json` 的 refs，并在 trace 的 `packageBridge.tuiHostRunTaskChainRef` 暴露该清单。它还会写 refs-first sidecars：`directory-listing.json`、按需 `approval-request.json` / `risk-audit.json` / `confirmed-request.json` / `blocked-manifest.json` / `repair-hint.json` / `continuation-request.json`。这些文件只证明 TUI Host -> package `run_task` -> GUI intent metadata、审批/修复/目录索引链路，不能替代真实截图、输入日志、artifact、verifier 或 completion-grade isolated-L3 用户级验收。

Package-local fixture 可以从文件运行，并把 refs-first result、trace 和本地 final artifact 写入指定目录：

```bash
python -m sciforge_computer_use \
  --request-json '{"task":"create a local fixture note","maxSteps":3,"metadata":{"requiresFinalArtifact":true}}' \
  --fixture-file fixtures/two-step-artifact.fixture.json \
  --fixture-output-dir /tmp/sciforge-computer-use-fixture
```

该命令只证明 CLI、fixture host ports、trace/result refs、budget debit 和 final artifact evidence guard 的 package-local plumbing。它不会证明真实桌面输入，也不能替代 runtime、GUI、CU-NEXT 或 release acceptance。

插件发现面可以用 package-local probe 直接验证 manifest、Python API 和 CLI fixture 调用：

```bash
python -m sciforge_computer_use.plugin_probe \
  --output-dir /tmp/sciforge-computer-use-plugin-probe \
  --run-fixture
```

该 probe 解析 `action-provider.manifest.json`，核对 `run_task` / `runTask` / `getManifest` 以及 repair、viewport、target-bound real-window evidence、isolated desktop L1/L3 evidence、target-bound adapter 等公开 API symbol，解析 manifest 中声明的 package-local builder/validator/response-compat dotted paths，检查 entrypoint path/module/CLI 是否 package-local，并对 entrypoint probe 与 `hostPortsContract.diagnosticProbes` 里的 `python -m sciforge_computer_use...` 命令做 import-only 校验。它可选用 stdin request + fixture JSON 调一次 `python -m sciforge_computer_use`。输出 `plugin-probe-manifest.json` 和 `plugin-probe-cli-result.json`；manifest 只写 refs/summary，不内联完整 action manifest 或 raw CLI stdout，也不触碰 SciForge runtime / GUI。该 probe 始终是 discovery diagnostic，`userAcceptanceEligible=false`，不能声明 L1/L3 完成。

Codex native tool / MCP 调试入口也保持 package-local，可先验证 `get_app_state` / `observe`、`click`、`type_text`、`scroll`、`press_key`、`propose_action`、`execute_scoped_action` 和 `get_replay_refs` 的最小闭环：

```bash
python -m sciforge_computer_use.native_tool \
  --tool get_app_state \
  --payload-json '{"displayGroupId":"dg-main","screenId":"screen-a"}' \
  --output-dir /tmp/sciforge-computer-use-native-tool
```

Repo 根目录的 `plugin.json`、`.mcp.json` 和 `packages/actions/computer-use/skills/sciforge-computer-use/SKILL.md` 声明 `sciforge.computer-use`，让 Codex CLI / app-server 以本地 plugin + MCP + skill 形态发现它。该入口是 Codex app-server/native plugin 的 contract probe，不是 GUI executor。`get_app_state` / `observe` 和 `get_replay_refs` 只写 refs；`click` / `type_text` / `scroll` / `press_key` 是 L2 友好的 mutating facade，会在 package 内部投影为 scoped action proposal、executor lease、executor event 和 evidence refs；`propose_action` 对高风险动作返回 `needs-confirmation` 和 approval refs；`execute_scoped_action` 必须携带 screen/window/actor/cursor/proposal/evidence/grounding provenance，且在 package-local debug 模式只写 executor-event / blocked manifest refs，不移动共享系统鼠标键盘。payload validator 拒绝缺 `screenId`、裸全局坐标、缺 app state/screenshot/accessibility/evidence/grounding refs、inline raw screenshot/base64/data URL、provider raw payload、Authorization/token/secret/password，以及 provider route、GUI private state、scheduler internals、executor adapter ref、lease id/scope 等公共参数。真实 mutating action 仍必须由 L2 Host 通过 scoped executor adapter 执行。

Package-local host-port probe 可以走真实 JSONL stdio contract，由父进程实现 host ports，而不是使用内置 fixture host：

```bash
python -m sciforge_computer_use.host_ports_probe \
  --request-json '{"task":"exercise B-shaped file evidence guards through package-local host-port probe","maxSteps":8,"metadata":{"requiresFinalArtifact":true,"requiresDirectoryEvidence":true}}' \
  --probe-file fixtures/host-port-probe-task-b.json \
  --output-dir /tmp/sciforge-computer-use-host-port-probe
```

该 probe 会写出 `host-port-probe-manifest.json`、`vision-trace.json` 和 `computer-use-result.json`。默认禁止 shared system input；scripted execution 只有在显式 `--allow-shared-input` 时才允许声明 `inputChannel=shared-system`。当前 probe 仍是 package-local scripted host ports，不等同于真实桌面输入证据，但它验证了独立插件的 stdio host-port 边界和 B 类目录证据 guard。

Package-local virtual desktop host-port probe 走同一个真实 child stdio loop，但 host ports 由 package-local virtual desktop 提供，`execute` 绑定 `VirtualInputAdapter`，只更新 virtual pointer / keyboard / input state refs：

```bash
python -m sciforge_computer_use.virtual_desktop_probe \
  --request-json '{"task":"complete a package-local virtual desktop six-step file evidence workflow","maxSteps":8,"metadata":{"requiresFinalArtifact":true,"requiresDirectoryEvidence":true}}' \
  --scenario-file fixtures/virtual-desktop-six-step.json \
  --output-dir /tmp/sciforge-computer-use-virtual-desktop
```

Repository fixtures 包括 `fixtures/virtual-desktop-six-step.json` 和 `fixtures/virtual-desktop-ambiguous-before-after.json`。该 probe 产出 `virtual-desktop-probe-manifest.json`、`computer-use-result.json`、`vision-trace.json`、screenshot refs、artifact refs、final artifact refs、file-list refs 和 virtual input state refs；定位失败时还会写 `blocked-repair-manifest.json`，其中包含 `failedStage`、`locateFailures`、`viewportFailures`、trace/screenshot refs、scenario ambiguity 和 virtual input isolation 状态，方便抽出最小 disambiguation 或 viewport recovery probe 后重跑。即使 scenario 返回 `completed`，它仍是 state-only simulated input、`realWindowEvidence=false` 的诊断证据，不是真实桌面输入或真实窗口完成证据，不能完成 PROJECT 的 B/C/verifier。

Package-owned target-bound window host-port probe 也走同一个真实 child stdio loop，但 parent host 拥有一个声明式目标窗口和 isolated executor。该 executor 只接受 generic actions（click / double_click / focus / type_text / press_key / hotkey / scroll / save），只改变这个 package-owned target environment，并写出 adapter manifest、target-window ref、binding proof、ready desktop preflight、result/trace refs 和 target-bound real-window evidence：

```bash
python -m sciforge_computer_use.target_bound_window_host_probe \
  --request-json '{"task":"complete a target-bound six-step file evidence workflow","maxSteps":6,"metadata":{"requiresFinalArtifact":true,"requiresDirectoryEvidence":true}}' \
  --scenario-file fixtures/virtual-desktop-six-step.json \
  --output-dir /tmp/sciforge-computer-use-target-bound-window
```

一页 PPTX target-bound 任务可以直接运行 repository fixture：

```bash
python -m sciforge_computer_use.target_bound_window_host_probe \
  --request-json '{"task":"create a one-page target-bound presentation deck","maxSteps":4,"metadata":{"requiresFinalArtifact":true}}' \
  --scenario-file fixtures/target-bound-one-page-pptx.json \
  --output-dir /tmp/sciforge-computer-use-target-bound-pptx
```

若需要用户能看到 agent 的 actor cursor、scoped executor action 和 evidence/replay 过程，可用 visible run wrapper 调同一个 package-owned host，并额外写出 replay viewer：

```bash
python -m sciforge_computer_use.visible_run \
  --mode target-bound-window \
  --request-json '{"task":"create a visible one-page target-bound presentation deck","maxSteps":4,"metadata":{"requiresFinalArtifact":true}}' \
  --scenario-file fixtures/target-bound-one-page-pptx.json \
  --output-dir /tmp/sciforge-computer-use-visible-pptx \
  --title "Visible PPTX run"
```

该 wrapper 不新增 GUI/runtime 依赖，不移动系统鼠标，也不发送全局键盘事件。它会复用 target-bound 或 virtual desktop host run 的 `computer-use-result.json`、`vision-trace.json`、screenshot refs、artifact refs 和 virtual/target input event refs，再生成 `visible-run-viewer-manifest.json` 与 `visible-run-viewer/index.html`。Viewer 只引用本地截图/产物路径，不内联 data URL 或 raw payload；manifest 的 isolation block 必须保持 `sharedSystemInputUsed=false`、`systemPointerMoved=false` 和 `systemKeyboardEventsSent=false`。

Visible viewer 对空白帧的 package-local 规则是：如果没有 screenshot refs、截图 ref 缺失/为空，或候选截图是 inline image/data URL，viewer 不能写空白截图；它必须写 `kind=placeholder` 的 frame，并说明 `reason`、`explanation`、`sourceRefs` 和 `sourceContext`。这个 placeholder 只解释“为什么没有可渲染截图”，不能替代当前视觉完成证据。

可用 standalone smoke 验证 placeholder contract：

```bash
python - <<'PY'
from pathlib import Path
from sciforge_computer_use.visible_viewer import build_visible_run_viewer

out = Path("/tmp/sciforge-computer-use-visible-placeholder")
payload = {
    "schemaVersion": "sciforge.computer-use.result.v1",
    "status": "max-steps",
    "reason": "no screenshot refs in diagnostic result",
    "steps": [{"index": 0, "status": "done", "action": {"kind": "wait", "reason": "diagnostic wait"}}],
    "failureDiagnostics": {
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    },
}
manifest = build_visible_run_viewer(output_dir=out, result=payload, title="Placeholder smoke")
assert manifest["validation"]["ok"] is True, manifest["validation"]
assert manifest["validation"]["frameCounts"]["placeholder"] == 1, manifest["validation"]
print(manifest["viewerHtmlRef"])
PY
```

更多复杂任务 fixture 保持同一 generic host/executor contract：`target-bound-csv-table-edit.json` 覆盖 CSV/表格编辑，`target-bound-form-dialog.json` 覆盖表单填写与 Tab 导航，`target-bound-visible-high-risk-confirmation.json` 覆盖可见高风险确认 demo，`target-bound-form-high-risk-submit.json` 覆盖高风险外发提交 fail closed，`target-bound-menu-hotkey.json` 覆盖鼠标菜单 + 键盘保存，`target-bound-preview-directory.json` 覆盖保存后预览和目录 file-list refs，`target-bound-cross-app-document-workflow.json` 覆盖 package-owned source reader -> Word-compatible writer -> file browser/preview 的跨应用形状诊断。Package tests 还覆盖两个不需要单独 fixture 文件的衍生场景：安全表单步骤完成后，高风险确认弹窗按钮仍返回 `needs-confirmation`；保存位置需要连续多次 scroll 后才可见时，viewport recovery evidence 仍保留 scroll action、delta、state refs 和最终选中元素。

该 probe 是 package-owned target-bound host，不是 SciForge runtime、GUI、browser acceptance、CU-NEXT 或 shared system input。成功 run 会写 `target-bound-window-host-probe-manifest.json`、`desktop-host-port-preflight-manifest.json`、`target-bound-input-adapter-manifest.json`、`input-adapter-target-binding.json`、`target-window.json`、`target-binding-proof.json`、`computer-use-result.json`、`vision-trace.json` 和 `target-bound-real-window-probe-evidence.json`。证据必须满足 `preflightStatus=ready`、`targetBindingValidation(requireExistingRefs=true)`、distinct initial/final screenshot refs、`inputExecuted=true`、`executeFailClosed=false`、`realWindowEvidence=true`、`diagnosticOnly=false`，并且 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。Host 会在 manifest/result `failureDiagnostics`、execution metadata 和 target-bound evidence 的 `realWindowEvidenceRefs` 中写独立 `targetPointerStateRef` / `pointerEventLogRef`、`targetKeyboardStateRef` / `keyboardEventLogRef`、`targetInputEventLogRef` / `inputEventLogRef`。当 scenario 的 `workflowRequirements.requiredInputModalities=["pointer","keyboard"]` 时，validator 会同时读取 result/trace steps 和这些 event log refs，要求 modality-specific event log 非空，并要求 event `actionIndex` 覆盖对应 pointer / keyboard step。Declared artifact output 由 `artifactSpec.kind` 或 `finalArtifactRef` 扩展名选择 renderer；`text` / `markdown` / `csv` 写文本类文件，`.pptx` / `slide-deck` 会写 OOXML deck 并写 `artifactValidationRef` / `pptxValidationRef`，`.docx` / `word-document` 会写 Word-compatible OOXML document 并写 `artifactValidationRef` / `docxValidationRef`。PPTX/DOCX validators 记录 zip/XML/slideCount/paragraph/table/list/hash/size/无宏校验，并抽取通用 `textRuns`、`textRunCount`、`textCharCount` 和 `normalizedTextSha256`，供跨格式内容因果校验复用。产物 evidence 还必须能追到 `artifactMetadata.savedByActionIndex` 和 `savedByInputModality`：PPTX、DOCX 或文件不能只因为 renderer 生成了文件就被声明完成，保存动作必须是 generic `save` 或 `Ctrl/Cmd+S` 一类键盘动作，且有对应 keyboard event。Planner contract 允许标准本地文档保存热键，但继续拒绝显式 app-private 或未知快捷键。带 `--source-repair-manifest` 重跑时，它也会把 ambiguous repair replay 或 viewport/offscreen recovery evidence 提升为 real-window evidence，但仍只在 package-owned target-bound window 范围内声明成功。

Blocked repair manifest 本身由 package-local `sciforge_computer_use/repair_manifest.py` 的 `validate_repair_manifest` / `validateRepairManifest` 校验。该 validator 要求 package-local blocked manifests 保留显式 negative side-effect flags（如 `inputExecuted=false`、`sharedSystemInputUsed=false`、`realWindowEvidence=false`、`rawPayloadWritten=false`、`inlineImageWritten=false`，并保持 `diagnosticOnly=true`），拒绝 inline/base64 payload evidence，并可用 `require_existing_refs=True` 检查 result、trace、screenshot、observation、artifact 和 probe refs 指向本地文件。它只提升 Task C 的审计性，不把 package-local repair evidence 标成 C 完成。

修复重跑时可把前一次失败的 `blocked-repair-manifest.json` 作为 `--source-repair-manifest` 传入；probe 会额外写 `repair-replay-evidence.json`。该 evidence 由 `build_repair_replay_evidence` 构造，并由 `validate_repair_replay_evidence` 校验：源失败必须是 ambiguous multi-match，重跑必须显式收敛到 `afterMatchCount=1`，`selectedElementId` 必须来自原失败候选集，并且必须保留 `sourceFailureManifestRef`、`replayResultRef` 和 `replayTraceRefs`。传入 `require_existing_refs=True` 时，validator 还要求这些关键 refs 指向现有本地文件。当 evidence 标记 `diagnosticOnly=true` 或 `realWindowEvidence=false` 时，它只证明 package-local repair replay 逻辑，不完成 PROJECT C，也不影响真实视觉/verifier 验收状态。

Viewport/offscreen 修复重跑会写 `viewport-recovery-evidence.json`。该 evidence 由 `build_viewport_recovery_evidence` / `buildViewportRecoveryEvidence` 构造，并由 `validate_viewport_recovery_evidence` / `validateViewportRecoveryEvidence` 校验：源失败必须是当前 viewport 零可见匹配且存在 offscreen candidates，重跑必须包含 scroll recovery action、非零 scroll delta、scroll 前后 virtual input state refs、replay trace refs，并最终唯一选中一个原 offscreen candidate。传入 `require_existing_refs=True` 时，validator 还要求 source failure、replay result、replay trace 和 scroll state refs 指向现有本地文件。若声明 `realWindowEvidence=true`，validator 还要求显式 `realWindowEvidenceRefs` 和成功的 `targetBindingValidation`；`realWindowEvidence=false` 时它仍只是 package-local scroll recovery diagnostic，不完成 PROJECT C。

真实窗口 host ports 在声明成功前必须先通过 desktop preflight：

```bash
python -m sciforge_computer_use.desktop_preflight \
  --output-dir /tmp/sciforge-computer-use-desktop-preflight
```

该 preflight 不截图、不执行输入，只写出 `desktop-host-port-preflight-manifest.json`。默认没有本机 host capability 时返回 `blocked`，并记录 loop required host ports (`capture/plan/locate/execute/verify`)、evidence required host ports (`writeTrace/emitEvent`)、observed capabilities、input isolation 风险、PROJECT.md 约束和下一步建议。只有 host 明确提供所有真实桌面证据端口、capture/executor、target window，声明 `independent-simulated-input-adapter` 的 manifest 或 manifest ref，并额外提供 `sciforge.computer-use.input-adapter-target-binding.v1` target binding manifest/ref 证明 adapter 会改变可验证目标环境时，manifest 才能返回 `ready`。这个 host 可以是本机 native host ports，也可以是 package-owned target-bound window host；两者都必须保留同一 generic host-port contract、refs-first evidence、target-bound isolated input，并且不得读取 GUI private state。Target binding manifest 可由 `build_input_adapter_target_binding_manifest` 生成，并由 `validate_input_adapter_target_binding_manifest` 校验；desktop preflight 会启用本地 ref 存在性检查。校验通过要求 `bindingStatus=bound`、`targetEnvironmentKind` 非空且非 virtual/diagnostic、`targetWindowResolved=true`、`executeChangesTargetEnvironment=true`、`realWindowEvidenceCapable=true`，保留存在的 `adapterManifestRef`、`targetWindowRef` 和至少一个 `evidenceRefs`，且 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。此外，preflight 会拒绝 diagnostic/fail-closed executor（例如 `native-stdio-fail-closed-executor`）和 shared/global/real OS input channel；ready 只允许 target-bound isolated input channel，例如 `isolated-window`、`target-bound-simulated-input`、`independent-simulated-input-adapter` 或 `remote-desktop-isolated-session`。Preflight ready 只是进入实际 run 的必要条件；只有实际 target-bound run 产生 initial/final screenshot refs、trace/result refs、target binding validation、`inputExecuted=true` 和文件/目录证据后，才能从诊断 contract 提升为 package-level real-window evidence。单独的 state-only virtual adapter manifest 不能让真实桌面 preflight ready。Shared system input 只能作为显式确认后的诊断路径，不能作为最终输入隔离成功证据。

历史隔离桌面 backend 需要 Linux desktop + noVNC + LibreOffice/browser 依赖。当前 package 提供 readiness/blocked probe，用来证明本机是否具备启动 legacy backend diagnostic 的依赖；它不启动 noVNC，不截图，不执行输入，也不完成 active product gate：

```bash
python -m sciforge_computer_use.isolated_desktop_backend_probe \
  --output-dir /tmp/sciforge-computer-use-isolated-backend
```

该 probe 写 `isolated-desktop-backend-probe-manifest.json`。`status=ready` 只表示 Xvfb/window manager/VNC/noVNC/LibreOffice/browser 依赖存在；它是 legacy diagnostic/backend packaging readiness，不是 active Computer Use 产品验收。`status=blocked` 是当前机器或能力不足的可审计证据，不能被提升为真实 GUI 完成。

可复现 Docker backend bundle 可以单独写 spec manifest；它只检查 package 内 Dockerfile、build context、apt dependency 清单和 localhost-only run 命令是否可发现，不构建镜像、不启动 backend、不执行输入：

```bash
python -m sciforge_computer_use.isolated_desktop_backend_bundle \
  --output-dir /tmp/sciforge-computer-use-isolated-backend-bundle
```

Docker build 必须以 `packages/actions/computer-use` 为 context，避免 Dockerfile 的 package-local `COPY` 读取 repo root：

```bash
cd packages/actions/computer-use
docker build \
  --build-arg PYTHON_BASE_IMAGE=${SCIFORGE_DOCKER_BASE_IMAGE:-python:3.12-slim-bookworm} \
  --build-arg DEBIAN_APT_MIRROR=${SCIFORGE_DOCKER_DEBIAN_APT_MIRROR:-} \
  --build-arg DEBIAN_SECURITY_APT_MIRROR=${SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR:-} \
  --build-arg APT_ACQUIRE_RETRIES=${SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES:-3} \
  -f sciforge_computer_use/isolated_desktop_backend.Dockerfile \
  -t sciforge-computer-use-isolated-backend:local \
  .

docker run --rm \
  -v /tmp/sciforge-computer-use-docker-evidence:/evidence \
  --entrypoint python \
  sciforge-computer-use-isolated-backend:local \
  -m sciforge_computer_use.isolated_desktop_backend_probe \
  --output-dir /evidence/backend

docker run --rm \
  --shm-size 1g \
  -p 127.0.0.1:6089:6089 \
  -v /tmp/sciforge-computer-use-docker-evidence:/evidence \
  sciforge-computer-use-isolated-backend:local \
  --output-dir /evidence/l1 \
  --execute \
  --display :99 \
  --vnc-port 5909 \
  --novnc-port 6089 \
  --timeout-seconds 30 \
  --resource-lock-root /tmp/sciforge-computer-use-l1-locks
```

历史严格 Docker diagnostic 是 `npm run smoke:cu-isolated-l1:docker` / `npm run smoke:cu-isolated-l3:docker`，别名分别是 `npm run smoke:cu-isolated-l1:opt-in` 和 `npm run smoke:cu-isolated-l3:opt-in`；它们会构建 package Dockerfile 并直接运行 L1/L3 `--execute`，非 completed 时返回失败。需要只跑 pytest skip-gated opt-in 回归时可用 `npm run smoke:cu-isolated-l1:pytest-opt-in`。网络受限时可用 `SCIFORGE_DOCKER_BASE_IMAGE=<mirror-or-local-python-base>` 覆盖默认 base image，也可用 `SCIFORGE_DOCKER_DEBIAN_APT_MIRROR` / `SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR` 覆盖 Debian apt 下载源，并用 `SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES` 调整 apt retry；这些只改变镜像/apt 拉取来源和重试次数，不放宽 evidence schema。若 Docker Desktop 没有共享当前 repo 路径，可把 `SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR` 或 `SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR` 指向 Docker 可挂载的宿主机目录，例如 `/tmp/sciforge-cu-isolated-l1` 或 `/tmp/sciforge-cu-isolated-l3`；这只改变 evidence volume 的宿主机位置，不改变容器内 evidence schema。这些入口和 `.github/workflows/cu-isolated-desktop-l1.yml` 的 `workflow_dispatch` 手动 job 都不进入普通 `verify`，也不再作为 active product gate。Docker bundle manifest、Docker build log、readiness manifest 或 noVNC/RDP viewer availability 都不能单独完成 PROJECT backend；历史 completed refs 可作为 regression/historical evidence，但 active acceptance 必须由 native app-server/native plugin surface、Computer Use package contract、platform sidecar contract 和 current refs-first evidence 共同证明。最近一次历史 Docker L1 diagnostic 使用 `public.ecr.aws/docker/library/python:3.12-slim-bookworm`、清华 Debian/security apt mirror、`SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES=5` 与 host evidence dir `/tmp/sciforge-cu-isolated-l1`，产出 `status=completed` 的 `/tmp/sciforge-cu-isolated-l1/l1/isolated-desktop-l1-smoke-probe-manifest.json`；历史 Docker L3 diagnostic 使用同类 build 参数和 `/tmp/sciforge-cu-isolated-l3`，产出 `status=completed` 的 `/tmp/sciforge-cu-isolated-l3/l3/isolated-desktop-l3-workflow-probe-manifest.json`。容器内复验 completed evidence validators 均返回 `ok=true`、`errorCount=0`。

Native M6 opt-in 入口是稳定 npm script：

```bash
npm run smoke:cu-native-m6:opt-in
```

该入口调用 `sciforge_computer_use.native_multi_screen_live_demo`，默认 sidecar 是 macOS refs-first native sidecar `python -m sciforge_computer_use.macos_native_sidecar`，evidence 写入 `docs/test-artifacts/cu-native-m6`。可用 `SCIFORGE_CU_NATIVE_M6_EVIDENCE_DIR`、`SCIFORGE_CU_NATIVE_M6_RUN_ID`、`SCIFORGE_CU_NATIVE_M6_PLATFORM`、`SCIFORGE_CU_NATIVE_M6_SIDECAR_COMMAND` 和 `SCIFORGE_CU_NATIVE_M6_SIDECAR_TIMEOUT_SECONDS` 覆盖输出目录、run id、平台标签、sidecar 命令和超时；`action-provider.manifest.json` 的 `hostPortsContract.nativeMultiScreenSidecarProtocol.commands.nativeM6OptIn` 指向同一入口。macOS 上它只使用 native sidecar 的 capabilities/discover/preflight/capture/state/execute refs 和独立虚拟输入事件记录，不执行规划或完成判断，也不发送共享系统鼠标键盘输入。非 macOS、缺少 `swift` / `screencapture`、没有 Screen Recording 权限、窗口发现或截图失败时必须 fail closed，写出 blocked diagnostic refs 并以非零退出码结束；不能 fallback 到 Docker/noVNC/RDP，也不能把 legacy backend readiness、viewer 可用性或历史 evidence 提升为 active M6 产品验收。

L1 smoke 入口写 `isolated-desktop-l1-smoke-probe-manifest.json`。它会复用 backend readiness，额外记录 isolated input / screenshot runtime components、目标 `acceptanceTier=l1-isolated-smoke` 和必须生成的 completed evidence refs。默认不执行真实 GUI，只写 blocked manifest；传入 `--execute` 后，只有 Linux、backend readiness、`xdotool` 和截图工具都 ready 时才会尝试启动 Xvfb/window manager/VNC/noVNC/browser，并且所有输入与截图都绑定 isolated `DISPLAY`。Runner 会先清理 output dir 下自己生成的上一轮 `isolated-l1-session` / viewer 状态，避免复用 evidence dir 时 Chromium profile lock、旧截图或旧日志污染本轮结果；随后分配本轮可用的 X display、VNC/noVNC localhost 端口并写通用 `isolated-runtime-resource-allocation.json`，避免多个线程争用固定端口；也可通过 `--display`、`--vnc-port`、`--novnc-port`、`--timeout-seconds` 和 `--resource-lock-root` 为真实 Linux/CI 调试固定 runner 资源，manifest 会在 `commandPlan.runnerOptions` 中记录这些请求值。分配失败会保持 blocked。Runner 会把 backend 子进程放入独立进程组、为每个长生命周期进程写 stdout/stderr log refs 而不是保留未 drain 的 pipe、检测启动后早退，并用 bounded polling 验证 isolated `DISPLAY` 可通过 `xdotool getdisplaygeometry` 查询；随后要求 VNC TCP 端口 ready 以及 noVNC localhost `/vnc.html` HTTP viewer ready。HTTP proof 只记录 status、bytesRead、sha256、HTML/noVNC marker 和 rawPayloadWritten=false，不保存原始 HTML。Browser 启动后，smoke page 必须通过窗口标题 ready marker 被 isolated `xdotool search --onlyvisible --name` 找到，并用 `getwindowgeometry --shell` 记录 visible browser window geometry，失败则在输入前 blocked。Pointer clicks 通过 `xdotool mousemove --window <windowId>` 在 window coordinate space 内发送，并写通用 `targetWindowRef` / `windowBoundPointerProofRef`，证明 hit point 落在目标 bounds 内且引用对应 executor command event；button target 使用真实按钮区域的 window-local bounds/hit point，避免页面坐标或过宽 bounds 冒充按钮点击。Chromium-family 启动会抑制首启/后台 UI，在 root/container 环境自动加 `--no-sandbox` 并加 `--test-type` 抑制 root/no-sandbox 测试横幅，保持 smoke page window-local 坐标稳定。Ready 后写 `backend-readiness-proof.json`、`backend-processes.json` 和 `isolated-runtime-resource-allocation.json`，每个 isolated input 命令还会写入 `l1-executor-command-events.json`，让 pointer/keyboard event 能追到对应 `xdotool` 调用、action index、modality、returncode 和 isolated `DISPLAY`。结束清理后把 session/noVNC/capture/replay refs 标成 `closedAfterRun=true`，避免把已关闭的 viewer 写成仍在运行。任一条件不满足或 evidence validator 不通过都会保持 blocked，避免把计划或 readiness 合成成功证据：

```bash
python -m sciforge_computer_use.isolated_desktop_l1_smoke_probe \
  --output-dir /tmp/sciforge-computer-use-l1-smoke

python -m sciforge_computer_use.isolated_desktop_l1_smoke_probe \
  --output-dir /tmp/sciforge-computer-use-l1-smoke \
  --execute

python -m sciforge_computer_use.isolated_desktop_l1_smoke_probe \
  --output-dir /tmp/sciforge-computer-use-l1-smoke \
  --execute \
  --display :99 \
  --vnc-port 5909 \
  --novnc-port 6089 \
  --timeout-seconds 30 \
  --resource-lock-root /tmp/sciforge-computer-use-l1-locks
```

本机 capture-only 能力可以单独 probe，但不能声明 B/C 完成：

```bash
python -m sciforge_computer_use.native_capture_probe \
  --output-dir /tmp/sciforge-computer-use-native-window-capture
```

该 probe 只使用只读窗口 inventory 和 `screencapture -x` / `screencapture -x -l<windowid>` 写 screenshot ref、window inventory ref 和 `native-capture-probe-manifest.json`；window-scoped capture 成功时还会写 `native-selected-window.json` 和 `native-target-window-binding-proof.json`，证明截图 ref 与选中窗口 inventory 绑定。它不执行点击、键盘、AppleScript action、AX action 或 shared system input。Manifest 中 `observedHostPorts` 只能包含 `capture`，desktop preflight 仍会因为缺少 plan/locate/execute/verify/writeTrace/emitEvent、native executor 和 independent input adapter 而保持 `blocked`。

Native capture 也可以穿过真实 stdio child loop 验证，而不是只跑独立 screenshot probe：

```bash
python -m sciforge_computer_use.native_host_ports_probe \
  --request-json '{"task":"native stdio capture should fail closed before input","maxSteps":1}' \
  --output-dir /tmp/sciforge-computer-use-native-stdio
```

该 probe 由父进程提供 `capture/plan/locate/execute/writeTrace/emitEvent` host ports，并驱动 child `python -m sciforge_computer_use --host-port-stdio`。`capture` 返回真实 window screenshot ref，`execute` 的 stdio envelope 保持 `ok=true`，但 result payload 返回 `{ok:false, blocked:true}`；因此 child loop 会产生 loop-level `failed-with-reason`、`failedStage=execution`、`actionIndex` 和 `vision-trace.json`，而不是 CLI/protocol failure。Window-scoped capture 成功后，probe 会刷新 state-only target binding candidate，让它引用 `native-selected-window.json`、`native-target-window-binding-proof.json`、真实 screenshot ref 和 window inventory ref；preflight 因 `bindingStatus=virtual-state-only`、`executeChangesTargetEnvironment=false`、`realWindowEvidenceCapable=false` 继续 blocked。Probe 同时把 `native-stdio-probe-manifest.json`、preflight ref/status/blocked reasons、target-window resolution、binding proof refs 和 `executeFailClosed` 写回 final result 的 `failureDiagnostics`，调用者不需要旁路读取 manifest 才能知道为什么被阻断。它仍不提供真实 executor 或 input adapter，所以不能声明 B/C 完成。

独立模拟输入适配器的 package-local contract 位于 `sciforge_computer_use.virtual_input_adapter`：

```python
from sciforge_computer_use.virtual_input_adapter import VirtualInputAdapter
from sciforge_computer_use.virtual_input_adapter import build_input_adapter_target_binding_manifest

adapter = VirtualInputAdapter("/tmp/sciforge-computer-use-virtual-input", session_id="diagnostic")
outcome = adapter.execute({"kind": "click", "targetDescription": "Search"}, {"ok": True, "x": 10, "y": 20})
binding = build_input_adapter_target_binding_manifest()
```

该 adapter 只维护 virtual pointer / keyboard / input state JSON refs，metadata 固定记录 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false` 和 `systemKeyboardEventsSent=false`。默认 target binding helper 生成 `unbound` refs-first manifest；host 必须补齐 adapter manifest ref、target window ref 和绑定证据 refs，并通过 validator，才能解除 preflight 的 target binding 阻断。它可以作为 host executor 的隔离输入契约样板，但它是 state-only 诊断能力，不会改变真实桌面；真实窗口 B/C 仍需要 host 把独立输入适配器绑定到可验证的目标环境。

VirtualAppScreen adapter registry 的静态基座是 `adapter-registry.manifest.json`。它声明可 describe/query/read 的 adapter profile、capability id、lookup policy 和失败诊断 taxonomy；未知 adapter 或未知 capability 必须按 manifest fail closed，返回 `adapter-unavailable` blocked diagnostic。Registry 只描述 profile 与 capability，不是 readiness 或完成证据；DOM/AX/Playwright/shell-only 只能作为声明过的观察/grounding hint，不能绕过 observe/ground/propose/lease/execute/verify、before/after evidence、artifact validator 和 `gui.present` refs。

Evidence Ledger MVP 是 package-local append-only contract。`EvidenceLedger(output_dir, run_id=...)` 会写：

```text
evidence-log.jsonl
evidence-index.json
evidence-snapshot.json
planner-brief.json
```

Record schema 是 `sciforge.computer-use.evidence-record.v1`，record type 固定为 `observation`、`region`、`text`、`visual-object`、`vlm-claim`、`grounding`、`action`、`verification`、`artifact`、`uncertainty` 和 `completion-claim`。MVP 已可写 observation/text/artifact/grounding/action/verification/uncertainty/completion-claim；region/visual-object/vlm-claim 是后续 sense/vision verifier provider 写入的 contract type。Staleness 由 action record 的 `invalidates` 和 `evidence-index.json.staleBy` 表达：state-changing generic action 会让当前 visible state record stale，read-only evidence action 和 `observationOnly=true` 不会。Planner 只消费 `planner-brief.json` 这类 compact query，不读完整 log。

Standalone smoke：

```bash
python - <<'PY'
import json
from pathlib import Path
from sciforge_computer_use.contracts import ActionPlan, ExecutionOutcome, Observation
from sciforge_computer_use.evidence_ledger import EvidenceLedger

root = Path("/tmp/sciforge-computer-use-evidence-ledger")
root.mkdir(parents=True, exist_ok=True)
(root / "screen-1.png").write_bytes(b"not-empty")
(root / "note.md").write_text("# Note\n", encoding="utf8")

ledger = EvidenceLedger(root, run_id="readme-smoke")
obs_id = ledger.append_observation(
    Observation(
        ref=str(root / "screen-1.png"),
        summary="Search box visible",
        visible_texts=("Search",),
        artifacts={"finalArtifactRef": str(root / "note.md")},
    ),
    action_index=0,
    query=None,
)
action_id = ledger.append_action(
    ActionPlan(kind="click", reason="generic pointer action"),
    ExecutionOutcome(ok=True, message="clicked"),
    action_index=0,
    before_record_id=obs_id,
    grounding_record_id=None,
)
ledger.append_completion_claim(
    action_index=0,
    summary="diagnostic completion claim",
    status="blocked",
    supports=[action_id],
)
for name in ["evidence-log.jsonl", "evidence-index.json", "evidence-snapshot.json", "planner-brief.json"]:
    assert (root / name).is_file(), name
assert ledger.planner_brief()["schemaVersion"] == "sciforge.computer-use.planner-brief.v1"
print(json.dumps({"outputDir": str(root), "recordCount": len(ledger.records)}, sort_keys=True))
PY
```

`VirtualDesktopSession` / `SessionManager` skeleton 是 package-local session boundary。它会创建 per-thread session root、`virtual-display.json`、`virtual-input-queue.jsonl`、`filesystem-root/`、`capture-stream.json`、`replay-bundle.json`、`input-adapter-manifest.json` 和 lease refs；缺少 target-bound isolated input adapter、使用 state-only adapter、重复 lease、错 lease release、关闭后再 lease 都会写 blocked manifest 并 fail closed。该 skeleton 不启动 noVNC/RDP，不截图，不执行输入，manifest 始终保持 `diagnosticOnly=true`、`realWindowEvidence=false`、`inputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false` 和 `systemKeyboardEventsSent=false`。

Session skeleton targeted tests：

```bash
python -m pytest packages/actions/computer-use/tests/test_virtual_desktop_session.py -q
```

Target-bound real-window probe evidence 由 `build_target_bound_real_window_probe_evidence` / `validate_target_bound_real_window_probe_evidence` 校验。它区分“证据形状 validator”和“实际 package target-bound run”：validator 只检查 refs-first payload，actual run 必须由 `target_bound_window_host_probe` 或未来 native target-bound executor 产生这些 refs。Evidence 要求 `preflightStatus=ready`、`inputExecuted=true`、`executeFailClosed=false`、`realWindowEvidence=true`、`diagnosticOnly=false`、target-bound input channel、distinct initial/final screenshot refs、trace/result refs、`finalArtifactRef` 和完整 `targetBindingValidation(requireExistingRefs=true)`。Target-bound harness 只能使用 `acceptanceTier=package-diagnostic`，且 `userAcceptanceEligible=false`；它不能声明 L1/L2/L3 或用户级验收。它也要求 `osInputExecuted=false`、`realOsInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`，并拒绝 inline screenshot/base64/data URL。Task B 和鼠标/键盘复杂任务可额外启用 `workflowRequirements`：`minimumActionCount=6`、`requiredInputModalities=["pointer","keyboard"]`、`requiresCurrentStepScreenshots=true`、`forbidPriorRoundCompletionEvidence=true` 和 `requiresDirectoryEvidence=true`；启用后 validator 会读取 `resultRef` / `traceRefs`，确认结果和 trace 已 completed、每步有当前 screenshot/observation ref、最终 visual + artifact refs + file-list refs 可见、鼠标/键盘 modality 都出现，并拒绝 prior-round ledger / historical done 标记。

**重要：下面 legacy `diagnosticOnly=false` / `userAcceptanceEligible=true` 字段只描述历史 isolated backend diagnostic contract 和 runner 完成条件，不是 active VirtualAppScreen Native Host `diagnosticOnly=false` pass。** active Native Host pass 必须来自 package-owned Host refs、真实 platform adapter、live frame transport、hot-path input、automation barrier、takeover/resume 和 current-run ledger replay；legacy noVNC/Docker/Xpra-shaped evidence 不能提升为产品通过。

Legacy isolated desktop L1 smoke evidence 由 `build_isolated_desktop_l1_smoke_evidence` / `validate_isolated_desktop_l1_smoke_evidence` 单独校验。这个 contract 比 readiness probe 更强，默认启用 existing refs 检查，要求 `acceptanceTier=l1-isolated-smoke`、`backendKind=linux-novnc-libreoffice-browser`、`targetEnvironmentKind=linux-isolated-desktop-session`、`captureSource=isolated-virtual-display`、`inputChannel=remote-desktop-isolated-session`、`diagnosticOnly=false`、`realWindowEvidence=true`、`userAcceptanceEligible=true`、`inputExecuted=true`，并保留所有 shared/system/real OS input flags 为 `false`。它必须读取 completed `resultRef` / `traceRefs`、至少 before/after 两个真实 screenshot refs、viewer manifest/html、pointer/keyboard/input event logs、session refs、noVNC viewer ref、`backendReadinessProofRef`、`executorCommandEventLogRef`、`targetWindowRef`、`windowBoundPointerProofRef`、`processRef`、`resourceAllocationRef`、目录型 `filesystemRootRef`、evidence ledger refs 和 current completion claim；在 existing refs 模式下还会直接读取 `preflightRef`、`backend-readiness-proof.json`、`backend-processes.json` 和 `isolated-runtime-resource-allocation.json`。`preflightRef` 必须是 backend probe schema、`status=ready`、Linux platform、匹配 backend kind、包含 required observed components、`noVncWebRoot` 和全 ok 的 `preflightChecks`；L1 只允许 backend probe 的 `diagnosticOnly=true` 作为依赖 readiness，仍拒绝 shape-only、`readinessOnly=true`、`executeFailClosed=true`、非 Linux、错 backend、缺组件、缺 noVNC root 或 failed checks。`backend-readiness-proof.json` 还必须证明 isolated `DISPLAY` 有 queryable X display geometry proof，VNC 是 localhost-only ready endpoint，noVNC 必须有 GET `/vnc.html` 的 localhost HTTP viewer proof，browser desktop window 和 page ready marker 必须在输入前可见，pointer click 必须由 window-bound target proof 证明，并直接读取初始/最终截图文件要求 sha256 内容不同，不能只靠 `screenChanged=true` 声明变化。`processRef` 必须使用 `sciforge.computer-use.backend-processes.v1` schema、匹配 `backendReadinessProofRef.processRef`、覆盖 virtual-display/window-manager/vnc-server/novnc-proxy/browser 角色、为每个进程提供存在的 stdout/stderr log refs、匹配 isolated display/sessionId，并且没有 shared/system side-effect flags；`resourceAllocationRef` 必须使用通用 `sciforge.computer-use.isolated-runtime-resource-allocation.v1` schema、证明本轮 isolated display 与 VNC/noVNC localhost 端口分配，端口在存在时要与 readiness proof 匹配，session refs 声明 sessionId 时也必须匹配，且不能携带 shared/system side-effect flags。每个 state-changing step 的 before/after screenshot ref 也必须有不同文件内容，避免只靠打开浏览器造成的初末差异冒充输入和按钮成功。每个 pointer/keyboard input event 都必须引用 executor command event，且 `commandEventLogRef` / `commandEventRef` 必须指向同一个 `executorCommandEventLogRef`；command 的 action index、modality、returncode、no shared/system side-effect flags 和 isolated `DISPLAY` 要与 workflow/session 匹配。Pointer event 还必须使用 window-local coordinate space，引用目标 window/proof refs，并与 executor command 中的 `xdotool mousemove --window <windowId>` 参数一致。缺少命令溯源、命令失败、DISPLAY 不匹配、缺少 runtime process/resource proof、缺少 window-bound pointer proof、裸全局 `mousemove x y click` 或用 shell/system input wrapper 冒充都会被拒绝。placeholder-only viewer、package-owned target-bound channel、readiness-only manifest、prior-round done、stale completion supports、缺失 refs、shape-only preflight、无效 readiness proof、相同截图内容或 inline screenshot payload 都会被拒绝。该 validator 目前是 legacy backend diagnostic gate 和 runner 合同，不等于 active native product gate；非 Linux 或缺依赖时仍应写 blocked/readiness manifest。

Legacy isolated desktop L3 multi-app workflow evidence 由 `build_isolated_desktop_l3_workflow_evidence` / `validate_isolated_desktop_l3_workflow_evidence` 单独校验。`isolated_desktop_l3_workflow_probe` 默认只写 readiness/blocked manifest；传入 `--execute` 且 Linux/noVNC/LibreOffice/browser、isolated input、截图工具和 file-preview 工具都 ready 时，会启动同一 isolated session 的 source browser -> LibreOffice Writer -> Chromium directory preview runner。Runner 写 `isolated-desktop-l3-runner-execution-boundary.json`，清理 run-owned session/profile/viewer 状态，用同一 X display/session、window-bound pointer proof、keyboard command provenance、LibreOffice GUI Save As、键盘选择 DOCX 类型、DOCX validator、file-list/gui.present、visible viewer 和 evidence ledger 产出 refs；只有 completed assembler 调用 `validate_isolated_desktop_l3_workflow_evidence(require_existing_refs=true)` 通过后，manifest 才能变成 `status=completed`、`diagnosticOnly=false`、`userAcceptanceEligible=true` 并写 `completionEvidenceRef`。失败路径仍 fail closed，blocked manifest 不能通过 completed L3 validator。Partial `executorCommandEventLogRef` 若在诊断路径存在，必须是 `eventCount=0` / `events=[]` 的 no-workflow-input 日志；file-preview 进程记录中的 `launcher-completed` 只说明目录预览 launcher 请求返回成功，不是 completed GUI workflow input。partial refs 只能放在 `partialRunRef` / `partialRuntimeRefs`，不能复制或提升为 completed L3 的 top-level `resultRef`、`traceRefs`、`inputEventLogRef`、`finalArtifactRef`、`artifactValidationRef`、`guiPresentRef` 或 `completionEvidenceRef`。Completed L3 runner 必须提供共享 isolated desktop runtime refs：`backendReadinessProofRef`、`executorCommandEventLogRef`、`targetWindowRef`、`windowBoundPointerProofRef`、`processRef`、`resourceAllocationRef`，其中 `processRef` 与 `resourceAllocationRef` 必须携带匹配 `sessionManifestRef` / `virtualDisplayRef` 的 sessionId 和 display。L3 `targetWindowRef` 使用通用 `sciforge.computer-use.isolated-target-window.v1` schema，不能用 L1 legacy target-window schema 代替。Manifest 的 `resourceAllocationSchemaRef` 指向通用 `sciforge.computer-use.isolated-runtime-resource-allocation.v1`，`legacyResourceAllocationSchemaRef` 仅为旧证据兼容接受 `sciforge.computer-use.l1-runtime-resource-allocation.v1`。这些 refs 可以作为历史 regression/historical evidence，但 active live acceptance matrix 以 native app-server/native plugin 调用、multi-screen/multi-actor provenance、BrowserRuntime observation refs/hints 和当前 bundle artifact/verifier/gui.present refs 为准。

L3 runner 的动作计划可先用 `build_isolated_desktop_l3_workflow_action_plan` / `validate_isolated_desktop_l3_workflow_action_plan` 固化。该 plan 只定义 source -> writer -> save -> preview -> validate 的 action index、app role、expected modality 和每步 screenshot/observation refs 要求；它不执行 GUI、不读取 shell artifact、不写 completed evidence，且保持 `diagnosticOnly=true`。

真实 runner 组装 completed L3 时应走 `assemble_isolated_desktop_l3_workflow_completion`。Assembler 会先用 completed L3 validator 和 `require_existing_refs=true` 校验候选 payload；只有通过时才写 `isolated-desktop-l3-workflow-evidence.json` 并返回 `completionEvidenceRef`。校验失败、shape-only refs 或把 `partialRunRef` / `partialRuntimeRefs` 复制到候选 completed payload 时，只会写 blocked assembly manifest，不会写 completion evidence。

Source fact payload 可以用 `build_source_fact_evidence_payload` / `validate_source_fact_evidence_payload` 生成和检查。它保留 `compatibleSourceFactSchemaVersion=sciforge.computer-use.source-fact.v1`，用于对齐 L3 validator 的 supported fact contract，同时只记录 source observation ref、source screenshot ref、fact text 和 derived content refs；payload 必须保持 diagnostic-only，不能携带 completion evidence、user acceptance、shell refs 或 raw payload refs。

Artifact / file-list / gui.present refs 可以先用 `build_l3_artifact_bundle_evidence` / `validate_l3_artifact_bundle_evidence` 组合成 diagnostic bundle。该 bundle 只检查 top-level `finalArtifactRef`、`artifactValidationRef`、`fileListArtifactRef`、`fileListDataRef`、`guiPresentRef` 及可选 preview/directory observation refs 的 refs-first 形状，并要求嵌套 `artifactCausality`、`directoryEvidence`、`presentationEvidence` 与 top-level refs 一致；它不读取文件、不执行 GUI/shell、不写 completed evidence。

```bash
python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe \
  --output-dir /tmp/sciforge-computer-use-l3-workflow

python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe \
  --output-dir /tmp/sciforge-computer-use-l3-workflow \
  --execute

python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe \
  --output-dir /tmp/sciforge-computer-use-l3-workflow \
  --execute \
  --display :99 \
  --vnc-port 5910 \
  --novnc-port 6090 \
  --timeout-seconds 45 \
  --resource-lock-root /tmp/sciforge-computer-use-l3-locks
```

**重要：下面 legacy L3 diagnostic payload 里的 `diagnosticOnly=false` / `userAcceptanceEligible=true` 只属于历史 isolated desktop L3 runner 合同，不是 active VirtualAppScreen Native Host `diagnosticOnly=false` pass。** 它可以作为 historical regression evidence 输入 matrix，但不能替代 real-driver opt-in 或 dogfood product evidence。

Legacy L3 diagnostic payload 必须使用 `acceptanceTier=l3-multi-app-workflow`、`backendKind=linux-novnc-libreoffice-browser`、`captureSource=isolated-virtual-display`、`inputChannel=remote-desktop-isolated-session`、真实 isolated desktop `targetEnvironmentKind`、`preflightStatus=ready`、`inputExecuted=true`、`realWindowEvidence=true`、`diagnosticOnly=false` 和 `userAcceptanceEligible=true`，并保持所有 OS/shared/system input、inline/raw payload 和 secrets flags 为 `false`。它还要求同一个 virtual session 内至少覆盖 source / writer / file-preview 三类应用，记录 current screenshot-backed cross-app transitions、每个 app 的 first/last screenshot refs 与 window evidence refs、source observation/fact refs、derived content 对 source facts 的引用、GUI 保存 causality、artifact validator refs、GUI 目录 file-list/preview causality、viewer/session/noVNC/evidence ledger/input event refs、`guiPresentRef`、共享 isolated desktop runtime proof refs 和当前 run 的 final artifact refs。`artifactCausality` 必须声明 `savedByActionIndex`、`savedByInputModality=keyboard`、`savedByCommandEventRef`、`finalArtifactRef`、`artifactValidationRef`、`savedThroughGui=true` 和 `shellDirectArtifactWrite=false`；`directoryEvidence` 必须声明 `previewedByActionIndex`、`previewedByInputModality=pointer`、`previewedThroughGui=true` 和 `shellDirectoryListingOnly=false`，避免 shell 直写 artifact 或 shell listing 冒充 GUI 工作流。Validator 默认要求 existing refs，并会读取 `preflightRef` payload，要求它是真实 Linux isolated desktop backend ready payload，包含 backend kind、Linux platform、observed backend components、noVNC web root，且不能带 diagnostic-only、readiness-only、user-acceptance-ineligible 或 fail-closed 标记。它还会读取 result/trace completed 状态、每步当前截图、viewer real frames、session ref schemas、`backendReadinessProofRef`、`executorCommandEventLogRef`、`targetWindowRef`、`windowBoundPointerProofRef`、`processRef`、`resourceAllocationRef`、pointer/keyboard logs、artifact validation、file-list/gui.present payload 和 current evidence ledger completion claim；session/noVNC/capture/replay refs 必须共享同一 session/display identity，`processRef` 与 `resourceAllocationRef` 也必须绑定同一 sessionId/display，noVNC 只能是 localhost，capture stream 必须包含 workflow screenshot refs。pointer/keyboard event logs 必须覆盖 workflow 中对应 modality 的每个 action index，且每个 input event 必须追到 successful isolated executor command event，command 的 action index、modality、returncode、isolated `DISPLAY` 和 side-effect flags 必须匹配；save command ref 必须匹配保存动作的 keyboard input event，directory preview action index 必须匹配 pointer input event。Pointer event 还必须使用 window-local coordinate space、引用 `targetWindowRef` / `windowBoundPointerProofRef` / `targetProofRef`、命中目标 bounds，并匹配 executor command 中的 `xdotool mousemove --window <windowId>` 参数；裸全局 pointer command 不能通过 L3。它还会读取截图文件 sha256，要求 source/writer/file-preview 视觉状态至少有三种不同截图内容，避免用同一帧复制成“多应用”证据。对于声明为 `supportedFactRefs` 的 source facts，validator 会加载 fact payload，要求 schema 和 fact text 有效，并要求 artifact validation 的 `textRuns` / normalized text 包含这些 fact，避免无关文档只靠文件名、hash 或结构计数通过。关闭 existing refs 不能得到 L3 ok。缺少这些 refs、使用 package-owned/diagnostic/fixture/mock/virtual/state-only target，复用旧 trace / prior-round completion，L3 preflight/session refs 偏 shape-only，L3 input logs 未覆盖对应 action indexes，缺少 GUI 保存/预览 causality，缺少 session-bound runtime/provenance/window-bound pointer proof，所有 L3 截图内容相同，或 final artifact 文本没有包含 supported source facts，均只能返回 blocked/diagnostic。历史 Docker L3 diagnostic 已用 `/tmp/sciforge-cu-isolated-l3` 产出真实 completed run，manifest 为 `status=completed`、`diagnosticOnly=false`、`userAcceptanceEligible=true`，容器内 validator 返回 `ok=True` / `errorCount=0`；`target-bound-cross-app-document-workflow.json` 仍只是 package-owned target-bound diagnostic，不能替代 native active acceptance matrix。

Isolated desktop evidence focused tests：

```bash
python -m pytest packages/actions/computer-use/tests/test_isolated_desktop_l1_smoke_probe.py -q
python -m pytest packages/actions/computer-use/tests/test_isolated_desktop_l1_smoke_evidence.py -q
python -m pytest packages/actions/computer-use/tests/test_isolated_desktop_l3_workflow_evidence.py -q
python -m pytest packages/actions/computer-use/tests/test_isolated_desktop_l3_workflow_probe.py -q
python -m pytest packages/actions/computer-use/tests/test_plugin_probe.py packages/actions/computer-use/tests/test_loop.py::test_public_api_manifest_and_camel_case_aliases_are_stable -q
```

可选 semantic verifier 可以用 package-local probe 验证 metadata 边界：

```bash
python -m sciforge_computer_use.semantic_verifier_probe \
  --output-dir /tmp/sciforge-computer-use-semantic-probe
```

该 legacy probe 从 ignored `config.computer-use.local.json` 读取 `visionLLM`，调用 OpenAI-compatible vision chat endpoint，并只写 `semantic-verifier-probe-manifest.json`、`semantic-verifier-summary.json` 和 `semantic-verifier-trace.json` 这类 refs-first 证据。API key、raw provider payload、inline image 和 base64 不写入 manifest/trace。Provider、网络、认证或配额失败时返回 `blocked` manifest，而不是声明 semantic helper 完成。它不代表当前 Computer Use 默认 provider；当前默认入口是 Model Router verifier translator capability。

Semantic verifier probe 会先跑 text-only preflight，再尝试有限的 multimodal variants：Chat Completions image URL object、Chat Completions image URL string 和 Responses `input_text` + `input_image`。Text preflight 对 timeout/network/HTTP 408/429/5xx 做 bounded retry；遇到 Chat text payload shape rejection 时会尝试 minimal text payload，若 Chat text 仍 shape-reject，则尝试 Responses text preflight 并在成功后只跑 Responses image variant；它不会把 400/415/422 的 image shape rejection 当作 transient retry。`response_compat.py` 提供 package-local Responses/Chat helpers：`responses_to_chat_completions` 生成标准 Chat text preflight，`chat_completions_to_responses` 生成 Responses image fallback，`extract_provider_text` 统一提取 Responses / Chat provider 文本。其语义来自 `packages/backend/src/response-compat.ts` 的最小非流式桥接：`output_text`、`output[].content[].text` / `output_text` 和 Chat Completions `choices[].message.content` 均可接受；image/data-url parts 只会保留 redacted placeholder/ref，不会被串成文本或写进 manifest。Provider endpoint resolver 接受 `baseUrl` 指向 API base、`/chat/completions`、`/responses` 或 `/models`，再统一派生 `/models`、`/chat/completions` 和 `/responses`；provider diagnostics 现在分别记录 `textChat` 和 `textResponses`，只保留 method、path、elapsedMs、retryable、errorCategory、diagnostic timeout 和安全 body 摘要。`/models` 诊断可以记录 `bodyKind`、`bytesRead`、`bodyTruncated`、`modelCount` 和 `configuredModelPresent`，但不记录 raw model ids、request body、query secret、Authorization、data URL 或 raw payload。Probe 只从 `visionLLM` 或 `computerUse.visionLLM` 读取 legacy verifier config，避免把 text LLM config 误当成视觉 provider；manifest 可以记录 provider `responseModelId` 和模型匹配状态，但这些字段只是 legacy diagnostics。Provider 必须返回可解析的 JSON verdict，且 `verdict=pass` 才能让 probe completed；`fail`、`unknown` 或非 JSON 内容都会写 blocked manifest。Package tests 还用本地 fake HTTP provider 走真实 `_http_json_post()` wire path，覆盖 Chat text shape rejection -> Responses text/image success，以及 text preflight -> Chat image shape failure -> Responses image success；这只是协议/诊断证据，不能替代真实 Model Router verifier translator live acceptance。

如果标准 HTTP client 路径出现明确 transport/protocol incompatibility，而同一 base URL、auth、endpoint resolver 和 sanitized payload candidate 仍应继续诊断，transport fallback 使用 package-local raw HTTP/1.1 non-streaming POST。该 fallback 必须只复用同一 Chat/Responses candidate 和 refs-first summary contract；manifest/trace 仍只能记录 endpoint kind、payload kind、status、retry count、elapsedMs、error category、model eligibility 摘要和安全 body 摘要，不写 Authorization、API key、raw request/response body、provider raw payload、data URL 或 inline image。

稳定 request/result schema 是：

- `ComputerUseRequest.schema_version = sciforge.computer-use.request.v1`
- `ComputerUseRequest.approval_ref` 绑定上游确认；仅设置 `risk_policy=allow-confirmed` 不足以执行高风险动作。
- `ComputerUseRequest.providers` 记录 TUI Host 注入的 sense、grounder、executor 和 verifier provider id。
- `ComputerUseRequest.metadata.requiresFinalArtifact=true`、`metadata.finalArtifactRequired=true`、`metadata.artifactPolicy.requiresFinalArtifact=true` 或 `metadata.acceptance.requiresFinalArtifact=true` 会启用 final artifact evidence guard；此时 completed result 必须从 final observation、visible artifact record 或 verifier metadata 中取得 `finalArtifactRef` / `finalArtifactRefs`，planner/action metadata 不能单独满足完成证据。
- `ComputerUseRequest.metadata.requiresDirectoryEvidence=true`、`metadata.fileListEvidenceRequired=true`、`metadata.acceptance.requiresFileListEvidence=true` 或 `metadata.artifactPolicy.requiresDirectoryEvidence=true` 会启用目录/file-list evidence guard；此时 completed result 还必须有当前 final observation screenshot ref，并从 final observation 或 verifier metadata 中取得非控制文件的 file-list artifact ref 和 data ref。Planner/action metadata 不能满足该目录证据。
- `ComputerUseResult.schema_version = sciforge.computer-use.result.v1`
- `ComputerUseResult.final_artifact_refs` 记录当前 run bundle 中由最终观察、verifier metadata 或 visible artifact record 证明的最终产物 refs；JSON/trace/CLI 输出同时提供 `finalArtifactRef` 和 `finalArtifactRefs`。`vision-trace.json`、`tool-payload.json`、`gui-present.json` 等控制/证据文件只能作为 trace/evidence refs，不能被提升为最终产物。
- `Verification.metadata.semanticVerifier` / legacy `vlmVerifier` / 同义视觉 verifier block 会被规范化成 refs-first `semanticVerifier` 摘要，只保留 provider/model/verdict/confidence/reason/evidence refs 等紧凑字段；raw payload、inline image 和 base64 会被丢弃或 fail closed，semantic metadata 不拥有执行、坐标或 completion 决策权。`fakeProvider` 或 `diagnosticOnly` semantic summary 只能证明 wire path / metadata plumbing，不能替代真实 verifier verdict、当前视觉证据或 artifact-producing success。
- `ComputerUseResult.approval_request` 是 refs-first confirmation intent；它不是 GUI 调用。

Planner contract 是一轮只输出一个 generic action 或 `done=true`。Planner 输出坐标、app-private shortcut、unsupported action 或空 action 时，package 直接返回 structured failure；坐标必须来自 Grounder。`done=true` 必须由当前观察、focus-region 证据、verifier feedback 或 artifact refs 支撑；artifact-producing task 还必须有当前轮视觉/文件证据证明 bundle-local `final-artifact-ref` 指向真实产物，而不能复用 prior-round ledger、旧截图或旧 trace 摘要。当文本推理不确定、ledger 与当前画面不一致，或只能从历史 action ledger 猜测结果时，planner 必须请求重复观察、聚焦 crop 或扩大/重选区域，不能把 ledger 当作成功证明。

## Model Router Vision / Grounding、输入与 trace

Computer Use 的截图理解、before/after 比较、候选目标消歧、语义 verifier 和需要模型参与的 grounding 默认统一使用 Model Router capability surface。Grounder provider 不是 planner 或 executor；它只把当前 screenshot/crop ref 加 target description 转成可审计坐标、confidence/text observation 和 diagnostics。具体上游 provider/model 由 router profile 解析，不作为 action provider 的默认值或公共契约。

历史 `KV-Ground` provider、endpoint 和环境变量只作为兼容调试路径保留，不代表默认模型。如果 host adapter 仍沿用这条路径，trace/evidence 必须明确记录它是 compatibility provider，并且不得把旧服务名写成默认 grounding 模型。

兼容路径默认也应优先使用 file-ref / shared path refs。只有明确启用 legacy adapter 且共享路径不可用时，才允许短期 inline image upload：

```bash
export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="file-ref"
```

只有 legacy adapter 调试场景才允许将 `SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY=inline` 作为临时 fallback；该 request payload 不得进入 trace、聊天正文或主上下文。Computer Use trace 可以记录截图 ref、focus crop ref、sha256、尺寸、target description、window/crop-local coordinates、router trace refs、provider metadata、executor lease、verifier verdict、approval/audit refs 和 diagnostics，但不得保存 raw screenshot payload、`data:image`、base64 或大日志。

真实桌面输入优先使用独立 input adapter。当前 `remote-desktop` 只有在 Host 注册 `sciforge-simulated-remote-desktop` provider 时才可执行；该路径维护虚拟 pointer/keyboard state refs，不移动系统鼠标、不发送全局系统键盘事件。未注册 provider 的 `remote-desktop` / `virtual-hid` 会 fail closed。没有独立 adapter 时，鼠标键盘属于 shared system input，必须绑定低风险目标窗口、串行持有 executor lease，并在 request/result 中显式记录 acknowledgement 或 blocked reason。该路径仅是显式确认后的诊断/迁移路径，不能让 desktop preflight ready，也不能满足 PROJECT B/C、L2/L3 或最终输入隔离证据。

## 验收边界

当前 package contract、runtime package bridge 与 CU-NEXT validation/readiness smoke gate 已经存在，但默认闭环仍主要验证 package-local API/CLI/host-port/fixture/probe 和 refs-first bridge evidence；它们不等同于 browser acceptance、release gate 或真实 CU-NEXT task completion。下面的 L2/L3 描述是用户级集成验收边界，不是 package-only diagnostic 自身的完成条件。

真实输入 smoke 只证明基础链路可用，不等于用户级成功。Computer Use 的最终验收至少需要一个可见用户产物，例如用可用的 slide app 制作并保存一页 PPT；目标打通需要一个多 App 工作流，例如 Browser/资料页 -> slide app -> Finder/保存对话框 -> TUI Host `gui.present` 展示 artifact refs 和 trace refs。

递进测试可以先做 single-window / single-app probes，用来验证 capture、grounding、executor、verifier、`done=true` 判断和证据打包；这些 probe 即使能产生一个文件，也只能算 L2 前置或诊断证据，不能冒充 CU-NEXT L3 多 App 工作流。Artifact-producing acceptance 必须同时满足：产物 ref 是当前 run bundle 内的 `final-artifact-ref`，result/trace/`ToolPayload` 明确暴露 `finalArtifactRef`，最终截图能看到产物或保存位置，verifier verdict 明确覆盖产物存在/可见性，按 request metadata 要求提供当前目录 file-list artifact/data refs，TUI Host 已用 `gui.present` 展示该 ref 和 trace 摘要。缺任一项时返回 `blocked` / `repair-needed` 或 diagnostic manifest，不得返回用户级完成。

L3 isolated multi-app workflow 的 evidence contract 现在只作为 legacy backend diagnostic / historical evidence 的最低门槛；contract/validator 通过单元形状不等于 active product gate 已完成。旧 Linux/noVNC backend 在同一 session 内完成 source -> writer -> file preview 工作流，并产出当前截图、输入日志、window-bound pointer proof、artifact/file-list validator、viewer、ledger 和 `gui.present` refs 后，可以作为历史回归证据输入 acceptance matrix；它不能替代 native app-server/native plugin 调用、VirtualAppScreen app/window/session refs、adapter readiness 或 BrowserRuntime DOM/AX observation refs。Package-owned target-bound cross-app fixture 继续只证明 package harness 的跨应用形状诊断。

CU-NEXT live acceptance 还要求任务级语义 marker。`tools/computer-use-next/live-acceptance-validator.ts` 校验 exact `taskId`、映射内 `scenarioId`、TUI Host/action provider/`gui.present` refs、screenshots、focus crops、grounding diagnostics、executor lease、final artifact、verifier refs、independent input session refs，以及每个任务的 top-level `evidenceMarkers`：briefing deck / chart report / needs-confirmation / file index / repair continuity / approvalRef / dense grounding。Marker refs 必须是 evidence-bundle-local file refs 或允许的 `approval:` token，任意 nested object 或 task text 里的 marker 词不算证据。`tools/cu-next-run.ts validate-run` 会在 CU-LONG manifest、scenario-summary 和任务映射通过后运行同一 gate，拒绝缺 marker、task/scenario 不匹配、缺 completion-grade metadata 或伪 live evidence。新的 live acceptance matrix 应覆盖 VirtualAppScreen attach、adapter readiness、input intent、background app/window frame、annotation/proposal refs、BrowserRuntime DOM/AX observation refs/hints、research workflow、高风险 confirmation stop 和 repair/continuation。Readiness strong evidence 可以引用 historical isolated-L3 或 M6 evidence 作为回归输入，但 active gate 不能只由 Docker/noVNC/RDP/M6 evidence 关闭；acceptance-shaped target-bound 或 package-local evidence 仍会 blocked。`CU-NEXT-03` 必须用 top-level `status=needs-confirmation` 表示正确停在外部发送前，且该状态是成功的 high-risk stop projection，不应被写成 diagnostic failure；`CU-NEXT-06` 必须在恢复路径提供非空 canonical `approvalRef`。High-risk marker 和 sidecar 的 `deniedExecuted=false` 表示被拒绝/待确认的风险动作没有执行。这个 gate 只验收真实 run evidence，不运行任务，也不把 fixture、target-bound 或 package-local 证据提升成完成。

验收不得绕过真实 Computer Use 链路：Playwright、DOM、accessibility tree、app-specific API 可以作为声明过的 adapter source，但必须经过 observe/ground/propose/lease/execute/verify、before/after evidence 和 validator；直接文件生成或未登记 shortcut 不能替代应用操作。若目标 App、系统权限、background rendering 或 shared input policy 不满足，返回 `blocked` manifest。

## Python Provider

本包定义稳定 Python contract：

- `ComputerUseRequest`
- `Observation`
- `ActionPlan`
- `ActionTarget`
- `Grounding`
- `ExecutionOutcome`
- `Verification`
- `LoopStep`
- `ComputerUseResult`

最小 loop：

```text
observe -> planner -> safety -> locate -> execute -> verify -> trace
```

`max_steps` 统计可执行动作。可执行动作用尽后，loop 允许一次 final no-execute completion check：再 `observe` 一次，把最终观察、trace/ledger、verifier feedback 和 artifact refs 交给 planner 做 completion-only 判断；该阶段不得调用 safety、grounder 或 executor。只有 planner 明确返回 `done=true` 时，package 才能追加 planning-only done step 并返回 `completed`；否则继续返回正常 `max-steps` failure。

高风险动作默认 fail closed：发送、删除、支付、授权、发布、外部提交、覆盖、上传等动作必须由上游显式确认，或进入 human approval / verifier policy。Trace 不内联截图 payload、base64 或大日志，只写 refs、ledger、diagnostics 和紧凑摘要。

## Manifest

Provider manifest 位于：

```text
packages/actions/computer-use/action-provider.manifest.json
```

该 manifest 声明 action schema、environment targets、safety gates、confirmation rules、trace contract、verifier contract 和 failure modes。

## 测试

本 README 中新增的 package-local contract 可用 targeted tests 验证：

```bash
python -m pytest \
  packages/actions/computer-use/tests/test_virtual_desktop_session.py \
  packages/actions/computer-use/tests/test_visible_run.py \
  packages/actions/computer-use/tests/test_desktop_preflight.py \
  packages/actions/computer-use/tests/test_target_bound_real_window_evidence.py \
  packages/actions/computer-use/tests/test_isolated_desktop_l1_smoke_evidence.py \
  -q
```

完整 `packages/actions/computer-use/tests` 仍是包级回归入口，但不能把未收口的 runtime/loop worktree 状态当成真实 app acceptance。
