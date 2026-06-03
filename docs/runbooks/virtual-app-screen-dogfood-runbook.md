# VirtualAppScreen Dogfood Runbook

最后更新：2026-06-03

本 runbook 用 SciForge 当前产品 UI 验收右侧 `Screen` pane。验收面只能是 SciForge 右栏里的 `VirtualAppScreen`：打开 workspace、进入 `Screen`、确认自动 provision/attach request 经过 package-owned Native Host 或其当前迁移 shim、通过 `InputIntent` 操作 VSCode/editor、人类接管、恢复 agent，并输出 bounded manifest。不得直接调用 provider internals，也不得用 provider URL、旧截图、shell 写文件、noVNC/RDP/VNC、serve-web/code-server/OpenVSCode、第三方虚拟屏幕 UI 或 fixture viewer 代替产品路径。

## 通过标准

- 右侧 `Screen` 打开后，`no-session` 只能是启动前瞬时状态；bounded bootstrap window 后必须进入 `attached`、`observe-only`、`permission-missing`、`adapter-unavailable`、`requires-handoff` 或 `blocked`。
- 自动创建或 attach request 必须来自 SciForge UI/right-pane semantics，例如 `gui.presentRef`、`screenRef`、`targetAppRef`、`adapterReadinessRef`、`handoffRef` 或等价 activation command。
- Host-owned preflight/readiness 必须作为一等 refs 传播到 UI、dogfood、presentation viewer 和 runtime manifest：`nativeHostPreflight`、`preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef` 和 `hostReadinessRef`。这些字段只能来自 NativeVirtualAppScreenHost `recordPreflight` / Host ledger；`computer-use:screen-activation/...` 仍只是 UI activation placeholder，不能冒充 Host preflight。
- NativeVirtualAppScreenHost package 或当前迁移 shim 必须是 session/surface owner；当前 dogfood smoke 已读取 `nativeHost.hostSessionRef`、`nativeHost.surfaceOwnerRef`、`nativeHost.displayOwnerRef`、`humanInputHotPath.inputAcceptedRefs`、`automationBarrierRefs` 和 `backgroundEvidenceRefs`。这些字段缺失时只能 blocked，不能作为 passed manifest。
- VSCode/editor 操作必须通过右栏 frame 发出的 terminal-equivalent `InputIntent`，并产生当前 run 的 `inputIntentRef`、`executorEventRef`、before/after frame refs 和 verifier/evidence refs。
- 真人输入路径必须是 fire-and-release：host input queue accepted 后立即返回 `inputAcceptedRef` / sequence，不能等待 screenshot/OCR/snapshot/ledger/verifier；后台 evidence 需要随后追上 input/frame sequence。
- 自动化动作必须使用 explicit automation barrier refs；`inputAcceptedRef` 不能单独证明 automation 完成。
- 人类 takeover、pause/resume agent 和 stop 必须通过同一 input lease/control plane，产生 takeover/pause/resume/lease refs；不能移动真实鼠标、抢真实焦点或发送 shared system input。
- manifest 必须 refs-first、有界、可复验；大 payload、frame bytes、provider payload、raw screenshots、raw traces 和 secret 一律写 ref，不内联。
- `runtimeCommandAcceptance` 必须证明 UI 发出的 `/computer-use screen attach` 或 `/computer-use permission-handoff` 文本能被 runtime parser 接受，并保持 `failClosed=true`、`providerExecuted=false`，避免 smoke 自己绕过产品路径执行 provider internals。
- Word 和 PowerPoint 只能作为 registry-only app profile 经过同一个 `adapter-profile:virtual-app-screen/generic-host-api`；它们不得拥有产品层 app-specific shortcut。它们的 app-profile dogfood 还必须先通过 `SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST` 指向的 VS Code real closed-loop evidence manifest gate；缺 manifest、manifest 不是 `status=passed`、`targetAppProfile` 不是 `vscode-editor`、`diagnosticOnly` 不是 `false`、或缺 Host-owned dogfood/user-acceptance refs 时都必须 blocked。通过该 gate 只表示 sequencing-ready；目标 app 自己的 `launch-spec-ready` preflight 和 same-profile current-run real Host session manifest 必须再通过独立 target pass gate，才能产生 `realDogfoodPassClaim=true`。

## 禁止事项

- 不硬编码当前页面、截图、URL、frame 文件名、provider route、provider 参数、token、Authorization、API key、密码或本机绝对路径。
- 不把 fixture、replay、历史 frame、browser/DOM/Playwright shortcut、shell-only artifact 或 provider probe-only 当成产品通过。
- 不在缺 Screen Recording、Accessibility、Automation、driver/system extension 或 native provider 时继续执行真实输入；必须 fail closed 并输出 blocked manifest。

## 运行命令

默认 smoke 会打开 SciForge UI，进入 `Screen`，并在当前机器无法完成 native attach 时写 blocked manifest。需要保存 manifest 时设置输出路径：

```bash
SCIFORGE_VAS_DOGFOOD_MANIFEST=/tmp/sciforge-vas-dogfood/manifest.json \
npm run smoke:virtual-app-screen-dogfood-product --silent
```

Real-driver smoke 是另一组证据面，只能在明确 opt-in 时手动运行，不进入普通 `verify`，也不能替代上面的 dogfood product smoke。当前主路径只保留 macOS；Linux/Windows 实机 provider pass 已暂缓：

```bash
npm run smoke:virtual-app-screen-macos-real-driver:opt-in --silent
npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent
```

跨平台实机交接当前暂停。以下命令只作为恢复 Linux/Windows 实机验证时的 no-overclaim / handoff 模板；handoff gate 只表示 sequencing-ready，`passClaim=false`，不能声明 Linux/Windows 已通过，当前也不要把这些命令作为验收步骤：

```bash
SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/manual-20260603T0534/manifest.json \
npm run smoke:virtual-app-screen-linux-xpra-real-handoff-gate --silent

SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/manual-20260603T0534/manifest.json \
npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in --silent

SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/manual-20260603T0534/manifest.json \
SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json \
npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent

SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json \
npm run smoke:virtual-app-screen-windows-idd-real-handoff-gate --silent

SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json \
npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in --silent

SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json \
SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST=docs/test-artifacts/virtual-app-screen-real-app-session/windows-idd-real-closed-loop/manifest.json \
npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent
```

Windows opt-in scripts use the cross-platform Node launcher `tools/run-virtual-app-screen-real-opt-in-smoke.ts`; this is a paused/pre-reserved entry for future Windows verification, not a current acceptance step:

```powershell
npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in --silent -- --linux-manifest "docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json"
npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent -- --linux-manifest "docs/test-artifacts/virtual-app-screen-real-app-session/linux-xpra-real-closed-loop/manifest.json" --evidence-manifest "docs/test-artifacts/virtual-app-screen-real-app-session/windows-idd-real-closed-loop/manifest.json"
```

real-human-input opt-in smoke 在完成 attach -> human input -> takeover/pause -> resume 后会写 refs-first `sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1` manifest。可用 `SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST=/path/to/manifest.json` 指定输出路径；不指定时写入 `docs/test-artifacts/virtual-app-screen-real-app-session/<runId>/manifest.json`。随后 dogfood product smoke 可以设置同一个 env var 读取该 manifest，把其中的真实 `dogfoodRefs` 合入 bounded product manifest。只有 manifest status 为 `passed`、`diagnosticOnly=false`，且包含 Host-owned `realHostProviderSessionRef`、`realOptInRunRef`、`realPlatformEvidenceRefs`、`realAgentQueueEvidenceRefs`、current-run pointer 和 minimal replay refs 时，dogfood 才允许 passed；缺失时继续 blocked。

这些 smoke 必须 fail closed。平台、权限、driver、target app/window、frame capture 或 isolated input/control hook 不满足时，结果只能是 blocked/fail-closed evidence，不能升级为 product pass。macOS real-driver smoke 还需要真实 runtime opt-in `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS=1|true|yes|on`，target app 通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_*` 标量变量或 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 指定；macOS real-human-input smoke 还需要 `SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT=1`、`SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER=1` 和 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND`。内置 macOS pid-scoped AX hook 可通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND=npm` 和 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON='["run","virtual-app-screen-macos-pid-scoped-ax-hook","--silent"]'` 接入；它只使用 target pid/window scoped Accessibility action/value/scroll，不使用 CGEvent、System Events keystroke、共享键盘或共享 pointer。macOS 外部 hook 的 `capabilityProbe=true` 调用必须返回安全 `inputAdapterCapability`，正常 input/control 调用必须返回 refs-first evidence 和隔离字段。Linux/Windows 段当前只保留 contract / handoff 入口；恢复实机验证时仍必须证明 agent-owned display、isolated input/control hook、Host-owned refs、`diagnosticOnly=false` evidence 和 Host ledger replay。平台专用 script 只是 opt-in smoke 入口，不能以绿色 npm exit 代表真实 pass。

Word/PowerPoint app-profile dogfood 使用独立 sequencing guard。默认无 VS Code manifest 时应只运行 contract smoke，并保持 blocked：

```bash
node --import tsx --test tests/smoke/virtual-app-screen-app-profile-dogfood-gates.test.ts
npm run smoke:virtual-app-screen-app-profile-preflight --silent
```

app-profile preflight artifact 默认只记录显式注入的 installed-app availability 和 generic Host API launch spec；也可以通过显式 `--probe-local-apps` / `--probe-local-installed-apps` 做本机 installed-app availability 探测。两种入口都只能作为 non-pass sequencing evidence，不能替代真实目标 app 的 current-run dogfood pass：

```bash
SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_WORD_STATUS=unknown \
SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_POWERPOINT_STATUS=unknown \
npm run virtual-app-screen-app-profile-preflight --silent -- \
  --checked-by manual-operator \
  --out docs/test-artifacts/virtual-app-screen-app-profile-preflight/manual/manifest.json
```

```bash
npm run virtual-app-screen-app-profile-preflight --silent -- \
  --probe-local-apps \
  --out docs/test-artifacts/virtual-app-screen-app-profile-preflight/local-probe/manifest.json
```

local probe 只会设置 `appAvailability.status=available|unavailable|unknown`、`checkedBy=local-installed-app-probe/<platform>`、已知 bundle id 和可选 app path/command。即使探测到 Word/PowerPoint 已安装，preflight 最多进入 `launch-spec-ready`；它仍保持 `realDogfoodPassClaim=false`，不能进入 `status=passed`，且目标 app pass gate 仍必须读取同一 profile 的 current-run real Host session manifest。preflight artifact 还会输出 `realRunCommandTemplates[]`，用于把 `launch-spec-ready` profile 转成 macOS real-human-input opt-in smoke 命令；模板本身仍是 sequencing evidence，不是 pass evidence。Office 模板必须通过 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON` 使用 `/usr/bin/open` + `args: ["-b", bundleId, targetFile]`，不能同时设置 top-level `bundleId` 或 `appPath`；目标文件当前为 `tests/fixtures/virtual-app-screen-app-profile-target-documents/word-current-run.docx` 与 `tests/fixtures/virtual-app-screen-app-profile-target-documents/powerpoint-current-run.pptx`。模板还必须设置 `editableWindowReadiness`（AX window、非空 title、editable surface evidence、拒绝 shell/auth/protected/read-only 标题）以及 `SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS=45000`，避免 Office 冷启动窗口慢于默认等待。

若要开始这些 app 的真实 dogfood，先设置 `SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST` 指向 `targetAppProfile=vscode-editor`、`status=passed`、`diagnosticOnly=false`、`validation.ok=true`、`validation.missing=[]`、refs-first 且含 Host-owned dogfood/user-acceptance refs 的 real closed-loop manifest。该 guard 通过后仍只是 sequencing-ready，不能替代目标 app 自己的 attach/input/takeover/resume evidence manifest。目标 app 的 manifest 必须来自同一个目标 profile 的 current run，例如 `targetAppProfile=word` 必须同时有 `dogfoodRefs.targetAppRef=app:profile/word`、Host-owned current-run pointer、`dogfoodRefs.evidenceLedgerRef`、real platform refs、agent queue refs、input refs、automation barrier refs、background refs 和 real user-acceptance claim；`dogfoodRefs.realPlatformEvidenceRefs` 必须包含同一个 ledger，`dogfoodRefs.minimalEvidenceReplayRefs` 必须落在该 ledger 的 `/events/` 下，且 manifest 任意字符串不得引用 fixture/mock/snapshot/replay evidence。不能复用 VS Code manifest 或其它 target 的 manifest 来声明 pass。当前仓库的 macOS 证据已包含 `word-current-run/manifest.json` 和 `powerpoint-current-run/manifest.json`，但任何新机器或新 profile 仍必须重新生成 same-profile current-run manifest 并通过目标专用 pass gate。

目标 app 自己的 pass gate 是独立入口，必须同时读取 VS Code sequencing manifest、该 profile 的 `launch-spec-ready` preflight manifest、以及同一目标 profile 的 current-run real Host session manifest。`--preflight-manifest` 可以是单个 profile preflight manifest，也可以是 batch preflight artifact；CLI 会按 `--profile` 选择内层 `preflights[]`。当前 Word/PowerPoint pass 口径只接受 `platformProvider=macos`；Linux/Windows manifest 在 P2.1 暂缓期间必须 blocked，不能生成 pass claim。只有三者都匹配、三个 evidence refs 都存在、real Host session manifest 通过 validation/ledger/fixture-mock-snapshot-replay 复验时才允许 `realDogfoodPassClaim=true`：

```bash
npm run virtual-app-screen-app-profile-target-dogfood-gate --silent -- \
  --profile word \
  --vscode-manifest docs/test-artifacts/virtual-app-screen-real-app-session/manual-20260603T0534/manifest.json \
  --preflight-manifest docs/test-artifacts/virtual-app-screen-app-profile-preflight/local-probe/manifest.json \
  --target-manifest docs/test-artifacts/virtual-app-screen-real-app-session/word-current-run/manifest.json
```

PowerPoint 使用同一个入口和约束，只把 `--profile word` / `word-current-run` 换成 `--profile powerpoint` / `powerpoint-current-run`。本机当前证据中 Word 和 PowerPoint 两条 target gate 都已通过；这不改变 Linux/Windows 实机 provider pass 暂缓口径，也不能替代其它 app profile 的 same-profile current-run evidence。

## 操作步骤

1. 启动 SciForge workspace，打开或保持右侧结果栏可见。
2. 进入 `Screen` tab，记录 `gui.presentRef`、`screenRef`、默认 `targetAppRef`、`adapterReadinessRef`、`handoffRef` 和 activation command ref。
3. 等待 bounded bootstrap window。若没有 `sessionRef`，记录具体 blocked phase/reason；若有 `sessionRef`，确认 `attachState=attached` 或 `observe-only`，并记录 `liveSurfaceRef`、`frameStreamRef`、`currentFrameRef`。
4. 确认默认目标是低风险 VSCode/editor profile；若产品选择其它 app，manifest 只记录 `targetAppRef`，不硬编码路径。
   - 若目标是 Word 或 PowerPoint，先确认 profile resolution 仍使用 `adapter-profile:virtual-app-screen/generic-host-api`，并确认 app-profile dogfood gate 没有把 sequencing-ready 当成真实 pass。
5. 在右栏 frame 上执行一次非破坏性操作：focus editor/search box、type short public marker、undo 或保存到临时 workspace artifact。该动作必须由 `InputIntent` command 发起。
6. 人类点击 `Take over`，确认 active lease owner 切到 user 或产生 takeover ref；agent queue 必须 pause 或等待。
7. 人类点击 `Resume agent`，确认 resume ref 或 active lease owner 回到 agent；恢复后重新读取 current frame。
8. 输出 bounded manifest，并确认没有 raw screenshot/base64/provider payload/secret。

## Blocked Manifest 必填字段

失败或环境未就绪时也要输出 manifest，且必须包含：

- `phase`: `open-sciforge`、`enter-screen`、`auto-provision-attach`、`operate-vscode-input-intent`、`human-takeover`、`resume-agent` 或 `manifest-output`
- `reason`: 一条短、脱敏、可执行的 blocked reason
- `rightPane`: Screen UI 是否打开、是否进入 Screen、是否发起 activation、当前 attach/status/surface state 和核心 refs
- `runtimeCommandAcceptance`: terminal-equivalent command 是否被观察、解析到的 route/source/refs，以及 fail-closed provider execution policy
- `providerReadiness`: readiness status 和 refs
- `nativeHostPreflight`: Host-owned preflight summary，以及 `preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef`、`hostReadinessRef`
- `permissionRefs`: permission handoff/recheck refs
- `lastFrameRefs`: last current/before/after/frameStream/liveSurface refs
- `lastInputRefs`: inputIntent/executor/inputLease/takeover/resume refs
- `nativeHost`: Host package/session/surface/display/grant fields；blocked manifest 可为空，但 `passed` 必须有 Host-owned refs。
- `humanInputHotPath`: fire-and-release mode、input accepted refs 和后台 evidence catch-up 状态；blocked manifest 可为空。
- `automationBarrierRefs` 和 `backgroundEvidenceRefs`: blocked manifest 可为空，但 `passed` 必须有当前 run refs。
- `bounded`: refs-first、无 raw payload、无 provider internals、无硬编码页面/截图/URL、无 shared system input

## Manifest Skeleton

```json
{
  "schemaVersion": "sciforge.computer-use.virtual-app-screen-dogfood-product.v1",
  "status": "blocked",
  "source": "product-ui-right-pane",
  "runId": "vas-dogfood-YYYY-MM-DD-NN",
  "observedAt": "2026-06-02T00:00:00.000Z",
  "phase": "auto-provision-attach",
  "reason": "native VirtualDisplayProvider did not attach within bootstrap window",
  "rightPane": {
    "openedSciForge": true,
    "enteredScreen": true,
    "activationRequested": true,
    "attachState": "blocked",
    "status": "blocked",
    "surfaceMode": "empty",
    "screenRef": "virtual-app-screen:...",
    "targetAppRef": "app:profile/vscode-editor",
    "targetWindowRef": null,
    "sessionRef": null,
    "guiPresentRefs": ["gui.present:..."],
    "activationCommandRefs": ["computer-use:screen-activation/.../attach-request.json"]
  },
  "runtimeCommandAcceptance": {
    "commandObserved": true,
    "parsed": true,
    "route": "virtual-app-screen-screen-attach",
    "source": "right-pane-screen",
    "screenRef": "virtual-app-screen:...",
    "targetAppRef": "app:profile/vscode-editor",
    "adapterReadinessRef": "computer-use:screen-activation/.../provider-readiness.json",
    "activationRef": "computer-use:screen-activation/.../attach-request.json",
    "targetRef": "computer-use:screen-activation/.../attach-request.json",
    "failClosed": true,
    "providerExecuted": false,
    "reason": null
  },
  "providerReadiness": {
    "status": "blocked",
    "refs": ["computer-use:.../provider-readiness.json"]
  },
  "nativeHostPreflight": {
    "status": "blocked",
    "preflightRef": "computer-use:native-host/.../preflight.json",
    "preflightLedgerRef": "computer-use:native-host/.../preflight-ledger.json",
    "preflightLedgerEntryRef": "computer-use:native-host/.../ledger-entry-preflight-recorded.json",
    "hostReadinessRef": "computer-use:native-host/.../host-readiness.json",
    "uiActivationPlaceholderRefs": ["computer-use:screen-activation/.../attach-request.json"]
  },
  "nativeHost": {
    "packageRef": "packages/actions/computer-use/virtual-app-screen-host",
    "hostSessionRef": null,
    "surfaceOwnerRef": null,
    "displayOwnerRef": null,
    "hostBridgeGrantValidated": false,
    "diagnosticThirdPartySurfaceUsed": false
  },
  "humanInputHotPath": {
    "mode": "fire-and-release",
    "inputAcceptedRefs": [],
    "returnedBeforeEvidenceComplete": false
  },
  "automationBarrierRefs": [],
  "backgroundEvidenceRefs": [],
  "permissionRefs": [],
  "lastFrameRefs": [],
  "lastInputRefs": [],
  "vscodeOperation": {
    "attemptedViaInputIntent": false,
    "commandRefs": [],
    "completed": false
  },
  "humanIntervention": {
    "takeoverAttempted": false,
    "resumeAttempted": false,
    "takeoverRefs": [],
    "resumeRefs": [],
    "completed": false
  },
  "bounded": {
    "refsFirst": true,
    "rawPayloadsCaptured": false,
    "providerInternalsUsed": false,
    "hardcodedPageScreenshotOrUrl": false,
    "sharedSystemInputUsed": false
  }
}
```

## Native Host Gate 字段

当前 non-opt-in smoke 只验证 contract shape gate；以下字段同时也是 real pass prerequisite fields，但不能替代真实平台 opt-in evidence：

- `nativeHost`: `packageRef`、`hostSessionRef`、`surfaceOwnerRef`、`displayOwnerRef`、`hostBridgeGrantValidated`、`diagnosticThirdPartySurfaceUsed`
- `nativeHostPreflight`: `nativeHostPreflight` summary、`preflightRef`、`preflightLedgerRef`、`preflightLedgerEntryRef`、`hostReadinessRef`
- `humanInputHotPath`: `mode=fire-and-release`、`inputAcceptedRefs`、`returnedBeforeEvidenceComplete`
- `automationBarrierRefs`
- `backgroundEvidenceRefs`

这些字段不是 user-level pass 的替代条件，而是 fail-closed contract gate：Host-shaped refs 只能证明 public refs/ledger owner 正确。`status=passed` 还必须同时拥有真实 Host provider opt-in evidence，包括 `diagnosticOnly=false`、real Host provider session ref、current-run pointer、最小 Host ledger replay refs、live transport、hot-path input、automation barrier 和 takeover/resume。真实平台 provider 的 opt-in evidence 尚未完成时，manifest 必须保持 `status=blocked`，即使 contract shape 字段完整也只能证明“不假成功”。

`computer-use:screen-activation/...` refs 可以出现在 `rightPane.activationCommandRefs`、`runtimeCommandAcceptance.activationRef` 或 `nativeHostPreflight.uiActivationPlaceholderRefs` 中，只说明产品 UI 发起过 activation。它们不是 Host-owned `preflightRef` / `preflightLedgerRef` / `preflightLedgerEntryRef` / `hostReadinessRef`，也不能用来声明真实平台 `diagnosticOnly=false` user-level pass。

## App Profile Sequencing Gate

P2.3 app profile dogfood 对 Word 和 PowerPoint 使用 fail-closed sequencing gate：

- profile resolver 必须把这两个 app 解析到同一个 `adapter-profile:virtual-app-screen/generic-host-api`。
- 退役目标 app id（`obsidian`、`slack`、`chrome-remote-desktop`）以及 `doc`、`deck`、`slides` 等 artifact shortcut alias 必须 blocked，不能绕过 profile registry。
- gate 缺少 `SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST` 对应的 VS Code real closed-loop manifest 时必须 blocked。
- manifest 必须是 `sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1`、`status=passed`、`targetAppProfile=vscode-editor`、`diagnosticOnly=false`、`refsFirst=true`、`validation.ok=true`、`validation.missing=[]`，且 `dogfoodRefs` / `userAcceptanceInput.evidenceClaims` 都包含 Host-owned real evidence refs。
- VS Code gate 通过只产生 sequencing-ready，且 `realDogfoodPassClaim=false`。
- app-profile preflight manifest 和目标 app current-run manifest 在 sequencing gate 内都只能产生 non-pass sequencing evidence；`realDogfoodPassClaim` 必须保持 `false`。Word 或 PowerPoint 不能互相借用 manifest，也不能复用 VS Code manifest 声明目标 pass；独立目标 pass gate 还要求同一 Host ledger 的 current-run replay refs，并拒绝 fixture/mock/snapshot/replay-shaped evidence。

## 收尾检查

1. 确认 `status=passed` 只有在 current run 拥有 UI attach、Host-owned native refs、真实 Host provider opt-in evidence、`diagnosticOnly=false`、live frame、InputIntent、human takeover/resume、automation barrier 和 bounded evidence manifest 时出现。
2. 确认 `status=blocked` 带有 phase、reason、provider readiness、permission refs、last frame refs 和 last input refs。
3. 确认 `runtimeCommandAcceptance` 证明产品 UI 发出的 terminal-equivalent route 被解析，且 `providerExecuted=false`；若要证明 package-owned Host session/surface owner，必须通过 refs/ledger 附加 evidence，不能直接调用 provider internals。
4. 确认证据没有 raw screenshot/base64/provider payload/secret，也没有 provider URL 或 fixture-only pass。
5. 运行：

```bash
npm run smoke:virtual-app-screen-dogfood-product --silent
git diff --check
```
