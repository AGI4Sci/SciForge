# 历史运行手册：VirtualAppScreen Dogfood

最后更新：2026-06-06

本文只保留旧 VirtualAppScreen / Screen pane dogfood 的历史口径。它不再作为当前 Computer Use P0 的任务来源，也不再定义用户级验收。

当前 Computer Use 设计以以下文档为准：

- [`../../PROJECT.md`](../../PROJECT.md)
- [`../Architecture.md`](../Architecture.md)
- [`../../packages/actions/computer-use/vision_computer_use_agent_mvp.md`](../../packages/actions/computer-use/vision_computer_use_agent_mvp.md)

## 当前口径

Computer Use 是 SciForge 暴露给 Codex backend 的 Desktop / GUI 能力模块，不是第二个 Agent Host。

首批只实现两个 operation kind：

- `computer_use.perform_local_action`：在已绑定目标上执行低风险局部动作。
- `computer_use.fill_fields`：填写字段、选择选项、修改可见输入，但默认不提交。

Computer Use operation 只返回 refs-first result，例如 observation refs、before/after refs、action refs、target refs、blocked reason、approval request 和 compact observation。它不负责用户级 task plan、跨模块 repair、artifact 完成判断或 final answer。

## 局部动作范围

Computer Use 可以在一个 operation 内执行一串局部动作，例如“定位输入框 -> 填写三个字段 -> 读取填写后状态”。这串动作必须有硬边界：

- 一个 owner module：Computer Use。
- 一个 target scope：当前窗口、当前应用、当前表单或当前页面区域。
- 一个局部目标：不能把“做完整 PPT / 完整调研 / 完整办公 workflow”塞进单个 operation。
- 有 `allowedActions`、`maxSteps`、`maxTimeMs`、`maxModelCalls`、`riskPolicy`、`requiredEvidence` 和 `stopConditions`。
- 不嵌套调用 Browser、artifact、workspace 或其它 module operation。
- 不自动 repair；只能返回 blocked reason 和 repair hint。

保存、导出、提交、发送、支付、上传、删除、账号安全、法律合规和外部系统副作用必须由 Codex backend risk policy 决定是否 hard-confirm。

## 旧口径不再使用

以下内容可作为历史诊断线索，但不得作为当前 P0 通过条件：

- VirtualAppScreen / Screen pane 产品路线。
- noVNC、RDP、VNC、Xpra、IDD、Docker virtual desktop。
- 旧 VS Code / Word / PowerPoint app-profile dogfood 矩阵。
- 历史 manifest、fixture、replay frame、provider probe 或 GUI projection。
- 把 `gui.present`、旧截图、历史 action trace 或 smoke passed 直接升级为用户级 completion。

如果未来恢复桌面 live dogfood，它只能证明 Computer Use 模块的局部动作稳定性；用户级完成仍必须由 Codex backend 基于当前 run 的 evidence refs、artifact refs 和 validator refs 判断。
