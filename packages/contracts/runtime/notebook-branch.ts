export const NOTEBOOK_BRANCH_SCHEMA_VERSION = 'sciforge.notebook-branch.v1' as const;
export const NOTEBOOK_BRANCH_CONTRACT_ID = 'sciforge.notebook-branch-replay.v1' as const;

export type NotebookBranchStepStatus = 'not-run' | 'running' | 'completed' | 'failed' | 'partial' | 'pending' | 'invalidated';
export type NotebookBranchRefRole =
  | 'input'
  | 'output'
  | 'artifact'
  | 'code'
  | 'stdout'
  | 'stderr'
  | 'execution-unit'
  | 'notebook'
  | 'parameter'
  | 'diagnostic';
export type NotebookBranchReplayStatus = 'ready' | 'blocked';
export type NotebookBranchSideEffectPolicy = 'fork-before-write';
export type NotebookBranchSourceRetentionPolicy = 'retain-upstream-and-invalidate-downstream';

export interface NotebookBranchParameterChange {
  key: string;
  before?: unknown;
  after: unknown;
  reason?: string;
}

export interface NotebookBranchRef {
  ref: string;
  role: NotebookBranchRefRole;
  sourceRef?: string;
  sourceStepId?: string;
  branchId?: string;
  preserved?: boolean;
  invalidated?: boolean;
  reason?: string;
}

export interface NotebookBranchStepInput {
  id?: string;
  stepId?: string;
  index?: number;
  title?: string;
  status?: NotebookBranchStepStatus | string;
  branchId?: string;
  parameterDigest?: string;
  parameters?: Record<string, unknown>;
  inputRefs?: string[];
  outputRefs?: string[];
  artifactRefs?: string[];
  codeRefs?: string[];
  stdoutRefs?: string[];
  stderrRefs?: string[];
  executionUnitRefs?: string[];
  dependencyRefs?: string[];
}

export interface NotebookBranchReplayStep {
  id: string;
  sourceStepId: string;
  sourceBranchId?: string;
  branchId: string;
  index: number;
  title: string;
  status: NotebookBranchStepStatus;
  retainedFromSource: boolean;
  rerunRequired: boolean;
  parameterDigest?: string;
  parameterChanges?: NotebookBranchParameterChange[];
  inputRefs: NotebookBranchRef[];
  outputRefs: NotebookBranchRef[];
  artifactRefs: NotebookBranchRef[];
  codeRefs: NotebookBranchRef[];
  stdoutRefs: NotebookBranchRef[];
  stderrRefs: NotebookBranchRef[];
  executionUnitRefs: NotebookBranchRef[];
  dependencyRefs: NotebookBranchRef[];
  invalidationReason?: string;
}

export interface NotebookBranchReplayPlanInput {
  notebookId: string;
  sourceBranchId?: string;
  branchId?: string;
  steps: NotebookBranchStepInput[];
  forkFromStepId?: string;
  forkFromStepIndex?: number;
  parameterChanges: NotebookBranchParameterChange[];
  requestedAt?: string;
  reason?: string;
}

export interface NotebookBranchReplayPlan {
  schemaVersion: typeof NOTEBOOK_BRANCH_SCHEMA_VERSION;
  contract: typeof NOTEBOOK_BRANCH_CONTRACT_ID;
  notebookId: string;
  sourceBranchId: string;
  branchId: string;
  status: NotebookBranchReplayStatus;
  sideEffectPolicy: NotebookBranchSideEffectPolicy;
  sourceRetentionPolicy: NotebookBranchSourceRetentionPolicy;
  createdAt: string;
  fork: {
    sourceStepId?: string;
    sourceStepIndex?: number;
    parameterDigestBefore?: string;
    parameterDigestAfter?: string;
    parameterChanges: NotebookBranchParameterChange[];
    reason?: string;
  };
  retainedSteps: NotebookBranchReplayStep[];
  rerunSteps: NotebookBranchReplayStep[];
  invalidatedSourceSteps: NotebookBranchReplayStep[];
  affectedRefs: NotebookBranchRef[];
  diagnostics: string[];
  nextActions: string[];
}

interface NormalizedNotebookBranchStep extends Required<Pick<NotebookBranchStepInput, 'id' | 'index' | 'title'>> {
  status: NotebookBranchStepStatus;
  branchId?: string;
  parameterDigest?: string;
  parameters: Record<string, unknown>;
  inputRefs: string[];
  outputRefs: string[];
  artifactRefs: string[];
  codeRefs: string[];
  stdoutRefs: string[];
  stderrRefs: string[];
  executionUnitRefs: string[];
  dependencyRefs: string[];
}

export function buildNotebookBranchReplayPlan(input: NotebookBranchReplayPlanInput): NotebookBranchReplayPlan {
  const createdAt = input.requestedAt || 'pending-clock';
  const sourceBranchId = safeSegment(input.sourceBranchId || 'main');
  const diagnostics: string[] = [];
  const normalizedSteps = normalizeNotebookBranchSteps(input.steps);
  if (!normalizedSteps.length) diagnostics.push('Notebook branch replay requires at least one source step.');
  if (!input.parameterChanges.length) diagnostics.push('Notebook branch replay requires an explicit parameter change.');

  const forkStep = findForkStep(normalizedSteps, input);
  if (!forkStep) {
    diagnostics.push('Notebook branch replay could not find the requested fork step.');
  }

  const forkSeed = forkStep?.id || input.forkFromStepId || String(input.forkFromStepIndex ?? 'unknown');
  const branchId = safeSegment(input.branchId || [
    'branch',
    input.notebookId,
    forkSeed,
    shortStableHash(stableStringify(input.parameterChanges)),
  ].join('-'));

  const blockedPlan = basePlan({
    input,
    createdAt,
    sourceBranchId,
    branchId,
    forkStep,
    diagnostics,
  });
  if (diagnostics.length || !forkStep) return blockedPlan;

  const forkParametersAfter = applyNotebookBranchParameterChanges(forkStep.parameters, input.parameterChanges);
  const retainedSteps = normalizedSteps
    .filter((step) => step.index < forkStep.index)
    .map((step) => retainedReplayStep(step, sourceBranchId));
  const rerunSteps = normalizedSteps
    .filter((step) => step.index >= forkStep.index)
    .map((step) => rerunReplayStep(step, {
      branchId,
      sourceBranchId,
      forkStepId: forkStep.id,
      forkParametersAfter,
      parameterChanges: input.parameterChanges,
    }));
  const invalidatedSourceSteps = normalizedSteps
    .filter((step) => step.index >= forkStep.index)
    .map((step) => invalidatedSourceStep(step, {
      branchId: sourceBranchId,
      invalidationReason: step.id === forkStep.id
        ? 'Parameter changes require this step to be rerun on the new branch.'
        : `Depends on changed notebook step ${forkStep.id}; old downstream outputs cannot be reused.`,
    }));
  const affectedRefs = invalidatedSourceSteps.flatMap((step) => [
    ...step.outputRefs,
    ...step.artifactRefs,
    ...step.codeRefs,
    ...step.stdoutRefs,
    ...step.stderrRefs,
    ...step.executionUnitRefs,
  ]);

  return {
    ...blockedPlan,
    status: 'ready',
    fork: {
      sourceStepId: forkStep.id,
      sourceStepIndex: forkStep.index,
      parameterDigestBefore: forkStep.parameterDigest || parameterDigest(forkStep.parameters),
      parameterDigestAfter: parameterDigest(forkParametersAfter),
      parameterChanges: input.parameterChanges,
      reason: input.reason,
    },
    retainedSteps,
    rerunSteps,
    invalidatedSourceSteps,
    affectedRefs,
    diagnostics: [],
    nextActions: [
      `Reuse ${retainedSteps.length} upstream step(s) before ${forkStep.id}.`,
      `Rerun ${rerunSteps.length} step(s) on branch ${branchId} with fork-before-write outputs.`,
      `Treat ${affectedRefs.length} source ref(s) at or after ${forkStep.id} as invalid for the branch result.`,
    ],
  };
}

export function notebookBranchPlanAllowsContinuation(plan: NotebookBranchReplayPlan): boolean {
  return plan.status === 'ready'
    && plan.sideEffectPolicy === 'fork-before-write'
    && plan.rerunSteps.length > 0
    && plan.rerunSteps.every((step) => step.branchId === plan.branchId && step.rerunRequired)
    && plan.invalidatedSourceSteps.length > 0;
}

export function applyNotebookBranchParameterChanges(
  parameters: Record<string, unknown> = {},
  changes: NotebookBranchParameterChange[],
): Record<string, unknown> {
  const next = clonePlainRecord(parameters);
  for (const change of changes) {
    const key = normalizedText(change.key);
    if (!key) continue;
    setPathValue(next, key.split('.').filter(Boolean), change.after);
  }
  return next;
}

export function parameterDigest(parameters: Record<string, unknown> = {}): string {
  return `params:${shortStableHash(stableStringify(parameters))}`;
}

export function branchScopedNotebookRef(sourceRef: string, branchId: string, stepId: string, role: NotebookBranchRefRole): NotebookBranchRef {
  const ref = `notebook-branch:${safeSegment(branchId)}/${safeSegment(stepId)}/${role}/${shortStableHash(sourceRef || role)}`;
  return {
    ref,
    sourceRef,
    sourceStepId: stepId,
    branchId: safeSegment(branchId),
    role,
  };
}

function basePlan(input: {
  input: NotebookBranchReplayPlanInput;
  createdAt: string;
  sourceBranchId: string;
  branchId: string;
  forkStep?: NormalizedNotebookBranchStep;
  diagnostics: string[];
}): NotebookBranchReplayPlan {
  return {
    schemaVersion: NOTEBOOK_BRANCH_SCHEMA_VERSION,
    contract: NOTEBOOK_BRANCH_CONTRACT_ID,
    notebookId: input.input.notebookId,
    sourceBranchId: input.sourceBranchId,
    branchId: input.branchId,
    status: input.diagnostics.length ? 'blocked' : 'ready',
    sideEffectPolicy: 'fork-before-write',
    sourceRetentionPolicy: 'retain-upstream-and-invalidate-downstream',
    createdAt: input.createdAt,
    fork: {
      sourceStepId: input.forkStep?.id,
      sourceStepIndex: input.forkStep?.index,
      parameterDigestBefore: input.forkStep?.parameterDigest || (input.forkStep ? parameterDigest(input.forkStep.parameters) : undefined),
      parameterDigestAfter: input.forkStep
        ? parameterDigest(applyNotebookBranchParameterChanges(input.forkStep.parameters, input.input.parameterChanges))
        : undefined,
      parameterChanges: input.input.parameterChanges,
      reason: input.input.reason,
    },
    retainedSteps: [],
    rerunSteps: [],
    invalidatedSourceSteps: [],
    affectedRefs: [],
    diagnostics: input.diagnostics,
    nextActions: input.diagnostics.length
      ? ['Do not reuse downstream notebook outputs until a valid fork step and explicit parameter change are supplied.']
      : [],
  };
}

function normalizeNotebookBranchSteps(steps: NotebookBranchStepInput[]): NormalizedNotebookBranchStep[] {
  return steps.map((step, position) => {
    const id = normalizedText(step.stepId) || normalizedText(step.id) || `step-${position + 1}`;
    const parameters = clonePlainRecord(step.parameters ?? {});
    const parameterDigestValue = normalizedText(step.parameterDigest) || parameterDigest(parameters);
    return {
      id,
      index: Number.isFinite(step.index) ? Number(step.index) : position + 1,
      title: normalizedText(step.title) || id,
      status: normalizeStatus(step.status),
      branchId: normalizedText(step.branchId),
      parameterDigest: parameterDigestValue,
      parameters,
      inputRefs: normalizeRefList(step.inputRefs),
      outputRefs: normalizeRefList(step.outputRefs),
      artifactRefs: normalizeRefList(step.artifactRefs),
      codeRefs: normalizeRefList(step.codeRefs),
      stdoutRefs: normalizeRefList(step.stdoutRefs),
      stderrRefs: normalizeRefList(step.stderrRefs),
      executionUnitRefs: normalizeRefList(step.executionUnitRefs),
      dependencyRefs: normalizeRefList(step.dependencyRefs),
    };
  }).sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
}

function findForkStep(steps: NormalizedNotebookBranchStep[], input: NotebookBranchReplayPlanInput) {
  const forkId = normalizedText(input.forkFromStepId);
  if (forkId) return steps.find((step) => step.id === forkId);
  if (Number.isFinite(input.forkFromStepIndex)) return steps.find((step) => step.index === Number(input.forkFromStepIndex));
  return steps[0];
}

function retainedReplayStep(step: NormalizedNotebookBranchStep, branchId: string): NotebookBranchReplayStep {
  return replayStepBase(step, {
    id: step.id,
    branchId,
    status: step.status,
    retainedFromSource: true,
    rerunRequired: false,
    mapRef: (ref, role) => preservedRef(ref, role, step.id, branchId),
  });
}

function rerunReplayStep(
  step: NormalizedNotebookBranchStep,
  options: {
    branchId: string;
    sourceBranchId: string;
    forkStepId: string;
    forkParametersAfter: Record<string, unknown>;
    parameterChanges: NotebookBranchParameterChange[];
  },
): NotebookBranchReplayStep {
  const isForkStep = step.id === options.forkStepId;
  const parameters = isForkStep ? options.forkParametersAfter : step.parameters;
  return replayStepBase(step, {
    id: `${options.branchId}:${step.id}`,
    branchId: options.branchId,
    sourceBranchId: options.sourceBranchId,
    status: 'pending',
    retainedFromSource: false,
    rerunRequired: true,
    parameterDigest: parameterDigest(parameters),
    parameterChanges: isForkStep ? options.parameterChanges : undefined,
    mapRef: (ref, role) => branchScopedNotebookRef(ref, options.branchId, step.id, role),
  });
}

function invalidatedSourceStep(
  step: NormalizedNotebookBranchStep,
  options: { branchId: string; invalidationReason: string },
): NotebookBranchReplayStep {
  return replayStepBase(step, {
    id: step.id,
    branchId: options.branchId,
    status: 'invalidated',
    retainedFromSource: false,
    rerunRequired: true,
    invalidationReason: options.invalidationReason,
    mapRef: (ref, role) => invalidatedRef(ref, role, step.id, options.branchId, options.invalidationReason),
  });
}

function replayStepBase(
  step: NormalizedNotebookBranchStep,
  options: {
    id: string;
    branchId: string;
    sourceBranchId?: string;
    status: NotebookBranchStepStatus;
    retainedFromSource: boolean;
    rerunRequired: boolean;
    parameterDigest?: string;
    parameterChanges?: NotebookBranchParameterChange[];
    invalidationReason?: string;
    mapRef: (ref: string, role: NotebookBranchRefRole) => NotebookBranchRef;
  },
): NotebookBranchReplayStep {
  return {
    id: options.id,
    sourceStepId: step.id,
    sourceBranchId: options.sourceBranchId,
    branchId: options.branchId,
    index: step.index,
    title: step.title,
    status: options.status,
    retainedFromSource: options.retainedFromSource,
    rerunRequired: options.rerunRequired,
    parameterDigest: options.parameterDigest || step.parameterDigest,
    parameterChanges: options.parameterChanges,
    inputRefs: step.inputRefs.map((ref) => options.mapRef(ref, 'input')),
    outputRefs: step.outputRefs.map((ref) => options.mapRef(ref, 'output')),
    artifactRefs: step.artifactRefs.map((ref) => options.mapRef(ref, 'artifact')),
    codeRefs: step.codeRefs.map((ref) => options.mapRef(ref, 'code')),
    stdoutRefs: step.stdoutRefs.map((ref) => options.mapRef(ref, 'stdout')),
    stderrRefs: step.stderrRefs.map((ref) => options.mapRef(ref, 'stderr')),
    executionUnitRefs: step.executionUnitRefs.map((ref) => options.mapRef(ref, 'execution-unit')),
    dependencyRefs: step.dependencyRefs.map((ref) => options.mapRef(ref, 'notebook')),
    invalidationReason: options.invalidationReason,
  };
}

function preservedRef(ref: string, role: NotebookBranchRefRole, stepId: string, branchId: string): NotebookBranchRef {
  return {
    ref,
    sourceRef: ref,
    sourceStepId: stepId,
    branchId,
    role,
    preserved: true,
  };
}

function invalidatedRef(
  ref: string,
  role: NotebookBranchRefRole,
  stepId: string,
  branchId: string,
  reason: string,
): NotebookBranchRef {
  return {
    ref,
    sourceRef: ref,
    sourceStepId: stepId,
    branchId,
    role,
    invalidated: true,
    reason,
  };
}

function normalizeStatus(value: unknown): NotebookBranchStepStatus {
  if (value === 'not-run' || value === 'running' || value === 'completed' || value === 'failed' || value === 'partial' || value === 'pending' || value === 'invalidated') {
    return value;
  }
  return 'completed';
}

function normalizeRefList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const item of value) {
    const ref = normalizedText(item);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function safeSegment(value: unknown): string {
  const text = normalizedText(value) || 'branch';
  return text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function shortStableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function clonePlainRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function setPathValue(target: Record<string, unknown>, path: string[], value: unknown) {
  if (!path.length) return;
  let cursor: Record<string, unknown> = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}
