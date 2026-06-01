import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CU_USER_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.computer-use.user-acceptance-manifest.v1' as const;

export type CuUserAcceptanceStatus =
  | 'blocked'
  | 'ready'
  | 'needs-confirmation'
  | 'single-app-artifact-passed'
  | 'multi-app-workflow-passed';

export type CuEvidenceClaimKind =
  | 'sciForge-chat-origin'
  | 'real-computer-use'
  | 'tui-host-runTask'
  | 'desktop-bridge-ack'
  | 'shared-input-ack'
  | 'independent-input-adapter'
  | 'screenshot-ref'
  | 'grounding-diagnostics-ref'
  | 'verifier-ref'
  | 'gui-present-record'
  | 'dom'
  | 'playwright'
  | 'accessibility'
  | 'generated-file-only';

export interface CuEvidenceClaim {
  id: string;
  kind: CuEvidenceClaimKind;
  status?: 'present' | 'missing' | 'blocked';
  ref?: string;
  refs?: string[];
  recordRefs?: string[];
  evidenceRefs?: string[];
  artifactRefs?: string[];
  sessionRefs?: string[];
  origin?: Record<string, unknown>;
  observationUse?: 'observe-before-mutate-hint' | 'grounding-hint' | string;
  evidenceUse?: 'observe-before-mutate-hint' | 'grounding-hint' | string;
  use?: 'observe-before-mutate-hint' | 'grounding-hint' | string;
  executorLeaseSubstitute?: boolean;
  guiActionSubstitute?: boolean;
  artifactValidationSubstitute?: boolean;
  artifactCausalitySubstitute?: boolean;
  completionEvidence?: boolean;
  completionEvidenceEligible?: boolean;
  completionEvidenceSubstitute?: boolean;
  userLevelCompletionSubstitute?: boolean;
  note?: string;
}

export interface CuTuiHostChainLink {
  id: string;
  kind:
    | 'sciForge-chat-origin'
    | 'gui-terminal-equivalent-text'
    | 'tui-host-runTask'
    | 'computer-use-action-provider'
    | 'host-ports-injected'
    | 'gui.present'
    | 'missing';
  status: 'present' | 'missing' | 'blocked';
  requestRef?: string;
  hostPortsRef?: string;
  toolPayloadRef?: string;
  recordRef?: string;
  origin?: Record<string, unknown>;
  note?: string;
}

export interface CuExecutorLeaseRecord {
  required: true;
  status: 'present' | 'missing' | 'blocked';
  ref?: string;
  owner?: string;
  acquiredAt?: string;
}

export interface CuVerifierVerdictRecord {
  status: 'passed' | 'failed' | 'blocked' | 'not-run';
  verdict:
    | 'single-app-artifact-passed'
    | 'multi-app-workflow-passed'
    | 'blocked'
    | 'not-run'
    | 'failed';
  ref?: string;
  reason: string;
}

export interface CuGuiPresentRecord {
  required: true;
  status: 'present' | 'missing' | 'blocked';
  sourceRef?: string;
  recordRef?: string;
  payloadRef?: string;
  displayedRefs?: string[];
  recordRefs?: string[];
  artifactRefs?: string[];
  sessionRefs?: string[];
  note?: string;
}

export interface CuUserAcceptanceExplicitStatus {
  status: 'needs-confirmation';
  scope: 'high-risk-stop';
  reason: string;
  ref?: string;
}

export interface CuUserAcceptanceInput {
  runId: string;
  taskId?: string;
  scenarioId?: string;
  createdAt: string;
  taskText: string;
  level: 'L2' | 'L3';
  appWorkflow: {
    kind: 'single-app-artifact' | 'multi-app-workflow';
    apps: string[];
    windowSwitchTraceRefs?: string[];
  };
  tuiHostChain: CuTuiHostChainLink[];
  evidenceClaims?: CuEvidenceClaim[];
  screenshotRefs?: {
    before: string[];
    after: string[];
  };
  focusCropRefs?: string[];
  groundingDiagnosticsRefs?: string[];
  executorLease?: Partial<CuExecutorLeaseRecord>;
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  verifierVerdict?: CuVerifierVerdictRecord;
  guiPresent?: Partial<CuGuiPresentRecord>;
  explicitStatus?: CuUserAcceptanceExplicitStatus;
  evidenceMarkers?: Array<Record<string, unknown>>;
  completionEvidence?: Record<string, unknown>;
  completionEvidenceRef?: string;
}

export interface CuUserAcceptanceManifest {
  schemaVersion: typeof CU_USER_ACCEPTANCE_SCHEMA_VERSION;
  runId: string;
  taskId?: string;
  scenarioId?: string;
  createdAt: string;
  status: CuUserAcceptanceStatus;
  taskText: string;
  level: 'L2' | 'L3';
  appWorkflow: {
    kind: 'single-app-artifact' | 'multi-app-workflow';
    apps: string[];
    windowSwitchTraceRefs: string[];
  };
  tuiHostChain: CuTuiHostChainLink[];
  evidenceClaims: CuEvidenceClaim[];
  antiShortcutGuard: {
    status: 'passed' | 'failed';
    rejectedKinds: Array<'dom' | 'playwright' | 'accessibility' | 'generated-file-only'>;
    rejectedClaims: CuEvidenceClaim[];
    rule: string;
  };
  screenshotRefs: {
    before: string[];
    after: string[];
  };
  focusCropRefs: string[];
  groundingDiagnosticsRefs: string[];
  executorLease: CuExecutorLeaseRecord;
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  verifierVerdict: CuVerifierVerdictRecord;
  guiPresent: CuGuiPresentRecord;
  blockedItems: Array<{
    id: string;
    status: 'blocked';
    reason: string;
  }>;
  nonSubstitutes: string[];
  explicitStatus?: CuUserAcceptanceExplicitStatus;
  evidenceMarkers?: Array<Record<string, unknown>>;
  completionEvidence?: Record<string, unknown>;
  completionEvidenceRef?: string;
}

const rejectedShortcutKinds = new Set<CuEvidenceClaimKind>([
  'dom',
  'playwright',
  'accessibility',
  'generated-file-only',
]);

export function evaluateCuUserAcceptanceAntiShortcutGuard(
  evidenceClaims: CuEvidenceClaim[] = [],
): CuUserAcceptanceManifest['antiShortcutGuard'] {
  const rejectedClaims = evidenceClaims.filter((claim) => (
    rejectedShortcutKinds.has(claim.kind)
    && !isAllowedDomAxObservationHintClaim(claim)
  ));
  return {
    status: rejectedClaims.length === 0 ? 'passed' : 'failed',
    rejectedKinds: ['dom', 'playwright', 'accessibility', 'generated-file-only'],
    rejectedClaims,
    rule:
      'CU-05 user acceptance pass evidence must come from TUI Host -> computer_use.runTask(request, hostPorts), screenshot-grounded Computer Use execution, and refs-first DOM/AX/Playwright observation hints only; DOM, Playwright, accessibility, or generated-file-only substitutes cannot be completion evidence.',
  };
}

function isAllowedDomAxObservationHintClaim(claim: CuEvidenceClaim): boolean {
  if (claim.kind !== 'dom' && claim.kind !== 'playwright' && claim.kind !== 'accessibility') return false;
  const use = claim.observationUse ?? claim.evidenceUse ?? claim.use;
  const refs = [
    ...(claim.ref ? [claim.ref] : []),
    ...(claim.refs ?? []),
    ...(claim.recordRefs ?? []),
    ...(claim.evidenceRefs ?? []),
  ];
  return (use === 'observe-before-mutate-hint' || use === 'grounding-hint')
    && refs.length > 0
    && refs.every(isBundleLocalRef)
    && claim.executorLeaseSubstitute !== true
    && claim.guiActionSubstitute !== true
    && claim.artifactValidationSubstitute !== true
    && claim.artifactCausalitySubstitute !== true
    && claim.completionEvidence !== true
    && claim.completionEvidenceEligible !== true
    && claim.completionEvidenceSubstitute !== true
    && claim.userLevelCompletionSubstitute !== true;
}

function isBundleLocalRef(ref: string): boolean {
  return ref.startsWith('.sciforge/vision-runs/') && !ref.includes('..') && !/^[a-z]+:/i.test(ref);
}

export function hasRequiredCuTuiHostChain(tuiHostChain: CuTuiHostChainLink[]): boolean {
  return tuiHostChain.some((link) => (
    link.kind === 'tui-host-runTask'
    && link.status === 'present'
    && Boolean(link.requestRef)
    && Boolean(link.hostPortsRef)
  )) && tuiHostChain.some((link) => (
    link.kind === 'computer-use-action-provider'
    && link.status === 'present'
    && Boolean(link.toolPayloadRef)
  ));
}

function missingReason(input: {
  hostChainReady: boolean;
  hasBeforeAfterScreenshots: boolean;
  hasFocusCrops: boolean;
  hasGroundingDiagnostics: boolean;
  hasExecutorLease: boolean;
  hasFinalArtifact: boolean;
  hasFinalVisibleScreenshot: boolean;
  hasVerifierPass: boolean;
  hasGuiPresent: boolean;
  hasRealComputerUseEvidence: boolean;
  hasIndependentInputAdapterClaim: boolean;
  hasIndependentInputAdapterRefs: boolean;
  hasIndependentInputSessionRefs: boolean;
  hasIndependentInputAdapterEvidence: boolean;
  hasSharedSystemInputAckEvidence: boolean;
  workflowReady: boolean;
  antiShortcutPassed: boolean;
  level: 'L2' | 'L3';
}): string {
  const missing: string[] = [];
  if (!input.antiShortcutPassed) missing.push('shortcut substitute evidence was supplied');
  if (!input.hostChainReady) missing.push('TUI Host runTask chain');
  if (!input.hasRealComputerUseEvidence) missing.push('real Computer Use evidence claim');
  if (input.level === 'L3' && !input.hasIndependentInputAdapterEvidence) {
    if (!input.hasIndependentInputAdapterClaim) {
      missing.push('independent simulated input adapter evidence claim');
    } else {
      if (!input.hasIndependentInputAdapterRefs) {
        missing.push('independent simulated input adapter virtual evidence refs');
      }
      if (!input.hasIndependentInputSessionRefs) {
        missing.push('independent simulated input adapter session evidence refs');
      }
    }
    if (input.hasSharedSystemInputAckEvidence) {
      missing.push('shared-input-ack is shared system input and cannot satisfy final L3 success evidence');
    }
  }
  if (!input.hasBeforeAfterScreenshots) missing.push('before/after screenshot refs');
  if (!input.hasFocusCrops) missing.push('focus crop refs');
  if (!input.hasGroundingDiagnostics) missing.push('grounding diagnostics refs');
  if (!input.hasExecutorLease) missing.push('executor lease');
  if (!input.hasFinalArtifact) missing.push('final artifact ref');
  if (!input.hasFinalVisibleScreenshot) missing.push('final visible screenshot ref');
  if (!input.hasVerifierPass) missing.push('verifier pass verdict');
  if (!input.hasGuiPresent) missing.push('gui.present record with payload and displayed refs');
  if (!input.workflowReady) missing.push('workflow app evidence');
  return missing.length ? `Missing or invalid CU-05 evidence: ${missing.join(', ')}.` : 'CU-05 evidence is incomplete.';
}

function stringRefs(refs: string[] | undefined): string[] {
  return (refs ?? []).filter((ref) => ref.trim().length > 0);
}

function evidenceClaimRecordRefs(claim: CuEvidenceClaim): string[] {
  return [
    claim.ref,
    ...stringRefs(claim.refs),
    ...stringRefs(claim.recordRefs),
    ...stringRefs(claim.evidenceRefs),
    ...stringRefs(claim.artifactRefs),
  ].filter((ref): ref is string => Boolean(ref?.trim()));
}

export function buildCuUserAcceptanceManifest(input: CuUserAcceptanceInput): CuUserAcceptanceManifest {
  const evidenceClaims = input.evidenceClaims ?? [];
  const screenshotRefs = input.screenshotRefs ?? { before: [], after: [] };
  const focusCropRefs = input.focusCropRefs ?? [];
  const groundingDiagnosticsRefs = input.groundingDiagnosticsRefs ?? [];
  const appWorkflow = {
    ...input.appWorkflow,
    windowSwitchTraceRefs: input.appWorkflow.windowSwitchTraceRefs ?? [],
  };
  const antiShortcutGuard = evaluateCuUserAcceptanceAntiShortcutGuard(evidenceClaims);
  const hostChainReady = hasRequiredCuTuiHostChain(input.tuiHostChain);
  const hasBeforeAfterScreenshots = screenshotRefs.before.length > 0 && screenshotRefs.after.length > 0;
  const hasFocusCrops = focusCropRefs.length > 0;
  const hasGroundingDiagnostics = groundingDiagnosticsRefs.length > 0;
  const executorLease: CuExecutorLeaseRecord = {
    required: true,
    status: input.executorLease?.status ?? 'missing',
    ref: input.executorLease?.ref,
    owner: input.executorLease?.owner,
    acquiredAt: input.executorLease?.acquiredAt,
  };
  const hasExecutorLease = executorLease.status === 'present' && Boolean(executorLease.ref);
  const hasFinalArtifact = Boolean(input.finalArtifactRef);
  const hasFinalVisibleScreenshot = Boolean(input.finalVisibleScreenshotRef);
  const verifierVerdict = input.verifierVerdict ?? {
    status: 'not-run',
    verdict: 'not-run',
    reason: 'Verifier has not run against CU-05 user acceptance evidence.',
  };
  const hasVerifierPass = verifierVerdict.status === 'passed'
    && verifierVerdict.verdict === (
      appWorkflow.kind === 'multi-app-workflow'
        ? 'multi-app-workflow-passed'
        : 'single-app-artifact-passed'
    )
    && Boolean(verifierVerdict.ref);
  const guiPresentDisplayedRefs = input.guiPresent?.displayedRefs ?? [];
  const guiPresent: CuGuiPresentRecord = {
    required: true,
    status: input.guiPresent?.status ?? 'missing',
    sourceRef: input.guiPresent?.sourceRef,
    recordRef: input.guiPresent?.recordRef,
    payloadRef: input.guiPresent?.payloadRef,
    displayedRefs: guiPresentDisplayedRefs,
    recordRefs: input.guiPresent?.recordRefs,
    artifactRefs: input.guiPresent?.artifactRefs,
    sessionRefs: input.guiPresent?.sessionRefs,
    note: input.guiPresent?.note,
  };
  const hasGuiPresent = guiPresent.status === 'present'
    && Boolean(guiPresent.recordRef)
    && Boolean(guiPresent.payloadRef)
    && guiPresentDisplayedRefs.length > 0;
  const hasRealComputerUseEvidence = evidenceClaims.some((claim) => claim.kind === 'real-computer-use');
  const independentInputClaims = evidenceClaims.filter((claim) => claim.kind === 'independent-input-adapter');
  const hasIndependentInputAdapterClaim = independentInputClaims.length > 0;
  const hasIndependentInputAdapterRefs = independentInputClaims.some((claim) => evidenceClaimRecordRefs(claim).length > 0);
  const hasIndependentInputSessionRefs = independentInputClaims.some((claim) => stringRefs(claim.sessionRefs).length > 0);
  const hasIndependentInputAdapterEvidence = independentInputClaims.some((claim) => (
    evidenceClaimRecordRefs(claim).length > 0
    && stringRefs(claim.sessionRefs).length > 0
  ));
  const hasSharedSystemInputAckEvidence = evidenceClaims.some((claim) => claim.kind === 'shared-input-ack');
  const l3InputAdapterReady = input.level !== 'L3' || hasIndependentInputAdapterEvidence;
  const workflowReady = appWorkflow.kind === 'multi-app-workflow'
    ? appWorkflow.apps.length >= 2 && appWorkflow.windowSwitchTraceRefs.length > 0
    : appWorkflow.apps.length === 1;
  const passReady = antiShortcutGuard.status === 'passed'
    && hostChainReady
    && hasRealComputerUseEvidence
    && hasBeforeAfterScreenshots
    && hasFocusCrops
    && hasGroundingDiagnostics
    && hasExecutorLease
    && hasFinalArtifact
    && hasFinalVisibleScreenshot
    && hasVerifierPass
    && hasGuiPresent
    && l3InputAdapterReady
    && workflowReady;
  const explicitNeedsConfirmation = input.explicitStatus?.status === 'needs-confirmation'
    && input.explicitStatus.scope === 'high-risk-stop'
    && input.level === 'L3'
    && passReady;
  const completeL3FinalPassEvidenceExceptIndependentInput = input.level === 'L3'
    && !hasIndependentInputAdapterEvidence
    && antiShortcutGuard.status === 'passed'
    && hostChainReady
    && hasRealComputerUseEvidence
    && hasBeforeAfterScreenshots
    && hasFocusCrops
    && hasGroundingDiagnostics
    && hasExecutorLease
    && hasFinalArtifact
    && hasFinalVisibleScreenshot
    && hasVerifierPass
    && hasGuiPresent
    && workflowReady;
  const ready = !passReady
    && !completeL3FinalPassEvidenceExceptIndependentInput
    && antiShortcutGuard.status === 'passed'
    && hostChainReady
    && hasExecutorLease
    && workflowReady;
  const status: CuUserAcceptanceStatus = explicitNeedsConfirmation
    ? 'needs-confirmation'
    : passReady
    ? appWorkflow.kind === 'multi-app-workflow'
      ? 'multi-app-workflow-passed'
      : 'single-app-artifact-passed'
    : ready
      ? 'ready'
      : 'blocked';
  const reason = missingReason({
    hostChainReady,
    hasBeforeAfterScreenshots,
    hasFocusCrops,
    hasGroundingDiagnostics,
    hasExecutorLease,
    hasFinalArtifact,
    hasFinalVisibleScreenshot,
    hasVerifierPass,
    hasGuiPresent,
    hasRealComputerUseEvidence,
    hasIndependentInputAdapterClaim,
    hasIndependentInputAdapterRefs,
    hasIndependentInputSessionRefs,
    hasIndependentInputAdapterEvidence,
    hasSharedSystemInputAckEvidence,
    workflowReady,
    antiShortcutPassed: antiShortcutGuard.status === 'passed',
    level: input.level,
  });

  return {
    schemaVersion: CU_USER_ACCEPTANCE_SCHEMA_VERSION,
    runId: input.runId,
    taskId: input.taskId,
    scenarioId: input.scenarioId,
    createdAt: input.createdAt,
    status,
    taskText: input.taskText,
    level: input.level,
    appWorkflow,
    tuiHostChain: input.tuiHostChain,
    evidenceClaims,
    antiShortcutGuard,
    screenshotRefs,
    focusCropRefs,
    groundingDiagnosticsRefs,
    executorLease,
    finalArtifactRef: input.finalArtifactRef,
    finalVisibleScreenshotRef: input.finalVisibleScreenshotRef,
    verifierVerdict,
    guiPresent,
    blockedItems: status === 'blocked'
      ? [
          {
            id: 'CU-05-user-level-computer-use-acceptance',
            status: 'blocked',
            reason,
          },
        ]
      : [],
    nonSubstitutes: [
      'DOM reads or assertions',
      'Playwright browser automation',
      'accessibility tree actions or assertions',
      'generated files without visible Computer Use execution',
      'shared system mouse or keyboard input as L3 final success evidence',
      'bare independent-input-adapter labels without virtual adapter refs and session refs',
      'API-created artifacts without executor lease and screenshots',
      'dry-run traces without final visible screenshot and gui.present record',
      'gui.present text without payload or displayed object refs',
    ],
    explicitStatus: input.explicitStatus,
    evidenceMarkers: input.evidenceMarkers,
    completionEvidence: input.completionEvidence,
    completionEvidenceRef: input.completionEvidenceRef,
  };
}

export async function writeCuUserAcceptanceManifest(
  outPath: string,
  input: CuUserAcceptanceInput,
): Promise<CuUserAcceptanceManifest> {
  const manifest = buildCuUserAcceptanceManifest(input);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export interface CuUserAcceptanceCliArgs {
  outPath: string;
  inputPath: string;
}

export function parseCuUserAcceptanceCliArgs(argv: string[]): CuUserAcceptanceCliArgs {
  let outPath: string | undefined;
  let inputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--out requires a manifest output path');
      }
      outPath = value;
      index += 1;
      continue;
    }
    if (arg === '--input-json') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--input-json requires a JSON input path');
      }
      inputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown CU user acceptance manifest argument: ${arg}`);
  }

  if (!inputPath) {
    throw new Error('--input-json is required for CU user acceptance manifests');
  }

  return {
    outPath: outPath ?? join('.sciforge', 'vision-runs', `cu-user-acceptance-${Date.now()}`, 'manifest.json'),
    inputPath,
  };
}

export async function readCuUserAcceptanceInput(inputPath: string): Promise<CuUserAcceptanceInput> {
  return JSON.parse(await readFile(inputPath, 'utf8')) as CuUserAcceptanceInput;
}

async function main(): Promise<void> {
  const args = parseCuUserAcceptanceCliArgs(process.argv.slice(2));
  const input = await readCuUserAcceptanceInput(args.inputPath);
  const manifest = await writeCuUserAcceptanceManifest(args.outPath, input);
  console.log(`[${manifest.status}] wrote ${manifest.schemaVersion} to ${args.outPath}`);
}

function isCuUserAcceptanceManifestCliEntrypoint(argv1 = process.argv[1]): boolean {
  const entry = argv1 ? basename(argv1) : '';
  return entry === 'cu-user-acceptance-manifest.ts' || entry === 'cu-user-acceptance-manifest.js';
}

if (isCuUserAcceptanceManifestCliEntrypoint()) {
  await main();
}
