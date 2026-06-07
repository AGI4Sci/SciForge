import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  boundedOperationResult,
  type ModuleInvokeRequest,
} from '../../packages/contracts/runtime/modules.js';
import {
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
} from '../../src/runtime/browser-host-session-types.js';
import type { BrowserHostSessionManager } from '../../src/runtime/browser-host-session.js';
import { writeRuntimeCodexBrowserOrdinaryChatAcceptance } from '../../src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.js';

test('Runtime Codex browser ordinary-chat acceptance writer uses the real browser bounded-operation handler by default', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-default-handler-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionDir = join(workspacePath, '.sciforge', 'browser-host', 'sessions', 'ordinary-chat-default', 'source-pages');
  await mkdir(sessionDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeText(join(sessionDir, 'source-default.source.json'), '{"schemaVersion":"sciforge.browser-host-session.source-page.v1","status":"read"}\n'),
    writeText(join(sessionDir, 'source-default.txt'), 'Current source text produced by BrowserHostSession manager.\n'),
  ]);

  const searchCalls: Array<{ workspacePath: string; query: string; limit: number; sourcePageLimit: number }> = [];
  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-default-handler',
    attemptId: 'codex-command-browser-ordinary-chat-default-handler-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    browserBoundedOperationPorts: {
      manager: {
        async search(managerWorkspacePath: string, input: BrowserHostSearchInput) {
          searchCalls.push({
            workspacePath: managerWorkspacePath,
            query: input.query,
            limit: input.limit ?? -1,
            sourcePageLimit: input.sourcePageLimit ?? -1,
          });
          const session: BrowserHostSearchOutput['session'] = {
            schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
            id: 'ordinary-chat-default',
            owner: 'host' as const,
            providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
            status: 'ready' as const,
            workspacePath: managerWorkspacePath,
            requestedUrl: 'https://example.test/search',
            url: 'https://example.test/search',
            title: 'Search',
            startedAt: '2026-06-07T00:00:00.000Z',
            updatedAt: '2026-06-07T00:00:00.000Z',
            viewport: { width: 1280, height: 720 },
            canGoBack: false,
            canGoForward: false,
            diagnostics: [],
          };
          const output: BrowserHostSearchOutput = {
            schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
            query: input.query,
            engine: 'bing',
            searchedAt: '2026-06-07T00:00:00.000Z',
            searchUrl: 'https://example.test/search?q=openai',
            finalUrl: 'https://example.test/search?q=openai',
            results: [{
              title: 'OpenAI product update',
              url: 'https://example.test/openai-product-update',
              snippet: 'Current source text produced by BrowserHostSession manager.',
            }],
            session,
            searchResultRef: 'browser-host-session:ordinary-chat-default/search-result.json',
            sourcePages: [{
              resultIndex: 0,
              status: 'read',
              title: 'OpenAI product update',
              url: 'https://example.test/openai-product-update',
              finalUrl: 'https://example.test/openai-product-update',
              openedAt: '2026-06-07T00:00:00.000Z',
              sourcePageRef: 'browser-host-session:ordinary-chat-default/source-pages/source-default.source.json',
              textRef: 'browser-host-session:ordinary-chat-default/source-pages/source-default.txt',
              textPreview: 'Current source text produced by BrowserHostSession manager.',
            }],
          };
          return output;
        },
        async openRead() {
          throw new Error('openRead should not be called for this search task');
        },
      } as unknown as BrowserHostSessionManager,
    },
  });

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0]?.workspacePath, workspacePath);
  assert.match(searchCalls[0]?.query ?? '', /OpenAI/);
  assert.equal(searchCalls[0]?.limit, 4);
  assert.equal(searchCalls[0]?.sourcePageLimit, 4);
  assert.equal(manifest.status, 'passed');
  const refs = [
    ...(manifest.acceptanceRubric?.evidenceRefs ?? []),
    ...(manifest.actualTaskResult?.evidenceRefs ?? []),
    ...(manifest.liveRuntimeCodexProof?.eventEvidenceRefs ?? []),
  ].join('\n');
  assert.match(refs, /module\.invoke\/browser\.search_read/);
  assert.match(refs, /browser-host-session:ordinary-chat-default\/source-pages\/source-default\.source\.json/);
  assert.match(refs, /browser-host-session:ordinary-chat-default\/source-pages\/source-default\.txt/);
});

test('Runtime Codex browser ordinary-chat acceptance writer passes only with current module.invoke BrowserHostSession source refs and final answer', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionDir = join(workspacePath, '.sciforge', 'browser-host', 'sessions', 'ordinary-chat', 'source-pages');
  await mkdir(sessionDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeText(join(outputDir, 'blocked-runtime-codex-browser-ordinary-chat.md'), 'stale blocked note');
  await Promise.all([
    writeText(join(sessionDir, 'source-1-current.source.json'), '{"schemaVersion":"sciforge.browser-host-session.source-page.v1","status":"read"}\n'),
    writeText(join(sessionDir, 'source-1-current.txt'), 'Official source text read by BrowserHostSession.\n'),
  ]);

  const calls: ModuleInvokeRequest[] = [];
  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat',
    attemptId: 'codex-command-browser-ordinary-chat-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    browserBoundedOperationInvoker: async (request) => {
      calls.push(request);
      return boundedOperationResult({
        moduleId: 'browser',
        operationKind: 'browser.search_read',
        status: 'completed',
        sourceRefs: ['browser-host-session:ordinary-chat/source-pages/source-1-current.source.json'],
        evidenceRefs: [
          'action-ledger:browser.executeBoundedOperation/codex-command-browser-ordinary-chat/module.invoke',
          'runtime-truth:module.invoke/browser.search_read/codex-command-browser-ordinary-chat',
          'browser-host-session:ordinary-chat',
          'browser-host-session:ordinary-chat/source-pages/source-1-current.source.json',
          'browser-host-session:ordinary-chat/source-pages/source-1-current.txt',
        ],
        value: {
          sourcePages: [{
            title: 'OpenAI product update',
            finalUrl: 'https://example.test/openai-product-update',
            textRef: 'browser-host-session:ordinary-chat/source-pages/source-1-current.txt',
            textPreview: 'OpenAI released a product update with details read from an official source page.',
          }],
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.moduleId, 'browser');
  assert.equal(calls[0]?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
  assert.equal(calls[0]?.input?.operationKind, 'browser.search_read');
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).requiredEvidence, ['source-page-ref', 'page-text-ref']);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.startedFromDefaultChatEntry, true);
  assert.equal(manifest.submittedThroughRuntimeCodex, true);
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, true);
  assert.equal(manifest.mainAnswerVisible, true);
  assert.equal(manifest.actualTaskResult?.status, 'passed');
  assert.equal(manifest.liveRuntimeCodexProof?.messageProvenance, 'live-runtime-codex');
  const refs = [
    ...(manifest.acceptanceRubric?.evidenceRefs ?? []),
    ...(manifest.actualTaskResult?.evidenceRefs ?? []),
    ...(manifest.liveRuntimeCodexProof?.eventEvidenceRefs ?? []),
  ].join('\n');
  assert.match(refs, /module\.invoke|executeBoundedOperation/);
  assert.match(refs, /browser\.search_read/);
  assert.match(refs, /browser-host-session:ordinary-chat/);
  assert.match(refs, /source-pages\/source-1-current\.source\.json/);
  assert.match(refs, /source-pages\/source-1-current\.txt/);
  assert.match(refs, /final-answer/);
  const persisted = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'passed');
  assert.equal(await readFile(join(outputDir, 'final-answer.md'), 'utf8').then((text) => /来源页/.test(text)), true);
  await assert.rejects(
    readFile(join(outputDir, 'blocked-runtime-codex-browser-ordinary-chat.md'), 'utf8'),
    /ENOENT/,
  );
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks when current BrowserHostSession source files are missing', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-missing-'));
  const outputDir = join(workspacePath, 'acceptance');

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: 'Search and cite current source pages.',
    commandId: 'codex-command-browser-ordinary-chat-missing',
    attemptId: 'codex-command-browser-ordinary-chat-missing-attempt-1',
    browserBoundedOperationInvoker: async () => boundedOperationResult({
      moduleId: 'browser',
      operationKind: 'browser.search_read',
      status: 'completed',
      sourceRefs: ['browser-host-session:ordinary-chat/source-pages/source-1-missing.source.json'],
      evidenceRefs: [
        'action-ledger:browser.executeBoundedOperation/codex-command-browser-ordinary-chat-missing/module.invoke',
        'runtime-truth:module.invoke/browser.search_read/codex-command-browser-ordinary-chat-missing',
        'browser-host-session:ordinary-chat',
        'browser-host-session:ordinary-chat/source-pages/source-1-missing.source.json',
        'browser-host-session:ordinary-chat/source-pages/source-1-missing.txt',
      ],
      value: {
        sourcePages: [{
          title: 'Missing source page',
          finalUrl: 'https://example.test/missing',
          textRef: 'browser-host-session:ordinary-chat/source-pages/source-1-missing.txt',
          textPreview: 'This cannot pass because the referenced files do not exist.',
        }],
      },
    }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, false);
  assert.match(manifest.reason ?? '', /missing BrowserHostSession source evidence file/i);
  const persisted = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'blocked');
});

async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path, text, 'utf8'));
}
