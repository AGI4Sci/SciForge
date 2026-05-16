import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildConversationReferenceDigests,
} from './conversation-reference-digest.js';

test('markdown reference digest surfaces representative bullets before heading inventory', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-reference-digest-'));
  const filePath = join(workspaceRoot, 'report.md');
  writeFileSync(filePath, [
    '# RCG-004 Preflight Patch Report',
    '',
    '## Patch Summary',
    '',
    '- generatedTaskPayloadPreflightForTaskInput now preserves each issue id, kind, and clipped evidence.',
    '- Existing fields severity, path, reason, sourceRef, and recoverActions remain unchanged.',
    '',
    '## Remaining Risks',
    '',
    '- The selected-file direct-context follow-up must not fall back to generic satisfied text.',
  ].join('\n'));

  const [digest] = buildConversationReferenceDigests({
    references: ['file:report.md'],
    workspaceRoot,
  });

  assert.ok(digest);
  const representativeIndex = digest.digestText.indexOf('Representative bullets:');
  const headingIndex = digest.digestText.indexOf('Headings:');
  assert.notEqual(representativeIndex, -1);
  assert.notEqual(headingIndex, -1);
  assert.equal(representativeIndex < headingIndex, true);
  assert.match(digest.digestText, /preserves each issue id, kind, and clipped evidence/);
  assert.match(digest.digestText, /selected-file direct-context follow-up/);
});

test('reference digest distinguishes explicit refs from prompt-discovered filenames', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-reference-discovery-'));
  writeFileSync(join(workspaceRoot, 'PROJECT.md'), '# Project\n');
  writeFileSync(join(workspaceRoot, 'report.md'), '# Report\n');

  const promptOnly = buildConversationReferenceDigests({
    prompt: 'Do not edit PROJECT.md. Summarize the selected report only.',
    workspaceRoot,
  });
  assert.equal(promptOnly[0]?.sourceRef, 'PROJECT.md');
  assert.equal(promptOnly[0]?.audit.refDiscoverySource, 'prompt-discovered-reference');

  const explicit = buildConversationReferenceDigests({
    references: [{ kind: 'file', ref: 'file:report.md' }],
    prompt: 'Summarize the current report.',
    workspaceRoot,
  });
  assert.equal(explicit[0]?.sourceRef, 'report.md');
  assert.equal(explicit[0]?.audit.refDiscoverySource, 'explicit-reference');
});
