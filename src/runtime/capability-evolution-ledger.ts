import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CapabilityEvolutionCompactRecord,
  CapabilityEvolutionCompactSummary,
  CapabilityEvolutionRecord,
  CapabilityEvolutionRecordStatus,
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
  return {
    schemaVersion: 'sciforge.capability-evolution-compact-summary.v1',
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceRef,
    totalRecords: records.length,
    statusCounts,
    fallbackRecordCount: records.filter(isFallbackRecord).length,
    repairRecordCount: records.filter((record) => record.repairAttempts.length > 0 || record.finalStatus.startsWith('repair-')).length,
    promotionCandidates: compactRecords.filter((record) => record.promotionCandidate?.eligible),
    recentRecords: compactRecords,
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
