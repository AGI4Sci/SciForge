export const RELEASE_GATE_CONTRACT_ID = 'sciforge.release-gate.v1' as const;
export const RELEASE_GATE_SCHEMA_VERSION = 1 as const;
export const RELEASE_GATE_REQUIRED_COMMAND = 'npm run verify:full' as const;

export const RELEASE_GATE_STEP_KINDS = [
  'change-summary',
  'git-target',
  'release-verify',
  'service-restart',
  'audit-record',
  'push',
] as const;

export const RELEASE_GATE_STEP_STATUSES = ['passed', 'failed', 'pending', 'skipped'] as const;

export type ReleaseGateStepKind = typeof RELEASE_GATE_STEP_KINDS[number];
export type ReleaseGateStepStatus = typeof RELEASE_GATE_STEP_STATUSES[number];
export type ReleaseGateStatus = 'passed' | 'failed' | 'blocked' | 'pending';

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
  pushAllowed: boolean;
  requiredCommand: typeof RELEASE_GATE_REQUIRED_COMMAND;
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
  const verifyCommand = normalizedText(input.verifyCommand) ?? RELEASE_GATE_REQUIRED_COMMAND;
  const auditRefs = uniqueStrings(input.auditRefs ?? []);
  const gitRefs = uniqueStrings(input.gitRefs ?? []);
  const steps = normalizeReleaseGateSteps(input.steps ?? [], verifyCommand);
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
  });
  const failureReasons = steps
    .filter((step) => step.status === 'failed')
    .map((step) => step.failureReason ?? `${step.kind} failed.`);
  const pending = missing.length > 0 || steps.some((step) => step.status === 'pending');
  const status: ReleaseGateStatus = failureReasons.length > 0
    ? 'failed'
    : pending
      ? 'blocked'
      : 'passed';

  return {
    contract: RELEASE_GATE_CONTRACT_ID,
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    gateId: normalizedText(input.gateId) ?? 'release-gate',
    status,
    pushAllowed: status === 'passed',
    requiredCommand: RELEASE_GATE_REQUIRED_COMMAND,
    changeSummary,
    currentBranch,
    targetRemote,
    targetBranch,
    steps,
    missing,
    failureReasons,
    auditRefs,
    gitRefs,
    nextActions: releaseGateNextActions(status, missing, failureReasons),
    createdAt: normalizedText(input.createdAt) ?? 'pending-clock',
  };
}

export function releaseGateAllowsPush(audit: ReleaseGateAudit): boolean {
  return audit.pushAllowed && audit.status === 'passed' && audit.missing.length === 0 && audit.failureReasons.length === 0;
}

export function releaseGateHasRequiredVerifyCommand(command: string | undefined): boolean {
  const normalized = normalizedText(command)?.toLowerCase();
  if (!normalized) return false;
  return normalized === RELEASE_GATE_REQUIRED_COMMAND || normalized.includes(RELEASE_GATE_REQUIRED_COMMAND);
}

function normalizeReleaseGateSteps(steps: ReleaseGateStepInput[], verifyCommand: string): ReleaseGateStep[] {
  return steps
    .map((step): ReleaseGateStep | undefined => {
      if (!RELEASE_GATE_STEP_KINDS.includes(step.kind)) return undefined;
      const command = normalizedText(step.command);
      const status = normalizeStepStatus(step.status);
      return {
        kind: step.kind,
        status: step.kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(command ?? verifyCommand)
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
}) {
  const missing: string[] = [];
  if (!input.changeSummary && !passedStep(input.steps, 'change-summary')) missing.push('change-summary');
  if (!input.currentBranch || !input.targetRemote) missing.push('git-target');
  if (!input.auditRefs.length && !passedStep(input.steps, 'audit-record')) missing.push('audit-record');
  if (!passedRequiredVerify(input.steps)) missing.push(RELEASE_GATE_REQUIRED_COMMAND);
  if (!passedStep(input.steps, 'service-restart')) missing.push('service-restart');
  return uniqueStrings(missing);
}

function passedRequiredVerify(steps: ReleaseGateStep[]) {
  return steps.some((step) =>
    step.kind === 'release-verify'
    && step.status === 'passed'
    && releaseGateHasRequiredVerifyCommand(step.command ?? RELEASE_GATE_REQUIRED_COMMAND)
    && step.evidenceRefs.length > 0
  );
}

function passedStep(steps: ReleaseGateStep[], kind: ReleaseGateStepKind) {
  return steps.some((step) => step.kind === kind && step.status === 'passed');
}

function releaseGateNextActions(status: ReleaseGateStatus, missing: string[], failureReasons: string[]) {
  if (status === 'passed') return ['Push is allowed; preserve the release audit refs with the GitHub sync record.'];
  if (failureReasons.length > 0) return ['Do not push. Repair the failed release check, rerun npm run verify:full, and refresh the release audit.'];
  return [
    `Do not push until these release gate requirements are recorded: ${missing.join(', ')}.`,
    'Run npm run verify:full, restart services, write the change summary, and keep audit refs before syncing to GitHub.',
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
