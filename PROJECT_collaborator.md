# SciForge 飞书群协作者任务板

最后更新：2026-06-06

## 当前目标

SciForge 需要成为可以被邀请进任意飞书群的 AI 协作者。飞书群是第一协作边界，不要求先绑定 SciForge project。SciForge 入群后默认可以聊天、阅读群内共享文档、撰写和修改文档、留下评论、总结讨论、推进行动项，并在需要时连接 SciForge workspace 执行任务，再把结果同步回群。

目标产品链路：

```text
Feishu group invitation / message / document ref
  -> Feishu connector intake
     -> group-native collaboration space
        -> Agent Host Ground: 群上下文、文档范围、workspace 需要、当前权限
        -> Agent Host Guard: 自动、先问、评论建议、blocked
        -> Agent Host Act: 读写飞书文档、评论、发送群消息、执行 workspace 任务
  -> Feishu group result: 摘要、diff、snapshot、audit、rollback ref
```

设计依据见 [`docs/group-collaborator-design.md`](docs/group-collaborator-design.md)。该设计文档描述产品意图和边界，不代表实现已经完成。

## 不可变原则

- 飞书群是默认协作空间；不得要求所有群先绑定 SciForge project 才能开始工作。
- Workspace 执行是默认能力，不是单独模式；需要时连接 workspace，结果回到原飞书群。
- SciForge 应像人类协作者一样工作，不给用户暴露复杂模式开关。
- 授权以当前群上下文为核心；不能因为工具或凭证可访问某文档，就视为已获授权。
- 群上下文默认隔离；不得静默跨群复用文档、任务、记忆或决策。
- 文档低风险修改可以自动写入；高风险修改必须先问或以评论提出建议。
- 每次飞书文档写入必须保存 snapshot / diff / audit / rollback ref。
- 外部副作用必须 refs-first，可追踪、可解释、尽可能可回滚。
- GUI 不直接调用飞书 SDK、CLI 或 API；飞书能力属于 TUI / Agent Host 侧 connector。
- 旧逻辑与本任务目标冲突时，应优先实现新协作模型，不为历史 demo 写硬编码兼容。

## 当前任务板：Feishu Group Collaborator

状态原则：

- `[x]` 表示已经在代码或文档中明确完成，并经过对应验证。
- `[ ]` 表示尚未实现、尚未接入真实活动链路、只有局部测试通过，或还需要产品取舍。
- 本文档是飞书群协作者专项任务板；根任务板仍以 [`PROJECT.md`](PROJECT.md) 为准。

### 0. 已确认事实

- [x] 用户目标是让 SciForge 被邀请进任意飞书群后即可作为协作者工作，而不是只服务已有 SciForge project。
- [x] 用户希望 SciForge 像正常人类协作者一样，默认具备聊天、文档协作和 workspace 执行能力。
- [x] 用户接受自动修改飞书文档，但要求在授权范围内，并保留 audit、写入前 snapshot、diff 和可回滚信息。
- [x] 用户不希望暴露观察者、协作者、维护者、执行者等复杂模式。
- [x] 现有仓库已有 `packages/connectors/feishu`，包含 `lark-cli` provider、intake、resource、delivery、confirmation 和局部测试。
- [x] 本机存在 `lark-cli`，版本为 `1.0.45`。
- [x] `node --import tsx --test packages/connectors/feishu/tests/feishu-channel-plugin.test.ts` 当前可从仓库根目录通过。
- [ ] `npm test --workspace @sciforge-connector/feishu` 当前存在 cwd 假设问题，需要修复包内测试路径。
- [ ] 现有 Feishu connector 还只是 channel adapter 雏形，尚未形成 group-native collaborator 产品链路。

### 1. P0：群原生协作空间

- [ ] 定义 `FeishuCollaborationSpace` 或等价 runtime model，以 `feishu:chat:<id>` 作为主边界。
- [ ] 记录群名称、chat ref、成员摘要、最近上下文、维护文档、任务历史、audit refs、rollback refs 和可选 workspace link。
- [ ] 入群事件必须创建或恢复群协作空间，不要求绑定 SciForge project。
- [ ] 群协作空间必须可以独立运行：聊天、文档读写、评论和任务推进都不依赖预先存在的 project。
- [ ] 群协作空间与 SciForge workspace 的关系必须是可选链接，而不是父子强依赖。
- [ ] 新增测试：同一个 Feishu 群重复邀请或重连时恢复同一协作空间。
- [ ] 新增测试：不同 Feishu 群的记忆、文档范围和任务历史默认隔离。

### 2. P0：入群初始化体验

- [ ] 处理 SciForge 被邀请进飞书群的事件或等价 webhook / CLI event。
- [ ] 发送自然语言初始化消息，说明 SciForge 可以聊天、协作文档、连接 workspace 执行任务，并会保留 diff、snapshot 和 audit。
- [ ] 初始化消息只能提供少量自然设置：绑定 workspace、指定维护文档、设置可授权成员。
- [ ] 不得要求用户先选择复杂模式才能开始协作。
- [ ] 新增测试：初始化消息不包含观察者、协作者、维护者、执行者等模式选择。
- [ ] 新增测试：未绑定 workspace 的新群仍可进入普通聊天和文档协作路径。

### 3. P0：群消息 intake 到 Agent Host

- [ ] Feishu 群消息、mention、回复、文档分享和附件必须归一化为 refs-first `ChannelMessageEnvelope`。
- [ ] message refs 使用 `feishu:message:*`，群 refs 使用 `feishu:chat:*`，文档 refs 使用 `feishu:doc:*`，附件 refs 使用 `feishu:file:*`。
- [ ] intake 写入 Agent Host thread / ledger 时必须携带 source channel、sender、conversation ref、attachment refs、raw event ref 和 audit ref。
- [ ] Agent Host Ground 必须能读取群协作空间、近期群摘要、被引用文档和可选 workspace 状态。
- [ ] 群消息不能模拟 GUI click；它应直接成为 Agent Host 输入。
- [ ] 新增测试：群里 @SciForge 并附带文档 ref，会生成带 provenance 的用户消息和文档 refs。
- [ ] 新增测试：非本群的历史 refs 不会自动进入当前群上下文。

### 4. P0：授权边界与风险判断

- [ ] 定义群上下文授权规则：共享、引用、明确分配、标记维护、从群请求生成的 workspace 任务。
- [ ] 文档可访问性不得等同于可修改授权。
- [ ] 低风险文档修改可以自动执行，包括表达修正、格式整理、摘要、行动项、会议记录和已达成共识的结论同步。
- [ ] 高风险修改必须先问或改为评论建议，包括大量删除、大幅改写、承诺、发布、敏感决策、群共识不明和未出现在群上下文中的文档。
- [ ] Guard 必须输出 `auto`、`ask-first`、`comment-suggestion` 或 `blocked` 等结构化决策。
- [ ] 新增测试：群内共享文档的低风险编辑可自动进入写入计划。
- [ ] 新增测试：试图编辑未出现在当前群上下文的文档必须 blocked 或 ask-first。
- [ ] 新增测试：删除大量内容必须 ask-first 或 comment-suggestion，不得自动覆盖。

### 5. P0：飞书文档读写、diff、snapshot、audit、rollback

- [ ] 扩展 Feishu document resource，支持读取文档结构、正文、版本信息和可定位段落。
- [ ] 写入前保存 snapshot 或 recoverable ref。
- [ ] 写入前生成 diff / patch summary，并保存为 artifact 或 audit-linked record。
- [ ] 写入动作必须记录 actor、chat ref、doc ref、reason、operation、timestamp、request ref 和 result ref。
- [ ] 写入后必须把修改摘要、diff ref、snapshot ref、audit ref 和 rollback ref 回报到原飞书群。
- [ ] rollback ref 必须能让后续 agent 或用户理解如何恢复。
- [ ] 新增测试：任意文档写入缺少 snapshot / diff / audit 时失败。
- [ ] 新增测试：写入成功后 delivery 消息包含 diff、snapshot、audit、rollback refs。

### 6. P0：群内文档评论协作

- [ ] 支持在不确定或高风险位置留下评论，而不是直接覆盖正文。
- [ ] 评论应能引用文档位置、原文片段、建议内容、原因和需要人类判断的问题。
- [ ] 群里对 SciForge 评论的回复应能被 intake 识别为后续确认或澄清。
- [ ] 评论确认后，SciForge 可以继续执行对应文档修改，并保留同样的 diff / snapshot / audit。
- [ ] 新增测试：高风险改写请求会生成评论建议而不是直接写入。
- [ ] 新增测试：用户在群里明确确认评论建议后，可以进入写入路径。

### 7. P0：Workspace 默认执行能力

- [ ] 群请求需要代码、数据、仓库、实验或 artifact 时，Agent Host 应判断是否需要 workspace。
- [ ] 已绑定 workspace 时，SciForge 可直接把群任务投递到该 workspace 执行。
- [ ] 未绑定 workspace 时，SciForge 应自然询问、创建或选择 workspace，具体策略由产品配置决定。
- [ ] Workspace 任务必须保留来源飞书群、原消息 ref、相关文档 refs 和 audit refs。
- [ ] 执行中的进度和最终结果应回到原飞书群。
- [ ] 如果执行结果需要更新飞书文档，必须进入文档写入的 snapshot / diff / audit 流程。
- [ ] 新增测试：群任务可创建 workspace task，并保留 `feishu:chat:*` 与 `feishu:message:*` provenance。
- [ ] 新增测试：workspace 结果可回写飞书群，不丢失来源 refs。

### 8. P1：群记忆与长期协作

- [ ] 保存每个群的近期讨论摘要、重要决策、开放任务、维护文档和 workspace link。
- [ ] 群记忆必须 refs-first，不存储不必要的 raw payload、token、cookie 或完整敏感内容。
- [ ] 群记忆必须支持更新、压缩和过期策略，避免无限增长。
- [ ] 群记忆只能默认服务当前群。
- [ ] 新增测试：群 A 的决策不会被群 B 自动读取。
- [ ] 新增测试：同一群后续请求可使用之前维护文档和未完成任务的摘要。

### 9. P1：真实 Feishu 端到端验证

- [ ] 增加 opt-in smoke：真实或沙箱飞书群邀请 SciForge。
- [ ] smoke 覆盖入群初始化消息。
- [ ] smoke 覆盖群里 @SciForge 并引用文档。
- [ ] smoke 覆盖读取文档并生成摘要。
- [ ] smoke 覆盖低风险自动写入，并验证 diff / snapshot / audit / rollback refs。
- [ ] smoke 覆盖高风险修改降级为评论或先问。
- [ ] smoke 覆盖 workspace 任务执行后回群同步。
- [ ] smoke 必须默认关闭，只在显式环境变量和凭证齐全时运行。

### 10. P1：现有 connector 健康修复

- [ ] 修复 `packages/connectors/feishu/tests/feishu-channel-plugin.test.ts` 中依赖 `process.cwd()` 为仓库根的路径假设。
- [ ] `npm test --workspace @sciforge-connector/feishu` 必须能从 workspace 包目录通过。
- [ ] `LarkCliProvider.startIntake()` 或相关 intake lease 必须支持真实停止、错误上报和重连策略。
- [ ] lark-cli 调用必须继续强制 `--format json` 或 `--format ndjson`。
- [ ] audit 中必须继续脱敏 token、secret、本地路径和 raw sensitive payload。
- [ ] 新增测试：CLI stream 失败时返回可诊断状态，不静默吞掉错误。
- [ ] 新增测试：stop intake 后不再继续追加群消息。

## 非目标

- 不把飞书群协作者限制为已有 SciForge project 的插件。
- 不把 workspace 执行做成需要用户手动开启的独立模式。
- 不给用户暴露复杂模式选择。
- 不要求每次低风险文档编辑都人工确认。
- 不允许 GUI 直接接管飞书 API、SDK、CLI 或权限判断。
- 不做默认跨群全局记忆。
- 不为了 demo 硬编码某个群、某个文档、某个用户或某条消息。

## 当前验收标准

1. SciForge 被邀请进任意飞书群后，会创建或恢复群原生协作空间，并发出自然初始化消息。
2. 未绑定 SciForge project 的飞书群仍能聊天、读取群内文档、评论和执行低风险文档修改。
3. 群里 @SciForge 并引用文档时，Agent Host 能看到群上下文、文档 refs、sender 和 audit refs。
4. 授权范围由当前群上下文决定，而不是单纯由飞书凭证可访问性决定。
5. 低风险文档修改可自动写入；高风险修改先问或生成评论建议。
6. 每次文档写入都有 snapshot、diff、audit 和 rollback ref，并回群报告。
7. 需要 workspace 的群任务可以连接或创建 workspace 执行，并把结果同步回原群。
8. 不同飞书群的记忆、任务和文档授权默认隔离。
9. GUI 只展示群消息、refs、任务、审计和修改摘要，不直接调用飞书能力。
10. Feishu connector 包内测试和仓库根测试都能通过，真实飞书 smoke 作为 opt-in 验证。

## 相关文档和代码

- [`docs/group-collaborator-design.md`](docs/group-collaborator-design.md)：飞书群协作者产品设计。
- [`PROJECT.md`](PROJECT.md)：当前主项目协议与默认 Agent Host 能力任务板。
- [`docs/ChannelPluginArchitecture.md`](docs/ChannelPluginArchitecture.md)：channel plugin、Feishu connector 和 refs-first 设计。
- [`docs/TuiGuiProtocol.md`](docs/TuiGuiProtocol.md)：TUI / GUI 边界与外部连接器说明。
- [`docs/Architecture.md`](docs/Architecture.md)：Agent Host 与 GUI ownership 边界。
- [`packages/connectors/feishu`](packages/connectors/feishu)：现有 Feishu connector 实现。
- [`packages/contracts/runtime/channel-plugin.ts`](packages/contracts/runtime/channel-plugin.ts)：ChannelMessageEnvelope、DeliveryEnvelope 和 ChannelPlugin contract。
