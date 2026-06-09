import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVSCodeEditorPreview,
} from './vscode-editor-preview-provider.js';

const scopeRefs = [
  'element:vscode:editor:monaco:1',
  'selected-file:vscode:paper',
  'selection-ref:vscode:paper:1',
  'cursor-ref:vscode:paper:1',
  'range-ref:vscode:paper:1',
  'freshness:vscode:paper:1',
];

test('VSCode editor preview provider returns draft and diff only as artifact refs', () => {
  const result = createVSCodeEditorPreview({
    attemptId: 'unit-preview-current-selection',
    operationRef: 'operation-ref:vscode:preview-current-selection:unit',
    scopeRefs: [
      ...scopeRefs,
      'text:vscode:visible:private-selected-text',
      'observation:vscode:paper:1',
      'window:vscode:paper',
    ],
    draftArtifactRef: 'artifact:vscode-editor-draft:unit-preview-current-selection',
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'unit-proven');
  assert.equal(result.productReady, false);
  assert.equal(Object.hasOwn(result, 'primitive'), false);
  assert.equal(Object.hasOwn(result, 'computerUsePrimitive'), false);
  assert.deepEqual(result.primitiveCandidates, []);
  assert.ok(result.artifactRefs.includes('artifact:vscode-editor-draft:unit-preview-current-selection'));
  assert.ok(result.artifactRefs.includes('artifact:vscode-editor-preview:unit-preview-current-selection'));
  assert.ok(result.artifactRefs.includes('artifact:vscode-editor-preview-diff:unit-preview-current-selection'));
  assert.ok(result.evidenceRefs.includes('selection-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('cursor-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('range-ref:vscode:paper:1'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-editor-preview:unit-preview-current-selection:refs-only'));

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-selected-text|text:vscode:visible|operation-ref:|observation:vscode|window:vscode|rawSelectedText|selectedText|rawDiff|@@|providerPayload|data:image|base64|\/Users\/|https?:\/\//i);
  assert.doesNotMatch(serialized, /computer_use|replace-selection|insert-draft|text-ref:/i);
});

test('VSCode editor preview provider blocks raw draft diff and unsafe scope refs', () => {
  for (const input of [
    {
      draftArtifactRef: 'raw draft body that must not become a preview',
      scopeRefs,
    },
    {
      draftArtifactRef: 'artifact:vscode-editor-draft:unit',
      diffArtifactRef: '@@ raw diff body',
      scopeRefs,
    },
    {
      draftArtifactRef: 'artifact:vscode-editor-draft:unit',
      scopeRefs: [
        ...scopeRefs,
        'selection-ref:vscode:raw-selected-text',
      ],
    },
  ]) {
    const result = createVSCodeEditorPreview({
      attemptId: 'unit-preview-blocked',
      operationRef: 'operation-ref:vscode:preview-current-selection:blocked',
      ...input,
    });

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.primitiveCandidates, []);
    assert.ok(result.evidenceRefs.some((ref) => ref.startsWith('blocked:vscode-editor-preview:')));
    assert.doesNotMatch(JSON.stringify(result), /raw draft body|@@ raw diff|raw-selected-text|rawSelectedText|selectedText|providerPayload|base64|https?:\/\//i);
  }
});
