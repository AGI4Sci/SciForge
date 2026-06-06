# Semantic Module Engineering

最后更新：2026-06-06

## 目的

本文只保留当前模块工程原则。当前实现以 [`Architecture.md`](Architecture.md) 中的 Bounded Operation 为最小落点。

## 模块是什么

模块是 Codex backend 可调用的能力边界。模块只暴露：

```text
module.describe
module.read / observe
module.invoke
```

模块返回 refs-first 结果，不返回用户级 final answer，也不声明 completion truth。

## 分层规则

| 层级 | 拥有 | 不拥有 |
| --- | --- | --- |
| Codex backend Agent Host | 用户任务、模块选择、跨模块编排、approval、repair、completion truth、final answer。 | 单个模块的内部执行细节。 |
| 模块 / Adapter | 同一资源域的读取、局部执行、evidence、blocked reason。 | 跨模块 planning、自动 repair、用户级 completion。 |
| 原子 handler | read、observe、locate、execute、verify、write evidence。 | 调其它模块、决定下一步用户任务。 |

## 当前最小模式

复杂模块先不要实现通用 workflow engine。当前只实现：

```text
module.invoke(executeBoundedOperation)
```

它表示一个 owner module 在一个 target scope 内执行一个有边界的局部动作串。

## 禁止事项

- 模块不得互相调用。
- 模块不得读取 GUI 私有状态来判断任务完成。
- 模块不得把 fixture、历史 run、GUI projection 或 tool 文本升级为用户级 completion。
- 配置不得演化成 `if/else/loop` DSL。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：Bounded Operation 总契约。
