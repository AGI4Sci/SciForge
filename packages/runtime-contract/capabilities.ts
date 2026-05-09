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
      detailRef: 'packages/observe/vision/README.md',
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
      detailRef: 'docs/Extending.md#verifier-contract',
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
      detailRef: 'docs/Extending.md#verifier-contract',
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
      detailRef: 'docs/Extending.md#安全与晋升',
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
      detailRef: 'docs/Extending.md#verifier-contract',
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
