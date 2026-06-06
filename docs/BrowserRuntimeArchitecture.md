# Browser 模块设计

最后更新：2026-06-06

## 定位

Browser 是 Codex backend 可调用的网页信息输入与局部浏览器操作模块，不是 Browser agent，也不是搜索总结工具。

Browser 只负责：

- 搜索或打开网页。
- 读取搜索结果候选。
- 打开 Host 允许的来源页。
- 读取页面文本、DOM / AX、截图 / crop 和 loading state。
- 返回 refs-first evidence。
- 执行 Host 已决策的局部浏览器动作。

Browser 不负责：

- 查询改写。
- 来源取舍。
- 事实综合。
- 最终总结。
- 跨模块 repair。
- 用户级 completion truth。

## 产品入口

用户仍然只从普通聊天进入：

```text
用户请求网页事实
  -> Codex backend 判断需要 Browser evidence
  -> module.invoke(executeBoundedOperation)
  -> Browser 返回 source / page evidence refs
  -> Codex backend 生成 completion truth 和 final answer
```

Browser pane 只是 BrowserHostSession 的展示和控制面板，不是任务入口。

## 首批 Bounded Operation

| operationKind | 目标 | 允许动作 | 返回 |
| --- | --- | --- | --- |
| `browser.search_read` | 用 Host 给定 query 获取网页来源证据。 | navigate search URL、读取结果候选、打开 Host 约束内的前 N 个来源页、读取页面文本。 | search result refs、source page refs、page text refs、source quality signals、blocked reasons。 |
| `browser.open_read` | 打开 Host 给定 URL / link ref 并读取页面证据。 | navigate/open link、wait ready、read DOM/AX/text/screenshot/crop。 | page state refs、page text refs、screenshot/crop refs、blocked reasons。 |

## 边界规则

- 每次 operation 只绑定一个 BrowserHostSession / tab scope。
- 配置只声明 query、URL、maxResults、maxSourcePages、allowedDomains、recency、maxSteps、maxTimeMs、maxModelCalls 和 evidence policy。
- 不允许配置 `if/else/loop` 工作流。
- operation 内部不得调用另一个 operation。
- 搜索结果页不是完成证据；必须返回实际打开并读取的 source page refs。
- 下载、登录、跨站点高风险动作、提交、上传、删除、支付和账号 / 安全动作必须停止并返回 Host。
- 自动 repair 禁止；打不开页面、来源不相关、结果不足或证据冲突时，只返回 blocked reason / repair hint。

## Model Router 使用

Browser 可以调用 Model Router 做局部辅助：

- 页面片段摘要。
- 候选结果质量解释。
- 视觉 / 文本消歧。
- before / after 差异说明。

Model Router 不能生成用户最终总结，不能决定继续扩大搜索，不能改变 risk policy，不能产出 completion truth。

## 用户级验收

检索类用户级验收必须满足：

- 普通聊天请求触发 Codex backend 调用 `browser.search_read` 或 `browser.open_read`。
- Browser 返回实际读取过的 source page refs / page text refs。
- Codex backend 基于 source evidence 生成 final answer，并给出来源。
- 来源不足、页面打不开、证据冲突或结果不相关时，final answer 必须是 partial / blocked，不能编造完成。
- 用户禁止联网或要求只用本地上下文时，不调用 Browser。

## 禁止作为产品 truth 的对象

- iframe。
- proxy render。
- screenshot / snapshot replay。
- frame stream。
- 系统外部浏览器。
- 历史 run。
- 只读搜索结果页。

这些对象只能作为 diagnostic、evidence 或 handoff，不能证明 Browser 产品通过。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
