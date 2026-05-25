# Computer Use Action Provider

本目录是 Computer Use 的唯一 action provider 真相源，包含 provider manifest、Python action loop、contract、safety gate、trace helper 和 pytest。

Python 包名继续是 `sciforge_computer_use`，方便旧代码和人类开发者保持稳定 import；物理目录已收敛到 `packages/actions/computer-use`。

## 边界

- Computer Use 是 action provider，不是 sense。
- Computer Use 是 TUI-owned extension，只直接和 TUI Host 通信；GUI 参与展示或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`。
- 它可以消费 `packages/observe/vision` 的 observation、OCR、focus region、KV-Ground/visual grounding 和 verifier feedback。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径；`vision-sense` 不拥有 executor、scheduler、desktop bridge 或完成判断。
- 它只执行通用 GUI action schema，并输出可验证 trace。
- `src/runtime` 是 SciForge Host adapter：`GatewayRequest` 转换、host ports、`ToolPayload` 包装、runtime event 接入，以及当前尚未迁出的 macOS 截图/输入/文件 IO host implementation。通用窗口目标契约、scheduler lease policy、executor adapter contract、trace handoff、action schema、planner/text policy、capture/OCR/visible text observation 的剩余迁移项登记在 `docs/native-extension-ownership-map.json` 的 `computer-use.remainingMigrationSubtasks`。
- `provider-policy.ts` 记录稳定 host-port schema、display/target-window capture provider、executor provider、trace writer、event port 和 trace handoff target 命名；Host adapter 只实现这些命名后的平台端口。

## 对外交互

Computer Use 对外只暴露窄接口：

```text
getManifest()
runTask(request, hostPorts)
validateTrace(traceRef)
compactResult(result)
```

`hostPorts` 是模块和平台能力的唯一接触面，负责截图、裁剪、桌面/远程/dry-run 执行、trace 写入和事件上报。高风险动作不在模块内部弹 UI；模块返回 `needs-confirmation`、`approvalRequest`、trace refs 或 audit refs，由 TUI Host 决定是否调用 `gui.ask_user`，确认后再发起新的受控调用。

稳定 host-port 命名来自 `provider-policy.ts`：`display-capture` / `target-window-capture`、`host-focus-region-crop`、`<desktopPlatform>-host-port-executor`、`<desktopPlatform>-generic-gui-executor`、`workspace-file-ref-trace-writer` 和 `workspace-runtime-events`。Trace handoff 目标固定为 `computer-use.trace-summary` 与 `computer-use.approval-request`，payload 只允许 refs 和 compact summary。

迁移期的边界规则是：package 拥有 contract、loop、safety gate、trace handoff 名称和通用策略；`src/runtime` 只能在登记的迁移项完成前保留具体 host-port implementation，例如 macOS `screencapture`、Swift/AppleScript/shared-input executor、workspace 文件写入和 runtime event transport。新增 Computer Use 通用策略必须进入 package 或 observe provider，不能继续加厚 `src/runtime/computer-use`。

进程边界下，TUI Host 可以通过 JSON CLI 调用同一个 package loop：

```bash
python -m sciforge_computer_use --request-json '{"task":"click visible search box"}' --host-port-stdio
```

`--host-port-stdio` 使用 JSONL 协议：package 在 stdout 发出 `hostPortCall`，Host 在 stdin 返回 `hostPortResult`，最终输出 `finalResult`。这让 `run_task(request, hostPorts)` 仍然拥有 action loop，同时截图、planner、grounder、executor、verifier、trace writer 和 runtime event 仍由 TUI Host 注入。fixture 模式只用于 package tests 和 dry-run diagnostics，不能作为真实 Computer Use 成功证据。

稳定 request/result schema 是：

- `ComputerUseRequest.schema_version = sciforge.computer-use.request.v1`
- `ComputerUseRequest.approval_ref` 绑定上游确认；仅设置 `risk_policy=allow-confirmed` 不足以执行高风险动作。
- `ComputerUseRequest.providers` 记录 TUI Host 注入的 sense、grounder、executor 和 verifier provider id。
- `ComputerUseResult.schema_version = sciforge.computer-use.result.v1`
- `ComputerUseResult.approval_request` 是 refs-first confirmation intent；它不是 GUI 调用。

Planner contract 是一轮只输出一个 generic action 或 `done=true`。Planner 输出坐标、app-private shortcut、unsupported action 或空 action 时，package 直接返回 structured failure；坐标必须来自 Grounder。

## KV-Ground、输入与 trace

KV-Ground 是 Grounder provider，不是 planner 或 executor。默认本地 endpoint 是 `http://127.0.0.1:18081`；TUI Host 或 host adapter 应在运行前记录实际 endpoint，并保存 `/health` 和至少一次 `/predict/` smoke 的摘要。`/predict/` 输入只包含 screenshot ref 或 inline upload 后的图像 payload 加 target description；输出进入 window-local 或 crop-local coordinates、confidence/raw text 和 diagnostics。

默认上传策略是 inline image upload：

```bash
export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="inline"
```

只有明确配置共享路径映射时才传服务端可读 `image_path`；否则本机截图路径会在 KV-Ground 服务侧变成 `image_path not found`。Computer Use trace 可以记录截图 ref、focus crop ref、sha256、尺寸、target description、window/crop-local coordinates、provider metadata、executor lease、verifier verdict、approval/audit refs 和 diagnostics，但不得保存 raw screenshot payload、`data:image`、base64 或大日志。

真实桌面输入优先使用独立 input adapter。当前 `remote-desktop` 只有在 Host 注册 `sciforge-simulated-remote-desktop` provider 时才可执行；该路径维护虚拟 pointer/keyboard state refs，不移动系统鼠标、不发送全局系统键盘事件。未注册 provider 的 `remote-desktop` / `virtual-hid` 会 fail closed。没有独立 adapter 时，鼠标键盘属于 shared system input，必须绑定低风险目标窗口、串行持有 executor lease，并在 request/result 中显式记录 acknowledgement 或 blocked reason。

## 验收边界

真实输入 smoke 只证明基础链路可用，不等于用户级成功。Computer Use 的最终验收至少需要一个可见用户产物，例如用可用的 slide app 制作并保存一页 PPT；目标打通需要一个多 App 工作流，例如 Browser/资料页 -> slide app -> Finder/保存对话框 -> TUI Host `gui.present` 展示 artifact refs 和 trace refs。

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
