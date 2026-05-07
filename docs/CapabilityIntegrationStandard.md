# 能力集成标准

本文档定义 SciForge 后续集成和使用 `senses`、`actions`、`verifiers`、`ui-components`、`skills`、`tools` 以及其它可复用能力时应遵循的标准。

目标是：随着能力数量增长，agent 仍然保持专注、聪明、低 token 成本；同时让大多数新能力可以用轻量方式接入，只有关键组件才需要专门的运行时胶水代码。

## 核心原则

SciForge agent 不应该直接面对所有已安装能力。

在执行任务之前，运行时应该先根据用户请求、workspace 状态、模态需求、预期产物、风险等级和可用运行时契约，生成一个很小的能力摘要包。agent 只基于这个摘要包进行计划和选择。

完整的包文档、详细调用契约和长示例，应该只在某个能力被选中后再按需加载。

```text
用户请求
  -> Capability Broker
      -> 判断意图、模态、风险和预期产物
      -> 选择候选 skills、tools、senses、actions、verifiers 和 ui-components
      -> 生成紧凑的 Capability Brief
  -> Agent 基于 brief 制定计划
  -> Agent 通过稳定 adapter 调用能力
  -> Runtime 执行 Observe/Reason/Action/Verify 闭环、修复并压缩 trace
```

这个分层的边界是：

- broker 负责缩小注意力范围。
- agent 负责策略选择和任务规划。
- adapter 负责稳定调用边界。
- runtime 负责校验、执行、验证、修复、观测和上下文压缩。

## 能力类型

### Skills

Skill 是 agent 可选择的工作策略。它描述何时行动、哪些输入重要、可以调用哪些 tools 或 senses、应产出什么 artifact、需要处理哪些失败模式。

大多数 skill 应该是 Markdown-first 的。新增 skill 时，优先通过 `SKILL.md` 和小型 manifest 接入。除非执行逻辑与策略不可分割，否则 skill 不应该捆绑 tool 的具体实现。

### Tools

Tool 是 skill 可以调用的执行资源。例子包括数据库连接器、命令 runner、MCP server、LLM backend、外部 API、可视化运行时等。

Tool 不负责判断用户意图。tool 应该暴露调用契约、配置要求、输出格式、成本、延迟和失败模式。是否使用某个 tool，由 skill 和 broker 决定。

### Senses

Sense 把非文本世界或外部状态转成 agent 可使用的结构化信号。例子包括视觉、GUI 观察、音频、显微图像、仪器遥测等。

关键 sense 不应该只依赖 Markdown 指令。它们应该有 native runtime adapter，用稳定的输入输出 envelope、紧凑 trace、诊断信息和显式安全边界来约束行为。

### Actions

Action 是会改变环境、写入文件、操作 GUI、调用外部系统或产出带副作用结果的执行能力。例子包括 Computer Use、浏览器沙箱动作、远程桌面动作、文件编辑、notebook/kernel 执行和未来实验设备动作。

Action 必须声明 action schema、环境目标、安全闸门、确认规则、trace contract、verifier contract 和失败模式。高风险 action 默认 fail closed，除非 runtime request 带有显式 approval policy。

### Verifiers

Verifier 为 Observe/Reason/Action 闭环提供反馈和 reward。它接收任务目标、结果、artifact refs、trace refs、环境状态或验证 instruction，输出 verdict、reward、critique、evidence refs、repair hints 和 confidence。

Verify 是每个 run 必须考虑的闭环阶段，但 verifier provider 和验证强度可以按风险选择。低风险草稿可以使用轻量规则 verifier 或显式标记为 `unverified`；高风险动作、科研结论、外部副作用、发布、删除、支付、授权等任务必须使用更强 verifier，并在必要时请求人类确认。

Verifier provider 可以是：

- 人类：验收、批注、打分、accept/reject/revise。
- 其它 agent：基于 rubric 检查答案、artifact 和 trace。
- 规则或 schema：JSON schema、artifact contract、lint、typecheck、unit test。
- 环境观察：GUI 状态、文件系统 diff、外部 API 状态、仪器状态。
- Reward model 或 simulator：为下一轮 ReAct 提供可比较 score。

### UI Components

UI component 负责渲染 artifact 或任务状态。它应声明自己支持的 artifact 类型、数据契约、交互事件和 fallback 行为。

UI component 不负责领域策略判断。它应该由 runtime 根据 artifact type、display intent、component manifest 和用户交互上下文选择。

## 集成等级

SciForge 支持三种集成等级。新增能力时，应使用能保证可靠性的最低等级。

### Level A：Markdown-First Capability

适用于大多数 skills 和简单 tools。

必需内容：

- `SKILL.md` 或等价的短 agent contract。
- manifest 字段，包括 id、kind、description、domains、triggers、entrypoint 和 validation。
- 必要时提供 example prompts 和 anti-triggers。

运行时行为：

- 自动发现。
- 进入紧凑 metadata 索引。
- 只有被选中后才加载完整文档。
- 不需要自定义运行时胶水代码。

### Level B：Schema Adapter Capability

适用于常用 tools、可复用 task runner，以及需要稳定输入输出契约的能力。

必需内容：

- 输入 schema。
- 输出 schema。
- 调用 adapter。
- 输出压缩函数。
- smoke validation。

推荐接口：

```ts
interface CapabilityAdapter<Input, Output> {
  id: string;
  kind: "skill" | "tool" | "sense" | "action" | "verifier" | "ui-component";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  compactOutput(output: Output): Record<string, unknown>;
  invoke(input: Input, context: RuntimeContext): Promise<Output>;
}
```

运行时行为：

- broker 可以根据 metadata 选择它。
- agent 只看到短摘要和调用形状。
- runtime 在结果进入上下文之前校验输入输出。

### Level C：Native Runtime Capability

适用于关键 senses、GUI automation、高成本外部系统、长时间科学工作流，或任何带有安全敏感副作用的能力。

必需内容：

- 稳定 ABI 或语言无关的 request/result contract。
- 专用 runtime adapter。
- 显式安全策略。
- 使用 trace refs，而不是在上下文中内联大 payload。
- 失败诊断。
- 上下文压缩。
- 契约测试。

运行时行为：

- runtime 拥有校验、执行、重试策略和 handoff compaction。
- agent 保留策略选择权，但低层执行由 adapter 中介。
- 高风险动作默认 fail closed，除非上游请求带有显式 approval policy。

## Capability Broker

Capability Broker 是用户请求和 agent 之间的选择层。它应该输出紧凑的 capability brief，而不是把完整 registry 暴露给 agent。

推荐 brief 形状：

```ts
interface CapabilityBrief {
  intent: {
    domain: string;
    taskType: string;
    modalities: string[];
    riskLevel: "low" | "medium" | "high";
    expectedArtifactTypes: string[];
  };
  selectedSkills: CapabilitySummary[];
  selectedTools: CapabilitySummary[];
  selectedSenses: CapabilitySummary[];
  selectedActions: CapabilitySummary[];
  selectedVerifiers: CapabilitySummary[];
  selectedComponents: CapabilitySummary[];
  excludedCapabilities: Array<{ id: string; reason: string }>;
  verificationPolicy: {
    required: boolean;
    mode: "none" | "lightweight" | "automatic" | "human" | "hybrid";
    reason: string;
  };
  invocationBudget: {
    maxCandidates: number;
    maxDocsToLoad: number;
    maxContextTokens: number;
  };
}
```

broker 应结合确定性过滤和打分：

- 用户显式选择的 capability ids。
- skill domain 和 task type。
- 模态需求。
- 预期 artifact 类型。
- workspace artifacts 和 UI state。
- capability triggers 和 anti-triggers。
- 可靠性等级和 validation 状态。
- 风险策略。
- 验证策略和所需 verifier 强度。
- 成本和延迟。
- 必需配置是否可用。
- 历史任务成功或失败记录。

broker 应倾向于给 agent 很小的候选集。默认情况下，除非用户明确要求比较能力，不应暴露超过三个 skills、五个 tools、两个 senses、三个 actions、两个 verifiers 和三个 UI components。

## 能力摘要索引

每个 package 都应提供或生成一个紧凑摘要记录，供 broker 选择。

推荐字段：

```json
{
  "id": "local.vision-sense",
  "kind": "sense",
  "oneLine": "Pure-vision GUI action planning and grounding.",
  "domains": ["gui", "knowledge"],
  "triggers": ["screenshot", "click", "visual target", "GUI"],
  "antiTriggers": ["DOM inspection", "accessibility tree inspection"],
  "modalities": ["vision"],
  "producesArtifactTypes": ["trace", "computer-use-command"],
  "riskClass": "medium",
  "costClass": "high",
  "latencyClass": "high",
  "reliability": "schema-checked",
  "requiresNetwork": false,
  "requiredConfig": []
}
```

长文档、示例、provider 细节和安装说明应放在摘要之后，按需懒加载。

## 稳定 Sense ABI

Sense 即使内部实现变化，也应该对外暴露稳定的 request/result contract。

推荐请求：

```ts
interface SenseRequest {
  task: string;
  modalities: Array<{
    kind: string;
    ref: string;
    mimeType?: string;
    summary?: string;
  }>;
  constraints?: Record<string, unknown>;
  safetyPolicy?: {
    riskLevel: "low" | "medium" | "high";
    highRiskPolicy: "reject" | "require-confirmation" | "allow";
  };
}
```

推荐结果：

```ts
interface SenseResult {
  status: "ok" | "failed" | "needs-approval";
  text?: string;
  commands?: Array<Record<string, unknown>>;
  artifactRefs?: string[];
  traceRef?: string;
  compactSummary: string;
  diagnostics?: Record<string, unknown>;
}
```

Sense result 不应把截图、base64 payload、大日志或原始模型 transcript 内联到长期 agent context。大数据应保存为 artifact，并在上下文中只传轻量 ref 和紧凑摘要。

## 稳定 Verifier ABI

Verifier 即使内部实现变化，也应该对外暴露稳定的 request/result contract。

推荐请求：

```ts
interface VerificationRequest {
  goal: string;
  resultRefs: string[];
  artifactRefs: string[];
  traceRefs: string[];
  stateRefs?: string[];
  rubric?: string;
  verificationPolicy: {
    required: boolean;
    mode: "lightweight" | "automatic" | "human" | "hybrid";
    riskLevel: "low" | "medium" | "high";
  };
}
```

推荐结果：

```ts
interface VerificationResult {
  verdict: "pass" | "fail" | "uncertain" | "needs-human" | "unverified";
  reward?: number;
  confidence: number;
  critique?: string;
  evidenceRefs: string[];
  repairHints: string[];
  diagnostics?: Record<string, unknown>;
}
```

Verifier result 应进入下一轮上下文，帮助 agent 决定继续、修复、请求人类确认或结束。`unverified` 不是成功状态；它只表示当前风险和策略允许暂时不做强验证，最终对外呈现时必须能看见这个状态。

## UI Component 选择

UI component 应在 artifact 或 display intent 已知后选择。

推荐 manifest 字段：

- component id 和 version。
- 支持的 artifact types。
- 输入数据 schema。
- 组件会发出的 interaction events。
- 必需 assets 或 runtime dependencies。
- fallback renderer。
- preview fixtures 和 smoke tests。

UI component 应保持为 renderer 和 interaction surface。领域推理属于 skills 和 runtime。

## 文档加载策略

agent 应遵循以下加载顺序：

1. 读取 capability brief。
2. 选择少量候选 capability。
3. 只加载被选中 capability 的 `SKILL.md`、adapter schema 或 manifest。
4. 如果存在 runtime adapter，优先通过 adapter 执行。
5. 按 verification policy 选择 verifier 或记录 `unverified` 原因。
6. 将紧凑结果、verification result、artifact refs 和失败诊断加入上下文。

除非用户明确要求进行包研究或 registry 维护，agent 不应读取完整的 skills、tools、senses、actions、verifiers 或 UI component 目录。

## 安全和风险

所有 capability 都必须声明风险和副作用边界。

高风险例子包括发送消息、删除数据、支付、授权、对外发布、修改凭据、修改外部系统等。

规则：

- 高风险动作默认 fail closed。
- 用户 approval 必须是显式的，并附着到 runtime request。
- sense 和 tool 拒绝动作时，应提供 safety diagnostics。
- 高风险 action 的结果必须有 verifier 或 human approval，不能只依赖 action provider 自己声明成功。
- 对破坏性 workflow，优先提供 dry-run 或 preview 模式。

## 能力晋升路径

可复用行为应沿以下路径演进：

```text
一次性 generated task
  -> 多次成功的重复任务
  -> skill promotion proposal
  -> Markdown-first skill
  -> schema adapter，如果可靠性或 token 成本要求更高
  -> native runtime capability，如果安全、模态或 trace 控制要求更高
```

除非能力是关键、高频、高成本、安全敏感，或无法用 Markdown-first contract 稳定表达，否则不要一开始就写自定义胶水代码。

## 新能力接入检查表

新增 capability 前应确认：

- 它是 skill、tool、sense、UI component，还是 runtime package。
- 如果它会评价结果或提供 reward，应归入 verifier；如果它会改变环境，应归入 action。
- 选择 Level A、B 或 C 集成等级。
- 提供 broker 可用的紧凑摘要。
- 声明 triggers 和 anti-triggers。
- 声明 domains、modalities、预期 artifact types、成本、延迟和风险。
- 提供输入输出契约。
- 声明是否需要 verifier，以及默认 verification policy。
- 添加 smoke validation。
- 定义大输出的 compaction 行为。
- manifest 和文档中不要包含凭据或用户特定路径。
- 优先使用 artifact refs，而不是内联大 payload。

## 设计边界

broker 缩小注意力。agent 选择策略。adapter 稳定执行。runtime 校验、执行、验证、修复和压缩。

这个分离让 SciForge 可以持续增加能力，而不会让 agent 因工具过多而分散注意力；同时，对于 senses 这类关键系统，也能通过专门胶水代码获得稳定行为和更低 token 成本。
