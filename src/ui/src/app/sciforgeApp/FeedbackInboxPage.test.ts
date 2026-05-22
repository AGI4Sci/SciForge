import assert from 'node:assert/strict';
import test from 'node:test';
import { repairReadinessSummary, workspaceWriterReadinessRows, type RepairPeerReadinessByName } from './feedbackRepairReadiness';
import { buildBlockedRepairHandoffResultInput } from './feedbackBlockedRepairResult';
import type { FeedbackCommentRecord, PeerInstance, RuntimeCodexBrowserAcceptanceManifest, RuntimeProviderPreflightManifest } from '../../domain';

const repairPeer: PeerInstance = {
  name: 'repair',
  appUrl: 'http://127.0.0.1:5174',
  workspaceWriterUrl: 'http://127.0.0.1:6174',
  workspacePath: '/tmp/sciforge-repair',
  role: 'repair',
  trustLevel: 'repair',
  enabled: true,
};

test('repair readiness requires live repair peer health instead of config-only peers', () => {
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    {},
  );

  assert.equal(summary.status, 'partial');
  assert.equal(summary.rows.find((row) => row.label === 'repair peers')?.state, 'partial');
  assert.match(summary.rows.find((row) => row.label === 'repair peers')?.detail ?? '', /checking/);
});

test('repair readiness blocks unhealthy peer even when provider preflight is ready', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'blocked',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['manifest missing capabilities: feedback-repair-result-record'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    readiness,
  );

  assert.equal(summary.status, 'partial');
  assert.equal(summary.rows.find((row) => row.label === 'repair peers')?.state, 'blocked');
  assert.match(summary.rows.find((row) => row.label === 'repair peers')?.detail ?? '', /manifest missing capabilities/);
});

test('repair readiness becomes ready only after peer, provider, and strict browser acceptance pass', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance(),
    '',
    readiness,
  );

  assert.equal(summary.status, 'ready');
  assert.equal(summary.executionReady, true);
  assert.equal(summary.releaseReady, true);
  assert.equal(summary.rows.find((row) => row.label === 'strict acceptance')?.state, 'ready');
});

test('repair readiness treats stale passed browser acceptance as partial release evidence', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    readyProviderPreflight(),
    '',
    passedBrowserAcceptance({ observedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    '',
    readiness,
  );

  assert.equal(summary.executionReady, true);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.status, 'partial');
  assert.match(summary.browserBlocker, /stale|invalid/);
  assert.equal(summary.rows.find((row) => row.label === 'strict acceptance')?.state, 'partial');
});

test('workspace writer readiness surfaces stale capabilities before repair acceptance', () => {
  const stale = workspaceWriterReadinessRows({
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: 123,
    startedAt: '2026-05-07T00:00:00.000Z',
    capabilities: ['workspace-snapshot', 'runtime-provider-preflight-manifest'],
  }, '');
  assert.equal(stale[0].state, 'blocked');
  assert.equal(stale[0].value, 'stale-capabilities');
  assert.match(stale[0].detail ?? '', /runtime-codex-browser-acceptance-manifest/);

  const current = workspaceWriterReadinessRows({
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: 124,
    startedAt: '2026-05-07T00:01:00.000Z',
    capabilities: [
      'repair-handoff-runner',
      'feedback-repair-terminal-mirror-tail',
      'runtime-provider-preflight-manifest',
      'runtime-codex-browser-acceptance-manifest',
    ],
  }, '');
  assert.equal(current[0].state, 'ready');
  assert.equal(current[0].value, 'current');
});

test('blocked provider handoff builds durable repair audit payload', () => {
  const readiness: RepairPeerReadinessByName = {
    repair: {
      peerName: 'repair',
      status: 'ready',
      checkedAt: '2026-05-07T00:00:00.000Z',
      diagnostics: ['repair writer health and repair manifest are ready.'],
    },
  };
  const provider = blockedProviderPreflight();
  const browser = blockedBrowserAcceptance();
  const summary = repairReadinessSummary(
    [repairPeer],
    [repairPeer],
    provider,
    '',
    browser,
    '',
    readiness,
  );
  const result = buildBlockedRepairHandoffResultInput({
    item: feedbackComment(),
    failureKind: 'runtime-provider-preflight-blocked',
    message: summary.providerBlocker,
    completedAt: '2026-05-07T01:00:00.000Z',
    target: repairPeer,
    repairReadiness: summary,
    peerReadinessByName: readiness,
    runtimePreflightManifest: provider,
    browserAcceptanceManifest: browser,
    sourceWorkspacePath: '/tmp/source',
  });

  assert.equal(result.verdict, 'needs-follow-up');
  assert.equal(result.status, 'blocked');
  assert.match(result.summary, /provider preflight is not release-ready/);
  assert.deepEqual(result.changedFiles, []);
  assert.ok(result.evidenceRefs?.includes('docs/test-artifacts/runtime-provider-preflight/manifest.json'));
  assert.ok(result.evidenceRefs?.includes('.sciforge/feedback/feedback-1/comment.json'));
  assert.equal(result.testResults?.[0]?.status, 'failed');
  assert.equal(result.humanVerification?.status, 'not-run');
  assert.equal(result.metadata?.failureKind, 'runtime-provider-preflight-blocked');
  assert.equal((result.metadata?.repairReadiness as { providerReady?: boolean }).providerReady, false);
  assert.equal((result.metadata?.runtimePreflightManifest as RuntimeProviderPreflightManifest).category, 'config-secret-source');
  assert.equal(result.metadata?.targetWorkspaceWriterUrl, repairPeer.workspaceWriterUrl);
  assert.equal((result.metadata?.confirmationPolicy as { commit?: string }).commit, 'requires-user-confirmation');
});

function readyProviderPreflight(): RuntimeProviderPreflightManifest {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:00:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'env',
    upstreamBaseUrlSourceKind: 'env',
    category: 'ready',
    owner: 'environment',
    policyViolations: [],
    missingEnv: [],
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: [],
  };
}

function blockedProviderPreflight(): RuntimeProviderPreflightManifest {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:00:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: false,
    upstreamKeySourceKind: 'config-debug-fallback',
    upstreamBaseUrlSourceKind: 'missing',
    category: 'config-secret-source',
    owner: 'environment',
    policyViolations: ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance'],
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: [],
  };
}

function passedBrowserAcceptance(overrides: Partial<RuntimeCodexBrowserAcceptanceManifest> = {}): RuntimeCodexBrowserAcceptanceManifest {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: new Date().toISOString(),
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: true,
    currentRunEvidenceScope: 'live-browser-current-run',
    releaseBlocking: false,
    releaseEligible: true,
    ...overrides,
  };
}

function blockedBrowserAcceptance(): RuntimeCodexBrowserAcceptanceManifest {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt: '2026-05-07T00:00:00.000Z',
    startedFromDefaultChatEntry: false,
    submittedThroughRuntimeCodex: false,
    providerModelProfileVisible: false,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: false,
    currentRunEvidenceScope: 'preflight-only',
    releaseBlocking: true,
    releaseEligible: false,
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
  };
}

function feedbackComment(): FeedbackCommentRecord {
  return {
    schemaVersion: 1,
    id: 'feedback-1',
    authorId: 'tester',
    authorName: 'Tester',
    comment: 'Runtime repair should block before provider dispatch.',
    status: 'github-open',
    priority: 'normal',
    tags: ['feedback'],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    target: {
      selector: '[data-testid="repair"]',
      path: 'body > button',
      text: 'Repair',
      tagName: 'button',
      rect: { x: 1, y: 2, width: 100, height: 30 },
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    runtime: { page: 'feedback', url: 'http://127.0.0.1:5173/', scenarioId: 'default', sessionId: 'session-1' },
    evidenceBundleRef: '.sciforge/feedback/feedback-1',
    rawScreenshotRef: '.sciforge/feedback/feedback-1/raw-screenshot.data-url',
    annotatedScreenshotRef: '.sciforge/feedback/feedback-1/annotated-screenshot.data-url',
    screenshotRef: '.sciforge/feedback/feedback-1/comment.json',
  };
}
