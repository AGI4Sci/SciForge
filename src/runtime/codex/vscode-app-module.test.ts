import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createComputerUseAppModuleRegistry } from './computer-use-app-module-registry.js';
import { createVSCodeAppModule } from './vscode-app-module.js';
import {
  verifyVSCodeFocusedEditorEvidence,
  verifyVSCodeMutationEvidence,
  verifyVSCodeSameFileEvidence,
} from './vscode-app-verifiers.js';

interface VSCodeTestObservation {
  refs: string[];
  invalidRefs: string[];
  identityRefs: string[];
  titleRefs: string[];
  windowRefs: string[];
  currentObservationRefs: string[];
  staleObservationRefs: string[];
  fileRefs: string[];
  selectedFileRefs: string[];
  editorRefs: string[];
  activeEditorRefs: string[];
  editorGroupRefs: string[];
  cursorRefs: string[];
  selectionRefs: string[];
  workspaceRefs: string[];
  problemsPanelRefs: string[];
  terminalRefs: string[];
  commandPaletteRefs: string[];
  unknownWebviewRefs: string[];
  reasonRefs: string[];
  evidenceRefs: string[];
  safeSummary: {
    identity: string;
    freshness: string;
    concepts: string[];
  };
}

function createHostStructuredVSCodeAppModule() {
  const vscode = createVSCodeAppModule();
  return {
    ...vscode,
    checkReadiness: (input: Parameters<typeof vscode.checkReadiness>[0]) => vscode.checkReadiness({
      operationRef: `operation-ref:vscode:${input.operation}:test`,
      ...input,
      refs: [
        'text:title:vscode:test',
        ...input.refs,
      ],
    }),
  };
}

function normalizeVSCodeTestObservation(refs: string[]): VSCodeTestObservation {
  return createHostStructuredVSCodeAppModule().normalizeObservation({ refs }) as VSCodeTestObservation;
}

test('VSCode app module runtime exports only the module factory', async () => {
  const runtimeExports = await import('./vscode-app-module.js');

  assert.deepEqual(Object.keys(runtimeExports).sort(), ['createVSCodeAppModule']);
});

test('VSCode module object exposes only the Host app module contract methods plus moduleId', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  assert.deepEqual(Object.keys(vscode).sort(), [
    'canHandle',
    'checkReadiness',
    'getCapabilities',
    'moduleId',
    'normalizeObservation',
  ]);
});

test('VSCode module registers through Host-side app module registry', () => {
  const vscode = createHostStructuredVSCodeAppModule();
  const registry = createComputerUseAppModuleRegistry([vscode]);

  const match = registry.resolve({
    refs: ['macos-app:vscode', 'process:vscode:1', 'window:vscode:main', 'frontmost:vscode:main'],
  });

  assert.equal(match.status, 'ready');
  assert.equal(match.module.moduleId, 'vscode');
});

test('normalizes VSCode observation refs into stable concepts without raw payloads', () => {
  const observation = normalizeVSCodeTestObservation([
    'window:vscode:main',
    'macos-app:vscode',
    'process:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'freshness:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:editor:monaco:1',
    'element:vscode:terminal:1',
    'element:vscode:webview:opaque-panel:1',
    'raw-path:/Users/example/paper.tex',
  ]);

  assert.deepEqual(observation.identityRefs, [
    'macos-app:vscode',
    'process:vscode:main',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
  ]);
  assert.deepEqual(observation.windowRefs, ['window:vscode:main']);
  assert.deepEqual(observation.currentObservationRefs, ['observation:vscode:main:1']);
  assert.deepEqual(observation.fileRefs, ['file-ref:vscode:current:paper']);
  assert.deepEqual(observation.selectedFileRefs, ['file-ref:vscode:current:paper']);
  assert.deepEqual(observation.editorRefs, ['element:vscode:editor:monaco:1']);
  assert.deepEqual(observation.terminalRefs, ['element:vscode:terminal:1']);
  assert.deepEqual(observation.unknownWebviewRefs, ['element:vscode:webview:opaque-panel:1']);
  assert.deepEqual(observation.invalidRefs, ['blocked:vscode-app-module:raw-ref-not-allowed']);
  assert.ok(observation.reasonRefs.includes('blocked:vscode-app-module:raw-ref-not-allowed'));
  assert.ok(!JSON.stringify(observation).includes('/Users/example/paper.tex'));
  assert.deepEqual(observation.safeSummary, {
    identity: 'vscode-window-identity:ready',
    freshness: 'vscode-observation:fresh',
    concepts: [
      'file',
      'editor',
      'terminal',
      'unknown-webview',
    ],
  });
});

test('VSCode readiness requires a Host structured operation ref instead of natural language task text', () => {
  const vscode = createVSCodeAppModule();
  const refs = [
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:1',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:editor:monaco:1',
    'freshness:vscode:main:1',
    'message:please read visible text',
    'commandText:read visible text',
  ];

  const missingOperationRef = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs,
  });

  assert.equal(missingOperationRef.status, 'blocked');
  assert.equal(missingOperationRef.reasonRef, 'blocked:vscode-app-module:operation-ref-required');

  const ready = vscode.checkReadiness({
    operation: 'read-visible-text',
    operationRef: 'operation-ref:vscode:read-visible-text:test',
    refs,
  });

  assert.equal(ready.status, 'ready');
  assert.ok(ready.evidenceRefs.includes('operation-ref:vscode:read-visible-text:test'));
  assert.doesNotMatch(JSON.stringify(ready), /please read visible text|commandText|message:/i);
});

test('VSCode readiness requires complete app process window title and frontmost identity refs', () => {
  const vscode = createVSCodeAppModule();
  const baseRefs = [
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:1',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:editor:monaco:1',
    'freshness:vscode:main:1',
  ];

  for (const missing of ['macos-app:', 'process:', 'window:', 'text:title:', 'frontmost:']) {
    const readiness = vscode.checkReadiness({
      operation: 'read-visible-text',
      operationRef: 'operation-ref:vscode:read-visible-text:test',
      refs: baseRefs.filter((ref) => !ref.startsWith(missing)),
    });

    assert.equal(readiness.status, 'blocked', missing);
    assert.equal(readiness.reasonRef, 'blocked:vscode-app-module:window-identity-refs-required', missing);
    assert.doesNotMatch(JSON.stringify(readiness), /paper\.tex|\/Users\/|https?:\/\//i);
  }
});

test('VSCode normalization and readiness reject stale or missing current observations', () => {
  const vscode = createVSCodeAppModule();
  const staleRefs = [
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:1',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'stale-invalidation:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:editor:monaco:1',
    'freshness:vscode:main:1',
  ];
  const observation = vscode.normalizeObservation({ refs: staleRefs }) as VSCodeTestObservation;

  assert.deepEqual(observation.currentObservationRefs, ['observation:vscode:main:1']);
  assert.deepEqual(observation.staleObservationRefs, ['stale-invalidation:vscode:main:1']);
  assert.equal(observation.safeSummary.freshness, 'vscode-observation:stale');

  const stale = vscode.checkReadiness({
    operation: 'read-visible-text',
    operationRef: 'operation-ref:vscode:read-visible-text:test',
    refs: staleRefs,
  });
  assert.equal(stale.status, 'blocked');
  assert.equal(stale.reasonRef, 'blocked:vscode-app-module:stale-observation');

  const missingCurrent = vscode.checkReadiness({
    operation: 'read-visible-text',
    operationRef: 'operation-ref:vscode:read-visible-text:test',
    refs: staleRefs.filter((ref) => !ref.startsWith('observation:vscode:') && !ref.startsWith('stale-invalidation:')),
  });
  assert.equal(missingCurrent.status, 'blocked');
  assert.equal(missingCurrent.reasonRef, 'blocked:vscode-app-module:fresh-observation-required');
});

test('VSCode normalization maps editor workspace panel and selection concepts to stable refs', () => {
  const observation = normalizeVSCodeTestObservation([
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:main',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'freshness:vscode:main:1',
    'workspace-ref:vscode:primary',
    'editor-group:vscode:main:1',
    'active-editor:vscode:main:1',
    'element:vscode:editor:monaco:1',
    'cursor-ref:vscode:main:1',
    'selection-ref:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:problems:panel',
    'terminal:vscode:main',
    'command-palette:vscode:main',
    'element:vscode:webview:opaque-webview',
  ]);

  assert.deepEqual(observation.workspaceRefs, ['workspace-ref:vscode:primary']);
  assert.deepEqual(observation.editorGroupRefs, ['editor-group:vscode:main:1']);
  assert.deepEqual(observation.activeEditorRefs, ['active-editor:vscode:main:1']);
  assert.deepEqual(observation.cursorRefs, ['cursor-ref:vscode:main:1']);
  assert.deepEqual(observation.selectionRefs, ['selection-ref:vscode:main:1']);
  assert.deepEqual(observation.selectedFileRefs, ['file-ref:vscode:current:paper']);
  assert.deepEqual(observation.problemsPanelRefs, ['element:vscode:problems:panel']);
  assert.deepEqual(observation.terminalRefs, ['terminal:vscode:main']);
  assert.deepEqual(observation.commandPaletteRefs, ['command-palette:vscode:main']);
  assert.deepEqual(observation.unknownWebviewRefs, ['element:vscode:webview:opaque-webview']);
  assert.deepEqual(observation.reasonRefs, []);
  assert.ok(observation.evidenceRefs.includes('concept:vscode:editor'));
  assert.ok(observation.evidenceRefs.includes('concept:vscode:workspace'));
  assert.ok(observation.evidenceRefs.includes('concept:vscode:unknown-webview'));
  assert.deepEqual(observation.safeSummary.concepts, [
    'workspace',
    'file',
    'editor',
    'editor-group',
    'active-editor',
    'selection',
    'cursor',
    'terminal',
    'command-palette',
    'problems-panel',
    'unknown-webview',
  ]);
});

test('VSCode normalization and readiness never expose raw visible text path url provider payload or base64', () => {
  const vscode = createVSCodeAppModule();
  const rawRefs = [
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:main',
    'window:vscode:main',
    'text:title:vscode:main',
    'frontmost:vscode:main',
    'observation:vscode:main:1',
    'freshness:vscode:main:1',
    'file-ref:vscode:current:paper',
    'element:vscode:editor:monaco:1',
    'raw-visible-text:SECRET PAPER BODY',
    'raw-path:/Users/example/private-paper.md',
    '/Users/example/private-paper.md',
    'https://example.invalid/private',
    'providerPayload:SECRET_PROVIDER_PAYLOAD',
    'text:vscode:visible:SECRET_EDITOR_TEXT',
    'file-ref:vscode:current:/Users/example/private-paper.md',
    `image:vscode:base64:${'A'.repeat(96)}`,
    `image:vscode:${'A'.repeat(96)}`,
  ];

  const observation = vscode.normalizeObservation({ refs: rawRefs });
  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    operationRef: 'operation-ref:vscode:read-visible-text:test',
    refs: rawRefs,
  });
  const serialized = JSON.stringify({ observation, readiness });

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonRef, 'blocked:vscode-app-module:raw-ref-not-allowed');
  assert.doesNotMatch(serialized, /SECRET|\/Users\/example|example\.invalid|providerPayload|base64|raw-visible-text|raw-path|A{64}/i);
});

test('readiness fails closed when VSCode refs mix tokenized refs with raw payloads', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'window:vscode:main',
      'macos-app:vscode',
      'observation:vscode:main:1',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
      'raw-title:paper.tex - Visual Studio Code',
    ],
  });

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonRef, 'blocked:vscode-app-module:raw-ref-not-allowed');
});

test('readiness asks for confirmation when multiple VSCode windows remain possible', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'window:vscode:one',
      'window:vscode:two',
      'macos-app:vscode',
      'observation:vscode:one:1',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:one:1',
    ],
  });

  assert.equal(readiness.status, 'needs-confirmation');
  assert.equal(readiness.reasonRef, 'needs-confirmation:vscode-app-module:target-window-ambiguous');
});

test('unknown VSCode webview does not satisfy editor or terminal readiness', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'window:vscode:main',
      'macos-app:vscode',
      'observation:vscode:main:1',
      'element:vscode:webview:copilot:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonRef, 'blocked:vscode-app-module:editor-ref-required');
});

test('read-visible-text readiness requires session, window identity, file, editor and freshness refs', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.primitive.name, 'computer_use.observe');
  assert.ok(readiness.primitive.inputRefs.includes('window-action-session:vscode:1'));
  assert.ok(readiness.primitive.inputRefs.includes('file-ref:vscode:current:paper'));
});

test('read-visible-text readiness blocks stale or sessionless observations', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonRef, 'blocked:vscode-app-module:active-session-ref-required');
});

test('read-visible-text readiness asks for confirmation when visible file refs are not unique', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-visible-text',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'file-ref:vscode:current:notes',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'needs-confirmation');
  assert.equal(readiness.reasonRef, 'needs-confirmation:vscode-app-module:target-file-ambiguous');
});

test('read-diagnostics readiness is refs-only and does not require editor focus', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'read-diagnostics',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'diagnostics:vscode:problems:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.primitive.name, 'computer_use.observe');
  assert.ok(readiness.primitive.inputRefs.includes('diagnostics:vscode:problems:1'));
});

test('focus-editor readiness returns one Host-selected act primitive without completion truth', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'focus-editor',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.primitive.name, 'computer_use.act');
  assert.deepEqual(readiness.primitive.action, {
    kind: 'key',
    key: 'Meta+1',
  });
  assert.equal(Object.hasOwn(readiness, 'completionTruth'), false);
});

test('focused-editor verifier requires action and after-observe evidence, not editorVisible alone', () => {
  const blocked = verifyVSCodeFocusedEditorEvidence({
    refs: [
      'window-action-session:vscode:1',
      'window:vscode:main',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:after',
    ],
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonRef, 'blocked:vscode-app-module:focus-action-ref-required');

  const verified = verifyVSCodeFocusedEditorEvidence({
    refs: [
      'window-action-session:vscode:1',
      'window:vscode:main',
      'action:vscode:focus-editor:1',
      'observation:vscode:main:after',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:after',
    ],
  });

  assert.equal(verified.status, 'ready');
  assert.ok(verified.evidenceRefs.some((ref) => ref.startsWith('focused-editor:vscode:module:')));
  assert.ok(verified.evidenceRefs.some((ref) => ref.startsWith('verifier:vscode-app-module:focus-editor:')));
});

test('same-file verifier blocks when before and after file refs drift', () => {
  const drifted = verifyVSCodeSameFileEvidence({
    beforeRefs: ['file-ref:vscode:current:paper'],
    afterRefs: ['file-ref:vscode:current:notes'],
  });

  assert.equal(drifted.status, 'blocked');
  assert.equal(drifted.reasonRef, 'blocked:vscode-app-module:file-ref-drift');

  const stable = verifyVSCodeSameFileEvidence({
    beforeRefs: ['file-ref:vscode:current:paper'],
    afterRefs: ['file-ref:vscode:current:paper'],
  });

  assert.equal(stable.status, 'ready');
  assert.deepEqual(stable.evidenceRefs, [
    'file-ref:vscode:current:paper',
    'verifier:vscode-app-module:same-file:file-ref-vscode-current-paper',
  ]);
});

test('insert-draft readiness requires focused-editor evidence and text-ref content', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const missingFocus = vscode.checkReadiness({
    operation: 'insert-draft',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'text-ref:vscode:draft:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(missingFocus.status, 'blocked');
  assert.equal(missingFocus.reasonRef, 'blocked:vscode-app-module:focused-editor-ref-required');

  const ready = vscode.checkReadiness({
    operation: 'insert-draft',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'focused-editor:vscode:module:main',
      'text-ref:vscode:draft:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.primitive.name, 'computer_use.act');
  assert.deepEqual(ready.primitive.action, {
    kind: 'type',
    textRef: 'text-ref:vscode:draft:1',
  });
});

test('replace-selection readiness requires selection-ref and replacement text-ref', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'replace-selection',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'focused-editor:vscode:module:main',
      'selection-ref:vscode:current:1',
      'text-ref:vscode:replacement:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'ready');
  assert.deepEqual(readiness.primitive.action, {
    kind: 'type',
    textRef: 'text-ref:vscode:replacement:1',
    replaceSelectionRef: 'selection-ref:vscode:current:1',
  });
});

test('save-current-file readiness does not require confirmation but binds current file evidence', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const readiness = vscode.checkReadiness({
    operation: 'save-current-file',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'file-ref:vscode:current:paper',
      'element:vscode:editor:monaco:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.primitive.name, 'computer_use.act');
  assert.deepEqual(readiness.primitive.action, {
    kind: 'key',
    key: 'Meta+S',
  });
});

test('mutation verifier requires action evidence and same-file before/after refs', () => {
  const blocked = verifyVSCodeMutationEvidence({
    beforeRefs: ['file-ref:vscode:current:paper'],
    actionRefs: [],
    afterRefs: ['file-ref:vscode:current:paper', 'text:vscode:after:1'],
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonRef, 'blocked:vscode-app-module:mutation-action-ref-required');

  const verified = verifyVSCodeMutationEvidence({
    beforeRefs: ['file-ref:vscode:current:paper'],
    actionRefs: ['action:vscode:insert-draft:1'],
    afterRefs: ['file-ref:vscode:current:paper', 'text:vscode:after:1'],
  });

  assert.equal(verified.status, 'ready');
  assert.ok(verified.evidenceRefs.includes('verifier:vscode-app-module:mutation:file-ref-vscode-current-paper'));
});

test('terminal readiness is refs-first and keeps send separate from submit', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const focus = vscode.checkReadiness({
    operation: 'focus-terminal',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(focus.status, 'ready');
  assert.deepEqual(focus.primitive.action, {
    kind: 'key',
    key: 'Control+Backquote',
  });

  const send = vscode.checkReadiness({
    operation: 'send-terminal-text',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'text-ref:vscode:terminal-input:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(send.status, 'ready');
  assert.deepEqual(send.primitive.action, {
    kind: 'type',
    textRef: 'text-ref:vscode:terminal-input:1',
  });

  const submit = vscode.checkReadiness({
    operation: 'submit-terminal-command',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(submit.status, 'ready');
  assert.deepEqual(submit.primitive.action, {
    kind: 'key',
    key: 'Enter',
  });

  const focusEditor = vscode.checkReadiness({
    operation: 'focus-editor-from-terminal',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(focusEditor.status, 'ready');
  assert.deepEqual(focusEditor.primitive.action, {
    kind: 'key',
    key: 'Meta+1',
  });
});

test('terminal readiness fails closed for multiple terminals or raw shell commands', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const multiple = vscode.checkReadiness({
    operation: 'send-terminal-text',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'element:vscode:terminal:2',
      'text-ref:vscode:terminal-input:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(multiple.status, 'needs-confirmation');
  assert.equal(multiple.reasonRef, 'needs-confirmation:vscode-app-module:target-terminal-ambiguous');

  const raw = vscode.checkReadiness({
    operation: 'send-terminal-text',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'element:vscode:terminal:1',
      'raw-command:npm test',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(raw.status, 'blocked');
  assert.equal(raw.reasonRef, 'blocked:vscode-app-module:raw-ref-not-allowed');
});

test('command palette readiness is split into open query observe select close steps', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const open = vscode.checkReadiness({
    operation: 'open-command-palette',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(open.status, 'ready');
  assert.deepEqual(open.primitive.action, {
    kind: 'key',
    key: 'Meta+Shift+P',
  });

  const query = vscode.checkReadiness({
    operation: 'send-command-palette-query',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'command-palette:vscode:main',
      'text-ref:vscode:palette-query:1',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(query.status, 'ready');
  assert.deepEqual(query.primitive.action, {
    kind: 'type',
    textRef: 'text-ref:vscode:palette-query:1',
  });

  const select = vscode.checkReadiness({
    operation: 'select-command-palette-item',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'command-palette:vscode:main',
      'command-palette-item:vscode:main:workbench-action-files-save',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(select.status, 'ready');
  assert.deepEqual(select.primitive.action, {
    kind: 'key',
    key: 'Enter',
    itemRef: 'command-palette-item:vscode:main:workbench-action-files-save',
  });
});

test('command palette readiness rejects raw command ids and stale item refs', () => {
  const vscode = createHostStructuredVSCodeAppModule();

  const raw = vscode.checkReadiness({
    operation: 'select-command-palette-item',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'command-palette:vscode:main',
      'raw-command:workbench.action.files.save',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(raw.status, 'blocked');
  assert.equal(raw.reasonRef, 'blocked:vscode-app-module:raw-ref-not-allowed');

  const stale = vscode.checkReadiness({
    operation: 'select-command-palette-item',
    refs: [
      'window-action-session:vscode:1',
      'macos-app:vscode',
      'process:vscode:1',
      'window:vscode:main',
      'frontmost:vscode:main',
      'observation:vscode:main:1',
      'command-palette:vscode:main',
      'command-palette-item:vscode:stale:workbench-action-files-save',
      'freshness:vscode:main:1',
    ],
  });

  assert.equal(stale.status, 'blocked');
  assert.equal(stale.reasonRef, 'blocked:vscode-app-module:current-palette-item-ref-required');
});
