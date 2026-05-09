# Computer Use Action Provider

本目录是 Computer Use 的唯一 action provider 真相源，包含 provider manifest、Python action loop、contract、safety gate、trace helper 和 pytest。

Python 包名继续是 `sciforge_computer_use`，方便旧代码和人类开发者保持稳定 import；物理目录已收敛到 `packages/actions/computer-use`。

## 边界

- Computer Use 是 action provider，不是 sense。
- 它可以消费 vision、OCR、窗口元数据、远程桌面帧等 sense 输出。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径。
- 它只执行通用 GUI action schema，并输出可验证 trace。
- `src/runtime/computer-use` 只负责 SciForge Gateway adapter、窗口绑定、host bridge 和 runtime event 接入，不复制 Python action loop。

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
