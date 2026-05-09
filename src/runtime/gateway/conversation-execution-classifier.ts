export type ExecutionMode =
  | 'direct-context-answer'
  | 'thin-reproducible-adapter'
  | 'single-stage-task'
  | 'multi-stage-project'
  | 'repair-or-continue-project';

export type ReproducibilityLevel = 'none' | 'light' | 'full' | 'staged';

type JsonMap = Record<string, unknown>;

export interface ExecutionClassifierInput {
  prompt: string;
  refs: unknown[];
  artifacts: JsonMap[];
  expectedArtifactTypes: string[];
  selectedCapabilities: unknown[];
  selectedTools: unknown[];
  selectedSenses: unknown[];
  selectedVerifiers: unknown[];
  recentFailures: unknown[];
  priorAttempts: unknown[];
  userGuidanceQueue: unknown[];
}

export interface ExecutionModeDecision {
  executionMode: ExecutionMode;
  complexityScore: number;
  uncertaintyScore: number;
  reproducibilityLevel: ReproducibilityLevel;
  stagePlanHint: string[];
  reason: string;
  riskFlags: string[];
  signals: string[];
}

const SIGNAL = {
  repair: 'repair',
  continuation: 'continuation',
  midRunGuidance: ['mid', 'run', 'guidance'].join('-'),
  lightLookup: ['light', 'lookup'].join('-'),
  research: 'research',
  systematicResearch: ['systematic', 'research'].join('-'),
  fullText: ['full', 'text'].join('-'),
  codeChange: ['code', 'change'].join('-'),
  fileWork: ['file', 'work'].join('-'),
  deliverableOutput: ['artifact', 'output'].join('-'),
  multiStep: ['multi', 'step'].join('-'),
  longOrUncertain: ['long', 'or', 'uncertain'].join('-'),
  directQuestion: ['direct', 'question'].join('-'),
  hasRefs: ['has', 'refs'].join('-'),
  hasArtifacts: ['has', 'artifacts'].join('-'),
  selectedAction: ['selected', 'action'].join('-'),
  externalAction: ['external', 'action'].join('-'),
  multiProvider: ['multi', 'provider'].join('-'),
  verifier: 'verifier',
  sense: 'sense',
  multiArtifact: ['multi', 'artifact'].join('-'),
} as const;

const RISK = {
  externalInformationRequired: ['external', 'information', 'required'].join('-'),
  multiProviderCoordination: ['multi', 'provider', 'coordination'].join('-'),
  fullTextOrLargeFetch: ['full', 'text', 'or', 'large', 'fetch'].join('-'),
  codeOrWorkspaceSideEffect: ['code', 'or', 'workspace', 'side', 'effect'].join('-'),
  multiArtifactOutput: ['multi', 'artifact', 'output'].join('-'),
  recentFailure: ['recent', 'failure'].join('-'),
  midRunGuidance: ['mid', 'run', 'guidance'].join('-'),
  longRunningOrOpenEnded: ['long', 'running', 'or', 'open', 'ended'].join('-'),
  highUncertainty: ['high', 'uncertainty'].join('-'),
  needsWorkspaceDiscovery: ['needs', 'workspace', 'discovery'].join('-'),
} as const;

const REPAIR_HINTS = hintPattern(['repair', 'fix', 'debug', 'failed', 'failure', 'error', 'retry', 'rerun', 'broken'], ['修复', '失败', '报错', '重试', '重跑', '排查']);
const CONTINUE_HINTS = hintPattern(['continue', 'follow[- ]?up', 'previous', 'prior', 'last', 'next stage', 'resume'], ['继续', '接着', '上一轮', '刚才', '前面', '下一步', '下一阶段']);
const GUIDANCE_HINTS = hintPattern(['instead', 'change', 'adjust', 'only', 'exclude', 'include', 'while running', 'mid[- ]?run', 'constraint'], ['改成', '调整', '只要', '不要', '运行中', '中途', '追加', '约束']);
const LIGHT_LOOKUP_HINTS = hintPattern(['search', 'lookup', 'find', 'latest', 'recent', 'current', 'today', 'news', 'status', 'brief'], ['搜索', '搜一下', '查一下', '查找', '最新', '最近', '当前', '今天', '新闻', '简要']);
const RESEARCH_HINTS = hintPattern(['research', lit(['liter', 'ature'].join('')), lit('paper'), 'papers', 'scholar', 'sources', 'citations?'], ['调研', '文献', '论文', '引用', '来源']);
const SYSTEMATIC_RESEARCH_HINTS = hintPattern(['systematic', 'survey', 'review', 'compare', 'evidence table', 'matrix', 'synthesis', 'meta[- ]?analysis'], ['系统性', '综述', '比较', '证据表', '矩阵', '综合']);
const FULL_TEXT_HINTS = hintPattern(['download', 'fetch', 'retrieve', 'full[- ]?text', 'pdf', 'crawl', 'read\\s+the\\s+whole', 'entire'], ['下载', '抓取', '全文', '通读', '阅读全文', '整篇']);
const CODE_HINTS = hintPattern(['code', 'modify', 'edit', 'patch', 'implement', 'refactor', 'test', 'bug', 'script', 'notebook'], ['代码', '修改', '实现', '重构', '测试', '脚本', '笔记本']);
const FILE_HINTS = hintPattern(['file', 'path', 'folder', 'directory', 'repo', 'workspace', 'inspect', 'explore', 'read'], ['文件', '路径', '目录', '仓库', '工作区', '探索', '查看', '读取']);
const OUTPUT_HINTS = hintPattern(['artifact', 'output', 'csv', 'table', 'figure', 'chart', 'json', lit('markdown'), 'dataset', lit('report')], ['产物', '输出', '表格', '图表', '数据集', '报告']);
const MULTI_STEP_HINTS = hintPattern(['batch', 'pipeline', 'end[- ]?to[- ]?end', 'all', 'multiple', 'many', 'validate', 'then', 'and then'], ['批量', '流程', '全量', '多个', '全部', '验证', '然后']);
const LONG_OR_UNCERTAIN_HINTS = hintPattern(['long', 'large', 'open[- ]?ended', 'uncertain', 'unknown', 'hard', 'complex', 'comprehensive', 'exhaustive'], ['长时间', '大型', '开放式', '不确定', '未知', '复杂', '全面', '穷尽']);
const DIRECT_QUESTION_HINTS = hintPattern(['what is', 'who is', 'explain', 'define', 'why', 'how does', 'summari[sz]e', 'answer'], ['是什么', '解释', '为什么', '如何理解', '总结', '回答']);
const EXTERNAL_ACTION_HINTS = hintPattern(['search', 'fetch', 'download', 'browser', 'web', 'http', 'api', 'database', 'remote', 'scholar', lit(['liter', 'ature'].join(''))], ['搜索', '下载', '抓取', '文献']);

export function classifyExecutionMode(request: unknown): ExecutionModeDecision {
  const req = coerceInput(request);
  const text = req.prompt.trim().toLowerCase();
  const actionItems = selectedActionItems(req);

  const signals = collectSignals(req, actionItems, text);
  const complexity = complexityScore(req, actionItems, signals);
  const uncertainty = uncertaintyScore(req, actionItems, signals);
  const mode = selectMode(req, signals, complexity, uncertainty);
  const reproducibility = reproducibilityLevel(mode);
  const stagePlan = stagePlanHint(mode, signals);
  const riskFlags = riskFlagsFor(req, actionItems, signals, complexity, uncertainty);
  const reasonText = reason(mode, signals, complexity, uncertainty, riskFlags);

  return {
    executionMode: mode,
    complexityScore: complexity,
    uncertaintyScore: uncertainty,
    reproducibilityLevel: reproducibility,
    stagePlanHint: stagePlan,
    reason: reasonText,
    riskFlags,
    signals,
  };
}

export const classifyConversationExecutionMode = classifyExecutionMode;

function collectSignals(req: ExecutionClassifierInput, actionItems: unknown[], text: string): string[] {
  const signals: string[] = [];
  addIf(signals, SIGNAL.repair, Boolean(req.recentFailures.length) || hasFailedAttempt(req.priorAttempts) || REPAIR_HINTS.test(text));
  addIf(signals, SIGNAL.continuation, CONTINUE_HINTS.test(text) || hasActiveProjectArtifact(req.artifacts));
  addIf(signals, SIGNAL.midRunGuidance, Boolean(req.userGuidanceQueue.length) || (GUIDANCE_HINTS.test(text) && (CONTINUE_HINTS.test(text) || req.artifacts.length > 0)));
  addIf(signals, SIGNAL.lightLookup, LIGHT_LOOKUP_HINTS.test(text));
  addIf(signals, SIGNAL.research, RESEARCH_HINTS.test(text));
  addIf(signals, SIGNAL.systematicResearch, SYSTEMATIC_RESEARCH_HINTS.test(text));
  addIf(signals, SIGNAL.fullText, FULL_TEXT_HINTS.test(text));
  addIf(signals, SIGNAL.codeChange, CODE_HINTS.test(text));
  addIf(signals, SIGNAL.fileWork, FILE_HINTS.test(text));
  addIf(signals, SIGNAL.deliverableOutput, Boolean(req.expectedArtifactTypes.length) || OUTPUT_HINTS.test(text));
  addIf(signals, SIGNAL.multiStep, MULTI_STEP_HINTS.test(text));
  addIf(signals, SIGNAL.longOrUncertain, LONG_OR_UNCERTAIN_HINTS.test(text));
  addIf(signals, SIGNAL.directQuestion, DIRECT_QUESTION_HINTS.test(text));
  addIf(signals, SIGNAL.hasRefs, Boolean(req.refs.length));
  addIf(signals, SIGNAL.hasArtifacts, Boolean(req.artifacts.length));
  addIf(signals, SIGNAL.selectedAction, Boolean(actionItems.length));
  addIf(signals, SIGNAL.externalAction, hasExternalAction(actionItems));
  addIf(signals, SIGNAL.multiProvider, externalActionCount(actionItems) > 1);
  addIf(signals, SIGNAL.verifier, Boolean(req.selectedVerifiers.length));
  addIf(signals, SIGNAL.sense, Boolean(req.selectedSenses.length));
  addIf(signals, SIGNAL.multiArtifact, req.expectedArtifactTypes.length > 1);
  return signals;
}

function complexityScore(req: ExecutionClassifierInput, actionItems: unknown[], signals: string[]): number {
  let score = 0.06;
  const weights: Record<string, number> = {
    [SIGNAL.repair]: 0.34,
    [SIGNAL.continuation]: 0.28,
    [SIGNAL.midRunGuidance]: 0.18,
    [SIGNAL.lightLookup]: 0.12,
    [SIGNAL.research]: 0.18,
    [SIGNAL.systematicResearch]: 0.24,
    [SIGNAL.fullText]: 0.24,
    [SIGNAL.codeChange]: 0.24,
    [SIGNAL.fileWork]: 0.16,
    [SIGNAL.deliverableOutput]: 0.16,
    [SIGNAL.multiStep]: 0.22,
    [SIGNAL.longOrUncertain]: 0.24,
    [SIGNAL.hasRefs]: 0.04,
    [SIGNAL.hasArtifacts]: 0.06,
    [SIGNAL.selectedAction]: 0.06,
    [SIGNAL.externalAction]: 0.08,
    [SIGNAL.multiProvider]: 0.18,
    [SIGNAL.verifier]: 0.08,
    [SIGNAL.sense]: 0.06,
    [SIGNAL.multiArtifact]: 0.16,
  };
  for (const [signal, weight] of Object.entries(weights)) {
    if (signals.includes(signal)) score += weight;
  }
  score += Math.min(0.10, Math.max(0, req.refs.length - 3) * 0.025);
  score += Math.min(0.10, Math.max(0, actionItems.length - 2) * 0.035);
  score += Math.min(0.10, Math.max(0, req.priorAttempts.length - 1) * 0.035);
  if (signals.includes(SIGNAL.directQuestion) && !requiresExecution(signals)) score -= 0.08;
  return clampUnit(score);
}

function uncertaintyScore(req: ExecutionClassifierInput, _actionItems: unknown[], signals: string[]): number {
  let score = 0.08;
  const weights: Record<string, number> = {
    [SIGNAL.repair]: 0.16,
    [SIGNAL.continuation]: 0.16,
    [SIGNAL.midRunGuidance]: 0.16,
    [SIGNAL.lightLookup]: 0.14,
    [SIGNAL.research]: 0.18,
    [SIGNAL.systematicResearch]: 0.18,
    [SIGNAL.fullText]: 0.14,
    [SIGNAL.multiStep]: 0.14,
    [SIGNAL.longOrUncertain]: 0.24,
    [SIGNAL.externalAction]: 0.12,
    [SIGNAL.multiProvider]: 0.12,
    [SIGNAL.codeChange]: 0.06,
    [SIGNAL.verifier]: -0.04,
  };
  for (const [signal, weight] of Object.entries(weights)) {
    if (signals.includes(signal)) score += weight;
  }
  if (req.recentFailures.length) score += Math.min(0.18, 0.08 + req.recentFailures.length * 0.04);
  if (hasFailedAttempt(req.priorAttempts)) score += 0.10;
  if (signals.includes(SIGNAL.fileWork) && !req.refs.length && !req.artifacts.length) score += 0.12;
  if (signals.includes(SIGNAL.directQuestion) && !requiresExecution(signals)) score -= 0.06;
  return clampUnit(score);
}

function selectMode(req: ExecutionClassifierInput, signals: string[], complexity: number, uncertainty: number): ExecutionMode {
  if (signals.includes(SIGNAL.repair) || signals.includes(SIGNAL.continuation) || signals.includes(SIGNAL.midRunGuidance)) {
    return 'repair-or-continue-project';
  }
  if (isDirectContextAnswer(req, signals)) return 'direct-context-answer';
  if (isThinAdapter(signals, complexity)) return 'thin-reproducible-adapter';
  if (isMultiStage(signals, complexity, uncertainty)) return 'multi-stage-project';
  return 'single-stage-task';
}

function isDirectContextAnswer(req: ExecutionClassifierInput, signals: string[]): boolean {
  if (requiresExecution(signals)) return false;
  if (
    req.expectedArtifactTypes.length
    || selectedActionItems(req).length
    || req.recentFailures.length
    || req.userGuidanceQueue.length
  ) return false;
  return signals.includes(SIGNAL.directQuestion) || Boolean(req.refs.length || req.artifacts.length);
}

function isThinAdapter(signals: string[], complexity: number): boolean {
  if (!signals.includes(SIGNAL.lightLookup) && !(signals.includes(SIGNAL.research) && signals.includes(SIGNAL.externalAction))) return false;
  const heavy = new Set([
    SIGNAL.systematicResearch,
    SIGNAL.fullText,
    SIGNAL.codeChange,
    SIGNAL.fileWork,
    SIGNAL.deliverableOutput,
    SIGNAL.multiStep,
    SIGNAL.multiArtifact,
    SIGNAL.multiProvider,
    SIGNAL.longOrUncertain,
  ]);
  return complexity < 0.58 && !signals.some((signal) => heavy.has(signal));
}

function isMultiStage(signals: string[], complexity: number, uncertainty: number): boolean {
  if (complexity >= 0.66 || uncertainty >= 0.72) return true;
  if (signals.includes(SIGNAL.fullText)) return true;
  if (signals.includes(SIGNAL.multiProvider) || signals.includes(SIGNAL.multiArtifact) || signals.includes(SIGNAL.longOrUncertain)) return true;
  if (signals.includes(SIGNAL.systematicResearch) && (signals.includes(SIGNAL.research) || signals.includes(SIGNAL.externalAction))) return true;
  if (signals.includes(SIGNAL.research) && signals.includes(SIGNAL.multiStep)) return true;
  return false;
}

function requiresExecution(signals: string[]): boolean {
  const executionSignals = new Set([
    SIGNAL.lightLookup,
    SIGNAL.research,
    SIGNAL.systematicResearch,
    SIGNAL.fullText,
    SIGNAL.codeChange,
    SIGNAL.fileWork,
    SIGNAL.deliverableOutput,
    SIGNAL.multiStep,
    SIGNAL.longOrUncertain,
    SIGNAL.externalAction,
    SIGNAL.multiProvider,
    SIGNAL.verifier,
    SIGNAL.sense,
  ]);
  return signals.some((signal) => executionSignals.has(signal));
}

function reproducibilityLevel(mode: ExecutionMode): ReproducibilityLevel {
  if (mode === 'direct-context-answer') return 'none';
  if (mode === 'thin-reproducible-adapter') return 'light';
  if (mode === 'single-stage-task') return 'full';
  return 'staged';
}

function stagePlanHint(mode: ExecutionMode, signals: string[]): string[] {
  if (mode === 'direct-context-answer') return [];
  if (mode === 'thin-reproducible-adapter') {
    if (signals.includes(SIGNAL.research)) return ['search', 'emit'];
    return ['search', 'fetch', 'emit'];
  }
  if (mode === 'single-stage-task') {
    if (signals.includes(SIGNAL.codeChange)) return ['analyze', 'modify', 'validate', 'emit'];
    if (signals.includes(SIGNAL.fileWork)) return ['fetch', 'analyze', 'emit'];
    if (signals.includes(SIGNAL.fullText)) return ['fetch', 'emit'];
    return ['analyze', 'emit'];
  }
  if (mode === 'repair-or-continue-project') {
    const stages = ['fetch', 'analyze'];
    if (signals.includes(SIGNAL.repair)) stages.push('repair');
    if (signals.includes(SIGNAL.midRunGuidance)) stages.push('plan');
    stages.push('validate', 'emit');
    return dedupe(stages);
  }
  const stages = ['plan'];
  if (signals.includes(SIGNAL.research) || signals.includes(SIGNAL.lightLookup)) stages.push('search');
  if (signals.includes(SIGNAL.fullText) || signals.includes(SIGNAL.fileWork)) stages.push('fetch');
  stages.push('analyze', 'emit');
  if (signals.includes(SIGNAL.verifier) || signals.includes(SIGNAL.multiStep) || signals.includes(SIGNAL.systematicResearch)) {
    stages.push('validate');
  }
  return dedupe(stages);
}

function riskFlagsFor(
  req: ExecutionClassifierInput,
  actionItems: unknown[],
  signals: string[],
  complexity: number,
  uncertainty: number,
): string[] {
  const flags: string[] = [];
  addIf(flags, RISK.externalInformationRequired, signals.includes(SIGNAL.externalAction) || signals.includes(SIGNAL.lightLookup));
  addIf(flags, RISK.multiProviderCoordination, signals.includes(SIGNAL.multiProvider));
  addIf(flags, RISK.fullTextOrLargeFetch, signals.includes(SIGNAL.fullText));
  addIf(flags, RISK.codeOrWorkspaceSideEffect, signals.includes(SIGNAL.codeChange) || hasSideEffectAction(actionItems));
  addIf(flags, RISK.multiArtifactOutput, signals.includes(SIGNAL.multiArtifact));
  addIf(flags, RISK.recentFailure, Boolean(req.recentFailures.length) || hasFailedAttempt(req.priorAttempts));
  addIf(flags, RISK.midRunGuidance, signals.includes(SIGNAL.midRunGuidance));
  addIf(flags, RISK.longRunningOrOpenEnded, signals.includes(SIGNAL.longOrUncertain) || complexity >= 0.75);
  addIf(flags, RISK.highUncertainty, uncertainty >= 0.70);
  addIf(flags, RISK.needsWorkspaceDiscovery, signals.includes(SIGNAL.fileWork) && !req.refs.length && !req.artifacts.length);
  return flags;
}

function reason(mode: ExecutionMode, signals: string[], complexity: number, uncertainty: number, riskFlags: string[]): string {
  let signalText = signals.length ? signals.slice(0, 6).join(', ') : 'no execution-specific signals';
  if (signals.length > 6) signalText += ', ...';
  const riskText = riskFlags.length ? `; risks: ${riskFlags.slice(0, 3).join(', ')}` : '';
  return `${mode}: ${signalText}; complexity=${complexity.toFixed(2)}, uncertainty=${uncertainty.toFixed(2)}${riskText}.`;
}

function coerceInput(request: unknown): ExecutionClassifierInput {
  const data = recordValue(request) ?? objectMapping(request);
  return {
    prompt: textValue(firstValue(data, 'prompt', 'rawPrompt', 'message', 'text')),
    refs: sequenceValue(firstValue(data, 'refs', 'references', 'currentRefs', 'currentReferences')),
    artifacts: mappingSequence(firstValue(data, 'artifacts', 'currentArtifacts')),
    expectedArtifactTypes: sequenceValue(firstValue(data, 'expectedArtifactTypes', 'expected_artifact_types', 'requiredArtifacts')).map(String),
    selectedCapabilities: sequenceValue(firstValue(data, 'selectedCapabilities', 'selected_capabilities', 'selected', 'capabilities')),
    selectedTools: sequenceValue(firstValue(data, 'selectedTools', 'selected_tools', 'tools')),
    selectedSenses: sequenceValue(firstValue(data, 'selectedSenses', 'selected_senses', 'senses')),
    selectedVerifiers: sequenceValue(firstValue(data, 'selectedVerifiers', 'selected_verifiers', 'verifiers')),
    recentFailures: sequenceValue(firstValue(data, 'recentFailures', 'recent_failures', 'failures')),
    priorAttempts: sequenceValue(firstValue(data, 'priorAttempts', 'prior_attempts', 'attempts')),
    userGuidanceQueue: sequenceValue(firstValue(data, 'userGuidanceQueue', 'user_guidance_queue', 'guidanceQueue')),
  };
}

function selectedActionItems(req: ExecutionClassifierInput): unknown[] {
  return [
    ...req.selectedCapabilities.filter((item) => !isRuntimePlanningCapability(item)),
    ...req.selectedTools,
    ...req.selectedSenses,
    ...req.selectedVerifiers,
  ];
}

function isRuntimePlanningCapability(value: unknown): boolean {
  const record = recordValue(value);
  if (!record) return false;
  const kind = textValue(record.kind).toLowerCase();
  const adapter = textValue(record.adapter).toLowerCase();
  const capabilityId = textValue(record.id).toLowerCase();
  const runtimePrefix = ['scenario', ''].join('.');
  const generationSuffix = ['agentserver', 'generation'].join('-');
  return kind === 'skill'
    && (adapter.startsWith('agentserver:generation')
      || (capabilityId.startsWith(runtimePrefix) && capabilityId.endsWith(`.${generationSuffix}`)));
}

function hasExternalAction(actions: unknown[]): boolean {
  return actions.some((action) => EXTERNAL_ACTION_HINTS.test(actionText(action)));
}

function externalActionCount(actions: unknown[]): number {
  return actions.filter((action) => hasExternalAction([action])).length;
}

function hasSideEffectAction(actions: unknown[]): boolean {
  return actions.some((action) => hintPattern(['write', 'edit', 'delete', 'shell', 'command', 'patch', 'modify', 'filesystem'], ['写入', '修改', '删除', '命令']).test(actionText(action)));
}

function hasFailedAttempt(attempts: unknown[]): boolean {
  for (const attempt of attempts) {
    const record = recordValue(attempt);
    if (record) {
      const status = textValue(record.status ?? record.state).toLowerCase();
      if (new Set(['failed', 'failure', 'error', 'timed-out', 'timeout']).has(status)) return true;
      if (record.failure || record.failureReason || record.error) return true;
    } else if (hintPattern(['failed', 'failure', 'error', 'timeout'], ['失败', '报错', '超时']).test(String(attempt))) {
      return true;
    }
  }
  return false;
}

function hasActiveProjectArtifact(artifacts: JsonMap[]): boolean {
  for (const artifact of artifacts) {
    const status = textValue(artifact.status).toLowerCase();
    const kind = textValue(artifact.kind ?? artifact.artifactType ?? artifact.type).toLowerCase();
    if (new Set(['running', 'in-progress', 'failed', 'paused']).has(status)) return true;
    if (kind.includes('project') || kind.includes('stage') || kind.includes('execution')) return true;
  }
  return false;
}

function actionText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  const record = recordValue(value);
  if (record) {
    const fields = [
      record.id,
      record.title,
      record.kind,
      record.summary,
      record.description,
      record.adapter,
      sequenceValue(record.keywords).map(String).join(' '),
      sequenceValue(record.triggers).map(String).join(' '),
      sequenceValue(record.sideEffects).map(String).join(' '),
    ];
    return fields.map(textValue).join(' ').toLowerCase();
  }
  return String(value ?? '').toLowerCase();
}

function hintPattern(words: string[], cjk: string[]): RegExp {
  const wordPart = words.length ? `\\b(${words.join('|')})\\b` : '';
  const cjkPart = cjk.join('|');
  return new RegExp([wordPart, cjkPart].filter(Boolean).join('|'), 'i');
}

function lit(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstValue(data: JsonMap, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(data, key)) return data[key];
  }
  return undefined;
}

function objectMapping(value: unknown): JsonMap {
  if (!value || typeof value !== 'object') return {};
  const result: JsonMap = {};
  for (const key of Object.keys(value)) {
    if (!key.startsWith('_')) result[key] = (value as JsonMap)[key];
  }
  return result;
}

function sequenceValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Uint8Array) return [new TextDecoder().decode(value)];
  return Array.isArray(value) ? value : [];
}

function mappingSequence(value: unknown): JsonMap[] {
  return sequenceValue(value).map(recordValue).filter((item): item is JsonMap => Boolean(item));
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function addIf(items: string[], item: string, condition: unknown): void {
  if (condition) items.push(item);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function clampUnit(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
