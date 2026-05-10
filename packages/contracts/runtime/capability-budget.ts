export const CAPABILITY_BUDGET_DEBIT_CONTRACT_ID = 'sciforge.capability-budget-debit.v1' as const;
export const CAPABILITY_BUDGET_DEBIT_SCHEMA_VERSION = 1 as const;

export const CAPABILITY_BUDGET_DEBIT_DIMENSIONS = [
  'wallMs',
  'contextTokens',
  'toolCalls',
  'observeCalls',
  'actionSteps',
  'networkCalls',
  'downloadBytes',
  'resultItems',
  'providers',
  'retries',
  'costUnits',
] as const;

export type CapabilityBudgetDebitDimension = typeof CAPABILITY_BUDGET_DEBIT_DIMENSIONS[number];

export interface CapabilityBudgetDebitLine {
  dimension: CapabilityBudgetDebitDimension;
  amount: number;
  limit?: number;
  remaining?: number;
  reason?: string;
  sourceRef?: string;
}

export interface CapabilityBudgetDebitSinkRefs {
  executionUnitRef?: string;
  workEvidenceRefs: string[];
  auditRefs: string[];
}

export interface CapabilityInvocationBudgetDebitRecord {
  contract: typeof CAPABILITY_BUDGET_DEBIT_CONTRACT_ID;
  schemaVersion: typeof CAPABILITY_BUDGET_DEBIT_SCHEMA_VERSION;
  debitId: string;
  invocationId: string;
  capabilityId: string;
  candidateId?: string;
  manifestRef?: string;
  subjectRefs: string[];
  debitLines: CapabilityBudgetDebitLine[];
  exceeded: boolean;
  exhaustedDimensions: CapabilityBudgetDebitDimension[];
  sinkRefs: CapabilityBudgetDebitSinkRefs;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCapabilityBudgetDebitRecordInput {
  debitId: string;
  invocationId: string;
  capabilityId: string;
  candidateId?: string;
  manifestRef?: string;
  subjectRefs?: string[];
  debitLines: CapabilityBudgetDebitLine[];
  sinkRefs?: Partial<CapabilityBudgetDebitSinkRefs>;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export function createCapabilityBudgetDebitRecord(input: CreateCapabilityBudgetDebitRecordInput): CapabilityInvocationBudgetDebitRecord {
  const debitLines = input.debitLines
    .map(normalizeDebitLine)
    .filter((line): line is CapabilityBudgetDebitLine => line !== undefined);
  const exhaustedDimensions = uniqueBudgetDimensions(debitLines
    .filter((line) => typeof line.remaining === 'number' && line.remaining <= 0)
    .map((line) => line.dimension));

  return {
    contract: CAPABILITY_BUDGET_DEBIT_CONTRACT_ID,
    schemaVersion: CAPABILITY_BUDGET_DEBIT_SCHEMA_VERSION,
    debitId: input.debitId,
    invocationId: input.invocationId,
    capabilityId: input.capabilityId,
    candidateId: input.candidateId,
    manifestRef: input.manifestRef,
    subjectRefs: uniqueStrings(input.subjectRefs ?? []),
    debitLines,
    exceeded: debitLines.some((line) => typeof line.remaining === 'number' && line.remaining < 0),
    exhaustedDimensions,
    sinkRefs: {
      executionUnitRef: input.sinkRefs?.executionUnitRef,
      workEvidenceRefs: uniqueStrings(input.sinkRefs?.workEvidenceRefs ?? []),
      auditRefs: uniqueStrings(input.sinkRefs?.auditRefs ?? []),
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
    metadata: input.metadata,
  };
}

function normalizeDebitLine(line: CapabilityBudgetDebitLine): CapabilityBudgetDebitLine | undefined {
  if (!CAPABILITY_BUDGET_DEBIT_DIMENSIONS.includes(line.dimension)) return undefined;
  const amount = finiteNonNegative(line.amount);
  if (amount === undefined || amount === 0) return undefined;
  const limit = finiteNonNegative(line.limit);
  const remaining = typeof line.remaining === 'number' && Number.isFinite(line.remaining)
    ? line.remaining
    : undefined;

  return {
    dimension: line.dimension,
    amount,
    limit,
    remaining,
    reason: cleanOptionalString(line.reason),
    sourceRef: cleanOptionalString(line.sourceRef),
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueBudgetDimensions(values: CapabilityBudgetDebitDimension[]): CapabilityBudgetDebitDimension[] {
  return [...new Set(values)];
}
