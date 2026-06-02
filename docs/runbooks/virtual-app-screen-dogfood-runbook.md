# VirtualAppScreen Dogfood Runbook

最后更新：2026-06-02

本 runbook 用 SciForge 当前产品 UI 验收右侧 `Screen` pane。验收面只能是 SciForge 右栏里的 `VirtualAppScreen`：打开 workspace、进入 `Screen`、确认自动 provision/attach request 经过 package-owned Native Host 或其当前迁移 shim、通过 `InputIntent` 操作 VSCode/editor、人类接管、恢复 agent，并输出 bounded manifest。不得直接调用 provider internals，也不得用 provider URL、旧截图、shell 写文件、noVNC/RDP/VNC、serve-web/code-server/OpenVSCode、第三方虚拟屏幕 UI 或 fixture viewer 代替产品路径。

## 通过标准

- 右侧 `Screen` 打开后，`no-session` 只能是启动前瞬时状态；bounded bootstrap window 后必须进入 `attached`、`observe-only`、`permission-missing`、`adapter-unavailable`、`requires-handoff` 或 `blocked`。
- 自动创建或 attach request 必须来自 SciForge UI/right-pane semantics，例如 `gui.presentRef`、`screenRef`、`targetAppRef`、`adapterReadinessRef`、`handoffRef` 或等价 activation command。
- NativeVirtualAppScreenHost package 或当前迁移 shim 必须是 session/surface owner；manifest 必须记录 `hostSessionRef`、`surfaceOwnerRef`、`displayOwnerRef` 或明确 blocked reason。
- VSCode/editor 操作必须通过右栏 frame 发出的 terminal-equivalent `InputIntent`，并产生当前 run 的 `inputIntentRef`、`executorEventRef`、before/after frame refs 和 verifier/evidence refs。
- 真人输入路径必须是 fire-and-release：host input queue accepted 后立即返回 `inputAcceptedRef` / sequence，不能等待 screenshot/OCR/snapshot/ledger/verifier；后台 evidence 需要随后追上 input/frame sequence。
- 自动化动作必须使用 explicit automation barrier refs；`inputAcceptedRef` 不能单独证明 automation 完成。
- 人类 takeover、pause/resume agent 和 stop 必须通过同一 input lease/control plane，产生 takeover/pause/resume/lease refs；不能移动真实鼠标、抢真实焦点或发送 shared system input。
- manifest 必须 refs-first、有界、可复验；大 payload、frame bytes、provider payload、raw screenshots、raw traces 和 secret 一律写 ref，不内联。

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

## 操作步骤

1. 启动 SciForge workspace，打开或保持右侧结果栏可见。
2. 进入 `Screen` tab，记录 `gui.presentRef`、`screenRef`、默认 `targetAppRef`、`adapterReadinessRef`、`handoffRef` 和 activation command ref。
3. 等待 bounded bootstrap window。若没有 `sessionRef`，记录具体 blocked phase/reason；若有 `sessionRef`，确认 `attachState=attached` 或 `observe-only`，并记录 `liveSurfaceRef`、`frameStreamRef`、`currentFrameRef`。
4. 确认默认目标是低风险 VSCode/editor profile；若产品选择其它 app，manifest 只记录 `targetAppRef`，不硬编码路径。
5. 在右栏 frame 上执行一次非破坏性操作：focus editor/search box、type short public marker、undo 或保存到临时 workspace artifact。该动作必须由 `InputIntent` command 发起。
6. 人类点击 `Take over`，确认 active lease owner 切到 user 或产生 takeover ref；agent queue 必须 pause 或等待。
7. 人类点击 `Resume agent`，确认 resume ref 或 active lease owner 回到 agent；恢复后重新读取 current frame。
8. 输出 bounded manifest，并确认没有 raw screenshot/base64/provider payload/secret。

## Blocked Manifest 必填字段

失败或环境未就绪时也要输出 manifest，且必须包含：

- `phase`: `open-sciforge`、`enter-screen`、`auto-provision-attach`、`operate-vscode-input-intent`、`human-takeover`、`resume-agent` 或 `manifest-output`
- `reason`: 一条短、脱敏、可执行的 blocked reason
- `providerReadiness`: readiness status 和 refs
- `permissionRefs`: permission handoff/recheck refs
- `lastFrameRefs`: last current/before/after/frameStream/liveSurface refs
- `lastInputRefs`: inputIntent/executor/inputLease/takeover/resume refs

## Manifest Skeleton

```json
{
  "schemaVersion": "sciforge.computer-use.virtual-app-screen-dogfood-product.v1",
  "status": "blocked",
  "source": "product-ui-right-pane",
  "runId": "vas-dogfood-YYYY-MM-DD-NN",
  "phase": "auto-provision-attach",
  "reason": "native VirtualDisplayProvider did not attach within bootstrap window",
  "rightPane": {
    "openedSciForge": true,
    "enteredScreen": true,
    "activationRequested": true,
    "attachState": "blocked",
    "screenRef": "virtual-app-screen:...",
    "targetAppRef": "app:profile/vscode-editor",
    "sessionRef": null,
    "guiPresentRefs": ["gui.present:..."]
  },
  "providerReadiness": {
    "status": "blocked",
    "refs": ["computer-use:.../provider-readiness.json"]
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
  "bounded": {
    "refsFirst": true,
    "rawPayloadsCaptured": false,
    "providerInternalsUsed": false,
    "hardcodedPageScreenshotOrUrl": false
  }
}
```

## 收尾检查

1. 确认 `status=passed` 只有在 current run 拥有 UI attach、live frame、InputIntent、human takeover/resume 和 bounded evidence manifest 时出现。
2. 确认 `status=blocked` 带有 phase、reason、provider readiness、permission refs、last frame refs 和 last input refs。
3. 确认 `nativeHost` 字段证明 package-owned Host 或当前迁移 shim 是 session/surface owner；若用了第三方虚拟屏幕软件，只能是 diagnostic/reference，不能通过。
4. 确认证据没有 raw screenshot/base64/provider payload/secret，也没有 provider URL 或 fixture-only pass。
5. 运行：

```bash
npm run smoke:virtual-app-screen-dogfood-product --silent
git diff --check
```
