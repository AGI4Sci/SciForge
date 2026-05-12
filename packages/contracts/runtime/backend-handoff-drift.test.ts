import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION,
  backendHandoffDriftSignals,
  classifyBackendHandoffDrift,
} from './backend-handoff-drift';

test('backend handoff drift classifies runnable taskFiles output', () => {
  const classification = classifyBackendHandoffDrift({
    parsedGeneration: true,
    raw: {
      taskFiles: [{ path: '.sciforge/tasks/task.py', language: 'python', content: 'print(1)' }],
      entrypoint: { path: '.sciforge/tasks/task.py', language: 'python' },
    },
    source: 'agentserver',
    runId: 'run-task-files',
  });

  assert.equal(classification.schemaVersion, BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION);
  assert.equal(classification.kind, 'task-files');
  assert.equal(classification.status, 'accepted');
  assert.equal(classification.shouldRetryStrictTaskFiles, false);
  assert.ok(classification.signals.includes('parsed-generation-response'));
  assert.ok(classification.signals.includes('task-files-marker'));
});

test('backend handoff drift classifies direct ToolPayload output', () => {
  const classification = classifyBackendHandoffDrift({
    parsedToolPayload: true,
    raw: {
      message: 'Done',
      claims: [],
      uiManifest: [],
      executionUnits: [],
      artifacts: [],
    },
  });

  assert.equal(classification.kind, 'direct-tool-payload');
  assert.equal(classification.status, 'accepted');
  assert.equal(classification.shouldMaterializeDiagnostic, false);
  assert.ok(classification.signals.includes('parsed-tool-payload'));
  assert.ok(classification.signals.includes('tool-payload-marker'));
});

test('backend handoff drift requests strict retry for malformed generation-looking text', () => {
  const classification = classifyBackendHandoffDrift({
    text: '```json\n{"taskFiles":[{"path":".sciforge/tasks/task.py"}], "entrypoint": {}}\n```',
  });

  assert.equal(classification.kind, 'malformed-generation-response');
  assert.equal(classification.status, 'needs-retry');
  assert.equal(classification.shouldRetryStrictTaskFiles, true);
  assert.equal(classification.recoverable, true);
});

test('backend handoff drift separates human plain text from guarded raw text', () => {
  const human = classifyBackendHandoffDrift({
    text: 'The analysis is complete. I found two issues and preserved the refs for the next step.',
    plainTextClassificationKind: 'human-answer',
  });
  assert.equal(human.kind, 'plain-text-answer');
  assert.equal(human.status, 'recovered');
  assert.equal(human.shouldMaterializeDiagnostic, false);

  const guarded = classifyBackendHandoffDrift({
    text: 'stdout\nTraceback (most recent call last):\n  File "task.py", line 2, in <module>\nException: boom',
    plainTextClassificationKind: 'runtime-log',
  });
  assert.equal(guarded.kind, 'guarded-plain-text');
  assert.equal(guarded.status, 'blocked');
  assert.equal(guarded.shouldMaterializeDiagnostic, true);
  assert.ok(backendHandoffDriftSignals({ text: guarded.message }).length);
});
