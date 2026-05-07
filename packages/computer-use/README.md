# SciForge Computer Use

`sciforge-computer-use` 是面向 GUI 任务的 sense-agnostic action loop。它是 action provider，不是 sense。

目标迁移位置是 [`packages/actions/computer-use`](../actions/computer-use/README.md)。当前 `packages/computer-use` 作为兼容路径保留，旧 Python 包名、导入路径和测试入口不变。

## 职责

本包定义稳定 Python contract，用于：

- 通过任意 sense provider 观察目标。
- 规划通用 GUI action。
- 定位视觉或逻辑目标。
- 通过 host adapter 执行动作。
- 验证结果。
- 生成 file-ref-only trace data。

它有意不 import `vision-sense` 或 SciForge TypeScript runtime。`vision-sense` 可以作为 sense provider，但 action loop 同样可以消费 OCR、浏览器沙箱截图、远程桌面帧、窗口元数据，或未来安全的 accessibility summary。

## 核心 Contract

- `ComputerUseRequest`
- `Observation`
- `ActionPlan`
- `ActionTarget`
- `Grounding`
- `ExecutionOutcome`
- `Verification`
- `LoopStep`
- `ComputerUseResult`

## Provider 协议

- `SenseProvider.observe/query/locate`
- `ActionPlanner.plan`
- `GuiExecutor.execute`
- `Verifier.verify`

最小 loop：

```text
observe -> planner -> safety -> locate -> execute -> verify -> trace
```

## 安全边界

高风险动作默认 fail closed：发送、删除、支付、授权、发布、外部提交、覆盖、上传等动作必须由上游显式确认，或进入 human approval / verifier policy。Trace 不内联截图 payload、base64 或大日志，只写 refs、ledger、diagnostics 和紧凑摘要。

## 测试

```bash
python -m pytest packages/computer-use/tests
```
