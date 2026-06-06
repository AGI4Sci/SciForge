# Channel Plugin 边界

最后更新：2026-06-06

## 定位

Channel Plugin 是未来外部消息渠道入口，例如飞书、微信、Slack、邮件或 webhook。它不是当前 P0，也不能覆盖 [`../PROJECT.md`](../PROJECT.md) 的基本模块验收。

## 能力面

| 能力 | 作用 | 边界 |
| --- | --- | --- |
| Input intake | 把外部消息、附件、发送者和来源转换为 Agent Host 输入 envelope。 | 不能绕过 Agent Host 执行业务动作。 |
| Resource read | 读取渠道消息、文档、附件、联系人等资源。 | 只返回 refs-first evidence。 |
| Delivery action | 回复、发送、上传、同步或删除。 | 高风险副作用必须 approval。 |

## 当前规则

- 外部消息进入后必须进入 Codex backend thread ledger。
- Web / GUI 只展示 thread projection，不直接写 connector 状态。
- connector 不做 task planning、repair、completion truth 或 final answer。
- 发送、删除、上传、权限修改等动作必须返回 approval request。

## 与 Bounded Operation 的关系

未来 connector 若需要局部动作串，也必须使用 `module.invoke(executeBoundedOperation)`，并遵守一个 owner module、一个 target scope、无嵌套 operation、无 workflow DSL 的规则。

## 相关文档

- [`../PROJECT.md`](../PROJECT.md)：当前需求和验收标准。
- [`Architecture.md`](Architecture.md)：总架构和 Bounded Operation。
