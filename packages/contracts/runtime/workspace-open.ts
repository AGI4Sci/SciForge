import type { CapabilityInvocationBudgetDebitRecord } from './capability-budget';

export const WORKSPACE_OPEN_ACTIONS = ['open-external', 'reveal-in-folder', 'copy-path'] as const;
export type WorkspaceOpenAction = typeof WORKSPACE_OPEN_ACTIONS[number];

export interface WorkspaceOpenResult {
  action: WorkspaceOpenAction;
  path: string;
  workspacePath: string;
  dryRun: boolean;
  budgetDebitRefs?: string[];
  budgetDebits?: CapabilityInvocationBudgetDebitRecord[];
  executionUnit?: WorkspaceOpenExecutionUnit;
  workEvidence?: WorkspaceOpenWorkEvidence;
  audit?: WorkspaceOpenAuditRecord;
}

export interface WorkspaceOpenExecutionUnit {
  id: string;
  tool: 'runtime.workspace-open';
  status: 'done';
  params: string;
  inputData: string[];
  outputArtifacts: string[];
  artifacts: string[];
  budgetDebitRefs: string[];
}

export interface WorkspaceOpenWorkEvidence {
  id: string;
  kind: 'action';
  status: 'success';
  provider: 'workspace-open-gateway';
  input: {
    action: WorkspaceOpenAction;
    path: string;
    workspacePath: string;
    dryRun: boolean;
  };
  outputSummary: string;
  evidenceRefs: string[];
  recoverActions: string[];
  rawRef: string;
  budgetDebitRefs: string[];
}

export interface WorkspaceOpenAuditRecord {
  kind: 'capability-budget-debit-audit';
  ref: string;
  capabilityId: 'runtime.workspace-open';
  action: WorkspaceOpenAction;
  dryRun: boolean;
  budgetDebitRefs: string[];
  sinkRefs: CapabilityInvocationBudgetDebitRecord['sinkRefs'];
}

const WORKSPACE_OPEN_BLOCKED_EXTERNAL_EXTENSIONS = [
  '.app',
  '.bat',
  '.cmd',
  '.com',
  '.dmg',
  '.exe',
  '.pkg',
  '.ps1',
  '.scr',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.command',
  '.scpt',
  '.workflow',
  '.docm',
  '.xlsm',
  '.pptm',
  '.jar',
] as const;

const workspaceOpenActionSet = new Set<string>(WORKSPACE_OPEN_ACTIONS);
const blockedExternalExtensionSet = new Set<string>(WORKSPACE_OPEN_BLOCKED_EXTERNAL_EXTENSIONS);

export function normalizeWorkspaceOpenAction(action: string): WorkspaceOpenAction {
  if (workspaceOpenActionSet.has(action)) return action as WorkspaceOpenAction;
  throw new Error(`Unsupported workspace open action: ${action}`);
}

export function workspaceOpenExternalBlockedExtensionReason(extension: string) {
  const normalized = extension.toLowerCase();
  return blockedExternalExtensionSet.has(normalized)
    ? `Workspace Open Gateway blocked high-risk file type: ${normalized}`
    : undefined;
}
