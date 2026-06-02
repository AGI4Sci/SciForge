import assert from 'node:assert/strict';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION,
  readRuntimeCodexBrowserAcceptanceManifest,
  runtimeCodexBrowserAcceptanceManifestPath,
} from './workspace-server-runtime-codex-browser-acceptance.js';

test('runtimeCodexBrowserAcceptanceManifestPath prefers explicit evidence dir', () => {
  assert.equal(
    runtimeCodexBrowserAcceptanceManifestPath({
      cwd: '/repo',
      env: { SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: '/tmp/sciforge-browser' },
      parallelProfileId: 'p3',
    }),
    '/tmp/sciforge-browser/manifest.json',
  );
});

test('runtimeCodexBrowserAcceptanceManifestPath uses parallel profile artifact path', () => {
  assert.equal(
    runtimeCodexBrowserAcceptanceManifestPath({
      cwd: '/repo',
      env: {},
      parallelProfileId: 'p4',
    }),
    '/repo/docs/test-artifacts/parallel/p4/manifest.json',
  );

  assert.equal(
    runtimeCodexBrowserAcceptanceManifestPath({
      cwd: '/repo',
      env: {},
      parallelProfileId: 'p1',
    }),
    '/repo/docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
  );
});

test('readRuntimeCodexBrowserAcceptanceManifest normalizes passed manifest and freshness', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-cwd-'));
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-manifest-'));
  const screenshotRef = 'docs/evidence/browser.png';
  const screenshotPath = join(cwd, screenshotRef);
  await mkdir(join(cwd, 'docs', 'evidence'), { recursive: true });
  await writeFile(screenshotPath, 'png');
  const observedAt = '2026-05-29T00:00:00.000Z';
  await utimes(screenshotPath, new Date(observedAt), new Date('2026-05-29T00:01:00.000Z'));
  await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
    schemaVersion: RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION,
    status: ' passed ',
    source: ' codex-in-app-browser ',
    observedAt,
    actualUrl: ' http://127.0.0.1:3000 ',
    actualPort: 3000,
    requestedRolePort: 3000,
    actualWorkspaceWriterPort: 3001,
    actualWorkspaceWriterUrl: ' http://127.0.0.1:3001 ',
    actualRuntimeCodexPort: 3002,
    actualRuntimeCodexUrl: ' http://127.0.0.1:3002 ',
    profile: ' p2 ',
    workspacePath: ' /workspace ',
    provider: ' openai ',
    model: ' gpt-5 ',
    commandId: ' cmd-1 ',
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: true,
    currentRunEvidenceScope: ' current-run ',
    blockedOn: ['provider', 12, 'env'],
    policyViolations: ['none', false],
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
    releaseBlocking: true,
    releaseEligible: true,
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    configPathsChecked: ['.env.local'],
    configSecretFallbackPaths: ['config/local.json'],
    nextActions: [
      { label: ' Rerun ', command: ' npm test ', expected: ' pass ', writesRepo: true },
      { label: '   ', writesRepo: true },
    ],
    evidence: {
      screenshotPath: screenshotRef,
      domSnapshotPath: '',
    },
  }));

  const manifest = await readRuntimeCodexBrowserAcceptanceManifest({
    cwd,
    env: {
      SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
      SCIFORGE_RUNTIME_API_KEY: 'test-service-env-key',
      SCIFORGE_BROWSER_ACCEPTANCE_MAX_AGE_MINUTES: '30',
      SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_MTIME_TOLERANCE_MINUTES: '10',
    },
    parallelProfileId: 'p1',
    nowMs: () => Date.parse('2026-05-29T00:02:00.000Z'),
    nowIso: () => '2026-05-29T00:02:00.000Z',
  });

  assert.equal(manifest?.status, 'passed');
  assert.equal(manifest?.source, 'codex-in-app-browser');
  assert.equal(manifest?.actualUrl, 'http://127.0.0.1:3000');
  assert.equal(manifest?.requestedRolePort, 3000);
  assert.equal(manifest?.actualWorkspaceWriterPort, 3001);
  assert.equal(manifest?.actualWorkspaceWriterUrl, 'http://127.0.0.1:3001');
  assert.equal(manifest?.actualRuntimeCodexPort, 3002);
  assert.equal(manifest?.actualRuntimeCodexUrl, 'http://127.0.0.1:3002');
  assert.equal(manifest?.profile, 'p2');
  assert.equal(manifest?.startedFromDefaultChatEntry, true);
  assert.deepEqual(manifest?.blockedOn, ['provider', 'env']);
  assert.deepEqual(manifest?.nextActions, [{
    label: 'Rerun',
    command: 'npm test',
    expected: 'pass',
    writesRepo: true,
  }]);
  assert.deepEqual(manifest?.evidence, {
    screenshotPath: screenshotRef,
    domSnapshotPath: undefined,
    notesPath: undefined,
    runtimeAuditPath: undefined,
  });
  assert.deepEqual(manifest?.freshness, {
    checkedAt: '2026-05-29T00:02:00.000Z',
    observedAtFresh: true,
    evidenceFresh: true,
    staleEvidenceRefs: [],
  });
});

test('readRuntimeCodexBrowserAcceptanceManifest omits freshness for blocked manifests', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-blocked-'));
  await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
    schemaVersion: RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    source: 'codex-in-app-browser',
    reason: 'missing runtime env',
    evidence: {
      screenshotPath: 'missing.png',
    },
  }));

  const manifest = await readRuntimeCodexBrowserAcceptanceManifest({
    cwd: '/repo',
    env: { SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir },
    parallelProfileId: 'p1',
  });

  assert.equal(manifest?.status, 'blocked');
  assert.equal(manifest?.reason, 'missing runtime env');
  assert.equal(manifest?.freshness, undefined);
});

test('readRuntimeCodexBrowserAcceptanceManifest downgrades stale passed evidence when service env key is missing', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-env-gate-'));
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-env-manifest-'));
  const screenshotRef = 'docs/evidence/browser.png';
  const domRef = 'docs/evidence/dom.txt';
  const notesRef = 'docs/evidence/notes.md';
  await mkdir(join(cwd, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(cwd, screenshotRef), 'png');
  await writeFile(join(cwd, domRef), '- main: Runtime Codex answer rendered\n');
  await writeFile(join(cwd, notesRef), '# Acceptance\n');
  await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
    schemaVersion: RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION,
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: '2026-05-29T00:00:00.000Z',
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    mainAnswerVisible: true,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: true,
    currentRunEvidenceScope: 'live-browser-current-run',
    runtimeApiKeyPresentInServiceEnv: true,
    releaseBlocking: false,
    releaseEligible: true,
    evidence: {
      screenshotPath: screenshotRef,
      domSnapshotPath: domRef,
      notesPath: notesRef,
    },
  }));

  const manifest = await readRuntimeCodexBrowserAcceptanceManifest({
    cwd,
    env: { SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir },
    parallelProfileId: 'p1',
    nowMs: () => Date.parse('2026-05-29T00:02:00.000Z'),
  });

  assert.equal(manifest?.status, 'blocked');
  assert.equal(manifest?.submittedThroughRuntimeCodex, false);
  assert.equal(manifest?.providerModelProfileVisible, false);
  assert.equal(manifest?.mainAnswerVisible, false);
  assert.equal(manifest?.acceptanceConclusionFromRealBrowser, false);
  assert.equal(manifest?.currentRunEvidenceScope, 'preflight-only');
  assert.equal(manifest?.runtimeApiKeyPresentInServiceEnv, false);
  assert.equal(manifest?.releaseBlocking, true);
  assert.equal(manifest?.releaseEligible, false);
  assert.deepEqual(manifest?.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
  assert.deepEqual(manifest?.evidence, { notesPath: notesRef });
  assert.deepEqual((manifest as { staleEvidenceRefs?: string[] } | undefined)?.staleEvidenceRefs, [screenshotRef, domRef]);
  assert.equal(manifest?.freshness, undefined);
  assert.match(manifest?.reason ?? '', /service environment is missing SCIFORGE_RUNTIME_API_KEY/);
});

test('readRuntimeCodexBrowserAcceptanceManifest rejects non-object manifests', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-acceptance-invalid-'));
  await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify(['not-an-object']));

  await assert.rejects(
    readRuntimeCodexBrowserAcceptanceManifest({
      cwd: '/repo',
      env: { SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir },
      parallelProfileId: 'p1',
    }),
    /runtime codex browser acceptance manifest is invalid/,
  );
});

test('readRuntimeCodexBrowserAcceptanceManifest rejects unsupported schema, source, and status', async () => {
  const cases: Array<{ name: string; patch: Record<string, unknown>; error: RegExp }> = [
    {
      name: 'schema',
      patch: { schemaVersion: 'sciforge.runtime-codex-browser-acceptance.v1' },
      error: /unsupported schemaVersion/,
    },
    {
      name: 'source',
      patch: { source: 'browser' },
      error: /source must be codex-in-app-browser/,
    },
    {
      name: 'status',
      patch: { status: 'unknown' },
      error: /status must be passed, blocked, failed, or partial/,
    },
  ];

  for (const item of cases) {
    const evidenceDir = await mkdtemp(join(tmpdir(), `sciforge-browser-acceptance-${item.name}-`));
    await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify({
      schemaVersion: RUNTIME_CODEX_BROWSER_ACCEPTANCE_SCHEMA_VERSION,
      status: 'blocked',
      source: 'codex-in-app-browser',
      ...item.patch,
    }));

    await assert.rejects(
      readRuntimeCodexBrowserAcceptanceManifest({
        cwd: '/repo',
        env: { SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir },
        parallelProfileId: 'p1',
      }),
      item.error,
    );
  }
});
