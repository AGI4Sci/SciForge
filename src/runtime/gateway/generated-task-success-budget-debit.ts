import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import type { CapabilityEvolutionRuntimeEventResult } from './capability-evolution-events.js';

export type GeneratedTaskSuccessBudgetDebitSource = 'generated-task' | 'agentserver-direct-payload';

export interface GeneratedTaskSuccessBudgetDebitInput {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  runId?: string;
  payload: ToolPayload;
  refs: Pick<RuntimeRefBundle, 'taskRel' | 'outputRel' | 'stdoutRel' | 'stderrRel'> & { inputRel?: string };
  source: GeneratedTaskSuccessBudgetDebitSource;
  runtimeLabel: string;
  ledgerRefs?: string[];
}

export function generatedTaskSuccessBudgetDebitId(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
) {
  return `budgetDebit:${generatedTaskSuccessBudgetDebitSlug(input)}`;
}

export function generatedTaskSuccessBudgetDebitAuditRefs(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
  ledgerRefs: string[] = [],
) {
  return uniqueStrings([
    `appendTaskAttempt:${input.taskId}`,
    `audit:capability-budget-debit:${generatedTaskSuccessBudgetDebitSlug(input)}`,
    ...ledgerRefs,
  ]);
}

export function capabilityEvolutionLedgerRefsFromResult(result: CapabilityEvolutionRuntimeEventResult | undefined) {
  return uniqueStrings([
    result?.ledgerRef,
    result?.recordRef,
    result?.record.id ? `capabilityEvolutionRecord:${result.record.id}` : undefined,
  ]);
}

export function attachGeneratedTaskSuccessBudgetDebit(
  input: GeneratedTaskSuccessBudgetDebitInput,
): ToolPayload {
  const debitId = generatedTaskSuccessBudgetDebitId(input);
  const debitSlug = generatedTaskSuccessBudgetDebitSlug(input);
  const auditRefs = generatedTaskSuccessBudgetDebitAuditRefs(input, input.ledgerRefs);
  const budgetDebitRefs = [debitId];
  const executionUnitRef = firstPayloadExecutionUnitId(input.payload) ?? `executionUnit:${input.taskId}`;
  const executionUnits = input.payload.executionUnits.map((unit) => isRecord(unit)
    ? attachBudgetDebitRefs(unit, budgetDebitRefs)
    : unit);
  const workEvidence = workEvidenceWithGeneratedTaskBudgetDebitRefs(input, budgetDebitRefs, debitSlug);
  const workEvidenceRefs = workEvidence.map((entry) => stringField(entry.id)).filter((id): id is string => Boolean(id));
  const capabilityId = input.source === 'generated-task'
    ? 'sciforge.generated-task-runner'
    : 'sciforge.agentserver.direct-payload';
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:${debitSlug}`,
    capabilityId,
    candidateId: input.skill.id,
    manifestRef: input.skill.manifestPath || `capability:${input.skill.id}`,
    subjectRefs: generatedTaskSuccessSubjectRefs(input, executionUnitRef, workEvidenceRefs),
    debitLines: generatedTaskSuccessDebitLines(input),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs,
      auditRefs,
    },
    metadata: {
      source: input.source,
      runtimeLabel: input.runtimeLabel,
      skillDomain: input.request.skillDomain,
      skillId: input.skill.id,
      runId: input.runId,
      taskId: input.taskId,
      ledgerRefs: input.ledgerRefs,
    },
  });
  return {
    ...input.payload,
    budgetDebits: upsertBudgetDebit(input.payload.budgetDebits ?? [], debit),
    executionUnits,
    workEvidence,
    logs: upsertBudgetDebitAuditLog(input.payload.logs ?? [], {
      ref: `audit:capability-budget-debit:${debitSlug}`,
      capabilityId,
      source: input.source,
      taskId: input.taskId,
      runId: input.runId,
      ledgerRefs: input.ledgerRefs,
      budgetDebitRefs,
    }),
  };
}

function generatedTaskSuccessBudgetDebitSlug(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
) {
  const stableInput = [
    input.source,
    input.request.skillDomain,
    input.skill.id,
    input.runId,
    input.taskId,
    input.refs.taskRel,
    input.refs.outputRel,
  ].filter(Boolean).join(':');
  return `${input.source}:${sha1(stableInput).slice(0, 12)}`;
}

function generatedTaskSuccessSubjectRefs(
  input: GeneratedTaskSuccessBudgetDebitInput,
  executionUnitRef: string,
  workEvidenceRefs: string[],
) {
  return uniqueStrings([
    input.taskId,
    input.runId,
    input.refs.taskRel,
    input.refs.inputRel,
    input.refs.outputRel,
    input.refs.stdoutRel,
    input.refs.stderrRel,
    executionUnitRef,
    ...workEvidenceRefs,
    ...input.payload.artifacts.map((artifact) => isRecord(artifact) ? stringField(artifact.id) ?? stringField(artifact.ref) ?? stringField(artifact.dataRef) : undefined),
    ...input.payload.executionUnits.flatMap((unit) => isRecord(unit) ? [
      stringField(unit.id),
      stringField(unit.outputRef),
      stringField(unit.diffRef),
    ] : []),
  ]);
}

function generatedTaskSuccessDebitLines(input: GeneratedTaskSuccessBudgetDebitInput): CapabilityBudgetDebitLine[] {
  return [
    {
      dimension: 'toolCalls',
      amount: 1,
      reason: input.source === 'generated-task'
        ? 'executed AgentServer generated workspace task'
        : 'accepted AgentServer direct payload',
      sourceRef: input.refs.taskRel,
    },
    {
      dimension: 'resultItems',
      amount: Math.max(1, input.payload.artifacts.length + input.payload.claims.length),
      reason: 'completed payload result items',
      sourceRef: input.refs.outputRel,
    },
    {
      dimension: 'costUnits',
      amount: 1,
      reason: input.runtimeLabel,
      sourceRef: input.skill.id,
    },
  ];
}

function workEvidenceWithGeneratedTaskBudgetDebitRefs(
  input: GeneratedTaskSuccessBudgetDebitInput,
  budgetDebitRefs: string[],
  debitSlug: string,
) {
  const existing = Array.isArray(input.payload.workEvidence) ? input.payload.workEvidence : [];
  const evidence = existing.length ? existing : [generatedTaskSuccessWorkEvidence(input, debitSlug)];
  return evidence.map((entry, index) => {
    const record: Record<string, unknown> = isRecord(entry) ? entry : {};
    return {
      ...record,
      kind: stringField(record.kind) ?? (input.source === 'generated-task' ? 'command' : 'claim'),
      id: stringField(record.id) ?? `workEvidence:${debitSlug}:${index + 1}`,
      status: stringField(record.status) ?? 'success',
      provider: stringField(record.provider) ?? input.runtimeLabel,
      evidenceRefs: uniqueStrings([
        ...toStringList(record.evidenceRefs),
        input.refs.outputRel,
        input.refs.stdoutRel,
        input.refs.stderrRel,
      ]),
      recoverActions: toStringList(record.recoverActions),
      budgetDebitRefs: uniqueStrings([
        ...toStringList(record.budgetDebitRefs),
        ...budgetDebitRefs,
      ]),
    };
  });
}

function generatedTaskSuccessWorkEvidence(
  input: GeneratedTaskSuccessBudgetDebitInput,
  debitSlug: string,
) {
  return {
    kind: input.source === 'generated-task' ? 'command' : 'claim',
    id: `workEvidence:${debitSlug}:success`,
    status: 'success',
    provider: input.runtimeLabel,
    resultCount: Math.max(1, input.payload.artifacts.length + input.payload.claims.length),
    outputSummary: input.source === 'generated-task'
      ? 'AgentServer generated task executed successfully and produced a normalized ToolPayload.'
      : 'AgentServer direct payload completed successfully and was normalized into a ToolPayload.',
    evidenceRefs: uniqueStrings([
      input.refs.outputRel,
      input.refs.stdoutRel,
      input.refs.stderrRel,
      input.refs.taskRel,
    ]),
    recoverActions: [],
    rawRef: input.refs.outputRel,
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
        ledgerRefs: uniqueStrings([
          ...toStringList(entry.ledgerRefs),
          ...toStringList(log.ledgerRefs),
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
      ...stringList(record.budgetDebitRefs),
      ...refs,
    ]),
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      budgetDebits: uniqueStrings([
        ...stringList(isRecord(record.refs) ? record.refs.budgetDebits : undefined),
        ...refs,
      ]),
    },
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
