import assert from 'node:assert/strict';
import test from 'node:test';

import { looksLikeTruncatedAgentServerResponseText, looksLikeUnparsedGenerationResponseText, parseGenerationResponse } from './agentserver-run-output';

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

test('detects AgentServer transport-compacted output strings', () => {
  assert.equal(looksLikeTruncatedAgentServerResponseText('{"message":"ok"}'), false);
  assert.equal(
    looksLikeTruncatedAgentServerResponseText('{"message":"ok"}\n...[truncated 5799 chars for AgentServer HTTP response; full value remains in run store]'),
    true,
  );
  assert.equal(looksLikeTruncatedAgentServerResponseText('summary [truncated]'), true);
});

test('parses generation output from authoritative result and finalText fields only', () => {
  const response = {
    taskFiles: [{ path: 'tasks/from-result.py', language: 'python', content: 'print("ok")' }],
    entrypoint: { path: 'tasks/from-result.py', language: 'python' },
    expectedArtifacts: ['research-report'],
  };

  const fromResultObject = parseGenerationResponse({ result: response });
  assert.equal(fromResultObject?.entrypoint.path, 'tasks/from-result.py');

  const fromFencedFinalText = parseGenerationResponse({
    stages: [{
      result: {
        finalText: `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
      },
    }],
  });
  assert.equal(fromFencedFinalText?.entrypoint.path, 'tasks/from-result.py');

  const fromSummary = parseGenerationResponse({
    stages: [{
      result: {
        handoffSummary: `Prior attempt returned this old taskFiles JSON and should not be executed again: ${JSON.stringify(response)}`,
        outputSummary: `Prior taskFiles summary: ${JSON.stringify(response)}`,
      },
    }],
  });
  assert.equal(fromSummary, undefined);
});
