import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

test('missing Runtime Codex service env stays typed blocked and cannot claim right-pane Browser live pass', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-service-env-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_RUNTIME_API_KEY: '',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '',
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '',
        },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(await readFile(resolve(evidenceDir, 'manifest.json'), 'utf8')) as {
      status?: unknown;
      currentRunEvidenceScope?: unknown;
      missingEnv?: unknown;
      runtimeServiceEnvAcceptance?: {
        typedBlocked?: unknown;
        runtimeApiKeyPresentInServiceEnv?: unknown;
        canClaimRightPaneBrowserLivePass?: unknown;
        evidenceScope?: unknown;
        missingEnv?: unknown;
      };
      submittedThroughRuntimeCodex?: unknown;
      mainAnswerVisible?: unknown;
      acceptanceConclusionFromRealBrowser?: unknown;
      evidence?: {
        screenshotPath?: unknown;
        domSnapshotPath?: unknown;
        notesPath?: unknown;
      };
      exactRetestCommands?: unknown;
      strictRetestCommand?: unknown;
    };

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.currentRunEvidenceScope, 'preflight-only');
    assert.deepEqual(manifest.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
    assert.deepEqual(manifest.runtimeServiceEnvAcceptance, {
      typedBlocked: true,
      runtimeApiKeyPresentInServiceEnv: false,
      canClaimRightPaneBrowserLivePass: false,
      evidenceScope: 'preflight-only',
      missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
    });
    assert.equal(manifest.submittedThroughRuntimeCodex, false);
    assert.equal(manifest.mainAnswerVisible, false);
    assert.equal(manifest.acceptanceConclusionFromRealBrowser, false);
    assert.equal(manifest.evidence?.screenshotPath, undefined);
    assert.equal(manifest.evidence?.domSnapshotPath, undefined);
    assert.equal(typeof manifest.evidence?.notesPath, 'string');
    assert.deepEqual(manifest.exactRetestCommands, [
      'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" npm run smoke:runtime-provider-preflight',
      'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" npm run smoke:runtime-codex-browser-acceptance',
      'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" npm run smoke:runtime-provider-preflight && SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance',
    ]);
    assert.equal(
      manifest.strictRetestCommand,
      'SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" npm run smoke:runtime-provider-preflight && SCIFORGE_RUNTIME_API_KEY="${SCIFORGE_RUNTIME_API_KEY:?set in service env}" SCIFORGE_PROXY_UPSTREAM_BASE_URL="${SCIFORGE_PROXY_UPSTREAM_BASE_URL:?set upstream /v1 url}" SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance',
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
  }
});

test('service env source wins over config debug fallback without leaking service key material', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-service-env-present-'));
  const serviceKey = 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_20260602';
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_RUNTIME_API_KEY: serviceKey,
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.invalid/v1',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '',
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '',
        },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifestText = await readFile(resolve(evidenceDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: unknown;
      runtimeApiKeyPresentInServiceEnv?: unknown;
      upstreamBaseUrlPresent?: unknown;
      upstreamKeySourceKind?: unknown;
      upstreamBaseUrlSourceKind?: unknown;
      runtimeServiceEnvAcceptance?: {
        typedBlocked?: unknown;
        runtimeApiKeyPresentInServiceEnv?: unknown;
        canClaimRightPaneBrowserLivePass?: unknown;
        evidenceScope?: unknown;
        missingEnv?: unknown;
      };
      serviceEnvRequired?: {
        missing?: unknown;
      };
      configSecretFallbackPaths?: unknown;
      configSecretFallbackCount?: unknown;
      liveRerunEligibility?: {
        serviceEnvReady?: unknown;
        canAttemptLiveBrowserRerun?: unknown;
        requiresLiveBrowserAcceptance?: unknown;
        evidenceScope?: unknown;
        keySourceKind?: unknown;
        upstreamSourceKind?: unknown;
        missingEnv?: unknown;
      };
    };

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.runtimeApiKeyPresentInServiceEnv, true);
    assert.equal(manifest.upstreamBaseUrlPresent, true);
    assert.equal(manifest.upstreamKeySourceKind, 'env');
    assert.equal(manifest.upstreamBaseUrlSourceKind, 'env');
    assert.deepEqual(manifest.serviceEnvRequired?.missing, []);
    assert.deepEqual(manifest.runtimeServiceEnvAcceptance, {
      typedBlocked: false,
      runtimeApiKeyPresentInServiceEnv: true,
      canClaimRightPaneBrowserLivePass: false,
      evidenceScope: 'preflight-only',
      missingEnv: [],
    });
    assert.deepEqual(manifest.liveRerunEligibility, {
      serviceEnvReady: true,
      canAttemptLiveBrowserRerun: true,
      requiresLiveBrowserAcceptance: false,
      evidenceScope: 'preflight-only',
      keySourceKind: 'env',
      upstreamSourceKind: 'env',
      missingEnv: [],
    });
    assert.doesNotMatch(manifestText, new RegExp(serviceKey));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid/);
    assert.equal(manifest.configSecretFallbackPaths, undefined, 'config fallback paths must not be stored as raw local paths');
    assert.equal(typeof manifest.configSecretFallbackCount, 'number', 'config fallback evidence is stored as a bounded count');
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
  }
});
