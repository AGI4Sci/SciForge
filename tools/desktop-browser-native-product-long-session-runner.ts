import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  validateDesktopBrowserNativeM0SurfingLoopEvidence,
} from '../src/desktop/desktop-browser-native-live-acceptance.js';

export const DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA =
  'sciforge.desktop.browser-native-product-long-session.v1' as const;

export const DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REQUIRED_ACTIONS = [
  'continuous-surfing',
  'multi-tab',
  'reload',
  'back',
  'forward',
  'right-pane-resize',
  'writer-restart',
] as const;

export const DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_DEFAULT_TARGET_MS = 5 * 60 * 1000;

const trustedInProcessRealLongRunEvidence = new WeakSet<object>();

export type DesktopBrowserNativeProductLongSessionStatus = 'passed' | 'blocked';
export type DesktopBrowserNativeProductLongSessionAction =
  (typeof DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REQUIRED_ACTIONS)[number];
export type DesktopBrowserNativeProductLongSessionSource =
  | 'blocked-skeleton-no-real-long-run'
  | 'real-product-long-session-run';

export type DesktopBrowserNativeProductLongSessionManifest = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA;
  status: DesktopBrowserNativeProductLongSessionStatus;
  passClaim: boolean;
  claimScope: 'desktop-native-product-long-session' | 'blocked-or-diagnostic';
  runner: 'desktop-browser-native-product-long-session-runner';
  source: DesktopBrowserNativeProductLongSessionSource;
  observedAt: string;
  shell: 'desktop-right-pane';
  owner: 'BrowserHostSession';
  inputChannel: 'browser-host-session';
  liveSurfaceTransport: 'native-embedded' | 'missing-native-attach';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  refsFirst: true;
  boundedEvidenceOnly: true;
  target: {
    durationTargetMs: number;
    targetLabel: '5min';
    passRequiresElapsedDuration: true;
  };
  sourceDesktopNativeLiveAcceptance: {
    manifestRef: string;
    status?: string;
    canClaimDesktopNativeLivePass: boolean;
    canClaimM0Pass: boolean;
    validationBlockReasonCount: number;
  };
  requirements: {
    actionsRequired: DesktopBrowserNativeProductLongSessionAction[];
    actionsObserved: DesktopBrowserNativeProductLongSessionAction[];
    continuousSurfingRequired: true;
    multiTabRequired: true;
    reloadRequired: true;
    backForwardRequired: true;
    rightPaneResizeRequired: true;
    writerRestartRequired: true;
  };
  sessionContinuityProofs: DesktopBrowserNativeProductLongSessionProofGroups;
  realLongSessionRun: {
    status: 'executed' | 'not-run';
    elapsedDurationMs: number;
    runRef: string;
    auditRefs: string[];
  };
  continuity: {
    sameBrowserHostSession: boolean;
    sameLiveSurfaceAfterReload: boolean;
    sameLiveSurfaceAfterResize: boolean;
    reconnectedAfterWorkspaceWriterRestart: boolean;
  };
  payloadPolicy: {
    rawUrl: false;
    rawDom: false;
    rawScreenshot: false;
    base64: false;
    providerPayload: false;
    secret: false;
  };
  forbiddenSubstitutes: {
    hostStream: false;
    canvas: false;
    webRtc: false;
    httpFrame: false;
    snapshot: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    externalBrowser: false;
    secondBrowserOwner: false;
  };
  blockers: DesktopBrowserNativeProductLongSessionBlockReason[];
};

export type DesktopBrowserNativeProductLongSessionBlockReason =
  | 'schema-version-mismatch'
  | 'manifest-status-pass-claim-required'
  | 'blocked-manifest-must-not-claim-pass'
  | 'stale-blockers-must-not-claim-pass'
  | 'desktop-native-long-session-runner-required'
  | 'real-product-long-session-run-source-required'
  | 'desktop-right-pane-browser-host-session-required'
  | 'native-embedded-live-surface-required'
  | 'refs-first-bounded-evidence-required'
  | 'desktop-native-live-acceptance-m0-pass-required'
  | 'desktop-native-long-session-real-run-required'
  | 'duration-target-not-met'
  | 'all-required-actions-must-be-observed'
  | 'session-continuity-proof-groups-required'
  | 'session-continuity-proof-refs-must-match-session'
  | 'session-continuity-proof-group-audit-refs-must-match-required-actions'
  | 'long-session-run-ref-required'
  | 'long-session-audit-refs-required'
  | 'long-session-audit-refs-must-cover-proof-groups'
  | 'long-session-continuity-required'
  | 'm0-pass-does-not-satisfy-long-session'
  | 'payload-policy-must-forbid-raw-evidence'
  | 'legacy-fallback-substitutes-forbidden'
  | 'raw-url-dom-screenshot-base64-provider-payload-forbidden';

export type DesktopBrowserNativeProductLongSessionValidation = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA;
  verdict: DesktopBrowserNativeProductLongSessionStatus;
  canClaimPass: boolean;
  blockReasons: DesktopBrowserNativeProductLongSessionBlockReason[];
};

export type RealDesktopBrowserNativeProductLongSessionRunEvidence = {
  status: 'executed';
  elapsedDurationMs: number;
  runRef: string;
  auditRefs: string[];
  actionsObserved: DesktopBrowserNativeProductLongSessionAction[];
  continuity: DesktopBrowserNativeProductLongSessionManifest['continuity'];
  sessionContinuityProofs: DesktopBrowserNativeProductLongSessionProofGroups;
};

export type DesktopBrowserNativeProductLongSessionRealLongRunExecutor = (input: {
  inputManifestPath: string;
  sourceManifestRef: string;
  durationTargetMs: number;
}) => Promise<RealDesktopBrowserNativeProductLongSessionRunEvidence | undefined>;

export type DesktopBrowserNativeProductLongSessionProofGroups = {
  continuousSurfing: DesktopBrowserNativeProductLongSessionProofGroup;
  multiTab: DesktopBrowserNativeProductLongSessionProofGroup;
  reload: DesktopBrowserNativeProductLongSessionProofGroup;
  backForward: DesktopBrowserNativeProductLongSessionProofGroup;
  rightPaneResize: DesktopBrowserNativeProductLongSessionProofGroup;
  workspaceWriterRestart: DesktopBrowserNativeProductLongSessionProofGroup;
};

export type DesktopBrowserNativeProductLongSessionProofGroup = {
  status: 'observed' | 'blocked';
  bounded: true;
  sessionRef: string;
  liveSurfaceRef: string;
  auditRef: string;
  latencyMs?: number;
};

export type RunDesktopBrowserNativeProductLongSessionRunnerInput = {
  inputManifestPath: string;
  outputPath?: string;
  now?: string;
  durationTargetMs?: number;
  executeRealLongRun?: boolean;
  realLongRunExecutor?: DesktopBrowserNativeProductLongSessionRealLongRunExecutor;
  realRunEvidence?: RealDesktopBrowserNativeProductLongSessionRunEvidence;
};

export async function runDesktopBrowserNativeProductLongSessionRunner(
  input: RunDesktopBrowserNativeProductLongSessionRunnerInput,
): Promise<DesktopBrowserNativeProductLongSessionManifest> {
  const liveAcceptance = parseBoundedLiveAcceptance(await readFile(input.inputManifestPath, 'utf8'));
  const durationTargetMs = input.durationTargetMs ?? DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_DEFAULT_TARGET_MS;
  const sourceManifestRef = boundedManifestRef(input.inputManifestPath);
  const executorRealRunEvidence = input.executeRealLongRun === true && input.realLongRunExecutor
    ? await input.realLongRunExecutor({
      inputManifestPath: input.inputManifestPath,
      sourceManifestRef,
      durationTargetMs,
    })
    : undefined;
  const manifest = buildDesktopBrowserNativeProductLongSessionManifest({
    liveAcceptance,
    sourceManifestRef,
    now: input.now ?? new Date().toISOString(),
    durationTargetMs,
    realRunEvidence: executorRealRunEvidence
      ? trustInProcessRealLongRunEvidence(executorRealRunEvidence)
      : input.realRunEvidence,
  });

  if (input.outputPath) {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    assertBoundedLongSessionArtifact(text);
    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, text);
  }

  return manifest;
}

function parseBoundedLiveAcceptance(text: string): DesktopBrowserNativeLiveAcceptanceEvidence {
  assertBoundedLongSessionArtifact(text);
  return JSON.parse(text) as DesktopBrowserNativeLiveAcceptanceEvidence;
}

export function buildDesktopBrowserNativeProductLongSessionManifest(input: {
  liveAcceptance: DesktopBrowserNativeLiveAcceptanceEvidence;
  sourceManifestRef: string;
  now: string;
  durationTargetMs?: number;
  realRunEvidence?: RealDesktopBrowserNativeProductLongSessionRunEvidence;
}): DesktopBrowserNativeProductLongSessionManifest {
  const durationTargetMs = input.durationTargetMs ?? DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_DEFAULT_TARGET_MS;
  const m0Validation = validateDesktopBrowserNativeM0SurfingLoopEvidence(input.liveAcceptance.m0SurfingLoop);
  const m0 = input.liveAcceptance.m0SurfingLoop;
  const browserHostSessionRef = m0?.sessionRef ?? 'browser-host-session:missing-native-long-session';
  const liveSurfaceRef = m0?.liveSurfaceRef ?? `${browserHostSessionRef}/live-surface`;
  const suppliedRealRunEvidence = input.realRunEvidence;
  const realRun = trustedRealRunEvidence(input.realRunEvidence);
  const actionsObserved = uniqueRequiredActions(realRun?.actionsObserved ?? []);
  const continuity = realRun?.continuity ?? {
    sameBrowserHostSession: false,
    sameLiveSurfaceAfterReload: false,
    sameLiveSurfaceAfterResize: false,
    reconnectedAfterWorkspaceWriterRestart: false,
  };
  const manifest: DesktopBrowserNativeProductLongSessionManifest = {
    schemaVersion: DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA,
    status: 'blocked',
    passClaim: false,
    claimScope: 'blocked-or-diagnostic',
    runner: 'desktop-browser-native-product-long-session-runner',
    source: realRun ? 'real-product-long-session-run' : 'blocked-skeleton-no-real-long-run',
    observedAt: input.now,
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: m0?.transport.liveSurfaceTransport === 'native-embedded' ? 'native-embedded' : 'missing-native-attach',
    browserHostSessionRef,
    liveSurfaceRef,
    refsFirst: true,
    boundedEvidenceOnly: true,
    target: {
      durationTargetMs,
      targetLabel: '5min',
      passRequiresElapsedDuration: true,
    },
    sourceDesktopNativeLiveAcceptance: {
      manifestRef: input.sourceManifestRef,
      status: input.liveAcceptance.status,
      canClaimDesktopNativeLivePass: input.liveAcceptance.canClaimDesktopNativeLivePass === true,
      canClaimM0Pass: m0Validation.canClaimPass,
      validationBlockReasonCount: m0Validation.blockReasons.length,
    },
    requirements: {
      actionsRequired: [...DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REQUIRED_ACTIONS],
      actionsObserved,
      continuousSurfingRequired: true,
      multiTabRequired: true,
      reloadRequired: true,
      backForwardRequired: true,
      rightPaneResizeRequired: true,
      writerRestartRequired: true,
    },
    sessionContinuityProofs: realRun?.sessionContinuityProofs ?? blockedSessionContinuityProofs(browserHostSessionRef, liveSurfaceRef),
    realLongSessionRun: {
      status: realRun?.status ?? 'not-run',
      elapsedDurationMs: realRun?.elapsedDurationMs ?? 0,
      runRef: realRun?.runRef ?? `${browserHostSessionRef}/m2-long-session/not-run`,
      auditRefs: realRun?.auditRefs ?? [],
    },
    continuity,
    payloadPolicy: noRawPayloadPolicy(),
    forbiddenSubstitutes: noForbiddenSubstitutes(),
    blockers: [],
  };
  const validation = validateDesktopBrowserNativeProductLongSessionManifest({
    ...manifest,
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    blockers: [],
  });
  manifest.blockers = [
    ...new Set([
      ...validation.blockReasons,
      ...(suppliedRealRunEvidence && containsForbiddenRawEvidence(suppliedRealRunEvidence)
        ? ['raw-url-dom-screenshot-base64-provider-payload-forbidden' as const]
        : []),
    ]),
  ];
  if (manifest.blockers.length === 0) {
    manifest.status = 'passed';
    manifest.passClaim = true;
    manifest.claimScope = 'desktop-native-product-long-session';
  } else {
    manifest.status = 'blocked';
    manifest.passClaim = false;
    manifest.claimScope = 'blocked-or-diagnostic';
  }
  return manifest;
}

function trustedRealRunEvidence(
  value: RealDesktopBrowserNativeProductLongSessionRunEvidence | undefined,
): RealDesktopBrowserNativeProductLongSessionRunEvidence | undefined {
  if (!value || !trustedInProcessRealLongRunEvidence.has(value) || containsForbiddenRawEvidence(value)) return undefined;
  return value;
}

function trustInProcessRealLongRunEvidence(
  value: RealDesktopBrowserNativeProductLongSessionRunEvidence,
): RealDesktopBrowserNativeProductLongSessionRunEvidence {
  trustedInProcessRealLongRunEvidence.add(value);
  return value;
}

export function validateDesktopBrowserNativeProductLongSessionManifest(
  manifest: DesktopBrowserNativeProductLongSessionManifest,
): DesktopBrowserNativeProductLongSessionValidation {
  const blockReasons: DesktopBrowserNativeProductLongSessionBlockReason[] = [];
  if (manifest.schemaVersion !== DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA) {
    blockReasons.push('schema-version-mismatch');
  }
  if (manifest.status !== 'passed' || manifest.passClaim !== true || manifest.claimScope !== 'desktop-native-product-long-session') {
    blockReasons.push('manifest-status-pass-claim-required');
  }
  if (manifest.status === 'blocked' && manifest.passClaim === true) {
    blockReasons.push('blocked-manifest-must-not-claim-pass');
  }
  if ((manifest.status === 'passed' || manifest.passClaim === true) && manifest.blockers.length > 0) {
    blockReasons.push('stale-blockers-must-not-claim-pass');
  }
  if (manifest.runner !== 'desktop-browser-native-product-long-session-runner') {
    blockReasons.push('desktop-native-long-session-runner-required');
  }
  if (manifest.source !== 'real-product-long-session-run') {
    blockReasons.push('real-product-long-session-run-source-required');
  }
  if (manifest.shell !== 'desktop-right-pane' || manifest.owner !== 'BrowserHostSession' || manifest.inputChannel !== 'browser-host-session') {
    blockReasons.push('desktop-right-pane-browser-host-session-required');
  }
  if (manifest.liveSurfaceTransport !== 'native-embedded') {
    blockReasons.push('native-embedded-live-surface-required');
  }
  if (manifest.refsFirst !== true || manifest.boundedEvidenceOnly !== true) {
    blockReasons.push('refs-first-bounded-evidence-required');
  }
  if (manifest.sourceDesktopNativeLiveAcceptance.canClaimM0Pass !== true) {
    blockReasons.push('desktop-native-live-acceptance-m0-pass-required');
  }
  if (manifest.realLongSessionRun.status !== 'executed') {
    blockReasons.push('desktop-native-long-session-real-run-required');
  }
  const requiredElapsedDurationMs = Math.max(
    manifest.target.durationTargetMs,
    DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_DEFAULT_TARGET_MS,
  );
  if (
    !Number.isFinite(manifest.target.durationTargetMs) ||
    !Number.isFinite(manifest.realLongSessionRun.elapsedDurationMs) ||
    manifest.realLongSessionRun.elapsedDurationMs < requiredElapsedDurationMs
  ) {
    blockReasons.push('duration-target-not-met');
  }
  if (!allRequiredActionsObserved(manifest.requirements.actionsObserved)) {
    blockReasons.push('all-required-actions-must-be-observed');
  }
  if (!allSessionContinuityProofGroupsObserved(manifest.sessionContinuityProofs)) {
    blockReasons.push('session-continuity-proof-groups-required');
  }
  if (!allSessionContinuityProofGroupsMatchRefs(
    manifest.sessionContinuityProofs,
    manifest.browserHostSessionRef,
    manifest.liveSurfaceRef,
  )) {
    blockReasons.push('session-continuity-proof-refs-must-match-session');
  }
  if (!sessionContinuityProofGroupAuditRefsMatchRequiredActions(manifest.sessionContinuityProofs)) {
    blockReasons.push('session-continuity-proof-group-audit-refs-must-match-required-actions');
  }
  if (!hasRealLongSessionRunRef(manifest.realLongSessionRun.runRef)) {
    blockReasons.push('long-session-run-ref-required');
  }
  if (!hasRealLongSessionAuditRefs(manifest.realLongSessionRun.auditRefs)) {
    blockReasons.push('long-session-audit-refs-required');
  }
  if (!realLongSessionAuditRefsCoverProofGroups(
    manifest.realLongSessionRun.auditRefs,
    manifest.sessionContinuityProofs,
  )) {
    blockReasons.push('long-session-audit-refs-must-cover-proof-groups');
  }
  if (!Object.values(manifest.continuity).every((value) => value === true)) {
    blockReasons.push('long-session-continuity-required');
  }
  if (manifest.sourceDesktopNativeLiveAcceptance.canClaimM0Pass === true && manifest.realLongSessionRun.status !== 'executed') {
    blockReasons.push('m0-pass-does-not-satisfy-long-session');
  }
  if (!Object.values(manifest.payloadPolicy).every((value) => value === false)) {
    blockReasons.push('payload-policy-must-forbid-raw-evidence');
  }
  if (!Object.values(manifest.forbiddenSubstitutes).every((value) => value === false)) {
    blockReasons.push('legacy-fallback-substitutes-forbidden');
  }
  if (containsForbiddenRawEvidence(manifest)) {
    blockReasons.push('raw-url-dom-screenshot-base64-provider-payload-forbidden');
  }

  const uniqueBlockReasons = [...new Set(blockReasons)];
  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA,
    verdict: uniqueBlockReasons.length === 0 ? 'passed' : 'blocked',
    canClaimPass: uniqueBlockReasons.length === 0,
    blockReasons: uniqueBlockReasons,
  };
}

function noRawPayloadPolicy(): DesktopBrowserNativeProductLongSessionManifest['payloadPolicy'] {
  return {
    rawUrl: false,
    rawDom: false,
    rawScreenshot: false,
    base64: false,
    providerPayload: false,
    secret: false,
  };
}

function noForbiddenSubstitutes(): DesktopBrowserNativeProductLongSessionManifest['forbiddenSubstitutes'] {
  return {
    hostStream: false,
    canvas: false,
    webRtc: false,
    httpFrame: false,
    snapshot: false,
    iframe: false,
    proxy: false,
    webview: false,
    systemPopup: false,
    externalBrowser: false,
    secondBrowserOwner: false,
  };
}

function uniqueRequiredActions(actions: DesktopBrowserNativeProductLongSessionAction[]): DesktopBrowserNativeProductLongSessionAction[] {
  return DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REQUIRED_ACTIONS.filter((action) => actions.includes(action));
}

function allRequiredActionsObserved(actions: DesktopBrowserNativeProductLongSessionAction[]): boolean {
  return DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REQUIRED_ACTIONS.every((action) => actions.includes(action));
}

function blockedSessionContinuityProofs(
  sessionRef: string,
  liveSurfaceRef: string,
): DesktopBrowserNativeProductLongSessionProofGroups {
  return {
    continuousSurfing: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'continuous-surfing'),
    multiTab: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'multi-tab'),
    reload: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'reload'),
    backForward: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'back-forward'),
    rightPaneResize: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'right-pane-resize'),
    workspaceWriterRestart: blockedSessionContinuityProof(sessionRef, liveSurfaceRef, 'workspace-writer-restart'),
  };
}

function blockedSessionContinuityProof(
  sessionRef: string,
  liveSurfaceRef: string,
  label: string,
): DesktopBrowserNativeProductLongSessionProofGroup {
  return {
    status: 'blocked',
    bounded: true,
    sessionRef,
    liveSurfaceRef,
    auditRef: `real-product-long-session-audit:${label}-not-run`,
  };
}

function allSessionContinuityProofGroupsObserved(proofs: DesktopBrowserNativeProductLongSessionProofGroups | undefined): boolean {
  if (!proofs) return false;
  return Object.values(proofs).every((proof) => {
    if (proof.status !== 'observed' || proof.bounded !== true) return false;
    if (!/^browser-host-session:[^/]+$/.test(proof.sessionRef)) return false;
    if (!/^browser-host-session:[^/]+\/live-surface$/.test(proof.liveSurfaceRef)) return false;
    if (!hasRealLongSessionAuditRefs([proof.auditRef])) return false;
    return proof.latencyMs === undefined || (Number.isFinite(proof.latencyMs) && proof.latencyMs >= 0);
  });
}

function allSessionContinuityProofGroupsMatchRefs(
  proofs: DesktopBrowserNativeProductLongSessionProofGroups | undefined,
  sessionRef: string,
  liveSurfaceRef: string,
): boolean {
  if (!proofs) return false;
  return Object.values(proofs).every((proof) => proof.sessionRef === sessionRef && proof.liveSurfaceRef === liveSurfaceRef);
}

function sessionContinuityProofGroupAuditRefsMatchRequiredActions(
  proofs: DesktopBrowserNativeProductLongSessionProofGroups | undefined,
): boolean {
  if (!proofs) return false;
  const requiredAuditRefLabels: Record<keyof DesktopBrowserNativeProductLongSessionProofGroups, string> = {
    continuousSurfing: 'continuous-surfing',
    multiTab: 'multi-tab',
    reload: 'reload',
    backForward: 'back-forward',
    rightPaneResize: 'right-pane-resize',
    workspaceWriterRestart: 'workspace-writer-restart',
  };
  return (Object.entries(requiredAuditRefLabels) as Array<[keyof DesktopBrowserNativeProductLongSessionProofGroups, string]>)
    .every(([key, label]) => proofAuditRefMatchesRequiredLabel(proofs[key]?.auditRef, label));
}

function proofAuditRefMatchesRequiredLabel(auditRef: string | undefined, label: string): boolean {
  if (!auditRef?.startsWith('real-product-long-session-audit:')) return false;
  const refLabel = auditRef.slice('real-product-long-session-audit:'.length);
  return refLabel === label || refLabel.startsWith(`${label}/`) || refLabel.startsWith(`${label}:`);
}

function hasRealLongSessionRunRef(ref: string): boolean {
  return ref.startsWith('real-product-long-session:');
}

function hasRealLongSessionAuditRefs(refs: string[]): boolean {
  return refs.length > 0 && refs.every((ref) => ref.startsWith('real-product-long-session-audit:'));
}

function realLongSessionAuditRefsCoverProofGroups(
  auditRefs: string[],
  proofs: DesktopBrowserNativeProductLongSessionProofGroups | undefined,
): boolean {
  if (!proofs) return false;
  const auditRefSet = new Set(auditRefs);
  return Object.values(proofs).every((proof) => proof.status === 'observed' && auditRefSet.has(proof.auditRef));
}

function boundedManifestRef(path: string): string {
  const resolved = resolve(path);
  return `desktop-native-live-acceptance:${createHash('sha256').update(resolved).digest('hex').slice(0, 16)}`;
}

function containsForbiddenRawEvidence(value: unknown): boolean {
  return containsForbiddenRawEvidenceAt(value, []);
}

function containsForbiddenRawEvidenceAt(value: unknown, path: string[]): boolean {
  if (typeof value === 'string') {
    return /https?:\/\//i.test(value)
      || /data:image\/[^;]+;base64,/i.test(value)
      || /<!doctype|<html|<body|outerhtml|innerhtml|;base64,/i.test(value);
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item, index) => containsForbiddenRawEvidenceAt(item, [...path, String(index)]));

  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenRawPayloadKey(key) && child !== false && child !== undefined && child !== null) {
      return true;
    }
    if (containsForbiddenRawEvidenceAt(child, [...path, key])) return true;
  }
  return false;
}

function assertBoundedLongSessionArtifact(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > 96_000 || /https?:\/\//i.test(text) || /data:image\//i.test(text)) {
    throw new Error('desktop browser native product long-session evidence must remain bounded and refs-first');
  }
}

function isForbiddenRawPayloadKey(key: string): boolean {
  return [
    'rawUrl',
    'rawDom',
    'rawScreenshot',
    'rawScreenshotBase64',
    'base64',
    'providerPayload',
    'providerRawPayload',
    'secret',
    'token',
  ].includes(key);
}

async function main() {
  const inputManifestPath = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LONG_SESSION_INPUT_MANIFEST
    ?? resolve(process.cwd(), 'docs', 'test-artifacts', 'desktop-browser-native-live-acceptance', 'manifest.json');
  const outputPath = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LONG_SESSION_OUTPUT
    ?? resolve(process.cwd(), 'docs', 'test-artifacts', 'desktop-browser-native-product-long-session', 'manifest.json');
  const executeRealLongRun = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_EXECUTE_REAL_RUN === '1';
  const durationTargetMs = Number(process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_MINUTES ?? '5') * 60 * 1000;
  const realRunEvidence = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REAL_RUN_JSON
    ? JSON.parse(process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REAL_RUN_JSON) as RealDesktopBrowserNativeProductLongSessionRunEvidence
    : undefined;
  await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    outputPath,
    executeRealLongRun,
    durationTargetMs,
    realRunEvidence,
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await main();
}
