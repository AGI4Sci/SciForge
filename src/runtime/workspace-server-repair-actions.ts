export type RepairActionName = 'commit' | 'push' | 'pr' | 'merge' | 'browser-recheck';

export const REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES = [
  'src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx',
  'src/ui/src/feedback',
  'src/ui/src/api/workspaceClient.ts',
  'src/runtime/workspace-server.ts',
  'src/runtime/repair-handoff-runner.ts',
];

export function repairResultCommitBlocker(result: Record<string, unknown>) {
  if (result.verdict !== 'fixed') return `Repair commit blocked: result verdict is ${String(result.verdict || 'missing')}, not fixed.`;
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const dirty = isRecord(metadata.dirtyWorktreeCollaboration) ? metadata.dirtyWorktreeCollaboration : undefined;
  if (!dirty) return 'Repair commit blocked: dirty worktree guard metadata is missing.';
  if (dirty.status !== 'passed') return `Repair commit blocked: dirty worktree guard status is ${String(dirty.status || 'missing')}.`;
  const protectedPaths = stringArray(dirty.changedProtectedPaths);
  if (protectedPaths.length) return `Repair commit blocked: protected paths changed: ${protectedPaths.join(', ')}.`;
  const forbiddenPaths = stringArray(dirty.changedForbiddenPaths);
  if (forbiddenPaths.length) return `Repair commit blocked: forbidden paths changed: ${forbiddenPaths.join(', ')}.`;
  const outsideAllowedPaths = stringArray(dirty.changedOutsideAllowedPaths);
  if (outsideAllowedPaths.length) return `Repair commit blocked: paths outside allowed scope changed: ${outsideAllowedPaths.join(', ')}.`;
  const executorRepairPlan = isRecord(dirty.executorRepairPlan) ? dirty.executorRepairPlan : undefined;
  if (executorRepairPlan && executorRepairPlan.exists !== true) return 'Repair commit blocked: executor repair plan evidence is missing.';
  const commitAudit = isRecord(dirty.commitAudit) ? dirty.commitAudit : undefined;
  if (!commitAudit) return 'Repair commit blocked: executor commit audit metadata is missing.';
  if (commitAudit.created === true) return 'Repair commit blocked: executor already created a commit in the isolated worktree.';
  const humanVerification = isRecord(result.humanVerification) ? result.humanVerification : undefined;
  if (humanVerification?.status === 'failed' || humanVerification?.status === 'rejected') {
    return `Repair commit blocked: human verification status is ${humanVerification.status}.`;
  }
  return '';
}

export function repairControlSurfaceSafeMode(result: Record<string, unknown>) {
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const existing = isRecord(metadata.safeMode) ? metadata.safeMode : undefined;
  const existingMatched = Array.isArray(existing?.matchedPaths) ? existing.matchedPaths.filter((item): item is string => typeof item === 'string') : [];
  const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  const matchedPaths = uniqueStrings([...existingMatched, ...changedFiles.filter((file) => pathMatchesAnySafeModeScope(file))]);
  const active = existing?.active === true || matchedPaths.length > 0;
  return {
    active,
    reason: active
      ? 'Repair touches the feedback inbox or repair backend/control surface.'
      : 'Repair does not touch the feedback inbox or repair backend/control surface.',
    matchedPaths,
    requiresExternalControlSurface: active,
  };
}

export function pathMatchesAnySafeModeScope(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  return REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

export function repairActionName(value: unknown): RepairActionName {
  if (value === 'commit' || value === 'push' || value === 'pr' || value === 'merge' || value === 'browser-recheck') return value;
  throw new Error('repair action must be one of commit, push, pr, merge, browser-recheck');
}

export function repairBrowserVerificationFromBody(body: Record<string, unknown>, now: string) {
  const input = isRecord(body.browserVerification) ? body.browserVerification : {};
  const requestedStatus = typeof input.status === 'string' ? input.status : typeof body.status === 'string' ? body.status : 'pending';
  let status = requestedStatus === 'verified' || requestedStatus === 'rejected' || requestedStatus === 'pending' || requestedStatus === 'not-run'
    || requestedStatus === 'required' || requestedStatus === 'not-required' || requestedStatus === 'passed' || requestedStatus === 'failed'
    ? requestedStatus
    : 'pending';
  const evidenceRefs = uniqueStrings([
    ...stringArray(input.evidenceRefs),
    ...stringArray(body.evidenceRefs),
  ]);
  if ((status === 'passed' || status === 'verified' || status === 'not-required') && evidenceRefs.length === 0) {
    status = 'pending';
  }
  return {
    status,
    verifier: typeof input.verifier === 'string' && input.verifier.trim() ? input.verifier.trim() : 'codex-in-app-browser',
    reviewer: typeof input.reviewer === 'string' && input.reviewer.trim() ? input.reviewer.trim() : 'feedback-inbox',
    conclusion: typeof input.conclusion === 'string' ? input.conclusion : typeof body.conclusion === 'string' ? body.conclusion : undefined,
    evidenceRefs,
    verifiedAt: typeof input.verifiedAt === 'string' && input.verifiedAt.trim() ? input.verifiedAt.trim() : now,
    note: typeof input.note === 'string' ? input.note : undefined,
  };
}

export function safeRepoRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '');
  return Boolean(normalized)
    && normalized !== '.'
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../')
    && normalized !== '.git'
    && !normalized.startsWith('.git/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
