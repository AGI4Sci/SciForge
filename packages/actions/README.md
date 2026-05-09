# SciForge Actions

`packages/actions` 存放会改变外部环境的通用 action provider contract。Action provider 可以操作 GUI、浏览器沙箱、远程桌面、文件系统、notebook/kernel、外部 API 或未来实验设备；它们不是 UI renderer，也不承载 `ui-components`。

Action 的职责是把 agent 选定的动作计划安全地作用到目标环境，并产出可验证 trace。它不负责领域推理，也不应该把当前案例的业务流程写死在 provider 内部。

## Provider 必需声明

每个 action provider 至少提供一个 `action-provider.manifest.json`，并符合 [`action-provider.manifest.schema.json`](action-provider.manifest.schema.json)。

必需字段：

- `id`、`version`、`kind=action`、`displayName`、`summary`。
- `actionSchema`：provider 接收的动作输入 schema，必须是通用动作形状，不写当前场景专用字段。
- `environmentTargets`：动作会影响哪些环境，例如 window、browser、filesystem、kernel、remote-desktop、external-api、lab-instrument。
- `safetyGates`：风险等级、默认策略、禁止动作、dry-run/preview 能力和 high-risk fail closed 规则。
- `confirmationRules`：哪些动作必须显式确认，确认证据如何传入 runtime request。
- `traceContract`：trace schema、ref-only 大数据策略、事件类型、脱敏和保留规则。
- `verifierContract`：默认 verifier、强制验证条件、验证输入输出 contract。
- `failureModes`：结构化失败原因、可恢复性和推荐修复动作。

## 目录建议

```text
packages/actions/
  action-provider.manifest.schema.json
  README.md
  examples/
    generic-window-action.manifest.json
  computer-use/
    README.md
    action-provider.manifest.json
    pyproject.toml
    sciforge_computer_use/
    tests/
```

Provider 实现可以是 Python、TypeScript、MCP server 或外部 adapter。manifest 只描述稳定边界；运行时 broker 可以先读取 manifest 生成紧凑 capability brief，只有真正选中 provider 后再加载更详细的实现文档。

## 安全原则

- 高风险 action 默认 `fail-closed`，除非上游 request 带有显式 approval policy。
- action provider 自报成功不能替代 verifier；高风险或有外部副作用的结果必须进入 verification policy。
- trace 不内联截图、base64、原始日志或大 payload；使用 artifact refs 和 compact summary。
- provider 不得依赖 UI component 的内部 React 实现；如果需要操作 UI，只能通过目标环境 contract、可见 affordance、object refs、截图或 accessibility/DOM 等稳定观察输入。
- 迁移旧 package 时优先保留兼容导出和测试入口，再逐步切换 registry 路径。
