# Channel Plugin Architecture

最后更新：2026-06-01

本文补齐外部通讯渠道的接入设计。目标是让飞书、微信、企业微信、Slack、邮件、webhook 和未来更多渠道都能即插即用，同时保证外部消息进入 Agent 后能在 SciForge Web 聊天端完整呈现。

## 核心判断

通讯渠道不是 GUI 插件，也不只是 connector tool。它有三种能力面：

| 能力面 | 作用 | 是否需要 GUI |
|---|---|---|
| Input intake | 把外部消息、mention、webhook、附件转换成 Agent Host 输入。 | 不需要。Web 聊天端只是消费同一条 thread event projection。 |
| Resource access | 搜索、读取、下载外部渠道里的消息、文档、联系人和附件。 | 不需要。由 Agent Host 调 connector resource。 |
| Delivery action | 回复、发送、上传、同步、删除或改权限。 | 不一定。普通原路回复可按 channel policy 自动投递；高风险副作用必须显式确认。 |

因此最佳边界是：

```text
Channel Plugin
  -> normalized ChannelMessageEnvelope
  -> Agent Host Thread Ledger
  -> Web Chat Projection
  -> Agent pipeline
  -> optional DeliveryEnvelope back to channel
```

Web 聊天端看到的是 Agent Host thread ledger 的 projection，不是 GUI 私有状态，也不是 connector 直接写 UI。

## OpenClaw-like 用户体验目标

外部渠道和 WebChat 应该是同一条会话的不同 surface：

- 用户在飞书群里 @agent 发消息，SciForge Web 聊天端立即出现一条带“Feishu / 群 / 发送者 / 附件 refs”的用户消息。
- Agent 在 Web 聊天端流式生成回复，同时 delivery adapter 可按 channel policy 把回复回写到原飞书 thread、卡片或私聊。
- 用户也可以在 Web 聊天端接着输入，同一条 SciForge thread 继续推进；是否同步回外部渠道由 delivery policy 决定。
- 连接器事件、raw payload、附件和审计材料只以 refs 形式挂到消息 metadata，不内联到聊天正文。

## Canonical 对象

### ChannelPluginManifest

```ts
interface ChannelPluginManifest {
  pluginId: string;
  channelKind: 'feishu' | 'wechat' | 'enterprise-wechat' | 'slack' | 'email' | string;
  title: string;
  version: string;
  transports: Array<'webhook' | 'websocket' | 'cli-event-stream' | 'polling' | 'manual-import'>;
  capabilities: {
    intake?: boolean;
    resource?: boolean;
    delivery?: boolean;
    confirmation?: boolean;
    streamingDelivery?: boolean;
    media?: boolean;
    reactions?: boolean;
  };
  refPrefixes: string[];
  permissionScopes: string[];
  sideEffects: Array<'none' | 'read' | 'send' | 'upload' | 'delete' | 'admin'>;
}
```

Manifest 只描述能力，不注册 GUI renderer，也不决定 agent routing。

### ChannelMessageEnvelope

```ts
interface ChannelMessageEnvelope {
  schemaVersion: 'sciforge.channel-message.v1';
  messageId: string;
  channel: string;
  accountId: string;
  conversationRef: string;
  externalMessageRef: string;
  senderRef: string;
  senderDisplayName?: string;
  text: string;
  mentions?: string[];
  attachmentRefs?: string[];
  rawEventRef: string;
  auditRef: string;
  dedupeKey: string;
  receivedAt: string;
  replyTarget?: {
    externalThreadRef?: string;
    externalMessageRef?: string;
  };
  authScope: {
    tenant?: string;
    bot?: string;
    policyRef: string;
  };
}
```

Agent Host 把它写入 thread ledger 时，应生成普通用户消息 event，并保留 `source.channel` metadata。Web 聊天端只渲染这个 event。

### ChannelSessionBinding

```ts
interface ChannelSessionBinding {
  bindingRef: string;
  channel: string;
  accountId: string;
  externalConversationRef: string;
  sciForgeThreadRef: string;
  policyRef: string;
  createdAt: string;
  lastMessageAt?: string;
}
```

Binding 负责把外部 DM、群、话题、邮件 thread 或 webhook source 映射到 SciForge thread。这样外部渠道和 WebChat 不会分裂成两套会话。

### DeliveryEnvelope

```ts
interface DeliveryEnvelope {
  schemaVersion: 'sciforge.channel-delivery.v1';
  channel: string;
  accountId: string;
  targetConversationRef: string;
  inReplyToRef?: string;
  contentRef?: string;
  text?: string;
  attachmentRefs?: string[];
  idempotencyKey: string;
  auditRef: string;
  policyRef: string;
}
```

普通原路回复可以按 channel policy 自动投递；跨群发送、发送给新对象、上传文件、删除、改权限、群管理和敏感数据传输必须 draft / dry-run / approval。

## Web 聊天端 projection

Web 聊天端不是从飞书 CLI 或 connector 读消息，而是订阅 Agent Host thread events：

```text
channel.message.received
  -> agent.thread.message.created(role='user', source.channel='feishu')
  -> web chat renders user bubble with source badge, sender, channel, refs
  -> agent.turn.started / agent deltas / tool calls
  -> agent.thread.message.created(role='assistant')
  -> optional channel.delivery.queued/sent/failed events
```

Web message bubble 至少展示：

- channel badge，例如 Feishu、WeChat、Email。
- sender display name 和 external conversation label。
- received time、delivery status、thread binding status。
- attachment chips 和 source refs。
- audit/debug 入口，但不展示 raw JSON。

这让用户在 SciForge Web 里看到完整对话，而不是只看到 agent 自己的回答。

## Plugin 边界

每个 channel plugin 只实现本渠道的转换和 IO：

| 模块 | 可以做 | 不可以做 |
|---|---|---|
| Intake adapter | 接收 webhook/WS/CLI NDJSON/polling event，去重、脱敏、生成 ChannelMessageEnvelope。 | 直接执行 workspace action、决定任务完成、写 GUI 状态。 |
| Resource adapter | 搜索/读取外部资源并返回 refs-first 结果。 | 把 raw payload 内联进主结果或 Web message。 |
| Delivery adapter | draft、dry-run、send、reply、upload、sync，并输出 delivery refs。 | 绕过 Agent Host approval 或私自扩大发送范围。 |
| Confirmation adapter | 在外部渠道收集“确认/取消”等回复，并转成 approval result。 | 把第三方页面或消息正文当成授权。 |
| Web chat projection | 不属于 plugin；由 Web GUI 消费 Agent Host thread events。 | 直接 import plugin SDK、CLI 或私有状态。 |

## Feishu plugin 形态

在已经具备 Feishu CLI / lark-cli 的前提下，SciForge 的 Feishu plugin 不应重写飞书 SDK。推荐形态：

```text
packages/connectors/feishu/
  manifest.ts
  plugin.ts
  larkCliProvider.ts
  intake/
    cliEventStream.ts
    webhook.ts
    normalizeMessage.ts
  resources/
    docs.ts
    im.ts
    drive.ts
  delivery/
    draft.ts
    send.ts
    streamingCard.ts
  confirmation/
    parseApprovalReply.ts
  tests/
```

实现规则：

- `larkCliProvider` 是 provider implementation，不是 public contract。
- intake 优先支持 CLI event stream 或 webhook，两者都输出同一个 `ChannelMessageEnvelope`。
- resource/delivery 调用 lark-cli 时必须固定 `--format json` 或 `--format ndjson`，记录 command audit ref，并脱敏 token、secret、本地路径和 raw payload。
- 所有外部对象都转换为 `feishu:*` refs，例如 `feishu:message:*`、`feishu:chat:*`、`feishu:doc:*`、`feishu:file:*`。
- 发送前优先 `--dry-run` 或 draft，Host policy 决定是否需要确认。
- Feishu 的 group allowlist、mention requirement、DM policy、多账号和 bot/user identity 是 plugin config，不进入 GUI 组件。

## 多渠道扩展

新增渠道只需要实现同一组接口：

```ts
interface ChannelPlugin {
  describe(): ChannelPluginManifest;
  startIntake?(ports: ChannelHostPorts): Promise<ChannelIntakeLease>;
  queryResource?(request: ChannelResourceQuery): Promise<ChannelResourceResult>;
  readResource?(request: ChannelResourceRead): Promise<ChannelResourceResult>;
  draftDelivery?(request: DeliveryEnvelope): Promise<DeliveryDraftResult>;
  sendDelivery?(request: DeliveryEnvelope): Promise<DeliveryResult>;
  handleConfirmation?(event: ChannelMessageEnvelope): Promise<ChannelApprovalResult | null>;
}
```

Host ports 只提供 thread append、ref store、secret store、audit logger、clock、idempotency store 和 policy lookup。Plugin 不拿 GUI API，也不拿 workspace executor。

## 推荐落地顺序

1. 定义 shared `ChannelMessageEnvelope`、`ChannelSessionBinding`、`DeliveryEnvelope` contract。
2. 在 Agent Host thread ledger 中支持 `source.channel` metadata 和 `channel.delivery.*` event。
3. Web 聊天端渲染外部来源消息 bubble、附件 chips、delivery status 和 source refs。
4. 实现 `packages/connectors/feishu`，先用 lark-cli event/resource/delivery provider。
5. 接入第二个轻量渠道，例如 webhook/email，验证插件 contract 没有 Feishu 特化。
6. 再考虑微信/企业微信这类 bridge 风险更高的渠道。

