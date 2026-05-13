import {
  SUPPORTED_RUNTIME_AGENT_BACKENDS,
  compactCapabilityForAgentBackend,
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendIsRateLimitKind,
  runtimeAgentBackendProvider,
  runtimeAgentBackendSupported,
  type RuntimeAgentBackend,
  type RuntimeAgentBackendCapabilities,
  type RuntimeAgentBackendFailureKind,
} from './agent-backend-policy';
import {
  BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION,
  classifyBackendHandoffDrift,
  type BackendHandoffDriftClassification,
  type BackendHandoffDriftInput,
  type BackendHandoffDriftKind,
} from './backend-handoff-drift';
import {
  NO_HARDCODE_REVIEW_SCHEMA_VERSION,
  type NoHardcodeReview,
} from './task-run-card';

export const BACKEND_COMPARISON_CONTRACT_ID = 'sciforge.backend-comparison.v1' as const;
export const BACKEND_COMPARISON_SCHEMA_VERSION = 'sciforge.backend-comparison.v1' as const;

export type BackendComparisonStatus = 'consistent' | 'backend-drift' | 'needs-backend-neutral-fix' | 'blocked';
export type BackendComparisonRunStatus = 'passed' | 'failed' | 'recovered' | 'needs-retry' | 'blocked';
export type BackendComparisonInvariantStatus = 'passed' | 'failed' | 'warning';
export type BackendNeutralFixKind = 'schema-normalization' | 'context-compaction' | 'rate-limit-retry-budget' | 'backend-handoff-normalization' | 'auth-configuration' | 'network-retry' | 'unknown';

export interface BackendComparisonRunInput {
  backend: string;
  taskId?: string;
  runId?: string;
  agentBackend?: string;
  runtimeBackend?: string;
  decisionBackend?: string;
  status?: BackendComparisonRunStatus | string;
  handoff?: BackendHandoffDriftInput;
  failureMessage?: string;
  httpStatus?: number;
  evidenceRefs?: string[];
}

export interface BackendComparisonRun {
  backend: string;
  supported: boolean;
  provider?: string;
  taskId?: string;
  runId?: string;
  agentBackend?: string;
  runtimeBackend?: string;
  decisionBackend?: string;
  status: BackendComparisonRunStatus;
  capabilities: RuntimeAgentBackendCapabilities;
  compactCapability: string;
  handoff: BackendHandoffDriftClassification;
  failureCategories: RuntimeAgentBackendFailureKind[];
  evidenceRefs: string[];
  normalizedOutcomeKey: string;
}

export interface BackendComparisonInvariant {
  id: string;
  status: BackendComparisonInvariantStatus;
  message: string;
  backendRefs: string[];
}

export interface BackendNeutralFixCandidate {
  kind: BackendNeutralFixKind;
  title: string;
  reason: string;
  affectedBackends: string[];
  failureCategories: RuntimeAgentBackendFailureKind[];
  handoffKinds: BackendHandoffDriftKind[];
  nextStep: string;
  evidenceRefs: string[];
}

export interface BackendComparisonInput {
  comparisonId?: string;
  taskId: string;
  runs: BackendComparisonRunInput[];
  createdAt?: string;
}

export interface BackendComparisonReport {
  contract: typeof BACKEND_COMPARISON_CONTRACT_ID;
  schemaVersion: typeof BACKEND_COMPARISON_SCHEMA_VERSION;
  comparisonId: string;
  taskId: string;
  status: BackendComparisonStatus;
  supportedBackends: RuntimeAgentBackend[];
  comparedBackends: string[];
  runs: BackendComparisonRun[];
  invariants: BackendComparisonInvariant[];
  backendNeutralFixes: BackendNeutralFixCandidate[];
  nextActions: string[];
  noHardcodeReview: NoHardcodeReview;
  createdAt: string;
}

export function buildBackendComparisonReport(input: BackendComparisonInput): BackendComparisonReport {
  const taskId = normalizedText(input.taskId) ?? 'backend-comparison-task';
  const runs = input.runs.map((run) => normalizeBackendComparisonRun(run, taskId));
  const invariants = backendComparisonInvariants(runs);
  const backendNeutralFixes = backendNeutralFixCandidates(runs);
  const failedInvariant = invariants.some((invariant) => invariant.status === 'failed');
  const outcomeKeys = uniqueStrings(runs.map((run) => run.normalizedOutcomeKey));
  const hasActionableFailure = backendNeutralFixes.length > 0;
  const status: BackendComparisonStatus = failedInvariant
    ? 'blocked'
    : hasActionableFailure && outcomeKeys.length <= 2
      ? 'needs-backend-neutral-fix'
      : outcomeKeys.length > 1
        ? 'backend-drift'
        : 'consistent';

  return {
    contract: BACKEND_COMPARISON_CONTRACT_ID,
    schemaVersion: BACKEND_COMPARISON_SCHEMA_VERSION,
    comparisonId: normalizedText(input.comparisonId) ?? `backend-comparison-${stableToken(taskId)}`,
    taskId,
    status,
    supportedBackends: [...SUPPORTED_RUNTIME_AGENT_BACKENDS],
    comparedBackends: uniqueStrings(runs.map((run) => run.backend)),
    runs,
    invariants,
    backendNeutralFixes,
    nextActions: backendComparisonNextActions(status, backendNeutralFixes, invariants),
    noHardcodeReview: backendComparisonNoHardcodeReview(),
    createdAt: normalizedText(input.createdAt) ?? 'pending-clock',
  };
}

export function backendComparisonHasBackendNeutralFix(report: BackendComparisonReport): boolean {
  return report.backendNeutralFixes.length > 0 && report.status === 'needs-backend-neutral-fix';
}

export function validateBackendComparisonReport(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['BackendComparisonReport must be an object.'];
  if (value.contract !== BACKEND_COMPARISON_CONTRACT_ID) issues.push('contract must be sciforge.backend-comparison.v1.');
  if (value.schemaVersion !== BACKEND_COMPARISON_SCHEMA_VERSION) issues.push('schemaVersion must be sciforge.backend-comparison.v1.');
  if (!['consistent', 'backend-drift', 'needs-backend-neutral-fix', 'blocked'].includes(String(value.status))) issues.push('status is invalid.');
  if (!Array.isArray(value.runs) || value.runs.length < 2) issues.push('runs must include at least two backend runs.');
  if (!Array.isArray(value.invariants)) issues.push('invariants must be an array.');
  if (!Array.isArray(value.backendNeutralFixes)) issues.push('backendNeutralFixes must be an array.');
  if (!Array.isArray(value.nextActions)) issues.push('nextActions must be an array.');
  return issues;
}

function normalizeBackendComparisonRun(input: BackendComparisonRunInput, fallbackTaskId: string): BackendComparisonRun {
  const backend = normalizedText(input.backend) ?? 'unknown';
  const supported = runtimeAgentBackendSupported(backend);
  const handoff = classifyBackendHandoffDrift({
    ...(input.handoff ?? {}),
    source: normalizedText(input.handoff?.source) ?? backend,
    runId: normalizedText(input.handoff?.runId) ?? normalizedText(input.runId),
  });
  const failureCategories = uniqueStrings(runtimeAgentBackendFailureCategories(input.failureMessage ?? handoff.message, input.httpStatus)) as RuntimeAgentBackendFailureKind[];
  const status = normalizeRunStatus(input.status, handoff, failureCategories);
  const capabilities = runtimeAgentBackendCapabilities(backend);
  return {
    backend,
    supported,
    provider: supported ? runtimeAgentBackendProvider(backend) : undefined,
    taskId: normalizedText(input.taskId) ?? fallbackTaskId,
    runId: normalizedText(input.runId),
    agentBackend: normalizedText(input.agentBackend),
    runtimeBackend: normalizedText(input.runtimeBackend),
    decisionBackend: normalizedText(input.decisionBackend),
    status,
    capabilities,
    compactCapability: compactCapabilityForAgentBackend(backend),
    handoff,
    failureCategories,
    evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
    normalizedOutcomeKey: normalizedOutcomeKey(status, handoff, failureCategories),
  };
}

function normalizeRunStatus(
  status: BackendComparisonRunInput['status'],
  handoff: BackendHandoffDriftClassification,
  failureCategories: RuntimeAgentBackendFailureKind[],
): BackendComparisonRunStatus {
  const normalized = normalizedText(status)?.toLowerCase();
  if (normalized === 'passed' || normalized === 'success' || normalized === 'complete') return 'passed';
  if (normalized === 'failed' || normalized === 'failure') return 'failed';
  if (normalized === 'recovered' || normalized === 'self-healed') return 'recovered';
  if (normalized === 'needs-retry' || normalized === 'retry') return 'needs-retry';
  if (normalized === 'blocked') return 'blocked';
  if (handoff.status === 'blocked') return 'blocked';
  if (handoff.status === 'needs-retry') return 'needs-retry';
  if (handoff.status === 'recovered') return 'recovered';
  if (failureCategories.length > 0) return 'failed';
  return 'passed';
}

function backendComparisonInvariants(runs: BackendComparisonRun[]): BackendComparisonInvariant[] {
  return [
    supportedBackendInvariant(runs),
    metadataBackendInvariant(runs),
    capabilityInvariant(runs),
    handoffContractInvariant(runs),
  ];
}

function supportedBackendInvariant(runs: BackendComparisonRun[]): BackendComparisonInvariant {
  const unsupported = runs.filter((run) => !run.supported).map((run) => run.backend);
  return {
    id: 'supported-backend',
    status: unsupported.length ? 'failed' : 'passed',
    message: unsupported.length
      ? `Unsupported backend(s): ${unsupported.join(', ')}.`
      : 'All compared backends are declared in SUPPORTED_RUNTIME_AGENT_BACKENDS.',
    backendRefs: unsupported.length ? unsupported : runs.map((run) => run.backend),
  };
}

function metadataBackendInvariant(runs: BackendComparisonRun[]): BackendComparisonInvariant {
  const mismatched = runs.filter((run) => {
    const refs = [run.agentBackend, run.runtimeBackend, run.decisionBackend].filter((value): value is string => Boolean(value));
    return refs.some((value) => value !== run.backend);
  });
  return {
    id: 'metadata-backend-consistency',
    status: mismatched.length ? 'failed' : 'passed',
    message: mismatched.length
      ? `Backend metadata mismatch for ${mismatched.map((run) => run.backend).join(', ')}.`
      : 'agent.backend, runtime.backend, and decision backend metadata are consistent when present.',
    backendRefs: mismatched.length ? mismatched.map((run) => run.backend) : runs.map((run) => run.backend),
  };
}

function capabilityInvariant(runs: BackendComparisonRun[]): BackendComparisonInvariant {
  const mismatched = runs.filter((run) =>
    JSON.stringify(run.capabilities) !== JSON.stringify(runtimeAgentBackendCapabilities(run.backend))
    || run.compactCapability !== compactCapabilityForAgentBackend(run.backend));
  return {
    id: 'backend-capability-contract',
    status: mismatched.length ? 'failed' : 'passed',
    message: mismatched.length
      ? `Backend capability contract mismatch for ${mismatched.map((run) => run.backend).join(', ')}.`
      : 'Capabilities and compact fallback match the runtime agent backend policy.',
    backendRefs: mismatched.length ? mismatched.map((run) => run.backend) : runs.map((run) => run.backend),
  };
}

function handoffContractInvariant(runs: BackendComparisonRun[]): BackendComparisonInvariant {
  const invalid = runs.filter((run) => run.handoff.schemaVersion !== BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION);
  return {
    id: 'handoff-drift-contract',
    status: invalid.length ? 'failed' : 'passed',
    message: invalid.length
      ? `Handoff drift contract missing for ${invalid.map((run) => run.backend).join(', ')}.`
      : 'Every run is normalized through the backend handoff drift contract.',
    backendRefs: invalid.length ? invalid.map((run) => run.backend) : runs.map((run) => run.backend),
  };
}

function backendNeutralFixCandidates(runs: BackendComparisonRun[]): BackendNeutralFixCandidate[] {
  const actionable = runs.filter((run) => ['failed', 'blocked', 'needs-retry'].includes(run.status));
  if (actionable.length < 2) return [];
  const affectedBackends = uniqueStrings(actionable.map((run) => run.backend));
  const allCategories = uniqueStrings(actionable.flatMap((run) => run.failureCategories)) as RuntimeAgentBackendFailureKind[];
  const handoffKinds = uniqueStrings(actionable.map((run) => run.handoff.kind)) as BackendHandoffDriftKind[];
  const evidenceRefs = uniqueStrings(actionable.flatMap((run) => run.evidenceRefs));
  const candidates: BackendNeutralFixCandidate[] = [];
  const sharedCategories = allCategories.filter((category) => actionable.every((run) => run.failureCategories.includes(category)));
  const sharedHandoffKinds = handoffKinds.filter((kind) => actionable.every((run) => run.handoff.kind === kind));
  for (const category of sharedCategories) {
    candidates.push(fixForFailureCategory(category, affectedBackends, sharedCategories, handoffKinds, evidenceRefs));
  }
  for (const handoffKind of sharedHandoffKinds) {
    if (handoffKind === 'task-files' || handoffKind === 'direct-tool-payload' || handoffKind === 'plain-text-answer') continue;
    candidates.push(fixForHandoffKind(handoffKind, affectedBackends, allCategories, handoffKinds, evidenceRefs));
  }
  return dedupeFixes(candidates);
}

function fixForFailureCategory(
  category: RuntimeAgentBackendFailureKind,
  affectedBackends: string[],
  failureCategories: RuntimeAgentBackendFailureKind[],
  handoffKinds: BackendHandoffDriftKind[],
  evidenceRefs: string[],
): BackendNeutralFixCandidate {
  if (category === 'schema') {
    return {
      kind: 'schema-normalization',
      title: 'Normalize backend output through the same ToolPayload/taskFiles contract.',
      reason: 'The same schema failure appeared across compared backends.',
      affectedBackends,
      failureCategories,
      handoffKinds,
      nextStep: 'Add or reuse a backend-neutral parser/validator before backend-specific repair.',
      evidenceRefs,
    };
  }
  if (category === 'context-window') {
    return {
      kind: 'context-compaction',
      title: 'Apply a backend-neutral context compaction or handoff-slimming path.',
      reason: 'The same context-window failure appeared across compared backends.',
      affectedBackends,
      failureCategories,
      handoffKinds,
      nextStep: 'Reduce raw logs/artifacts, preserve refs, and rerun with the backend policy compact fallback.',
      evidenceRefs,
    };
  }
  if (runtimeAgentBackendIsRateLimitKind(category)) {
    return {
      kind: 'rate-limit-retry-budget',
      title: 'Use one bounded retry budget and a user-visible provider backoff diagnostic.',
      reason: 'The same rate-limit or retry-budget failure appeared across compared backends.',
      affectedBackends,
      failureCategories,
      handoffKinds,
      nextStep: 'Retry once with compact context, then stop and expose reset/retry-after evidence.',
      evidenceRefs,
    };
  }
  if (category === 'auth') {
    return {
      kind: 'auth-configuration',
      title: 'Surface missing credentials as configuration, not backend-specific runtime failure.',
      reason: 'The same auth/configuration failure appeared across compared backends.',
      affectedBackends,
      failureCategories,
      handoffKinds,
      nextStep: 'Redact secrets, explain the missing configuration, and block automatic reruns.',
      evidenceRefs,
    };
  }
  if (category === 'network' || category === 'timeout') {
    return {
      kind: 'network-retry',
      title: 'Classify transient provider transport failures with a shared retry policy.',
      reason: 'The same network/timeout failure appeared across compared backends.',
      affectedBackends,
      failureCategories,
      handoffKinds,
      nextStep: 'Preserve request refs, retry only bounded transient failures, and keep final diagnostics generic.',
      evidenceRefs,
    };
  }
  return {
    kind: 'unknown',
    title: 'Keep the repair backend-neutral until evidence identifies a backend-specific fault.',
    reason: `Shared failure category ${category} appeared across compared backends.`,
    affectedBackends,
    failureCategories,
    handoffKinds,
    nextStep: 'Compare stable contracts, refs, and failure categories before changing backend-specific prompts.',
    evidenceRefs,
  };
}

function fixForHandoffKind(
  handoffKind: BackendHandoffDriftKind,
  affectedBackends: string[],
  failureCategories: RuntimeAgentBackendFailureKind[],
  handoffKinds: BackendHandoffDriftKind[],
  evidenceRefs: string[],
): BackendNeutralFixCandidate {
  return {
    kind: 'backend-handoff-normalization',
    title: 'Normalize backend handoff drift before selecting backend-specific repair.',
    reason: `The same handoff drift kind appeared across compared backends: ${handoffKind}.`,
    affectedBackends,
    failureCategories,
    handoffKinds,
    nextStep: 'Use strict taskFiles retry, direct ToolPayload materialization, or guarded diagnostics from the shared handoff contract.',
    evidenceRefs,
  };
}

function backendComparisonNextActions(
  status: BackendComparisonStatus,
  fixes: BackendNeutralFixCandidate[],
  invariants: BackendComparisonInvariant[],
) {
  if (status === 'consistent') return ['Treat the compared backend behavior as equivalent for this task and keep backend-specific branches out of the repair.'];
  if (status === 'blocked') {
    return [
      `Fix comparison invariants first: ${invariants.filter((invariant) => invariant.status === 'failed').map((invariant) => invariant.id).join(', ')}.`,
      'Do not infer a backend-neutral repair until backend metadata and contract normalization agree.',
    ];
  }
  if (status === 'needs-backend-neutral-fix') {
    return fixes.map((fix) => fix.nextStep);
  }
  return ['Backend outcomes diverged; preserve per-backend evidence and repair the shared normalization layer before changing model-specific prompts.'];
}

function normalizedOutcomeKey(
  status: BackendComparisonRunStatus,
  handoff: BackendHandoffDriftClassification,
  failureCategories: RuntimeAgentBackendFailureKind[],
) {
  return [
    status,
    handoff.kind,
    [...failureCategories].sort().join('+') || 'no-failure',
  ].join(':');
}

function dedupeFixes(candidates: BackendNeutralFixCandidate[]) {
  const byKey = new Map<string, BackendNeutralFixCandidate>();
  for (const candidate of candidates) {
    byKey.set(`${candidate.kind}:${candidate.title}`, candidate);
  }
  return [...byKey.values()];
}

function backendComparisonNoHardcodeReview(): NoHardcodeReview {
  return {
    schemaVersion: NO_HARDCODE_REVIEW_SCHEMA_VERSION,
    appliesGenerally: true,
    generalityStatement: 'Backend comparison uses supported backend policy, runtime capabilities, handoff drift classifications, failure categories, and evidence refs; it does not branch on a specific backend pair, prompt phrase, paper title, or file name.',
    counterExamples: [
      'The same schema failure across any two supported backends yields a schema-normalization fix.',
      'Different compact fallbacks remain valid when they match runtime agent backend policy.',
      'Unsupported backend metadata blocks the comparison before any repair recommendation.',
    ],
    forbiddenSpecialCases: [
      'specific backend-pair literal-only comparison',
      'specific milestone phrase branch',
      'backend-name-specific success path',
      'prompt-specific repair instruction',
      'file-name-specific backend workaround',
    ],
    ownerLayer: 'agentserver-parser',
    status: 'pass',
  };
}

function normalizedText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function stableToken(value: string) {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
