import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';

export interface GeneratedTaskFailureBudgetDebitInput {
  request: GatewayRequest;
  skill: SkillAvailability;
  failedRequestId: string;
  failureReason: string;
  diagnostics?: Record<string, unknown>;
  payload: ToolPayload;
}

export function generatedTaskFailureBudgetDebitId(
  input: Pick<GeneratedTaskFailureBudgetDebitInput, 'request' | 'skill' | 'failedRequestId' | 'failureReason' | 'diagnostics'>,
) {
  return `budgetDebit:${generatedTaskFailureBudgetDebitSlug(input)}`;
}

export function generatedTaskFailureBudgetDebitAuditRefs(
  input: Pick<GeneratedTaskFailureBudgetDebitInput, 'request' | 'skill' | 'failedRequestId' | 'failureReason' | 'diagnostics'>,
) {
  return uniqueStrings([
    `appendTaskAttempt:${input.failedRequestId}`,
    `audit:capability-budget-debit:${generatedTaskFailureBudgetDebitSlug(input)}`,
  ]);
}

export function attachGeneratedTaskFailureBudgetDebit(
  input: GeneratedTaskFailureBudgetDebitInput,
): ToolPayload {
  const debitId = generatedTaskFailureBudgetDebitId(input);
  const debitSlug = generatedTaskFailureBudgetDebitSlug(input);
  const auditRefs = generatedTaskFailureBudgetDebitAuditRefs(input);
  const budgetDebitRefs = [debitId];
  const executionUnitRef = firstPayloadExecutionUnitId(input.payload) ?? `executionUnit:${input.failedRequestId}`;
  const workEvidence = workEvidenceWithFailureBudgetDebitRefs(input, budgetDebitRefs, debitSlug);
  const workEvidenceRefs = workEvidence.map((entry) => stringField(entry.id)).filter((id): id is string => Boolean(id));
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:${debitSlug}`,
    capabilityId: 'sciforge.agentserver.generation-failure',
    candidateId: input.skill.id,
    manifestRef: input.skill.manifestPath || `capability:${input.skill.id}`,
    subjectRefs: generatedTaskFailureSubjectRefs(input, executionUnitRef, workEvidenceRefs),
    debitLines: generatedTaskFailureDebitLines(input),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs,
      auditRefs,
    },
    metadata: {
      source: 'agentserver-generation-failure',
      skillDomain: input.request.skillDomain,
      skillId: input.skill.id,
      failedRequestId: input.failedRequestId,
      failureKind: stringField(input.diagnostics?.kind),
      categories: Array.isArray(input.diagnostics?.categories) ? input.diagnostics.categories : undefined,
      retryAttempted: input.diagnostics?.retryAttempted,
      retrySucceeded: input.diagnostics?.retrySucceeded,
      backend: input.diagnostics?.backend,
      provider: input.diagnostics?.provider,
      model: input.diagnostics?.model,
      agentId: input.diagnostics?.agentId,
      sessionRef: input.diagnostics?.sessionRef,
    },
  });
  return {
    ...input.payload,
    budgetDebits: upsertBudgetDebit(input.payload.budgetDebits ?? [], debit),
    executionUnits: input.payload.executionUnits.map((unit) => isRecord(unit)
      ? attachBudgetDebitRefs(unit, budgetDebitRefs)
      : unit),
    workEvidence,
    logs: upsertBudgetDebitAuditLog(input.payload.logs ?? [], {
      ref: `audit:capability-budget-debit:${debitSlug}`,
      capabilityId: 'sciforge.agentserver.generation-failure',
      source: 'agentserver-generation-failure',
      failedRequestId: input.failedRequestId,
      budgetDebitRefs,
    }),
  };
}

function generatedTaskFailureBudgetDebitSlug(
  input: Pick<GeneratedTaskFailureBudgetDebitInput, 'request' | 'skill' | 'failedRequestId' | 'failureReason' | 'diagnostics'>,
) {
  const stableInput = [
    'agentserver-generation-failure',
    input.request.skillDomain,
    input.skill.id,
    input.failedRequestId,
    input.failureReason,
    stringField(input.diagnostics?.kind),
    stringField(input.diagnostics?.agentId),
    stringField(input.diagnostics?.sessionRef),
  ].filter(Boolean).join(':');
  return `agentserver-generation-failure:${sha1(stableInput).slice(0, 12)}`;
}

function generatedTaskFailureSubjectRefs(
  input: GeneratedTaskFailureBudgetDebitInput,
  executionUnitRef: string,
  workEvidenceRefs: string[],
) {
  return uniqueStrings([
    input.failedRequestId,
    input.skill.id,
    input.skill.manifestPath,
    executionUnitRef,
    ...workEvidenceRefs,
    stringField(input.diagnostics?.sessionRef),
    stringField(input.diagnostics?.agentId),
    priorHandoffRawRef(input.diagnostics),
    ...input.payload.executionUnits.flatMap((unit) => isRecord(unit) ? [
      stringField(unit.id),
      stringField(unit.outputRef),
      stringField(unit.stderrRef),
      stringField(unit.stdoutRef),
    ] : []),
  ]);
}

function generatedTaskFailureDebitLines(input: GeneratedTaskFailureBudgetDebitInput): CapabilityBudgetDebitLine[] {
  const lines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'networkCalls',
      amount: 1,
      reason: 'AgentServer generation dispatch failed',
      sourceRef: stringField(input.diagnostics?.sessionRef) ?? input.failedRequestId,
    },
    {
      dimension: 'costUnits',
      amount: 1,
      reason: 'AgentServer generation failure surfaced repair-needed payload',
      sourceRef: input.skill.id,
    },
  ];
  if (input.diagnostics?.retryAttempted === true) {
    lines.push({
      dimension: 'retries',
      amount: 1,
      limit: 1,
      remaining: 0,
      reason: 'AgentServer generation retry budget consumed',
      sourceRef: stringField(input.diagnostics?.sessionRef) ?? input.failedRequestId,
    });
  }
  return lines;
}

function workEvidenceWithFailureBudgetDebitRefs(
  input: GeneratedTaskFailureBudgetDebitInput,
  budgetDebitRefs: string[],
  debitSlug: string,
) {
  const existing = Array.isArray(input.payload.workEvidence) ? input.payload.workEvidence : [];
  const evidence = existing.length ? existing : [generatedTaskFailureWorkEvidence(input, debitSlug)];
  return evidence.map((entry, index) => {
    const record: Record<string, unknown> = isRecord(entry) ? entry : {};
    return {
      ...record,
      kind: stringField(record.kind) ?? 'other',
      id: stringField(record.id) ?? `workEvidence:${debitSlug}:${index + 1}`,
      status: stringField(record.status) ?? 'repair-needed',
      provider: stringField(record.provider) ?? 'AgentServer generation',
      evidenceRefs: uniqueStrings([
        ...toStringList(record.evidenceRefs),
        input.failedRequestId,
        stringField(input.diagnostics?.sessionRef),
      ]),
      failureReason: stringField(record.failureReason) ?? input.failureReason,
      recoverActions: toStringList(record.recoverActions),
      budgetDebitRefs: uniqueStrings([
        ...toStringList(record.budgetDebitRefs),
        ...budgetDebitRefs,
      ]),
    };
  });
}

function generatedTaskFailureWorkEvidence(
  input: GeneratedTaskFailureBudgetDebitInput,
  debitSlug: string,
) {
  return {
    kind: 'other',
    id: `workEvidence:${debitSlug}:failure`,
    status: 'repair-needed',
    provider: 'AgentServer generation',
    outputSummary: 'AgentServer generation failed before a runnable task or direct ToolPayload was accepted.',
    evidenceRefs: uniqueStrings([
      input.failedRequestId,
      stringField(input.diagnostics?.sessionRef),
      stringField(input.diagnostics?.agentId),
      priorHandoffRawRef(input.diagnostics),
    ]),
    failureReason: input.failureReason,
    recoverActions: [],
    rawRef: priorHandoffRawRef(input.diagnostics),
  };
}

function upsertBudgetDebit(
  existing: CapabilityInvocationBudgetDebitRecord[],
  debit: CapabilityInvocationBudgetDebitRecord,
) {
  const index = existing.findIndex((entry) => entry.debitId === debit.debitId);
  if (index < 0) return [...existing, debit];
  return existing.map((entry, entryIndex) => entryIndex === index
    ? {
        ...entry,
        sinkRefs: {
          executionUnitRef: entry.sinkRefs.executionUnitRef ?? debit.sinkRefs.executionUnitRef,
          workEvidenceRefs: uniqueStrings([
            ...entry.sinkRefs.workEvidenceRefs,
            ...debit.sinkRefs.workEvidenceRefs,
          ]),
          auditRefs: uniqueStrings([
            ...entry.sinkRefs.auditRefs,
            ...debit.sinkRefs.auditRefs,
          ]),
        },
        metadata: {
          ...(entry.metadata ?? {}),
          ...(debit.metadata ?? {}),
        },
      }
    : entry);
}

function upsertBudgetDebitAuditLog(
  existing: Array<Record<string, unknown>>,
  log: Record<string, unknown> & { ref: string; budgetDebitRefs: string[] },
) {
  const index = existing.findIndex((entry) => stringField(entry.ref) === log.ref);
  if (index < 0) {
    return [
      ...existing,
      {
        kind: 'capability-budget-debit-audit',
        type: 'capability-budget-debit',
        ...log,
      },
    ];
  }
  return existing.map((entry, entryIndex) => entryIndex === index
    ? {
        ...entry,
        ...log,
        budgetDebitRefs: uniqueStrings([
          ...toStringList(entry.budgetDebitRefs),
          ...log.budgetDebitRefs,
        ]),
      }
    : entry);
}

function firstPayloadExecutionUnitId(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const id = stringField(unit.id);
    if (id) return id;
  }
  return undefined;
}

function attachBudgetDebitRefs<T extends Record<string, unknown>>(record: T, refs: string[]): T & {
  budgetDebitRefs: string[];
  refs: Record<string, unknown>;
} {
  return {
    ...record,
    budgetDebitRefs: uniqueStrings([
      ...toStringList(record.budgetDebitRefs),
      ...refs,
    ]),
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      budgetDebits: uniqueStrings([
        ...toStringList(isRecord(record.refs) ? record.refs.budgetDebits : undefined),
        ...refs,
      ]),
    },
  };
}

function priorHandoffRawRef(diagnostics: Record<string, unknown> | undefined) {
  const priorHandoff = isRecord(diagnostics?.priorHandoff) ? diagnostics.priorHandoff : undefined;
  return stringField(priorHandoff?.rawRef);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
