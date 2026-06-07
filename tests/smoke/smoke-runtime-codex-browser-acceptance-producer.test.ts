import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('ready preflight producer branch enriches ordinary-chat writer output without raw local evidence', async () => {
  const artifactRoot = join(root, '.sciforge', 'test-artifacts');
  await mkdir(artifactRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-evidence-'));
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-codex-browser-producer-workspace-'));
  const preflightDir = await mkdtemp(join(artifactRoot, 'runtime-codex-browser-producer-preflight-'));
  const providerPreflightPath = join(preflightDir, 'manifest.json');
  const serviceKey = 'SERVICE_ENV_SENTINEL_DO_NOT_LEAK_PRODUCER_20260607';
  const upstreamBaseUrl = 'https://provider.example.invalid/v1';

  try {
    await writeFile(providerPreflightPath, JSON.stringify({
      schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
      checkedAt: new Date().toISOString(),
      releaseAcceptance: 'not-evaluated',
      runtimeApiKeyPresentInServiceEnv: true,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'env',
      upstreamBaseUrlSourceKind: 'env',
      configPathsCheckedCount: 0,
      configSecretFallbackCount: 0,
      category: 'ready',
      owner: 'provider',
      policyViolations: [],
      missingEnv: [],
      evidenceMode: 'current-env-diagnostic-only',
    }, null, 2), 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/smoke/smoke-runtime-codex-browser-acceptance.ts'],
      {
        cwd: root,
        env: {
          ...process.env,
          SCIFORGE_BROWSER_ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
          SCIFORGE_BROWSER_ACCEPTANCE_PROVIDER_PREFLIGHT_PATH: providerPreflightPath,
          SCIFORGE_BROWSER_ACCEPTANCE_TEST_PRODUCER_WRITER: '1',
          NODE_ENV: 'test',
          SCIFORGE_WORKSPACE_PATH: workspacePath,
          SCIFORGE_RUNTIME_API_KEY: serviceKey,
          SCIFORGE_PROXY_UPSTREAM_BASE_URL: upstreamBaseUrl,
          SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY: '',
          SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE: '',
        },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[ok\] Runtime Codex in-app browser acceptance passed/);

    const manifestText = await readFile(resolve(evidenceDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      status?: unknown;
      requestedRolePort?: unknown;
      actualWorkspaceWriterPort?: unknown;
      actualWorkspaceWriterUrl?: unknown;
      actualWorkspaceWriterUrlEvidence?: unknown;
      actualRuntimeCodexPort?: unknown;
      actualRuntimeCodexUrl?: unknown;
      actualRuntimeCodexUrlEvidence?: unknown;
      actualUrl?: unknown;
      actualUrlEvidence?: unknown;
      actualPort?: unknown;
      workspacePath?: unknown;
      workspacePathEvidence?: unknown;
      provider?: unknown;
      model?: unknown;
      negativeChecks?: Record<string, unknown>;
      evidence?: { notesPath?: unknown; runtimeAuditPath?: unknown };
      releaseEligible?: unknown;
      releaseBlocking?: unknown;
      currentRunEvidenceScope?: unknown;
      providerPreflightRef?: unknown;
      liveRuntimeCodexProof?: { eventEvidenceRefs?: unknown };
    };

    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.releaseEligible, true);
    assert.equal(manifest.releaseBlocking, false);
    assert.equal(typeof manifest.actualPort, 'number');
    assert.equal(typeof manifest.requestedRolePort, 'number');
    assert.equal(typeof manifest.actualWorkspaceWriterPort, 'number');
    assert.equal(typeof manifest.actualRuntimeCodexPort, 'number');
    assert.equal(manifest.actualUrl, undefined);
    assert.equal(manifest.actualWorkspaceWriterUrl, undefined);
    assert.equal(manifest.actualRuntimeCodexUrl, undefined);
    assert.equal(manifest.workspacePath, undefined);
    assert.ok(manifest.actualUrlEvidence);
    assert.ok(manifest.actualWorkspaceWriterUrlEvidence);
    assert.ok(manifest.actualRuntimeCodexUrlEvidence);
    assert.ok(manifest.workspacePathEvidence);
    assert.equal(manifest.currentRunEvidenceScope, undefined);
    assert.equal(manifest.providerPreflightRef, undefined);
    assert.deepEqual(manifest.negativeChecks, {
      fakePassedStatusRejected: true,
      missingDomOrScreenshotRejected: true,
      missingCommandIdRejected: true,
      missingTaskResultRejected: true,
      seedDemoEvidenceRejected: true,
      blockedFailedPartialRejected: true,
      rawStdoutJsonlRejected: true,
      nativeAnswerOutsideDefaultChatRejected: true,
    });
    assert.equal(typeof manifest.evidence?.notesPath, 'string');
    assert.match(String(manifest.evidence?.notesPath), /runtime-ordinary-chat-release-notes\.md$/);
    assert.doesNotMatch(String(manifest.evidence?.notesPath), /^\//);
    assert.equal(typeof manifest.evidence?.runtimeAuditPath, 'string');
    assert.match(String(manifest.evidence?.runtimeAuditPath), /runtime-audit\.json$/);
    assert.doesNotMatch(String(manifest.evidence?.runtimeAuditPath), /^\//);
    assert.ok(
      Array.isArray(manifest.liveRuntimeCodexProof?.eventEvidenceRefs)
        && manifest.liveRuntimeCodexProof.eventEvidenceRefs.some((ref) => String(ref).includes('browser.open_read')),
      'producer branch must preserve ordinary-chat Browser open_read source refs',
    );
    assert.doesNotMatch(manifestText, /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i);
    assert.doesNotMatch(manifestText, /\/(?:Applications|Users|private|var|tmp)\/[^\s"']+/i);
    assert.doesNotMatch(manifestText, new RegExp(serviceKey));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid/);
  } finally {
    await Promise.all([
      rm(evidenceDir, { recursive: true, force: true }),
      rm(workspacePath, { recursive: true, force: true }),
      rm(preflightDir, { recursive: true, force: true }),
    ]);
  }
});
