# Computer Use 模块设计

最后更新：2026-06-06

## 定位

Computer Use 是 Codex backend 可调用的 GUI 信息输入与局部操作执行模块，不是 Computer Use agent，也不是跨应用 workflow engine。

Computer Use 只负责：

- 观察 Host 绑定的窗口 / target。
- 读取 screenshot、crop、OCR、AX / DOM / UIA、focus state、action history 和 freshness evidence。
- 将 Host 给定的局部 GUI objective 绑定到可执行目标。
- 执行低风险局部 GUI action。
- 写入 before evidence、grounding refs、executor event、after evidence 和 stale invalidation。
- 返回 refs-first operation result、approval request 或 blocked reason。

Computer Use 不负责：

- 理解完整用户任务。
- 选择跨模块下一步。
- 设计 PPT / 报告内容。
- 自动 repair。
- 提交、发送、上传、删除、支付。
- 用户级 completion truth。
- final answer。

## 产品入口

用户仍然只从普通聊天进入：

```text
用户表达 GUI 操作意图
  -> Codex backend 判断是否需要 Computer Use
  -> Codex backend 设置 target、风险、证据和 stop 条件
  -> module.invoke(executeBoundedOperation)
  -> Computer Use 执行局部动作串
  -> Codex backend 基于 action evidence 生成 completion truth 和 final answer
```

`/computer-use` 只能是 debug / diagnostic，不是产品入口。

## 首批 Bounded Operation

| operationKind | 目标 | 允许动作 | 返回 |
| --- | --- | --- | --- |
| `computer_use.perform_local_action` | 执行 Host 指定的一个低风险局部 GUI action，例如点击、滚动、按键、等待、保存。 | observe、crop、locate、click、type_text、press_key、scroll、wait、save、verify。 | before / after evidence refs、grounding refs、executor event refs、local goal status、blocked reason 或 approval request。 |
| `computer_use.fill_fields` | 在同一窗口、表单或编辑区域内填写 Host 给定字段，但不提交。 | observe、locate fields、click、type_text、press_key、scroll、verify field values。 | field evidence refs、action refs、after evidence refs、local goal status、blocked reason。 |

## 边界规则

- 每次 operation 只能有一个 target scope 和一个 executor lease。
- 配置只声明 `allowedActions`、`maxSteps`、`maxTimeMs`、`maxModelCalls`、`riskPolicy`、`requiredEvidence` 和 `stopConditions`。
- 配置不能表达 `if/else/loop` 工作流。
- operation 内部不得调用另一个 operation。
- operation 内部不得调用 Browser、workspace、artifact、connector 或其它模块。
- 自动 repair 禁止；目标找不到、证据冲突、验证失败或预算耗尽时，只返回 blocked reason / repair hint。
- 提交、发送、上传、删除、支付、账号 / 安全、登录、验证码、跨窗口切换、跨 app workflow 和外部系统副作用必须停止并返回 Host。

## Evidence 规则

改变界面的动作必须记录：

- current target-bound before evidence。
- grounding refs。
- executor event。
- after evidence。
- verification evidence。
- stale invalidation。

证据选择原则：

- fresh evidence 优先于旧的高置信描述。
- 同 target / session evidence 优先于全局 evidence。
- 文本、role、value 优先用 AX / DOM / UIA / PTY / file structured evidence。
- 可见性、遮挡、布局和点击可达性优先用 fresh screenshot / crop。
- 保存、导出和用户级产物必须由 artifact refs / validator refs 支撑。

## Model Router 使用

Computer Use 可以调用 Model Router 做局部辅助：

- screenshot / crop 描述。
- 候选目标消歧。
- 候选 next intent。
- before / after 比较。
- 不确定性解释。

Model Router 不能输出最终执行坐标，不能改变 risk policy，不能绕过 confirmation，不能自动 repair，不能产出 completion truth 或 final answer。

可执行 binding、坐标、input lease 和真实动作必须来自 Host adapter。

## 用户级验收

Computer Use 用户级验收必须满足：

- 普通聊天请求低风险 GUI 局部操作时，Codex backend 能调用 `computer_use.perform_local_action` 或 `computer_use.fill_fields`，不要求 `/computer-use`。
- 每个改变界面的 action 都有 before evidence、grounding refs、executor event、after evidence 和 stale invalidation。
- Codex backend 基于 action evidence 生成 final answer，说明局部目标是否完成。
- 高风险动作返回 `needs-confirmation`，由 GUI 收集确认；未确认不得执行。
- 缺 native host、target binding、fresh evidence、permission refs、scoped executor 或 stop / cancel path 时，必须 blocked，并说明恢复路径。

PPT / artifact 用户级完成不能由 Computer Use 自己声明；必须由 Codex backend 使用 final artifact refs + validator refs 判断。

## 禁止作为产品 truth 的对象

- GUI projection。
- Image / Evidence pane。
- screenshot replay。
- frame stream。
- fixture。
- package probe。
- legacy VirtualAppScreen / Docker / noVNC / RDP / M6。
- 历史 run。
- 单步 action ref。

这些对象只能作为 diagnostic、evidence 或 historical regression，不能证明用户级 Computer Use 完成。

## 相关文档

- [`../../../PROJECT.md`](../../../PROJECT.md)：当前需求和验收标准。
- [`../../../docs/Architecture.md`](../../../docs/Architecture.md)：总架构和 Bounded Operation。
