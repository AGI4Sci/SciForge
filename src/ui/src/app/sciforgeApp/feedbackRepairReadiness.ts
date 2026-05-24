import { validatePeerInstances } from '../../config';
import { nowIso, type PeerInstance, type RuntimeCodexBrowserAcceptanceManifest, type RuntimeProviderPreflightManifest, type SciForgeInstanceManifest, type SciForgeWorkspaceWriterHealth } from '../../domain';
import { providerReadinessNoticeFromManifest } from '../../providerReadiness';

const REQUIRED_REPAIR_PEER_CAPABILITIES = [
  'feedback-repair-run-record',
  'feedback-repair-result-record',
  'feedback-repair-terminal-mirror-tail',
  'runtime-provider-preflight-manifest',
];
const REQUIRED_WORKSPACE_WRITER_CAPABILITIES = [
  'repair-handoff-runner',
  'feedback-direct-codex-terminal-websocket-pty',
  'feedback-direct-codex-terminal-system-terminal',
  'feedback-repair-terminal-mirror-tail',
  'runtime-provider-preflight-manifest',
  'runtime-codex-browser-acceptance-manifest',
];
const BROWSER_ACCEPTANCE_MAX_AGE_MS = 30 * 60 * 1000;

export type RepairReadinessState = 'ready' | 'partial' | 'blocked';
export type RepairPeerReadinessStatus = 'checking' | 'ready' | 'blocked';
export interface RepairReadinessRow {
  label: string;
  value: string;
  detail?: string;
  state: RepairReadinessState;
}

export interface RepairPeerReadinessProbe {
  peerName: string;
  status: RepairPeerReadinessStatus;
  checkedAt: string;
  health?: SciForgeWorkspaceWriterHealth;
  manifest?: SciForgeInstanceManifest;
  diagnostics: string[];
}

export type RepairPeerReadinessByName = Record<string, RepairPeerReadinessProbe>;

export function repairReadinessSummary(
  peerInstances: PeerInstance[],
  repairTargets: PeerInstance[],
  manifest: RuntimeProviderPreflightManifest | undefined,
  manifestError: string,
  browserManifest: RuntimeCodexBrowserAcceptanceManifest | undefined,
  browserManifestError: string,
  peerReadinessByName: RepairPeerReadinessByName = {},
): {
  status: RepairReadinessState;
  summary: string;
  rows: RepairReadinessRow[];
  nextAction?: string;
  needsPeerSettings: boolean;
  providerReady: boolean;
  providerBlocker: string;
  executionReady: boolean;
  releaseReady: boolean;
  browserPassed: boolean;
  browserBlocker: string;
} {
  const peerValidationErrors = validatePeerInstances(peerInstances);
  const missingEnv = manifest?.missingEnv ?? [];
  const policyViolations = manifest?.policyViolations ?? [];
  const providerNotice = providerReadinessNoticeFromManifest(manifest, manifestError);
  const providerReady = providerNotice.ready;
  const browserChecksPassed = browserManifest?.status === 'passed'
    && browserManifest.acceptanceConclusionFromRealBrowser === true
    && browserManifest.currentRunEvidenceScope === 'live-browser-current-run'
    && browserManifest.startedFromDefaultChatEntry === true
    && browserManifest.submittedThroughRuntimeCodex === true;
  const browserFresh = browserChecksPassed ? browserAcceptanceManifestFresh(browserManifest) : false;
  const browserPassed = browserChecksPassed && browserFresh;
  const livePeerReady = repairTargets.some((peer) => peerReadinessByName[peer.name]?.status === 'ready');
  const peerChecksPending = repairTargets.some((peer) => {
    const status = peerReadinessByName[peer.name]?.status;
    return !status || status === 'checking';
  });
  const peersReady = repairTargets.length > 0 && peerValidationErrors.length === 0 && livePeerReady;
  const anyReady = peersReady || peerChecksPending || providerReady || Boolean(browserManifest);
  const executionReady = peersReady && providerReady;
  const releaseReady = executionReady && browserPassed;
  const status: RepairReadinessState = releaseReady ? 'ready' : anyReady ? 'partial' : 'blocked';
  const nextAction = !repairTargets.length
    ? 'Add an enabled peer instance with repair trust in settings.'
    : browserManifest?.expectedRetestCommand
      ?? browserManifest?.nextActions?.find((action) => action.command)?.command
      ?? manifest?.nextActions.find((action) => action.command)?.command
      ?? 'SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1 SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance';
  const summary = status === 'ready'
    ? 'Repair peer, Runtime provider preflight, and strict in-app browser acceptance are ready.'
    : !repairTargets.length
      ? 'Live repair is blocked because no enabled repair-trust peer instance is configured.'
      : !manifest
        ? `Live repair readiness is incomplete because provider preflight evidence is unavailable${manifestError ? `: ${manifestError}` : '.'}`
        : !providerReady
          ? `Live repair is blocked by provider preflight category ${manifest.category}.`
          : browserManifest
          ? browserChecksPassed && !browserFresh
            ? 'Strict in-app browser acceptance evidence is stale; rerun from the Codex in-app browser before claiming release acceptance.'
            : `Strict in-app browser acceptance is ${browserManifest.status}; live repair cannot be claimed complete yet.`
          : `Live repair needs strict in-app browser acceptance evidence${browserManifestError ? `: ${browserManifestError}` : '.'}`;
  const providerBlocker = providerReady ? '' : providerNotice.detail;
  return {
    status,
    summary,
    nextAction,
    needsPeerSettings: !repairTargets.length || peerValidationErrors.length > 0,
    providerReady,
    providerBlocker,
    executionReady,
    releaseReady,
    browserPassed,
    browserBlocker: browserPassed
      ? ''
      : !browserManifest
        ? `Strict in-app browser acceptance manifest is unavailable${browserManifestError ? `: ${browserManifestError}` : '.'}`
        : browserChecksPassed && !browserFresh
          ? `Strict in-app browser acceptance observedAt is stale or invalid: ${browserManifest.observedAt || 'missing'}`
          : `Strict in-app browser acceptance status is ${browserManifest.status}`,
    rows: [
      {
        label: 'repair peers',
        value: `${repairTargets.length}/${peerInstances.length}`,
        detail: peerValidationErrors.length
          ? peerValidationErrors.join(', ')
          : repairTargets.length
            ? peerReadinessDetail(repairTargets, peerReadinessByName)
            : 'requires enabled + repair trust',
        state: peersReady ? 'ready' : peerChecksPending ? 'partial' : 'blocked',
      },
      {
        label: 'provider preflight',
        value: providerNotice.value,
        detail: providerReady ? providerNotice.detail : providerNotice.recoverAction ? `${providerNotice.detail}; ${providerNotice.recoverAction}` : providerNotice.detail,
        state: providerReady ? 'ready' : manifest ? 'partial' : 'blocked',
      },
      {
        label: 'missing env',
        value: !manifest ? 'unknown' : missingEnv.length ? missingEnv.join(', ') : 'none',
        detail: policyViolations.length ? policyViolations.join(', ') : undefined,
        state: !manifest || missingEnv.length || policyViolations.length ? 'blocked' : 'ready',
      },
      {
        label: 'strict acceptance',
        value: browserManifest?.status ?? 'missing',
        detail: browserManifest
          ? [
            browserManifest.currentRunEvidenceScope ? `scope=${browserManifest.currentRunEvidenceScope}` : '',
            browserManifest.observedAt ? `observedAt=${browserManifest.observedAt}` : '',
            browserChecksPassed && !browserFresh ? 'stale-or-invalid-observedAt' : '',
            browserManifest.failureClass ? `failure=${browserManifest.failureClass}` : '',
            browserManifest.releaseBlocking ? 'release-blocking' : '',
            browserManifest.expectedRetestCommand ?? '',
          ].filter(Boolean).join('; ')
          : browserManifestError || 'SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1 SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance',
        state: browserPassed
          ? 'ready'
          : browserManifest?.status === 'blocked' || browserManifest?.status === 'failed'
            ? 'blocked'
            : browserManifest ? 'partial' : 'blocked',
      },
    ],
  };
}

function browserAcceptanceManifestFresh(manifest: RuntimeCodexBrowserAcceptanceManifest | undefined) {
  if (!manifest?.observedAt) return false;
  if (manifest.freshness) {
    return manifest.freshness.observedAtFresh === true && manifest.freshness.evidenceFresh === true;
  }
  const observedAtMs = Date.parse(manifest.observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  const nowMs = Date.now();
  return observedAtMs <= nowMs + 5 * 60 * 1000 && observedAtMs >= nowMs - BROWSER_ACCEPTANCE_MAX_AGE_MS;
}

export function workspaceWriterReadinessRows(
  health: SciForgeWorkspaceWriterHealth | undefined,
  healthError: string,
  workspaceWriterBaseUrl = '',
): RepairReadinessRow[] {
  const writerUrl = workspaceWriterBaseUrl.replace(/\/+$/, '');
  const urlDetail = writerUrl ? `url=${writerUrl}` : 'url=unknown';
  if (!health) {
    return [{
      label: 'workspace writer',
      value: healthError ? 'unreachable' : 'checking',
      detail: healthError ? `${urlDetail}; ${healthError}` : `${urlDetail}; checking /health capabilities for stale writer detection`,
      state: healthError ? 'blocked' : 'partial',
    }];
  }
  const capabilities = new Set(health.capabilities ?? []);
  const missing = REQUIRED_WORKSPACE_WRITER_CAPABILITIES.filter((capability) => !capabilities.has(capability));
  return [{
    label: 'workspace writer',
    value: missing.length ? 'stale-capabilities' : 'current',
    detail: missing.length
      ? `${urlDetail}; missing ${missing.join(', ')}; restart the workspace writer/dev server for this checkout`
      : `${urlDetail}; pid=${health.pid ?? 'unknown'}; startedAt=${health.startedAt || 'unknown'}`,
    state: missing.length ? 'blocked' : 'ready',
  }];
}

export function repairPeerReadinessFromProbe(
  peer: PeerInstance,
  healthResult: PromiseSettledResult<SciForgeWorkspaceWriterHealth>,
  manifestResult: PromiseSettledResult<SciForgeInstanceManifest>,
): RepairPeerReadinessProbe {
  const diagnostics: string[] = [];
  const health = healthResult.status === 'fulfilled' ? healthResult.value : undefined;
  const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : undefined;
  if (healthResult.status === 'rejected') {
    diagnostics.push(`health failed: ${errorMessage(healthResult.reason)}`);
  } else {
    const healthy = healthResult.value;
    if (healthy.service !== 'sciforge-workspace-writer' || healthy.ok !== true) {
      diagnostics.push(`health returned unexpected service ${healthy.service || 'unknown'}`);
    }
  }
  if (manifestResult.status === 'rejected') {
    diagnostics.push(`manifest failed: ${errorMessage(manifestResult.reason)}`);
  }
  if (!peer.workspacePath.trim()) {
    diagnostics.push('workspacePath is required for repair peers');
  } else if (manifest?.workspacePath && normalizePathForCompare(manifest.workspacePath) !== normalizePathForCompare(peer.workspacePath)) {
    diagnostics.push(`manifest workspacePath ${manifest.workspacePath} does not match configured ${peer.workspacePath}`);
  }
  const manifestCapabilities = new Set(manifest?.capabilities ?? []);
  const missingCapabilities = REQUIRED_REPAIR_PEER_CAPABILITIES.filter((capability) => !manifestCapabilities.has(capability));
  if (manifest && missingCapabilities.length) {
    diagnostics.push(`manifest missing capabilities: ${missingCapabilities.join(', ')}`);
  }
  return {
    peerName: peer.name,
    status: diagnostics.length ? 'blocked' : 'ready',
    checkedAt: nowIso(),
    health,
    manifest,
    diagnostics: diagnostics.length ? diagnostics : [`${peer.name} writer health and repair manifest are ready.`],
  };
}

function peerReadinessDetail(repairTargets: PeerInstance[], peerReadinessByName: RepairPeerReadinessByName) {
  return repairTargets.map((peer) => {
    const readiness = peerReadinessByName[peer.name];
    if (!readiness) return `${peer.name}: checking ${peer.workspaceWriterUrl}`;
    return `${peer.name}: ${readiness.status} (${readiness.diagnostics.join('; ')})`;
  }).join(' | ');
}

function normalizePathForCompare(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
