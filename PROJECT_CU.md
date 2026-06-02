# SciForge Computer Use 项目协议

最后更新：2026-06-02

当前目标是把 Computer Use 做成 SciForge 的一等产品能力：用户在工作区内可以打开、观察、接管、暂停、恢复并复盘真实应用。现在的推进顺序必须先收敛到一个真实可用的最小闭环，再处理权限预检、跨平台、质量、dogfood 和周边扩展。

## 优先级原则

- **先最小闭环，再周边完整性**：先让一个真实 app session 跑通 create -> observe -> human input -> pause/resume -> evidence；之后再补跨平台、长会话、流质量和完整 dogfood。
- **先产品路径，再诊断路径**：产品 live path 必须走 package-owned Native Host。第三方 VNC、noVNC、Xvfb、xpra、Playwright、Electron 等只能作为诊断、兼容、测试或 fallback adapter。
- **先真实执行，再漂亮展示**：UI 只展示 Host 已证明的 session/surface/frame/input/evidence。缺权限、缺驱动、缺 provider、缺 evidence 时必须 fail closed。
- **先一条清晰链路，再多场景泛化**：先选一个 app profile 和一个平台完成闭环；确认 contract 后再扩到 Linux/Windows、多窗口、多屏、更多 app。
- **先 refs，后内联**：大图、帧、日志、payload、证据文件必须先落到可追踪引用，再由 UI 或 agent 消费。
- **同一事实只归一个源头**：session、surface、frame、permission、handoff、provider readiness、ledger hash 都必须有唯一 owner。

## 模块边界

- 前端入口：`apps/desktop-app`。
- Computer Use 模块边界：`packages/actions/computer-use`。
- VirtualAppScreen 产品宿主：`packages/actions/computer-use/virtual-app-screen-host`。
- `apps/desktop-app` 只负责编排和展示，不直接拥有 native screen 的事实源。
- App profile、provider、permission、handoff、evidence、agent barrier 必须归入 Computer Use 模块的稳定契约。
- 平台差异只能藏在 host/provider adapter 内，不能分叉产品逻辑。

## 最小闭环定义

最小闭环只要求先跑通一个真实平台、一个真实 app、一个真实 session。完成标准：

1. Screen tab 触发 Native Host create/launch/attach/readFrame。
2. UI 观察同一个 Host-owned `sessionRef`、`liveSurfaceRef`、`frameStreamRef`、`currentFrameRef`。
3. 用户输入从右侧 Screen pane 发出，经过 Host `sendHumanInput`，真实打到目标 app session，而不是用户物理桌面。
4. takeover/pause 能停止 agent 后续自动化输入；resume 必须经过 readiness/barrier。
5. session ledger 至少包含 `session.created`、`app.launched`、`surface.attached`、`grant.validated`、`frame.read`、`human-input.accepted`。
6. 缺权限或驱动时呈现 blocked/handoff 状态，不展示伪 live。
7. 一条 focused smoke 能证明以上链路，且失败时能指出缺的是平台条件还是代码能力。

## 当前基线

以下内容已经作为基础能力存在，后续任务不应重复实现：

- `virtual-app-screen-host` package 边界、capability manifest、public API、fail-closed in-memory host、error taxonomy、refs-first ledger/hash-chain validator。
- 产品 attach 的 public session/surface/frame/grant/owner refs 已收敛为 `computer-use:native-host/...`；provider lifecycle refs 只能作为 Host evidence/ledger 关联。
- runtime attach 成功后会记录同一个 Host session binding；InputIntent bootstrap 会先让 source-specific product executor 优先，再尝试 current-session Host binding，最后才走 provider fallback。
- Host `sendHumanInput` / `executeAutomationIntent` 已能通过 provider `sendInputIntent` gate，要求 `rawPayloadWritten=false`、`providerExecuted=true`、`mutatingActionExecuted=true` 和 session/inputLease/actionAdapter/readiness/evidence/before-after/verification refs 一致。
- Host `pauseAgent` / `resumeAgent` / `closeSession` 已能通过 provider control hooks gate，要求 `agentQueueRef`、resume `currentFrameRefreshRef`、stop `safeStopRef` 和 resume 后 `readFrame` evidence。
- Existing-session permission handoff/recheck 已能写 Host ledger；Host resume 在 handoff 后要求更新的 recheck barrier。
- viewer/runtime grant validation 已阻止未验证 Host grant 进入 live。
- dogfood smoke 已把 `nativeHost`、`humanInputHotPath`、`automationBarrierRefs`、`backgroundEvidenceRefs` 纳入 passed gate。

这些只证明 contract、Host-owned refs、Host binding/provider-input/control gate、existing-session permission ledger 和 fail-closed 路线对齐；不代表真实平台 `diagnosticOnly=false` user-level pass 已经完成。

## P0：先做最小产品闭环

- [ ] **P0.1 真实 Host attach 默认路径**
  - [ ] Screen tab bootstrap 默认选择 Native Host 产品路径，而不是只生成 blocked artifact。
  - [ ] 一个真实 platform adapter 返回 `diagnosticOnly=false` 的 session/surface/frame/input/evidence refs。
  - [ ] runtime 用 Host validator 复验 create/launch/attach/readFrame/current-run consistency。
  - [ ] 缺 adapter、权限或 driver 时继续 fail closed，并输出明确 blocked reason。

- [ ] **P0.2 真实 app observe**
  - [ ] 选择一个首个 app profile，优先 `vscode-editor` 或最小通用 workbench。
  - [ ] Native Host 启动/接入该 app，并拿到真实 target window/surface。
  - [ ] Screen pane 渲染同一个 Host-owned live surface 或 native frame stream。
  - [ ] UI 不允许仅凭 provider lifecycle refs、fixture refs、replay refs 进入 live。

- [ ] **P0.3 真人输入热路径**
  - [ ] 右侧 Screen pane 的 click/type/scroll 通过 Host `sendHumanInput` 到目标 app session。
  - [ ] 真实 platform hook 证明输入没有打到用户物理桌面。
  - [ ] ledger 写入 `human-input.accepted`，并能关联 before/current frame refs。
  - [ ] 输入失败时保持 blocked，不伪造 executed。

- [ ] **P0.4 接管、暂停、恢复**
  - [ ] takeover/pause 连接真实 agent queue，使用户输入优先。
  - [ ] resume 必须等待 readiness/barrier，并在 handoff 后要求新的 permission recheck。
  - [ ] safe stop 阻止后续自动化输入落入已接管 session。
  - [ ] 这一阶段只要求同一 session 内闭环，不要求多 session 或跨进程恢复。

- [ ] **P0.5 最小 evidence replay**
  - [ ] Host ledger 串起 frame、grant、human input、pause/resume events。
  - [ ] current-run pointer 由 Host 写入，并由 runtime/dogfood 复验。
  - [ ] 一条 smoke 能从 ledger 复盘 create -> observe -> human input -> resume 的关键 refs。

## P1：最小闭环后的硬化

- [ ] **P1.1 权限 preflight**
  - [ ] 无 attached session 时也能由 Host-owned preflight 记录 platform permission、driver readiness、provider readiness。
  - [ ] 用户完成授权后的 re-probe/recheck 进入 Host ledger。
  - [ ] 真实 adapter resume 证明 readiness 已恢复，而不是只记录 UI recheck command。

- [ ] **P1.2 右侧 live binding 稳定性**
  - [ ] 多窗口、多屏、tab switch、workspace restore 保持稳定 surface identity。
  - [ ] reconnect 只复验已有 Host/provider session，不偷偷 create/launch 新 session。
  - [ ] blocked、permission、handoff、live、replay、fallback 状态互斥且可解释。

- [ ] **P1.3 Contract 和 dogfood 对齐**
  - [ ] manifest、runbook、smoke evidence 与真实 Host provider 能力同步。
  - [ ] dogfood manifest 至少覆盖一次真实 app 会话。
  - [ ] 文档不能声称 user-level pass 领先于实际 smoke。

## P2：扩展和体验质量

- [ ] **P2.1 跨平台**
  - [ ] macOS 最小闭环稳定后，再接 Linux provider。
  - [ ] Linux 稳定后，再接 Windows provider。
  - [ ] 平台差异只进入 adapter，不进入 UI 或产品分支。

- [ ] **P2.2 Stream quality**
  - [ ] 评估 native surface、WebRTC、WebCodecs、MJPEG/PNG delta 等传输选型。
  - [ ] 记录 latency、framerate、input-to-frame 延迟、reconnect 时间。
  - [ ] 高延迟时 UI 降级为 clearly marked fallback，而不是伪装 live。

- [ ] **P2.3 更多 app profile**
  - [ ] VS Code 闭环稳定后再接 Obsidian、Slack、Chrome Remote Desktop 等 app-specific profile。
  - [ ] 每个 profile 必须复用同一 Host API，不引入 app-specific 产品捷径。

## 暂缓事项

以下内容必须等最小闭环完成后再做：

- 云端远程桌面或多租户 host pool。
- 高级视频编码、远程音频、剪贴板同步、文件拖放。
- 长期自动修复权限与驱动安装器。
- 大规模跨平台 dogfood 矩阵。

## 验证规则

每次修改都至少执行与改动相关的验证：

- 文档和 JSON：
  - `git diff --check`
  - 相关 JSON parse 或 schema 校验。
- Native Host contract：
  - `npm run smoke:virtual-app-screen-native-host --silent`
  - `npm run smoke:native-extension-ownership --silent`
- Viewer/runtime：
  - `npm run smoke:computer-use-viewer --silent`
  - `npm run smoke:virtual-app-screen-dogfood-product --silent`
- Native provider / real app：
  - host API smoke。
  - platform adapter smoke。
  - session ledger/hash/current-run validator。
  - 至少一个真实 app profile 的 attach/readFrame/sendHumanInput 验证。
- UI 变更：
  - 启动对应 dev server。
  - 使用 in-app Browser 或 Playwright 截图验证真实状态。

若验证因平台权限、驱动或 sandbox 不可用而失败，必须保留 fail-closed evidence，并说明缺失的是平台条件还是代码能力。

## 必读文档

- `docs/VirtualAppScreenNativeHost.md`
- `docs/VirtualAppScreenArchitecture.md`
- `docs/NativeExtensionOwnershipMap.md`
- `docs/runbooks/virtual-app-screen-dogfood-runbook.md`
- `packages/actions/computer-use/README.md`
- `packages/actions/computer-use/virtual-app-screen-host/README.md`
