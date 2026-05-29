import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendRepairTerminalMirrorEntry,
  parseRepairTerminalMirrorNdjson,
  scrubTerminalMirrorText,
} from './repair-handoff-terminal-mirror.js';

test('parseRepairTerminalMirrorNdjson skips malformed lines and returns bounded tails', () => {
  const text = [
    JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', stream: 'event', text: 'accepted' }),
    'not-json',
    JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', stream: 'stderr', text: 'blocked' }),
    JSON.stringify({ timestamp: '2026-01-01T00:00:02.000Z', stream: 'debug', text: 'ignored' }),
    JSON.stringify({ timestamp: '2026-01-01T00:00:03.000Z', stream: 'stdout', text: 'done' }),
    '',
  ].join('\n');

  const tail = parseRepairTerminalMirrorNdjson(text, {
    cursor: 1.9,
    limit: 1,
    terminalMirrorRef: 'terminal-mirror.ndjson',
  });

  assert.equal(tail.terminalMirrorRef, 'terminal-mirror.ndjson');
  assert.equal(tail.cursor, 1);
  assert.equal(tail.nextCursor, 2);
  assert.equal(tail.totalEntries, 3);
  assert.deepEqual(tail.entries.map((entry) => entry.text), ['blocked']);
});

test('appendRepairTerminalMirrorEntry scrubs secrets and local paths before writing ndjson', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-repair-terminal-mirror-'));
  const path = join(root, 'nested', 'terminal-mirror.ndjson');

  await appendRepairTerminalMirrorEntry(
    path,
    'stderr',
    'authorization: Bearer open-secret x-api-key: sk_secret_value_123456789012345 rawProviderBody=provider-secret /Users/alice/.codex/config.local.json',
  );

  const tail = parseRepairTerminalMirrorNdjson(await readFile(path, 'utf8'));
  assert.equal(tail.totalEntries, 1);
  assert.equal(tail.entries[0]?.stream, 'stderr');
  assert.match(tail.entries[0]?.text ?? '', /authorization: \[redacted\]/);
  assert.match(tail.entries[0]?.text ?? '', /x-api-key: \[redacted\]/);
  assert.match(tail.entries[0]?.text ?? '', /rawProviderBody: \[redacted provider body\]/);
  assert.match(tail.entries[0]?.text ?? '', /\[redacted local path\]/);
  assert.doesNotMatch(tail.entries[0]?.text ?? '', /open-secret|provider-secret|\/Users\/alice/);
});

test('scrubTerminalMirrorText truncates very large mirror entries', () => {
  assert.equal(scrubTerminalMirrorText('a'.repeat(13_000)).length, 12_000);
});
