# 群协作者设计边界

最后更新：2026-06-06

## 定位

群协作者是未来 Channel Plugin 场景，例如飞书群里的 SciForge 协作者。它不是当前 P0，也不能成为第二个 Agent Host。

## 用户体验目标

SciForge 可以被邀请进群聊，读取群内明确给它的消息和文档，协助总结、草拟、评论、跟踪行动项，并在需要时把任务交给 SciForge workspace / Codex backend 处理。

## 边界

- 群消息进入后必须转换为 Codex backend input envelope。
- Codex backend 仍拥有 task plan、tool selection、approval、repair、completion truth 和 final answer。
- 群渠道只提供 input intake、resource read 和 delivery action。
- 写文档、发消息、上传、删除、权限修改等副作用必须 approval。
- 群协作结果必须进入同一 thread ledger，GUI / Web 只展示 projection。

## 与当前 P0 的关系

当前先实现基本模块和用户级验收：

- Browser evidence。
- Computer Use 局部动作。
- Artifact / validator。
- Bounded Operation 契约。

群协作者未来复用这些模块，但不改变当前 P0。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`ChannelPluginArchitecture.md`](ChannelPluginArchitecture.md)：外部渠道边界。
