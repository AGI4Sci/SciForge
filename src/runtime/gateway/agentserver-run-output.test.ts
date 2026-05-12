import assert from 'node:assert/strict';
import test from 'node:test';

import { looksLikeUnparsedGenerationResponseText, parseGenerationResponse } from './agentserver-run-output';

test('parses fenced generation responses and infers a single executable entrypoint', () => {
  const parsed = parseGenerationResponse([
    '```json',
    JSON.stringify({
      version: 'sciforge.agentserver-generation-response.v1',
      taskFiles: [{
        path: 'tasks/run.py',
        language: 'python',
        content: 'print("ok")',
      }],
      expectedArtifacts: ['research-report'],
    }),
    '```',
  ].join('\n'));

  assert.ok(parsed);
  assert.equal(parsed.entrypoint.path, 'tasks/run.py');
  assert.equal(parsed.entrypoint.language, 'python');
  assert.equal(parsed.taskFiles[0]?.path, 'tasks/run.py');
});

test('detects generation-looking text that should not be treated as direct answer text', () => {
  assert.equal(looksLikeUnparsedGenerationResponseText('```json\n{"taskFiles":[{"path":"tasks/run.py"'), true);
  assert.equal(looksLikeUnparsedGenerationResponseText('Here is a normal report about papers.'), false);
});
