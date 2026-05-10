import { adaptBackendToolEventToWorkEvidence } from './work-evidence-adapter';

export const WORK_EVIDENCE_KINDS = ['retrieval', 'fetch', 'read', 'write', 'command', 'validate', 'claim', 'artifact', 'other'] as const;
export const WORK_EVIDENCE_STATUSES = ['success', 'empty', 'failed', 'failed-with-reason', 'repair-needed', 'partial'] as const;
export const WORK_EVIDENCE_SCHEMA = {
  kind: { required: true, type: 'string' },
  id: { required: false, type: 'string' },
  status: { required: true, type: 'string', recommended: WORK_EVIDENCE_STATUSES },
  provider: { required: false, type: 'string' },
  input: { required: false, type: ['object', 'string'] },
  resultCount: { required: false, type: 'number' },
  outputSummary: { required: false, type: 'string' },
  evidenceRefs: { required: true, type: 'string[]' },
  failureReason: { required: false, type: 'string' },
  recoverActions: { required: true, type: 'string[]' },
  nextStep: { required: false, type: 'string' },
  diagnostics: { required: false, type: 'string[]' },
  rawRef: { required: false, type: 'string' },
  budgetDebitRefs: { required: false, type: 'string[]' },
} as const;

export type WorkEvidenceKind = typeof WORK_EVIDENCE_KINDS[number];
export type WorkEvidenceStatus = typeof WORK_EVIDENCE_STATUSES[number];

export interface WorkEvidence {
  kind: WorkEvidenceKind | string;
  id?: string;
  status: WorkEvidenceStatus | string;
  provider?: string;
  input?: Record<string, unknown> | string;
  resultCount?: number;
  outputSummary?: string;
  evidenceRefs: string[];
  failureReason?: string;
  recoverActions: string[];
  nextStep?: string;
  diagnostics?: string[];
  rawRef?: string;
  budgetDebitRefs?: string[];
}

export interface WorkEvidenceSchemaIssue {
  path: string;
  reason: string;
}

export interface WorkEvidenceSchemaResult {
  ok: boolean;
  value?: WorkEvidence;
  issues: WorkEvidenceSchemaIssue[];
}

export interface WorkEvidenceHandoffSummary {
  count: number;
  items: Array<Pick<WorkEvidence, 'kind' | 'status' | 'provider' | 'resultCount' | 'failureReason' | 'nextStep' | 'rawRef'> & {
    outputSummary?: string;
    evidenceRefs: string[];
    recoverActions: string[];
    diagnostics: string[];
  }>;
}

export function collectWorkEvidenceFromBackendEvent(value: unknown): WorkEvidence[] {
  const explicit = collectWorkEvidence(value);
  const explicitSet = new Set(explicit.map((entry) => JSON.stringify(entry)));
  const adapted = adaptBackendToolEventToWorkEvidence(value)
    .filter((entry) => {
      const key = JSON.stringify(entry);
      if (explicitSet.has(key)) return false;
      explicitSet.add(key);
      return true;
    });
  return [...explicit, ...adapted];
}

export function parseWorkEvidence(value: unknown): WorkEvidenceSchemaResult {
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '', reason: 'WorkEvidence must be an object.' }] };
  }
  const schemaVersion = stringField(value.schemaVersion);
  if (schemaVersion?.startsWith('sciforge.task-')) {
    return { ok: false, issues: [{ path: 'schemaVersion', reason: 'Task Project records are not WorkEvidence records.' }] };
  }

  const issues: WorkEvidenceSchemaIssue[] = [];
  const kind = stringField(value.kind);
  const status = stringField(value.status);
  const evidenceRefs = stringList(value.evidenceRefs);
  const recoverActions = stringList(value.recoverActions);
  const input = normalizeInput(value.input);

  if (!kind) issues.push({ path: 'kind', reason: 'kind is required.' });
  if (!status) issues.push({ path: 'status', reason: 'status is required.' });
  if (value.input !== undefined && input === undefined) {
    issues.push({ path: 'input', reason: 'input must be an object or string when present.' });
  }
  if (value.resultCount !== undefined && !isFiniteNumber(value.resultCount)) {
    issues.push({ path: 'resultCount', reason: 'resultCount must be a finite number when present.' });
  }
  if (value.diagnostics !== undefined && !Array.isArray(value.diagnostics)) {
    issues.push({ path: 'diagnostics', reason: 'diagnostics must be a string array when present.' });
  }
  if (value.budgetDebitRefs !== undefined && !Array.isArray(value.budgetDebitRefs)) {
    issues.push({ path: 'budgetDebitRefs', reason: 'budgetDebitRefs must be a string array when present.' });
  }
  if (!Array.isArray(value.evidenceRefs)) {
    issues.push({ path: 'evidenceRefs', reason: 'evidenceRefs must be a string array.' });
  }
  if (!Array.isArray(value.recoverActions)) {
    issues.push({ path: 'recoverActions', reason: 'recoverActions must be a string array.' });
  }

  if (issues.length > 0 || !kind || !status) return { ok: false, issues };
  return {
    ok: true,
    issues: [],
    value: {
      kind,
      id: stringField(value.id),
      status,
      provider: stringField(value.provider),
      input,
      resultCount: isFiniteNumber(value.resultCount) ? value.resultCount : undefined,
      outputSummary: stringField(value.outputSummary),
      evidenceRefs,
      failureReason: stringField(value.failureReason),
      recoverActions,
      nextStep: stringField(value.nextStep),
      diagnostics: value.diagnostics === undefined ? undefined : stringList(value.diagnostics),
      rawRef: stringField(value.rawRef),
      budgetDebitRefs: value.budgetDebitRefs === undefined ? undefined : stringList(value.budgetDebitRefs),
    },
  };
}

export function collectWorkEvidence(value: unknown, depth = 0): WorkEvidence[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectWorkEvidence(entry, depth + 1));
  if (!isRecord(value)) return [];

  const own = parseWorkEvidence(value);
  const nested = Object.values(value).flatMap((entry) => collectWorkEvidence(entry, depth + 1));
  return own.ok && own.value ? [own.value, ...nested] : nested;
}

export function summarizeWorkEvidenceForHandoff(value: unknown, options: {
  maxItems?: number;
  maxRefs?: number;
  maxTextChars?: number;
} = {}): WorkEvidenceHandoffSummary | undefined {
  const maxItems = options.maxItems ?? 6;
  const maxRefs = options.maxRefs ?? 6;
  const maxTextChars = options.maxTextChars ?? 360;
  const evidence = Array.isArray(value) && value.every((entry) => parseWorkEvidence(entry).ok)
    ? value.flatMap((entry) => {
      const parsed = parseWorkEvidence(entry);
      return parsed.value ? [parsed.value] : [];
    })
    : collectWorkEvidence(value);
  if (!evidence.length) return undefined;
  return {
    count: evidence.length,
    items: evidence.slice(0, maxItems).map((entry) => ({
      kind: entry.kind,
      status: entry.status,
      provider: entry.provider,
      resultCount: entry.resultCount,
      outputSummary: clipText(entry.outputSummary, maxTextChars),
      evidenceRefs: entry.evidenceRefs.slice(0, maxRefs),
      failureReason: clipText(entry.failureReason, maxTextChars),
      recoverActions: entry.recoverActions.slice(0, 4).map((action) => clipText(action, maxTextChars)).filter((action): action is string => Boolean(action)),
      nextStep: clipText(entry.nextStep, maxTextChars),
      diagnostics: (entry.diagnostics ?? []).slice(0, 4).map((diagnostic) => clipText(diagnostic, maxTextChars)).filter((diagnostic): diagnostic is string => Boolean(diagnostic)),
      rawRef: entry.rawRef,
    })),
  };
}

function normalizeInput(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (isRecord(value)) return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clipText(value: string | undefined, maxChars: number) {
  if (!value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 24))}\n...[truncated ${value.length - Math.max(0, maxChars - 24)} chars]`;
}
