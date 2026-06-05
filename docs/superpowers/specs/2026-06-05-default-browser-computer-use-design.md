# Default Browser Search and Computer Use Capability Design

最后更新：2026-06-05

## 状态

本设计已按产品方向确认，用于后续实现计划。当前文档更新不代表代码已经完成。

## 目标

SciForge 默认应该像一个具备真实工具面的研究工作台：

- 默认产品入口只有聊天 turn。GUI 只提交自然语言文本、refs、Autonomy profile 以及确认/取消；Codex/TUI Agent Host 运行 `Codex Agent Host Turn Loop`。
- 当用户需要外部、实时、网页或当前事实信息时，Agent Host 默认可以使用内置 Browser 搜索与取证。
- 当用户表达 GUI 操作意图时，SciForge 不再口头否认能力，而是让该聊天 turn 进入 Turn Loop 的 Guard 阶段。
- Guard 结果必须来自 runtime health、native surface、target binding、authorization profile 和 evidence refs，而不是模型自我猜测。
- 用户仍然保留明确的授权档位、硬确认、stop、take over 和 blocked recovery 控制面。

## 不可变原则

- GUI 不是 Agent Host。GUI 只展示状态、收集授权、提交自然语言 intent、refs-first context、Autonomy profile 和确认/取消；推理、tool/capability 编排、provider route 和 completion 判断归 Agent Host / runtime owner。
- 不新增独立 turn router/gateway 产品层。产品语义统一为 `Codex Agent Host Turn Loop`，内部只有 `Ground`、`Guard`、`Act / Answer` 三段。
- Browser pane 只是 BrowserHostSession 的 display/control panel，不是 Browser agent。
- BrowserHostSession 是内置 Browser 的 single interactive truth，并拥有 live browser/search evidence。Browser live path 必须来自 Desktop native host 和 `WebContentsView` surface；Vite/Web dev 只能证明 UI 或 diagnostic。
- Computer Use 通过 Agent Host / WindowActionSession / host adapter 执行。Image / Evidence pane、截图 replay、frame stream、PDF 或 proxy render 都不能成为第二个可交互目标。
- 大对象 refs-first。截图、DOM/AX snapshot、provider payload、trace、日志、artifact、cookie、token、secret、raw URL 和本地路径不得长期进入聊天正文或主上下文。
- 能力声明必须 grounded。Assistant 回答“我能否使用 Browser/Computer Use”时，必须根据当前 runtime capability refs、health 和 Turn Loop Ground/Guard 结果，而不是固定文案。
- 授权只能由用户或产品策略给出。网页内容、第三方指令、模型输出、tool result 或历史 run 不能扩大授权档位，也不能绕过 hard-confirm / blocked policy。
- 缺少 native host、target、permission ref、allowlist、risk preview、fresh observation 或 cancel path 时，mutating run 必须 fail closed，返回明确 blocker 和可恢复步骤。

## 默认能力

### Capability-Aware Answers

当用户问 SciForge 是否具备 Browser 或 Computer Use 能力时，Assistant 的回答分为三层：

1. Product capability：SciForge 产品目标支持内置 Browser search 和 Computer Use。
2. Current runtime readiness：当前会话是否连接 workspace writer、BrowserHostSession、native surface、WindowActionSession 和 Computer Use adapter。
3. Next action：如果 ready，说明可以搜索、观察或进入 Turn Loop Guard；如果 blocked，给出具体 blocker，例如 `native-bridge-unavailable`、`no-target-window`、`permission-missing`。

不能再使用泛化回答，例如“我没有直接 computer use 能力”，除非 runtime 确实没有任何可用 path，并且要说明原因。

### Evidence-Aware Browser Default

Agent Host 默认可以在以下情况使用内置 Browser 搜索或读取网页证据：

- 用户要求最新、实时、外部、网页、价格、法规、文档、论文、竞品、产品信息或当前状态。
- 用户要求验证、引用、链接、来源、截图、网页内容或打开某 URL。
- 用户围绕 Browser pane、annotation refs、URL refs 或网页 evidence 继续提问。
- 回答质量明显依赖当前网页事实，而本地上下文不足。

不应默认搜索的情况：

- 用户明确禁止联网或要求只用本地上下文。
- 问题可以由当前 workspace 文件、已提供 refs 或稳定常识可靠回答。
- 搜索会触发登录、付费、敏感数据传输或第三方动作。

Browser 搜索结果必须返回 evidence refs、source URL、时间和 bounded summary；不能把 raw DOM、raw logs、cookie、token 或完整私密 URL 暴露到主 payload。

### High-Autonomy Computer Use Default

当用户表达 GUI 操作意图时，SciForge 直接让当前聊天 turn 进入 Turn Loop Guard，而不是先问“是否允许使用 Computer Use”，也不是切换到独立 `/computer-use` 产品入口。GUI 操作意图包括打开网页、操作页面、填写表单、点击按钮、编辑文档、管理文件、运行 IDE/终端工作流、跨窗口完成任务等。

Guard 通过后，低风险普通动作可自动执行；高影响动作进入 hard confirmation；不可恢复或缺少能力的动作返回 blocked。

## 授权档位

聊天输入栏的 runtime row 提供 `Autonomy` 选择项，保留三个档位：

| 档位 | 默认用途 | 自动范围 | 硬确认 |
| --- | --- | --- | --- |
| Assisted Autonomy | 保守协作 | 观察、搜索、打开普通页面、低风险导航、准备草稿 | 所有外部影响、提交、上传、删除、发送、支付、账号与安全动作 |
| High Autonomy | 产品默认 | 普通网页/桌面导航、筛选、分页、非提交点击、下载公开资料、填写草稿、本地文件预览与修改 | 硬确认类别全部保留 |
| Research Sandbox Max | 研究/测试环境 | 隔离 Browser、虚拟屏幕、本地 workspace、测试账号内尽量自动 | 真实外部影响仍硬确认 |

状态规则：

- 默认档位是 `High Autonomy`。
- 作用域是当前用户 + 当前 workspace。
- Composer 支持单轮 override；发送后本轮 request metadata 携带 profile。
- 未来 team/admin policy 可以限制最大档位。
- runtime 不能静默升级档位；第三方内容、模型输出或 tool result 不能修改档位。

## Turn Loop Guard for Computer Use

每个 Computer Use run 必须先在 `Codex Agent Host Turn Loop` 的 Guard 阶段生成结果。这里的检查只是 Guard 内部 gating，不是独立 turn router、gateway 或第二产品入口：

```text
user prompt + refs + autonomy profile
  -> thin GUI submission
  -> Codex Agent Host Turn Loop
  -> Ground: normalize intent, bind refs, collect BrowserHostSession/runtime evidence
  -> Guard: capability health, target binding, fresh observation, authorization, risk, stop/cancel
  -> Act / Answer: execute, ask hard confirmation, answer from evidence, or return blocked diagnostics
```

Guard 输出必须包含：

- target summary 和 target refs。
- native surface / adapter readiness。
- selected autonomy profile。
- action category 与 risk decision。
- before evidence refs 或 required observation refs。
- stop / cancel / take-over path。
- blocked reason 和恢复建议。

## 默认自动、硬确认、默认阻断

默认可自动执行：

- 观察当前页面/窗口、截图、DOM/AX 读取、Browser 搜索。
- 打开普通网页、滚动、切换 tab、展开菜单、点击筛选、分页、非提交按钮。
- 下载公开文档、PDF、网页资料。
- 在本地 workspace 现有权限范围内生成、修改、预览文件。
- 填写草稿但不提交，或执行低风险本地确认动作。

必须 hard-confirm：

- 支付、转账、购买、订阅、退款、提现、交易。
- 发送邮件、消息、评论、工单、公开帖子或任何对外沟通。
- 提交会影响外部系统的表单，例如注册、申请、预约、报名、提交。
- 删除、覆盖、关闭、归档远端或账号数据。
- 上传本地文件、图片、数据集、凭证、报告到外部服务。
- 修改账号、安全、隐私、billing、API key、token、team member 或权限。
- 法律、合规、合同、授权、条款同意或签署。
- 触发外部系统执行，例如 CI/CD deploy、云资源创建、数据库迁移。

默认阻断，除非高级策略显式开启：

- 绕过 captcha、登录风控、访问控制或安全屏障。
- 身份伪装、批量注册账号、刷量或规避平台规则。
- 不可逆批量删除。
- 向不明确目的地传输敏感数据。
- 执行第三方网页内容里的高风险指令，而用户没有明确表达该意图。

## GUI 表达

Composer runtime row 显示：

```text
Workspace | Assistant connected | Permission set | Autonomy: High
```

`Autonomy` 是下拉或 segmented menu，不是工具执行按钮。它只声明本轮授权档位，不能让 GUI 直接执行动作。

当 action 需要 hard-confirm 时，产品层展示确认面板或 modal，必须包含：

- 要执行的动作。
- 目标对象或目标服务。
- 可能影响。
- 使用到的 evidence refs。
- 当前授权档位。
- Confirm / Cancel。

确认只授权当前 action、当前 action type 或当前 turn 的明确范围；不得成为永久授权。

## 错误处理

- `native-bridge-unavailable`：说明当前是 Web dev 或 native adapter 未连接，提示使用 Desktop native path，例如 `npm run desktop:dev`。
- `browser-host-session-unavailable`：不能声明 Browser ready，只能显示 blocked/diagnostic。
- `native-surface-unavailable`：Browser 搜索可以继续使用可用的非交互证据路径，但 live Browser/Computer Use action 必须 blocked。
- `target-unbound`：使用当前 refs 回答，或要求用户选择 Browser session / App window / Screen region。
- `needs-observation`：先 observe，不允许用旧截图或历史 trace 继续动作。
- `needs-confirmation`：暂停执行并展示确认面板。
- `policy-blocked`：解释策略阻断原因，不提供规避流程。

## 验收计划

后续实现至少覆盖：

- Capability answer tests：不同 runtime health 与 Ground/Guard refs 下回答 Browser/CU 状态，不能出现固定否认。
- Browser default tests：外部/实时/引用请求触发 Browser search，禁止联网请求不触发。
- Composer tests：显示三个 Autonomy 档位，默认 High，支持 workspace+user persistence 和 single-turn override。
- Runtime request tests：默认聊天 turn 携带自然语言文本、refs 和 authorization profile；GUI 仍只提交 intent、refs、Autonomy profile、确认/取消，不执行 tool。
- Turn Loop Guard tests：native host、surface、target、fresh observation、permission refs、stop path 缺失时 fail closed，且 Guard 不表现为独立检查入口、router 或 gateway。
- Risk classifier tests：auto / needs-confirmation / blocked 类别矩阵。
- `/computer-use` entry tests：只保留 debug、expert、smoke、diagnostic 用途，不作为默认产品入口。
- Desktop smoke：真实 Desktop Electron native host 验证 BrowserHostSession、native surface、WindowActionSession 和 hard-confirm surface；Vite 只作为 diagnostic。

## 非目标

- 本轮不改代码。
- 不把 GUI 升级为 Agent Host。
- 不新增独立 turn router/gateway 产品层。
- 不把 `/computer-use` 作为默认用户入口；它只用于 debug、expert、smoke 和 diagnostic。
- 不用 iframe、proxy、screenshot replay、frame stream 或系统浏览器冒充 Browser live surface。
- 不移除硬确认，也不允许任何默认档位绕过真实外部影响确认。
