import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CapabilityEvolutionCompactRecord,
  CapabilityEvolutionCompactSummary,
  CapabilityEvolutionRecord,
  CapabilityEvolutionRecordStatus,
  CapabilityFallbackDecisionSummary,
  CapabilityFallbackTrigger,
  CapabilityPromotionCandidate,
  CapabilityAtomicTraceSummary,
} from '../../packages/contracts/runtime/capability-evolution.js';
import { normalizeWorkspaceRootPath } from './workspace-paths.js';

export const CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH = '.sciforge/capability-evolution-ledger/records.jsonl';

export interface CapabilityEvolutionLedgerOptions {
  workspacePath: string;
  ledgerPath?: string;
  now?: () => Date;
}

export interface CapabilityEvolutionLedgerAppendResult {
  path: string;
  ref: string;
  record: CapabilityEvolutionRecord;
}

export interface CapabilityEvolutionLedgerReadOptions extends CapabilityEvolutionLedgerOptions {
  limit?: number;
}

export interface CapabilityEvolutionSummaryOptions extends CapabilityEvolutionLedgerReadOptions {
  now?: () => Date;
}

const PROMOTION_PROPOSAL_MIN_SUPPORT = 2;

export function resolveCapabilityEvolutionLedgerPath(options: CapabilityEvolutionLedgerOptions) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath));
  if (!workspaceRoot) throw new Error('workspacePath is required');
  const rawLedgerPath = options.ledgerPath?.trim() || CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH;
  const targetPath = isAbsolute(rawLedgerPath) ? resolve(rawLedgerPath) : resolve(workspaceRoot, rawLedgerPath);
  assertInsideWorkspace(workspaceRoot, targetPath);
  return targetPath;
}

export async function appendCapabilityEvolutionRecord(
  options: CapabilityEvolutionLedgerOptions,
  record: CapabilityEvolutionRecord,
): Promise<CapabilityEvolutionLedgerAppendResult> {
  const ledgerPath = resolveCapabilityEvolutionLedgerPath(options);
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, 'utf8');
  return {
    path: ledgerPath,
    ref: toWorkspaceRef(options.workspacePath, ledgerPath),
    record,
  };
}

export async function readCapabilityEvolutionRecords(
  options: CapabilityEvolutionLedgerReadOptions,
): Promise<CapabilityEvolutionRecord[]> {
  const ledgerPath = resolveCapabilityEvolutionLedgerPath(options);
  const raw = await readFile(ledgerPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapabilityEvolutionRecord);
  return typeof options.limit === 'number' && options.limit >= 0 ? records.slice(-options.limit) : records;
}

export async function buildCapabilityEvolutionCompactSummary(
  options: CapabilityEvolutionSummaryOptions,
): Promise<CapabilityEvolutionCompactSummary> {
  const ledgerPath = resolveCapabilityEvolutionLedgerPath(options);
  const records = await readCapabilityEvolutionRecords(options);
  const sourceRef = toWorkspaceRef(options.workspacePath, ledgerPath);
  const compactRecords = records.map((record, index) => compactCapabilityEvolutionRecord(record, `${sourceRef}#L${index + 1}`));
  const statusCounts: Partial<Record<CapabilityEvolutionRecordStatus, number>> = {};
  for (const record of records) {
    statusCounts[record.finalStatus] = (statusCounts[record.finalStatus] ?? 0) + 1;
  }
  const compactRecordsWithProposals = applyCapabilityEvolutionPromotionProposals(records, compactRecords);
  return {
    schemaVersion: 'sciforge.capability-evolution-compact-summary.v1',
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceRef,
    totalRecords: records.length,
    statusCounts,
    fallbackRecordCount: records.filter(isFallbackRecord).length,
    repairRecordCount: records.filter((record) => record.repairAttempts.length > 0 || record.finalStatus.startsWith('repair-')).length,
    promotionCandidates: compactRecordsWithProposals.filter((record) => record.promotionCandidate?.eligible),
    recentRecords: compactRecordsWithProposals,
  };
}

export function compactCapabilityEvolutionRecord(
  record: CapabilityEvolutionRecord,
  recordRef?: string,
): CapabilityEvolutionCompactRecord {
  return {
    id: record.id,
    recordedAt: record.recordedAt,
    runId: record.runId,
    goalSummary: record.goalSummary,
    selectedCapabilityIds: record.selectedCapabilities.map((capability) => capability.id),
    providerIds: record.providers.map((provider) => provider.id),
    finalStatus: record.finalStatus,
    failureCode: record.failureCode ?? record.validationResult?.failureCode ?? record.composedResult?.failureCode,
    fallbackable: record.composedResult?.fallbackable,
    fallbackDecision: compactFallbackDecision(record),
    atomicTrace: compactAtomicTrace(record),
    recoverActions: record.recoverActions,
    repairAttemptCount: record.repairAttempts.length,
    artifactRefs: record.artifactRefs,
    executionUnitRefs: record.executionUnitRefs,
    validationSummary: record.validationResult?.summary,
    promotionCandidate: record.promotionCandidate,
    recordRef,
  };
}

function isFallbackRecord(record: CapabilityEvolutionRecord) {
  return record.finalStatus.startsWith('fallback-') || (record.composedResult?.atomicTrace.length ?? 0) > 0;
}

function compactFallbackDecision(record: CapabilityEvolutionRecord): CapabilityFallbackDecisionSummary | undefined {
  const fallbackPolicy = record.fallbackPolicy;
  const composedResult = record.composedResult;
  if (!fallbackPolicy && !composedResult) return undefined;
  const failureCode = record.failureCode ?? record.validationResult?.failureCode ?? composedResult?.failureCode;
  const trigger = fallbackTriggerForFailureCode(failureCode, fallbackPolicy?.fallbackToAtomicWhen);
  const atomicCapabilityIds = uniqueSortedStrings([
    ...(fallbackPolicy?.atomicCapabilities ?? []).map((capability) => capability.id),
    ...(composedResult?.atomicTrace ?? []).map((trace) => trace.capabilityId),
  ]);
  const recoverActions = uniqueSortedStrings([
    ...record.recoverActions,
    ...(composedResult?.recoverActions ?? []),
  ]);
  return {
    trigger,
    reason: fallbackPolicy?.fallbackContext?.reason ?? record.validationResult?.summary,
    fallbackable: composedResult?.fallbackable ?? atomicCapabilityIds.length > 0,
    atomicCapabilityIds,
    blockedBy: fallbackPolicy?.doNotFallbackWhen ?? [],
    recoverActions,
  };
}

function compactAtomicTrace(record: CapabilityEvolutionRecord): CapabilityAtomicTraceSummary[] | undefined {
  const trace = record.composedResult?.atomicTrace;
  if (!trace?.length) return undefined;
  return trace.map((entry) => {
    const summary: CapabilityAtomicTraceSummary = {
      capabilityId: entry.capabilityId,
      status: entry.status,
      executionUnitRefs: entry.executionUnitRefs ?? [],
      artifactRefs: entry.artifactRefs ?? [],
    };
    if (entry.providerId) summary.providerId = entry.providerId;
    if (entry.failureCode) summary.failureCode = entry.failureCode;
    if (entry.validationResult?.summary) summary.validationSummary = entry.validationResult.summary;
    return summary;
  });
}

function applyCapabilityEvolutionPromotionProposals(
  records: CapabilityEvolutionRecord[],
  compactRecords: CapabilityEvolutionCompactRecord[],
) {
  const proposedRecords = compactRecords.map((record) => ({ ...record }));
  const proposalsByRecordId = new Map<string, CapabilityPromotionCandidate>();

  for (const proposal of buildSuccessfulCombinationProposals(records, compactRecords)) {
    proposalsByRecordId.set(proposal.recordId, proposal.candidate);
  }
  for (const proposal of buildFailurePatternProposals(records, compactRecords)) {
    proposalsByRecordId.set(proposal.recordId, proposal.candidate);
  }

  return proposedRecords.map((record) => {
    const generatedProposal = proposalsByRecordId.get(record.id);
    if (!generatedProposal) return record;
    return { ...record, promotionCandidate: generatedProposal };
  });
}

function buildSuccessfulCombinationProposals(
  records: CapabilityEvolutionRecord[],
  compactRecords: CapabilityEvolutionCompactRecord[],
) {
  const groups = new Map<string, Array<{ record: CapabilityEvolutionRecord; compact: CapabilityEvolutionCompactRecord; ids: string[] }>>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const compact = compactRecords[index];
    if (!record || !compact || !isSuccessfulRecord(record)) continue;
    const ids = successfulCapabilityIds(record);
    if (ids.length < 2) continue;
    const key = ids.join('+');
    const entries = groups.get(key) ?? [];
    entries.push({ record, compact, ids });
    groups.set(key, entries);
  }

  return Array.from(groups.entries()).flatMap(([key, entries]) => {
    if (entries.length < PROMOTION_PROPOSAL_MIN_SUPPORT) return [];
    const latest = entries.at(-1);
    if (!latest) return [];
    const supportingRecordRefs = entries.flatMap((entry) => entry.compact.recordRef ? [entry.compact.recordRef] : []);
    return [{
      recordId: latest.compact.id,
      candidate: {
        eligible: true,
        proposalKind: 'composed-capability',
        candidateId: `proposal:composed-capability:${shortStableHash(key)}`,
        suggestedCapabilityId: `capability.composed.${capabilitySlug(latest.ids)}`,
        supportCount: entries.length,
        confidence: proposalConfidence(entries.length),
        observedPattern: key,
        supportingRecordRefs,
        reason: `Observed ${entries.length} successful runs with the same capability combination.`,
        suggestedUpdates: {
          capabilityIds: latest.ids,
          repairHints: ['Promote the repeated capability chain into a composed capability with a shared validator contract.'],
        },
      } satisfies CapabilityPromotionCandidate,
    }];
  });
}

function buildFailurePatternProposals(
  records: CapabilityEvolutionRecord[],
  compactRecords: CapabilityEvolutionCompactRecord[],
) {
  const groups = new Map<string, Array<{ record: CapabilityEvolutionRecord; compact: CapabilityEvolutionCompactRecord; failureCode: string }>>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const compact = compactRecords[index];
    if (!record || !compact || !isFailureRecord(record)) continue;
    const failureCode = compact.failureCode ?? 'unknown-failure';
    const validatorId = record.validationResult?.validatorId ?? 'unverified';
    const recoverActions = uniqueSortedStrings(record.recoverActions).join('+') || 'no-recover-action';
    const key = `${failureCode}|validator:${validatorId}|recover:${recoverActions}`;
    const entries = groups.get(key) ?? [];
    entries.push({ record, compact, failureCode });
    groups.set(key, entries);
  }

  return Array.from(groups.entries()).flatMap(([key, entries]) => {
    if (entries.length < PROMOTION_PROPOSAL_MIN_SUPPORT) return [];
    const latest = entries.at(-1);
    if (!latest) return [];
    const validators = uniqueSortedStrings(entries.flatMap((entry) => entry.record.validationResult?.validatorId ? [entry.record.validationResult.validatorId] : []));
    const fallbackTriggers = uniqueFallbackTriggers(entries.flatMap((entry) => entry.record.fallbackPolicy?.fallbackToAtomicWhen ?? []));
    const supportingRecordRefs = entries.flatMap((entry) => entry.compact.recordRef ? [entry.compact.recordRef] : []);
    return [{
      recordId: latest.compact.id,
      candidate: {
        eligible: true,
        proposalKind: failureProposalKind(latest.record),
        candidateId: `proposal:repair-pattern:${shortStableHash(key)}`,
        supportCount: entries.length,
        confidence: proposalConfidence(entries.length),
        observedPattern: key,
        supportingRecordRefs,
        reason: `Observed ${entries.length} repeated failures with the same validation and recovery pattern.`,
        suggestedUpdates: {
          validatorIds: validators,
          failureCodes: uniqueSortedStrings(entries.map((entry) => entry.failureCode)),
          fallbackTriggers,
          repairHints: repairHintsForFailurePattern(latest.failureCode),
        },
      } satisfies CapabilityPromotionCandidate,
    }];
  });
}

function isSuccessfulRecord(record: CapabilityEvolutionRecord) {
  return record.finalStatus === 'succeeded'
    || record.finalStatus === 'fallback-succeeded'
    || record.finalStatus === 'repair-succeeded';
}

function isFailureRecord(record: CapabilityEvolutionRecord) {
  return record.finalStatus === 'failed'
    || record.finalStatus === 'fallback-failed'
    || record.finalStatus === 'repair-failed'
    || record.finalStatus === 'needs-human';
}

function successfulCapabilityIds(record: CapabilityEvolutionRecord) {
  return uniqueSortedStrings([
    ...record.selectedCapabilities
      .filter((capability) => capability.kind !== 'composed' && capability.role !== 'validator' && capability.role !== 'observer')
      .map((capability) => capability.id),
    ...(record.composedResult?.atomicTrace ?? [])
      .filter((trace) => trace.status === 'succeeded')
      .map((trace) => trace.capabilityId),
  ]);
}

function failureProposalKind(record: CapabilityEvolutionRecord): CapabilityPromotionCandidate['proposalKind'] {
  const failureCode = record.failureCode ?? record.validationResult?.failureCode ?? record.composedResult?.failureCode;
  if (failureCode === 'schema-invalid' || record.validationResult?.validatorId) return 'validator-update';
  if (record.fallbackPolicy || record.composedResult?.fallbackable) return 'fallback-policy-update';
  return 'repair-hint-update';
}

function repairHintsForFailurePattern(failureCode: string) {
  if (failureCode === 'schema-invalid') {
    return [
      'Add validator-specific repair hints for missing schema fields before rerun.',
      'Preserve the failed output ref so repair can normalize the payload without inlining generated code.',
    ];
  }
  if (failureCode === 'provider-unavailable' || failureCode === 'timeout') {
    return ['Prefer atomic fallback before retry budget is exhausted for provider availability failures.'];
  }
  if (failureCode === 'missing-artifact') {
    return ['Add a repair hint that maps expected artifact refs to concrete generated artifact ids.'];
  }
  return ['Record the repeated failure pattern as a targeted repair hint and fallback-policy trigger.'];
}

function uniqueFallbackTriggers(values: CapabilityFallbackTrigger[]) {
  return uniqueSortedStrings(values) as CapabilityFallbackTrigger[];
}

function fallbackTriggerForFailureCode(
  failureCode: string | undefined,
  allowedTriggers: CapabilityFallbackTrigger[] | undefined,
): CapabilityFallbackTrigger | undefined {
  if (!failureCode) return undefined;
  if (isCapabilityFallbackTrigger(failureCode)) {
    if (!allowedTriggers?.length || allowedTriggers.includes(failureCode)) return failureCode;
  }
  return allowedTriggers?.[0];
}

function isCapabilityFallbackTrigger(value: string): value is CapabilityFallbackTrigger {
  return [
    'schema-invalid',
    'validation-failed',
    'provider-unavailable',
    'timeout',
    'missing-artifact',
    'execution-failed',
    'low-confidence',
    'policy',
  ].includes(value);
}

function uniqueSortedStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function capabilitySlug(ids: string[]) {
  const slug = ids
    .map((id) => id.replace(/^capability\./, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase())
    .filter(Boolean)
    .join('-');
  return slug.slice(0, 80) || 'proposed';
}

function proposalConfidence(supportCount: number) {
  return Math.min(0.95, 0.55 + supportCount * 0.1);
}

function shortStableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function toWorkspaceRef(workspacePath: string, targetPath: string) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath));
  const rel = relative(workspaceRoot, targetPath).split(sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string) {
  const rel = relative(workspaceRoot, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Capability Evolution Ledger refused a path outside the active workspace.');
  }
}
