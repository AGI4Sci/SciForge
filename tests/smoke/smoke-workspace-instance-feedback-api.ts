import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const workspace = await mkdtemp(join(tmpdir(), 'sciforge-instance-feedback-api-'));
const serverCwd = join(workspace, 'server-cwd');
const port = 24200 + Math.floor(Math.random() * 1000);
const configPath = join(workspace, 'config.local.json');
let child: ReturnType<typeof spawn> | undefined;
let proxyHealthServer: Server | undefined;

try {
  const proxyHealth = await startProxyHealthFixture();
  proxyHealthServer = proxyHealth.server;
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await mkdir(join(serverCwd, 'docs', 'test-artifacts', 'runtime-provider-preflight'), { recursive: true });
  await mkdir(join(serverCwd, 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify(workspaceState(workspace), null, 2));
  await writeFile(
    join(serverCwd, 'docs', 'test-artifacts', 'runtime-provider-preflight', 'manifest.json'),
    JSON.stringify(runtimeProviderPreflightManifest(), null, 2),
  );
  await writeFile(
    join(serverCwd, 'docs', 'test-artifacts', 'runtime-codex-browser-acceptance', 'manifest.json'),
    JSON.stringify(runtimeCodexBrowserAcceptanceManifest(), null, 2),
  );
  child = spawn(process.execPath, ['--import', join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs'), join(repoRoot, 'src/runtime/workspace-server.ts')], {
    cwd: serverCwd,
    env: {
      ...process.env,
      SCIFORGE_WORKSPACE_PORT: String(port),
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_STATE_DIR: join(workspace, '.sciforge', 'server-state'),
      SCIFORGE_LOG_DIR: join(workspace, '.sciforge', 'server-logs'),
      SCIFORGE_WORKSPACE_PATH: workspace,
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-api-key',
      SCIFORGE_PROXY_API_KEY_ENV: 'SCIFORGE_RUNTIME_API_KEY',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider.example/v1',
      SCIFORGE_PROXY_BASE_URL: `${proxyHealth.url}/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/sciforge/instance/manifest?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const manifestJson = await response.json() as { manifest: { schemaVersion: number; instance: { id: string; name: string }; workspacePath: string; repo: { detected: boolean }; capabilities: string[] } };
  assert.equal(manifestJson.manifest.schemaVersion, 1);
  assert.ok(manifestJson.manifest.instance.id.startsWith('sciforge-'));
  assert.equal(manifestJson.manifest.workspacePath, workspace);
  assert.equal(manifestJson.manifest.repo.detected, false);
  assert.ok(manifestJson.manifest.capabilities.includes('feedback-issue-handoff-bundle'));
  assert.ok(manifestJson.manifest.capabilities.includes('runtime-provider-preflight-manifest'));
  assert.ok(manifestJson.manifest.capabilities.includes('runtime-codex-browser-acceptance-manifest'));

  response = await fetch(`${baseUrl}/api/sciforge/runtime-provider-preflight/manifest`);
  await assertOk(response);
  const providerPreflightJson = await response.json() as {
    manifest: {
      schemaVersion: string;
      checkedAt: string;
      releaseAcceptance: string;
      runtimeApiKeyPresentInServiceEnv: boolean;
      upstreamBaseUrlPresent: boolean;
      upstreamKeySourceKind: string;
      upstreamBaseUrlSourceKind: string;
      category: string;
      owner: string;
      policyViolations: string[];
      missingEnv: string[];
      evidenceMode: string;
      checkedHealthz?: { category: string; ok: boolean; retryable: boolean; httpStatus?: number; releaseAcceptance: string };
      nextActions: Array<{ label: string; command?: string; writesRepo: boolean }>;
    };
  };
  assert.equal(providerPreflightJson.manifest.schemaVersion, 'sciforge.runtime-provider-preflight.current-env.v1');
  assert.ok(Number.isFinite(Date.parse(providerPreflightJson.manifest.checkedAt)));
  assert.equal(providerPreflightJson.manifest.releaseAcceptance, 'not-evaluated');
  assert.equal(providerPreflightJson.manifest.runtimeApiKeyPresentInServiceEnv, true);
  assert.equal(providerPreflightJson.manifest.upstreamBaseUrlPresent, true);
  assert.equal(providerPreflightJson.manifest.upstreamKeySourceKind, 'env');
  assert.equal(providerPreflightJson.manifest.upstreamBaseUrlSourceKind, 'env');
  assert.equal(providerPreflightJson.manifest.category, 'ready');
  assert.equal(providerPreflightJson.manifest.owner, 'environment');
  assert.deepEqual(providerPreflightJson.manifest.policyViolations, []);
  assert.deepEqual(providerPreflightJson.manifest.missingEnv, []);
  assert.equal(providerPreflightJson.manifest.evidenceMode, 'current-env-diagnostic-only');
  assert.deepEqual(providerPreflightJson.manifest.checkedHealthz, {
    category: 'ready',
    ok: true,
    retryable: false,
    httpStatus: 200,
    releaseAcceptance: 'not-evaluated',
  });
  assert.deepEqual(providerPreflightJson.manifest.nextActions, [
    {
      label: 'Rerun provider preflight and strict Runtime Codex browser acceptance.',
      command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
      writesRepo: true,
    },
  ]);
  assert.equal(Object.hasOwn(providerPreflightJson.manifest, 'configSecretFallbackPaths'), false);

  response = await fetch(`${baseUrl}/api/sciforge/runtime-codex-browser-acceptance/manifest`);
  await assertOk(response);
  const browserAcceptanceJson = await response.json() as {
    manifest: {
      schemaVersion: string;
      status: string;
      source: string;
      currentRunEvidenceScope?: string;
      failureClass?: string;
      missingEnv?: string[];
      releaseBlocking?: boolean;
      expectedRetestCommand?: string;
    };
  };
  assert.equal(browserAcceptanceJson.manifest.schemaVersion, 'sciforge.runtime-codex.browser-acceptance.v1');
  assert.equal(browserAcceptanceJson.manifest.status, 'blocked');
  assert.equal(browserAcceptanceJson.manifest.source, 'codex-in-app-browser');
  assert.equal(browserAcceptanceJson.manifest.currentRunEvidenceScope, 'preflight-only');
  assert.equal(browserAcceptanceJson.manifest.failureClass, 'missing-runtime-env');
  assert.deepEqual(browserAcceptanceJson.manifest.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
  assert.equal(browserAcceptanceJson.manifest.releaseBlocking, true);
  assert.equal(browserAcceptanceJson.manifest.expectedRetestCommand, 'npm run smoke:runtime-codex-browser-acceptance:strict');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const listJson = await response.json() as { issues: Array<{ id: string; status: string; github?: { issueNumber?: number }; screenshot?: { hasDataUrl: boolean; dataUrlBytes: number } }> };
  assert.deepEqual(listJson.issues.map((issue) => issue.id), ['feedback-open']);
  assert.equal(listJson.issues[0].github?.issueNumber, 42);
  assert.equal(listJson.issues[0].screenshot?.hasDataUrl, true);
  assert.ok((listJson.issues[0].screenshot?.dataUrlBytes ?? 0) > 20);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const bundleJson = await response.json() as { issue: { id: string; comment: { comment: string }; target: { selector: string }; runtime: { sessionId: string }; request: { id: string }; github?: { openIssue?: { htmlUrl: string } } } };
  assert.equal(bundleJson.issue.id, 'feedback-open');
  assert.equal(bundleJson.issue.comment.comment, 'Fix the chart legend handoff.');
  assert.equal(bundleJson.issue.target.selector, '[data-testid="legend"]');
  assert.equal(bundleJson.issue.runtime.sessionId, 'session-1');
  assert.equal(bundleJson.issue.request.id, 'request-1');
  assert.equal(bundleJson.issue.github?.openIssue?.htmlUrl, 'https://github.com/org/repo/issues/42');

  const persistedComment = feedbackComment('../persist id?', 'open') as ReturnType<typeof feedbackComment> & {
    screenshot: ReturnType<typeof feedbackComment>['screenshot'] & { rawDataUrl?: string; annotatedDataUrl?: string };
  };
  persistedComment.screenshot.rawDataUrl = 'data:image/png;base64,cmF3';
  persistedComment.screenshot.annotatedDataUrl = 'data:image/png;base64,YW5ub3RhdGVk';
  response = await fetch(`${baseUrl}/api/sciforge/feedback/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      comment: persistedComment,
    }),
  });
  await assertOk(response);
  const persistedJson = await response.json() as {
    bundle: {
      id: string;
      commentRef: string;
      evidenceBundleRef: string;
      rawScreenshotRef?: string;
      annotatedScreenshotRef?: string;
      evidenceAssets?: Array<{ kind: string; ref: string; markdownImageUrl?: string; mediaType?: string; bytes?: number }>;
    };
  };
  assert.equal(persistedJson.bundle.id, '_persist_id_');
  assert.equal(persistedJson.bundle.commentRef, '.sciforge/feedback/_persist_id_/comment.json');
  assert.equal(persistedJson.bundle.rawScreenshotRef, '.sciforge/feedback/_persist_id_/raw-screenshot.data-url');
  assert.equal(persistedJson.bundle.annotatedScreenshotRef, '.sciforge/feedback/_persist_id_/annotated-screenshot.data-url');
  const scrubbedAsset = persistedJson.bundle.evidenceAssets?.find((asset) => asset.kind === 'scrubbed-annotated-screenshot');
  assert.equal(scrubbedAsset?.ref, 'repair-evidence/public/feedback-screenshots/_persist_id_/scrubbed-annotated.png');
  assert.equal(scrubbedAsset?.markdownImageUrl, 'repair-evidence/public/feedback-screenshots/_persist_id_/scrubbed-annotated.png');
  assert.equal(scrubbedAsset?.mediaType, 'image/png');
  assert.equal(scrubbedAsset?.bytes, 9);
  const persistedCommentJson = JSON.parse(await readFile(join(workspace, persistedJson.bundle.commentRef), 'utf8')) as { id: string; evidenceBundleRef: string; evidenceAssets?: Array<{ kind: string; ref: string }>; screenshot: { rawScreenshotRef: string; annotatedScreenshotRef: string } };
  assert.equal(persistedCommentJson.id, '_persist_id_');
  assert.equal(persistedCommentJson.evidenceBundleRef, '.sciforge/feedback/_persist_id_');
  assert.equal(persistedCommentJson.evidenceAssets?.some((asset) => asset.ref === 'repair-evidence/public/feedback-screenshots/_persist_id_/scrubbed-annotated.png'), true);
  assert.equal(persistedCommentJson.screenshot.rawScreenshotRef, '.sciforge/feedback/_persist_id_/raw-screenshot.data-url');
  assert.equal(persistedCommentJson.screenshot.annotatedScreenshotRef, '.sciforge/feedback/_persist_id_/annotated-screenshot.data-url');
  assert.equal(await readFile(join(workspace, '.sciforge', 'feedback', '_persist_id_', 'raw-screenshot.data-url'), 'utf8'), 'data:image/png;base64,cmF3');
  assert.equal(await readFile(join(workspace, '.sciforge', 'feedback', '_persist_id_', 'annotated-screenshot.data-url'), 'utf8'), 'data:image/png;base64,YW5ub3RhdGVk');
  assert.equal(await readFile(join(workspace, 'repair-evidence', 'public', 'feedback-screenshots', '_persist_id_', 'scrubbed-annotated.png'), 'utf8'), 'annotated');
  response = await fetch(`${baseUrl}/api/sciforge/preview/raw?workspacePath=${encodeURIComponent(workspace)}&ref=${encodeURIComponent('repair-evidence/public/feedback-screenshots/_persist_id_/scrubbed-annotated.png')}`);
  await assertOk(response);
  assert.equal(await response.text(), 'annotated');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/_persist_id_/evidence/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace }),
  });
  await assertOk(response);
  const uploadJson = await response.json() as { uploadedAssets: Array<{ ref: string; uploadStatus: string; uploadError?: string }>; evidenceFolderRef?: string };
  assert.equal(uploadJson.evidenceFolderRef, 'repair-evidence/public/feedback-screenshots/_persist_id_');
  assert.equal(uploadJson.uploadedAssets[0]?.ref, 'repair-evidence/public/feedback-screenshots/_persist_id_/scrubbed-annotated.png');
  assert.equal(uploadJson.uploadedAssets[0]?.uploadStatus, 'ready');
  assert.match(uploadJson.uploadedAssets[0]?.uploadError ?? '', /No evidence uploader configured/);
  assert.equal(await readFile(join(workspace, 'repair-evidence', 'public', 'feedback-screenshots', '_persist_id_', 'upload-index.json'), 'utf8').then((text) => JSON.parse(text).feedbackId), '_persist_id_');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      comment: { ...feedbackComment('bad-data-url', 'open'), screenshot: { ...feedbackComment('bad-data-url', 'open').screenshot, rawDataUrl: 'not-a-data-url' } },
    }),
  });
  assert.equal(response.status, 400, await response.text());

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      id: 'repair-run-1',
      externalInstanceId: 'external-alpha',
      actor: 'agent',
      startedAt: '2026-05-07T01:00:00.000Z',
    }),
  });
  await assertOk(response);
  const runJson = await response.json() as { run: { id: string; status: string; issueId: string } };
  assert.equal(runJson.run.id, 'repair-run-1');
  assert.equal(runJson.run.status, 'running');
  assert.equal(runJson.run.issueId, 'feedback-open');

  const freshPeerWorkspace = join(workspace, 'fresh-repair-peer');
  await mkdir(freshPeerWorkspace, { recursive: true });
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-seeded/repair-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: freshPeerWorkspace,
      id: 'repair-run-seeded',
      externalInstanceId: 'external-seeded',
      actor: 'repair-handoff-runner',
      startedAt: '2026-05-07T01:01:00.000Z',
      issueBundle: {
        id: 'feedback-seeded',
        comment: feedbackComment('feedback-seeded', 'open'),
      },
    }),
  });
  await assertOk(response);
  const seededRunJson = await response.json() as { run: { id: string; issueId: string } };
  assert.equal(seededRunJson.run.id, 'repair-run-seeded');
  assert.equal(seededRunJson.run.issueId, 'feedback-seeded');
  const seededState = JSON.parse(await readFile(join(freshPeerWorkspace, '.sciforge', 'workspace-state.json'), 'utf8')) as { feedbackComments: Array<{ id: string }> };
  assert.equal(seededState.feedbackComments[0]?.id, 'feedback-seeded');

  const freshResultWorkspace = join(workspace, 'fresh-repair-result-peer');
  const seededResultTerminalRef = join('.sciforge', 'repair-results', 'repair-run-seeded-result', 'terminal-mirror.ndjson');
  const seededResultBlockRef = join('.sciforge', 'repair-results', 'repair-run-seeded-result', 'pre-dispatch-provider-preflight.json');
  await mkdir(join(freshResultWorkspace, '.sciforge', 'repair-results', 'repair-run-seeded-result'), { recursive: true });
  await writeFile(join(freshResultWorkspace, seededResultTerminalRef), [
    JSON.stringify({
      timestamp: '2026-05-07T01:02:00.000Z',
      stream: 'stderr',
      text: 'Runtime Codex provider preflight blocked before isolated worktree creation.',
    }),
    JSON.stringify({
      timestamp: '2026-05-07T01:02:01.000Z',
      stream: 'event',
      text: 'Local blocked result audit remained available.',
    }),
    '',
  ].join('\n'));
  await writeFile(join(freshResultWorkspace, seededResultBlockRef), JSON.stringify({
    schemaVersion: 1,
    status: 'blocked',
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
    noIsolatedWorktreeCreated: true,
  }, null, 2));
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-seeded-result/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: freshResultWorkspace,
      issueBundle: {
        id: 'feedback-seeded-result',
        comment: feedbackComment('feedback-seeded-result', 'open'),
      },
      result: {
        id: 'repair-result-seeded-blocked',
        repairRunId: 'repair-run-seeded-result',
        verdict: 'needs-follow-up',
        summary: 'Runtime Codex provider preflight blocked before isolated worktree creation.',
        changedFiles: [],
        evidenceRefs: [seededResultTerminalRef, seededResultBlockRef],
        testResults: [{ name: 'runtime-codex-provider-preflight', status: 'skipped', summary: 'missing service env' }],
        humanVerification: { status: 'not-run', conclusion: 'Repair did not start because provider env is incomplete.' },
        metadata: {
          noExecutorDispatch: true,
          noIsolatedWorktreeCreated: true,
          noTargetRepairRunRegistered: true,
          terminalMirrorRef: seededResultTerminalRef,
          providerPreflight: { status: 'blocked', missingEnv: ['SCIFORGE_RUNTIME_API_KEY'] },
        },
      },
    }),
  });
  await assertOk(response);
  const seededResultJson = await response.json() as { result: { id: string; issueId: string; verdict: string; evidenceRefs?: string[]; metadata?: Record<string, unknown> } };
  assert.equal(seededResultJson.result.id, 'repair-result-seeded-blocked');
  assert.equal(seededResultJson.result.issueId, 'feedback-seeded-result');
  assert.equal(seededResultJson.result.verdict, 'needs-follow-up');
  assert.ok(seededResultJson.result.evidenceRefs?.includes(seededResultTerminalRef));
  assert.equal(seededResultJson.result.metadata?.noIsolatedWorktreeCreated, true);
  const seededResultState = JSON.parse(await readFile(join(freshResultWorkspace, '.sciforge', 'workspace-state.json'), 'utf8')) as {
    feedbackComments: Array<{ id: string }>;
    feedbackRepairResults: Array<{ id: string; issueId: string; repairRunId?: string }>;
    feedbackRepairRuns?: Array<{ id: string }>;
  };
  assert.equal(seededResultState.feedbackComments[0]?.id, 'feedback-seeded-result');
  assert.equal(seededResultState.feedbackRepairResults[0]?.id, 'repair-result-seeded-blocked');
  assert.equal(seededResultState.feedbackRepairResults[0]?.issueId, 'feedback-seeded-result');
  assert.equal(seededResultState.feedbackRepairRuns?.length ?? 0, 0);
  assert.equal(await exists(join(freshResultWorkspace, '.sciforge', 'feedback', 'repair-results', 'repair-result-seeded-blocked.json')), true);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(seededResultTerminalRef)}&limit=1`);
  await assertOk(response);
  const seededMirrorJson = await response.json() as { tail: { entries: Array<{ stream: string; text: string }>; totalEntries: number } };
  assert.equal(seededMirrorJson.tail.totalEntries, 2);
  assert.match(seededMirrorJson.tail.entries[0]?.text ?? '', /blocked before isolated worktree creation/);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(seededResultTerminalRef)}&cursor=1&limit=1`);
  await assertOk(response);
  const seededMirrorCursorJson = await response.json() as { tail: { cursor: number; nextCursor: number; entries: Array<{ text: string }> } };
  assert.equal(seededMirrorCursorJson.tail.cursor, 1);
  assert.equal(seededMirrorCursorJson.tail.nextCursor, 2);
  assert.match(seededMirrorCursorJson.tail.entries[0]?.text ?? '', /Local blocked result audit/);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(join('.sciforge', 'repair-results', 'missing-run', 'terminal-mirror.ndjson'))}`);
  await assertOk(response);
  const missingMirrorJson = await response.json() as { tail: { entries: unknown[]; totalEntries: number } };
  assert.equal(missingMirrorJson.tail.totalEntries, 0);
  assert.deepEqual(missingMirrorJson.tail.entries, []);
  const serverCwdReal = await realpath(serverCwd);
  const runnerOwnedTerminalRef = join(serverCwdReal, '.sciforge', 'repair-results', 'runner-owned-run', 'terminal-mirror.ndjson');
  await mkdir(join(serverCwdReal, '.sciforge', 'repair-results', 'runner-owned-run'), { recursive: true });
  await writeFile(runnerOwnedTerminalRef, `${JSON.stringify({
    timestamp: '2026-05-07T00:12:00.000Z',
    stream: 'event',
    text: 'runner-owned terminal mirror line visible to target workspace writer',
  })}\n`);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(runnerOwnedTerminalRef)}&limit=1`);
  await assertOk(response);
  const runnerOwnedMirrorJson = await response.json() as { tail: { entries: Array<{ stream: string; text: string }>; totalEntries: number } };
  assert.equal(runnerOwnedMirrorJson.tail.totalEntries, 1);
  assert.equal(runnerOwnedMirrorJson.tail.entries[0]?.stream, 'event');
  assert.match(runnerOwnedMirrorJson.tail.entries[0]?.text ?? '', /runner-owned terminal mirror line/);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent('../terminal-mirror.ndjson')}`);
  assert.equal(response.status, 400, await response.text());
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: freshResultWorkspace,
      repairRunId: 'repair-run-not-active',
      terminalMirrorRef: seededResultTerminalRef,
      reason: 'smoke verifies inactive repair stop terminal mirror handoff',
    }),
  });
  await assertOk(response);
  const inactiveStopJson = await response.json() as { stop: { stopped: boolean; status: string; message: string; terminalMirrorRef?: string } };
  assert.equal(inactiveStopJson.stop.stopped, false);
  assert.equal(inactiveStopJson.stop.status, 'not-running');
  assert.match(inactiveStopJson.stop.message, /no active repair run repair-run-not-active/i);
  assert.match(inactiveStopJson.stop.terminalMirrorRef ?? '', /terminal-mirror\.ndjson$/);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(seededResultTerminalRef)}&cursor=2&limit=1`);
  await assertOk(response);
  const inactiveStopMirrorJson = await response.json() as { tail: { cursor: number; nextCursor: number; totalEntries: number; entries: Array<{ stream: string; text: string }> } };
  assert.equal(inactiveStopMirrorJson.tail.cursor, 2);
  assert.equal(inactiveStopMirrorJson.tail.nextCursor, 3);
  assert.equal(inactiveStopMirrorJson.tail.totalEntries, 3);
  assert.equal(inactiveStopMirrorJson.tail.entries[0]?.stream, 'stderr');
  assert.match(inactiveStopMirrorJson.tail.entries[0]?.text ?? '', /Stop request was recorded fail-closed by workspace writer/);
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: freshResultWorkspace,
      repairRunId: 'repair-run-not-active',
      terminalMirrorRef: '../terminal-mirror.ndjson',
    }),
  });
  assert.equal(response.status, 400, await response.text());

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-seeded-result/repair-guidance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: freshResultWorkspace,
      repairRunId: 'repair-run-seeded-result',
      repairResultId: 'repair-result-seeded-blocked',
      terminalMirrorRef: seededResultTerminalRef,
      message: 'Please keep the patch inside src and do not touch provider secrets.',
    }),
  });
  await assertOk(response);
  const guidanceJson = await response.json() as { guidance: { status: string; message: string; responseSummary?: string; terminalMirrorRef?: string } };
  assert.equal(guidanceJson.guidance.status, 'recorded');
  assert.equal(guidanceJson.guidance.message, 'Please keep the patch inside src and do not touch provider secrets.');
  assert.match(guidanceJson.guidance.responseSummary ?? '', /no native Runtime Codex session id/i);
  assert.match(guidanceJson.guidance.terminalMirrorRef ?? '', /terminal-mirror\.ndjson$/);
  const guidanceState = JSON.parse(await readFile(join(freshResultWorkspace, '.sciforge', 'workspace-state.json'), 'utf8')) as { feedbackRepairGuidance?: Array<{ repairRunId: string; status: string }> };
  assert.equal(guidanceState.feedbackRepairGuidance?.[0]?.repairRunId, 'repair-run-seeded-result');
  assert.equal(guidanceState.feedbackRepairGuidance?.[0]?.status, 'recorded');
  response = await fetch(`${baseUrl}/api/sciforge/repair-handoff/terminal-mirror?workspacePath=${encodeURIComponent(freshResultWorkspace)}&ref=${encodeURIComponent(seededResultTerminalRef)}&cursor=3&limit=2`);
  await assertOk(response);
  const guidanceMirrorJson = await response.json() as { tail: { totalEntries: number; entries: Array<{ stream: string; text: string }> } };
  assert.equal(guidanceMirrorJson.tail.totalEntries, 5);
  assert.match(guidanceMirrorJson.tail.entries.map((entry) => entry.text).join('\n'), /Feedback Inbox guidance recorded/);
  assert.match(guidanceMirrorJson.tail.entries.map((entry) => entry.text).join('\n'), /no native Runtime Codex session id/);

  const isolatedWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-1');
  await mkdir(join(isolatedWorktree, 'src'), { recursive: true });
  await git(isolatedWorktree, ['init', '-q']);
  await writeFile(join(isolatedWorktree, 'src', 'fixed.txt'), 'before\n');
  await git(isolatedWorktree, ['add', 'src/fixed.txt']);
  await git(isolatedWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const isolatedBaseCommit = await git(isolatedWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(isolatedWorktree, 'src', 'fixed.txt'), 'after\n');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-1',
        repairRunId: 'repair-run-1',
        verdict: 'fixed',
        summary: 'Legend labels are now structured for sync.',
        changedFiles: ['src/fixed.txt'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/fixed.txt', status: 'passed', summary: 'marker exists' }],
        targetInstance: {
          id: 'repair-peer',
          name: 'Repair Peer',
          appUrl: 'http://127.0.0.1:5174',
          workspaceWriterUrl: 'http://127.0.0.1:6174',
          workspacePath: workspace,
        },
        metadata: {
          isolatedWorktreePath: isolatedWorktree,
          baseCommit: isolatedBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata(),
        },
        completedAt: '2026-05-07T01:05:00.000Z',
      },
    }),
  });
  await assertOk(response);
  const resultJson = await response.json() as { result: { id: string; verdict: string; changedFiles: string[]; targetInstance?: { workspaceWriterUrl?: string; appUrl?: string }; githubSyncStatus?: string; githubSyncError?: string } };
  assert.equal(resultJson.result.id, 'repair-result-1');
  assert.equal(resultJson.result.verdict, 'fixed');
  assert.deepEqual(resultJson.result.changedFiles, ['src/fixed.txt']);
  assert.equal(resultJson.result.targetInstance?.workspaceWriterUrl, 'http://127.0.0.1:6174');
  assert.equal(resultJson.result.targetInstance?.appUrl, 'http://127.0.0.1:5174');
  assert.equal(resultJson.result.githubSyncStatus, 'skipped');
  assert.match(resultJson.result.githubSyncError ?? '', /token is not configured/i);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'commit',
    }),
  });
  await assertOk(response);
  const unconfirmedAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(unconfirmedAction.action.status, 'requires-user-confirmation');
  assert.equal(unconfirmedAction.action.sideEffect, 'none');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'browser-recheck',
      browserVerification: {
        status: 'passed',
        verifier: 'codex-in-app-browser',
        conclusion: 'Original browser issue no longer reproduces and feedback audit remains visible.',
        evidenceRefs: ['docs/test-artifacts/feedback-inbox-closure/browser-recheck.png'],
        verifiedAt: '2026-05-07T01:07:00.000Z',
      },
    }),
  });
  await assertOk(response);
  const browserRecheckAction = await response.json() as { action: { action: string; status: string; sideEffect: string; browserVerification?: { status?: string; evidenceRefs?: string[] } }; result?: { humanVerification?: { status?: string; evidenceRefs?: string[] }; evidenceRefs?: string[] } };
  assert.equal(browserRecheckAction.action.action, 'browser-recheck');
  assert.equal(browserRecheckAction.action.status, 'completed');
  assert.equal(browserRecheckAction.action.sideEffect, 'none');
  assert.equal(browserRecheckAction.action.browserVerification?.status, 'passed');
  assert.equal(browserRecheckAction.result?.humanVerification?.status, 'passed');
  assert.ok(browserRecheckAction.result?.evidenceRefs?.includes('docs/test-artifacts/feedback-inbox-closure/browser-recheck.png'));

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'push',
    }),
  });
  await assertOk(response);
  const pushAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(pushAction.action.status, 'requires-second-confirmation');
  assert.equal(pushAction.action.sideEffect, 'none');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'pr',
      secondConfirmed: true,
    }),
  });
  await assertOk(response);
  const prAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(prAction.action.status, 'blocked');
  assert.equal(prAction.action.sideEffect, 'none');
  assert.match(prAction.action.message, /no remote mutation was attempted/i);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'merge',
      secondConfirmed: true,
    }),
  });
  assert.equal(response.status, 400, await response.text());

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-1',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const committedAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(committedAction.action.status, 'completed');
  assert.equal(committedAction.action.sideEffect, 'local-commit');
  assert.match(committedAction.action.message, /Created local isolated-worktree commit/);
  assert.notEqual(await git(isolatedWorktree, ['rev-parse', 'HEAD']), isolatedBaseCommit);

  const needsFollowUpWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-needs-follow-up');
  await mkdir(join(needsFollowUpWorktree, 'src'), { recursive: true });
  await git(needsFollowUpWorktree, ['init', '-q']);
  await writeFile(join(needsFollowUpWorktree, 'src', 'needs-follow-up.txt'), 'before\n');
  await git(needsFollowUpWorktree, ['add', 'src/needs-follow-up.txt']);
  await git(needsFollowUpWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const needsFollowUpBaseCommit = await git(needsFollowUpWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(needsFollowUpWorktree, 'src', 'needs-follow-up.txt'), 'after\n');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-needs-follow-up',
        repairRunId: 'repair-run-needs-follow-up',
        verdict: 'needs-follow-up',
        summary: 'Non-fixed result must not be committed.',
        changedFiles: ['src/needs-follow-up.txt'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/needs-follow-up.txt', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: needsFollowUpWorktree,
          baseCommit: needsFollowUpBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata(),
        },
        completedAt: '2026-05-07T01:06:00.000Z',
      },
    }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-needs-follow-up',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const needsFollowUpAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(needsFollowUpAction.action.status, 'blocked');
  assert.equal(needsFollowUpAction.action.sideEffect, 'none');
  assert.match(needsFollowUpAction.action.message, /verdict is needs-follow-up, not fixed/i);
  assert.equal(await git(needsFollowUpWorktree, ['rev-parse', 'HEAD']), needsFollowUpBaseCommit);

  const failedRecheckWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-browser-recheck-failed');
  await mkdir(join(failedRecheckWorktree, 'src'), { recursive: true });
  await git(failedRecheckWorktree, ['init', '-q']);
  await writeFile(join(failedRecheckWorktree, 'src', 'browser-recheck.txt'), 'before\n');
  await git(failedRecheckWorktree, ['add', 'src/browser-recheck.txt']);
  await git(failedRecheckWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const failedRecheckBaseCommit = await git(failedRecheckWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(failedRecheckWorktree, 'src', 'browser-recheck.txt'), 'after\n');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-browser-recheck-failed',
        repairRunId: 'repair-run-browser-recheck-failed',
        verdict: 'fixed',
        summary: 'Browser recheck failure must keep commit blocked.',
        changedFiles: ['src/browser-recheck.txt'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/browser-recheck.txt', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: failedRecheckWorktree,
          baseCommit: failedRecheckBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata(),
        },
        completedAt: '2026-05-07T01:06:30.000Z',
      },
    }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-browser-recheck-failed',
      action: 'browser-recheck',
      browserVerification: {
        status: 'failed',
        verifier: 'codex-in-app-browser',
        conclusion: 'Original issue still reproduces.',
        evidenceRefs: ['docs/test-artifacts/feedback-inbox-closure/browser-recheck-failed.png'],
        verifiedAt: '2026-05-07T01:06:35.000Z',
      },
    }),
  });
  await assertOk(response);
  const failedRecheckAction = await response.json() as { action: { status: string; sideEffect: string; message: string }; result?: { humanVerification?: { status?: string } } };
  assert.equal(failedRecheckAction.action.status, 'blocked');
  assert.equal(failedRecheckAction.action.sideEffect, 'none');
  assert.match(failedRecheckAction.action.message, /Browser recheck recorded as failed/i);
  assert.equal(failedRecheckAction.result?.humanVerification?.status, 'failed');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-browser-recheck-failed',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const failedRecheckCommitAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(failedRecheckCommitAction.action.status, 'blocked');
  assert.equal(failedRecheckCommitAction.action.sideEffect, 'none');
  assert.match(failedRecheckCommitAction.action.message, /human verification status is failed/i);
  assert.equal(await git(failedRecheckWorktree, ['rev-parse', 'HEAD']), failedRecheckBaseCommit);

  const guardBlockedWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-guard-blocked');
  await mkdir(join(guardBlockedWorktree, 'src'), { recursive: true });
  await git(guardBlockedWorktree, ['init', '-q']);
  await writeFile(join(guardBlockedWorktree, 'src', 'guard-blocked.txt'), 'before\n');
  await git(guardBlockedWorktree, ['add', 'src/guard-blocked.txt']);
  await git(guardBlockedWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const guardBlockedBaseCommit = await git(guardBlockedWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(guardBlockedWorktree, 'src', 'guard-blocked.txt'), 'after\n');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-guard-blocked',
        repairRunId: 'repair-run-guard-blocked',
        verdict: 'fixed',
        summary: 'Guard-blocked result must not be committed.',
        changedFiles: ['src/guard-blocked.txt'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/guard-blocked.txt', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: guardBlockedWorktree,
          baseCommit: guardBlockedBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata({
            status: 'blocked',
            changedForbiddenPaths: ['config.local.json'],
          }),
        },
        completedAt: '2026-05-07T01:07:00.000Z',
      },
    }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-guard-blocked',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const guardBlockedAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(guardBlockedAction.action.status, 'blocked');
  assert.equal(guardBlockedAction.action.sideEffect, 'none');
  assert.match(guardBlockedAction.action.message, /dirty worktree guard status is blocked/i);
  assert.equal(await git(guardBlockedWorktree, ['rev-parse', 'HEAD']), guardBlockedBaseCommit);

  const disabledPolicyWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-disabled-policy');
  await mkdir(join(disabledPolicyWorktree, 'src'), { recursive: true });
  await git(disabledPolicyWorktree, ['init', '-q']);
  await writeFile(join(disabledPolicyWorktree, 'src', 'disabled-policy.txt'), 'before\n');
  await git(disabledPolicyWorktree, ['add', 'src/disabled-policy.txt']);
  await git(disabledPolicyWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const disabledPolicyBaseCommit = await git(disabledPolicyWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(disabledPolicyWorktree, 'src', 'disabled-policy.txt'), 'after\n');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-disabled-policy',
        repairRunId: 'repair-run-disabled-policy',
        verdict: 'fixed',
        summary: 'Disabled commit policy must stay disabled even with confirmation.',
        changedFiles: ['src/disabled-policy.txt'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/disabled-policy.txt', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: disabledPolicyWorktree,
          baseCommit: disabledPolicyBaseCommit,
          confirmationPolicy: { commit: 'disabled', push: 'disabled', pr: 'disabled', merge: 'never' },
        },
        completedAt: '2026-05-07T01:08:00.000Z',
      },
    }),
  });
  await assertOk(response);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-disabled-policy',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const disabledPolicyAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(disabledPolicyAction.action.status, 'blocked');
  assert.equal(disabledPolicyAction.action.sideEffect, 'none');
  assert.match(disabledPolicyAction.action.message, /disabled by the repair result confirmation policy/i);
  assert.equal(await git(disabledPolicyWorktree, ['rev-parse', 'HEAD']), disabledPolicyBaseCommit);

  const safeModeWorktree = join(workspace, '.sciforge', 'repair-worktrees', 'repair-run-safe-mode');
  await mkdir(join(safeModeWorktree, 'src', 'runtime'), { recursive: true });
  await git(safeModeWorktree, ['init', '-q']);
  await writeFile(join(safeModeWorktree, 'src', 'runtime', 'workspace-server.ts'), 'export const gate = "before";\n');
  await git(safeModeWorktree, ['add', 'src/runtime/workspace-server.ts']);
  await git(safeModeWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const safeModeBaseCommit = await git(safeModeWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(safeModeWorktree, 'src', 'runtime', 'workspace-server.ts'), 'export const gate = "after";\n');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-safe-mode',
        repairRunId: 'repair-run-safe-mode',
        verdict: 'fixed',
        summary: 'Safe mode gate touches repair backend control surface.',
        changedFiles: ['src/runtime/workspace-server.ts'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        testResults: [{ command: 'test -f src/runtime/workspace-server.ts', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: safeModeWorktree,
          baseCommit: safeModeBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata(),
        },
        completedAt: '2026-05-07T01:10:00.000Z',
      },
    }),
  });
  await assertOk(response);
  const safeModeResult = await response.json() as { result: { metadata?: { safeMode?: { active?: boolean; matchedPaths?: string[] } } } };
  assert.equal(safeModeResult.result.metadata?.safeMode?.active, true);
  assert.deepEqual(safeModeResult.result.metadata?.safeMode?.matchedPaths, ['src/runtime/workspace-server.ts']);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-safe-mode',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const safeModeCommitBlocked = await response.json() as { action: { status: string; sideEffect: string; message: string; safeMode?: { active?: boolean; matchedPaths?: string[] } } };
  assert.equal(safeModeCommitBlocked.action.status, 'requires-safe-mode-confirmation');
  assert.equal(safeModeCommitBlocked.action.sideEffect, 'none');
  assert.equal(safeModeCommitBlocked.action.safeMode?.active, true);
  assert.match(safeModeCommitBlocked.action.message, /safeModeConfirmed/i);
  assert.equal(await git(safeModeWorktree, ['rev-parse', 'HEAD']), safeModeBaseCommit);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-safe-mode',
      action: 'push',
      secondConfirmed: true,
      safeModeConfirmed: true,
    }),
  });
  await assertOk(response);
  const safeModePushAction = await response.json() as { action: { status: string; sideEffect: string; message: string; safeModeConfirmed?: boolean } };
  assert.equal(safeModePushAction.action.status, 'blocked');
  assert.equal(safeModePushAction.action.sideEffect, 'none');
  assert.equal(safeModePushAction.action.safeModeConfirmed, true);
  assert.match(safeModePushAction.action.message, /external-only/i);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-safe-mode',
      action: 'commit',
      confirmed: true,
      safeModeConfirmed: true,
    }),
  });
  await assertOk(response);
  const safeModeCommittedAction = await response.json() as { action: { status: string; sideEffect: string; safeModeConfirmed?: boolean } };
  assert.equal(safeModeCommittedAction.action.status, 'completed');
  assert.equal(safeModeCommittedAction.action.sideEffect, 'local-commit');
  assert.equal(safeModeCommittedAction.action.safeModeConfirmed, true);
  assert.notEqual(await git(safeModeWorktree, ['rev-parse', 'HEAD']), safeModeBaseCommit);

  const savedState = JSON.parse(await readFile(join(workspace, '.sciforge', 'workspace-state.json'), 'utf8')) as Record<string, unknown>;
  assert.ok(Array.isArray(savedState.feedbackComments) && savedState.feedbackComments.some((comment) => {
    return typeof comment === 'object' && comment !== null && (comment as { id?: unknown }).id === '_persist_id_';
  }));
  assert.equal(Array.isArray(savedState.feedbackRepairRuns) ? savedState.feedbackRepairRuns.length : 0, 1);
  const savedRun = (savedState.feedbackRepairRuns as Array<Record<string, unknown>>)[0];
  assert.equal(savedRun.id, 'repair-run-1');
  assert.equal(savedRun.status, 'fixed');
  assert.equal(savedRun.resultId, 'repair-result-1');
  assert.equal(await exists(join(workspace, '.sciforge', 'feedback', 'repair-runs', 'repair-run-1.json')), true);
  const savedRunFile = JSON.parse(await readFile(join(workspace, '.sciforge', 'feedback', 'repair-runs', 'repair-run-1.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(savedRunFile.status, 'fixed');
  assert.equal(savedRunFile.resultId, 'repair-result-1');
  assert.equal(Array.isArray(savedState.feedbackRepairResults) ? savedState.feedbackRepairResults.length : 0, 6);
  const savedActions = Array.isArray(savedState.feedbackRepairActions) ? savedState.feedbackRepairActions as Array<Record<string, unknown>> : [];
  assert.equal(savedActions.length, 13);
  assert.ok(savedActions.some((action) => action.action === 'browser-recheck' && action.status === 'completed'));
  assert.ok(savedActions.some((action) => action.action === 'browser-recheck' && action.status === 'blocked'));
  assert.ok(savedActions.some((action) => action.action === 'commit' && action.status === 'blocked' && /human verification status is failed/i.test(String(action.message || ''))));
  const savedResult = (savedState.feedbackRepairResults as Array<Record<string, unknown>>)[0];
  assert.equal(typeof savedResult.commit, 'string');
  assert.equal(await exists(join(workspace, '.sciforge', 'feedback', 'repair-results', 'repair-result-1.json')), true);

  const runnerOwnedWorktree = join(serverCwdReal, '.sciforge', 'repair-worktrees', 'runner-owned-commit');
  await mkdir(join(runnerOwnedWorktree, 'src'), { recursive: true });
  await git(runnerOwnedWorktree, ['init', '-q']);
  await writeFile(join(runnerOwnedWorktree, 'src', 'runner-owned.txt'), 'before\n');
  await git(runnerOwnedWorktree, ['add', 'src/runner-owned.txt']);
  await git(runnerOwnedWorktree, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'base']);
  const runnerOwnedBaseCommit = await git(runnerOwnedWorktree, ['rev-parse', 'HEAD']);
  await writeFile(join(runnerOwnedWorktree, 'src', 'runner-owned.txt'), 'after\n');
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-runner-owned-commit',
        repairRunId: 'repair-run-runner-owned-commit',
        verdict: 'fixed',
        summary: 'Runner-owned isolated worktree is commit-confirmable from the target workspace writer.',
        changedFiles: ['src/runner-owned.txt'],
        testResults: [{ command: 'test -f src/runner-owned.txt', status: 'passed', summary: 'marker exists' }],
        metadata: {
          isolatedWorktreePath: runnerOwnedWorktree,
          baseCommit: runnerOwnedBaseCommit,
          confirmationPolicy: { commit: 'requires-user-confirmation', push: 'disabled', pr: 'disabled', merge: 'never' },
          dirtyWorktreeCollaboration: passedRepairGuardMetadata(),
        },
        completedAt: '2026-05-07T01:20:00.000Z',
      },
    }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      resultId: 'repair-result-runner-owned-commit',
      action: 'commit',
      confirmed: true,
    }),
  });
  await assertOk(response);
  const runnerOwnedCommitAction = await response.json() as { action: { status: string; sideEffect: string; message: string } };
  assert.equal(runnerOwnedCommitAction.action.status, 'completed');
  assert.equal(runnerOwnedCommitAction.action.sideEffect, 'local-commit');
  assert.match(runnerOwnedCommitAction.action.message, /Created local isolated-worktree commit/);
  assert.notEqual(await git(runnerOwnedWorktree, ['rev-parse', 'HEAD']), runnerOwnedBaseCommit);

  console.log('[ok] workspace instance manifest, feedback persistence, and handoff repair APIs expose structured confirmation gates');
} finally {
  child?.kill('SIGTERM');
  await closeServer(proxyHealthServer);
  await rm(workspace, { recursive: true, force: true });
}

function workspaceState(workspacePath: string) {
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [
      feedbackComment('feedback-open', 'open'),
      feedbackComment('feedback-fixed', 'fixed'),
    ],
    feedbackRequests: [{
      id: 'request-1',
      schemaVersion: 1,
      title: 'Legend repair',
      status: 'ready',
      feedbackIds: ['feedback-open'],
      summary: 'Chart legend is confusing.',
      acceptanceCriteria: ['Legend is readable.'],
      githubIssueUrl: 'https://github.com/org/repo/issues/42',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    }],
    githubSyncedOpenIssues: [{
      schemaVersion: 1,
      number: 42,
      title: 'Legend repair',
      body: 'Imported issue',
      htmlUrl: 'https://github.com/org/repo/issues/42',
      updatedAt: '2026-05-07T00:02:00.000Z',
      labels: ['feedback'],
      syncedAt: '2026-05-07T00:03:00.000Z',
    }],
    updatedAt: '2026-05-07T00:04:00.000Z',
  };
}

function feedbackComment(id: string, status: string) {
  return {
    id,
    schemaVersion: 1,
    authorId: 'u1',
    authorName: 'Researcher',
    comment: id === 'feedback-open' ? 'Fix the chart legend handoff.' : 'Already fixed.',
    status,
    priority: 'high',
    tags: ['handoff'],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: id === 'feedback-open' ? '2026-05-07T00:05:00.000Z' : '2026-05-07T00:04:00.000Z',
    requestId: id === 'feedback-open' ? 'request-1' : undefined,
    target: {
      selector: '[data-testid="legend"]',
      path: 'body > div',
      text: 'legend',
      tagName: 'div',
      rect: { x: 1, y: 2, width: 3, height: 4 },
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 12 },
    runtime: { page: 'results', url: 'http://localhost:5173', scenarioId: 'omics', sessionId: 'session-1', activeRunId: 'run-1' },
    screenshot: {
      schemaVersion: 1,
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mediaType: 'image/png',
      width: 320,
      height: 200,
      capturedAt: '2026-05-07T00:00:30.000Z',
      targetRect: { x: 1, y: 2, width: 3, height: 4 },
      includeForAgent: true,
    },
    githubIssueNumber: id === 'feedback-open' ? 42 : undefined,
    githubIssueUrl: id === 'feedback-open' ? 'https://github.com/org/repo/issues/42' : undefined,
  };
}

function runtimeProviderPreflightManifest() {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:06:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: false,
    upstreamKeySourceKind: 'config-debug-fallback',
    upstreamBaseUrlSourceKind: 'missing',
    configPathsChecked: ['config.local.json'],
    configSecretFallbackPaths: ['config.local.json'],
    category: 'config-secret-source',
    owner: 'environment',
    policyViolations: ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance'],
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: [
      {
        label: 'Set SCIFORGE_RUNTIME_API_KEY in the service environment that launches Runtime Codex/provider proxy.',
        writesRepo: false,
      },
      {
        label: 'Keep ignored config apiKey only for local proxy debugging; it cannot satisfy browser/release acceptance.',
        writesRepo: false,
      },
      {
        label: 'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL in service env or a non-secret ignored config upstreamBaseUrl.',
        writesRepo: false,
      },
      {
        label: 'Rerun current provider preflight and then strict Runtime Codex browser acceptance.',
        command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
        writesRepo: true,
      },
    ],
  };
}

function runtimeCodexBrowserAcceptanceManifest() {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'blocked',
    source: 'codex-in-app-browser',
    observedAt: '2026-05-07T00:07:00.000Z',
    actualUrl: 'http://127.0.0.1:5173/',
    actualPort: 5173,
    workspacePath: '/tmp/workspace',
    startedFromDefaultChatEntry: false,
    submittedThroughRuntimeCodex: false,
    providerModelProfileVisible: false,
    mainAnswerVisible: false,
    rawAuditFoldedByDefault: true,
    acceptanceConclusionFromRealBrowser: false,
    currentRunEvidenceScope: 'preflight-only',
    failureClass: 'missing-runtime-env',
    owner: 'environment',
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
    policyViolations: [],
    expectedRetestCommand: 'npm run smoke:runtime-codex-browser-acceptance:strict',
    releaseBlocking: true,
    releaseEligible: false,
    nextActions: [{
      label: 'Set Runtime Codex service env and rerun strict browser acceptance.',
      command: 'npm run smoke:runtime-codex-browser-acceptance:strict',
      writesRepo: true,
    }],
  };
}

async function startProxyHealthFixture(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/healthz')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        ok: true,
        upstreamBaseUrl: 'http://provider.example/v1',
        upstream: {
          category: 'ready',
          ok: true,
          retryable: false,
          httpStatus: 200,
          releaseAcceptance: 'not-evaluated',
        },
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server | undefined) {
  if (!server) return;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function waitForHealth(portNumber: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace server did not start on ${portNumber}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) assert.equal(response.status, 200, await response.text());
}

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function passedRepairGuardMetadata(overrides: Record<string, unknown> = {}) {
  return {
    status: 'passed',
    changedProtectedPaths: [],
    changedForbiddenPaths: [],
    changedOutsideAllowedPaths: [],
    executorRepairPlan: { exists: true, path: '.sciforge/repair-runs/repair-plan.md' },
    commitAudit: { created: false },
    ...overrides,
  };
}

async function git(cwd: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolveOutput(out);
      else reject(new Error(`git ${args.join(' ')} failed: ${err || out}`));
    });
  });
}
