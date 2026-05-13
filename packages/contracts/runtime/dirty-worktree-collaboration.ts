import {
  NO_HARDCODE_REVIEW_SCHEMA_VERSION,
  type NoHardcodeReview,
} from './task-run-card';

export const DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID = 'sciforge.dirty-worktree-collaboration.v1' as const;
export const DIRTY_WORKTREE_COLLABORATION_SCHEMA_VERSION = 'sciforge.dirty-worktree-collaboration.v1' as const;

export const DIRTY_WORKTREE_CHANGE_STATUSES = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted',
  'unknown',
] as const;

export const DIRTY_WORKTREE_PLAN_STATUSES = ['safe', 'blocked', 'needs-review'] as const;

export type DirtyWorktreeChangeStatus = typeof DIRTY_WORKTREE_CHANGE_STATUSES[number];
export type DirtyWorktreePlanStatus = typeof DIRTY_WORKTREE_PLAN_STATUSES[number];
export type DirtyWorktreeChangeOwner = 'user' | 'agent' | 'generated' | 'unknown';
export type DirtyWorktreeActionKind = 'edit' | 'add' | 'delete' | 'rename' | 'format' | 'test' | 'commit' | 'push' | 'other';

export interface DirtyWorktreeFileChangeInput {
  path: string;
  status?: DirtyWorktreeChangeStatus | string;
  owner?: DirtyWorktreeChangeOwner | string;
  staged?: boolean;
  unstaged?: boolean;
  previousPath?: string;
  changeRef?: string;
  summary?: string;
}

export interface DirtyWorktreeFileChange {
  path: string;
  status: DirtyWorktreeChangeStatus;
  owner: DirtyWorktreeChangeOwner;
  staged: boolean;
  unstaged: boolean;
  previousPath?: string;
  changeRef?: string;
  summary?: string;
}

export interface DirtyWorktreePlannedChangeInput extends DirtyWorktreeFileChangeInput {
  action?: DirtyWorktreeActionKind | string;
}

export interface DirtyWorktreePlannedChange extends DirtyWorktreeFileChange {
  action: DirtyWorktreeActionKind;
}

export interface DirtyWorktreeCommandInput {
  command: string;
  reason?: string;
  plannedPaths?: string[];
}

export interface DirtyWorktreeCommandDecision {
  command: string;
  reason?: string;
  plannedPaths: string[];
  allowed: boolean;
  risk: 'safe' | 'overlap' | 'destructive' | 'needs-review';
  explanation: string;
}

export interface DirtyWorktreePathConflict {
  path: string;
  plannedPath: string;
  reason: string;
}

export interface DirtyWorktreeCollaborationInput {
  planId?: string;
  repoRoot?: string;
  currentBranch?: string;
  baseRef?: string;
  userChanges?: DirtyWorktreeFileChangeInput[];
  plannedChanges?: DirtyWorktreePlannedChangeInput[];
  commands?: Array<string | DirtyWorktreeCommandInput>;
  allowUserOwnedPaths?: string[];
  createdAt?: string;
}

export interface DirtyWorktreeCollaborationPlan {
  contract: typeof DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID;
  schemaVersion: typeof DIRTY_WORKTREE_COLLABORATION_SCHEMA_VERSION;
  planId: string;
  status: DirtyWorktreePlanStatus;
  writeAllowed: boolean;
  repoRoot?: string;
  currentBranch?: string;
  baseRef?: string;
  protectedPaths: string[];
  userChanges: DirtyWorktreeFileChange[];
  plannedChanges: DirtyWorktreePlannedChange[];
  allowedChanges: DirtyWorktreePlannedChange[];
  blockedChanges: DirtyWorktreePlannedChange[];
  pathConflicts: DirtyWorktreePathConflict[];
  commandDecisions: DirtyWorktreeCommandDecision[];
  prohibitedCommands: DirtyWorktreeCommandDecision[];
  allowUserOwnedPaths: string[];
  nextActions: string[];
  noHardcodeReview: NoHardcodeReview;
  createdAt: string;
}

export function parseGitPorcelainStatus(output: string, owner: DirtyWorktreeChangeOwner = 'user'): DirtyWorktreeFileChange[] {
  return output
    .split(/\r?\n/)
    .map((line) => parseGitPorcelainStatusLine(line, owner))
    .filter((change): change is DirtyWorktreeFileChange => Boolean(change));
}

export function buildDirtyWorktreeCollaborationPlan(input: DirtyWorktreeCollaborationInput = {}): DirtyWorktreeCollaborationPlan {
  const allowUserOwnedPaths = uniquePaths(input.allowUserOwnedPaths ?? []);
  const userChanges = (input.userChanges ?? [])
    .map((change) => normalizeFileChange(change, 'user'))
    .filter((change): change is DirtyWorktreeFileChange => Boolean(change));
  const plannedChanges = (input.plannedChanges ?? [])
    .map(normalizePlannedChange)
    .filter((change): change is DirtyWorktreePlannedChange => Boolean(change));
  const protectedPaths = uniquePaths(userChanges
    .filter((change) => change.owner === 'user' || change.owner === 'unknown')
    .flatMap((change) => [change.path, change.previousPath].filter((path): path is string => Boolean(path))));
  const pathConflicts = conflictPaths(protectedPaths, plannedChanges, allowUserOwnedPaths);
  const blockedChangeKeys = new Set(pathConflicts.map((conflict) => conflict.plannedPath));
  const blockedChanges = plannedChanges.filter((change) => blockedChangeKeys.has(change.path));
  const allowedChanges = plannedChanges.filter((change) => !blockedChangeKeys.has(change.path));
  const commandDecisions = normalizeCommandInputs(input.commands ?? []).map((command) => decideCommand(command, protectedPaths, allowUserOwnedPaths));
  const prohibitedCommands = commandDecisions.filter((decision) => !decision.allowed);
  const unknownsNeedReview = userChanges.some((change) => change.status === 'conflicted' || change.status === 'unknown')
    || plannedChanges.some((change) => !change.path || change.status === 'conflicted' || change.status === 'unknown');
  const blocked = pathConflicts.length > 0 || prohibitedCommands.length > 0;
  const status: DirtyWorktreePlanStatus = blocked ? 'blocked' : unknownsNeedReview ? 'needs-review' : 'safe';

  return {
    contract: DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID,
    schemaVersion: DIRTY_WORKTREE_COLLABORATION_SCHEMA_VERSION,
    planId: normalizedText(input.planId) ?? 'dirty-worktree-collaboration',
    status,
    writeAllowed: status === 'safe',
    repoRoot: normalizedText(input.repoRoot),
    currentBranch: normalizedText(input.currentBranch),
    baseRef: normalizedText(input.baseRef),
    protectedPaths,
    userChanges,
    plannedChanges,
    allowedChanges,
    blockedChanges,
    pathConflicts,
    commandDecisions,
    prohibitedCommands,
    allowUserOwnedPaths,
    nextActions: dirtyWorktreeNextActions(status, pathConflicts, prohibitedCommands, protectedPaths),
    noHardcodeReview: dirtyWorktreeNoHardcodeReview(),
    createdAt: normalizedText(input.createdAt) ?? 'pending-clock',
  };
}

export function dirtyWorktreePlanAllowsWrite(plan: DirtyWorktreeCollaborationPlan): boolean {
  return plan.contract === DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID
    && plan.status === 'safe'
    && plan.writeAllowed
    && plan.pathConflicts.length === 0
    && plan.prohibitedCommands.length === 0;
}

export function validateDirtyWorktreeCollaborationPlan(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['DirtyWorktreeCollaborationPlan must be an object.'];
  if (value.contract !== DIRTY_WORKTREE_COLLABORATION_CONTRACT_ID) issues.push('contract must be sciforge.dirty-worktree-collaboration.v1.');
  if (value.schemaVersion !== DIRTY_WORKTREE_COLLABORATION_SCHEMA_VERSION) issues.push('schemaVersion must be sciforge.dirty-worktree-collaboration.v1.');
  if (!DIRTY_WORKTREE_PLAN_STATUSES.includes(value.status as DirtyWorktreePlanStatus)) issues.push('status is invalid.');
  if (typeof value.writeAllowed !== 'boolean') issues.push('writeAllowed must be boolean.');
  for (const key of ['protectedPaths', 'userChanges', 'plannedChanges', 'allowedChanges', 'blockedChanges', 'pathConflicts', 'commandDecisions', 'prohibitedCommands', 'nextActions']) {
    if (!Array.isArray(value[key])) issues.push(`${key} must be an array.`);
  }
  if (value.status === 'safe' && Array.isArray(value.pathConflicts) && value.pathConflicts.length > 0) {
    issues.push('safe plan cannot contain pathConflicts.');
  }
  if (value.status === 'safe' && Array.isArray(value.prohibitedCommands) && value.prohibitedCommands.length > 0) {
    issues.push('safe plan cannot contain prohibitedCommands.');
  }
  if (value.writeAllowed === true && value.status !== 'safe') issues.push('writeAllowed can only be true when status is safe.');
  return issues;
}

function parseGitPorcelainStatusLine(line: string, owner: DirtyWorktreeChangeOwner): DirtyWorktreeFileChange | undefined {
  if (!line.trim()) return undefined;
  if (line.startsWith('?? ')) {
    return normalizeFileChange({ path: line.slice(3), status: 'untracked', owner, staged: false, unstaged: true }, owner);
  }
  const indexStatus = line[0] ?? ' ';
  const worktreeStatus = line[1] ?? ' ';
  const rawPath = line.slice(3);
  const status = gitStatusToChangeStatus(indexStatus, worktreeStatus);
  const renamed = status === 'renamed' || status === 'copied';
  const [previousPath, path] = renamed && rawPath.includes(' -> ')
    ? rawPath.split(' -> ', 2)
    : [undefined, rawPath];
  return normalizeFileChange({
    path,
    previousPath,
    status,
    owner,
    staged: indexStatus !== ' ' && indexStatus !== '?',
    unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?',
  }, owner);
}

function gitStatusToChangeStatus(indexStatus: string, worktreeStatus: string): DirtyWorktreeChangeStatus {
  const combined = `${indexStatus}${worktreeStatus}`;
  if (combined.includes('U')) return 'conflicted';
  if (combined.includes('R')) return 'renamed';
  if (combined.includes('C')) return 'copied';
  if (combined.includes('A')) return 'added';
  if (combined.includes('D')) return 'deleted';
  if (combined.includes('M')) return 'modified';
  if (combined.includes('?')) return 'untracked';
  return 'unknown';
}

function normalizeFileChange(input: DirtyWorktreeFileChangeInput, fallbackOwner: DirtyWorktreeChangeOwner): DirtyWorktreeFileChange | undefined {
  const path = normalizeRepoPath(input.path);
  if (!path) return undefined;
  return {
    path,
    status: normalizeChangeStatus(input.status),
    owner: normalizeOwner(input.owner, fallbackOwner),
    staged: input.staged === true,
    unstaged: input.unstaged !== false,
    previousPath: normalizeRepoPath(input.previousPath),
    changeRef: normalizedText(input.changeRef),
    summary: normalizedText(input.summary),
  };
}

function normalizePlannedChange(input: DirtyWorktreePlannedChangeInput): DirtyWorktreePlannedChange | undefined {
  const normalized = normalizeFileChange(input, 'agent');
  if (!normalized) return undefined;
  return {
    ...normalized,
    owner: normalizeOwner(input.owner, 'agent'),
    action: normalizeAction(input.action, normalized.status),
  };
}

function normalizeCommandInputs(commands: Array<string | DirtyWorktreeCommandInput>): DirtyWorktreeCommandInput[] {
  return commands
    .map((command) => typeof command === 'string' ? { command } : command)
    .filter((command) => Boolean(normalizedText(command.command)))
    .map((command) => ({
      command: command.command.trim(),
      reason: normalizedText(command.reason),
      plannedPaths: uniquePaths(command.plannedPaths ?? []),
    }));
}

function decideCommand(command: DirtyWorktreeCommandInput, protectedPaths: string[], allowUserOwnedPaths: string[]): DirtyWorktreeCommandDecision {
  const destructive = destructiveGitCommandReason(command.command);
  const plannedPaths = uniquePaths([...(command.plannedPaths ?? []), ...extractProtectedPathsFromCommand(command.command, protectedPaths)]);
  const overlaps = plannedPaths.filter((path) => pathOverlapsProtected(path, protectedPaths, allowUserOwnedPaths));
  if (destructive) {
    return {
      command: command.command,
      reason: command.reason,
      plannedPaths,
      allowed: false,
      risk: 'destructive',
      explanation: destructive,
    };
  }
  if (overlaps.length > 0) {
    return {
      command: command.command,
      reason: command.reason,
      plannedPaths,
      allowed: false,
      risk: 'overlap',
      explanation: `Command targets user-owned dirty paths: ${overlaps.join(', ')}.`,
    };
  }
  return {
    command: command.command,
    reason: command.reason,
    plannedPaths,
    allowed: true,
    risk: 'safe',
    explanation: 'Command does not reset, revert, stash, clean, or overwrite protected dirty paths.',
  };
}

function destructiveGitCommandReason(command: string): string | undefined {
  const normalized = command.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!/\bgit\b/.test(normalized)) return undefined;
  if (/\bgit reset\b/.test(normalized) && /\s--hard(?:\s|$)/.test(normalized)) return 'git reset --hard would discard dirty worktree state.';
  if (/\bgit checkout\b/.test(normalized) && /(?:\s--\s|\s\.\s*$|\s\.$)/.test(normalized)) return 'git checkout of worktree paths can revert user-owned edits.';
  if (/\bgit restore\b/.test(normalized) && /(?:\s\.\s*$|\s\.$|\s--source\b|\s--worktree\b|\s--staged\b)/.test(normalized)) return 'git restore can overwrite or unstage user-owned edits.';
  if (/\bgit clean\b/.test(normalized) && /\s-[^\s]*f/.test(normalized)) return 'git clean -f can delete untracked user files.';
  if (/\bgit stash\b/.test(normalized)) return 'git stash can hide or reorder user-owned dirty work.';
  return undefined;
}

function conflictPaths(protectedPaths: string[], plannedChanges: DirtyWorktreePlannedChange[], allowUserOwnedPaths: string[]): DirtyWorktreePathConflict[] {
  const conflicts: DirtyWorktreePathConflict[] = [];
  for (const change of plannedChanges) {
    for (const path of [change.path, change.previousPath].filter((value): value is string => Boolean(value))) {
      if (!pathOverlapsProtected(path, protectedPaths, allowUserOwnedPaths)) continue;
      conflicts.push({
        path,
        plannedPath: change.path,
        reason: `Planned ${change.action} would touch user-owned dirty path ${path}.`,
      });
    }
  }
  return dedupeConflicts(conflicts);
}

function pathOverlapsProtected(path: string, protectedPaths: string[], allowUserOwnedPaths: string[]) {
  const normalized = normalizeRepoPath(path);
  if (!normalized || allowUserOwnedPaths.some((allowed) => pathsOverlap(normalized, allowed))) return false;
  return protectedPaths.some((protectedPath) => pathsOverlap(normalized, protectedPath));
}

function pathsOverlap(left: string, right: string) {
  const a = normalizeRepoPath(left);
  const b = normalizeRepoPath(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function extractProtectedPathsFromCommand(command: string, protectedPaths: string[]) {
  return protectedPaths.filter((path) => command.includes(path));
}

function dirtyWorktreeNextActions(
  status: DirtyWorktreePlanStatus,
  conflicts: DirtyWorktreePathConflict[],
  prohibitedCommands: DirtyWorktreeCommandDecision[],
  protectedPaths: string[],
) {
  if (status === 'safe') {
    return [
      protectedPaths.length > 0
        ? `Proceed only with the planned disjoint paths; keep user-owned dirty paths protected: ${protectedPaths.join(', ')}.`
        : 'Proceed with the planned changes; the worktree has no protected dirty paths in this plan.',
      'Before committing, stage only intended files and leave unrelated user changes untouched.',
    ];
  }
  if (status === 'needs-review') {
    return [
      'Pause before writing because the dirty worktree contains conflicted or unknown file states.',
      'Ask for clarification or narrow the planned paths to files with known ownership.',
    ];
  }
  return [
    conflicts.length > 0
      ? `Do not write protected paths: ${uniquePaths(conflicts.map((conflict) => conflict.path)).join(', ')}.`
      : 'Do not run the blocked worktree command.',
    prohibitedCommands.length > 0
      ? `Remove destructive commands before continuing: ${prohibitedCommands.map((decision) => decision.command).join(' ; ')}.`
      : 'Split the patch so agent-owned edits avoid user-owned dirty paths.',
  ];
}

function dirtyWorktreeNoHardcodeReview(): NoHardcodeReview {
  return {
    schemaVersion: NO_HARDCODE_REVIEW_SCHEMA_VERSION,
    appliesGenerally: true,
    generalityStatement: 'Dirty worktree collaboration is decided from git status paths, ownership, planned write paths, and command risk; it does not branch on a specific milestone, filename, prompt phrase, repository name, or backend.',
    counterExamples: [
      'Blocks an overlap for any protected dirty path, independent of milestone or task label.',
      'Allows disjoint agent edits while preserving user-owned untracked files.',
      'Blocks git reset --hard, git checkout -- path, git restore, git clean -f, and git stash regardless of requested wording.',
    ],
    forbiddenSpecialCases: [
      'specific milestone literal branch',
      'single-file dirty tree exception',
      'repository-name allowlist',
      'prompt-specific “do not revert” string check',
      'backend-specific repair path exemption',
    ],
    ownerLayer: 'workspace',
    status: 'pass',
  };
}

function normalizeChangeStatus(value: unknown): DirtyWorktreeChangeStatus {
  const normalized = normalizedText(value)?.toLowerCase();
  if (DIRTY_WORKTREE_CHANGE_STATUSES.includes(normalized as DirtyWorktreeChangeStatus)) return normalized as DirtyWorktreeChangeStatus;
  if (normalized === 'new') return 'added';
  if (normalized === 'remove' || normalized === 'removed') return 'deleted';
  return 'modified';
}

function normalizeOwner(value: unknown, fallback: DirtyWorktreeChangeOwner): DirtyWorktreeChangeOwner {
  const normalized = normalizedText(value)?.toLowerCase();
  if (normalized === 'user' || normalized === 'agent' || normalized === 'generated' || normalized === 'unknown') return normalized;
  return fallback;
}

function normalizeAction(value: unknown, status: DirtyWorktreeChangeStatus): DirtyWorktreeActionKind {
  const normalized = normalizedText(value)?.toLowerCase();
  if (normalized === 'edit' || normalized === 'add' || normalized === 'delete' || normalized === 'rename' || normalized === 'format' || normalized === 'test' || normalized === 'commit' || normalized === 'push' || normalized === 'other') return normalized;
  if (status === 'added' || status === 'untracked') return 'add';
  if (status === 'deleted') return 'delete';
  if (status === 'renamed') return 'rename';
  return 'edit';
}

function normalizeRepoPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
  if (!normalized || normalized === '.') return undefined;
  return normalized;
}

function normalizedText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniquePaths(values: string[]) {
  return [...new Set(values.map(normalizeRepoPath).filter((path): path is string => Boolean(path)))];
}

function dedupeConflicts(conflicts: DirtyWorktreePathConflict[]) {
  const byKey = new Map<string, DirtyWorktreePathConflict>();
  for (const conflict of conflicts) byKey.set(`${conflict.path}\0${conflict.plannedPath}`, conflict);
  return [...byKey.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
