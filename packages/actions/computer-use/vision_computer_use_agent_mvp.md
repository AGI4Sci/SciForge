# 视觉 Computer Use Agent — MVP 设计文档

版本：v0.2-coarse-to-fine
日期：2026-05-05

---

## 1. 目标

用最少的模块实现一个能 work 的纯视觉 GUI 操作闭环。

历史 MVP 目标场景是 Chrome/browser 中的线性任务，如"搜索一篇论文并下载 PDF"。当前执行目标已经收窄为 `packages/actions/computer-use` 独立插件闭环：只用 package-local plugin/API/CLI/host-port/fixture/probe 证据证明 action loop、trace/result、输入隔离 contract 和 verifier metadata 边界。Browser、runtime、GUI、CU-NEXT、L2/L3 用户级桌面验收都是独立插件闭环之后的后续集成目标。

核心约束不变：纯视觉路线，不读 DOM，不读 accessibility tree，LLM 不输出坐标。

---

## 2. 架构

Computer Use 是 TUI 侧 action provider，不是 GUI 侧功能。它只直接和 TUI Agent Host 通信；GUI 需要展示 trace、收集确认或提示状态时，由 TUI Host 调用 `gui.present`、`gui.ask_user`、`gui.notify` 或 `gui.set_status`。Computer Use 模块不得 import React/UI、renderer registry、Workbench、AnnotationSidebar 或 GUI 私有状态。

对外信息流：

```
User / GUI gesture
  -> terminal-equivalent text
  -> TUI Agent Host
  -> computer_use.run_task(request, host_ports)
  -> refs-first result | needs-confirmation | failed-with-reason
  -> TUI Agent Host
  -> optional gui.present / gui.ask_user / gui.notify
  -> GUI Shell
```

内部仍保持五个模块，串联成单一循环；其中视觉理解统一使用 coarse-to-fine 证据链：

```
TUI Agent Host
  ↓  computer_use.run_task(request, host_ports)
Visual Observer → Planner → Grounder → Executor → Verifier
       ↑                                              │
       └──────────────── 循环 ─────────────────────────┘
```

不做 milestone 拆分、不做多候选竞争、不做恢复。每一步就是：看目标窗口 → 粗定位关键区域 → 局部 focus crop → 精定位/执行 → 局部+整窗验证 → 把反馈写回记忆 → 继续或停止。

包边界：

- `packages/actions/computer-use` 拥有 Computer Use action provider 的主体：request/result schema、action loop、safety/approval policy、trace contract、budget debit、host port contract、executor adapter contract 和 compact handoff。
- package-owned target-bound window host 和 isolated executor 也属于 `packages/actions/computer-use`：它们是 generic host-port implementation / contract，用于证明 target binding、isolated input 和 refs-first real-window evidence；它们不属于 GUI，也不应长期落在 `src/runtime`。
- `packages/observe/vision` 是可选 sense provider。它负责视觉观察、coarse-to-fine focus region、KV-Ground/visual grounding、verifier 反馈压缩、临时多模态记忆和 trace contract validation；它不执行桌面动作。
- `src/runtime` 只保留 SciForge Host adapter：把 `GatewayRequest` 转成 `ComputerUseRequest`，提供 `host_ports`，把结果转成 `ToolPayload` 和 runtime events。通用 Computer Use 能力不应长期留在 `src/runtime/computer-use`。
- GUI 只展示 refs、折叠 audit/debug、收集确认和发送终端等价文本；它不执行 Computer Use，也不决定 provider、policy、completion 或 confidence。

算法边界：`packages/actions/computer-use` 拥有通用 Computer Use policy、action loop、safety/approval gate、host bridge contract、scheduler/executor contract、completion 判断、trace handoff 和 compact result。`packages/observe/vision` 只提供可选视觉侧 helper：coarse-to-fine 区域选择、focus region contract、KV-Ground/visual grounding helper、verifier 反馈压缩、临时多模态记忆压缩和视觉 trace validation；它可以给 planner/verifier 提供视觉证据和修复建议，但不拥有执行流、副作用、安全门、完成判断或用户级 success。SciForge runtime 只装配 TUI Host ports，负责把截图、裁剪、坐标映射、执行动作和写 trace 的平台能力以接口形式提供给 action provider。长测 runner 只负责 scenario/manifest/report 编排，不再自己维护视觉契约和通用策略。

### 2.1 对外接口

Computer Use 对 TUI Host 暴露窄接口：

```ts
computerUse.getManifest()
computerUse.runTask(request, hostPorts)
computerUse.validateTrace(traceRef)
computerUse.compactResult(result)
computerUse.validateRepairManifest(manifestRef, resolver?, require_existing_refs?)
computerUse.buildRepairReplayEvidence(failureManifestRef, replayResultRef, replayTraceRef?)
computerUse.validateRepairReplayEvidence(evidenceRef)
computerUse.buildViewportRecoveryEvidence(failureManifestRef, replayResultRef, replayTraceRef?)
computerUse.validateViewportRecoveryEvidence(evidenceRef)
computerUse.buildTargetBoundRealWindowProbeEvidence(preflightManifestRef, resultRef, traceRef, ...)
computerUse.validateTargetBoundRealWindowProbeEvidence(evidenceRef, requireExistingRefs?)
```

推荐请求形状：

```ts
type ComputerUseRequest = {
  schemaVersion: 'sciforge.computer-use.request.v1';
  task: string;
  maxSteps?: number;
  riskPolicy?: 'fail-closed' | 'allow-confirmed';
  windowTarget?: WindowTarget;
  providers?: {
    sense?: 'local.vision-sense';
    grounder?: 'kv-ground' | 'vision-grounder';
    executor?: 'desktop-bridge' | 'remote-desktop' | 'target-bound-isolated-window' | 'dry-run';
    verifier?: 'layered-vision-verifier' | 'semantic-verifier' | 'fake-semantic-verifier-diagnostic';
  };
  approvalRef?: string;
  trace?: {
    outputDir?: string;
    storagePolicy: 'ref-only';
  };
};
```

推荐结果形状：

```ts
type ComputerUseResult = {
  status: 'completed' | 'failed-with-reason' | 'needs-confirmation' | 'max-steps';
  reason: string;
  traceRefs: string[];
  screenshotRefs: string[];
  artifactRefs: string[];
  finalArtifactRef?: string;
  finalArtifactRefs: string[];
  finalObservationRef?: string;
  approvalRequest?: {
    reason: string;
    riskLevel: 'high';
    actionSummary: string;
    traceRefs: string[];
  };
  verifierResult?: {
    verdict: 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
    confidence?: number;
    critique?: string;
    repairHints?: string[];
  };
  budgetDebitRefs?: string[];
};
```

`hostPorts` 是 action provider 和宿主平台能力的唯一接触面。它可以由后续 TUI Host/native host adapter 满足，也可以由 package-owned target-bound window host 在 package 内满足；两者都必须保持 generic contract，只交换 refs 和结构化结果，不读取 GUI private state：

```ts
type ComputerUseHostPorts = {
  capture(target: WindowTarget, scope: 'display' | 'window'): Promise<ScreenshotRef[]>;
  crop(ref: ScreenshotRef, region: FocusRegion): Promise<ScreenshotRef>;
  execute(action: GenericGuiAction, target: ResolvedWindowTarget): Promise<ExecutionOutcome>;
  writeTrace(trace: ComputerUseTrace): Promise<string>;
  emitEvent(event: ComputerUseEvent): void;
};
```

最终产物不通过新增 GUI port 直接写入。Host ports 的 capture/verify/writeTrace 负责把当前 run bundle 中可检查的 visible artifact record、文件 ref 或 verifier metadata 带回 package；package result、trace 和 compact handoff 将其提升为 refs-first `finalArtifactRef` / `finalArtifactRefs`。`vision-trace.json`、`tool-payload.json`、`gui-present.json`、`action-ledger.json` 等控制/证据文件只能作为 trace/evidence refs，不能被提升为最终产物。TUI Host 再把这些 refs 映射到 `ToolPayload` 和 `gui.present`，并验证它们是 bundle-local 文件证据，而不是历史 ledger 或脚本直写替代。

Package-local fixture 只用于 `packages/actions/computer-use` 的 tests、CLI dry-run diagnostics 和 schema/trace plumbing 验证。Fixture 输出即使包含 `finalArtifactRef` / `finalArtifactRefs`，也只能证明 package API、CLI、trace/result refs 和 compact handoff 正确传递；不能作为真实 Computer Use 成功证据，也不能被 runtime、GUI、CU-NEXT 或 release acceptance 当作替代证据。真实验收必须由 TUI Host 注入 host ports，并走 observe -> plan -> locate -> execute -> observe -> verify 的链路。

独立插件发现面由 `sciforge_computer_use.plugin_probe` 验证：probe 只在 `packages/actions/computer-use` 边界内解析 provider manifest、校验 Python package entrypoint、核对 `run_task` / `runTask` / `getManifest` API symbol，并可选用 stdin request + fixture JSON 调一次 package CLI。它输出 refs-first `plugin-probe-manifest.json`，不内联完整 manifest 或 raw stdout，也不读取 SciForge runtime / GUI。该 probe 证明“可发现、可加载、可调用”的插件面，不证明真实桌面输入成功。

Package-local host-port stdio probe 可以证明 `python -m sciforge_computer_use --host-port-stdio` 的 JSONL contract 和 evidence guards，但 scripted host ports 仍不等同于真实桌面输入证据。真实窗口任务前必须先运行 desktop preflight：它不截图、不执行输入，只写 `desktop-host-port-preflight-manifest.json`，并把 loop required host ports (`capture/plan/locate/execute/verify`) 与 evidence required host ports (`writeTrace/emitEvent`) 分开记录。缺少 capture/executor、target window、独立 simulated input adapter 的 manifest/ref，缺少 `sciforge.computer-use.input-adapter-target-binding.v1` target binding manifest/ref，使用 diagnostic/fail-closed executor，或声明 shared/global/real OS input channel 时，preflight 必须 fail closed。Package-owned target-bound window host 可以让 preflight ready，但前提是它证明 target binding、isolated input、real-window evidence capability、执行会改变声明目标环境，并且 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false`、`systemKeyboardEventsSent=false`。Target binding helper/validator 只规范声明格式：`build_input_adapter_target_binding_manifest` 默认生成 unbound refs-first manifest；`validate_input_adapter_target_binding_manifest` 只有在 adapter 绑定到可验证目标环境、保留存在的 adapter/window/evidence refs、执行会改变该目标环境、具备 real-window evidence 能力且仍不触发 OS/shared/system input 时才返回 ok。通过该 validator 只能解除 preflight 的“缺 binding 声明”阻断，不能替代真实窗口 capture -> plan -> locate -> execute -> verify 证据。Native capture/stdout probes 会写 `native-selected-window.json` 和 `native-target-window-binding-proof.json`，用真实 window screenshot ref 证明捕获目标窗口；这些 refs 只能推进 blocker 归因，不能把 state-only adapter 写成 bound。单独的 state-only adapter manifest 不能让真实桌面 preflight ready。该 manifest 是 B/C 继续推进的 blocked evidence，而不是用户级 success。

Target-bound real-window probe evidence 由 `build_target_bound_real_window_probe_evidence` / `validate_target_bound_real_window_probe_evidence` 描述。该层是 package-local unit-testable contract，但必须和 actual package-owned target-bound run 区分：只有实际 run 写出 ready preflight、initial/final screenshots、trace/result refs、target binding validation 和 `inputExecuted=true`，才能从诊断 contract 提升为 package-level real-window evidence。Evidence 要求 ready preflight、真实 target binding validation、target-bound input channel、initial/final screenshot refs、trace/result refs、`finalArtifactRef`、`realWindowEvidence=true`、`diagnosticOnly=false`、`inputExecuted=true`，并要求所有 OS/shared/system input 副作用字段为 false。它拒绝 shallow `targetBindingValidation={ok:true}`、fail-closed execution、shared input、缺 refs 和 inline image/base64。Task B 和鼠标/键盘复杂任务可以启用 `workflowRequirements`：至少 N 个 action steps、`requiredInputModalities=["pointer","keyboard"]`、每步当前 screenshot/observation ref、最终 visual + artifact + file-list refs、以及禁止 prior-round ledger / historical done completion evidence。启用 required modalities 后，validator 不只看 action kind；它还读取 `targetPointerStateRef`、`targetKeyboardStateRef`、`targetInputEventLogRef` / `pointerEventLogRef` / `keyboardEventLogRef` / `inputEventLogRef`，要求 modality-specific event log 非空，并要求 event `actionIndex` 覆盖对应 pointer / keyboard step。

Package-owned target-bound host 现在覆盖一组复杂任务 fixture：一页 PPTX、CSV/表格编辑、表单填写与 Tab 导航、高风险表单提交 fail closed、鼠标菜单 + 键盘热键保存、保存后文件预览/目录确认。Package tests 还覆盖安全表单步骤后的高风险弹窗确认按钮 fail closed，以及多次 scroll 后才出现保存位置的 long-scroll viewport recovery。Declared artifact output 由 `artifactSpec.kind` 或 `finalArtifactRef` 扩展名选择 renderer；`text` / `markdown` / `csv` 写文本类文件，`.pptx` / `slide-deck` 会写一页 OOXML deck 和 `pptxValidationRef`，校验 zip/XML parts、`slideCount=1`、hash/size 和 no macro payload。Artifact evidence 还必须保留 causality：`artifactMetadata.finalArtifactRef` 与 evidence final artifact 一致，`savedByActionIndex` 指向 generic `save` 或 `Ctrl/Cmd+S` 一类键盘保存 step，并且该 action index 有对应 keyboard event。Planner contract 只允许标准本地文档保存/导航热键，显式 app-private 或未知快捷键仍 fail closed。这个 probe 是 package-level target-bound evidence，不是后续 GUI/CU-NEXT/L2/L3 用户级 app 验收。

当前 package-local virtual desktop host-port probe 是上述 stdio 边界的 state-only variant：父进程驱动真实 child `--host-port-stdio`，由 package-local host ports 提供 capture/plan/locate/execute/verify/writeTrace/emitEvent，`execute` 绑定 `VirtualInputAdapter`，只产生 virtual pointer / keyboard / input state 更新。它可用 repository fixtures `virtual-desktop-six-step.json` 和 `virtual-desktop-ambiguous-before-after.json` 验证六步 artifact/file-list refs、歧义目标修复路径和 viewport/offscreen scroll recovery，并写出 result、trace、screenshot、artifact、final artifact、file-list 和 virtual input state refs。定位失败时，probe 写出 `blocked-repair-manifest.json`，把 `failedStage`、`locateFailures`、`viewportFailures`、trace/screenshot refs、scenario ambiguity、result/probe refs 和 virtual input isolation 状态放进同一个 refs-first manifest，用于抽取最小 disambiguation 或 viewport recovery probe 后重跑。Repair replay validator 只校验 blocked repair manifest 到 repaired replay 的 refs-first 关系：ambiguous failure 的候选数必须大于 1，重跑后必须显式唯一选中一个原失败候选，并保留 source/replay result/replay trace refs。Viewport recovery validator 则要求零可见匹配、offscreen candidate、scroll recovery action、非零 scroll delta、scroll 前后 virtual input state refs，以及最终唯一选中一个原 offscreen candidate；两者传入 `require_existing_refs=True` 时，还要求关键 refs 指向现有本地文件。若声明 real-window evidence，还必须提供 real-window evidence refs 和成功的 target binding validation。若 `realWindowEvidence=false`，即使 evidence status 为 `completed`，也仍是 package-local diagnostic，不是 C 的真实失败恢复闭环完成。该 probe 即使返回 `completed`，也只证明 host-port/ref/evidence plumbing；它不是真实桌面输入、真实窗口状态改变或 PROJECT B/C/VLM 完成证据。

`validate_repair_manifest` / `validateRepairManifest` 位于 `sciforge_computer_use/repair_manifest.py`，用于先校验 `blocked-repair-manifest.json` 本身再进入 replay/viewport evidence。它要求 package-local blocked manifests 带显式 negative side-effect flags（`inputExecuted=false`、`sharedSystemInputUsed=false`、`realWindowEvidence=false`、`rawPayloadWritten=false`、`inlineImageWritten=false`，并保持 `diagnosticOnly=true`），拒绝 inline/base64 payload evidence，并支持 `require_existing_refs=True` 做本地 ref 存在性检查；这只改善 Task C 审计链路，不代表 C 已完成。

Native capture-only probe 可以在 package 边界内继续推进真实 host-port 前置证据：它通过只读窗口 inventory 找到 windowId，并用 `screencapture -x -l<windowid>` 或 display capture 写 screenshot ref 与 `native-window-inventory.json`。该 probe 必须记录 `inputExecuted=false`、`sharedSystemInputUsed=false` 和 `observedHostPorts=["capture"]`；只要缺少 executor、planner/locator/verifier/writeTrace host ports 或 independent simulated input adapter，desktop preflight 仍必须保持 blocked。

Native capture stdio probe 则必须穿过 child `--host-port-stdio` loop：父进程给 `capture` 返回真实 screenshot ref，给 `execute` 返回 hostPortResult envelope `ok=true` 但 payload `{ok:false, blocked:true}`。这样 failure 属于 loop execution stage，trace writer 仍会被调用，result/trace/manifest 可以证明 observe -> plan -> locate -> execute-block 的真实 stdio 链路。Host-port envelope `ok=false` 只用于 port/protocol 异常，不能用来表达正常安全阻断。Probe 的 final result 必须在 `failureDiagnostics` 中回写 native stdio manifest ref、preflight ref/status/blocked reasons、target-window resolution 和 `executeFailClosed`，避免调用者需要旁路读 sidecar 才能解释失败。

`sciforge_computer_use.virtual_input_adapter` 是最终输入隔离目标的 package-local contract：它维护 virtual pointer / keyboard / input state refs，只把 generic GUI action 转成 JSON 状态更新，metadata 永远声明 `osInputExecuted=false`、`sharedSystemInputUsed=false`、`systemPointerMoved=false` 和 `systemKeyboardEventsSent=false`。它会对 unsupported action、高风险 action、`shared-system` / `real-os` 等真实输入模式 fail closed。该 adapter 可以作为 host executor 的独立输入协议样板，但 state-only 更新不会改变真实桌面；真实 B/C 仍必须由 host 把该隔离输入通道绑定到可验证目标环境后才能勾选。

Runtime Codex text planner 默认仍走 `runtime-codex-tui-text-planner` host port，也就是 Codex CLI/TUI 的文本规划通道。若该通道出现明确的 provider transport/protocol failure（例如 502 Bad Gateway、gateway timeout、upstream/proxy/network error），且进程环境已经提供 OpenAI-compatible base URL、model 和 `SCIFORGE_RUNTIME_API_KEY`，runtime adapter 可以启用 direct non-streaming chat fallback。该 fallback 必须复用 `packages/backend` 的 Responses <-> Chat Completions 转换代码，只返回同一个 generic action JSON schema，并在 diagnostics 中记录 `direct-chat-fallback`；它不能调用 GUI、DOM、accessibility tree、外部工具或私有应用 API。普通 planner JSON/策略错误不得触发该 fallback。

不建议把 `requestApproval` 放进 `hostPorts` 让模块直接弹 UI。高风险动作应返回 `needs-confirmation` 和 `approvalRequest`；TUI Host 决定是否调用 `gui.ask_user`，确认后再以 `riskPolicy='allow-confirmed'` 和 `approvalRef` 发起新的受控调用。

---

## 3. 主循环

**步骤 0：TUI Host 装配。** TUI Host 根据用户文本或 slash/tool 调用构造 `ComputerUseRequest`，注入 `hostPorts`，并选择 sense/grounder/executor provider。GUI 不参与 provider 选择。

**步骤 1：观察。** 通过 `hostPorts.capture` 截图，等待屏幕稳定（连续两帧 diff 低于阈值），生成屏幕摘要和可见文本列表。

**步骤 2：判断是否完成。** 将当前 observation、任务描述、trace/verifier feedback、artifact/file refs 交给 completion-only 判断；VLM 只能作为 optional `semanticVerifier` metadata 辅助解释当前视觉证据，不能直接拥有完成决策。只有 deterministic checks、当前视觉/文件证据和 package evidence guards 全部满足时，才返回 `completed`。Artifact-producing task 的 `done=true` 还必须有当前轮视觉/文件证据证明 bundle-local `final-artifact-ref` 指向真实产物。当文本推理、历史 ledger 或前几轮摘要与当前画面不一致或不足以证明结果时，必须先重复观察、请求 focus-region crop 或扩大/重选局部区域，不能只凭 ledger 猜测已经成功。

**步骤 3：规划下一步。** Planner 输出一个动作，包含动作类型和目标视觉描述。不生成多个候选，只生成一个最合理的下一步。对于密集 UI、小图标、表格、菜单和弹窗，Planner 可以额外输出 `targetRegionDescription`；runtime 会把它作为 coarse region 先裁剪观察，再在 crop 内精定位。Planner 也可以输出 `wait + targetRegionDescription` 来请求 observation-only 局部观察。若 planner 只能从 action history、ledger 或旧截图推断完成状态，而当前观察没有直接证据，下一步必须是 observation-only 观察或聚焦验证，而不是 `done=true`。

**步骤 4：定位。** Grounder 根据目标描述在窗口截图上定位。使用 coarse-to-fine：先在整窗截图中得到目标区域或粗中心点，再由 vision-sense 生成 focus-region crop，随后用 KV-Ground 在 crop 内二次精定位，把 crop-local 坐标映射回 window-local/executor 坐标。后续执行和验证都使用精定位结果，并记录 coarse/fine grounding 证据。如果精定位失败，trace 会保留 coarse grounding 和 fine failure，供下一轮规划修正。

**步骤 5：执行。** Executor 通过 `hostPorts.execute` 执行通用鼠标键盘动作。真实桌面输入、远程桌面输入或 dry-run 都是 host port provider；Computer Use 不调用 GUI，也不通过 GUI 间接执行。

**步骤 6：验证。** 截图，对比执行前后的整窗和 focus-region crop。如果 focus 区域或整窗几乎没变化，记录为"动作可能无效"。Verifier 同时压缩 pixel diff、window consistency、grounding 坐标、focus bbox、失败/阻断原因和下一步建议，并调用 `build_region_semantic_verifier` 输出 `regionSemantic` verdict，例如 focused target reacted、off-target/unrelated window change、text-entry unverified。上述反馈供下一轮 Planner 使用。

可选 VLM / semantic verifier 只能作为 host-provided metadata 进入 `Verification.metadata`，由 action provider 规范化成 refs-first `semanticVerifier` 摘要：provider/model/verdict/confidence/reason/evidence refs 可以保留，raw response、inline image 和 base64 必须丢弃或 fail closed。它不决定坐标、不执行动作、不覆盖 deterministic verifier，也不能单独证明 artifact-producing completion；完成仍由当前 observation、file refs、trace refs 和 package evidence guard 支撑。`fakeProvider` 或 `diagnosticOnly` semantic summary 只能作为 package-local 诊断，不拥有执行、坐标、completion 或 artifact success 的决策权。

`sciforge_computer_use.semantic_verifier_probe` 只用于 package-local 验证这条 metadata 边界：它从 ignored local config 的 `visionLLM` 或 `computerUse.visionLLM` 读取 VLM 设置，把 prompt/image 作为 file refs 记录，调用 OpenAI-compatible vision chat endpoint，并把 provider 回答压缩成 `semanticVerifier` summary ref。probe 不写 API key、raw provider payload、request body、inline image 或 base64；provider/network/auth/timeout 失败时产出 blocked manifest，不能把 VLM helper 标成完成。

为了区分 `/chat/completions` wire shape 问题和 provider/network 问题，semantic verifier probe 先跑同 base URL / model / key 的 text-only preflight，再尝试 Chat image URL object、Chat image URL string 和 Responses `input_text` + `input_image` variants。Text preflight 对 timeout、URL/network error、HTTP 408/429/5xx 做 bounded retry；如果 Chat text payload 被 400/415/422 或 shape/schema 类错误拒绝，先尝试 minimal `model + messages` payload；若 Chat text 仍是 shape rejection，再尝试 Responses text preflight。只有 Responses text preflight 成功时，后续才限制为 Responses image variant，避免把 Chat 协议不兼容误判成 provider 不可用。Multimodal shape rejection 不做 transient retry，直接进入下一个安全 variant。Endpoint resolver 接受 API base、`/chat/completions`、`/responses` 或 `/models` 风格的 `baseUrl`，统一派生 `/models`、`/chat/completions` 和 `/responses`，并在 diagnostics 中分别记录 `textChat` 和 `textResponses`；诊断记录只包含 method、path、elapsedMs、retryable、errorCategory、diagnostic timeout 和安全 body 摘要。`/models` 诊断可记录 `bodyKind`、`bytesRead`、`bodyTruncated`、`modelCount` 和 `configuredModelPresent`，但不记录 raw model ids 或 raw response body。Responses / Chat compatibility 由 package-local `response_compat.py` 提供，复用 `packages/backend/src/response-compat.ts` 的最小非流式语义：`responses_to_chat_completions` 生成标准 Chat text preflight，`chat_completions_to_responses` 生成 Responses image fallback，`extract_provider_text` 接受 `output_text`、`output[].content` 字符串、`output[].content[].text` / `output_text`，同时继续接受 Chat `choices[].message.content` 字符串或 text parts；image/data-url parts 会被 redacted，不会作为文本证据泄露。Provider 必须返回可解析的 JSON verdict，且 `verdict=pass` 才能让 probe completed；completed 只代表 wire path 与 verdict 通过。PROJECT VLM eligible evidence candidate 还必须满足代码实际支持的 project evidence model check、provider `responseModelId` 不冲突、以及 `/models` 或等价 diagnostics 证明 `configuredModelPresent=true`，否则 `projectVlmEvidenceEligible=false`。当前 PROJECT VLM evidence allowlist 可接受 `qwen3.6-plus`、`qwen3.6-plus-2026-04-02` 或 `kimi-k2.6`。`fail`、`unknown` 或非 JSON 内容都会写 blocked manifest。Package tests 使用 fake HTTP provider 走真实 `_http_json_post()` wire path，覆盖 Chat text shape rejection -> Responses text/image success，以及 text preflight -> Chat image shape failure -> Responses image success；fake provider success 仍只是协议/诊断证据。若标准 HTTP client 路径出现明确 transport/protocol incompatibility，transport fallback 使用 package-local raw HTTP/1.1 non-streaming POST 重放同一 sanitized Chat/Responses candidate，并输出同一 refs-first summary/diagnostics contract。Manifest 只能写 stage、endpoint kind、payload kind、状态、retry count、elapsedMs、错误类别和模型 eligibility 摘要，不写原始请求、图片 data URL、Authorization、secret、raw request/response body 或 provider raw payload。

**步骤 7：记录并继续。** 把这一步的动作、整窗截图 refs、focus crop refs、verifier feedback 和结果追加到历史中。需要跨步或跨轮复用时，调用 `vision-sense.visual_memory` 生成 file-ref-only 的临时多模态记忆块，再回到步骤 1。

**步骤 8：TUI Host 输出。** Computer Use 返回 refs-first result。TUI Host 决定是否把 trace 通过 `gui.present` 展示、是否把高风险 `approvalRequest` 通过 `gui.ask_user` 交给用户确认、或是否把失败包装为 repair hint。

**退出条件**：任务完成、达到最大步数（如 30 步）、Grounding 连续失败 3 次。

当可执行动作 budget 已经用尽时，`max_steps` 只禁止继续执行动作，不禁止一次收尾判断。loop 可以进行一次 final no-execute completion check：额外 `observe` 一次，把最终截图、当前 trace/ledger、verifier feedback 和 artifact refs 交给 planner，只允许 planner 返回完成/失败判断，不允许 safety、grounder 或 executor 再运行。只有该 planning-only 判断明确 `done=true`，才能追加一条 no-execute done step 并返回 `completed`；否则仍按正常 `max-steps` failure 返回，不能把"刚好执行了最后一个有用动作"自动当作成功。

**验收契约**：trace 由 `vision-sense.trace_contract` 和 Computer Use action provider trace contract 共同校验：windowTarget、window screenshot refs、window-local 坐标、generic mouse/keyboard input channel、serialized scheduler metadata、window verifier consistency、file-ref-only image memory、host port provider metadata 和 no DOM/accessibility/GUI-private fields。T084/T085 的长测 runner 只把 trace path、workspace path 和 raw trace text 传入该接口。

**验收分层**：当前 package-only 阶段只能声明 plugin/API/CLI/host-port/fixture/probe 层面的完成或 blocked evidence。L1 真实输入 smoke、progressive single-window / single-app probes、L2 单 App 用户产物任务和 L3 多 App 用户工作流都属于独立插件闭环之后的集成验收；只有后续 L2/L3 可以声明用户级 Computer Use success，CU-NEXT L3 必须有真实多 App / 多视图 task-scoped acceptance，不能由单窗口或单 App probe 顶替。

---

## 4. 五个模块的设计

### 4.1 Visual Observer

**输入**：`hostPorts.capture` 得到的当前目标窗口截图、上一帧截图、可选 focus-region 请求。

**输出**：屏幕摘要（VLM 生成的一句话描述）、可见文本列表（OCR 结果，含位置）、屏幕是否稳定、可选 focus-region screenshot ref。输出只包含文本、坐标、refs 和紧凑 metadata，不包含截图字节、DOM、accessibility tree 或 GUI 私有对象。

**稳定性检测**：截图后等待，每 0.3 秒再截一帧，如果连续两帧差异低于阈值（如变化面积 < 1%）则判定为稳定。最长等待 8 秒。

**MVP 简化点**：不做等待状态三分类，不做完整 UI 区域类型检测；只在 Grounder/Verifier 需要时生成局部 crop，并把 crop 作为文件引用写入 trace。

### 4.2 Planner

**输入**：任务描述、当前屏幕摘要、可见文本列表、最近 N 步动作历史、最近 verifier feedback。

**输出**：一个动作，包含动作类型（click / type_text / press_key / scroll）和目标视觉描述。

**关键约束**：

- Planner 不输出坐标，只输出自然语言的视觉目标描述
- 目标描述必须包含足够的区分信息（如"右下角的蓝色 Export 按钮，不是左侧的 Export 菜单项"）
- 动作历史和 verifier feedback 传入的目的是避免重复执行同一个无效动作
- 如果上一步反馈显示 `pixel=no-visible-effect`、`focus=bbox(...)` 或 `window=lifecycle-changed`，Planner 必须换目标描述、扩大/重选局部区域、换输入 modality，或先恢复窗口状态

**MVP 简化点**：只生成一个动作，不生成多个候选。不做 milestone 拆分，Planner 每步自行判断最合理的下一步。

**Planner Prompt 要点**：

```
你是 GUI 操作规划器。你不能输出坐标。

任务：{task}
当前屏幕摘要：{screen_summary}
可见文本：{visible_texts}
已执行动作：{action_history}
Verifier反馈：{verifier_feedback}

请输出下一步操作。要求：
1. 输出动作类型和目标的视觉描述
2. 目标描述要包含文字内容、位置、颜色等视觉特征，
   足以在屏幕上唯一定位
3. 如果上一步动作没有生效，基于 verifier feedback 换目标、换区域或换输入方式
```

### 4.3 Grounder

**输入**：当前截图、目标视觉描述。

**输出**：目标中心点坐标（归一化）、置信度、准星验证结果。

**Coarse-to-fine 定位**：

阶段一，全局粗定位：在目标窗口截图上找到目标大致区域（bbox）或粗中心点。

阶段二，focus region：调用 `vision-sense` 的 `build_focus_region` / `build_focus_region_from_trace` 生成 clipped bbox，runtime 只负责把 bbox 裁成 `focus-region` screenshot ref。

阶段三，局部精定位：在 crop 图上用 KV-Ground 精确定位中心点。crop-local 坐标换算回 window-local 坐标，再映射到 executor 坐标。trace 中同时记录 `coarseGrounding`、`fineGrounding`、`focusRegion` 和最终执行坐标。

**准星验证**：在预测点绘制十字准星，让 VLM 判断准星是否落在目标上。如果验证失败，让 VLM 重新描述目标后再做一次两阶段定位。最多重试一次。

**坐标转换**：crop-local 坐标 → window-local 截图像素坐标 → target-bound executor 坐标。需要处理 crop bbox、目标窗口 origin 和 device pixel ratio 缩放；不得把 window-local state 和 executor/screen 坐标混用。

**MVP 简化点**：不做 Grounding Ensemble，不做 Disambiguation，只用单模型单次定位 + 一次重试。

### 4.4 Executor

**动作空间**：host-declared generic GUI action subset，当前 target-bound executor 支持 click / focus、type_text、press_key、hotkey、scroll 和 wait。Host 可以继续扩展 drag / double_click / right_click，但必须先补 refs-first event/state/evidence contract 和测试。

**边界**：Executor 是 host port provider，不是 GUI 控件。它可以实现为本机 desktop bridge、remote desktop adapter、browser sandbox adapter 或 dry-run executor，但不能依赖 React/UI，也不能通过 GUI Shell 执行点击或输入。

**执行原则**：

- 文本输入优先走 target-bound isolated adapter 的 text injection；clipboard paste 只能作为显式诊断/迁移路径记录，不能满足 B/C 或 real-window evidence
- 点击后等待屏幕稳定再进入下一步
- scroll 按固定幅度执行
- 真实或远程目标输入必须绑定 target window / target environment，并记录 input channel、executor provider、adapter manifest、target binding validation 和 user-device impact
- 没有 target-bound isolated adapter 时必须 fail closed；shared/system/clipboard input 只能作为显式确认后的诊断迁移路径，不能让 desktop preflight ready，也不能满足 B/C 或最终输入隔离证据

**MVP 简化点**：不把 action subset 写死成长期能力边界；当前只把已声明、已验证的 generic actions 当作可执行，未声明或缺 evidence contract 的动作必须 fail closed。

### 4.5 Verifier

**输入**：执行前整窗截图、执行后整窗截图、执行前后 focus-region crop、grounding、windowTarget。

**输出**：整窗是否变化、focus 区域是否变化、窗口是否一致、动作是否可能无效、面向后续规划的 compact feedback。

**验证逻辑**：MVP 仍以像素级对比为主，但优先比较 focus-region crop。整窗变化而 focus 不变，通常意味着点错区域或无关动画；focus 变化而整窗变化很小，通常意味着小控件状态改变。两者都会写入 trace。

**反馈记忆**：调用 `vision-sense` 的 `build_verifier_planning_feedback` 生成短文本，例如：

```
pixel=no-visible-effect ratios=0.0000 | window=same-target-window sameWindow=true |
grounding=provided target="Save button" local=120,44 | focus=bbox(72,0,96,80) |
next=click produced no visible window effect; avoid repeating same target unless screenshot changed
```

**MVP 简化点**：region semantic verifier 先使用 action 类型、focus/window pixel diff、grounding 和 focus bbox 生成可审计语义分类；它不会伪造 OCR 结果。需要精确读取输入框文字、checkbox 状态、菜单项或错误提示文本时，后续可在同一 `regionSemantic` schema 上接入 OCR/VLM 语义检查。Visual Observer 和语义 Verifier 可以复用同一个 VLM provider；Verifier 仍先跑 deterministic checks，再把 compact evidence 交给 Codex CLI / TUI 文本 agent 做完成判断、下一步修复或最终解释。

---

## 5. 任务完成判断

不用 Task Contract，不拆 success_criteria。每轮循环开始时，将当前 observation、deterministic verifier feedback、trace refs、artifact/file refs 和可选 `semanticVerifier` summary 交给 completion-only guard。VLM 只提供 refs-first metadata，不直接回答完成，也不能覆盖 deterministic checks 或 package evidence guards。

```
任务：{task}
当前 observation ref：{observationRef}
当前 verifier feedback：{verifierFeedback}
当前 artifact/file refs：{artifactRefs}
可选 semanticVerifier summary：{semanticVerifier}
已执行 {n} 步操作。

这些当前证据是否满足 package-level completion guards？
只返回 completed / not-completed / blocked，并说明当前证据缺口。
```

这种方式足够处理简单线性任务。它的弱点是对复杂任务可能出现假阳性（过早判定完成），所以完成判断必须 fail closed：如果当前截图、focus crop、verifier feedback 或 artifact refs 不能独立支撑完成结论，就继续观察或聚焦验证。Planner 可以使用 ledger 作为上下文，但 ledger 不能替代当前视觉证据；尤其在跨轮任务中，不能因为前一轮曾经记录过 `done`、`clicked`、`saved` 或 `verified` 就直接声明当前轮成功。对 artifact-producing task，`done=true` 必须证明当前 run bundle 内的 `final-artifact-ref`、最终可见截图和当前轮文件证据一致，不能只把 prior ledger 当成产物存在证明。只有 deterministic checks、当前视觉/文件证据和 package evidence guards 全部通过，才追加 no-execute done step 并返回 package-level `completed`。

当某一步执行后刚好耗尽 `max_steps`，loop 允许一次无执行收尾检查：

1. 再观察一次当前目标窗口或显示器，保存 final observation ref。
2. 调用 planner 做 completion-only 判断，只允许输出 `done=true` 或失败理由。
3. 如果 `done=true`，记录 planning-only done step 并返回 `completed`。
4. 如果不是 `done=true`，保持 `max-steps` failure；该检查不得触发 safety、grounder、executor 或任何额外 GUI 动作。

---

## 5.1 临时多模态记忆

临时多模态记忆不是聊天长期记忆，也不保存图片字节。它是当前视觉任务 loop 的工作记忆，由 `vision-sense` 的 `visual_memory.py` 统一生成。

**输入**：

- 当前 run 或前几轮的 `vision-trace.json` 文件引用。
- `imageMemory.refs` 中的 window screenshot refs 和 focus-region refs。
- step-level action ledger、grounding、windowTarget、scheduler 和 verifier feedback。

**输出**：`VisionMemoryBlock`

```json
{
  "schemaVersion": "sciforge.vision-sense.visual-memory.v1",
  "mode": "same-run-replan | cross-round-followup | failure-recovery | long-context-compact",
  "policy": "file-ref-only",
  "text": "...budgeted memory block...",
  "traceCount": 3,
  "screenshotRefCount": 12,
  "focusRefCount": 4,
  "omitted": {"screenshotRefs": 20, "focusRefs": 6, "truncatedChars": 0}
}
```

**规则**：

- 只保留路径、sha256、尺寸、displayId、windowTarget、focus bbox、action count 和 verifier feedback。
- 不内联 `data:image`、base64、DOM、accessibility、截图字节或文件内容。
- 所有省略都要显式记录 omitted counts，避免 Planner 误以为记忆完整。
- 跨轮 memory 只能作为上下文、repair hint 或目标重定位线索；`done=true` 和 artifact-producing completion 必须由当前轮 observation、focus crop、verifier feedback 或文件证据支撑，不能引用 prior-round ledger、旧截图或旧 trace summary 当作当前成功证明。
- runtime 只负责传 trace refs 并消费返回的 memory block，不自己决定视觉记忆策略。

---

## 5.2 Trace 契约与通用策略

`vision-sense` 提供视觉侧 helper 和分析入口，`computer-use` action provider 提供通用策略、执行与副作用契约：

- `sciforge_vision_sense.trace_contract`：校验 `vision-trace.json` 是否满足通用视觉 Computer Use 契约，包括 file-ref-only screenshot refs、window metadata、window-local coordinates、generic input channel、scheduler metadata、window verifier、真实 GUI executor lease 和 forbidden private fields。
- `sciforge_vision_sense.computer_use_policy`：只输出视觉侧 evidence analysis、dry-run/real GUI matrix 诊断建议和默认 window target helper，不拥有安全门、执行流、completion 或用户级验收。
- `sciforge_computer_use`：拥有 `ComputerUseRequest` / `ComputerUseResult`、通用 Computer Use policy、安全门、approval 状态、action loop、execution outcome、budget debit、completion 和 compact handoff。

这些逻辑不属于 `tools/computer-use-long-task-pool.ts`，也不属于 GUI renderer。长测工具只保留任务池、manifest、round prompt、报告和 repair plan；所有可复用视觉理解/定位/记忆/验证/策略判断都通过 vision-sense 接口调用，所有副作用执行、安全门和结果 handoff 都通过 Computer Use action provider 调用。

## 5.3 后续用户级验收任务

本节是独立插件闭环之后的集成验收边界，不是当前 package-only active 目标。当前只运行 package-local API/CLI/host-port/fixture/probe 验证；基础 GUI smoke 不足以证明 Computer Use 对用户有用。后续最终验收必须覆盖真实桌面产物和可见交互链路：

- **L1 capability smoke**：在 disposable 本地页面中点击输入框、输入文本、点击按钮、验证结果文本。该层只验证真实输入链路和 trace contract。
- **Progressive single-window / single-app probes**：先在一个窗口或一个 App 内验证观察、定位、输入、final no-execute completion check、当前轮证据和文件 ref 打包。这些 probe 用来修算法和证据契约；即使能产生一个小文件，也不等于 CU-NEXT L3。
- **Current package-level target-bound probes**：`packages/actions/computer-use/fixtures/target-bound-one-page-pptx.json`、`target-bound-csv-table-edit.json`、`target-bound-form-dialog.json`、`target-bound-form-high-risk-submit.json`、`target-bound-menu-hotkey.json` 和 `target-bound-preview-directory.json`，再加测试内声明的 high-risk dialog confirmation 与 long-scroll viewport scenarios，只证明 package-owned target-bound host、pointer+keyboard evidence、artifact/file-list refs、PPTX/CSV renderer policy、save causality、viewport recovery 和 fail-closed contract。它们不启动真实 slide app、GUI presentation 或 CU-NEXT runner。
- **Deferred L2 single-app artifact**：使用 PowerPoint、Keynote、LibreOffice Impress 或可离线运行的 slide editor 制作一页 PPT/slide，包含任务指定标题和要点，并保存到 `.sciforge/vision-runs/<run-id>/`。验收需要 bundle-local `final-artifact-ref`、保存位置或产物最终可见截图 ref、slide 可见截图 ref、verifier verdict 和 `gui.present` 展示证据。
- **Deferred L3 multi-app workflow**：联合多个 App 完成一个问题，例如 Browser 打开本地资料页或安全网页，Computer Use 读取可见信息并切换到 slide app 制作一页 PPT，再通过 Finder/保存对话框保存，最后由 TUI Host 调用 `gui.present` 展示 artifact refs 和 trace 摘要。CU-NEXT L3 还必须有 task-scoped acceptance manifest，不能用单 App artifact probe 代替。

验收限制：

- 所有用户级任务必须通过 TUI Host -> `computer_use.run_task(request, host_ports)` 进入模块；GUI 只发送 terminal-equivalent text 和展示结果。
- Package-local fixture、single-window probe、single-app probe、semantic fake provider 和 dry-run diagnostic 都不能替代 CU-NEXT L3。Artifact-producing acceptance 必须同时包含 bundle-local `finalArtifactRef` / `finalArtifactRefs`、最终可见产物截图、verifier verdict、当前轮文件证据和 `gui.present` evidence；当 request metadata 设置 `requiresDirectoryEvidence`、`fileListEvidenceRequired`、`acceptance.requiresFileListEvidence` 或同义目录证据 flag 时，package guard 还要求 final observation screenshot ref，以及来自 final observation 或 verifier metadata 的非控制 file-list artifact/data refs。缺任何一项只能返回 `blocked` / `repair-needed` / diagnostic，而不是用户级 `completed`。
- 不允许用 Playwright、DOM、accessibility tree、app-specific private API 或直接文件生成绕过真实 GUI 操作来冒充 Computer Use 成功。
- 真实外部发送、发布、授权、支付、删除或上传不作为默认验收；如必须覆盖，只能走 dry-run 或 `needs-confirmation` / `approvalRequest`。
- 若本机缺少目标 App、系统权限或 shared input policy 阻断，应返回 `blocked` manifest，而不是降级为不可验证的抽象成功。

---

## 6. 失败处理

MVP 不做恢复，遇到以下情况直接返回失败：

- 达到最大步数（30 步）
- Grounding 连续失败 3 次（含重试）
- 连续 5 步屏幕无变化（说明完全卡住了）

返回时附带完整的动作历史和每步截图，供人工分析失败原因。

---

## 7. 完整循环

```
接收任务
  ↓
截图 → 等待稳定 → 生成摘要
  ↓
Completion-only guard 判断当前证据是否完成 ── 是 → 返回 package-level completed（仅当 evidence guards 全部通过）
  ↓ 否
Planner 生成下一步（动作类型 + 目标描述）
  ↓
Grounder coarse 定位 → vision-sense 生成 focus-region → crop 精定位 + 准星验证
  ↓ 失败 → 重试一次 → 仍失败 → 累计3次则返回失败
  ↓ 成功
Executor 执行
  ↓
截图 → 整窗+focus crop 像素级对比 → 记录 verifier feedback
  ↓
追加到动作历史 → 回到开头
```

---

## 8. MVP 刻意不做的事

| 不做的事 | 为什么可以不做 | 什么时候加回来 |
|---------|-------------|-------------|
| Task Contract / Milestone | 线性任务不需要拆分中间目标 | 任务变复杂、需要处理分支流程时 |
| 多候选动作 + Tournament | 单候选在简单场景下够用 | 成功率不够需要竞争选优时 |
| Mental Simulation | 单候选不需要预判排除 | 引入多候选后 |
| Disambiguation | 简单页面很少有严重歧义 | 处理复杂页面、列表、表格时 |
| Grounding Ensemble | 单模型在简单场景下够用 | 单模型 grounding 成功率不够时 |
| 直接调用 GUI | 会破坏 TUI-owned action provider 边界 | 不加回来；只允许 TUI Host 调用 `gui.*` |
| 在模块内部弹确认 UI | 会让 policy owner 和 presentation owner 混在一起 | 不加回来；返回 `approvalRequest`，由 TUI Host 调用 `gui.ask_user` |
| 完整语义级 Post-action 验证 | focus-region 像素变化 + 下一轮 Planner 能覆盖一部分 | 需要及时检测误操作时 |
| Recovery Manager | 线性任务出错直接失败代价不大 | 任务变长、失败恢复比重启便宜时 |
| Interrupt Handler | 干净环境测试不会遇到弹窗 | 进入真实环境时 |
| 高级风险恢复 / 复杂审批 UX | MVP 只保留基础 safety gate；高风险动作默认返回 `needs-confirmation` / `approvalRequest` 且不执行 | 进入真实多轮审批场景时，仍由 TUI Host 调用 `gui.ask_user` |
| Stuck Monitor | max_steps + 连续无变化检测兜底 | 需要更细粒度的卡住检测时 |
| Checkpoint | 没有 milestone 就不需要 checkpoint | 引入 milestone 后 |
| 大规模 Visual Memory 检索 | MVP 只保留 trace refs、focus refs 和 compact feedback | 任务变长、需要跨 run 检索 UI 布局经验时 |

---

## 9. 从 MVP 到完整版的演进路径

**MVP（当前）→ 阶段 2 的触发条件**：MVP 能跑通简单线性任务，但成功率不够高。此时加入多候选 + Mental Simulation + Tournament 提升选择质量，加入 Disambiguation 解决相似元素问题。

**阶段 2 → 阶段 3 的触发条件**：成功率上来了，但任务变复杂（分支、表单、多步骤），失败后需要恢复而非重跑。此时加入 Task Contract / Milestone / Recovery Manager / Checkpoint / Stuck Monitor。

**阶段 3 → 阶段 4 的触发条件**：进入真实环境，遇到弹窗、高风险操作、多应用切换。此时加入 Interrupt Handler / Safety Gate / Grounding Ensemble / Visual Memory。

每个阶段的加入顺序由实际遇到的失败模式驱动，不预先实现。
