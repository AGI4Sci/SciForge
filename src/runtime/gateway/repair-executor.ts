import { createHash } from 'node:crypto';

import type {
  AuditRecord,
  RepairDecision,
  RepairDecisionAction,
  ValidationDecision,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { ValidationRepairAuditChain } from './validation-repair-audit-bridge.js';

export const REPAIR_EXECUTOR_RESULT_CONTRACT_ID = 'sciforge.repair-executor-result.v1' as const;
export const REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION = 1 as const;

export type RepairExecutorAction =
  | 'none'
  | 'patch'
  | 'rerun'
  | 'supplement'
  | 'peer-handoff'
  | 'needs-human'
  | 'fail-closed';

export type RepairExecutorStatus =
  | 'executed'
  | 'terminal'
  | 'no-op'
  | 'blocked'
  | 'failed';

export interface RepairExecutorActionPlan {
  planId?: string;
  action: RepairExecutorAction;
  targetRef?: string;
  patchRef?: string;
  outputRef?: string;
  peerRef?: string;
  instructions?: string[];
  expectedRefs?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface RepairExecutorOperationContext {
  plan: RepairExecutorActionPlan;
  repair: RepairDecision;
  validation?: ValidationDecision;
  audit?: AuditRecord;
  relatedRefs: string[];
}

export interface RepairExecutorOperationResult {
  status?: RepairExecutorStatus;
  summary?: string;
  refs?: string[];
  metadata?: Record<string, unknown>;
}

export interface RepairExecutorHandlers {
  patch?: (context: RepairExecutorOperationContext) => Promise<RepairExecutorOperationResult | void> | RepairExecutorOperationResult | void;
  rerun?: (context: RepairExecutorOperationContext) => Promise<RepairExecutorOperationResult | void> | RepairExecutorOperationResult | void;
  supplement?: (context: RepairExecutorOperationContext) => Promise<RepairExecutorOperationResult | void> | RepairExecutorOperationResult | void;
  peerHandoff?: (context: RepairExecutorOperationContext) => Promise<RepairExecutorOperationResult | void> | RepairExecutorOperationResult | void;
}

export interface RepairExecutorResultRef {
  kind: 'repair-executor-result';
  ref: string;
  executorResultId: string;
  action: RepairExecutorAction;
  status: RepairExecutorStatus;
  repairDecisionId: string;
  validationDecisionId?: string;
  auditId?: string;
  strategyAction: RepairDecisionAction;
  relatedRefs: string[];
  executedRefs: string[];
  createdAt: string;
}

export interface RepairExecutorResult {
  contract: typeof REPAIR_EXECUTOR_RESULT_CONTRACT_ID;
  schemaVersion: typeof REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION;
  executorResultId: string;
  executorRef: RepairExecutorResultRef;
  action: RepairExecutorAction;
  status: RepairExecutorStatus;
  strategyAction: RepairDecisionAction;
  summary: string;
  plan: RepairExecutorActionPlan;
  validationDecisionId?: string;
  repairDecisionId: string;
  auditId?: string;
  auditOutcome?: string;
  relatedRefs: string[];
  executedRefs: string[];
  auditTrail: RepairExecutorAuditEntry[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RepairExecutorAuditEntry {
  kind: 'strategy-decision' | 'action-plan' | 'executor-operation' | 'audit-record';
  ref: string;
  action?: string;
  status?: string;
  summary?: string;
}

export interface RepairExecutorInput {
  validation?: ValidationDecision;
  repair: RepairDecision;
  audit?: AuditRecord;
  actionPlan?: RepairExecutorActionPlan;
  createdAt?: string;
}

export type RepairExecutorSource =
  | RepairExecutorInput
  | ValidationRepairAuditChain
  | {
    validationDecision?: ValidationDecision;
    repairDecision: RepairDecision;
    auditRecord?: AuditRecord;
    actionPlan?: RepairExecutorActionPlan;
    createdAt?: string;
  };

export async function executeRepairActionPlan(
  source: RepairExecutorSource,
  handlers: RepairExecutorHandlers = {},
): Promise<RepairExecutorResult> {
  const input = normalizeRepairExecutorInput(source);
  const createdAt = input.createdAt ?? input.actionPlan?.createdAt ?? new Date().toISOString();
  const plan = normalizeActionPlan(input.actionPlan ?? actionPlanFromRepairDecision(input.repair), input.repair, createdAt);
  const relatedRefs = uniqueStrings([
    ...(input.audit?.relatedRefs ?? []),
    ...(input.repair.relatedRefs ?? []),
    ...(input.validation?.relatedRefs ?? []),
    plan.targetRef,
    plan.patchRef,
    plan.outputRef,
    plan.peerRef,
    ...(plan.expectedRefs ?? []),
  ]);
  const context: RepairExecutorOperationContext = {
    plan,
    repair: input.repair,
    validation: input.validation,
    audit: input.audit,
    relatedRefs,
  };
  const operation = await runExecutorOperation(plan.action, context, handlers);
  const status = operation.status ?? terminalStatusForAction(plan.action);
  const executedRefs = uniqueStrings(operation.refs ?? []);
  const executorResultId = stableExecutorResultId({
    action: plan.action,
    status,
    planId: plan.planId,
    repairDecisionId: input.repair.decisionId,
    validationDecisionId: input.validation?.decisionId ?? input.repair.validationDecisionId,
    auditId: input.audit?.auditId,
    executedRefs,
    createdAt,
  });
  const auditTrail: RepairExecutorAuditEntry[] = [
    {
      kind: 'strategy-decision',
      ref: input.repair.decisionId,
      action: input.repair.action,
      status: 'consumed',
      summary: 'RepairExecutor consumed the existing repair decision without recomputing policy.',
    },
    {
      kind: 'action-plan',
      ref: plan.planId ?? executorResultId,
      action: plan.action,
      status: 'consumed',
      summary: 'RepairExecutor executed the supplied action plan.',
    },
    ...(input.audit ? [{
      kind: 'audit-record' as const,
      ref: input.audit.auditId,
      status: input.audit.outcome,
      summary: 'Existing validation/repair audit record linked to executor result.',
    }] : []),
    {
      kind: 'executor-operation',
      ref: executorResultId,
      action: plan.action,
      status,
      summary: operation.summary ?? summaryForAction(plan.action, status),
    },
  ];
  const executorRef: RepairExecutorResultRef = {
    kind: 'repair-executor-result',
    ref: `repair-executor-result:${executorResultId}`,
    executorResultId,
    action: plan.action,
    status,
    repairDecisionId: input.repair.decisionId,
    validationDecisionId: input.validation?.decisionId ?? input.repair.validationDecisionId,
    auditId: input.audit?.auditId,
    strategyAction: input.repair.action,
    relatedRefs,
    executedRefs,
    createdAt,
  };
  return {
    contract: REPAIR_EXECUTOR_RESULT_CONTRACT_ID,
    schemaVersion: REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION,
    executorResultId,
    executorRef,
    action: plan.action,
    status,
    strategyAction: input.repair.action,
    summary: operation.summary ?? summaryForAction(plan.action, status),
    plan,
    validationDecisionId: executorRef.validationDecisionId,
    repairDecisionId: input.repair.decisionId,
    auditId: input.audit?.auditId,
    auditOutcome: input.audit?.outcome,
    relatedRefs,
    executedRefs,
    auditTrail,
    metadata: operation.metadata,
    createdAt,
  };
}

export function actionPlanFromRepairDecision(repair: RepairDecision, overrides: Partial<RepairExecutorActionPlan> = {}): RepairExecutorActionPlan {
  return {
    action: executorActionForRepairDecision(repair.action),
    expectedRefs: repair.relatedRefs,
    instructions: repair.recoverActions,
    createdAt: repair.createdAt,
    ...overrides,
  };
}

export function executorActionForRepairDecision(action: RepairDecisionAction): RepairExecutorAction {
  if (action === 'repair-rerun') return 'rerun';
  if (action === 'fail-closed') return 'fail-closed';
  return action;
}

function normalizeRepairExecutorInput(source: RepairExecutorSource): RepairExecutorInput {
  if ('repairDecision' in source) {
    return {
      validation: source.validationDecision,
      repair: source.repairDecision,
      audit: source.auditRecord,
      actionPlan: source.actionPlan,
      createdAt: source.createdAt,
    };
  }
  if ('repair' in source) {
    return {
      validation: source.validation,
      repair: source.repair,
      audit: source.audit,
      actionPlan: 'actionPlan' in source ? source.actionPlan : undefined,
      createdAt: 'createdAt' in source ? source.createdAt : source.audit?.createdAt,
    };
  }
  throw new Error('RepairExecutor source is missing a repair decision.');
}

function normalizeActionPlan(plan: RepairExecutorActionPlan, repair: RepairDecision, createdAt: string): RepairExecutorActionPlan {
  return {
    planId: plan.planId ?? `repair-plan:${repair.decisionId}:${plan.action}`,
    action: plan.action,
    targetRef: plan.targetRef,
    patchRef: plan.patchRef,
    outputRef: plan.outputRef,
    peerRef: plan.peerRef,
    instructions: uniqueStrings(plan.instructions ?? repair.recoverActions),
    expectedRefs: uniqueStrings(plan.expectedRefs ?? repair.relatedRefs),
    metadata: plan.metadata,
    createdAt: plan.createdAt ?? createdAt,
  };
}

async function runExecutorOperation(
  action: RepairExecutorAction,
  context: RepairExecutorOperationContext,
  handlers: RepairExecutorHandlers,
): Promise<Required<Pick<RepairExecutorOperationResult, 'status' | 'refs'>> & Omit<RepairExecutorOperationResult, 'status' | 'refs'>> {
  try {
    const handler = handlerForAction(action, handlers);
    if (!handler) {
      return {
        status: terminalStatusForAction(action),
        summary: summaryForAction(action, terminalStatusForAction(action)),
        refs: [],
      };
    }
    const result = await handler(context);
    return {
      status: result?.status ?? 'executed',
      summary: result?.summary ?? summaryForAction(action, result?.status ?? 'executed'),
      refs: uniqueStrings(result?.refs ?? []),
      metadata: result?.metadata,
    };
  } catch (error) {
    return {
      status: 'failed',
      summary: error instanceof Error ? error.message : String(error),
      refs: [],
    };
  }
}

function handlerForAction(action: RepairExecutorAction, handlers: RepairExecutorHandlers) {
  if (action === 'patch') return handlers.patch;
  if (action === 'rerun') return handlers.rerun;
  if (action === 'supplement') return handlers.supplement;
  if (action === 'peer-handoff') return handlers.peerHandoff;
  return undefined;
}

function terminalStatusForAction(action: RepairExecutorAction): RepairExecutorStatus {
  if (action === 'none') return 'no-op';
  if (action === 'needs-human' || action === 'fail-closed') return 'terminal';
  return 'blocked';
}

function summaryForAction(action: RepairExecutorAction, status: RepairExecutorStatus) {
  if (status === 'blocked') return `RepairExecutor has no handler for ${action}.`;
  if (action === 'none') return 'No repair action was required.';
  if (action === 'needs-human') return 'RepairExecutor stopped for human review.';
  if (action === 'fail-closed') return 'RepairExecutor failed closed without attempting recovery.';
  return `RepairExecutor ${status} action ${action}.`;
}

function stableExecutorResultId(input: Record<string, unknown>) {
  const digest = createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12);
  return `repair-executor:${digest}`;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
