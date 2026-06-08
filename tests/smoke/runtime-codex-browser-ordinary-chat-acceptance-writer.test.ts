import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { CodexAppServerClient } from '../../src/runtime/codex/codex-app-server-adapter.js';
import { writeRuntimeCodexBrowserOrdinaryChatAcceptance } from '../../src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.js';

test('Runtime Codex browser ordinary-chat acceptance writer passes only with app-server Browser evidence', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-app-server-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef);

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-app-server',
    attemptId: 'codex-command-browser-ordinary-chat-app-server-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: {
        tool: 'browser_search',
        arguments: { query: 'OpenAI changelog latest' },
        result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] },
      },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'browser_read',
        arguments: { resourceRef: 'browser:resource:web_page:openai' },
        result: { refs: [sourceRef, textRef] },
      },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-app-server'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, true);
  assert.equal(manifest.releaseEligible, true);
  assert.ok(manifest.actualTaskResult?.evidenceRefs.includes(sourceRef));
  assert.ok(manifest.actualTaskResult?.evidenceRefs.includes(textRef));
  const persisted = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'passed');
  assert.match(await readFile(join(outputDir, 'runtime-codex-browser-ordinary-chat.md'), 'utf8'), /browser_search/);
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks Browser calls that never completed', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-call-only-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef);

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-call-only',
    attemptId: 'codex-command-browser-ordinary-chat-call-only-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/call',
      params: { tool: 'browser_search', arguments: { query: 'OpenAI changelog latest' } },
    }, {
      method: 'item/tool/call',
      params: { tool: 'browser_read', arguments: { resourceRef: 'browser:resource:web_page:openai' } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-call-only'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /completed browser_search|completed browser_read/);
});

test('Runtime Codex browser ordinary-chat acceptance writer requires satisfied completionTruth on gui.present', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-truth-off-gui-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef);

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-truth-off-gui',
    attemptId: 'codex-command-browser-ordinary-chat-truth-off-gui-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: { tool: 'browser_search', result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'browser_read',
        result: {
          refs: [sourceRef, textRef],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: { refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-truth-off-gui'] },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /satisfied Browser completionTruth/);
});

test('Runtime Codex browser ordinary-chat acceptance writer ignores source refs mentioned only in unrelated text', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-unrelated-refs-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef);

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-unrelated-refs',
    attemptId: 'codex-command-browser-ordinary-chat-unrelated-refs-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: { tool: 'browser_search', result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] } },
    }, {
      method: 'item/tool/completed',
      params: { tool: 'browser_read', result: { refs: [] } },
    }, {
      method: 'diagnostic/message',
      params: { message: `debug-only refs ${sourceRef} ${textRef}` },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        result: {
          refs: ['gui.present:final-answer:codex-command-browser-ordinary-chat-unrelated-refs'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /browser_read source_page refs|browser_read page_text refs/);
});

test('Runtime Codex browser ordinary-chat acceptance writer requires completionTruth evidence refs to match Browser read refs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-mismatched-truth-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef);

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-mismatched-truth',
    attemptId: 'codex-command-browser-ordinary-chat-mismatched-truth-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: { tool: 'browser_search', result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] } },
    }, {
      method: 'item/tool/completed',
      params: { tool: 'browser_read', result: { refs: [sourceRef, textRef] } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-mismatched-truth'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: ['artifact:unrelated'],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /completionTruth evidenceRefs/);
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks search-only app-server evidence', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-search-only-'));
  const outputDir = join(workspacePath, 'acceptance');

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-search-only',
    attemptId: 'codex-command-browser-ordinary-chat-search-only-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/call',
      params: { tool: 'browser_search', arguments: { query: 'OpenAI changelog latest' } },
    }, {
      method: 'item/tool/completed',
      params: { tool: 'gui_present', result: { refs: ['gui.present:final-answer:search-only'] } },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, false);
  assert.match(manifest.reason ?? '', /missing browser_read|source_page refs|page_text refs|satisfied Browser completionTruth/);
  const persisted = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'blocked');
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks event refs without materialized source files', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-missing-files-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-missing-files',
    attemptId: 'codex-command-browser-ordinary-chat-missing-files-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/call',
      params: { tool: 'browser_search', arguments: { query: 'OpenAI changelog latest' } },
    }, {
      method: 'item/tool/call',
      params: { tool: 'browser_read', arguments: { resourceRef: 'browser:resource:web_page:openai' } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-missing-files'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /source artifact|source files|materialized/i);
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks source text hash mismatch', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-hash-mismatch-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef, { textSha1: '0'.repeat(40) });

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-hash-mismatch',
    attemptId: 'codex-command-browser-ordinary-chat-hash-mismatch-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: { tool: 'browser_search', result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] } },
    }, {
      method: 'item/tool/completed',
      params: { tool: 'browser_read', result: { refs: [sourceRef, textRef] } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-hash-mismatch'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /textSha1/i);
});

test('Runtime Codex browser ordinary-chat acceptance writer blocks stale preexisting source artifacts', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-stale-source-'));
  const outputDir = join(workspacePath, 'acceptance');
  const sessionId = 'ordinary';
  const sourceRef = 'browser-host-session:ordinary/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:ordinary/source-pages/source-1.txt';
  await writeBrowserSourceEvidence(workspacePath, sessionId, sourceRef, textRef, { openedAt: '2026-06-06T23:59:59.000Z' });

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-stale-source',
    attemptId: 'codex-command-browser-ordinary-chat-stale-source-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    appServerClient: appServerClientWithEvents([{
      method: 'item/tool/completed',
      params: { tool: 'browser_search', result: { refs: ['browser-host-session:ordinary/search/search-result-set.json'] } },
    }, {
      method: 'item/tool/completed',
      params: { tool: 'browser_read', result: { refs: [sourceRef, textRef] } },
    }, {
      method: 'item/tool/completed',
      params: {
        tool: 'gui_present',
        arguments: { displayedRefs: [sourceRef, textRef] },
        result: {
          refs: [sourceRef, textRef, 'gui.present:final-answer:codex-command-browser-ordinary-chat-stale-source'],
          completionTruth: {
            schemaVersion: 'sciforge.agent-host.completion-truth.v1',
            scope: 'user-task',
            status: 'satisfied',
            validator: 'agent-host-browser-acceptance',
            evidenceRefs: [sourceRef, textRef],
          },
        },
      },
    }]),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseEligible, false);
  assert.match(manifest.reason ?? '', /current run|openedAt/i);
});

function appServerClientWithEvents(events: unknown[]): CodexAppServerClient {
  return {
    async startTurn() {
      return {
        threadId: 'thread-browser-ordinary-chat',
        turnId: 'turn-browser-ordinary-chat',
        provider: 'test-provider',
        model: 'test-model',
        profile: 'test-profile',
        workspacePath: '/workspace',
        events: asyncIterable(events),
      };
    },
  };
}

async function* asyncIterable(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) yield event;
}

async function writeBrowserSourceEvidence(
  workspacePath: string,
  sessionId: string,
  sourceRef: string,
  textRef: string,
  options: { text?: string; textSha1?: string; openedAt?: string } = {},
) {
  const sourcePath = browserHostRefPath(workspacePath, sourceRef);
  const textPath = browserHostRefPath(workspacePath, textRef);
  await mkdir(join(workspacePath, '.sciforge', 'browser-host', 'sessions', sessionId, 'source-pages'), { recursive: true });
  const text = options.text ?? 'OpenAI changelog source page text with a current product update and source link.';
  await writeFile(textPath, text, 'utf8');
  await writeFile(sourcePath, JSON.stringify({
    schemaVersion: 'sciforge.browser-host-session.source-page.v1',
    resultIndex: 0,
    title: 'OpenAI API changelog',
    url: 'https://platform.openai.com/docs/changelog',
    finalUrl: 'https://developers.openai.com/api/docs/changelog',
    openedAt: options.openedAt ?? '2026-06-07T00:00:00.000Z',
    status: 'read',
    textRef,
    textSha1: options.textSha1 ?? sha1(text),
  }, null, 2), 'utf8');
}

function browserHostRefPath(workspacePath: string, ref: string) {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  assert.ok(match?.[1] && match[2], `invalid browser host ref: ${ref}`);
  return join(workspacePath, '.sciforge', 'browser-host', 'sessions', match[1], match[2]);
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}
