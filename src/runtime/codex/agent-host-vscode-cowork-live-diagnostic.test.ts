import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  createComputerUsePrimitiveService,
  type ComputerUseActOutput,
  type ComputerUseBindOutput,
  type ComputerUseObserveOutput,
  type ComputerUsePrimitiveEnvelope,
  type ComputerUsePrimitivePorts,
  type ComputerUsePrimitiveService,
} from '../../../packages/actions/computer-use/index.js';
import {
  createDefaultVSCodeCoWorkComputerUseActMaterializer,
} from './agent-host-vscode-cowork-act-materializer.js';
import {
  produceVSCodeCoWorkAgentHostLiveInput,
  runVSCodeCoWorkFocusEditorLiveDiagnostic,
  runVSCodeCoWorkInsertDraftLiveDiagnostic,
  runVSCodeCoWorkReadVisibleTextLiveDiagnostic,
} from './agent-host-vscode-cowork-live-diagnostic.js';

const now = '2026-06-08T00:00:00.000Z';

test('VSCode co-work Host live producer builds read-visible-text Host input from primitive observe refs', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });
  const captured = await bindAndObserve(service);

  const produced = produceVSCodeCoWorkAgentHostLiveInput({
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'codex-command-vscode-producer-read',
    attemptId: 'codex-command-vscode-producer-read-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    bindOutput: captured.bindOutput,
    bindRefs: captured.bindRefs,
    observe: captured.observe,
    operation: 'read-visible-text',
  });

  assert.equal(produced.status, 'ready', produced.blockedReason);
  assert.equal(produced.operation, 'read-visible-text');
  assert.equal(produced.agentHostInput?.target.kind, 'current-vscode-cowork');
  assert.equal(
    (produced.agentHostInput?.target.vscodeCoWork as Record<string, unknown> | undefined)?.operation,
    'read-visible-text',
  );
  assert.ok(produced.agentHostInput?.refs.includes('intent:current-vscode-cowork'));
  assert.ok(produced.agentHostInput?.refs.includes('window:vscode:paper'));
  assert.ok(produced.agentHostInput?.refs.includes('file-ref:vscode:paper'));
  assert.ok(produced.runtimeTruth?.target?.refs?.includes('window:vscode:paper'));
  assert.ok(produced.runtimeTruth?.observation?.refs?.includes('observation:vscode:current-1'));
  assert.ok(produced.preflight?.guardRefs);
  assert.ok(produced.preflight.guardRefs.observationRefs.includes('observation:vscode:current-1'));
  assert.ok(produced.preflight.guardRefs.permissionRefs.some((ref) => ref.startsWith('permission:current-vscode-cowork:full-access:')));

  const materializer = createDefaultVSCodeCoWorkComputerUseActMaterializer();
  const materializerResult = await materializer({
    agentHostInput: produced.agentHostInput!,
    preflight: produced.preflight!,
    commandText: 'This raw fallback must not choose the operation.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-vscode-producer-read',
    attemptId: 'codex-command-vscode-producer-read-attempt-1',
    runtimeTruth: produced.runtimeTruth,
  });

  assert.equal(materializerResult?.status, 'completed', materializerResult?.message);
  assert.equal(materializerResult?.claimType, 'computer-use-vscode-cowork-observe-decision');
  assert.equal(materializerResult?.executionUnits?.[0]?.primitive, 'observe');
  assert.doesNotMatch(JSON.stringify({ produced, materializerResult }), /raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work Host producer does not infer operation from command text', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });
  const captured = await bindAndObserve(service);

  const produced = produceVSCodeCoWorkAgentHostLiveInput({
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'codex-command-vscode-producer-no-text-inference',
    attemptId: 'codex-command-vscode-producer-no-text-inference-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    bindOutput: captured.bindOutput,
    bindRefs: captured.bindRefs,
    observe: captured.observe,
  });

  assert.equal(produced.status, 'blocked');
  assert.equal(produced.blockedReason, 'current-vscode-cowork-live-producer-operation-required');
  assert.equal(produced.agentHostInput, undefined);
  assert.equal(produced.runtimeTruth, undefined);
  assert.equal(produced.preflight, undefined);
  assert.ok(produced.evidenceRefs.includes('observation:vscode:current-1'));
  assert.doesNotMatch(JSON.stringify(produced), /computer-use-vscode-cowork-observe-decision|taskOutcome":"satisfied|product-ready/i);
});

test('VSCode co-work Host live producer builds insert-draft Host input without leaking raw draft text', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });
  const captured = await bindAndObserve(service);

  const produced = produceVSCodeCoWorkAgentHostLiveInput({
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'codex-command-vscode-producer-insert',
    attemptId: 'codex-command-vscode-producer-insert-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    bindOutput: captured.bindOutput,
    bindRefs: captured.bindRefs,
    observe: captured.observe,
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    operation: 'insert-draft',
  });

  assert.equal(produced.status, 'ready', produced.blockedReason);
  assert.equal(produced.operation, 'insert-draft');
  assert.ok(produced.agentHostInput?.refs.includes('text-ref:current-vscode-cowork:draft'));
  assert.ok(produced.agentHostInput?.refs.includes('focused-editor:vscode:paper'));
  assert.equal(
    (produced.agentHostInput?.target.vscodeCoWork as Record<string, unknown> | undefined)?.draftTextRef,
    'text-ref:current-vscode-cowork:draft',
  );

  const materializer = createDefaultVSCodeCoWorkComputerUseActMaterializer();
  const materializerResult = await materializer({
    agentHostInput: produced.agentHostInput!,
    preflight: produced.preflight!,
    commandText: 'This raw fallback must not choose the operation.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-vscode-producer-insert',
    attemptId: 'codex-command-vscode-producer-insert-attempt-1',
    runtimeTruth: produced.runtimeTruth,
  });

  assert.equal(materializerResult?.status, 'completed', materializerResult?.message);
  assert.equal(materializerResult?.claimType, 'computer-use-vscode-cowork-act-decision');
  assert.equal(materializerResult?.executionUnits?.[0]?.primitive, 'act');
  assert.ok(materializerResult?.evidenceRefs.includes('focused-editor:vscode:paper'));
  assert.deepEqual(materializerResult?.executionUnits?.[0]?.action, {
    type: 'type',
    elementRef: 'element:vscode:editor',
    textRef: 'text-ref:current-vscode-cowork:draft',
  });
  assert.doesNotMatch(
    JSON.stringify({ produced, materializerResult }),
    /draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i,
  );
});

test('VSCode co-work live diagnostic lets Host choose refs-only observe then releases input resources', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    service,
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'codex-command-vscode-live-read',
    attemptId: 'codex-command-vscode-live-read-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(calls, ['bind', 'observe:1', 'observe:2', 'control:release']);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
  assert.equal(result.materializerResult?.claimType, 'computer-use-vscode-cowork-observe-decision');
  assert.equal(result.agentHostFinalAnswer?.schemaVersion, 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1');
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.equal(result.agentHostFinalAnswer?.productReady, false);
  assert.match(result.agentHostFinalAnswer?.text ?? '', /read-visible-text/i);
  assert.deepEqual(result.agentHostFinalAnswer?.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
  assert.ok(result.agentHostFinalAnswer?.evidenceRefs.includes('observation:vscode:current-2'));
  assert.ok(result.agentHostFinalAnswer?.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.scope, 'action');
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'satisfied');
  assert.equal(result.agentHostInput?.target.kind, 'current-vscode-cowork');
  assert.ok(result.agentHostInput?.refs.includes('intent:current-vscode-cowork'));
  assert.ok(result.runtimeTruth?.target?.refs?.includes('window:vscode:paper'));
  assert.ok(result.runtimeTruth?.observation?.refs?.includes('observation:vscode:current-2'));
  assert.ok(result.evidenceRefs.includes('decision:vscode-cowork:codex-command-vscode-live-read-attempt-1:read-visible-text'));
  assert.ok(result.evidenceRefs.includes('control:vscode-cowork:release'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:vscode:live'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:vscode:live'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:vscode:previous'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:vscode:previous'));
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work live diagnostic needs confirmation for ambiguous target windows and still releases', async () => {
  const calls: string[] = [];
  const refs = [
    ...vscodeRefs('paper', { omitObservationWindow: true }),
    ...vscodeRefs('notes', { omitObservationWindow: true }),
  ];
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    service,
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'codex-command-vscode-live-ambiguous',
    attemptId: 'codex-command-vscode-live-ambiguous-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
  });

  assert.equal(result.status, 'needs-confirmation', result.message);
  assert.equal(result.agentHostFinalAnswer?.status, 'needs-confirmation');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.match(result.agentHostFinalAnswer?.text ?? '', /needs confirmation|needs-confirmation/i);
  assert.ok(result.agentHostFinalAnswer?.evidenceRefs.includes('window:vscode:paper'));
  assert.ok(result.agentHostFinalAnswer?.evidenceRefs.includes('window:vscode:notes'));
  assert.ok(result.agentHostFinalAnswer?.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.deepEqual(calls, ['bind', 'observe:1', 'control:release']);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'control(release)']);
  assert.equal(result.materializerResult?.status, 'needs-confirmation');
  assert.ok(result.evidenceRefs.includes('window:vscode:paper'));
  assert.ok(result.evidenceRefs.includes('window:vscode:notes'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:vscode:previous'));
  assert.doesNotMatch(JSON.stringify(result), /observe:2|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work focus-editor live diagnostic accepts Host-owned evidence verifier refs', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper', { omitFocusedEditor: true });
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkFocusEditorLiveDiagnostic({
    service,
    commandText: '聚焦我当前打开的 VSCode 编辑器。',
    commandId: 'codex-command-vscode-live-focus',
    attemptId: 'codex-command-vscode-live-focus-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    focusedEditorEvidenceVerifier: (input) => {
      calls.push(`verify-focus:${input.afterObservationRef}`);
      assert.ok(input.afterObserveRefs.includes('image:vscode:current-2'));
      assert.ok(input.afterObserveRefs.includes('accessibility:vscode:current-2'));
      assert.ok(input.afterObserveRefs.includes('element:vscode:editor'));
      assert.ok(input.actionRefs.includes('action:vscode-cowork:focus-editor'));
      return {
        status: 'satisfied',
        focusedEditorRef: 'focused-editor:vscode:host-evidence:paper',
        verifierRef: 'verifier:vscode-cowork:codex-command-vscode-live-focus-attempt-1:focus-editor',
        evidenceRefs: [
          'image:vscode:current-2',
          'accessibility:vscode:current-2',
          'element:vscode:editor',
          'text:vscode:visible-2',
        ],
      };
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.deepEqual(calls, [
    'bind',
    'observe:1',
    'act:key:Command+1:element:vscode:editor',
    'observe:2',
    'verify-focus:observation:vscode:current-2',
    'control:release',
  ]);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'satisfied');
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:host-evidence:paper'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:codex-command-vscode-live-focus-attempt-1:focus-editor'));
  assert.ok(result.evidenceRefs.includes('image:vscode:current-2'));
  assert.ok(result.evidenceRefs.includes('accessibility:vscode:current-2'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work focus-editor live diagnostic blocks unsafe Host verifier refs', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper', { omitFocusedEditor: true });
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkFocusEditorLiveDiagnostic({
    service,
    commandText: '聚焦我当前打开的 VSCode 编辑器。',
    commandId: 'codex-command-vscode-live-focus-unsafe',
    attemptId: 'codex-command-vscode-live-focus-unsafe-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    focusedEditorEvidenceVerifier: () => ({
      status: 'satisfied',
      focusedEditorRef: 'raw focused editor',
      verifierRef: 'https://example.invalid/verifier',
      evidenceRefs: ['data:image/png;base64,abc', '/tmp/raw-screenshot.png', 'providerPayload:raw'],
    }),
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /focused-editor/i);
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(!result.evidenceRefs.some((ref) => ref.startsWith('focused-editor:')));
  assert.ok(!result.evidenceRefs.some((ref) => ref.startsWith('verifier:') && ref.includes('focus-editor')));
  assert.deepEqual(calls, [
    'bind',
    'observe:1',
    'act:key:Command+1:element:vscode:editor',
    'observe:2',
    'control:release',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /raw focused editor|example\.invalid|data:image|base64|raw-screenshot|providerPayload|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work live diagnostic lets Host choose insert-draft act then observes and releases', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkInsertDraftLiveDiagnostic({
    service,
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'codex-command-vscode-live-insert-draft',
    attemptId: 'codex-command-vscode-live-insert-draft-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(calls, [
    'bind',
    'observe:1',
    'act:type:text-ref:current-vscode-cowork:draft:element:vscode:editor',
    'observe:2',
    'control:release',
  ]);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
  assert.equal(result.materializerResult?.claimType, 'computer-use-vscode-cowork-act-decision');
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.equal(result.agentHostFinalAnswer?.productReady, false);
  assert.match(result.agentHostFinalAnswer?.text ?? '', /insert-draft|act/i);
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.scope, 'action');
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'satisfied');
  assert.ok(result.agentHostInput?.refs.includes('text-ref:current-vscode-cowork:draft'));
  assert.ok(result.evidenceRefs.includes('decision:vscode-cowork:codex-command-vscode-live-insert-draft-attempt-1:insert-draft'));
  assert.ok(result.evidenceRefs.includes('action:vscode-cowork:insert-draft'));
  assert.ok(result.evidenceRefs.includes('executor-event:vscode-cowork:insert-draft'));
  assert.ok(result.evidenceRefs.includes('input-event:vscode-cowork:insert-draft'));
  assert.ok(result.evidenceRefs.includes('stale-invalidation:vscode-cowork:insert-draft'));
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:paper'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:codex-command-vscode-live-insert-draft-attempt-1:insert-draft'));
  assert.ok(result.evidenceRefs.includes('observation:vscode:current-2'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:vscode:live'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:vscode:live'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:vscode:previous'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:vscode:previous'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work insert-draft passes focused-editor evidence refs into the selected act primitive', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({
      calls,
      refs,
      requiredActContextRef: 'focused-editor:vscode:paper',
    }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkInsertDraftLiveDiagnostic({
    service,
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'codex-command-vscode-live-insert-draft-context',
    attemptId: 'codex-command-vscode-live-insert-draft-context-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(calls[0], 'bind');
  assert.equal(calls[1], 'observe:1');
  assert.match(calls[2] ?? '', /^act:type:text-ref:current-vscode-cowork:draft:element:vscode:editor:context:/);
  assert.match(calls[2] ?? '', /focused-editor:vscode:paper/);
  assert.equal(calls[3], 'observe:2');
  assert.equal(calls[4], 'control:release');
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:paper'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:codex-command-vscode-live-insert-draft-context-attempt-1:insert-draft'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work live diagnostic blocks insert-draft when after observe has no mutation verifier', async () => {
  const calls: string[] = [];
  const refs = vscodeRefs('paper');
  const service = createComputerUsePrimitiveService({
    ports: vscodePrimitivePorts({ calls, refs, stableTextRefs: true }),
    now: () => new Date(now).getTime(),
  });

  const result = await runVSCodeCoWorkInsertDraftLiveDiagnostic({
    service,
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'codex-command-vscode-live-insert-draft-no-mutation',
    attemptId: 'codex-command-vscode-live-insert-draft-no-mutation-attempt-1',
    workspacePath: '/tmp/workspace',
    target: {
      kind: 'window',
      targetRef: 'window-action-session:vscode-cowork:live',
      appRef: 'macos-app:com.microsoft.VSCode',
    },
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /mutation verifier/i);
  assert.deepEqual(calls, [
    'bind',
    'observe:1',
    'act:type:text-ref:current-vscode-cowork:draft:element:vscode:editor',
    'observe:2',
    'control:release',
  ]);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'blocked');
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(!result.evidenceRefs.includes('verifier:vscode-cowork:codex-command-vscode-live-insert-draft-no-mutation-attempt-1:insert-draft'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

function vscodePrimitivePorts(input: {
  calls: string[];
  refs: string[];
  stableTextRefs?: boolean;
  requiredActContextRef?: string;
}): ComputerUsePrimitivePorts {
  let observeCount = 0;
  let currentObservationRef = 'observation:vscode:bind';
  return {
    bind: () => {
      input.calls.push('bind');
      return {
        status: 'completed',
        output: {
          sessionId: 'vscode-live',
          sessionRef: 'computer-use-session:vscode:live',
          targetRef: firstRef(input.refs, 'window:') ?? 'window:vscode:paper',
          windowActionSessionRef: 'window-action-session:vscode-cowork:live',
          inputAdapterRef: 'scoped-input-adapter:vscode:live',
          cursorRef: 'cursor-marker:vscode:live',
          scopedInputLeaseRef: 'scoped-input-lease:vscode:live',
          observationRef: 'observation:vscode:bind',
        } satisfies ComputerUseBindOutput,
        refs: [
          'computer-use-session:vscode:live',
          'window-action-session:vscode-cowork:live',
          'scoped-input-adapter:vscode:live',
          'cursor-marker:vscode:live',
          'scoped-input-lease:vscode:live',
          ...input.refs.filter((ref) => !ref.startsWith('observation:current-')),
        ],
      };
    },
    observe: (observeInput) => {
      observeCount += 1;
      input.calls.push(`observe:${observeCount}`);
      const observationRef = `observation:vscode:current-${observeCount}`;
      const staleInvalidationRefs = [currentObservationRef];
      currentObservationRef = observationRef;
      return {
        status: 'completed',
        output: {
          sessionId: observeInput.sessionId,
          observationRef,
          screenshotRef: `image:vscode:current-${observeCount}`,
          accessibilityRef: `accessibility:vscode:current-${observeCount}`,
          elementRefs: uniqueStrings(['element:vscode:editor', ...input.refs.filter((ref) => ref.startsWith('element:'))]),
          textRefs: uniqueStrings([
            ...(input.stableTextRefs ? [] : [`text:vscode:visible-${observeCount}`]),
            'text:vscode:visible',
            ...input.refs.filter((ref) => ref.startsWith('text:')),
          ]),
          staleInvalidationRefs,
        } satisfies ComputerUseObserveOutput,
        refs: uniqueStrings([
          'computer-use-session:vscode:live',
          'window-action-session:vscode-cowork:live',
          observationRef,
          `image:vscode:current-${observeCount}`,
          `accessibility:vscode:current-${observeCount}`,
          `freshness:vscode:current-${observeCount}`,
          'element:vscode:editor',
          ...(input.stableTextRefs ? [] : [`text:vscode:visible-${observeCount}`]),
          'text:vscode:visible',
          ...input.refs,
        ]),
      };
    },
    act: (actInput) => {
      if (actInput.action.type === 'key') {
        input.calls.push(`act:key:${actInput.action.key}:${actInput.action.elementRef}`);
        return {
          status: 'completed',
          output: {
            sessionId: actInput.sessionId,
            actionRef: 'action:vscode-cowork:focus-editor',
            executorEventRef: 'executor-event:vscode-cowork:focus-editor',
            inputAdapterRef: actInput.inputAdapterRef,
            cursorRef: actInput.cursorRef,
            scopedInputLeaseRef: actInput.scopedInputLeaseRef,
            inputEventRef: 'input-event:vscode-cowork:focus-editor',
            beforeObservationRef: 'observation:vscode:current-1',
            afterObservationRef: 'observation:vscode:after-act',
            invalidatedRefs: ['stale-invalidation:vscode-cowork:focus-editor'],
          } satisfies ComputerUseActOutput,
          refs: [
            'computer-use-session:vscode:live',
            'window-action-session:vscode-cowork:live',
            'window:vscode:paper',
            'file-ref:vscode:paper',
            'element:vscode:editor',
            'action:vscode-cowork:focus-editor',
            'executor-event:vscode-cowork:focus-editor',
            'input-event:vscode-cowork:focus-editor',
            'stale-invalidation:vscode-cowork:focus-editor',
            'scoped-input-lease:vscode:live',
            'scoped-input-adapter:vscode:live',
            'cursor-marker:vscode:live',
            'observation:vscode:current-1',
            'observation:vscode:after-act',
          ],
        };
      }
      const actContextRefs = actInput.contextRefs ?? [];
      if (input.requiredActContextRef) {
        input.calls.push(`act:${actInput.action.type}:${actInput.action.textRef}:${actInput.action.elementRef}:context:${actContextRefs.join('|') || 'none'}`);
        if (!actContextRefs.includes(input.requiredActContextRef)) {
          return {
            status: 'blocked',
            blockedReason: 'missing-required-act-context-ref',
            refs: [
              'computer-use-session:vscode:live',
              'window-action-session:vscode-cowork:live',
              'action:vscode-cowork:insert-draft',
              'executor-event:vscode-cowork:insert-draft',
              'input-event:vscode-cowork:insert-draft',
              ...actContextRefs,
            ],
          };
        }
      } else {
        input.calls.push(`act:${actInput.action.type}:${actInput.action.textRef}:${actInput.action.elementRef}`);
      }
      return {
        status: 'completed',
        output: {
          sessionId: actInput.sessionId,
          actionRef: 'action:vscode-cowork:insert-draft',
          executorEventRef: 'executor-event:vscode-cowork:insert-draft',
          inputAdapterRef: actInput.inputAdapterRef,
          cursorRef: actInput.cursorRef,
          scopedInputLeaseRef: actInput.scopedInputLeaseRef,
          inputEventRef: 'input-event:vscode-cowork:insert-draft',
          beforeObservationRef: 'observation:vscode:current-1',
          afterObservationRef: 'observation:vscode:after-act',
          invalidatedRefs: ['stale-invalidation:vscode-cowork:insert-draft'],
        } satisfies ComputerUseActOutput,
        refs: [
          'computer-use-session:vscode:live',
          'window-action-session:vscode-cowork:live',
          'window:vscode:paper',
          'file-ref:vscode:paper',
          'element:vscode:editor',
          'text-ref:current-vscode-cowork:draft',
          'action:vscode-cowork:insert-draft',
          'executor-event:vscode-cowork:insert-draft',
          'input-event:vscode-cowork:insert-draft',
          'stale-invalidation:vscode-cowork:insert-draft',
          'scoped-input-lease:vscode:live',
          'scoped-input-adapter:vscode:live',
          'cursor-marker:vscode:live',
          'observation:vscode:current-1',
          'observation:vscode:after-act',
        ],
      };
    },
    control: (controlInput) => {
      input.calls.push(`control:${controlInput.command}`);
      return {
        status: 'completed',
        output: {
          sessionId: controlInput.sessionId,
          controlRef: 'control:vscode-cowork:release',
          releasedRefs: [
            'scoped-input-lease:vscode:live',
            'scoped-input-adapter:vscode:live',
            'cursor-marker:vscode:live',
          ],
        },
        refs: [
          'control:vscode-cowork:release',
          'scoped-input-lease:vscode:live',
          'scoped-input-adapter:vscode:live',
          'cursor-marker:vscode:live',
          'front-app-restore:vscode:previous',
          'mouse-position-restore:vscode:previous',
        ],
      };
    },
  };
}

async function bindAndObserve(service: ComputerUsePrimitiveService): Promise<{
  bindOutput: ComputerUseBindOutput;
  bindRefs: string[];
  observe: ComputerUsePrimitiveEnvelope<ComputerUseObserveOutput>;
}> {
  const bind = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        targetRef: 'window-action-session:vscode-cowork:live',
        appRef: 'macos-app:com.microsoft.VSCode',
      },
    },
  });
  assert.equal(bind.ok, true, bind.error);
  assert.equal(bind.value?.status, 'completed');
  assert.ok(bind.value?.output);
  const bindOutput = bind.value.output as ComputerUseBindOutput;
  const observe = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId: bindOutput.sessionId,
      capture: 'both',
      includeTree: true,
    },
  });
  assert.equal(observe.ok, true, observe.error);
  assert.equal(observe.value?.status, 'completed');
  assert.ok(observe.value?.output);
  return {
    bindOutput,
    bindRefs: bind.value.refs ?? [],
    observe: observe.value as ComputerUsePrimitiveEnvelope<ComputerUseObserveOutput>,
  };
}

function vscodeRefs(name: string, options: {
  omitObservationWindow?: boolean;
  omitFocusedEditor?: boolean;
} = {}): string[] {
  return [
    'macos-app:com.microsoft.VSCode',
    `process:vscode:${name}`,
    `window:vscode:${name}`,
    `text:title:${name}`,
    `frontmost:vscode:${name}`,
    `file-ref:vscode:${name}`,
    'window-action-session:vscode-cowork:live',
    ...(options.omitObservationWindow ? [] : [`window:vscode:${name}`]),
    'observation:vscode:current',
    'image:vscode:current',
    'accessibility:vscode:current',
    'text:vscode:visible',
    'element:vscode:editor',
    ...(options.omitFocusedEditor ? [] : [`focused-editor:vscode:${name}`]),
    'freshness:vscode:current',
  ];
}

function firstRef(refs: string[], prefix: string): string | undefined {
  return refs.find((ref) => ref.startsWith(prefix));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
