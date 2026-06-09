import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVSCodeEditorNarrowApply,
  verifyVSCodeEditorNarrowApply,
} from './vscode-editor-narrow-apply-provider.js';

const scopeRefs = [
  'window-action-session:vscode:1',
  'macos-app:vscode',
  'process:vscode:paper',
  'window:vscode:paper',
  'text:title:vscode:paper',
  'frontmost:vscode:paper',
  'observation:vscode:paper:before',
  'element:vscode:editor:monaco:1',
  'selected-file:vscode:paper',
  'selection-ref:vscode:paper:1',
  'cursor-ref:vscode:paper:1',
  'range-ref:vscode:paper:1',
  'freshness:vscode:paper:before',
];

test('VSCode narrow apply explicit replace-selection creates exactly one act primitive candidate', () => {
  const result = createVSCodeEditorNarrowApply({
    attemptId: 'unit-apply-current-selection',
    operationRef: 'operation-ref:vscode:apply-current-selection:unit',
    primitiveOperation: 'replace-selection',
    scopeRefs: [
      ...scopeRefs,
      'text:vscode:visible:private-selected-text',
      'terminal-output:vscode:paper:current',
      'history:vscode:previous-run',
      'action:vscode:previous:completed',
    ],
    draftTextRef: 'text-ref:vscode-draft:unit-apply-current-selection',
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'unit-proven');
  assert.equal(result.productReady, false);
  assert.equal(result.primitiveCandidates.length, 1);
  assert.equal(result.primitiveCandidates[0]?.operation, 'replace-selection');
  assert.equal(result.primitiveCandidates[0]?.primitive.name, 'computer_use.act');
  assert.deepEqual(result.primitiveCandidates[0]?.primitive.action, {
    kind: 'type',
    textRef: 'text-ref:vscode-draft:unit-apply-current-selection',
  });
  assert.ok(result.evidenceRefs.includes('selection-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('cursor-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('range-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('text-ref:vscode-draft:unit-apply-current-selection'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-editor-narrow-apply:unit-apply-current-selection:one-primitive'));

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-selected-text|text:vscode:visible|terminal-output|history:vscode|previous:completed|rawSelectedText|selectedText|providerPayload|data:image|base64|\/Users\/|https?:\/\//i);
  assert.doesNotMatch(serialized, /completionTruth|taskOutcome":"satisfied|Computer Use completed/i);
});

test('VSCode narrow apply blocks unsupported multi-primitive apply requests', () => {
  const result = createVSCodeEditorNarrowApply({
    attemptId: 'unit-apply-multi-blocked',
    operationRef: 'operation-ref:vscode:apply-current-selection:multi',
    primitiveOperation: 'replace-selection',
    scopeRefs,
    draftTextRef: 'text-ref:vscode-draft:unit-apply-multi-blocked',
    requestedPrimitiveCount: 2,
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.primitiveCandidates, []);
  assert.ok(result.evidenceRefs.includes('blocked:vscode-editor-narrow-apply:single-primitive-required'));
  assert.doesNotMatch(JSON.stringify(result), /computer_use\.run_procedure|Computer Use completed|taskOutcome/i);
});

test('VSCode narrow apply verifier requires mutation after-observe and cleanup refs, not completed action text', () => {
  const beforeRefs = [
    'window:vscode:paper',
    'observation:vscode:paper:before',
    'freshness:vscode:paper:before',
    'selected-file:vscode:paper',
    'element:vscode:editor:monaco:1',
    'selection-ref:vscode:paper:1',
  ];
  const afterRefs = [
    'window:vscode:paper',
    'observation:vscode:paper:after',
    'freshness:vscode:paper:after',
    'selected-file:vscode:paper',
    'element:vscode:editor:monaco:1',
    'selection-ref:vscode:paper:1',
    'text:vscode:after:paper',
    'computer-use:action:completed',
  ];
  const actionRefs = [
    'action:vscode:replace-selection:unit',
    'executor-event:vscode:replace-selection:unit:completed',
  ];
  const cleanupRefs = [
    'control:current-vscode-cowork:unit-apply-current-selection:release',
    'scoped-input-lease:current-vscode-cowork:unit-apply-current-selection',
    'scoped-input-adapter:current-vscode-cowork:unit-apply-current-selection',
    'cursor-marker:current-vscode-cowork:unit-apply-current-selection',
    'front-app-restore:current-vscode-cowork:unit-apply-current-selection',
    'mouse-position-restore:current-vscode-cowork:unit-apply-current-selection',
  ];

  const verified = verifyVSCodeEditorNarrowApply({
    attemptId: 'unit-apply-current-selection',
    beforeRefs,
    actionRefs,
    afterRefs,
    cleanupRefs,
  });

  assert.equal(verified.status, 'ready');
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:same-file:selected-file-vscode-paper'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:same-window:window-vscode-paper'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:same-editor:element-vscode-editor-monaco-1'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:same-selection:selection-ref-vscode-paper-1'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:after-observe:observation-vscode-paper-after'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-editor-narrow-apply:unit-apply-current-selection:cleanup-release'));
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-editor-narrow-apply:unit-apply-current-selection:verified'));
  assert.doesNotMatch(JSON.stringify(verified), /computer-use:action:completed|taskOutcome":"satisfied|Computer Use completed|providerPayload|base64|\/Users\//i);

  const missingCleanup = verifyVSCodeEditorNarrowApply({
    attemptId: 'unit-apply-current-selection',
    beforeRefs,
    actionRefs,
    afterRefs,
    cleanupRefs: cleanupRefs.filter((ref) => !ref.startsWith('mouse-position-restore:')),
  });
  assert.equal(missingCleanup.status, 'blocked');
  assert.equal(missingCleanup.reasonRef, 'blocked:vscode-editor-narrow-apply:cleanup-refs-required');
});
