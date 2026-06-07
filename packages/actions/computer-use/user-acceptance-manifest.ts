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
  | 'tui-host-runTask'
  | 'real-computer-use'
  | 'computer-use-primitive-session'
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
    | 'tui-host-runTask'
    | 'gui-terminal-equivalent-text'
    | 'computer-use-primitive-session'
    | 'computer-use-action-provider'
    | 'host-ports-injected'
    | 'gui.present'
    | 'missing';
  status: 'present' | 'missing' | 'blocked';
  requestRef?: string;
  hostPortsRef?: string;
  sessionRef?: string;
  primitiveTraceRef?: string;
  traceRef?: string;
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
  screenId?: string;
  windowId?: string;
  actorId?: string;
  cursorId?: string;
  leaseScope?: Record<string, unknown>;
  scope?: Record<string, unknown>;
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
  cuNextTaskId?: string;
  cuNextTask?: Record<string, unknown>;
  productPathClassification?: Record<string, unknown>;
  productPath?: Record<string, unknown>;
  acceptancePathClassification?: Record<string, unknown>;
  userControlPlane?: Record<string, unknown>;
  userControl?: Record<string, unknown>;
  sessionPermission?: Record<string, unknown>;
  platformSidecarIsolationReport?: Record<string, unknown>;
  platformSidecarIsolation?: Record<string, unknown>;
  platformSidecar?: Record<string, unknown>;
  displayGroupId?: string;
  currentRunBundleRef?: string;
  currentBundleRef?: string;
  screenId?: string;
  screenIds?: string[];
  screens?: Array<Record<string, unknown>>;
  virtualScreens?: Array<Record<string, unknown>>;
  visibleScreenRefs?: string[];
  actorId?: string;
  actorIds?: string[];
  cursorId?: string;
  cursorIds?: string[];
  virtualDisplayGroup?: Record<string, unknown>;
  virtualDesktopSession?: Record<string, unknown>;
  actorCursorProvenance?: Array<Record<string, unknown>>;
  actorCursors?: Array<Record<string, unknown>>;
  visibleCursorRefs?: Array<string | Record<string, unknown>>;
  cursorEvents?: Array<Record<string, unknown>>;
  actorCursorEvents?: Array<Record<string, unknown>>;
  observeBeforeMutate?: Record<string, unknown>;
  observationFreshness?: Record<string, unknown>;
  browserRuntimeDomAxObservation?: Record<string, unknown> | Array<Record<string, unknown>>;
  browserRuntimeDomAxObservations?: Array<Record<string, unknown>>;
  browserRuntimeObservation?: Record<string, unknown>;
  browserRuntimeObservationHint?: Record<string, unknown>;
  browserRuntimeObservationHints?: Array<Record<string, unknown>>;
  domAxObservation?: Record<string, unknown>;
  domAxObservationHints?: Array<Record<string, unknown>>;
  actionProposals?: Array<Record<string, unknown>>;
  proposals?: Array<Record<string, unknown>>;
  executorQueue?: Array<Record<string, unknown>>;
  leaseQueue?: Array<Record<string, unknown>>;
  schedulerQueue?: Array<Record<string, unknown>>;
  executorLeases?: Array<Record<string, unknown>>;
  leases?: Array<Record<string, unknown>>;
  mutatingActions?: Array<Record<string, unknown>>;
  actionCausality?: Array<Record<string, unknown>>;
  executorEvents?: Array<Record<string, unknown>>;
  inputEvents?: Array<Record<string, unknown>>;
  evidenceLedgerActions?: Array<Record<string, unknown>>;
  evidenceLedger?: Record<string, unknown>;
  evidenceIndex?: Record<string, unknown>;
  evidenceIndexRef?: string;
  actionLedgerRef?: string;
  replayBundle?: Record<string, unknown>;
  replayManifest?: Record<string, unknown>;
  visibleReplay?: Record<string, unknown>;
  replayRef?: string;
  automationSubstituteUsed?: boolean;
  blockedReason?: string;
  trace?: Record<string, unknown>;
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
  cuNextTaskId?: string;
  cuNextTask?: Record<string, unknown>;
  productPathClassification?: Record<string, unknown>;
  productPath?: Record<string, unknown>;
  acceptancePathClassification?: Record<string, unknown>;
  userControlPlane?: Record<string, unknown>;
  userControl?: Record<string, unknown>;
  sessionPermission?: Record<string, unknown>;
  platformSidecarIsolationReport?: Record<string, unknown>;
  platformSidecarIsolation?: Record<string, unknown>;
  platformSidecar?: Record<string, unknown>;
  displayGroupId?: string;
  currentRunBundleRef?: string;
  currentBundleRef?: string;
  screenId?: string;
  screenIds?: string[];
  screens?: Array<Record<string, unknown>>;
  virtualScreens?: Array<Record<string, unknown>>;
  visibleScreenRefs?: string[];
  actorId?: string;
  actorIds?: string[];
  cursorId?: string;
  cursorIds?: string[];
  virtualDisplayGroup?: Record<string, unknown>;
  virtualDesktopSession?: Record<string, unknown>;
  actorCursorProvenance?: Array<Record<string, unknown>>;
  actorCursors?: Array<Record<string, unknown>>;
  visibleCursorRefs?: Array<string | Record<string, unknown>>;
  cursorEvents?: Array<Record<string, unknown>>;
  actorCursorEvents?: Array<Record<string, unknown>>;
  observeBeforeMutate?: Record<string, unknown>;
  observationFreshness?: Record<string, unknown>;
  browserRuntimeDomAxObservation?: Record<string, unknown> | Array<Record<string, unknown>>;
  browserRuntimeDomAxObservations?: Array<Record<string, unknown>>;
  browserRuntimeObservation?: Record<string, unknown>;
  browserRuntimeObservationHint?: Record<string, unknown>;
  browserRuntimeObservationHints?: Array<Record<string, unknown>>;
  domAxObservation?: Record<string, unknown>;
  domAxObservationHints?: Array<Record<string, unknown>>;
  actionProposals?: Array<Record<string, unknown>>;
  proposals?: Array<Record<string, unknown>>;
  executorQueue?: Array<Record<string, unknown>>;
  leaseQueue?: Array<Record<string, unknown>>;
  schedulerQueue?: Array<Record<string, unknown>>;
  executorLeases?: Array<Record<string, unknown>>;
  leases?: Array<Record<string, unknown>>;
  mutatingActions?: Array<Record<string, unknown>>;
  actionCausality?: Array<Record<string, unknown>>;
  executorEvents?: Array<Record<string, unknown>>;
  inputEvents?: Array<Record<string, unknown>>;
  evidenceLedgerActions?: Array<Record<string, unknown>>;
  evidenceLedger?: Record<string, unknown>;
  replayBundle?: Record<string, unknown>;
  replayManifest?: Record<string, unknown>;
  visibleReplay?: Record<string, unknown>;
  replayRef?: string;
  automationSubstituteUsed?: boolean;
  blockedReason?: string;
  trace?: Record<string, unknown>;
}

const rejectedShortcutKinds = new Set<CuEvidenceClaimKind>([
  'dom',
  'playwright',
  'accessibility',
  'generated-file-only',
]);

const cuUserAcceptancePassthroughKeys = [
  'cuNextTaskId',
  'productPath',
  'acceptancePathClassification',
  'userControl',
  'sessionPermission',
  'platformSidecarIsolation',
  'platformSidecar',
  'displayGroupId',
  'currentRunBundleRef',
  'currentBundleRef',
  'screenId',
  'screenIds',
  'screens',
  'virtualScreens',
  'visibleScreenRefs',
  'actorId',
  'actorIds',
  'cursorId',
  'cursorIds',
  'virtualDesktopSession',
  'actorCursors',
  'visibleCursorRefs',
  'actorCursorEvents',
  'observationFreshness',
  'browserRuntimeDomAxObservations',
  'browserRuntimeObservation',
  'browserRuntimeObservationHint',
  'browserRuntimeObservationHints',
  'domAxObservation',
  'domAxObservationHints',
  'proposals',
  'leaseQueue',
  'schedulerQueue',
  'executorLeases',
  'leases',
  'actionCausality',
  'executorEvents',
  'inputEvents',
  'evidenceLedgerActions',
  'evidenceLedger',
  'evidenceIndex',
  'evidenceIndexRef',
  'actionLedgerRef',
  'replayManifest',
  'visibleReplay',
  'replayRef',
  'automationSubstituteUsed',
  'blockedReason',
  'trace',
] as const;

const sensitiveFieldNamePattern =
  /(?:authorization|cookie|api[-_\s]?key|apikey|secret|password|passwd|credential|token|bearer|private[-_\s]?key|client[-_\s]?secret|provider[-_\s]?url|base[-_\s]?url|endpoint|raw[-_\s]?url|requested[-_\s]?url|current[-_\s]?url|final[-_\s]?url|private[-_\s]?url|workspace[-_\s]?path|local[-_\s]?absolute[-_\s]?path|absolute[-_\s]?path)/i;

const opaqueRefSchemePattern = /^(?:approval|computer-use-session|codex-thread|gui\.present):/i;

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
      'CU-05 user acceptance pass evidence must come from Host-routed computer_use.bind/observe/act/run_procedure/control primitive sessions, screenshot-grounded Computer Use execution, and refs-first DOM/AX/Playwright observation hints only; DOM, Playwright, accessibility, or generated-file-only substitutes cannot be completion evidence.',
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
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return false;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (!parts.every((part) => part !== '' && part !== '.' && part !== '..')) return false;
  const fileName = parts.at(-1) ?? '';
  return /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(fileName);
}

export function hasRequiredCuTuiHostChain(tuiHostChain: CuTuiHostChainLink[]): boolean {
  return tuiHostChain.some((link) => (
    link.kind === 'computer-use-primitive-session'
    && link.status === 'present'
    && Boolean(link.sessionRef)
    && Boolean(link.primitiveTraceRef)
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
  if (!input.hostChainReady) missing.push('Host-routed Computer Use primitive session chain');
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

function controlledPassthroughFields(input: CuUserAcceptanceInput): Record<string, unknown> {
  const source = input as unknown as Record<string, unknown>;
  const passthrough: Record<string, unknown> = {};
  for (const key of cuUserAcceptancePassthroughKeys) {
    if (source[key] !== undefined) passthrough[key] = source[key];
  }
  return passthrough;
}

function scrubCuManifest<T extends Record<string, unknown>>(manifest: T): T {
  return scrubCuManifestValue(manifest) as T;
}

function scrubCuManifestValue(value: unknown, key?: string): unknown {
  if (key && sensitiveFieldNamePattern.test(key)) return undefined;
  if (typeof value === 'string') return scrubCuManifestString(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => scrubCuManifestValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const scrubbed: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const child = scrubCuManifestValue(childValue, childKey);
      if (child !== undefined) scrubbed[childKey] = child;
    }
    return scrubbed;
  }
  return value;
}

function scrubCuManifestString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || opaqueRefSchemePattern.test(trimmed)) return value;
  if (isLocalAbsolutePathLike(trimmed)) return '[redacted-local-path]';

  let scrubbed = value
    .replace(/data:image\/[^,\s]+,?[A-Za-z0-9+/=_-]*/gi, '[redacted-inline-data]')
    .replace(/;base64,[A-Za-z0-9+/=_-]+/gi, ';[redacted-inline-data]')
    .replace(/\bhttps?:\/\/[^\s"'<>),\]]+/gi, '[redacted-url]')
    .replace(/\bwss?:\/\/[^\s"'<>),\]]+/gi, '[redacted-url]')
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[^\s,;]+/gi, '[redacted-sensitive]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted-sensitive]')
    .replace(/\b(?:api[_\-\s]?key|token|secret|password|credential)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted-sensitive]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-sensitive]')
    .replace(/\b[A-Za-z0-9._-]*(?:secret|token)[A-Za-z0-9._-]{4,}\b/gi, '[redacted-sensitive]');

  scrubbed = scrubEmbeddedLocalAbsolutePaths(scrubbed);
  return scrubbed;
}

function isLocalAbsolutePathLike(value: string): boolean {
  return value.startsWith('file:')
    || value.startsWith('/')
    || value.startsWith('~')
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\/.test(value);
}

function scrubEmbeddedLocalAbsolutePaths(value: string): string {
  return value
    .replace(
      /(^|[\s"'([])(\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/[^\s"'<>),\]]+)/g,
      '$1[redacted-local-path]',
    )
    .replace(/\b[A-Za-z]:\\[^\s"'<>),\]]+/g, '[redacted-local-path]')
    .replace(/\\\\[^\s"'<>),\]]+/g, '[redacted-local-path]');
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
    screenId: input.executorLease?.screenId,
    windowId: input.executorLease?.windowId,
    actorId: input.executorLease?.actorId,
    cursorId: input.executorLease?.cursorId,
    leaseScope: input.executorLease?.leaseScope,
    scope: input.executorLease?.scope,
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

  const manifest: CuUserAcceptanceManifest = {
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
    cuNextTask: input.cuNextTask,
    productPathClassification: input.productPathClassification,
    userControlPlane: input.userControlPlane,
    platformSidecarIsolationReport: input.platformSidecarIsolationReport,
    virtualDisplayGroup: input.virtualDisplayGroup,
    actorCursorProvenance: input.actorCursorProvenance,
    cursorEvents: input.cursorEvents,
    observeBeforeMutate: input.observeBeforeMutate,
    browserRuntimeDomAxObservation: input.browserRuntimeDomAxObservation,
    actionProposals: input.actionProposals,
    executorQueue: input.executorQueue,
    mutatingActions: input.mutatingActions,
    replayBundle: input.replayBundle,
  };

  return scrubCuManifest({
    ...manifest,
    ...controlledPassthroughFields(input),
  }) as CuUserAcceptanceManifest;
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
