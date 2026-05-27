# Computer Use Action Provider

本目录是 Computer Use 的唯一 action provider 真相源，包含 provider manifest、Python action loop、contract、safety gate、trace helper 和 pytest。

Python 包名继续是 `sciforge_computer_use`，方便旧代码和人类开发者保持稳定 import；物理目录已收敛到 `packages/actions/computer-use`。

## 边界

- Computer Use 是 action provider，不是 sense。
- Computer Use 是 TUI-owned extension，只直接和 TUI Host 通信；GUI 参与展示或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`。
- 它可以消费 `packages/observe/vision` 的 observation、OCR、focus region、KV-Ground/visual grounding 和 verifier feedback。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径；`vision-sense` 不拥有 executor、scheduler、desktop bridge 或完成判断。
- 它只执行通用 GUI action schema，并输出可验证 trace。
- `src/runtime` 是后续 SciForge Host adapter 集成层：`GatewayRequest` 转换、host ports、`ToolPayload` 包装、runtime event 接入，以及尚未迁出的 macOS 截图/输入/文件 IO host implementation。当前 package-only 闭环不修改、不验证 `src/runtime`；迁移项只作为后续登记背景。
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
buildTargetBoundInputAdapterManifest(...)
validateInputAdapterManifestForRealDesktop(adapterManifestOrLocalPath)
```

`hostPorts` 是模块和平台能力的唯一接触面，负责截图、裁剪、桌面/远程/dry-run 执行、trace 写入和事件上报。高风险动作不在模块内部弹 UI；模块返回 `needs-confirmation`、`approvalRequest`、trace refs 或 audit refs，由 TUI Host 决定是否调用 `gui.ask_user`，确认后再发起新的受控调用。

稳定 host-port 命名来自 `provider-policy.ts`：`display-capture` / `target-window-capture`、`runtime-codex-tui-text-planner`、`kv-ground` / `host-focus-region-crop`、`<desktopPlatform>-host-port-executor`、`<desktopPlatform>-generic-gui-executor`、`layered-vision-verifier`、`workspace-file-ref-trace-writer` 和 `workspace-runtime-events`。Trace handoff 目标固定为 `computer-use.trace-summary` 与 `computer-use.approval-request`，payload 只允许 refs 和 compact summary。

迁移期的边界规则是：package 拥有 contract、loop、safety gate、trace handoff 名称和通用策略；`src/runtime` 只能作为后续 host-port implementation 迁移来源，例如 macOS `screencapture`、Swift/AppleScript/shared-input executor、workspace 文件写入和 runtime event transport。当前执行面不要进入 runtime adapter；新增 Computer Use 通用策略必须进入 package 或 observe provider。

后续 runtime 集成里的 Codex text planner 可通过 `runtime-codex-tui-text-planner` 使用 Codex CLI/TUI。若进入该阶段，只有明确的 transport/protocol failure（502/gateway/upstream/proxy/network/timeout 等）才允许 OpenAI-compatible direct chat fallback；fallback 应复用 `packages/backend` 的 Responses <-> Chat Completions 转换，保持同一 generic action JSON schema 和 diagnostics，不绕过 DOM/accessibility/tool 禁令。当前 package-only 闭环不调试 runtime planner fallback。

进程边界下，TUI Host 可以通过 JSON CLI 调用同一个 package loop：

```bash
python -m sciforge_computer_use --request-json '{"task":"click visible search box"}' --host-port-stdio
```

`--host-port-stdio` 使用 JSONL 协议：package 在 stdout 发出 `hostPortCall`，Host 在 stdin 返回 `hostPortResult`，最终输出 `finalResult`。这让 `run_task(request, hostPorts)` 仍然拥有 action loop，同时截图、planner、grounder、executor、verifier、trace writer 和 runtime event 仍由 TUI Host 注入。fixture 模式只用于 package tests 和 dry-run diagnostics，不能作为真实 Computer Use 成功证据。

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

该 probe 解析 `action-provider.manifest.json`，核对 `run_task` / `runTask` / `getManifest` 以及 repair、viewport、target-bound real-window evidence、target-bound adapter 等公开 API symbol，解析 manifest 中声明的 package-local builder/validator/response-compat dotted paths，检查 entrypoint path/module/CLI 是否 package-local，并可选用 stdin request + fixture JSON 调一次 `python -m sciforge_computer_use`。输出 `plugin-probe-manifest.json` 和 `plugin-probe-cli-result.json`；manifest 只写 refs/summary，不内联完整 action manifest 或 raw CLI stdout，也不触碰 SciForge runtime / GUI。

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

Repository fixtures 包括 `fixtures/virtual-desktop-six-step.json` 和 `fixtures/virtual-desktop-ambiguous-before-after.json`。该 probe 产出 `virtual-desktop-probe-manifest.json`、`computer-use-result.json`、`vision-trace.json`、screenshot refs、artifact refs、final artifact refs、file-list refs 和 virtual input state refs；定位失败时还会写 `blocked-repair-manifest.json`，其中包含 `failedStage`、`locateFailures`、`viewportFailures`、trace/screenshot refs、scenario ambiguity 和 virtual input isolation 状态，方便抽出最小 disambiguation 或 viewport recovery probe 后重跑。即使 scenario 返回 `completed`，它仍是 state-only simulated input、`realWindowEvidence=false` 的诊断证据，不是真实桌面输入或真实窗口完成证据，不能完成 PROJECT 的 B/C/VLM。

Package-owned target-bound window host-port probe 也走同一个真实 child stdio loop，但 parent host 拥有一个声明式目标窗口和 isolated executor。该 executor 只接受 generic actions（click / focus / type_text / press_key / hotkey / scroll / wait），只改变这个 package-owned target environment，并写出 adapter manifest、target-window ref、binding proof、ready desktop preflight、result/trace refs 和 target-bound real-window evidence：

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

更多复杂任务 fixture 保持同一 generic host/executor contract：`target-bound-csv-table-edit.json` 覆盖 CSV/表格编辑，`target-bound-form-dialog.json` 覆盖表单填写与 Tab 导航，`target-bound-form-high-risk-submit.json` 覆盖高风险外发提交 fail closed，`target-bound-menu-hotkey.json` 覆盖鼠标菜单 + 键盘保存，`target-bound-preview-directory.json` 覆盖保存后预览和目录 file-list refs。Package tests 还覆盖两个不需要单独 fixture 文件的衍生场景：安全表单步骤完成后，高风险确认弹窗按钮仍返回 `needs-confirmation`；保存位置需要连续多次 scroll 后才可见时，viewport recovery evidence 仍保留 scroll action、delta、state refs 和最终选中元素。

该 probe 是 package-owned target-bound host，不是 SciForge runtime、GUI、browser acceptance、CU-NEXT 或 shared system input。成功 run 会写 `target-bound-window-host-probe-manifest.json`、`desktop-host-port-preflight-manifest.json`、`target-bound-input-adapter-manifest.json`、`input-adapter-target-binding.json`、`target-window.json`、`target-binding-proof.json`、`computer-use-result.json`、`vision-trace.json` 和 `target-bound-real-window-probe-evidence.json`。证据必须满足 `preflightStatus=ready`、`targetBindingValidation(requireExistingRefs=true)`、distinct initial/final screenshot refs、`inputExecuted=true`、`executeFailClosed=false`、`realWindowEvidence=true`、`diagnosticOnly=false`，并且 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。Host 会在 manifest/result `failureDiagnostics`、execution metadata 和 target-bound evidence 的 `realWindowEvidenceRefs` 中写独立 `targetPointerStateRef` / `pointerEventLogRef`、`targetKeyboardStateRef` / `keyboardEventLogRef`、`targetInputEventLogRef` / `inputEventLogRef`。当 scenario 的 `workflowRequirements.requiredInputModalities=["pointer","keyboard"]` 时，validator 会同时读取 result/trace steps 和这些 event log refs，要求 modality-specific event log 非空，并要求 event `actionIndex` 覆盖对应 pointer / keyboard step。Declared artifact output 由 `artifactSpec.kind` 或 `finalArtifactRef` 扩展名选择 renderer；`text` / `markdown` / `csv` 写文本类文件，`.pptx` / `slide-deck` 会写一页 OOXML deck，并同时写 `artifactValidationRef` / `pptxValidationRef`，记录 zip/XML/slideCount/hash/size 校验。产物 evidence 还必须能追到 `artifactMetadata.savedByActionIndex` 和 `savedByInputModality`：PPTX 或文件不能只因为 renderer 生成了文件就被声明完成，保存动作必须是 generic `save` 或 `Ctrl/Cmd+S` 一类键盘动作，且有对应 keyboard event。Planner contract 允许标准本地文档保存热键，但继续拒绝显式 app-private 或未知快捷键。带 `--source-repair-manifest` 重跑时，它也会把 ambiguous repair replay 或 viewport/offscreen recovery evidence 提升为 real-window evidence，但仍只在 package-owned target-bound window 范围内声明成功。

Blocked repair manifest 本身由 package-local `sciforge_computer_use/repair_manifest.py` 的 `validate_repair_manifest` / `validateRepairManifest` 校验。该 validator 要求 package-local blocked manifests 保留显式 negative side-effect flags（如 `inputExecuted=false`、`sharedSystemInputUsed=false`、`realWindowEvidence=false`、`rawPayloadWritten=false`、`inlineImageWritten=false`，并保持 `diagnosticOnly=true`），拒绝 inline/base64 payload evidence，并可用 `require_existing_refs=True` 检查 result、trace、screenshot、observation、artifact 和 probe refs 指向本地文件。它只提升 Task C 的审计性，不把 package-local repair evidence 标成 C 完成。

修复重跑时可把前一次失败的 `blocked-repair-manifest.json` 作为 `--source-repair-manifest` 传入；probe 会额外写 `repair-replay-evidence.json`。该 evidence 由 `build_repair_replay_evidence` 构造，并由 `validate_repair_replay_evidence` 校验：源失败必须是 ambiguous multi-match，重跑必须显式收敛到 `afterMatchCount=1`，`selectedElementId` 必须来自原失败候选集，并且必须保留 `sourceFailureManifestRef`、`replayResultRef` 和 `replayTraceRefs`。传入 `require_existing_refs=True` 时，validator 还要求这些关键 refs 指向现有本地文件。当 evidence 标记 `diagnosticOnly=true` 或 `realWindowEvidence=false` 时，它只证明 package-local repair replay 逻辑，不完成 PROJECT C，也不影响 B/VLM 状态。

Viewport/offscreen 修复重跑会写 `viewport-recovery-evidence.json`。该 evidence 由 `build_viewport_recovery_evidence` / `buildViewportRecoveryEvidence` 构造，并由 `validate_viewport_recovery_evidence` / `validateViewportRecoveryEvidence` 校验：源失败必须是当前 viewport 零可见匹配且存在 offscreen candidates，重跑必须包含 scroll recovery action、非零 scroll delta、scroll 前后 virtual input state refs、replay trace refs，并最终唯一选中一个原 offscreen candidate。传入 `require_existing_refs=True` 时，validator 还要求 source failure、replay result、replay trace 和 scroll state refs 指向现有本地文件。若声明 `realWindowEvidence=true`，validator 还要求显式 `realWindowEvidenceRefs` 和成功的 `targetBindingValidation`；`realWindowEvidence=false` 时它仍只是 package-local scroll recovery diagnostic，不完成 PROJECT C。

真实窗口 host ports 在声明成功前必须先通过 desktop preflight：

```bash
python -m sciforge_computer_use.desktop_preflight \
  --output-dir /tmp/sciforge-computer-use-desktop-preflight
```

该 preflight 不截图、不执行输入，只写出 `desktop-host-port-preflight-manifest.json`。默认没有本机 host capability 时返回 `blocked`，并记录 loop required host ports (`capture/plan/locate/execute/verify`)、evidence required host ports (`writeTrace/emitEvent`)、observed capabilities、input isolation 风险、PROJECT.md 约束和下一步建议。只有 host 明确提供所有真实桌面证据端口、capture/executor、target window，声明 `independent-simulated-input-adapter` 的 manifest 或 manifest ref，并额外提供 `sciforge.computer-use.input-adapter-target-binding.v1` target binding manifest/ref 证明 adapter 会改变可验证目标环境时，manifest 才能返回 `ready`。这个 host 可以是本机 native host ports，也可以是 package-owned target-bound window host；两者都必须保留同一 generic host-port contract、refs-first evidence、target-bound isolated input，并且不得读取 GUI private state。Target binding manifest 可由 `build_input_adapter_target_binding_manifest` 生成，并由 `validate_input_adapter_target_binding_manifest` 校验；desktop preflight 会启用本地 ref 存在性检查。校验通过要求 `bindingStatus=bound`、`targetEnvironmentKind` 非空且非 virtual/diagnostic、`targetWindowResolved=true`、`executeChangesTargetEnvironment=true`、`realWindowEvidenceCapable=true`，保留存在的 `adapterManifestRef`、`targetWindowRef` 和至少一个 `evidenceRefs`，且 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。此外，preflight 会拒绝 diagnostic/fail-closed executor（例如 `native-stdio-fail-closed-executor`）和 shared/global/real OS input channel；ready 只允许 target-bound isolated input channel，例如 `isolated-window`、`target-bound-simulated-input`、`independent-simulated-input-adapter` 或 `remote-desktop-isolated-session`。Preflight ready 只是进入实际 run 的必要条件；只有实际 target-bound run 产生 initial/final screenshot refs、trace/result refs、target binding validation、`inputExecuted=true` 和文件/目录证据后，才能从诊断 contract 提升为 package-level real-window evidence。单独的 state-only virtual adapter manifest 不能让真实桌面 preflight ready。Shared system input 只能作为显式确认后的诊断路径，不能作为最终输入隔离成功证据。

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

Target-bound real-window probe evidence 由 `build_target_bound_real_window_probe_evidence` / `validate_target_bound_real_window_probe_evidence` 校验。它区分“证据形状 validator”和“实际 package target-bound run”：validator 只检查 refs-first payload，actual run 必须由 `target_bound_window_host_probe` 或未来 native target-bound executor 产生这些 refs。Evidence 要求 `preflightStatus=ready`、`inputExecuted=true`、`executeFailClosed=false`、`realWindowEvidence=true`、`diagnosticOnly=false`、target-bound input channel、distinct initial/final screenshot refs、trace/result refs、`finalArtifactRef` 和完整 `targetBindingValidation(requireExistingRefs=true)`。它也要求 `osInputExecuted=false`、`realOsInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`，并拒绝 inline screenshot/base64/data URL。Task B 和鼠标/键盘复杂任务可额外启用 `workflowRequirements`：`minimumActionCount=6`、`requiredInputModalities=["pointer","keyboard"]`、`requiresCurrentStepScreenshots=true`、`forbidPriorRoundCompletionEvidence=true` 和 `requiresDirectoryEvidence=true`；启用后 validator 会读取 `resultRef` / `traceRefs`，确认结果和 trace 已 completed、每步有当前 screenshot/observation ref、最终 visual + artifact refs + file-list refs 可见、鼠标/键盘 modality 都出现，并拒绝 prior-round ledger / historical done 标记。

可选 semantic/VLM verifier 可以用 package-local probe 验证 metadata 边界：

```bash
python -m sciforge_computer_use.semantic_verifier_probe \
  --output-dir /tmp/sciforge-computer-use-semantic-probe
```

该 probe 从 ignored `config.computer-use.local.json` 读取 `visionLLM`，调用 OpenAI-compatible vision chat endpoint，并只写 `semantic-verifier-probe-manifest.json`、`semantic-verifier-summary.json` 和 `semantic-verifier-trace.json` 这类 refs-first 证据。API key、raw provider payload、inline image 和 base64 不写入 manifest/trace。Provider、网络、认证或配额失败时返回 `blocked` manifest，而不是声明 VLM helper 完成。

Semantic verifier probe 会先跑 text-only preflight，再尝试有限的 multimodal variants：Chat Completions image URL object、Chat Completions image URL string 和 Responses `input_text` + `input_image`。Text preflight 对 timeout/network/HTTP 408/429/5xx 做 bounded retry；遇到 Chat text payload shape rejection 时会尝试 minimal text payload，若 Chat text 仍 shape-reject，则尝试 Responses text preflight 并在成功后只跑 Responses image variant；它不会把 400/415/422 的 image shape rejection 当作 transient retry。`response_compat.py` 提供 package-local Responses/Chat helpers：`responses_to_chat_completions` 生成标准 Chat text preflight，`chat_completions_to_responses` 生成 Responses image fallback，`extract_provider_text` 统一提取 Responses / Chat provider 文本。其语义来自 `packages/backend/src/response-compat.ts` 的最小非流式桥接：`output_text`、`output[].content[].text` / `output_text` 和 Chat Completions `choices[].message.content` 均可接受；image/data-url parts 只会保留 redacted placeholder/ref，不会被串成文本或写进 manifest。Provider endpoint resolver 接受 `baseUrl` 指向 API base、`/chat/completions`、`/responses` 或 `/models`，再统一派生 `/models`、`/chat/completions` 和 `/responses`；provider diagnostics 现在分别记录 `textChat` 和 `textResponses`，只保留 method、path、elapsedMs、retryable、errorCategory、diagnostic timeout 和安全 body 摘要。`/models` 诊断可以记录 `bodyKind`、`bytesRead`、`bodyTruncated`、`modelCount` 和 `configuredModelPresent`，但不记录 raw model ids、request body、query secret、Authorization、data URL 或 raw payload。Probe 只从 `visionLLM` 或 `computerUse.visionLLM` 读取 VLM config，避免把 text LLM config 误当成视觉模型；manifest 会记录项目 VLM evidence model expectation、provider `responseModelId`、模型匹配状态和 `projectVlmEvidenceEligible`。Provider 必须返回可解析的 JSON verdict，且 `verdict=pass` 才能让 probe completed；即使 wire path completed，也只有 configured model 符合代码实际支持的项目 evidence model check、response model 未冲突、且 `/models` 或等价 diagnostics 证明 `configuredModelPresent=true` 时，才可作为 PROJECT VLM eligible evidence candidate。当前 allowlist 可接受 `qwen3.6-plus`、`qwen3.6-plus-2026-04-02` 或 `kimi-k2.6`。`fail`、`unknown` 或非 JSON 内容都会写 blocked manifest。Package tests 还用本地 fake HTTP provider 走真实 `_http_json_post()` wire path，覆盖 Chat text shape rejection -> Responses text/image success，以及 text preflight -> Chat image shape failure -> Responses image success；这只是协议/诊断证据，不能替代真实 eligible VLM 完成证据。

如果标准 HTTP client 路径出现明确 transport/protocol incompatibility，而同一 base URL、auth、endpoint resolver 和 sanitized payload candidate 仍应继续诊断，transport fallback 使用 package-local raw HTTP/1.1 non-streaming POST。该 fallback 必须只复用同一 Chat/Responses candidate 和 refs-first summary contract；manifest/trace 仍只能记录 endpoint kind、payload kind、status、retry count、elapsedMs、error category、model eligibility 摘要和安全 body 摘要，不写 Authorization、API key、raw request/response body、provider raw payload、data URL 或 inline image。

稳定 request/result schema 是：

- `ComputerUseRequest.schema_version = sciforge.computer-use.request.v1`
- `ComputerUseRequest.approval_ref` 绑定上游确认；仅设置 `risk_policy=allow-confirmed` 不足以执行高风险动作。
- `ComputerUseRequest.providers` 记录 TUI Host 注入的 sense、grounder、executor 和 verifier provider id。
- `ComputerUseRequest.metadata.requiresFinalArtifact=true`、`metadata.finalArtifactRequired=true`、`metadata.artifactPolicy.requiresFinalArtifact=true` 或 `metadata.acceptance.requiresFinalArtifact=true` 会启用 final artifact evidence guard；此时 completed result 必须从 final observation、visible artifact record 或 verifier metadata 中取得 `finalArtifactRef` / `finalArtifactRefs`，planner/action metadata 不能单独满足完成证据。
- `ComputerUseRequest.metadata.requiresDirectoryEvidence=true`、`metadata.fileListEvidenceRequired=true`、`metadata.acceptance.requiresFileListEvidence=true` 或 `metadata.artifactPolicy.requiresDirectoryEvidence=true` 会启用目录/file-list evidence guard；此时 completed result 还必须有当前 final observation screenshot ref，并从 final observation 或 verifier metadata 中取得非控制文件的 file-list artifact ref 和 data ref。Planner/action metadata 不能满足该目录证据。
- `ComputerUseResult.schema_version = sciforge.computer-use.result.v1`
- `ComputerUseResult.final_artifact_refs` 记录当前 run bundle 中由最终观察、verifier metadata 或 visible artifact record 证明的最终产物 refs；JSON/trace/CLI 输出同时提供 `finalArtifactRef` 和 `finalArtifactRefs`。`vision-trace.json`、`tool-payload.json`、`gui-present.json` 等控制/证据文件只能作为 trace/evidence refs，不能被提升为最终产物。
- `Verification.metadata.semanticVerifier` / `vlmVerifier` / 同义视觉 verifier block 会被规范化成 refs-first `semanticVerifier` 摘要，只保留 provider/model/verdict/confidence/reason/evidence refs 等紧凑字段；raw payload、inline image 和 base64 会被丢弃或 fail closed，VLM metadata 不拥有执行、坐标或 completion 决策权。`fakeProvider` 或 `diagnosticOnly` semantic summary 只能证明 wire path / metadata plumbing，不能替代真实 verifier verdict、当前视觉证据或 artifact-producing success。
- `ComputerUseResult.approval_request` 是 refs-first confirmation intent；它不是 GUI 调用。

Planner contract 是一轮只输出一个 generic action 或 `done=true`。Planner 输出坐标、app-private shortcut、unsupported action 或空 action 时，package 直接返回 structured failure；坐标必须来自 Grounder。`done=true` 必须由当前观察、focus-region 证据、verifier feedback 或 artifact refs 支撑；artifact-producing task 还必须有当前轮视觉/文件证据证明 bundle-local `final-artifact-ref` 指向真实产物，而不能复用 prior-round ledger、旧截图或旧 trace 摘要。当文本推理不确定、ledger 与当前画面不一致，或只能从历史 action ledger 猜测结果时，planner 必须请求重复观察、聚焦 crop 或扩大/重选区域，不能把 ledger 当作成功证明。

## KV-Ground、输入与 trace

KV-Ground 是 Grounder provider，不是 planner 或 executor。默认本地 endpoint 是 `http://127.0.0.1:18081`；TUI Host 或 host adapter 应在运行前记录实际 endpoint，并保存 `/health` 和至少一次 `/predict/` smoke 的摘要。`/predict/` 输入只包含 screenshot ref 或 inline upload 后的图像 payload 加 target description；输出进入 window-local 或 crop-local coordinates、confidence/raw text 和 diagnostics。

默认上传策略是 inline image upload：

```bash
export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="inline"
```

只有明确配置共享路径映射时才传服务端可读 `image_path`；否则本机截图路径会在 KV-Ground 服务侧变成 `image_path not found`。Computer Use trace 可以记录截图 ref、focus crop ref、sha256、尺寸、target description、window/crop-local coordinates、provider metadata、executor lease、verifier verdict、approval/audit refs 和 diagnostics，但不得保存 raw screenshot payload、`data:image`、base64 或大日志。

真实桌面输入优先使用独立 input adapter。当前 `remote-desktop` 只有在 Host 注册 `sciforge-simulated-remote-desktop` provider 时才可执行；该路径维护虚拟 pointer/keyboard state refs，不移动系统鼠标、不发送全局系统键盘事件。未注册 provider 的 `remote-desktop` / `virtual-hid` 会 fail closed。没有独立 adapter 时，鼠标键盘属于 shared system input，必须绑定低风险目标窗口、串行持有 executor lease，并在 request/result 中显式记录 acknowledgement 或 blocked reason。该路径仅是显式确认后的诊断/迁移路径，不能让 desktop preflight ready，也不能满足 PROJECT B/C、L2/L3 或最终输入隔离证据。

## 验收边界

当前独立插件闭环只跑 package-local API/CLI/host-port/fixture/probe 验证，不启动 runtime、GUI、browser acceptance、CU-NEXT 或 release gate。下面的 L2/L3 描述是后续集成验收边界，不是当前 package-only 任务的完成条件。

真实输入 smoke 只证明基础链路可用，不等于用户级成功。Computer Use 的最终验收至少需要一个可见用户产物，例如用可用的 slide app 制作并保存一页 PPT；目标打通需要一个多 App 工作流，例如 Browser/资料页 -> slide app -> Finder/保存对话框 -> TUI Host `gui.present` 展示 artifact refs 和 trace refs。

递进测试可以先做 single-window / single-app probes，用来验证 capture、grounding、executor、verifier、`done=true` 判断和证据打包；这些 probe 即使能产生一个文件，也只能算 L2 前置或诊断证据，不能冒充 CU-NEXT L3 多 App 工作流。Artifact-producing acceptance 必须同时满足：产物 ref 是当前 run bundle 内的 `final-artifact-ref`，result/trace/`ToolPayload` 明确暴露 `finalArtifactRef`，最终截图能看到产物或保存位置，verifier verdict 明确覆盖产物存在/可见性，按 request metadata 要求提供当前目录 file-list artifact/data refs，TUI Host 已用 `gui.present` 展示该 ref 和 trace 摘要。缺任一项时返回 `blocked` / `repair-needed` 或 diagnostic manifest，不得返回用户级完成。

验收不得绕过真实 GUI 操作：不能用 Playwright、DOM、accessibility tree、app-specific private API 或直接文件生成替代 Computer Use 的 observe/ground/execute/verify 链路。若目标 App、系统权限或 shared input policy 不满足，返回 `blocked` manifest。

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

```bash
python -m pytest packages/actions/computer-use/tests
```
