import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
import {
  normalizeWorkspaceOpenAction,
  workspaceOpenExternalBlockedExtensionReason,
  type WorkspaceOpenAction,
  type WorkspaceOpenResult,
} from '@sciforge-ui/runtime-contract/workspace-open';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';
import { isBinaryPreviewFile } from './file-preview.js';

const WORKSPACE_OPEN_CAPABILITY_ID = 'runtime.workspace-open' as const;

export async function runWorkspaceOpenAction(input: {
  workspacePath: string;
  path: string;
  action: string;
  dryRun?: boolean;
}): Promise<WorkspaceOpenResult> {
  const workspacePath = normalizeWorkspaceRootPath(resolve(input.workspacePath));
  const targetPath = resolveWorkspaceOpenPath(workspacePath, input.path);
  const info = await stat(targetPath);
  const action = normalizeWorkspaceOpenAction(input.action);
  if (action === 'open-external') assertCanOpenExternal(targetPath, info.isDirectory());
  const dryRun = input.dryRun === true;
  if (!dryRun && action !== 'copy-path') {
    const args = action === 'reveal-in-folder'
      ? info.isDirectory() ? [targetPath] : ['-R', targetPath]
      : [targetPath];
    const child = spawn('open', args, { detached: true, stdio: 'ignore' });
    child.unref();
  }
  const budgetDebit = createWorkspaceOpenBudgetDebit({
    action,
    targetPath,
    workspacePath,
    dryRun,
    isDirectory: info.isDirectory(),
  });
  return {
    action,
    path: targetPath,
    workspacePath,
    dryRun,
    budgetDebitRefs: [budgetDebit.debit.debitId],
    budgetDebits: [budgetDebit.debit],
    executionUnit: budgetDebit.executionUnit,
    workEvidence: budgetDebit.workEvidence,
    audit: budgetDebit.audit,
  };
}

export function resolveWorkspaceOpenPath(workspacePath: string, rawPath: string) {
  const root = normalizeWorkspaceRootPath(resolve(workspacePath));
  if (!root) throw new Error('workspacePath is required');
  if (!rawPath.trim()) throw new Error('path is required');
  const stripped = rawPath.trim().replace(/^(file|folder):/i, '');
  const targetPath = isAbsolute(stripped) ? resolve(stripped) : resolve(root, stripped);
  const rel = relative(root, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (!isAllowedGeneratedPreviewPath(targetPath)) {
      throw new Error('Workspace Open Gateway refused a path outside the active workspace.');
    }
  }
  return targetPath;
}

function isAllowedGeneratedPreviewPath(targetPath: string) {
  if (!isBinaryPreviewFile(targetPath)) return false;
  const tempRoots = Array.from(new Set([
    resolve('/tmp'),
    resolve('/private/tmp'),
    resolve(tmpdir()),
    resolve('/var/folders'),
    resolve('/private/var/folders'),
  ]));
  return tempRoots.some((root) => {
    const rel = relative(root, targetPath);
    return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  });
}

function assertCanOpenExternal(targetPath: string, isDirectory: boolean) {
  if (isDirectory) return;
  const extension = extname(targetPath).toLowerCase();
  const blockedReason = workspaceOpenExternalBlockedExtensionReason(extension);
  if (blockedReason) throw new Error(blockedReason);
}

function createWorkspaceOpenBudgetDebit(input: {
  action: WorkspaceOpenAction;
  targetPath: string;
  workspacePath: string;
  dryRun: boolean;
  isDirectory: boolean;
}) {
  const slug = workspaceOpenBudgetDebitSlug(input);
  const debitId = `budgetDebit:workspace-open:${slug}`;
  const budgetDebitRefs = [debitId];
  const executionUnitRef = `executionUnit:workspace-open:${slug}`;
  const workEvidenceRef = `workEvidence:workspace-open:${slug}`;
  const auditRef = `audit:capability-budget-debit:workspace-open:${slug}`;
  const actionRef = `workspaceOpen:${input.action}:${input.targetPath}`;
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:workspace-open:${slug}`,
    capabilityId: WORKSPACE_OPEN_CAPABILITY_ID,
    candidateId: WORKSPACE_OPEN_CAPABILITY_ID,
    manifestRef: `capability:${WORKSPACE_OPEN_CAPABILITY_ID}`,
    subjectRefs: uniqueStrings([
      input.workspacePath,
      input.targetPath,
      actionRef,
      executionUnitRef,
      workEvidenceRef,
    ]),
    debitLines: workspaceOpenDebitLines(input, actionRef),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs: [workEvidenceRef],
      auditRefs: [auditRef],
    },
    metadata: {
      source: 'workspace-open-gateway',
      action: input.action,
      dryRun: input.dryRun,
      isDirectory: input.isDirectory,
      sideEffectApplied: !input.dryRun && input.action !== 'copy-path',
    },
  });
  return {
    debit,
    executionUnit: {
      id: executionUnitRef,
      tool: WORKSPACE_OPEN_CAPABILITY_ID,
      status: 'done',
      params: JSON.stringify({
        action: input.action,
        path: input.targetPath,
        workspacePath: input.workspacePath,
        dryRun: input.dryRun,
      }),
      inputData: [input.targetPath],
      outputArtifacts: [],
      artifacts: [],
      budgetDebitRefs,
    },
    workEvidence: {
      id: workEvidenceRef,
      kind: 'action',
      status: 'success',
      provider: 'workspace-open-gateway',
      input: {
        action: input.action,
        path: input.targetPath,
        workspacePath: input.workspacePath,
        dryRun: input.dryRun,
      },
      outputSummary: workspaceOpenOutputSummary(input),
      evidenceRefs: [input.targetPath],
      recoverActions: [],
      rawRef: input.targetPath,
      budgetDebitRefs,
    },
    audit: {
      kind: 'capability-budget-debit-audit',
      ref: auditRef,
      capabilityId: WORKSPACE_OPEN_CAPABILITY_ID,
      action: input.action,
      dryRun: input.dryRun,
      budgetDebitRefs,
      sinkRefs: debit.sinkRefs,
    },
  } satisfies {
    debit: CapabilityInvocationBudgetDebitRecord;
    executionUnit: WorkspaceOpenResult['executionUnit'];
    workEvidence: WorkspaceOpenResult['workEvidence'];
    audit: WorkspaceOpenResult['audit'];
  };
}

function workspaceOpenDebitLines(input: {
  action: WorkspaceOpenAction;
  dryRun: boolean;
}, actionRef: string): CapabilityBudgetDebitLine[] {
  return [
    {
      dimension: 'actionSteps',
      amount: 1,
      reason: input.dryRun
        ? 'validated workspace open action in dry-run mode'
        : 'invoked workspace open action gateway',
      sourceRef: actionRef,
    },
    {
      dimension: 'costUnits',
      amount: 1,
      reason: 'workspace object action produced an auditable runtime result',
      sourceRef: WORKSPACE_OPEN_CAPABILITY_ID,
    },
  ];
}

function workspaceOpenOutputSummary(input: {
  action: WorkspaceOpenAction;
  dryRun: boolean;
  isDirectory: boolean;
}) {
  const targetKind = input.isDirectory ? 'directory' : 'file';
  if (input.action === 'copy-path') return `Validated copy-path action for workspace ${targetKind}.`;
  if (input.dryRun) return `Validated ${input.action} action for workspace ${targetKind} without launching an external app.`;
  return `Invoked ${input.action} action for workspace ${targetKind}.`;
}

function workspaceOpenBudgetDebitSlug(input: {
  action: WorkspaceOpenAction;
  targetPath: string;
  workspacePath: string;
  dryRun: boolean;
  isDirectory: boolean;
}) {
  return createHash('sha1')
    .update([
      WORKSPACE_OPEN_CAPABILITY_ID,
      input.action,
      input.workspacePath,
      input.targetPath,
      input.dryRun ? 'dry-run' : 'live',
      input.isDirectory ? 'directory' : 'file',
    ].join('\0'))
    .digest('hex')
    .slice(0, 12);
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
