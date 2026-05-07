export type CapabilityCategory = 'observe' | 'reasoning' | 'action' | 'verify' | 'interactive-view';
export type CapabilityKind = 'sense' | 'skill' | 'tool' | 'action' | 'verifier' | 'interactive-view';
export type CapabilityRiskLevel = 'low' | 'medium' | 'high';
export type CapabilityCostClass = 'low' | 'medium' | 'high';
export type CapabilityReliability = 'metadata-only' | 'schema-checked' | 'validated' | 'human';

export interface CapabilitySummary {
  id: string;
  kind: CapabilityKind;
  category: CapabilityCategory;
  oneLine: string;
  domains: string[];
  triggers: string[];
  antiTriggers: string[];
  modalities: string[];
  producesArtifactTypes: string[];
  riskClass: CapabilityRiskLevel;
  costClass: CapabilityCostClass;
  latencyClass: CapabilityCostClass;
  reliability: CapabilityReliability;
  requiresNetwork: boolean;
  requiredConfig: string[];
  sideEffects?: string[];
  verifierTypes?: Array<'human' | 'agent' | 'schema' | 'environment' | 'simulator' | 'reward-model'>;
  detailRef?: string;
}

export interface CapabilityContract {
  id: string;
  schemaVersion: string;
  invocation?: Record<string, unknown>;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  safetyContract?: Record<string, unknown>;
  traceContract?: Record<string, unknown>;
  verifierContract?: Record<string, unknown>;
}

export interface CapabilityRegistryEntry {
  summary: CapabilitySummary;
  loadContract: () => CapabilityContract | Promise<CapabilityContract>;
}

export interface CapabilityRegistry {
  listBriefs(category?: CapabilityCategory): CapabilitySummary[];
  getBrief(id: string): CapabilitySummary | undefined;
  loadContract(id: string): Promise<CapabilityContract | undefined>;
}

export type VerificationMode = 'none' | 'lightweight' | 'automatic' | 'human' | 'hybrid' | 'unverified';

export interface VerificationPolicy {
  required: boolean;
  mode: VerificationMode;
  riskLevel: CapabilityRiskLevel;
  humanApprovalRequired: boolean;
  selectedVerifierIds: string[];
  reason: string;
  unverifiedReason?: string;
}

export interface VerificationBrief {
  schemaVersion: 'sciforge.verification-brief.v1';
  policy: VerificationPolicy;
  verifierBriefs: CapabilitySummary[];
  riskSignals: string[];
}

export interface CapabilityBrief {
  schemaVersion: 'sciforge.capability-brief.v1';
  intent: {
    domain: string;
    taskType: string;
    modalities: string[];
    riskLevel: CapabilityRiskLevel;
    expectedArtifactTypes: string[];
  };
  selectedSkills: CapabilitySummary[];
  selectedTools: CapabilitySummary[];
  selectedSenses: CapabilitySummary[];
  selectedActions: CapabilitySummary[];
  selectedVerifiers: CapabilitySummary[];
  selectedComponents: CapabilitySummary[];
  excludedCapabilities: Array<{ id: string; reason: string }>;
  verificationPolicy: VerificationPolicy;
  verificationBrief: VerificationBrief;
  invocationBudget: {
    maxCandidates: number;
    maxDocsToLoad: number;
    maxContextTokens: number;
  };
  loadingPolicy: {
    briefOnly: true;
    contractLoading: 'lazy-selected-capabilities-only';
  };
}

export interface BuildCapabilityBriefInput {
  prompt: string;
  domain: string;
  expectedArtifactTypes?: string[];
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  selectedSenseIds?: string[];
  selectedActionIds?: string[];
  selectedVerifierIds?: string[];
  selectedComponentIds?: string[];
  riskLevel?: CapabilityRiskLevel;
  actionSideEffects?: string[];
  userExplicitVerification?: VerificationMode;
  summaries?: CapabilitySummary[];
}

const CATEGORY_LIMITS: Record<CapabilityCategory, number> = {
  observe: 2,
  reasoning: 3,
  action: 3,
  verify: 2,
  'interactive-view': 3,
};

export function createCapabilityRegistry(entries: CapabilityRegistryEntry[]): CapabilityRegistry {
  const byId = new Map(entries.map((entry) => [entry.summary.id, entry]));
  return {
    listBriefs(category?: CapabilityCategory) {
      return entries
        .map((entry) => entry.summary)
        .filter((summary) => !category || summary.category === category)
        .map(compactCapabilitySummary);
    },
    getBrief(id: string) {
      const summary = byId.get(id)?.summary;
      return summary ? compactCapabilitySummary(summary) : undefined;
    },
    async loadContract(id: string) {
      const entry = byId.get(id);
      return entry ? await entry.loadContract() : undefined;
    },
  };
}

export function buildCapabilityBrief(input: BuildCapabilityBriefInput): CapabilityBrief {
  const summaries = (input.summaries ?? defaultCapabilitySummaries()).map(compactCapabilitySummary);
  const expectedArtifactTypes = uniqueStrings(input.expectedArtifactTypes ?? []);
  const modalities = inferModalities(input.prompt, summaries);
  const risk = input.riskLevel ?? inferRiskLevel(input.prompt, input.actionSideEffects ?? [], expectedArtifactTypes);
  const selectedSenses = selectByCategory(summaries, 'observe', input, input.selectedSenseIds);
  const selectedReasoning = selectByCategory(summaries, 'reasoning', input, [
    ...(input.selectedSkillIds ?? []),
    ...(input.selectedToolIds ?? []),
  ]);
  const selectedActions = selectByCategory(summaries, 'action', input, input.selectedActionIds);
  const selectedComponents = selectByCategory(summaries, 'interactive-view', input, input.selectedComponentIds);
  const verifierSelection = selectVerifiers(summaries, input, risk, expectedArtifactTypes);
  const selectedVerifiers = verifierSelection.verifiers;
  const verificationPolicy = verifierSelection.policy;
  const selectedIds = new Set([
    ...selectedSenses,
    ...selectedReasoning,
    ...selectedActions,
    ...selectedComponents,
    ...selectedVerifiers,
  ].map((item) => item.id));
  return {
    schemaVersion: 'sciforge.capability-brief.v1',
    intent: {
      domain: input.domain,
      taskType: inferTaskType(input.prompt, expectedArtifactTypes),
      modalities,
      riskLevel: risk,
      expectedArtifactTypes,
    },
    selectedSkills: selectedReasoning.filter((item) => item.kind === 'skill'),
    selectedTools: selectedReasoning.filter((item) => item.kind === 'tool'),
    selectedSenses,
    selectedActions,
    selectedVerifiers,
    selectedComponents,
    excludedCapabilities: summaries
      .filter((summary) => !selectedIds.has(summary.id))
      .slice(0, 12)
      .map((summary) => ({ id: summary.id, reason: '未进入当前紧凑候选预算或与任务意图不匹配。' })),
    verificationPolicy,
    verificationBrief: {
      schemaVersion: 'sciforge.verification-brief.v1',
      policy: verificationPolicy,
      verifierBriefs: selectedVerifiers,
      riskSignals: verifierSelection.riskSignals,
    },
    invocationBudget: {
      maxCandidates: 13,
      maxDocsToLoad: Math.max(1, selectedIds.size),
      maxContextTokens: 1600,
    },
    loadingPolicy: {
      briefOnly: true,
      contractLoading: 'lazy-selected-capabilities-only',
    },
  };
}

export function defaultCapabilityRegistry(): CapabilityRegistry {
  return createCapabilityRegistry(defaultCapabilitySummaries().map((summary) => ({
    summary,
    loadContract: () => ({
      id: summary.id,
      schemaVersion: 'sciforge.capability-contract.v1',
      invocation: { loadPolicy: 'on-selected-only' },
      safetyContract: {
        riskClass: summary.riskClass,
        sideEffects: summary.sideEffects ?? [],
      },
      verifierContract: summary.kind === 'verifier'
        ? { verifierTypes: summary.verifierTypes ?? [], evidence: 'refs-and-compact-critique' }
        : undefined,
    }),
  })));
}

export function defaultCapabilitySummaries(): CapabilitySummary[] {
  return [
    {
      id: 'skill.agentserver-generation',
      kind: 'skill',
      category: 'reasoning',
      oneLine: '让 AgentServer 基于当前 scenario、refs 和 artifact contract 生成或修复 workspace task。',
      domains: ['literature', 'structure', 'omics', 'knowledge'],
      triggers: ['analyze', 'generate', 'repair', 'report', '分析', '生成', '修复', '报告'],
      antiTriggers: [],
      modalities: ['text'],
      producesArtifactTypes: ['tool-payload', 'execution-unit', 'artifact'],
      riskClass: 'medium',
      costClass: 'medium',
      latencyClass: 'medium',
      reliability: 'schema-checked',
      requiresNetwork: false,
      requiredConfig: [],
      detailRef: 'src/runtime/generation-gateway.ts',
    },
    {
      id: 'sense.vision',
      kind: 'sense',
      category: 'observe',
      oneLine: '将截图、图像或 GUI 状态压缩成可推理的文字观察。',
      domains: ['gui', 'knowledge', 'structure', 'omics', 'literature'],
      triggers: ['screenshot', 'image', 'visual', 'GUI', '截图', '图像', '界面'],
      antiTriggers: ['text only', '纯文本'],
      modalities: ['image', 'vision'],
      producesArtifactTypes: ['observation', 'trace'],
      riskClass: 'low',
      costClass: 'high',
      latencyClass: 'high',
      reliability: 'schema-checked',
      requiresNetwork: false,
      requiredConfig: [],
      detailRef: 'packages/senses/vision-sense/README.md',
    },
    {
      id: 'action.workspace-task',
      kind: 'action',
      category: 'action',
      oneLine: '在当前 workspace 中生成或执行任务代码，写入 artifact、日志和 trace refs。',
      domains: ['literature', 'structure', 'omics', 'knowledge'],
      triggers: ['run', 'execute', 'generate', 'analyze', '执行', '运行', '分析', '生成'],
      antiTriggers: ['read only', '只读'],
      modalities: ['text'],
      producesArtifactTypes: ['tool-payload', 'execution-unit', 'trace'],
      riskClass: 'medium',
      costClass: 'medium',
      latencyClass: 'medium',
      reliability: 'schema-checked',
      requiresNetwork: false,
      requiredConfig: [],
      sideEffects: ['workspace-write'],
      detailRef: 'src/runtime/workspace-task-runner.ts',
    },
    {
      id: 'verifier.schema-artifact',
      kind: 'verifier',
      category: 'verify',
      oneLine: '用 schema、artifact contract、lint 或单测做轻量自动校验。',
      domains: ['literature', 'structure', 'omics', 'knowledge', 'workspace'],
      triggers: ['schema', 'json', 'test', 'validate', '校验', '测试', '验证'],
      antiTriggers: [],
      modalities: ['text', 'json'],
      producesArtifactTypes: ['verification-result'],
      riskClass: 'low',
      costClass: 'low',
      latencyClass: 'low',
      reliability: 'validated',
      requiresNetwork: false,
      requiredConfig: [],
      verifierTypes: ['schema'],
      detailRef: 'docs/CapabilityIntegrationStandard.md#稳定-verifier-abi',
    },
    {
      id: 'verifier.agent-rubric',
      kind: 'verifier',
      category: 'verify',
      oneLine: '用 rubric 让独立 agent 审查结果、trace、证据和修复建议。',
      domains: ['literature', 'structure', 'omics', 'knowledge', 'workspace'],
      triggers: ['review', 'rubric', 'critique', 'scientific claim', '审查', '科研结论', '证据'],
      antiTriggers: [],
      modalities: ['text', 'json'],
      producesArtifactTypes: ['verification-result', 'critique'],
      riskClass: 'medium',
      costClass: 'medium',
      latencyClass: 'medium',
      reliability: 'schema-checked',
      requiresNetwork: false,
      requiredConfig: [],
      verifierTypes: ['agent'],
      detailRef: 'docs/CapabilityIntegrationStandard.md#稳定-verifier-abi',
    },
    {
      id: 'verifier.environment-diff',
      kind: 'verifier',
      category: 'verify',
      oneLine: '根据文件系统、GUI 或外部状态 refs 验证 action 是否产生预期变化。',
      domains: ['gui', 'workspace', 'literature', 'structure', 'omics', 'knowledge'],
      triggers: ['file', 'diff', 'state', 'external', 'GUI', '文件', '状态', '副作用'],
      antiTriggers: [],
      modalities: ['text', 'json', 'state-ref'],
      producesArtifactTypes: ['verification-result', 'trace'],
      riskClass: 'medium',
      costClass: 'medium',
      latencyClass: 'medium',
      reliability: 'schema-checked',
      requiresNetwork: false,
      requiredConfig: [],
      verifierTypes: ['environment'],
      detailRef: 'docs/CapabilityIntegrationStandard.md#安全和风险',
    },
    {
      id: 'verifier.human-approval',
      kind: 'verifier',
      category: 'verify',
      oneLine: '把 accept、reject、revise、score 和 comment 转成标准 VerificationResult。',
      domains: ['literature', 'structure', 'omics', 'knowledge', 'workspace', 'gui'],
      triggers: ['approve', 'human', 'confirm', 'manual', '人工', '确认', '批准'],
      antiTriggers: [],
      modalities: ['human-feedback'],
      producesArtifactTypes: ['verification-result'],
      riskClass: 'high',
      costClass: 'high',
      latencyClass: 'high',
      reliability: 'human',
      requiresNetwork: false,
      requiredConfig: [],
      verifierTypes: ['human'],
      detailRef: 'docs/CLI_UI_Shared_Agent_Usage.md#verifiers',
    },
    {
      id: 'view.artifact-inspector',
      kind: 'interactive-view',
      category: 'interactive-view',
      oneLine: '为未知或通用 artifact 提供可检查的紧凑交互视图。',
      domains: ['literature', 'structure', 'omics', 'knowledge', 'workspace'],
      triggers: ['artifact', 'inspect', 'view', '预览', '查看', '产物'],
      antiTriggers: [],
      modalities: ['json', 'table'],
      producesArtifactTypes: ['interactive-view'],
      riskClass: 'low',
      costClass: 'low',
      latencyClass: 'low',
      reliability: 'validated',
      requiresNetwork: false,
      requiredConfig: [],
      detailRef: 'packages/ui-components/unknown-artifact-inspector/README.md',
    },
  ];
}

function selectByCategory(
  summaries: CapabilitySummary[],
  category: CapabilityCategory,
  input: BuildCapabilityBriefInput,
  explicitIds: string[] | undefined,
) {
  const explicit = new Set(explicitIds ?? []);
  return summaries
    .filter((summary) => summary.category === category)
    .filter((summary) => !summary.domains.length || summary.domains.includes(input.domain) || summary.domains.includes('workspace') || summary.domains.includes('gui'))
    .map((summary) => ({ summary, score: scoreCapability(summary, input, explicit) }))
    .filter((item) => item.score > 0 || explicit.has(item.summary.id))
    .sort((left, right) => right.score - left.score || left.summary.id.localeCompare(right.summary.id))
    .slice(0, CATEGORY_LIMITS[category])
    .map((item) => item.summary);
}

function selectVerifiers(
  summaries: CapabilitySummary[],
  input: BuildCapabilityBriefInput,
  risk: CapabilityRiskLevel,
  expectedArtifactTypes: string[],
) {
  const verifierSummaries = summaries.filter((summary) => summary.category === 'verify');
  const explicit = new Set(input.selectedVerifierIds ?? []);
  const sideEffects = uniqueStrings(input.actionSideEffects ?? []);
  const riskSignals = verificationRiskSignals(input.prompt, risk, sideEffects, expectedArtifactTypes);
  const humanRequested = input.userExplicitVerification === 'human'
    || hasAnyPromptToken(input.prompt, ['human', 'approve', 'approval', 'confirm', '人工', '确认', '批准']);
  const noVerificationRequested = input.userExplicitVerification === 'none'
    || hasAnyPromptToken(input.prompt, ['unverified', 'skip verification', '不验证', '跳过验证']);
  let required = risk !== 'low' || explicit.size > 0 || humanRequested || scientificClaimArtifact(expectedArtifactTypes);
  const highRisk = risk === 'high' || sideEffects.some(highRiskSideEffect);
  if (highRisk) required = true;
  if (noVerificationRequested && !highRisk) required = false;

  const wantedTypes = new Set<string>();
  if (humanRequested || highRisk) wantedTypes.add('human');
  if (sideEffects.length) wantedTypes.add('environment');
  if (scientificClaimArtifact(expectedArtifactTypes) || risk === 'medium') wantedTypes.add('agent');
  if (!highRisk) wantedTypes.add('schema');

  const verifiers = verifierSummaries
    .map((summary) => {
      const types = summary.verifierTypes ?? [];
      const typeScore = types.filter((type) => wantedTypes.has(type)).length * 20;
      const explicitScore = explicit.has(summary.id) ? 100 : 0;
      return { summary, score: explicitScore + typeScore + scoreCapability(summary, input, explicit) };
    })
    .filter((item) => item.score > 0 || explicit.has(item.summary.id))
    .sort((left, right) => right.score - left.score || left.summary.id.localeCompare(right.summary.id))
    .slice(0, CATEGORY_LIMITS.verify)
    .map((item) => item.summary);

  const hasVerifier = verifiers.length > 0;
  const humanApprovalRequired = highRisk && !verifiers.some((summary) => summary.verifierTypes?.includes('human'));
  const mode = verificationMode({
    risk,
    required,
    hasVerifier,
    humanRequested,
    humanApprovalRequired,
    sideEffects,
    explicitMode: input.userExplicitVerification,
  });
  const unverifiedReason = !required && mode === 'none'
    ? '低风险草稿或用户显式允许跳过验证，且未检测到高风险副作用；后续对外发布前仍需补充验证。'
    : undefined;
  return {
    verifiers,
    riskSignals,
    policy: {
      required,
      mode,
      riskLevel: risk,
      humanApprovalRequired,
      selectedVerifierIds: verifiers.map((summary) => summary.id),
      reason: verificationReason({ risk, required, mode, highRisk, humanRequested, sideEffects, expectedArtifactTypes, hasVerifier }),
      unverifiedReason,
    } satisfies VerificationPolicy,
  };
}

function verificationMode(params: {
  risk: CapabilityRiskLevel;
  required: boolean;
  hasVerifier: boolean;
  humanRequested: boolean;
  humanApprovalRequired: boolean;
  sideEffects: string[];
  explicitMode?: BuildCapabilityBriefInput['userExplicitVerification'];
}): VerificationMode {
  if (params.explicitMode && params.explicitMode !== 'none') return params.explicitMode;
  if (!params.required) return params.hasVerifier ? 'lightweight' : 'none';
  if (params.humanRequested || params.humanApprovalRequired) return params.hasVerifier ? 'hybrid' : 'human';
  if (params.risk === 'high') return params.hasVerifier ? 'hybrid' : 'human';
  if (params.sideEffects.length) return 'automatic';
  return params.hasVerifier ? 'automatic' : 'lightweight';
}

function verificationReason(params: {
  risk: CapabilityRiskLevel;
  required: boolean;
  mode: VerificationMode;
  highRisk: boolean;
  humanRequested: boolean;
  sideEffects: string[];
  expectedArtifactTypes: string[];
  hasVerifier: boolean;
}) {
  if (!params.required) return '当前任务按风险策略允许轻量或未验证，但必须记录 unverified 原因。';
  if (params.humanRequested) return '用户显式要求人工确认，因此 verification policy 选择 human/hybrid。';
  if (params.highRisk) return '检测到高风险等级或高风险副作用，action 结果必须有 verifier 或 human approval。';
  if (params.sideEffects.length) return `检测到 action side effects: ${params.sideEffects.join(', ')}，需要自动验证环境或 trace。`;
  if (scientificClaimArtifact(params.expectedArtifactTypes)) return '预期产物包含科研结论或报告，需要 verifier 审查证据和 artifact contract。';
  return params.hasVerifier ? '已按风险和产物类型选择 verifier。' : '未找到合适 verifier，按策略保留轻量验证要求。';
}

function verificationRiskSignals(prompt: string, risk: CapabilityRiskLevel, sideEffects: string[], expectedArtifactTypes: string[]) {
  return uniqueStrings([
    `riskLevel:${risk}`,
    ...sideEffects.map((effect) => `sideEffect:${effect}`),
    ...expectedArtifactTypes.map((type) => `artifact:${type}`),
    ...(hasAnyPromptToken(prompt, ['publish', 'delete', 'payment', 'credential', '授权', '发布', '删除', '支付', '凭据']) ? ['prompt:high-risk-action'] : []),
  ]);
}

function scoreCapability(summary: CapabilitySummary, input: BuildCapabilityBriefInput, explicit: Set<string>) {
  let score = explicit.has(summary.id) ? 100 : 0;
  if (summary.domains.includes(input.domain)) score += 20;
  if (input.expectedArtifactTypes?.some((type) => summary.producesArtifactTypes.includes(type))) score += 12;
  const prompt = input.prompt.toLowerCase();
  for (const trigger of summary.triggers) {
    if (trigger && prompt.includes(trigger.toLowerCase())) score += 6;
  }
  for (const antiTrigger of summary.antiTriggers) {
    if (antiTrigger && prompt.includes(antiTrigger.toLowerCase())) score -= 30;
  }
  if (summary.riskClass === 'low') score += 1;
  return score;
}

function compactCapabilitySummary(summary: CapabilitySummary): CapabilitySummary {
  return {
    id: summary.id,
    kind: summary.kind,
    category: summary.category,
    oneLine: summary.oneLine,
    domains: uniqueStrings(summary.domains),
    triggers: uniqueStrings(summary.triggers).slice(0, 8),
    antiTriggers: uniqueStrings(summary.antiTriggers).slice(0, 6),
    modalities: uniqueStrings(summary.modalities),
    producesArtifactTypes: uniqueStrings(summary.producesArtifactTypes),
    riskClass: summary.riskClass,
    costClass: summary.costClass,
    latencyClass: summary.latencyClass,
    reliability: summary.reliability,
    requiresNetwork: summary.requiresNetwork,
    requiredConfig: uniqueStrings(summary.requiredConfig),
    sideEffects: uniqueStrings(summary.sideEffects ?? []),
    verifierTypes: summary.verifierTypes ? [...summary.verifierTypes] : undefined,
    detailRef: summary.detailRef,
  };
}

function inferModalities(prompt: string, summaries: CapabilitySummary[]) {
  const values = new Set<string>(['text']);
  if (hasAnyPromptToken(prompt, ['screenshot', 'image', 'visual', 'GUI', '截图', '图像', '界面'])) values.add('image');
  for (const summary of summaries) {
    if (summary.category === 'observe' && summary.triggers.some((trigger) => prompt.toLowerCase().includes(trigger.toLowerCase()))) {
      for (const modality of summary.modalities) values.add(modality);
    }
  }
  return [...values];
}

function inferRiskLevel(prompt: string, sideEffects: string[], expectedArtifactTypes: string[]): CapabilityRiskLevel {
  if (sideEffects.some(highRiskSideEffect)) return 'high';
  if (hasAnyPromptToken(prompt, ['delete', 'publish', 'payment', 'credential', 'send', 'authorization', '删除', '发布', '支付', '凭据', '发送', '授权'])) return 'high';
  if (sideEffects.length || scientificClaimArtifact(expectedArtifactTypes)) return 'medium';
  if (hasAnyPromptToken(prompt, ['draft', 'preview', 'sketch', '草稿', '预览'])) return 'low';
  return 'medium';
}

function inferTaskType(prompt: string, expectedArtifactTypes: string[]) {
  if (expectedArtifactTypes.length) return `artifact:${expectedArtifactTypes.slice(0, 3).join(',')}`;
  if (hasAnyPromptToken(prompt, ['inspect', 'view', '查看', '检查'])) return 'inspection';
  if (hasAnyPromptToken(prompt, ['write', 'edit', 'generate', '修改', '生成', '写'])) return 'generation';
  return 'analysis';
}

function scientificClaimArtifact(types: string[]) {
  return types.some((type) => /\b(report|claim|evidence|paper|analysis|statistical|knowledge|structure|omics)\b/i.test(type));
}

function highRiskSideEffect(effect: string) {
  return /\b(delete|publish|payment|credential|external-write|send|authorize|lab-device|destructive)\b/i.test(effect);
}

function hasAnyPromptToken(prompt: string, tokens: string[]) {
  const lower = prompt.toLowerCase();
  return tokens.some((token) => lower.includes(token.toLowerCase()));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
