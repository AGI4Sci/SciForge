import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  listFeedbackIssues,
  loadFeedbackIssueHandoffBundle,
  loadSciForgeInstanceManifest,
  saveFeedbackIssueRepairResult,
  startFeedbackIssueRepairRun,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('workspaceClient feedback issue helpers', () => {
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

    assert.equal(calls.length, 5);
    assert.equal(JSON.parse(String(calls[3].init?.body)).workspacePath, '/tmp/ws');
    assert.deepEqual(JSON.parse(String(calls[4].init?.body)).result, { verdict: 'fixed', summary: 'done' });
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
