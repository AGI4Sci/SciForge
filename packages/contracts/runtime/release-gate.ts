export const RELEASE_GATE_CONTRACT_ID = 'sciforge.release-gate.v1' as const;
export const RELEASE_GATE_SCHEMA_VERSION = 1 as const;
const DEFAULT_RELEASE_VERIFICATION_COMMAND = 'release-verification-command' as const;

export const RELEASE_GATE_STEP_KINDS = [
  'change-summary',
  'git-target',
  'release-verify',
  'service-restart',
  'audit-record',
  'external-sync',
] as const;

export const RELEASE_GATE_STEP_STATUSES = ['passed', 'failed', 'pending', 'skipped'] as const;

export type ReleaseGateStepKind = typeof RELEASE_GATE_STEP_KINDS[number];
export type ReleaseGateStepStatus = typeof RELEASE_GATE_STEP_STATUSES[number];
export type ReleaseGateStatus = 'passed' | 'failed' | 'blocked' | 'pending';

export interface ReleaseGatePolicyInput {
  id?: string;
  requiredCommand?: string;
  requiredStepKinds?: readonly ReleaseGateStepKind[];
  syncActionLabel?: string;
  syncActionSignals?: readonly string[];
}

export interface ReleaseGatePolicy {
  id: string;
  requiredCommand: string;
  requiredStepKinds: ReleaseGateStepKind[];
  syncActionLabel: string;
  syncActionSignals: string[];
}

export const DEFAULT_RELEASE_GATE_POLICY: ReleaseGatePolicy = {
  id: 'default-release-gate-policy',
  requiredCommand: DEFAULT_RELEASE_VERIFICATION_COMMAND,
  requiredStepKinds: [
    'change-summary',
    'git-target',
    'release-verify',
    'service-restart',
    'audit-record',
  ],
  syncActionLabel: 'external sync action',
  syncActionSignals: [],
};

export interface ReleaseGateStepInput {
  kind: ReleaseGateStepKind;
  status?: ReleaseGateStepStatus | string;
  command?: string;
  summary?: string;
  failureReason?: string;
  evidenceRefs?: string[];
}

export interface ReleaseGateServiceHealth {
  name: string;
  status: 'online' | 'ready' | 'healthy' | 'offline' | 'failed' | 'unknown' | string;
  url?: string;
  evidenceRefs?: string[];
}

export interface ReleaseGateAuditInput {
  gateId?: string;
  changeSummary?: string;
  currentBranch?: string;
  targetRemote?: string;
  targetBranch?: string;
  verifyCommand?: string;
  policy?: ReleaseGatePolicyInput;
  steps?: ReleaseGateStepInput[];
  serviceHealth?: ReleaseGateServiceHealth[];
  auditRefs?: string[];
  gitRefs?: string[];
  createdAt?: string;
}

export interface ReleaseGateStep {
  kind: ReleaseGateStepKind;
  status: ReleaseGateStepStatus;
  command?: string;
  summary?: string;
  failureReason?: string;
  evidenceRefs: string[];
}

export interface ReleaseGateAudit {
  contract: typeof RELEASE_GATE_CONTRACT_ID;
  schemaVersion: typeof RELEASE_GATE_SCHEMA_VERSION;
  gateId: string;
  status: ReleaseGateStatus;
  syncAllowed: boolean;
  requiredCommand: string;
  policy: ReleaseGatePolicy;
  changeSummary?: string;
  currentBranch?: string;
  targetRemote?: string;
  targetBranch?: string;
  steps: ReleaseGateStep[];
  missing: string[];
  failureReasons: string[];
  auditRefs: string[];
  gitRefs: string[];
  nextActions: string[];
  createdAt: string;
}

export function buildReleaseGateAudit(input: ReleaseGateAuditInput = {}): ReleaseGateAudit {
  const policy = normalizeReleaseGatePolicy(input.policy);
  const verifyCommand = normalizedText(input.verifyCommand) ?? policy.requiredCommand;
  const auditRefs = uniqueStrings(input.auditRefs ?? []);
  const gitRefs = uniqueStrings(input.gitRefs ?? []);
  const steps = normalizeReleaseGateSteps(input.steps ?? [], verifyCommand, policy);
  const changeSummary = normalizedText(input.changeSummary);
  const currentBranch = normalizedText(input.currentBranch);
  const targetRemote = normalizedText(input.targetRemote);
  const targetBranch = normalizedText(input.targetBranch);

  if (changeSummary && !steps.some((step) => step.kind === 'change-summary')) {
    steps.push({
      kind: 'change-summary',
      status: 'passed',
      summary: changeSummary,
      evidenceRefs: [],
    });
  }
  if ((currentBranch || targetRemote || targetBranch || gitRefs.length > 0) && !steps.some((step) => step.kind === 'git-target')) {
    steps.push({
      kind: 'git-target',
      status: currentBranch && targetRemote ? 'passed' : 'pending',
      summary: gitTargetSummary(currentBranch, targetRemote, targetBranch),
      evidenceRefs: gitRefs,
    });
  }
  if (serviceHealthAllReady(input.serviceHealth) && !steps.some((step) => step.kind === 'service-restart')) {
    steps.push({
      kind: 'service-restart',
      status: 'passed',
      summary: 'Service restart and health checks passed.',
      evidenceRefs: uniqueStrings(input.serviceHealth?.flatMap((service) => service.evidenceRefs ?? []) ?? []),
    });
  }
  if (auditRefs.length > 0 && !steps.some((step) => step.kind === 'audit-record')) {
    steps.push({
      kind: 'audit-record',
      status: 'passed',
      summary: 'Release audit refs were recorded.',
      evidenceRefs: auditRefs,
    });
  }

  const missing = missingReleaseGateRequirements({
    steps,
    changeSummary,
    currentBranch,
    targetRemote,
    auditRefs,
  }, policy);
  const failureReasons = steps
    .filter((step) => step.status === 'failed')
    .map((step) => step.failureReason ?? `${step.kind} failed.`);
  const pending = missing.length > 0 || steps.some((step) => step.status === 'pending');
  const status: ReleaseGateStatus = failureReasons.length > 0
    ? 'failed'
    : pending
      ? 'blocked'
      : 'passed';

  const syncAllowed = status === 'passed';
  return {
    contract: RELEASE_GATE_CONTRACT_ID,
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    gateId: normalizedText(input.gateId) ?? 'release-gate',
    status,
    syncAllowed,
    requiredCommand: policy.requiredCommand,
    policy,
    changeSummary,
    currentBranch,
    targetRemote,
    targetBranch,
    steps,
    missing,
    failureReasons,
    auditRefs,
    gitRefs,
    nextActions: releaseGateNextActions(status, missing, failureReasons, policy),
    createdAt: normalizedText(input.createdAt) ?? 'pending-clock',
  };
}

export function releaseGateAllowsSync(audit: ReleaseGateAudit): boolean {
  return audit.syncAllowed && audit.status === 'passed' && audit.missing.length === 0 && audit.failureReasons.length === 0;
}

export function normalizeReleaseGatePolicy(input?: ReleaseGatePolicyInput | Record<string, unknown>): ReleaseGatePolicy {
  const requiredStepKinds = uniqueStepKinds(
    Array.isArray(input?.requiredStepKinds)
      ? input.requiredStepKinds.filter((value): value is ReleaseGateStepKind => RELEASE_GATE_STEP_KINDS.includes(value as ReleaseGateStepKind))
      : DEFAULT_RELEASE_GATE_POLICY.requiredStepKinds,
  );
  return {
    id: normalizedText(input?.id) ?? DEFAULT_RELEASE_GATE_POLICY.id,
    requiredCommand: normalizedText(input?.requiredCommand) ?? DEFAULT_RELEASE_GATE_POLICY.requiredCommand,
    requiredStepKinds,
    syncActionLabel: normalizedText(input?.syncActionLabel) ?? DEFAULT_RELEASE_GATE_POLICY.syncActionLabel,
    syncActionSignals: uniqueStrings(
      Array.isArray(input?.syncActionSignals)
        ? input.syncActionSignals.filter((value): value is string => typeof value === 'string')
        : DEFAULT_RELEASE_GATE_POLICY.syncActionSignals,
    ),
  };
}

export function releaseGateHasSyncActionSignal(text: string | undefined, policyInput?: ReleaseGatePolicyInput | ReleaseGatePolicy): boolean {
  const policy = normalizeReleaseGatePolicy(policyInput);
  const normalized = normalizedText(text)?.toLowerCase();
  if (!normalized) return false;
  return policy.syncActionSignals.some((signal) => {
    const normalizedSignal = normalizedText(signal)?.toLowerCase();
    if (!normalizedSignal) return false;
    return normalized === normalizedSignal || normalized.startsWith(`${normalizedSignal} `);
  });
}

export function releaseGateHasRequiredVerifyCommand(command: string | undefined, policyInput?: ReleaseGatePolicyInput | string): boolean {
  const policy = typeof policyInput === 'string'
    ? normalizeReleaseGatePolicy({ requiredCommand: policyInput })
    : normalizeReleaseGatePolicy(policyInput);
  const normalized = normalizedText(command)?.toLowerCase();
  if (!normalized) return false;
  const requiredCommand = policy.requiredCommand.toLowerCase();
  return normalized === requiredCommand;
}

function normalizeReleaseGateSteps(steps: ReleaseGateStepInput[], verifyCommand: string, policy: ReleaseGatePolicy): ReleaseGateStep[] {
  return steps
    .map((step): ReleaseGateStep | undefined => {
      if (!RELEASE_GATE_STEP_KINDS.includes(step.kind)) return undefined;
      const command = normalizedText(step.command);
      const status = normalizeStepStatus(step.status);
      return {
        kind: step.kind,
        status: step.kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(command ?? verifyCommand, policy)
          ? 'pending'
          : status,
        command,
        summary: normalizedText(step.summary),
        failureReason: normalizedText(step.failureReason),
        evidenceRefs: uniqueStrings(step.evidenceRefs ?? []),
      };
    })
    .filter((step): step is ReleaseGateStep => Boolean(step));
}

function missingReleaseGateRequirements(input: {
  steps: ReleaseGateStep[];
  changeSummary?: string;
  currentBranch?: string;
  targetRemote?: string;
  auditRefs: string[];
}, policy: ReleaseGatePolicy) {
  const missing: string[] = [];
  if (policy.requiredStepKinds.includes('change-summary') && !input.changeSummary && !passedStep(input.steps, 'change-summary')) missing.push('change-summary');
  if (policy.requiredStepKinds.includes('git-target') && (!input.currentBranch || !input.targetRemote)) missing.push('git-target');
  if (policy.requiredStepKinds.includes('audit-record') && !input.auditRefs.length && !passedStep(input.steps, 'audit-record')) missing.push('audit-record');
  if (policy.requiredStepKinds.includes('release-verify') && !passedRequiredVerify(input.steps, policy)) missing.push(policy.requiredCommand);
  if (policy.requiredStepKinds.includes('service-restart') && !passedStep(input.steps, 'service-restart')) missing.push('service-restart');
  return uniqueStrings(missing);
}

function passedRequiredVerify(steps: ReleaseGateStep[], policy: ReleaseGatePolicy) {
  return steps.some((step) =>
    step.kind === 'release-verify'
    && step.status === 'passed'
    && releaseGateHasRequiredVerifyCommand(step.command ?? policy.requiredCommand, policy)
    && step.evidenceRefs.length > 0
  );
}

function passedStep(steps: ReleaseGateStep[], kind: ReleaseGateStepKind) {
  return steps.some((step) => step.kind === kind && step.status === 'passed');
}

function releaseGateNextActions(status: ReleaseGateStatus, missing: string[], failureReasons: string[], policy: ReleaseGatePolicy) {
  if (status === 'passed') return [`${policy.syncActionLabel} is allowed; preserve release audit refs with the sync record.`];
  if (failureReasons.length > 0) return [`Do not complete the ${policy.syncActionLabel}. Repair the failed release check, rerun ${policy.requiredCommand}, and refresh the release audit.`];
  return [
    `Do not complete the ${policy.syncActionLabel} until these release gate requirements are recorded: ${missing.join(', ')}.`,
    `Run ${policy.requiredCommand}, refresh service health, write the change summary, and keep audit refs before external sync.`,
  ];
}

function serviceHealthAllReady(services: ReleaseGateServiceHealth[] | undefined) {
  if (!services?.length) return false;
  return services.every((service) => ['online', 'ready', 'healthy'].includes(String(service.status).toLowerCase()));
}

function normalizeStepStatus(value: ReleaseGateStepInput['status']): ReleaseGateStepStatus {
  const normalized = normalizedText(value)?.toLowerCase();
  if (normalized === 'passed' || normalized === 'success' || normalized === 'done') return 'passed';
  if (normalized === 'failed' || normalized === 'fail' || normalized === 'failed-with-reason' || normalized === 'repair-needed') return 'failed';
  if (normalized === 'skipped') return 'skipped';
  return 'pending';
}

function gitTargetSummary(currentBranch: string | undefined, targetRemote: string | undefined, targetBranch: string | undefined) {
  return [
    currentBranch ? `branch=${currentBranch}` : undefined,
    targetRemote ? `remote=${targetRemote}` : undefined,
    targetBranch ? `target=${targetBranch}` : undefined,
  ].filter(Boolean).join(' ');
}

function normalizedText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueStepKinds(values: readonly ReleaseGateStepKind[]) {
  return [...new Set(values.filter((value) => RELEASE_GATE_STEP_KINDS.includes(value)))];
}
