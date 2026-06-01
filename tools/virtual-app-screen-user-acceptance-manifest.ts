import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-user-acceptance-manifest.v1' as const;

export type VirtualAppScreenUserAcceptanceStatus =
  | 'passed'
  | 'blocked'
  | 'needs-confirmation'
  | 'requires-handoff';

export type VirtualAppScreenEvidenceClaimKind =
  | 'real-virtual-app-screen'
  | 'package-smoke'
  | 'm6-native-multi-screen'
  | 'target-bound-fixture'
  | 'historical-docker-novnc'
  | 'single-click-smoke'
  | 'dom'
  | 'playwright'
  | 'accessibility'
  | 'shell-direct-artifact'
  | 'old-trace'
  | 'gui-executor'
  | 'shared-system-input'
  | 'adapter-readiness'
  | 'validator-verifier'
  | 'gui-present';

export interface VirtualAppScreenEvidenceClaim {
  id: string;
  kind: VirtualAppScreenEvidenceClaimKind;
  status?: 'present' | 'missing' | 'blocked' | 'diagnostic-only';
  ref?: string;
  refs?: string[];
  evidenceRefs?: string[];
  sessionRefs?: string[];
  completionEvidence?: boolean;
  userAcceptanceEligible?: boolean;
  note?: string;
}

export interface VirtualAppScreenIsolationFlags {
  backgroundRenderable?: boolean;
  affectsPhysicalDisplay?: boolean;
  requiresFocusSteal?: boolean;
  sharedSystemInputUsed?: boolean;
  physicalDisplayPopup?: boolean;
  systemPointerMoved?: boolean;
  systemKeyboardEventsSent?: boolean;
  diagnosticOnly?: boolean;
}

export interface VirtualAppScreenReadinessRecord {
  adapterKind: string;
  targetScope: 'app' | 'window' | 'session' | 'screen' | 'browser' | 'terminal' | string;
  supportedActions: string[];
  captureSupported: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
  blockedReason: string | null;
  schemaRefs: string[];
}

export interface VirtualAppScreenUserAcceptanceInput {
  taskId: string;
  scenarioId: string;
  userIntent: string;
  targetAppRefs?: string[];
  targetWindowRefs?: string[];
  sessionRefs?: string[];
  adapterReadinessRefs?: string[];
  adapterReadinessRecords?: VirtualAppScreenReadinessRecord[];
  screenFrameRefs?: string[];
  inputIntentRefs?: string[];
  executorEventRefs?: string[];
  beforeAfterFrameRefs?: string[];
  annotationProposalRefs?: string[];
  artifactRefs?: string[];
  verificationRefs?: string[];
  guiPresentRefs?: string[];
  replayRef?: string;
  evidenceLedgerRef?: string;
  isolationFlags?: VirtualAppScreenIsolationFlags;
  evidenceClaims?: VirtualAppScreenEvidenceClaim[];
  blockedReason?: string;
  confirmationRequired?: boolean;
  confirmationRef?: string;
  requiresHandoffReason?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface VirtualAppScreenUserAcceptanceManifest {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION;
  taskId: string;
  scenarioId: string;
  userIntent: string;
  status: VirtualAppScreenUserAcceptanceStatus;
  createdAt: string;
  targetAppRefs: string[];
  targetWindowRefs: string[];
  sessionRefs: string[];
  adapterReadinessRefs: string[];
  screenFrameRefs: string[];
  inputIntentRefs: string[];
  executorEventRefs: string[];
  beforeAfterFrameRefs: string[];
  annotationProposalRefs: string[];
  artifactRefs: string[];
  verificationRefs: string[];
  guiPresentRefs: string[];
  replayRef?: string;
  evidenceLedgerRef?: string;
  isolationFlags: Required<VirtualAppScreenIsolationFlags>;
  adapterReadinessRecords: VirtualAppScreenReadinessRecord[];
  evidenceClaims: VirtualAppScreenEvidenceClaim[];
  blockedReason: string | null;
  confirmationRef?: string;
  requiresHandoffReason?: string;
  diagnosticOnly: boolean;
  userAcceptanceEligible: boolean;
  nonSubstitutes: string[];
  validation: {
    ok: boolean;
    issues: string[];
    missingRefs: string[];
    rejectedClaimKinds: VirtualAppScreenEvidenceClaimKind[];
  };
  metadata?: Record<string, unknown>;
}

const nonSubstituteClaimKinds = new Set<VirtualAppScreenEvidenceClaimKind>([
  'package-smoke',
  'm6-native-multi-screen',
  'target-bound-fixture',
  'historical-docker-novnc',
  'single-click-smoke',
  'dom',
  'playwright',
  'accessibility',
  'shell-direct-artifact',
  'old-trace',
  'gui-executor',
  'shared-system-input',
]);

const requiredArrayFields = [
  'targetAppRefs',
  'targetWindowRefs',
  'sessionRefs',
  'adapterReadinessRefs',
  'screenFrameRefs',
  'inputIntentRefs',
  'executorEventRefs',
  'beforeAfterFrameRefs',
  'annotationProposalRefs',
  'artifactRefs',
  'verificationRefs',
  'guiPresentRefs',
] as const;

function refs(value: string[] | undefined): string[] {
  return (value ?? []).filter((ref) => typeof ref === 'string' && ref.trim().length > 0);
}

function hasRef(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeIsolationFlags(flags: VirtualAppScreenIsolationFlags | undefined): Required<VirtualAppScreenIsolationFlags> {
  return {
    backgroundRenderable: flags?.backgroundRenderable === true,
    affectsPhysicalDisplay: flags?.affectsPhysicalDisplay === true,
    requiresFocusSteal: flags?.requiresFocusSteal === true,
    sharedSystemInputUsed: flags?.sharedSystemInputUsed === true,
    physicalDisplayPopup: flags?.physicalDisplayPopup === true,
    systemPointerMoved: flags?.systemPointerMoved === true,
    systemKeyboardEventsSent: flags?.systemKeyboardEventsSent === true,
    diagnosticOnly: flags?.diagnosticOnly === true,
  };
}

function isolationHandoffReason(flags: Required<VirtualAppScreenIsolationFlags>): string | undefined {
  const reasons: string[] = [];
  if (!flags.backgroundRenderable) reasons.push('background rendering is unavailable');
  if (flags.affectsPhysicalDisplay) reasons.push('adapter affects the physical display');
  if (flags.requiresFocusSteal) reasons.push('adapter requires focus steal');
  if (flags.sharedSystemInputUsed) reasons.push('adapter uses shared system input');
  if (flags.physicalDisplayPopup) reasons.push('adapter opens a physical display popup');
  if (flags.systemPointerMoved) reasons.push('adapter moved the system pointer');
  if (flags.systemKeyboardEventsSent) reasons.push('adapter sent system keyboard events');
  return reasons.length ? reasons.join('; ') : undefined;
}

function readinessIssues(records: VirtualAppScreenReadinessRecord[]): string[] {
  const issues: string[] = [];
  records.forEach((record, index) => {
    const label = record.adapterKind || `adapter[${index}]`;
    if (!record.adapterKind) issues.push(`${label}: adapterKind is required.`);
    if (!record.targetScope) issues.push(`${label}: targetScope is required.`);
    if (!record.supportedActions?.length) issues.push(`${label}: supportedActions is required.`);
    if (!record.captureSupported) issues.push(`${label}: captureSupported must be true for user-level evidence.`);
    if (!record.backgroundRenderable) issues.push(`${label}: backgroundRenderable must be true.`);
    if (record.affectsPhysicalDisplay) issues.push(`${label}: affectsPhysicalDisplay must be false.`);
    if (record.requiresFocusSteal) issues.push(`${label}: requiresFocusSteal must be false.`);
    if (record.sharedSystemInputUsed) issues.push(`${label}: sharedSystemInputUsed must be false.`);
    if (!record.schemaRefs?.length) issues.push(`${label}: schemaRefs are required.`);
    if (record.blockedReason) issues.push(`${label}: blockedReason=${record.blockedReason}`);
  });
  return issues;
}

function readinessHandoffReason(records: VirtualAppScreenReadinessRecord[]): string | undefined {
  const reasons = records.flatMap((record) => {
    const label = record.adapterKind || 'adapter';
    return [
      !record.backgroundRenderable ? `${label} cannot render in the background` : undefined,
      record.affectsPhysicalDisplay ? `${label} affects the physical display` : undefined,
      record.requiresFocusSteal ? `${label} requires focus steal` : undefined,
      record.sharedSystemInputUsed ? `${label} uses shared system input` : undefined,
    ].filter((reason): reason is string => Boolean(reason));
  });
  return reasons.length ? reasons.join('; ') : undefined;
}

function rejectedClaimKinds(claims: VirtualAppScreenEvidenceClaim[]): VirtualAppScreenEvidenceClaimKind[] {
  return [...new Set(claims
    .filter((claim) => (
      nonSubstituteClaimKinds.has(claim.kind)
      && (claim.completionEvidence === true || claim.userAcceptanceEligible === true)
    ))
    .map((claim) => claim.kind))];
}

function hasRealVirtualAppScreenEvidence(claims: VirtualAppScreenEvidenceClaim[]): boolean {
  return claims.some((claim) => (
    claim.kind === 'real-virtual-app-screen'
    && claim.status !== 'missing'
    && claim.status !== 'blocked'
    && [
      claim.ref,
      ...(claim.refs ?? []),
      ...(claim.evidenceRefs ?? []),
      ...(claim.sessionRefs ?? []),
    ].some((ref) => typeof ref === 'string' && ref.trim().length > 0)
  ));
}

export function validateVirtualAppScreenUserAcceptanceManifest(
  manifest: Pick<VirtualAppScreenUserAcceptanceManifest,
    | 'targetAppRefs'
    | 'targetWindowRefs'
    | 'sessionRefs'
    | 'adapterReadinessRefs'
    | 'screenFrameRefs'
    | 'inputIntentRefs'
    | 'executorEventRefs'
    | 'beforeAfterFrameRefs'
    | 'annotationProposalRefs'
    | 'artifactRefs'
    | 'verificationRefs'
    | 'guiPresentRefs'
    | 'replayRef'
    | 'evidenceLedgerRef'
    | 'isolationFlags'
    | 'adapterReadinessRecords'
    | 'evidenceClaims'
  >,
): VirtualAppScreenUserAcceptanceManifest['validation'] {
  const missingRefs: string[] = [];
  const issues: string[] = [];

  for (const field of requiredArrayFields) {
    if (!manifest[field].length) missingRefs.push(field);
  }
  if (!hasRef(manifest.replayRef)) missingRefs.push('replayRef');
  if (!hasRef(manifest.evidenceLedgerRef)) missingRefs.push('evidenceLedgerRef');
  if (!hasRealVirtualAppScreenEvidence(manifest.evidenceClaims)) {
    issues.push('real VirtualAppScreen action-causality evidence is required.');
  }

  const rejected = rejectedClaimKinds(manifest.evidenceClaims);
  if (rejected.length) {
    issues.push(`non-substitute evidence cannot be marked userAcceptanceEligible: ${rejected.join(', ')}.`);
  }

  const handoffReason = isolationHandoffReason(manifest.isolationFlags);
  if (handoffReason) issues.push(`isolated background control is not proven: ${handoffReason}.`);
  if (manifest.isolationFlags.diagnosticOnly) issues.push('diagnosticOnly evidence cannot pass user-level acceptance.');
  issues.push(...readinessIssues(manifest.adapterReadinessRecords));

  return {
    ok: missingRefs.length === 0 && issues.length === 0,
    issues,
    missingRefs,
    rejectedClaimKinds: rejected,
  };
}

export function buildVirtualAppScreenUserAcceptanceManifest(
  input: VirtualAppScreenUserAcceptanceInput,
): VirtualAppScreenUserAcceptanceManifest {
  const isolationFlags = normalizeIsolationFlags(input.isolationFlags);
  const manifestBase = {
    targetAppRefs: refs(input.targetAppRefs),
    targetWindowRefs: refs(input.targetWindowRefs),
    sessionRefs: refs(input.sessionRefs),
    adapterReadinessRefs: refs(input.adapterReadinessRefs),
    screenFrameRefs: refs(input.screenFrameRefs),
    inputIntentRefs: refs(input.inputIntentRefs),
    executorEventRefs: refs(input.executorEventRefs),
    beforeAfterFrameRefs: refs(input.beforeAfterFrameRefs),
    annotationProposalRefs: refs(input.annotationProposalRefs),
    artifactRefs: refs(input.artifactRefs),
    verificationRefs: refs(input.verificationRefs),
    guiPresentRefs: refs(input.guiPresentRefs),
    replayRef: input.replayRef,
    evidenceLedgerRef: input.evidenceLedgerRef,
    isolationFlags,
    adapterReadinessRecords: input.adapterReadinessRecords ?? [],
    evidenceClaims: input.evidenceClaims ?? [],
  };
  const validation = validateVirtualAppScreenUserAcceptanceManifest(manifestBase);
  const requiresHandoffReason = input.requiresHandoffReason
    ?? isolationHandoffReason(isolationFlags)
    ?? readinessHandoffReason(manifestBase.adapterReadinessRecords);
  const diagnosticOnly = isolationFlags.diagnosticOnly
    || manifestBase.evidenceClaims.some((claim) => claim.status === 'diagnostic-only');
  const status: VirtualAppScreenUserAcceptanceStatus = input.confirmationRequired
    ? 'needs-confirmation'
    : requiresHandoffReason
      ? 'requires-handoff'
      : validation.ok && !diagnosticOnly
        ? 'passed'
        : 'blocked';
  const blockedReason = status === 'passed'
    ? null
    : input.blockedReason
      ?? (status === 'needs-confirmation'
        ? 'User confirmation is required before this VirtualAppScreen run can pass user-level acceptance.'
        : status === 'requires-handoff'
          ? requiresHandoffReason ?? 'A user handoff is required before this VirtualAppScreen run can pass user-level acceptance.'
          : [
            ...validation.missingRefs.map((ref) => `missing ${ref}`),
            ...validation.issues,
            diagnosticOnly ? 'diagnostic-only evidence cannot pass user-level acceptance.' : undefined,
          ].filter((reason): reason is string => Boolean(reason)).join(' '));

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION,
    taskId: input.taskId,
    scenarioId: input.scenarioId,
    userIntent: input.userIntent,
    status,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...manifestBase,
    blockedReason,
    confirmationRef: input.confirmationRef,
    requiresHandoffReason: status === 'requires-handoff' ? requiresHandoffReason : undefined,
    diagnosticOnly,
    userAcceptanceEligible: status === 'passed',
    nonSubstitutes: [
      'package-local contract smoke',
      'M6/native multi-screen opt-in evidence',
      'target-bound fixtures',
      'historical Docker/noVNC evidence',
      'single-click smoke',
      'DOM/Playwright/accessibility shortcuts',
      'shell direct artifact writes',
      'old traces or cross-bundle refs',
      'GUI executor actions',
      'shared system mouse or keyboard input',
    ],
    validation,
    metadata: input.metadata,
  };
}

export async function writeVirtualAppScreenUserAcceptanceManifest(
  outPath: string,
  input: VirtualAppScreenUserAcceptanceInput,
): Promise<VirtualAppScreenUserAcceptanceManifest> {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(input);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

interface CliArgs {
  inputPath: string;
  outPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  let inputPath = '';
  let outPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-json') {
      inputPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--out') {
      outPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen manifest argument: ${arg}`);
  }
  if (!inputPath) throw new Error('--input-json is required');
  return {
    inputPath,
    outPath: outPath || join('.sciforge', 'vision-runs', `virtual-app-screen-${Date.now()}`, 'manifest.json'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = JSON.parse(await readFile(args.inputPath, 'utf8')) as VirtualAppScreenUserAcceptanceInput;
  const manifest = await writeVirtualAppScreenUserAcceptanceManifest(args.outPath, input);
  process.stdout.write(`[${manifest.status}] wrote ${manifest.schemaVersion} to ${args.outPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
