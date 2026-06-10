import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCurrentVSCodePreviewApplySaveTranscript,
  buildCurrentVSCodeSelectionTransformDogfoodTranscript,
  type CurrentVSCodeOperationTranscriptCandidateStep,
  type CurrentVSCodeOperationTranscriptStep,
  type CurrentVSCodeOperationTranscriptValidation,
  validateCurrentVSCodeOperationTranscript,
} from './current-vscode-operation-transcript.js';

const unsafeNeedles = /paper-polish|polish-paper|rawSelectedText|selected text|improved draft|rawDraft|rawDiff|@@|\/Users\/|https?:\/\/|providerPayload|base64|terminal output|history|completed action/i;
const requiredUiSequence = [
  'preview-current-selection',
  'apply-current-selection',
  'observe-current-vscode',
  'verify-current-selection-apply',
  'save-current-file',
  'release-current-vscode',
] as const;

test('builds refs-first preview/apply/save transcript with single primitive apply and save steps', () => {
  const transcript = buildCurrentVSCodePreviewApplySaveTranscript({
    runRef: 'operation-ref:vscode:co-work:unit',
    contextRefs: [
      'window:vscode:main',
      'observation:vscode:main:before',
      'freshness:vscode:main:before',
      'file-ref:vscode:current:paper',
      'selection-ref:vscode:main:1',
      'cursor-ref:vscode:main:1',
      'range-ref:vscode:main:1',
    ],
    draftTextRef: 'text-ref:vscode:draft:1',
    previewArtifactRef: 'artifact:vscode:preview:1',
    verifierRefs: [
      'verifier:vscode:same-window:main',
      'verifier:vscode:same-editor:main',
      'verifier:vscode:same-file:paper',
      'verifier:vscode:same-selection:1',
      'verifier:vscode:after-observe:1',
      'verifier:vscode:mutation:1',
    ],
    cleanupRefs: ['cleanup:vscode:release:1'],
  });

  assert.deepEqual(transcript.map((step) => step.operationId), [
    'observe-current-vscode',
    'read-editor-context',
    'editor-scope',
    'preview-current-selection',
    'apply-current-selection',
    'observe-current-vscode',
    'verify-current-selection-apply',
    'save-current-file',
    'release-current-vscode',
  ]);
  assert.deepEqual(transcript.filter((step) => step.operationId === 'apply-current-selection').map((step) => step.primitive), ['replace-selection']);
  assert.deepEqual(transcript.filter((step) => step.operationId === 'save-current-file').map((step) => step.primitive), ['key:Meta+S']);
  assert.equal(validateCurrentVSCodeOperationTranscript(transcript).status, 'ready');
  assert.doesNotMatch(JSON.stringify(transcript), unsafeNeedles);
});

test('mocked UI entry validates preview/apply/observe/verify/save/release without public payload leaks', () => {
  const privateSelection = 'The manuscript claims broad improvements, but this sentence needs a careful academic polish.';
  const privateDraft = 'The manuscript reports broad improvements while making the claim precise and appropriately qualified.';
  const privateDiff = '@@ private diff that must stay inside Host artifacts';
  const privateProviderPayload = 'providerPayload: hidden prompt, scores, and draft metadata';
  const transcript = buildCurrentVSCodePreviewApplySaveTranscript({
    runRef: 'operation-ref:vscode:ui-entry:unit',
    contextRefs: [
      'window:vscode:main',
      'observation:vscode:main:before',
      'freshness:vscode:main:before',
      'file-ref:vscode:current:paper',
      'selection-ref:vscode:main:1',
      'cursor-ref:vscode:main:1',
      'range-ref:vscode:main:1',
      `selected text: ${privateSelection}`,
      `rawDiff: ${privateDiff}`,
      '/Users/example/private/paper.md',
      privateProviderPayload,
    ],
    draftTextRef: 'text-ref:vscode:ui-entry-draft:1',
    previewArtifactRef: 'artifact:vscode:ui-entry-preview:1',
    verifierRefs: [
      'verifier:vscode:same-window:main',
      'verifier:vscode:same-editor:main',
      'verifier:vscode:same-file:paper',
      'verifier:vscode:same-selection:1',
      'verifier:vscode:after-observe:1',
      'verifier:vscode:mutation:1',
    ],
    cleanupRefs: ['cleanup:vscode:release:1'],
  });
  const validation = validateCurrentVSCodeOperationTranscript(transcript);
  const publicResult = mockUiPublicResult({ transcript, validation });

  assert.equal(validation.status, 'ready');
  assert.deepEqual(sequenceFromPreview(transcript), [...requiredUiSequence]);
  assert.deepEqual(transcript.filter((step) => step.operationId === 'apply-current-selection').map((step) => step.primitive), ['replace-selection']);
  assert.deepEqual(transcript.filter((step) => step.operationId === 'save-current-file').map((step) => step.primitive), ['key:Meta+S']);
  assert.equal(
    transcript.find((step) => step.operationId === 'verify-current-selection-apply')?.refs.some((ref) => ref === 'observation:vscode:main:after'),
    true,
  );
  assert.equal(
    transcript.find((step) => step.operationId === 'release-current-vscode')?.refs.includes('cleanup:vscode:release:1'),
    true,
  );
  assert.doesNotMatch(publicResult, unsafeNeedles);
  assert.equal(publicResult.includes(privateSelection), false);
  assert.equal(publicResult.includes(privateDraft), false);
  assert.equal(publicResult.includes(privateDiff), false);
  assert.equal(publicResult.includes(privateProviderPayload), false);
});

test('validator blocks mocked UI transcripts that skip the post-apply observe/verify/save/release order', () => {
  const incompleteTranscript: CurrentVSCodeOperationTranscriptCandidateStep[] = [
    {
      operationId: 'preview-current-selection',
      operationRef: 'operation-ref:vscode:preview-current-selection:unit',
      primitive: 'preview',
      refs: [
        'operation-ref:vscode:preview-current-selection:unit',
        'selection-ref:vscode:main:1',
        'text-ref:vscode:draft:1',
        'artifact:vscode:preview:1',
      ],
    },
    {
      operationId: 'apply-current-selection',
      operationRef: 'operation-ref:vscode:apply-current-selection:unit',
      primitive: 'replace-selection',
      refs: [
        'operation-ref:vscode:apply-current-selection:unit',
        'selection-ref:vscode:main:1',
        'text-ref:vscode:draft:1',
      ],
    },
    {
      operationId: 'save-current-file',
      operationRef: 'operation-ref:vscode:save-current-file:unit',
      primitive: 'key:Meta+S',
      refs: [
        'operation-ref:vscode:save-current-file:unit',
        'window:vscode:main',
        'file-ref:vscode:current:paper',
        'verifier:vscode:mutation:1',
      ],
    },
    {
      operationId: 'release-current-vscode',
      operationRef: 'operation-ref:vscode:release-current-vscode:unit',
      primitive: 'release',
      refs: [
        'operation-ref:vscode:release-current-vscode:unit',
        'cleanup:vscode:release:1',
      ],
    },
  ];

  const result = validateCurrentVSCodeOperationTranscript(incompleteTranscript);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonRefs, ['blocked:current-vscode-operation-transcript:ui-sequence-incomplete']);
});

test('paper polish dogfood transcript uses generic VSCode operations and hides provider/raw payloads', () => {
  const transcript = buildCurrentVSCodeSelectionTransformDogfoodTranscript({
    runRef: 'operation-ref:vscode:dogfood:unit',
    contextRefs: [
      'window:vscode:paper',
      'observation:vscode:paper:before',
      'freshness:vscode:paper:before',
      'file-ref:vscode:current:paper',
      'selection-ref:vscode:paper:selection',
      'cursor-ref:vscode:paper:cursor',
      'range-ref:vscode:paper:range',
      'selected text: This paragraph should never serialize.',
      'rawDiff: @@ private patch',
      '/Users/example/private/paper.md',
      'https://provider.example.invalid/payload',
      'providerPayload: secret',
      'base64:SGVsbG8=',
      'terminal output: private command result',
      'history: previous run',
      'completed action: replace selection',
    ],
    providerRefs: [
      'text-ref:vscode:polish-draft:1',
      'artifact:vscode:polish-preview:1',
      'rawDraft: improved draft should never serialize',
      'providerPayload: hidden model payload',
    ],
    verifierRefs: [
      'verifier:vscode:same-window:paper',
      'verifier:vscode:same-editor:paper',
      'verifier:vscode:same-file:paper',
      'verifier:vscode:same-selection:paper',
      'verifier:vscode:after-observe:paper',
      'verifier:vscode:mutation:paper',
    ],
    cleanupRefs: ['cleanup:vscode:release:paper'],
  });

  const publicResult = JSON.stringify(transcript);

  assert.equal(validateCurrentVSCodeOperationTranscript(transcript).status, 'ready');
  assert.doesNotMatch(publicResult, unsafeNeedles);
  assert.equal(transcript.some((step) => step.operationId.includes('paper')), false);
  assert.equal(transcript.some((step) => step.operationId === 'apply-current-selection' && step.primitive === 'replace-selection'), true);
  assert.equal(transcript.some((step) => step.operationId === 'save-current-file' && step.primitive === 'key:Meta+S'), true);
});

test('paper-like polish provider consumes and returns only Host-owned refs before the generic VSCode transcript is public', () => {
  const privateOriginalText = 'Our experiments demonstrate that the proposed framework is better in many situations without explaining the boundary conditions.';
  const privateRawDraft = 'Our experiments indicate that the proposed framework improves performance under the evaluated boundary conditions.';
  const privateRawDiff = '@@ private paper polish diff';
  const providerPayload = 'providerPayload: private model request and response envelope';
  const providerInvocation = mockHostPolishProvider({
    inputRefs: [
      'text-ref:host:vscode-selection:paper-like:1',
      'artifact:host:vscode-context:paper-like:1',
    ],
    privateOriginalText,
    privateRawDraft,
    privateRawDiff,
    providerPayload,
  });

  const transcript = buildCurrentVSCodeSelectionTransformDogfoodTranscript({
    runRef: 'operation-ref:vscode:dogfood:paper-like',
    contextRefs: [
      'window:vscode:paper-like',
      'observation:vscode:paper-like:before',
      'freshness:vscode:paper-like:before',
      'file-ref:vscode:current:paper-like',
      'selection-ref:vscode:paper-like:selection',
      'cursor-ref:vscode:paper-like:cursor',
      'range-ref:vscode:paper-like:range',
      `selected text: ${privateOriginalText}`,
      `rawDiff: ${privateRawDiff}`,
      providerPayload,
    ],
    providerRefs: providerInvocation.outputRefs,
    verifierRefs: [
      'verifier:vscode:same-window:paper-like',
      'verifier:vscode:same-editor:paper-like',
      'verifier:vscode:same-file:paper-like',
      'verifier:vscode:same-selection:paper-like',
      'verifier:vscode:after-observe:paper-like',
      'verifier:vscode:mutation:paper-like',
    ],
    cleanupRefs: ['cleanup:vscode:release:paper-like'],
  });
  const validation = validateCurrentVSCodeOperationTranscript(transcript);
  const publicResult = mockUiPublicResult({
    transcript,
    validation,
    providerInputRefs: providerInvocation.inputRefs,
    providerOutputRefs: providerInvocation.outputRefs,
  });

  assertOnlyHostProviderRefs(providerInvocation.inputRefs);
  assertOnlyHostProviderRefs(providerInvocation.outputRefs);
  assert.equal(validation.status, 'ready');
  assert.deepEqual(sequenceFromPreview(transcript), [...requiredUiSequence]);
  assert.equal(transcript.some((step) => step.operationId.includes('paper')), false);
  assert.doesNotMatch(publicResult, unsafeNeedles);
  assert.equal(publicResult.includes(privateOriginalText), false);
  assert.equal(publicResult.includes(privateRawDraft), false);
  assert.equal(publicResult.includes(privateRawDiff), false);
  assert.equal(publicResult.includes(providerPayload), false);
});

test('validator rejects transcripts containing non-ref payloads or non-generic operation ids', () => {
  const result = validateCurrentVSCodeOperationTranscript([
    {
      operationId: 'paper-polish',
      refs: [
        'operation-ref:vscode:paper-polish:unit',
        'selection-ref:vscode:paper:1',
        'rawSelectedText: hidden paragraph',
      ],
    },
  ]);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonRefs, [
    'blocked:current-vscode-operation-transcript:operation-not-generic',
    'blocked:current-vscode-operation-transcript:unsafe-ref',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /hidden paragraph/);
});

test('validator rejects raw prose smuggled under otherwise whitelisted ref prefixes', () => {
  const transcript = buildCurrentVSCodePreviewApplySaveTranscript({
    runRef: 'operation-ref:vscode:smuggling:unit',
    contextRefs: [
      'window:vscode:main',
      'observation:vscode:main:before',
      'freshness:vscode:main:before',
      'file-ref:vscode:current:paper',
      'selection-ref:vscode:main:1',
      'cursor-ref:vscode:main:1',
      'range-ref:vscode:main:1',
    ],
    draftTextRef: 'text-ref:vscode:draft:1',
    previewArtifactRef: 'artifact:vscode:preview:1',
    verifierRefs: [
      'verifier:vscode:same-window:main',
      'verifier:vscode:same-editor:main',
      'verifier:vscode:same-file:paper',
      'verifier:vscode:same-selection:1',
      'verifier:vscode:after-observe:1',
      'verifier:vscode:mutation:1',
    ],
    cleanupRefs: ['cleanup:vscode:release:1'],
  });
  const preview = transcript.find((step) => step.operationId === 'preview-current-selection');
  assert.ok(preview);
  preview.refs.push('text-ref:The improved draft body must not be treated as a ref');

  const result = validateCurrentVSCodeOperationTranscript([
    ...transcript,
  ]);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonRefs, ['blocked:current-vscode-operation-transcript:unsafe-ref']);
  assert.doesNotMatch(JSON.stringify(result), /improved draft body/i);
});

test('validator rejects polish-paper task-specific operation refs even when operation id is otherwise generic', () => {
  const transcript = buildCurrentVSCodePreviewApplySaveTranscript({
    runRef: 'operation-ref:vscode:generic:unit',
    contextRefs: [
      'window:vscode:main',
      'observation:vscode:main:before',
      'freshness:vscode:main:before',
      'file-ref:vscode:current:paper',
      'selection-ref:vscode:paper:1',
      'cursor-ref:vscode:paper:1',
      'range-ref:vscode:paper:1',
    ],
    draftTextRef: 'text-ref:vscode:polish-draft:1',
    previewArtifactRef: 'artifact:vscode:polish-preview:1',
    verifierRefs: [
      'verifier:vscode:same-window:main',
      'verifier:vscode:same-editor:main',
      'verifier:vscode:same-file:paper',
      'verifier:vscode:same-selection:1',
      'verifier:vscode:after-observe:1',
      'verifier:vscode:mutation:1',
    ],
    cleanupRefs: ['cleanup:vscode:release:1'],
  });
  const apply = transcript.find((step) => step.operationId === 'apply-current-selection');
  assert.ok(apply);
  apply.operationRef = 'operation-ref:vscode:polish-paper:unit';
  apply.refs.push('operation-ref:vscode:polishPaper:unit');

  const result = validateCurrentVSCodeOperationTranscript([
    ...transcript,
  ]);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonRefs, ['blocked:current-vscode-operation-transcript:unsafe-ref']);
  assert.doesNotMatch(JSON.stringify(result.evidenceRefs), /polish-paper|polishPaper/i);
});

test('preview/apply/save transcript preserves live selected-file refs for verified current editor targets', () => {
  const transcript = buildCurrentVSCodePreviewApplySaveTranscript({
    runRef: 'operation-ref:vscode:ui-entry:selected-file',
    contextRefs: [
      'window:vscode:main',
      'observation:vscode:main:before',
      'freshness:vscode:main:before',
      'selected-file:vscode:current-paper',
      'selection-ref:vscode:main:1',
      'cursor-ref:vscode:main:1',
      'range-ref:vscode:main:1',
    ],
    draftTextRef: 'text-ref:vscode:selected-file-draft:1',
    previewArtifactRef: 'artifact:vscode:selected-file-preview:1',
    verifierRefs: [
      'verifier:vscode:same-window:main',
      'verifier:vscode:same-editor:main',
      'verifier:vscode:same-file:current-paper',
      'verifier:vscode:same-selection:1',
      'verifier:vscode:after-observe:1',
      'verifier:vscode:mutation:1',
    ],
    cleanupRefs: ['cleanup:vscode:release:selected-file'],
  });

  assert.equal(validateCurrentVSCodeOperationTranscript(transcript).status, 'ready');
  assert.equal(transcript.some((step) => step.refs.includes('selected-file:vscode:current-paper')), true);
});

test('validator blocks UI apply/save transcripts without complete current file selection cursor range and freshness refs', () => {
  const result = validateCurrentVSCodeOperationTranscript([
    {
      operationId: 'preview-current-selection',
      operationRef: 'operation-ref:vscode:preview-current-selection:unit',
      primitive: 'preview',
      refs: [
        'operation-ref:vscode:preview-current-selection:unit',
        'selection-ref:vscode:main:1',
        'text-ref:vscode:draft:1',
        'artifact:vscode:preview:1',
      ],
    },
    {
      operationId: 'apply-current-selection',
      operationRef: 'operation-ref:vscode:apply-current-selection:unit',
      primitive: 'replace-selection',
      refs: [
        'operation-ref:vscode:apply-current-selection:unit',
        'selection-ref:vscode:main:1',
        'text-ref:vscode:draft:1',
      ],
    },
    {
      operationId: 'observe-current-vscode',
      operationRef: 'operation-ref:vscode:observe-current-vscode:unit',
      primitive: 'observe',
      refs: ['operation-ref:vscode:observe-current-vscode:unit'],
    },
    {
      operationId: 'verify-current-selection-apply',
      operationRef: 'operation-ref:vscode:verify-current-selection-apply:unit',
      primitive: 'verify',
      refs: [
        'operation-ref:vscode:verify-current-selection-apply:unit',
        'verifier:vscode:mutation:1',
      ],
    },
    {
      operationId: 'save-current-file',
      operationRef: 'operation-ref:vscode:save-current-file:unit',
      primitive: 'key:Meta+S',
      refs: [
        'operation-ref:vscode:save-current-file:unit',
        'verifier:vscode:mutation:1',
      ],
    },
    {
      operationId: 'release-current-vscode',
      operationRef: 'operation-ref:vscode:release-current-vscode:unit',
      primitive: 'release',
      refs: [
        'operation-ref:vscode:release-current-vscode:unit',
        'cleanup:vscode:release:1',
      ],
    },
  ]);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonRefs, [
    'blocked:current-vscode-operation-transcript:file-ref-required',
    'blocked:current-vscode-operation-transcript:cursor-ref-required',
    'blocked:current-vscode-operation-transcript:range-ref-required',
    'blocked:current-vscode-operation-transcript:freshness-ref-required',
  ]);
});

function sequenceFromPreview(transcript: readonly CurrentVSCodeOperationTranscriptStep[]): string[] {
  const previewIndex = transcript.findIndex((step) => step.operationId === 'preview-current-selection');
  assert.notEqual(previewIndex, -1);
  return transcript.slice(previewIndex).map((step) => step.operationId);
}

function mockUiPublicResult(input: {
  transcript: readonly CurrentVSCodeOperationTranscriptStep[];
  validation: CurrentVSCodeOperationTranscriptValidation;
  providerInputRefs?: readonly string[];
  providerOutputRefs?: readonly string[];
}): string {
  return JSON.stringify({
    status: input.validation.status,
    reasonRefs: input.validation.status === 'blocked' ? input.validation.reasonRefs : [],
    evidenceRefs: input.validation.evidenceRefs,
    providerInputRefs: input.providerInputRefs ?? [],
    providerOutputRefs: input.providerOutputRefs ?? [],
    operations: input.transcript.map((step) => ({
      operationId: step.operationId,
      operationRef: step.operationRef,
      primitive: step.primitive,
      refs: step.refs,
    })),
  });
}

function mockHostPolishProvider(input: {
  inputRefs: string[];
  privateOriginalText: string;
  privateRawDraft: string;
  privateRawDiff: string;
  providerPayload: string;
}): { inputRefs: string[]; outputRefs: string[] } {
  assertOnlyHostProviderRefs(input.inputRefs);
  assert.notEqual(input.privateOriginalText, input.privateRawDraft);
  assert.match(input.privateRawDiff, /^@@/);
  assert.match(input.providerPayload, /^providerPayload:/);
  return {
    inputRefs: input.inputRefs,
    outputRefs: [
      'text-ref:host:vscode-polish-draft:paper-like:1',
      'artifact:host:vscode-polish-preview:paper-like:1',
    ],
  };
}

function assertOnlyHostProviderRefs(refs: readonly string[]): void {
  assert.equal(refs.every((ref) => /^(?:text-ref|artifact):host:/.test(ref)), true);
  assert.doesNotMatch(JSON.stringify(refs), unsafeNeedles);
}
