import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import type { BudgetDowngradeDecision, EvidenceSufficiencyDecision } from './conversation-behavior-optimization.js';

type JsonMap = Record<string, unknown>;

export type FullTextPolicyMode = 'bounded-full-text' | 'metadata-and-abstracts' | 'metadata-only';
export type EvidenceGapSeverity = 'info' | 'warning' | 'blocking';

export interface EvidenceModeDecision {
  strict: boolean;
  fullTextPolicy: FullTextPolicyDecision;
  evidenceGaps: EvidenceGapDecision[];
  confidencePolicy: EvidenceConfidencePolicy;
  reasonCodes: string[];
}

export interface FullTextPolicyDecision {
  mode: FullTextPolicyMode;
  maxDownloads: number;
  escalationAllowed: boolean;
  reasonCodes: string[];
}

export interface EvidenceGapDecision {
  code: string;
  required: boolean;
  presentRefs: string[];
  severity: EvidenceGapSeverity;
  affectsClaims: boolean;
}

export interface EvidenceConfidencePolicy {
  maxConfidence: number;
  requireGapDisclosure: boolean;
  downgradeReasonCodes: string[];
}

export function decideEvidenceMode(
  data: JsonMap,
  evidence: EvidenceSufficiencyDecision,
  budget: BudgetDowngradeDecision,
): EvidenceModeDecision {
  const evidencePolicy = collectPolicyRecords(data, 'evidencePolicy');
  const strict = evidencePolicy.some((policy) => booleanValue(policy.strict) || policyMode(policy) === 'strict')
    || structuredEvidenceMode(data) === 'strict';
  const fullTextPolicy = decideFullTextPolicy(data, budget);
  const evidenceGaps = buildEvidenceGaps(data, evidence, strict);
  const hasGaps = evidenceGaps.length > 0 || evidence.level !== 'sufficient';
  const strictWithGaps = strict && hasGaps;
  const downgradeReasonCodes = uniqueStrings([
    strict ? 'confidence:strict-evidence' : '',
    hasGaps ? 'confidence:evidence-gaps' : '',
    fullTextPolicy.mode === 'metadata-only' ? 'confidence:metadata-only' : '',
  ]);
  const maxConfidence = strictWithGaps
    ? evidence.level === 'insufficient' ? 0.35 : 0.55
    : strict
    ? evidence.level === 'sufficient'
      ? 0.88
      : evidence.level === 'partial'
        ? 0.55
        : 0.35
    : evidence.level === 'sufficient'
      ? 0.92
      : evidence.level === 'partial'
        ? 0.72
        : 0.45;

  return {
    strict,
    fullTextPolicy,
    evidenceGaps,
    confidencePolicy: {
      maxConfidence,
      requireGapDisclosure: strict || hasGaps || fullTextPolicy.mode !== 'bounded-full-text',
      downgradeReasonCodes,
    },
    reasonCodes: uniqueStrings([
      strict ? 'evidence-mode:strict' : 'evidence-mode:normal',
      fullTextPolicy.mode === 'metadata-only' ? 'evidence-mode:metadata-only' : '',
      fullTextPolicy.mode === 'metadata-and-abstracts' ? 'evidence-mode:metadata-and-abstracts' : '',
      hasGaps ? 'evidence-mode:gaps-present' : 'evidence-mode:no-gaps',
    ]),
  };
}

function decideFullTextPolicy(data: JsonMap, budget: BudgetDowngradeDecision): FullTextPolicyDecision {
  const budgetRecord = recordValue(data.budget) ?? {};
  const explicitMode = firstFullTextPolicyMode(data);
  const mode: FullTextPolicyMode = explicitMode
    ?? (budget.level === 'strong'
      ? 'metadata-only'
      : budget.active
        ? 'metadata-and-abstracts'
        : 'bounded-full-text');
  const explicitMaxDownloads = firstNumber([
    ...collectPolicyRecords(data, 'fullTextPolicy').map((policy) => policy.maxDownloads),
    budgetRecord.maxFullTextDownloads,
    budgetRecord.fullTextMaxDownloads,
  ]);
  const maxDownloads = mode === 'metadata-only'
    ? 0
    : explicitMaxDownloads ?? (mode === 'metadata-and-abstracts' ? 0 : 3);
  return {
    mode,
    maxDownloads,
    escalationAllowed: mode !== 'bounded-full-text' || budget.active,
    reasonCodes: uniqueStrings([
      explicitMode ? 'full-text:explicit-policy' : '',
      budget.active ? 'full-text:budget-limited' : 'full-text:budget-normal',
      `full-text:${mode}`,
    ]),
  };
}

function buildEvidenceGaps(
  data: JsonMap,
  evidence: EvidenceSufficiencyDecision,
  strict: boolean,
): EvidenceGapDecision[] {
  const structuredGaps = collectPolicyRecords(data, 'evidencePolicy').flatMap((policy) => [
    ...toStringList(policy.evidenceGaps),
    ...toStringList(policy.requiredEvidenceGaps),
    ...toRecordList(policy.gaps).map((gap) => stringValue(gap.code) || stringValue(gap.id)),
  ]);
  const codes = uniqueStrings([
    ...evidence.missing,
    ...structuredGaps,
    evidence.level !== 'sufficient' && strict ? 'evidence:sufficient-support' : '',
  ]);
  return codes.map((code) => ({
    code,
    required: true,
    presentRefs: evidence.durableEvidenceRefs,
    severity: strict || evidence.level === 'insufficient' ? 'blocking' : 'warning',
    affectsClaims: true,
  }));
}

function collectPolicyRecords(data: JsonMap, key: string): JsonMap[] {
  const out: JsonMap[] = [];
  const execution = recordValue(data.executionModePlan) ?? {};
  const policyOverrides = recordValue(execution.policyOverrides) ?? {};
  const context = recordValue(data.contextPolicy) ?? {};
  const budget = recordValue(data.budget) ?? {};
  for (const value of [data[key], execution[key], policyOverrides[key], context[key], budget[key]]) {
    const record = recordValue(value);
    if (record) out.push(record);
  }
  return out;
}

function policyMode(policy: JsonMap): string {
  return normalizePolicyToken(stringValue(policy.mode) || stringValue(policy.policy) || stringValue(policy.level));
}

function firstFullTextPolicyMode(data: JsonMap): FullTextPolicyMode | undefined {
  const execution = recordValue(data.executionModePlan) ?? {};
  const policyOverrides = recordValue(execution.policyOverrides) ?? {};
  const context = recordValue(data.contextPolicy) ?? {};
  const budget = recordValue(data.budget) ?? {};
  for (const value of [
    data.fullTextPolicy,
    data.fullTextMode,
    execution.fullTextPolicy,
    execution.fullTextMode,
    policyOverrides.fullTextPolicy,
    context.fullTextPolicy,
    budget.fullTextPolicy,
    budget.fullTextMode,
  ]) {
    const normalized = normalizeFullTextPolicyMode(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeFullTextPolicyMode(value: unknown): FullTextPolicyMode | undefined {
  const raw = recordValue(value);
  const text = normalizePolicyToken(raw
    ? stringValue(raw.mode) || stringValue(raw.policy) || stringValue(raw.value)
    : stringValue(value));
  if (!text) return undefined;
  if (['metadata-only', 'metadata', 'metadata-first', 'no-full-text', 'no-fulltext', 'skip-full-text', 'skip-fulltext'].includes(text)) {
    return 'metadata-only';
  }
  if (['abstracts', 'abstract-only', 'metadata-and-abstracts', 'metadata-abstracts'].includes(text)) {
    return 'metadata-and-abstracts';
  }
  if (['bounded-full-text', 'full-text', 'fulltext', 'allow-full-text', 'allow-fulltext'].includes(text)) {
    return 'bounded-full-text';
  }
  return undefined;
}

function structuredEvidenceMode(data: JsonMap): string {
  for (const policy of collectPolicyRecords(data, 'evidencePolicy')) {
    const mode = policyMode(policy);
    if (mode) return mode;
  }
  return '';
}

function normalizePolicyToken(value: string): string {
  return value.toLowerCase().trim().replaceAll(/[\s_]+/g, '-');
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function recordValue(value: unknown): JsonMap | undefined {
  return isRecord(value) ? value : undefined;
}
