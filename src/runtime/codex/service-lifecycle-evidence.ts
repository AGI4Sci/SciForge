export const SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION = 'sciforge.service-lifecycle-evidence.v1' as const;

export type ServiceLifecyclePortAssignment = 'preflight' | 'supervisor' | 'manual-recovery';
export type ServiceLifecycleCleanupAction = 'terminated' | 'verified-not-running' | 'skipped-not-owner';
export type ServiceLifecycleRecoveryReason = 'default-port-occupied' | 'port-range-conflict' | 'stale-process-on-port';
export type ServiceLifecycleRestartTrigger = 'file-change' | 'manual-after-change' | 'test-watch';
export type ServiceLifecycleBrowserRefreshMethod = 'codex-in-app-browser' | 'browser-reload' | 'navigation';
export type ServiceLifecycleReadinessStatus = 'pass' | 'fail';
export type ServiceLifecycleClaimStatus = 'pass' | 'fail';

export interface ServiceLifecyclePortBinding {
  role: string;
  defaultPort: number;
  actualPort: number;
  url: string;
  assignedBy: ServiceLifecyclePortAssignment;
  conflictWithDefault?: boolean;
  evidenceRefs?: string[];
}

export interface ServiceLifecycleStaleProcessCleanup {
  cleanupId: string;
  port: number;
  action: ServiceLifecycleCleanupAction;
  verifiedAt: string;
  pid?: number;
  command?: string;
  evidenceRefs: string[];
}

export interface ServiceLifecyclePortConflictRecovery {
  recoveryId: string;
  requestedPort: number;
  actualPort: number;
  reason: ServiceLifecycleRecoveryReason;
  detectedBy: string;
  staleCleanupIds?: string[];
  evidenceRefs: string[];
}

export interface ServiceLifecycleCodeChangeRestart {
  restartId: string;
  trigger: ServiceLifecycleRestartTrigger;
  changeRef: string;
  previousUrl: string;
  restartedUrl: string;
  observedAt: string;
  evidenceRefs: string[];
}

export interface ServiceLifecycleBrowserRefreshEvidence {
  refreshId: string;
  method: ServiceLifecycleBrowserRefreshMethod;
  beforeUrl: string;
  afterUrl: string;
  refreshedAt: string;
  observedContent?: string;
  evidenceRefs: string[];
}

export interface ServiceLifecycleReadinessCheck {
  checkId: string;
  url: string;
  port: number;
  status: ServiceLifecycleReadinessStatus;
  checkedAt: string;
  responseStatus?: number;
  detail?: string;
  evidenceRefs: string[];
}

export interface ServiceLifecyclePassClaim {
  claimId: string;
  status: ServiceLifecycleClaimStatus;
  claimedUrl: string;
  claimedPort?: number;
  assumesDefaultPort?: boolean;
  evidenceRefs: string[];
  notes?: string;
}

export interface ServiceLifecycleEvidenceLedger {
  schemaVersion: typeof SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION;
  runId: string;
  serviceName: string;
  defaultPort: number;
  portBindings: ServiceLifecyclePortBinding[];
  staleProcessCleanup: ServiceLifecycleStaleProcessCleanup[];
  portConflictRecovery: ServiceLifecyclePortConflictRecovery[];
  codeChangeRestarts: ServiceLifecycleCodeChangeRestart[];
  browserRefreshes: ServiceLifecycleBrowserRefreshEvidence[];
  readinessChecks: ServiceLifecycleReadinessCheck[];
  passClaims: ServiceLifecyclePassClaim[];
  auditRefs: string[];
}

export interface ServiceLifecycleEvidenceValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ServiceLifecycleRecoveryRequest {
  serviceName: string;
  defaultPort: number;
  preferredRole?: string;
  codeChanged?: boolean;
  currentUrl?: string;
}

export interface ServiceLifecycleRecoveryStep {
  stepId: string;
  action:
    | 'preflight-port'
    | 'cleanup-stale-process'
    | 'recover-port-conflict'
    | 'restart-after-code-change'
    | 'check-readiness'
    | 'refresh-browser'
    | 'record-pass-claim';
  requiredEvidence:
    | 'actual-port'
    | 'stale-cleanup'
    | 'port-conflict-recovery'
    | 'restart'
    | 'readiness'
    | 'browser-refresh'
    | 'pass-claim';
  reason: string;
}

export interface ServiceLifecycleRecoveryPlan {
  ok: boolean;
  schemaVersion: typeof SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION | 'unknown';
  serviceName: string;
  actualPort?: number;
  url?: string;
  ready: boolean;
  claimable: boolean;
  steps: ServiceLifecycleRecoveryStep[];
  errors: string[];
  warnings: string[];
  evidenceRefs: string[];
}

const PORT_ASSIGNMENTS = new Set<ServiceLifecyclePortAssignment>(['preflight', 'supervisor', 'manual-recovery']);
const CLEANUP_ACTIONS = new Set<ServiceLifecycleCleanupAction>(['terminated', 'verified-not-running', 'skipped-not-owner']);
const RECOVERY_REASONS = new Set<ServiceLifecycleRecoveryReason>(['default-port-occupied', 'port-range-conflict', 'stale-process-on-port']);
const RESTART_TRIGGERS = new Set<ServiceLifecycleRestartTrigger>(['file-change', 'manual-after-change', 'test-watch']);
const REFRESH_METHODS = new Set<ServiceLifecycleBrowserRefreshMethod>(['codex-in-app-browser', 'browser-reload', 'navigation']);
const READINESS_STATUSES = new Set<ServiceLifecycleReadinessStatus>(['pass', 'fail']);
const CLAIM_STATUSES = new Set<ServiceLifecycleClaimStatus>(['pass', 'fail']);

export function validateServiceLifecycleEvidenceLedger(ledger: unknown): ServiceLifecycleEvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(ledger)) {
    return { ok: false, errors: ['ledger must be an object'], warnings };
  }

  if (ledger.schemaVersion !== SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION}`);
  }

  requireNonEmptyString(ledger, 'runId', errors);
  requireNonEmptyString(ledger, 'serviceName', errors);
  const defaultPort = requirePort(ledger, 'defaultPort', errors);
  const auditRefs = requireStringArray(ledger, 'auditRefs', errors, { requireNonEmpty: true });
  if (auditRefs.length === 0) {
    errors.push('auditRefs must include at least one service lifecycle ref');
  }

  const portBindings = requireRecordArray(ledger, 'portBindings', errors);
  const staleProcessCleanup = requireRecordArray(ledger, 'staleProcessCleanup', errors);
  const portConflictRecovery = requireRecordArray(ledger, 'portConflictRecovery', errors);
  const codeChangeRestarts = requireRecordArray(ledger, 'codeChangeRestarts', errors);
  const browserRefreshes = requireRecordArray(ledger, 'browserRefreshes', errors);
  const readinessChecks = requireRecordArray(ledger, 'readinessChecks', errors);
  const passClaims = requireRecordArray(ledger, 'passClaims', errors);

  const actualPorts = validatePortBindings(portBindings, defaultPort, errors, warnings);
  const cleanupIds = validateStaleProcessCleanup(staleProcessCleanup, errors);
  validatePortConflictRecovery(portConflictRecovery, cleanupIds, actualPorts, errors, warnings);
  validateCodeChangeRestarts(codeChangeRestarts, errors);
  validateBrowserRefreshes(browserRefreshes, errors);
  validateReadinessChecks(readinessChecks, actualPorts, errors, warnings);
  validatePassClaims(passClaims, {
    defaultPort,
    actualPorts,
    staleProcessCleanup,
    portConflictRecovery,
    codeChangeRestarts,
    browserRefreshes,
    readinessChecks,
    errors,
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function planServiceLifecycleRecovery(
  ledger: ServiceLifecycleEvidenceLedger,
  request: ServiceLifecycleRecoveryRequest,
): ServiceLifecycleRecoveryPlan {
  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  const binding = selectBinding(ledger, request.preferredRole);
  const passingReadiness = binding
    ? ledger.readinessChecks.some((check) => check.status === 'pass' && check.port === binding.actualPort && check.url === binding.url)
    : false;
  const hasBrowserRefresh = binding
    ? ledger.browserRefreshes.some((refresh) => refresh.afterUrl === binding.url)
    : false;
  const hasCleanupEvidence = ledger.staleProcessCleanup.length > 0;
  const hasRestartAfterChange = !request.codeChanged || ledger.codeChangeRestarts.some((restart) => restart.restartedUrl === binding?.url);

  const steps: ServiceLifecycleRecoveryStep[] = [];
  if (!binding) {
    steps.push({
      stepId: 'preflight-port',
      action: 'preflight-port',
      requiredEvidence: 'actual-port',
      reason: 'No actual service port binding has been recorded.',
    });
  }
  if (!hasCleanupEvidence) {
    steps.push({
      stepId: 'cleanup-stale-process',
      action: 'cleanup-stale-process',
      requiredEvidence: 'stale-cleanup',
      reason: 'Pass claims require stale process cleanup or verified-not-running evidence.',
    });
  }
  if (binding && binding.actualPort !== request.defaultPort && ledger.portConflictRecovery.length === 0) {
    steps.push({
      stepId: 'recover-port-conflict',
      action: 'recover-port-conflict',
      requiredEvidence: 'port-conflict-recovery',
      reason: `Actual port ${binding.actualPort} differs from default port ${request.defaultPort}; recovery evidence must explain the conflict.`,
    });
  }
  if (!hasRestartAfterChange) {
    steps.push({
      stepId: 'restart-after-code-change',
      action: 'restart-after-code-change',
      requiredEvidence: 'restart',
      reason: 'A code change was reported without restart evidence for the current service URL.',
    });
  }
  if (!passingReadiness) {
    steps.push({
      stepId: 'check-readiness',
      action: 'check-readiness',
      requiredEvidence: 'readiness',
      reason: 'No passing readiness check matches the actual service URL and port.',
    });
  }
  if (!hasBrowserRefresh) {
    steps.push({
      stepId: 'refresh-browser',
      action: 'refresh-browser',
      requiredEvidence: 'browser-refresh',
      reason: 'No browser refresh evidence shows the visible UI was refreshed after service recovery.',
    });
  }
  if (!ledger.passClaims.some((claim) => claim.status === 'pass' && claim.claimedUrl === binding?.url)) {
    steps.push({
      stepId: 'record-pass-claim',
      action: 'record-pass-claim',
      requiredEvidence: 'pass-claim',
      reason: 'No pass claim is tied to the recovered actual service URL.',
    });
  }

  return {
    ok: validation.ok && steps.length === 0,
    schemaVersion: ledger.schemaVersion === SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION
      ? SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION
      : 'unknown',
    serviceName: request.serviceName,
    actualPort: binding?.actualPort,
    url: binding?.url,
    ready: passingReadiness,
    claimable: validation.ok && steps.length === 0,
    steps,
    errors: validation.errors,
    warnings: validation.warnings,
    evidenceRefs: collectEvidenceRefs(ledger),
  };
}

function validatePortBindings(
  bindings: Record<string, unknown>[],
  defaultPort: number | undefined,
  errors: string[],
  warnings: string[],
): Set<number> {
  const roles = new Set<string>();
  const actualPorts = new Set<number>();
  for (const [index, binding] of bindings.entries()) {
    const path = `portBindings[${index}]`;
    const role = requireNonEmptyString(binding, 'role', errors, `${path}.role`);
    const bindingDefaultPort = requirePort(binding, 'defaultPort', errors, `${path}.defaultPort`);
    const actualPort = requirePort(binding, 'actualPort', errors, `${path}.actualPort`);
    const url = requireNonEmptyString(binding, 'url', errors, `${path}.url`);
    if (!PORT_ASSIGNMENTS.has(binding.assignedBy as ServiceLifecyclePortAssignment)) {
      errors.push(`${path}.assignedBy must be preflight, supervisor, or manual-recovery`);
    }
    requireOptionalBoolean(binding, 'conflictWithDefault', errors, `${path}.conflictWithDefault`);
    requireStringArray(binding, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, optional: true });
    rememberUnique(roles, role, `${path}.role`, errors);
    if (actualPort !== undefined) {
      actualPorts.add(actualPort);
    }
    if (defaultPort !== undefined && bindingDefaultPort !== undefined && bindingDefaultPort !== defaultPort) {
      errors.push(`${path}.defaultPort ${bindingDefaultPort} does not match ledger.defaultPort ${defaultPort}`);
    }
    validateUrlPort(url, actualPort, `${path}.url`, errors);
    if (defaultPort !== undefined && actualPort === defaultPort && binding.conflictWithDefault === true) {
      warnings.push(`${path}.conflictWithDefault is true even though actualPort matches defaultPort`);
    }
    if (defaultPort !== undefined && actualPort !== undefined && actualPort !== defaultPort && binding.conflictWithDefault !== true) {
      errors.push(`${path}.conflictWithDefault must be true when actualPort differs from defaultPort`);
    }
  }
  if (bindings.length === 0) {
    errors.push('portBindings must include the actual service port');
  }
  return actualPorts;
}

function validateStaleProcessCleanup(cleanups: Record<string, unknown>[], errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const [index, cleanup] of cleanups.entries()) {
    const path = `staleProcessCleanup[${index}]`;
    const cleanupId = requireNonEmptyString(cleanup, 'cleanupId', errors, `${path}.cleanupId`);
    requirePort(cleanup, 'port', errors, `${path}.port`);
    if (!CLEANUP_ACTIONS.has(cleanup.action as ServiceLifecycleCleanupAction)) {
      errors.push(`${path}.action must be terminated, verified-not-running, or skipped-not-owner`);
    }
    requireNonEmptyString(cleanup, 'verifiedAt', errors, `${path}.verifiedAt`);
    requireOptionalNumber(cleanup, 'pid', errors, `${path}.pid`);
    requireOptionalString(cleanup, 'command', errors, `${path}.command`);
    requireStringArray(cleanup, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, cleanupId, `${path}.cleanupId`, errors);
  }
  return ids;
}

function validatePortConflictRecovery(
  recoveries: Record<string, unknown>[],
  cleanupIds: Set<string>,
  actualPorts: Set<number>,
  errors: string[],
  warnings: string[],
): void {
  const ids = new Set<string>();
  for (const [index, recovery] of recoveries.entries()) {
    const path = `portConflictRecovery[${index}]`;
    const recoveryId = requireNonEmptyString(recovery, 'recoveryId', errors, `${path}.recoveryId`);
    requirePort(recovery, 'requestedPort', errors, `${path}.requestedPort`);
    const actualPort = requirePort(recovery, 'actualPort', errors, `${path}.actualPort`);
    if (!RECOVERY_REASONS.has(recovery.reason as ServiceLifecycleRecoveryReason)) {
      errors.push(`${path}.reason must be default-port-occupied, port-range-conflict, or stale-process-on-port`);
    }
    requireNonEmptyString(recovery, 'detectedBy', errors, `${path}.detectedBy`);
    const staleCleanupIds = requireStringArray(recovery, 'staleCleanupIds', errors, { path: `${path}.staleCleanupIds`, optional: true });
    requireStringArray(recovery, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, recoveryId, `${path}.recoveryId`, errors);
    if (actualPort !== undefined && !actualPorts.has(actualPort)) {
      errors.push(`${path}.actualPort ${actualPort} has no matching portBindings.actualPort`);
    }
    for (const cleanupId of staleCleanupIds) {
      if (!cleanupIds.has(cleanupId)) {
        warnings.push(`${path}.staleCleanupIds references unrecorded cleanup ${cleanupId}`);
      }
    }
  }
}

function validateCodeChangeRestarts(restarts: Record<string, unknown>[], errors: string[]): void {
  const ids = new Set<string>();
  for (const [index, restart] of restarts.entries()) {
    const path = `codeChangeRestarts[${index}]`;
    const restartId = requireNonEmptyString(restart, 'restartId', errors, `${path}.restartId`);
    if (!RESTART_TRIGGERS.has(restart.trigger as ServiceLifecycleRestartTrigger)) {
      errors.push(`${path}.trigger must be file-change, manual-after-change, or test-watch`);
    }
    requireNonEmptyString(restart, 'changeRef', errors, `${path}.changeRef`);
    requireNonEmptyString(restart, 'previousUrl', errors, `${path}.previousUrl`);
    requireNonEmptyString(restart, 'restartedUrl', errors, `${path}.restartedUrl`);
    requireNonEmptyString(restart, 'observedAt', errors, `${path}.observedAt`);
    requireStringArray(restart, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, restartId, `${path}.restartId`, errors);
  }
}

function validateBrowserRefreshes(refreshes: Record<string, unknown>[], errors: string[]): void {
  const ids = new Set<string>();
  for (const [index, refresh] of refreshes.entries()) {
    const path = `browserRefreshes[${index}]`;
    const refreshId = requireNonEmptyString(refresh, 'refreshId', errors, `${path}.refreshId`);
    if (!REFRESH_METHODS.has(refresh.method as ServiceLifecycleBrowserRefreshMethod)) {
      errors.push(`${path}.method must be codex-in-app-browser, browser-reload, or navigation`);
    }
    requireNonEmptyString(refresh, 'beforeUrl', errors, `${path}.beforeUrl`);
    requireNonEmptyString(refresh, 'afterUrl', errors, `${path}.afterUrl`);
    requireNonEmptyString(refresh, 'refreshedAt', errors, `${path}.refreshedAt`);
    requireOptionalString(refresh, 'observedContent', errors, `${path}.observedContent`);
    requireStringArray(refresh, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, refreshId, `${path}.refreshId`, errors);
  }
}

function validateReadinessChecks(
  checks: Record<string, unknown>[],
  actualPorts: Set<number>,
  errors: string[],
  warnings: string[],
): void {
  const ids = new Set<string>();
  for (const [index, check] of checks.entries()) {
    const path = `readinessChecks[${index}]`;
    const checkId = requireNonEmptyString(check, 'checkId', errors, `${path}.checkId`);
    const port = requirePort(check, 'port', errors, `${path}.port`);
    const url = requireNonEmptyString(check, 'url', errors, `${path}.url`);
    if (!READINESS_STATUSES.has(check.status as ServiceLifecycleReadinessStatus)) {
      errors.push(`${path}.status must be pass or fail`);
    }
    requireNonEmptyString(check, 'checkedAt', errors, `${path}.checkedAt`);
    requireOptionalNumber(check, 'responseStatus', errors, `${path}.responseStatus`);
    requireOptionalString(check, 'detail', errors, `${path}.detail`);
    requireStringArray(check, 'evidenceRefs', errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, checkId, `${path}.checkId`, errors);
    validateUrlPort(url, port, `${path}.url`, errors);
    if (port !== undefined && !actualPorts.has(port)) {
      warnings.push(`${path}.port ${port} has no matching portBindings.actualPort`);
    }
    if (check.status === 'pass' && typeof check.responseStatus === 'number' && (check.responseStatus < 200 || check.responseStatus > 399)) {
      errors.push(`${path}.responseStatus must be 2xx or 3xx when status is pass`);
    }
  }
}

function validatePassClaims(
  claims: Record<string, unknown>[],
  context: {
    defaultPort: number | undefined;
    actualPorts: Set<number>;
    staleProcessCleanup: Record<string, unknown>[];
    portConflictRecovery: Record<string, unknown>[];
    codeChangeRestarts: Record<string, unknown>[];
    browserRefreshes: Record<string, unknown>[];
    readinessChecks: Record<string, unknown>[];
    errors: string[];
  },
): void {
  const ids = new Set<string>();
  for (const [index, claim] of claims.entries()) {
    const path = `passClaims[${index}]`;
    const claimId = requireNonEmptyString(claim, 'claimId', context.errors, `${path}.claimId`);
    if (!CLAIM_STATUSES.has(claim.status as ServiceLifecycleClaimStatus)) {
      context.errors.push(`${path}.status must be pass or fail`);
    }
    const claimedUrl = requireNonEmptyString(claim, 'claimedUrl', context.errors, `${path}.claimedUrl`);
    const claimedPort = optionalPort(claim, 'claimedPort', context.errors, `${path}.claimedPort`);
    requireOptionalBoolean(claim, 'assumesDefaultPort', context.errors, `${path}.assumesDefaultPort`);
    requireOptionalString(claim, 'notes', context.errors, `${path}.notes`);
    requireStringArray(claim, 'evidenceRefs', context.errors, { path: `${path}.evidenceRefs`, requireNonEmpty: true });
    rememberUnique(ids, claimId, `${path}.claimId`, context.errors);
    if (claimedUrl && claimedPort !== undefined) {
      validateUrlPort(claimedUrl, claimedPort, `${path}.claimedUrl`, context.errors);
    }
    if (claim.status !== 'pass') continue;
    if (claim.assumesDefaultPort === true) {
      context.errors.push(`${path} cannot claim pass by assuming the default port`);
    }
    if (claimedPort === undefined) {
      context.errors.push(`${path}.claimedPort is required for pass claims`);
    } else if (!context.actualPorts.has(claimedPort)) {
      context.errors.push(`${path}.claimedPort ${claimedPort} does not match any recorded actual port`);
    }
    if (context.staleProcessCleanup.length === 0) {
      context.errors.push(`${path} cannot claim pass without staleProcessCleanup evidence`);
    }
    if (claimedPort !== undefined && context.defaultPort !== undefined && claimedPort !== context.defaultPort && context.portConflictRecovery.length === 0) {
      context.errors.push(`${path} cannot claim pass on recovered port ${claimedPort} without portConflictRecovery evidence`);
    }
    if (claimedUrl && !hasPassingReadiness(context.readinessChecks, claimedUrl, claimedPort)) {
      context.errors.push(`${path} cannot claim pass without a passing readiness check for the claimed URL and port`);
    }
    if (claimedUrl && !context.browserRefreshes.some((refresh) => refresh.afterUrl === claimedUrl)) {
      context.errors.push(`${path} cannot claim pass without browser refresh evidence for the claimed URL`);
    }
    if (context.codeChangeRestarts.length > 0 && claimedUrl && !context.codeChangeRestarts.some((restart) => restart.restartedUrl === claimedUrl)) {
      context.errors.push(`${path} cannot claim pass after code change without restart evidence for the claimed URL`);
    }
  }
}

function hasPassingReadiness(checks: Record<string, unknown>[], url: string, port: number | undefined): boolean {
  return checks.some((check) => check.status === 'pass' && check.url === url && (port === undefined || check.port === port));
}

function selectBinding(
  ledger: ServiceLifecycleEvidenceLedger,
  preferredRole: string | undefined,
): ServiceLifecyclePortBinding | undefined {
  if (preferredRole) {
    return ledger.portBindings.find((binding) => binding.role === preferredRole);
  }
  return ledger.portBindings[0];
}

function collectEvidenceRefs(ledger: ServiceLifecycleEvidenceLedger): string[] {
  return unique([
    ...ledger.auditRefs,
    ...ledger.portBindings.flatMap((binding) => binding.evidenceRefs ?? []),
    ...ledger.staleProcessCleanup.flatMap((cleanup) => cleanup.evidenceRefs),
    ...ledger.portConflictRecovery.flatMap((recovery) => recovery.evidenceRefs),
    ...ledger.codeChangeRestarts.flatMap((restart) => restart.evidenceRefs),
    ...ledger.browserRefreshes.flatMap((refresh) => refresh.evidenceRefs),
    ...ledger.readinessChecks.flatMap((check) => check.evidenceRefs),
    ...ledger.passClaims.flatMap((claim) => claim.evidenceRefs),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function requireOptionalString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== 'string') {
    errors.push(`${path} must be a string when present`);
  }
}

function requireOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean when present`);
  }
}

function requireOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): void {
  const value = record[key];
  if (value !== undefined && (!Number.isFinite(value) || typeof value !== 'number')) {
    errors.push(`${path} must be a finite number when present`);
  }
}

function requirePort(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): number | undefined {
  const value = record[key];
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer TCP port from 1 to 65535`);
    return undefined;
  }
  return value;
}

function optionalPort(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path = key,
): number | undefined {
  if (record[key] === undefined) return undefined;
  return requirePort(record, key, errors, path);
}

function requireRecordArray(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return [];
  }

  const records: Record<string, unknown>[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`${key}[${index}] must be an object`);
    } else {
      records.push(item);
    }
  }
  return records;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  options: { path?: string; optional?: boolean; requireNonEmpty?: boolean } = {},
): string[] {
  const value = record[key];
  const path = options.path ?? key;
  if (value === undefined && options.optional) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings`);
    return [];
  }

  const strings: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    } else {
      strings.push(item);
    }
  }
  if (options.requireNonEmpty && strings.length === 0) {
    errors.push(`${path} must include at least one ref`);
  }
  return strings;
}

function validateUrlPort(
  url: string | undefined,
  port: number | undefined,
  path: string,
  errors: string[],
): void {
  if (!url || port === undefined) return;
  try {
    const parsed = new URL(url);
    if (!parsed.port) {
      errors.push(`${path} must include an explicit port`);
      return;
    }
    if (Number(parsed.port) !== port) {
      errors.push(`${path} port ${parsed.port} does not match recorded port ${port}`);
    }
  } catch {
    errors.push(`${path} must be a valid URL with an explicit port`);
  }
}

function rememberUnique(
  seen: Set<string>,
  value: string | undefined,
  path: string,
  errors: string[],
): void {
  if (!value) return;
  if (seen.has(value)) {
    errors.push(`${path} duplicates ${value}`);
    return;
  }
  seen.add(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
