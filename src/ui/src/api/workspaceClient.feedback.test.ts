import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  confirmFeedbackRepairAction,
  feedbackCodexPtyWebSocketUrl,
  listFeedbackIssues,
  loadFeedbackIssueHandoffBundle,
  loadRuntimeCodexBrowserAcceptanceManifest,
  loadRuntimeProviderPreflightManifest,
  loadSciForgeInstanceManifest,
  loadWorkspaceWriterHealth,
  runFeedbackIssueRepairHandoff,
  saveFeedbackCommentEvidenceBundle,
  saveFeedbackIssueRepairResult,
  sendFeedbackRepairGuidance,
  startFeedbackCodexPtyTerminal,
  startFeedbackIssueRepairRun,
  stopFeedbackCodexPtyTerminal,
  uploadFeedbackEvidenceAssets,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('workspaceClient feedback issue helpers', () => {
  it('loads the runtime provider preflight manifest from the workspace writer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ manifest: runtimeProviderPreflightManifest() });
    }) as typeof fetch;

    const manifest = await loadRuntimeProviderPreflightManifest(testConfig());
    assert.equal(manifest?.schemaVersion, 'sciforge.runtime-provider-preflight.current-env.v1');
    assert.equal(manifest?.releaseAcceptance, 'not-evaluated');
    assert.equal(manifest?.runtimeApiKeyPresentInServiceEnv, true);
    assert.equal(manifest?.upstreamBaseUrlPresent, true);
    assert.equal(manifest?.upstreamKeySourceKind, 'env');
    assert.equal(manifest?.upstreamBaseUrlSourceKind, 'env');
    assert.equal(manifest?.checkedHealthz?.releaseAcceptance, 'not-evaluated');
    assert.deepEqual(manifest?.nextActions, [
      {
        label: 'Rerun provider preflight.',
        command: 'npm run smoke:runtime-provider-preflight',
        writesRepo: true,
      },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:5174/api/sciforge/runtime-provider-preflight/manifest');
    assert.equal(calls[0].init, undefined);
  });

  it('returns undefined when the runtime provider preflight manifest is absent', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: false, error: 'missing' }, 404)) as typeof fetch;

    const manifest = await loadRuntimeProviderPreflightManifest(testConfig());
    assert.equal(manifest, undefined);
  });

  it('loads the runtime codex browser acceptance manifest from the workspace writer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ manifest: runtimeCodexBrowserAcceptanceManifest() });
    }) as typeof fetch;

    const manifest = await loadRuntimeCodexBrowserAcceptanceManifest(testConfig());
    assert.equal(manifest?.schemaVersion, 'sciforge.runtime-codex.browser-acceptance.v1');
    assert.equal(manifest?.status, 'blocked');
    assert.equal(manifest?.source, 'codex-in-app-browser');
    assert.equal(manifest?.currentRunEvidenceScope, 'preflight-only');
    assert.equal(manifest?.releaseBlocking, true);
    assert.deepEqual(manifest?.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
    assert.equal(calls[0].url, 'http://127.0.0.1:5174/api/sciforge/runtime-codex-browser-acceptance/manifest');
  });

  it('loads workspace writer health from the peer writer URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        ok: true,
        service: 'sciforge-workspace-writer',
        schemaVersion: 1,
        pid: 123,
        startedAt: '2026-05-07T00:00:00.000Z',
        instanceId: 'repair',
        capabilities: ['feedback-repair-run-record', 'repair-handoff-runner'],
      });
    }) as typeof fetch;

    const health = await loadWorkspaceWriterHealth(testConfig(), 'http://127.0.0.1:6174/');

    assert.equal(health.instanceId, 'repair');
    assert.deepEqual(health.capabilities, ['feedback-repair-run-record', 'repair-handoff-runner']);
    assert.equal(calls[0].url, 'http://127.0.0.1:6174/health');
  });

  it('calls structured instance and feedback endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/api/sciforge/instance/manifest')) {
        return jsonResponse({ manifest: { schemaVersion: 1, instance: { id: 'sciforge-test', name: 'Test' }, workspacePath: '/tmp/ws', repo: { detected: false }, capabilities: ['feedback-issues-list'] } });
      }
      if (url.endsWith('/api/sciforge/feedback/issues?workspacePath=%2Ftmp%2Fws')) {
        return jsonResponse({ issues: [{ schemaVersion: 1, id: 'feedback-1', kind: 'feedback-comment', title: 'Fix', status: 'open', priority: 'high', tags: [], createdAt: '2026-05-07T00:00:00.000Z', updatedAt: '2026-05-07T00:01:00.000Z', comment: 'Fix', runtime: { page: 'results', scenarioId: 'omics' } }] });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/repair-runs')) {
        return jsonResponse({ run: { schemaVersion: 1, id: 'repair-run-1', issueId: 'feedback-1', status: 'running', startedAt: '2026-05-07T00:02:00.000Z' } });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/repair-result')) {
        return jsonResponse({ result: { schemaVersion: 1, id: 'repair-result-1', issueId: 'feedback-1', verdict: 'fixed', summary: 'done', changedFiles: [], evidenceRefs: [], completedAt: '2026-05-07T00:03:00.000Z' } });
      }
      if (url.includes('/api/sciforge/repair-handoff/run')) {
        return jsonResponse({ result: { schemaVersion: 1, id: 'repair-result-runner', issueId: 'feedback-1', verdict: 'needs-follow-up', summary: 'runner done', changedFiles: [], evidenceRefs: [], completedAt: '2026-05-07T00:04:00.000Z' } });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/repair-actions')) {
        return jsonResponse({
          action: { schemaVersion: 1, id: 'repair-action-1', issueId: 'feedback-1', repairResultId: 'repair-result-runner', action: 'commit', status: 'requires-user-confirmation', sideEffect: 'none', requestedAt: '2026-05-07T00:05:00.000Z', message: 'Local commit requires explicit user confirmation and was not executed.' },
          result: { schemaVersion: 1, id: 'repair-result-runner', issueId: 'feedback-1', verdict: 'needs-follow-up', summary: 'runner done', changedFiles: [], evidenceRefs: [], completedAt: '2026-05-07T00:04:00.000Z' },
        });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/repair-guidance')) {
        return jsonResponse({
          guidance: {
            schemaVersion: 1,
            id: 'repair-guidance-1',
            issueId: 'feedback-1',
            repairRunId: 'repair-run-1',
            repairResultId: 'repair-result-runner',
            status: 'recorded',
            requestedAt: '2026-05-07T00:05:30.000Z',
            requestedBy: 'feedback-inbox',
            message: 'Try the smaller scoped fix.',
            terminalMirrorRef: '.sciforge/repair-results/repair-run-1/terminal-mirror.ndjson',
            responseSummary: 'Guidance was recorded; no native Runtime Codex session id is available yet.',
          },
        });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/codex-pty/start')) {
        return jsonResponse({
          session: directCodexTerminalSession({
            id: 'codex-pty-terminal-feedback-1',
            repairRunId: 'codex-pty-terminal-feedback-1',
            status: 'running',
            transport: 'websocket-pty',
            webSocketPath: '/api/sciforge/feedback/codex-pty/codex-pty-terminal-feedback-1/ws',
          }),
          repairRun: {
            schemaVersion: 1,
            id: 'codex-pty-terminal-feedback-1',
            issueId: 'feedback-1',
            status: 'running',
            actor: 'direct-codex-terminal',
            startedAt: '2026-05-07T00:06:30.000Z',
            terminalMirrorRef: '/tmp/ws/.sciforge/repair-results/codex-pty-terminal-feedback-1/terminal-mirror.ndjson',
            metadata: { terminalTransport: 'websocket-pty' },
          },
        });
      }
      if (url.includes('/api/sciforge/feedback/codex-pty/codex-pty-terminal-feedback-1/stop')) {
        return jsonResponse({
          session: directCodexTerminalSession({
            id: 'codex-pty-terminal-feedback-1',
            repairRunId: 'codex-pty-terminal-feedback-1',
            status: 'cancelled',
            transport: 'websocket-pty',
            webSocketPath: '/api/sciforge/feedback/codex-pty/codex-pty-terminal-feedback-1/ws',
            message: 'PTY stop requested.',
          }),
        });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1/evidence/upload')) {
        return jsonResponse({
          schemaVersion: 1,
          issueId: 'feedback-1',
          evidenceFolderRef: 'repair-evidence/public/feedback-screenshots/feedback-1',
          evidenceAssets: [{
            schemaVersion: 1,
            id: 'feedback-evidence-feedback-1-scrubbed-annotated',
            kind: 'scrubbed-annotated-screenshot',
            label: 'Scrubbed annotated screenshot',
            ref: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            publicUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            githubMarkdownUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            uploadStatus: 'uploaded',
            mediaType: 'image/png',
            createdAt: '2026-05-07T00:00:00.000Z',
          }],
          uploadedAssets: [{
            schemaVersion: 1,
            id: 'feedback-evidence-feedback-1-scrubbed-annotated',
            kind: 'scrubbed-annotated-screenshot',
            label: 'Scrubbed annotated screenshot',
            ref: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            publicUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            githubMarkdownUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
            uploadStatus: 'uploaded',
            mediaType: 'image/png',
            createdAt: '2026-05-07T00:00:00.000Z',
          }],
          comment: { id: 'feedback-1', comment: 'Fix', evidenceAssets: [] },
        });
      }
      if (url.includes('/api/sciforge/feedback/comments')) {
        return jsonResponse({
          bundle: {
            schemaVersion: 1,
            id: 'feedback-1',
            commentRef: '.sciforge/feedback/feedback-1/comment.json',
            evidenceBundleRef: '.sciforge/feedback/feedback-1',
            evidenceAssets: [{
              schemaVersion: 1,
              id: 'feedback-evidence-feedback-1-scrubbed-annotated',
              kind: 'scrubbed-annotated-screenshot',
              label: 'Scrubbed annotated screenshot',
              ref: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
              markdownImageUrl: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
              mediaType: 'image/png',
              createdAt: '2026-05-07T00:00:00.000Z',
            }],
          },
        });
      }
      if (url.includes('/api/sciforge/feedback/issues/feedback-1')) {
        return jsonResponse({
          issue: {
            schemaVersion: 1,
            id: 'feedback-1',
            kind: 'feedback-comment',
            title: 'Fix',
            status: 'open',
            priority: 'high',
            tags: [],
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:01:00.000Z',
            comment: { id: 'feedback-1', comment: 'Fix' },
            target: { selector: '#x' },
            runtime: { page: 'results', scenarioId: 'omics' },
            workspacePath: '/tmp/ws',
            repairRuns: [],
            repairResults: [],
          },
        });
      }
      return jsonResponse({ ok: false, error: 'unexpected' }, 404);
    }) as typeof fetch;

    const config = testConfig();
    const manifest = await loadSciForgeInstanceManifest(config);
    assert.equal(manifest.instance.id, 'sciforge-test');

    const issues = await listFeedbackIssues(config);
    assert.deepEqual(issues.map((issue) => issue.id), ['feedback-1']);

    const bundle = await loadFeedbackIssueHandoffBundle(config, 'feedback-1');
    assert.equal(bundle.id, 'feedback-1');

    const run = await startFeedbackIssueRepairRun(config, 'feedback-1', { id: 'repair-run-1' });
    assert.equal(run.status, 'running');

    const result = await saveFeedbackIssueRepairResult(config, 'feedback-1', { verdict: 'fixed', summary: 'done' });
    assert.equal(result.verdict, 'fixed');

    const handoffResult = await runFeedbackIssueRepairHandoff(config, {
      executorInstance: { id: 'main', name: 'Main' },
      targetInstance: { id: 'repair', name: 'Repair' },
      targetWorkspacePath: '/tmp/target',
      targetWorkspaceWriterUrl: 'http://127.0.0.1:5175',
      issueBundle: bundle,
      expectedTests: [{ name: 'typecheck', command: 'npm run typecheck' }],
      githubSyncRequired: false,
      executorBackend: 'runtime-codex',
      runtimeProfile: 'sciforge-runtime-deepseek',
      allowOpenAiRuntime: false,
      initialGuidance: 'Keep the thread visible while opening a new chat.',
      allowedWritePaths: ['src'],
      forbiddenWritePaths: ['config.local.json'],
      requestMetadata: { source: 'test' },
      confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
    });
    assert.equal(handoffResult.verdict, 'needs-follow-up');

    const actionResponse = await confirmFeedbackRepairAction(config, 'feedback-1', {
      action: 'browser-recheck',
      resultId: 'repair-result-runner',
      browserVerification: {
        status: 'passed',
        verifier: 'codex-in-app-browser',
        conclusion: 'Original issue no longer reproduces.',
        evidenceRefs: ['docs/test-artifacts/feedback-inbox-closure/browser-recheck.png'],
      },
    });
    assert.equal(actionResponse.action.status, 'requires-user-confirmation');
    assert.equal(actionResponse.result?.id, 'repair-result-runner');
    const actionCall = calls.find((call) => call.url.includes('/api/sciforge/feedback/issues/feedback-1/repair-actions'));
    assert.ok(actionCall?.init?.body);
    const actionBody = JSON.parse(String(actionCall.init.body)) as { action: string; browserVerification?: { evidenceRefs?: string[] } };
    assert.equal(actionBody.action, 'browser-recheck');
    assert.deepEqual(actionBody.browserVerification?.evidenceRefs, ['docs/test-artifacts/feedback-inbox-closure/browser-recheck.png']);

    const guidanceResponse = await sendFeedbackRepairGuidance(config, 'feedback-1', {
      repairRunId: 'repair-run-1',
      repairResultId: 'repair-result-runner',
      terminalMirrorRef: '.sciforge/repair-results/repair-run-1/terminal-mirror.ndjson',
      message: 'Try the smaller scoped fix.',
    });
    assert.equal(guidanceResponse.guidance.status, 'recorded');
    assert.equal(guidanceResponse.guidance.message, 'Try the smaller scoped fix.');

    const ptyStart = await startFeedbackCodexPtyTerminal(config, 'feedback-1', {
      initialMessage: 'Inspect the selected target before changing code.',
      cols: 120,
      rows: 30,
    });
    assert.equal(ptyStart.session.transport, 'websocket-pty');
    assert.equal(ptyStart.repairRun?.metadata?.terminalTransport, 'websocket-pty');
    assert.equal(
      feedbackCodexPtyWebSocketUrl(config, ptyStart.session),
      'ws://127.0.0.1:5174/api/sciforge/feedback/codex-pty/codex-pty-terminal-feedback-1/ws?workspacePath=%2Ftmp%2Fws',
    );
    const ptyStop = await stopFeedbackCodexPtyTerminal(config, ptyStart.session.id);
    assert.equal(ptyStop.status, 'cancelled');

    const uploadResponse = await uploadFeedbackEvidenceAssets(config, 'feedback-1', {
      repo: 'org/repo',
      token: 'github_pat_test',
    });
    assert.equal(uploadResponse.issueId, 'feedback-1');
    assert.equal(uploadResponse.uploadedAssets[0].uploadStatus, 'uploaded');

    const evidence = await saveFeedbackCommentEvidenceBundle(config, {
      id: 'feedback-1',
      schemaVersion: 1,
      authorId: 'user',
      authorName: 'User',
      comment: 'Persist me',
      status: 'open',
      priority: 'normal',
      tags: [],
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
      target: { selector: '#x', path: '#x', text: 'x', tagName: 'button', rect: { x: 0, y: 0, width: 1, height: 1 } },
      viewport: { width: 1, height: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      runtime: { page: 'feedback', url: 'http://127.0.0.1:5173/feedback', scenarioId: 'scenario' },
    });
    assert.equal(evidence.id, 'feedback-1');
    assert.equal(evidence.evidenceAssets?.[0]?.kind, 'scrubbed-annotated-screenshot');

    assert.equal(calls.length, 12);
    assert.equal(JSON.parse(String(calls[3].init?.body)).workspacePath, '/tmp/ws');
    assert.deepEqual(JSON.parse(String(calls[4].init?.body)).result, { verdict: 'fixed', summary: 'done' });
    const runnerBody = JSON.parse(String(calls[5].init?.body));
    assert.equal(runnerBody.contract.executorBackend, 'runtime-codex');
    assert.equal(runnerBody.contract.allowOpenAiRuntime, false);
    assert.equal(runnerBody.contract.initialGuidance, 'Keep the thread visible while opening a new chat.');
    assert.deepEqual(runnerBody.contract.confirmationPolicy, { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' });
    assert.deepEqual(JSON.parse(String(calls[6].init?.body)), {
      workspacePath: '/tmp/ws',
      action: 'browser-recheck',
      resultId: 'repair-result-runner',
      browserVerification: {
        status: 'passed',
        verifier: 'codex-in-app-browser',
        conclusion: 'Original issue no longer reproduces.',
        evidenceRefs: ['docs/test-artifacts/feedback-inbox-closure/browser-recheck.png'],
      },
    });
    assert.deepEqual(JSON.parse(String(calls[7].init?.body)), {
      workspacePath: '/tmp/ws',
      repairRunId: 'repair-run-1',
      repairResultId: 'repair-result-runner',
      message: 'Try the smaller scoped fix.',
      terminalMirrorRef: '.sciforge/repair-results/repair-run-1/terminal-mirror.ndjson',
      requestedBy: 'feedback-inbox',
    });
    assert.deepEqual(JSON.parse(String(calls[8].init?.body)), {
      workspacePath: '/tmp/ws',
      initialMessage: 'Inspect the selected target before changing code.',
      allowOpenAiRuntime: false,
      gitMode: 'manual',
      launchSurface: 'system-terminal',
      cols: 120,
      rows: 30,
    });
    assert.deepEqual(JSON.parse(String(calls[9].init?.body)), {
      workspacePath: '/tmp/ws',
      reason: 'feedback inbox PTY stop button',
    });
    assert.deepEqual(JSON.parse(String(calls[10].init?.body)), {
      workspacePath: '/tmp/ws',
      repo: 'org/repo',
      token: 'github_pat_test',
      requestedBy: 'feedback-inbox',
    });
    assert.equal(JSON.parse(String(calls[11].init?.body)).comment.id, 'feedback-1');
  });
});

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    workspacePath: '/tmp/ws',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function runtimeProviderPreflightManifest() {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-07T00:06:00.000Z',
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
    checkedHealthz: {
      category: 'ready',
      ok: true,
      retryable: false,
      httpStatus: 200,
      releaseAcceptance: 'not-evaluated',
    },
    nextActions: [
      {
        label: 'Rerun provider preflight.',
        command: 'npm run smoke:runtime-provider-preflight',
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
    releaseBlocking: true,
    expectedRetestCommand: 'npm run smoke:runtime-codex-browser-acceptance:strict',
    nextActions: [{
      label: 'Set Runtime Codex service env and rerun strict browser acceptance.',
      command: 'npm run smoke:runtime-codex-browser-acceptance:strict',
      writesRepo: true,
    }],
  };
}

function directCodexTerminalSession(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'direct-codex-terminal-feedback-1',
    issueId: 'feedback-1',
    repairRunId: 'direct-codex-terminal-feedback-1',
    status: 'running',
    workspacePath: '/tmp/ws',
    terminalMirrorRef: '/tmp/ws/.sciforge/repair-results/direct-codex-terminal-feedback-1/terminal-mirror.ndjson',
    promptRef: '/tmp/ws/.sciforge/repair-results/direct-codex-terminal-feedback-1/feedback-codex-prompt.md',
    startedAt: '2026-05-07T00:06:00.000Z',
    updatedAt: '2026-05-07T00:06:01.000Z',
    transport: 'websocket-pty',
    ...overrides,
  };
}
