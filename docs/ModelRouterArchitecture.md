# Model Router 架构

最后更新：2026-06-06

## 定位

SciForge Model Router 是 `/v1/responses` 兼容的模型 facade，不是 Agent Host。

它只负责：

- 按 workspace / profile / role 选择模型。
- 调用 text reasoner 或 vision translator。
- 把截图、crop、页面片段等模态输入转成局部文本观察。
- 写 refs-first trace。
- 返回 bounded model output。

它不负责：

- 用户任务规划。
- 模块选择。
- risk policy。
- approval。
- repair。
- completion truth。
- final answer ownership。

## 在 Bounded Operation 中的作用

`executeBoundedOperation` 内部可以直接调用 Model Router，但只能用于局部辅助：

- 截图 / crop / 页面片段描述。
- 候选目标消歧。
- 候选 next intent。
- before / after 比较。
- 不确定性解释。

Model Router 输出只是候选信号。真正的可执行 binding、坐标、input lease、文件写入和真实动作必须来自 owner adapter / Host port。

## 禁止事项

- 不得改变 `riskPolicy`。
- 不得决定跨模块下一步。
- 不得绕过 confirmation。
- 不得自动 repair。
- 不得产出用户级 completion truth。
- 不得生成用户可见 final answer。
- 不得静默 fallback 到未注册 provider / model / profile。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
