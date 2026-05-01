# BioAgent - PROJECT.md

最后更新：2026-05-01

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；BioAgent 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；BioAgent 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 seed skill 候选。
- 开发者不应为一次任务缺口手工写死专用科研脚本；只能补通用协议、权限、安全边界、runner 能力、context contract、promotion 机制和 UI/artifact contract。
- TypeScript 主要负责 Web UI、workspace writer、artifact/session 协议、组件 registry 和轻量编排；科学任务执行代码优先作为 workspace-local Python/R/notebook/CLI artifact 生成。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。

## 任务板



### T056 Turn Acceptance Gate、自动修复与最终回复对象引用

状态：已完成首版（已接入通用 `UserGoalSnapshot`、确定性 `TurnAcceptanceGate`、展示层自动修复、最终回复 objectReferences 抽取、右侧文件预览和 contract/test 覆盖；语义验收和深度 backend rerun repair 作为后续增强）。

#### 背景
- 当前多轮机制已经能携带 recent messages、artifacts、runs、ExecutionUnit、失败原因和用户点选 references，但“完成”更多依赖协议状态，而不是用户本轮真实目标是否被满足。
- 用户要 Markdown 报告却看到 JSON、用户要继续上一轮却无意重跑、用户点选对象但回答未使用该引用，这些都属于“协议成功但用户目标失败”。
- Agent 最终回复经常包含生成产物路径，例如 `.bioagent/tasks/.../report.md`、`.csv`、`.pdf`、文件夹或 task result JSON；这些路径应该自动变成可点击 object/reference chip，点击后在右侧结果视图打开具体内容，而不是只作为纯文本。

#### 目标
- 每一轮对话都生成 `UserGoalSnapshot`：记录用户要的结果类型、格式、引用对象、时效要求、必须产出的 artifact/UI、可接受的 fallback 和明确的完成条件。
- 每一轮 backend 返回后先经过 `TurnAcceptanceGate`：判断最终回复、artifacts、ExecutionUnit、object refs 和右侧 UI 是否满足 `UserGoalSnapshot`。
- 若验收失败，系统自动生成 repair request，带上失败项、原始目标、当前 refs/logs/artifacts，并在预算内自动修复；修复失败时返回 `failed-with-reason`，不把半成品包装成成功。
- 最终回复中的路径、artifact id、run id、execution unit id、URL 和 workspace refs 自动归一化为 `ObjectReference` / `BioAgentReference`，用户点击即可聚焦右侧结果、打开文件预览或进入 Artifact Inspector。

#### 通用 Contract 草案
```ts
type UserGoalSnapshot = {
  turnId: string;
  rawPrompt: string;
  goalType: 'answer' | 'report' | 'analysis' | 'visualization' | 'file' | 'repair' | 'continuation' | 'workflow';
  requiredFormats: string[];
  requiredArtifacts: string[];
  requiredReferences: string[];
  freshness?: { kind: 'today' | 'latest' | 'current-session' | 'prior-run'; date?: string };
  uiExpectations: string[];
  acceptanceCriteria: string[];
};

type TurnAcceptance = {
  pass: boolean;
  severity: 'pass' | 'warning' | 'repairable' | 'failed';
  checkedAt: string;
  failures: Array<{ code: string; detail: string; repairAction?: string }>;
  objectReferences: ObjectReference[];
  repairPrompt?: string;
};
```

#### 验收规则
- 报告类请求：必须有可读 `research-report` / Markdown 正文 / `.md` ref；默认报告视图不能展示 ToolPayload JSON、raw artifacts 或诊断过程。
- 文件类请求：必须有可解析 workspace file/folder ref，文件存在且类型可预览或可安全打开。
- 可视化类请求：必须有匹配 UI module 或明确 `blocked-awaiting-ui-design`，不能用空卡片伪装成功。
- 继续/修复类请求：必须引用上一轮 run/artifact/execution refs，不能无依据开始无关新任务。
- 点选引用请求：最终请求上下文、Agent 回复和结果对象必须保留被点选 references。
- 路径引用：最终回复中的 `.bioagent/...`、workspace path、artifact id、run id、execution-unit id、URL 自动变成 object chips；点击默认右侧聚焦，文件内容优先用内置 viewer/inspector 展示。
- 高风险或不可读对象：显示明确 blocker、原因和 recoverActions，不自动执行脚本或打开危险文件。

#### 自动修复策略
- `presentation-repair`：结果存在但展示错误，例如报告正文被 JSON 包住、UI module 绑定错、路径未引用化；优先前端/normalizer 修复。
- `artifact-repair`：回答有结论但缺少要求格式或文件，例如没有 `.md`、表格、图；向 AgentServer 请求补 artifact。
- `execution-repair`：任务本身未完成，例如下载失败、全文未读、代码报错；走已有 repair/rerun，并保留 failureReason、stdout/stderr、codeRef。
- 每轮自动 repair 默认最多 1-2 次；超过预算后把验收失败项作为用户可见诊断和下一步建议。

#### TODO
- [x] 定义 `UserGoalSnapshot` / `TurnAcceptance` TypeScript 类型和 runtime schema，写入 run raw 与 session history。
- [x] 在发送请求前从 prompt、点选 references、scenario/output contract、recent conversation 生成 `UserGoalSnapshot`。
- [x] 实现确定性 `TurnAcceptanceGate`：检查 artifacts、files、Markdown、references 和 raw JSON/ToolPayload 泄漏。
- [x] 接入最终回复路径抽取：把 `.bioagent/...`、workspace 文件、artifact/run/execution refs 和 URL 自动转为 `objectReferences`。
- [x] 点击最终回复里的文件/path object chip 时，右侧结果视图读取并展示文件内容；Markdown/CSV/TSV/HTML/JSON 走内置 viewer，PDF/图片等走安全提示和系统打开 fallback。
- [x] 若 acceptance 失败但可修复，自动执行 presentation repair，并在 `repairPrompt` 中记录 artifact/execution repair 所需失败项和期望产物。
- [x] 为自动修复增加预算和防循环机制：记录 `repairAttempt`、failure codes 和 repair action，不在同一轮无限重试。
- [ ] 后续增强：接入语义验收，由 backend 判断最终回答是否满足用户目标，但 BioAgent 保留确定性 gate 的否决权。
- [ ] 后续增强：artifact/execution repair 可在用户允许或后台预算满足时自动触发第二次 AgentServer rerun，而不仅记录 `repairPrompt`。
- [x] 增加单测：用户要求 Markdown 报告，backend 返回 JSON 包裹路径，系统自动生成可点击文件引用并避免 raw JSON 默认呈现。
- [x] 增加单测：用户最终回复包含 `.csv` / `.md` 路径，路径自动变 chip，优先展示报告路径。
- [ ] 后续增强：补 browser E2E 覆盖点选历史消息/图表后追问、右侧结果聚焦和真实文件预览。
