import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { BrowserHostSessionManager } from '../../src/runtime/browser-host-session.js';
import { writeRuntimeCodexBrowserOrdinaryChatAcceptance } from '../../src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.js';

test('Runtime Codex browser ordinary-chat acceptance writer is retired and fail-closed', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-retired-'));
  const outputDir = join(workspacePath, 'acceptance');
  let browserCalled = false;

  const manifest = await writeRuntimeCodexBrowserOrdinaryChatAcceptance({
    workspacePath,
    outputDir,
    commandText: '请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新。',
    commandId: 'codex-command-browser-ordinary-chat-retired',
    attemptId: 'codex-command-browser-ordinary-chat-retired-attempt-1',
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    browserRuntimeModulePorts: {
      manager: {
        async search() {
          browserCalled = true;
          throw new Error('Retired writer must not invoke BrowserHostSession search.');
        },
      } as unknown as BrowserHostSessionManager,
    },
  });

  assert.equal(browserCalled, false);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.acceptanceConclusionFromRealBrowser, false);
  assert.match(manifest.reason ?? '', /Retired: ordinary-chat Browser acceptance must flow through the unified Runtime Codex app-server \/ Model Router tool protocol/);
  const persisted = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'blocked');
});
