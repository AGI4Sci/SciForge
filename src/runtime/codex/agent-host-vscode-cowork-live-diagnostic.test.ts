import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createComputerUsePrimitiveService,
  type ComputerUseActOutput,
  type ComputerUseBindOutput,
  type ComputerUseObserveOutput,
  type ComputerUsePrimitivePorts,
} from '../../../packages/actions/computer-use/index.js';
import {
  runVSCodeCoWorkInsertDraftLiveDiagnostic,
  runVSCodeCoWorkReadVisibleTextLiveDiagnostic,
} from './agent-host-vscode-cowork-live-diagnostic.js';

const now = '2026-06-08T00:00:00.000Z';

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
  assert.ok(result.evidenceRefs.includes('observation:vscode:current-2'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:vscode:live'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:vscode:live'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:vscode:live'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:vscode:previous'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:vscode:previous'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

function vscodePrimitivePorts(input: {
  calls: string[];
  refs: string[];
}): ComputerUsePrimitivePorts {
  let observeCount = 0;
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
      return {
        status: 'completed',
        output: {
          sessionId: observeInput.sessionId,
          observationRef,
          screenshotRef: `image:vscode:current-${observeCount}`,
          accessibilityRef: `accessibility:vscode:current-${observeCount}`,
          elementRefs: uniqueStrings(['element:vscode:editor', ...input.refs.filter((ref) => ref.startsWith('element:'))]),
          textRefs: uniqueStrings(['text:vscode:visible', ...input.refs.filter((ref) => ref.startsWith('text:'))]),
          staleInvalidationRefs: [],
        } satisfies ComputerUseObserveOutput,
        refs: uniqueStrings([
          'computer-use-session:vscode:live',
          'window-action-session:vscode-cowork:live',
          observationRef,
          `image:vscode:current-${observeCount}`,
          `accessibility:vscode:current-${observeCount}`,
          `freshness:vscode:current-${observeCount}`,
          'element:vscode:editor',
          'text:vscode:visible',
          ...input.refs,
        ]),
      };
    },
    act: (actInput) => {
      input.calls.push(`act:${actInput.action.type}:${actInput.action.textRef}:${actInput.action.elementRef}`);
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

function vscodeRefs(name: string, options: {
  omitObservationWindow?: boolean;
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
    'freshness:vscode:current',
  ];
}

function firstRef(refs: string[], prefix: string): string | undefined {
  return refs.find((ref) => ref.startsWith(prefix));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
