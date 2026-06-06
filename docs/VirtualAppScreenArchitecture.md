# VirtualAppScreen 历史边界

最后更新：2026-06-06

## 当前结论

旧的隔离 `VirtualAppScreen` 产品路线已废弃。当前不再以 noVNC、Docker、RDP、Xpra、IDD、截图 replay 或虚拟屏幕作为 Computer Use 产品真相源。

这些材料只能作为：

- compatibility diagnostic。
- historical regression。
- backend packaging 参考。
- 手动排查证据。

它们不能替代普通聊天入口、BrowserHostSession、WindowActionSession、scoped adapter evidence、artifact refs 或 validator refs。

## 当前可保留的能力

| 能力 | 当前作用 | 不做 |
| --- | --- | --- |
| Annotation | 生成用户选区、截图、crop、target refs 和评论。 | 不执行动作、不判断完成。 |
| Image / Evidence Pane | 展示截图、crop、artifact preview、before / after evidence。 | 不作为 live control surface。 |
| WindowActionSession | 承载真实窗口 target、actor cursor、scoped input adapter 和 action evidence。 | 不成为第二 Agent Host。 |

## 与 Computer Use 的关系

Computer Use 只通过 Host 绑定的 target scope 执行 `executeBoundedOperation`。Annotation 和 Image / Evidence 只能提供 context / evidence，不能直接触发或完成 Computer Use。

## 用户级验收

用户级 Computer Use 验收必须来自：

- 普通聊天 turn。
- Codex backend completion truth。
- current-run before / after action evidence。
- scoped executor event。
- 必要时的 artifact refs / validator refs。

VirtualAppScreen、fixture、历史 run、GUI projection 或截图 replay 不能单独通过验收。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
- [`../packages/actions/computer-use/vision_computer_use_agent_mvp.md`](../packages/actions/computer-use/vision_computer_use_agent_mvp.md)：Computer Use 模块边界。
