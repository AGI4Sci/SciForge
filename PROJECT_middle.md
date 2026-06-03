# SciForge Middle Pane 项目协议

最后更新：2026-06-03

## 当前目标

Middle Pane 是 SciForge 的聊天、过程和 composer 中心。它对齐 Codex / Cursor-like agent chat：

- 用户消息
- assistant 过程句
- `Worked for ...` / `Explored ...` 聚合过程
- 最终回答
- 可点击对象 refs
- composer、context、tools、model/mode、send/stop

Annotation 采用 Codex 策略：用户标注后，annotation refs 作为 pending context 进入 composer，随下一条用户消息提交；不自动生成任务，不自动触发 agent。

## 不可变规则

- Middle Pane 不做 provider route、capability ranking、workspace 写入、Computer Use execution、verifier verdict 或 completion 判断。
- 可点击对象 refs 只能聚焦右侧 Browser/Image/Terminal/Files/References；不能隐式插入 composer。
- annotation pending context 只有用户发送消息后才进入 thread。
- 过程展示必须折叠内部 trace，避免 raw stdout/stderr/provider/debug/prompt echo 污染最终回答。
- 大 payload、截图、terminal transcript、DOM snapshot、artifact、audit 和 replay 必须 refs-first。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。

## 当前任务板

### P0：Annotation Pending Context

- [ ] Composer 支持 pending annotation chips。
- [ ] pending annotation 可预览、移除、随消息发送。
- [ ] annotation refs 进入 user message 后能点击打开 Image pane 或 Browser pane。
- [ ] 不生成自动任务，不自动触发 agent。

### P0：Object Ref 路由

- [ ] `browser:*` / URL refs 路由到 Browser。
- [ ] `annotation:*` / `image:*` / `crop:*` / `screenshot:*` refs 路由到 Image。
- [ ] `terminal:*` refs 路由到 Terminal。
- [ ] `file:*` refs 路由到 Files。
- [ ] `trace:*` / `run:*` / `subagent:*` refs 路由到 References。

### P1：过程展示

- [ ] running progress 只显示自然语言进度句和必要 action row。
- [ ] 完成态默认折叠过程，展开后才显示命令、输出摘要、diff、refs。
- [ ] provider URL、API key、token、本地路径、raw JSON 和 raw runtime error 必须脱敏或折叠。

### P1：Composer Tools

- [ ] Add agents/context/tools menu 支持 Plan、Ask、Debug、Multitask、Image、Models、Skills、MCP Servers。
- [ ] Image / Annotation 入口进入统一 pending context，不变成独立工具栏。
- [ ] model/mode picker 只展示公开模型和模式 intent，不展示 provider config 或 secret。

## 大文件拆分登记

| 文件 | 登记原因 | 下一步 |
| --- | --- | --- |
| `src/ui/src/app/chat/cursorAgentProcess.ts` | 接近 2000 行阈值时已登记 | 新增 process 语义前优先拆分 sanitizer、row projection、folding model、object-ref route。 |
| `src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts` | runtime event normalization 接近阈值 | 新增 Browser/Window/Annotation event 前优先拆分 transport classifier 和 public projection。 |
| `src/ui/src/app/ChatPanel.tsx` | 聊天 orchestration 容易膨胀 | 新增 run lifecycle、queue、Stop/Resume 前继续下沉到 `chat/` helpers。 |

## 验收规则

- 文档改动：`git diff --check`。
- Composer 改动：运行 composer focused tests。
- Annotation pending context 改动：验证 pending chip -> send -> message refs -> right pane route。
- Process display 改动：验证 raw provider/debug/secret 不进入最终回答。

## 相关文档

- [`PROJECT_annotation.md`](PROJECT_annotation.md)
- [`PROJECT_image.md`](PROJECT_image.md)
- [`PROJECT_right.md`](PROJECT_right.md)
- [`docs/VirtualAppScreenArchitecture.md`](docs/VirtualAppScreenArchitecture.md)
