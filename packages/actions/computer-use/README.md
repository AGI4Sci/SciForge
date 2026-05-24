# Computer Use Action Provider

本目录是 Computer Use 的唯一 action provider 真相源，包含 provider manifest、Python action loop、contract、safety gate、trace helper 和 pytest。

Python 包名继续是 `sciforge_computer_use`，方便旧代码和人类开发者保持稳定 import；物理目录已收敛到 `packages/actions/computer-use`。

## 边界

- Computer Use 是 action provider，不是 sense。
- Computer Use 是 TUI-owned extension，只直接和 TUI Host 通信；GUI 参与展示或确认时，由 TUI Host 调用 `gui.present` / `gui.ask_user`。
- 它可以消费 vision、OCR、窗口元数据、远程桌面帧等 sense 输出。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径。
- 它只执行通用 GUI action schema，并输出可验证 trace。
- `src/runtime` 只负责 SciForge Host adapter、`GatewayRequest` 转换、host ports、`ToolPayload` 包装和 runtime event 接入；通用窗口绑定、host bridge、scheduler、executor 和 trace contract 应收敛到本 package。

## 对外交互

Computer Use 对外只暴露窄接口：

```text
getManifest()
runTask(request, hostPorts)
validateTrace(traceRef)
compactResult(result)
```

`hostPorts` 是模块和平台能力的唯一接触面，负责截图、裁剪、桌面/远程/dry-run 执行、trace 写入和事件上报。高风险动作不在模块内部弹 UI；模块返回 `needs-confirmation`、`approvalRequest`、trace refs 或 audit refs，由 TUI Host 决定是否调用 `gui.ask_user`，确认后再发起新的受控调用。

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
