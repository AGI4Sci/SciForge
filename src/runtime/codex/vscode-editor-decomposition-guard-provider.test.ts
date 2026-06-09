import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVSCodeEditorDecompositionGuard } from './vscode-editor-decomposition-guard-provider.js';

const scopeRefs = [
  'focused-editor:vscode:paper:1',
  'selected-file:vscode:paper',
  'selection-ref:vscode:paper:1',
  'cursor-ref:vscode:paper:1',
  'range-ref:vscode:paper:1',
  'freshness:vscode:paper:current',
  'observation:vscode:paper:current',
];

test('VSCode editor decomposition guard blocks non-atomic bulk operations with next-step refs only', () => {
  const result = createVSCodeEditorDecompositionGuard({
    attemptId: 'unit-bulk-decomposition',
    operation: 'bulk-replace',
    operationRef: 'operation-ref:vscode:bulk-replace:unit',
    scopeRefs: [
      ...scopeRefs,
      'text:vscode:visible:private-selected-text',
      'terminal-output:vscode:paper:current',
    ],
    nextStepRefs: [
      'next-step:vscode-editor:observe-current-scope',
      'next-step:vscode-editor:preview-current-selection',
    ],
    partialEvidenceRefs: [
      'partial-evidence:vscode-editor:bulk-request-received',
    ],
    requestedPrimitiveCount: 1,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonRef, 'blocked:vscode-editor-decomposition:host-decomposition-required');
  assert.equal(result.primitiveCandidates.length, 0);
  assert.ok(result.evidenceRefs.includes('operation-ref:vscode:bulk-replace:unit'));
  assert.ok(result.evidenceRefs.includes('decomposition:vscode-editor:single-primitive-only:unit-bulk-decomposition'));
  assert.ok(result.evidenceRefs.includes('next-step:vscode-editor:observe-current-scope'));
  assert.ok(result.evidenceRefs.includes('partial-evidence:vscode-editor:bulk-request-received'));
  assert.ok(result.scopeRefs.includes('selected-file:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(result), /computer_use\.act|run_procedure|private-selected-text|raw-path|\/Users\/|terminal-output|providerPayload|base64|completionTruth|productReady":true/i);
});

test('VSCode editor decomposition guard blocks cross-file and unsafe single-task attempts fail closed', () => {
  const crossFile = createVSCodeEditorDecompositionGuard({
    attemptId: 'unit-cross-file-decomposition',
    operation: 'cross-file-modify',
    operationRef: 'operation-ref:vscode:cross-file-modify:unit',
    scopeRefs,
    requestedPrimitiveCount: 2,
  });

  assert.equal(crossFile.status, 'blocked');
  assert.equal(crossFile.reasonRef, 'blocked:vscode-editor-decomposition:single-primitive-required');
  assert.equal(crossFile.primitiveCandidates.length, 0);
  assert.doesNotMatch(JSON.stringify(crossFile), /computer_use\.act|run_procedure|completionTruth|productReady":true/i);

  const unsupported = createVSCodeEditorDecompositionGuard({
    attemptId: 'unit-unsupported-decomposition',
    operation: 'save-current-file',
    operationRef: 'operation-ref:vscode:save-current-file:unit',
    scopeRefs,
  });

  assert.equal(unsupported.status, 'blocked');
  assert.equal(unsupported.reasonRef, 'blocked:vscode-editor-decomposition:operation-not-supported');
});
