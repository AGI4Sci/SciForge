import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStreamEvent, SendAgentMessageInput } from '../../domain';
import { sendSciForgeToolMessage } from '../sciforgeToolsClient';
import { CODEX_REALTIME_SESSION_TRANSPORT_STATUS } from './codexRealtimeSession';
import { normalizeWorkspaceRuntimeEvent, readWorkspaceToolStream } from './runtimeEvents';

test('SSE reader preserves generic workspace message events without synthesizing GUI projection', async () => {
  const body = [
    'event: message',
    'data: {"type":"message","text":"SCIFORGE-MT-FIXED-5173"}',
    '',
    'event: done',
    'data: {"type":"done","status":"done","message":"Workspace task completed successfully."}',
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.equal(seen.length, 2);
  assert.equal((stream.result as { message?: string }).message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal((stream.result as { output?: { message?: string } }).output?.message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal('displayIntent' in (stream.result as Record<string, unknown>), false);
});

test('SSE reader still requires gui.present or a native assistant message for Runtime Codex completion', async () => {
  const commandId = 'codex-command-gui-required';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.equal(stream.result, undefined);
  assert.match(stream.error ?? '', /without gui\.present/);
  assert.equal((seen.at(-1) as { type?: string }).type, 'failed');
});

test('SSE reader promotes native Runtime Codex assistant messages when gui.present is absent', async () => {
  const commandId = 'codex-command-native-message';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: 'VISIBLE_FROM_CODEX_NATIVE_MESSAGE',
      commandId,
      profile: 'sciforge-runtime-deepseek',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:raw-jsonl`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));
  const result = stream.result as {
    message?: string;
    nativeCodexMessage?: { source?: string; liveAcceptanceEligible?: boolean };
    displayIntent?: {
      conversationProjection?: {
        visibleAnswer?: { status?: string; liveAcceptanceEligible?: boolean };
        verificationState?: { status?: string; verdict?: string; liveAcceptanceEligible?: boolean };
      };
    };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'VISIBLE_FROM_CODEX_NATIVE_MESSAGE');
  assert.equal(result.nativeCodexMessage?.source, `codex.native-message:${commandId}`);
  assert.equal(result.nativeCodexMessage?.liveAcceptanceEligible, false);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'visible-not-live-acceptance');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.liveAcceptanceEligible, false);
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.status, 'unverified');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.verdict, 'native-message');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.liveAcceptanceEligible, false);
});

test('SSE reader promotes gui.present into the visible Runtime Codex result', async () => {
  const commandId = 'codex-command-gui-present';
  const body = [
    'event: message',
    'data: {"type":"message","text":"RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER"}',
    '',
    'event: gui_present',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_present',
      text: 'VISIBLE_FROM_GUI_PRESENT',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:stderr`],
      raw: {
        source: `gui.present:${commandId}`,
        presentation: {
          source: `gui.present:${commandId}`,
          text: 'VISIBLE_FROM_GUI_PRESENT',
          ref: 'artifact:runtime-answer',
          title: 'Runtime answer',
          hint: 'markdown',
        },
      },
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:stderr`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));
  const result = stream.result as { message?: string; displayIntent?: { source?: string; conversationProjection?: { artifacts?: Array<{ mime?: string }> } }; guiPresentation?: { source?: string; hint?: string } };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'VISIBLE_FROM_GUI_PRESENT');
  assert.equal(result.guiPresentation?.source, `gui.present:${commandId}`);
  assert.equal(result.guiPresentation?.hint, 'markdown');
  assert.equal(result.displayIntent?.source, `gui.present:${commandId}`);
  assert.equal(result.displayIntent?.conversationProjection?.artifacts?.[0]?.mime, 'markdown');
  assert.doesNotMatch(JSON.stringify(result), /RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER/);
});

test('SSE reader promotes gui.ask_user into a visible confirmation result', async () => {
  const commandId = 'codex-command-gui-ask-user';
  const body = [
    'event: gui_ask_user',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_ask_user',
      text: [
        '## Computer Use confirmation required',
        'Allow Computer Use to click the visible Submit button?',
        'Evidence refs:',
        '- `.sciforge/vision-runs/run-1/vision-trace.json`',
      ].join('\n\n'),
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
      raw: {
        source: `gui.ask_user:${commandId}`,
        askUser: {
          source: `gui.ask_user:${commandId}`,
          kind: 'confirmation',
          title: 'Computer Use confirmation required',
          message: 'Allow Computer Use to click the visible Submit button?',
          relatedRefs: ['.sciforge/vision-runs/run-1/vision-trace.json'],
          choices: [
            { label: 'Approve', commandText: '/computer-use approve --approval-ref approval-1', style: 'primary' },
            { label: 'Cancel', commandText: '/computer-use reject --approval-ref approval-1' },
            { label: 'Unsafe legacy', commandText: 'triggerRecover({ runId: "run-1" })' },
          ],
        },
      },
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
    })}`,
    '',
  ].join('\n');
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    guiAskUser?: { source?: string; relatedRefs?: string[]; choices?: Array<{ commandText?: string }> };
    displayIntent?: {
      source?: string;
      conversationProjection?: {
        visibleAnswer?: { status?: string; liveAcceptanceEligible?: boolean };
        artifacts?: Array<{ ref?: string }>;
        recoverActions?: string[];
      };
    };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Computer Use confirmation required/);
  assert.match(result.message ?? '', /vision-trace\.json/);
  assert.equal(result.guiAskUser?.source, `gui.ask_user:${commandId}`);
  assert.deepEqual(result.guiAskUser?.relatedRefs, ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.equal(result.guiAskUser?.choices?.[0]?.commandText, '/computer-use approve --approval-ref approval-1');
  assert.equal(result.displayIntent?.source, `gui.ask_user:${commandId}`);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'needs-human');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.liveAcceptanceEligible, true);
  assert.deepEqual(result.displayIntent?.conversationProjection?.artifacts?.map((artifact) => artifact.ref), ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.deepEqual(result.displayIntent?.conversationProjection?.recoverActions, [
    '/computer-use approve --approval-ref approval-1',
    '/computer-use reject --approval-ref approval-1',
  ]);
});

test('SSE reader turns Computer Use TUI host action metadata into visible result and confirmation refs', async () => {
  const commandId = 'codex-command-computer-use-actions';
  const traceRef = '.sciforge/vision-runs/cu-risk/vision-trace.json';
  const screenshotRef = '.sciforge/vision-runs/cu-risk/step-001-before.png';
  const body = [
    'event: workspace_event',
    `data: ${JSON.stringify({
      type: 'computer-use.tui-host-actions',
      source: 'computer-use-package-bridge',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      detail: JSON.stringify({
        actions: [{
          schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
          port: 'gui.present',
          target: 'computer-use.trace-summary',
          payload: {
            title: 'Computer Use result',
            status: 'needs-confirmation',
            message: 'Computer Use stopped before the guarded action.',
            traceRefs: [traceRef],
            screenshotRefs: [screenshotRef],
            artifactRefs: [],
            executionUnitRefs: ['EU-computer-use-risk'],
            workEvidenceRefs: ['workEvidence:vision-sense-computer-use:cu-risk'],
          },
        }, {
          schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
          port: 'gui.ask_user',
          target: 'computer-use.approval-request',
          payload: {
            approvalRequest: {
              id: 'approval:computer-use:cu-risk',
              prompt: 'Allow Computer Use to click the visible Submit button?',
              riskLevel: 'high',
              actionRef: 'ref:planned-action:submit',
            },
            relatedRefs: [traceRef, screenshotRef],
          },
        }],
      }),
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(normalizeWorkspaceRuntimeEvent(event)));
  const result = stream.result as {
    message?: string;
    guiAskUser?: { approvalRequest?: { id?: string }; relatedRefs?: string[] };
    guiPresentation?: { displayedRefs?: string[] };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string }; artifacts?: Array<{ ref?: string }> } };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Computer Use confirmation required/);
  assert.match(result.message ?? '', /Allow Computer Use to click/);
  assert.match(result.message ?? '', /approval:computer-use:cu-risk/);
  assert.match(result.message ?? '', new RegExp(traceRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(result.guiAskUser?.approvalRequest?.id, 'approval:computer-use:cu-risk');
  assert.deepEqual(result.guiAskUser?.relatedRefs, [traceRef, screenshotRef]);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(traceRef));
  assert.deepEqual(result.displayIntent?.conversationProjection?.artifacts?.map((artifact) => artifact.ref), [
    traceRef,
    screenshotRef,
    'EU-computer-use-risk',
    'workEvidence:vision-sense-computer-use:cu-risk',
  ]);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'needs-human');
  assert.match((seen[0] as AgentStreamEvent | undefined)?.detail ?? '', /visible GUI confirmation/);
});

test('NDJSON reader turns Computer Use TUI host action metadata into visible result and confirmation refs', async () => {
  const commandId = 'computer-use-command-ndjson';
  const traceRef = '.sciforge/vision-runs/cu-ndjson/vision-trace.json';
  const screenshotRef = '.sciforge/vision-runs/cu-ndjson/step-001-before.png';
  const response = new Response([
    JSON.stringify({
      event: {
        type: 'computer-use.tui-host-actions',
        source: 'computer-use-package-bridge',
        commandId,
        attemptId: `${commandId}-attempt-1`,
        detail: JSON.stringify({
          actions: [{
            schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
            port: 'gui.present',
            target: 'computer-use.trace-summary',
            payload: {
              title: 'Computer Use result',
              status: 'needs-confirmation',
              message: 'Computer Use stopped before the guarded action.',
              traceRefs: [traceRef],
              screenshotRefs: [screenshotRef],
              executionUnitRefs: ['EU-computer-use-ndjson'],
            },
          }, {
            schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
            port: 'gui.ask_user',
            target: 'computer-use.approval-request',
            payload: {
              approvalRequest: {
                id: 'approval:computer-use:ndjson',
                confirmation_text: 'Allow Computer Use to click the guarded Submit button?',
                risk_level: 'high',
                action_kind: 'click',
              },
              relatedRefs: [traceRef, screenshotRef],
            },
          }],
        }),
      },
    }),
    JSON.stringify({
      result: {
        status: 'done',
        message: 'Raw provider result should not be the visible answer.',
        commandId,
        executionUnits: [{ id: 'EU-computer-use-ndjson', status: 'done' }],
      },
    }),
  ].join('\n'), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });

  const seen: unknown[] = [];
  const stream = await readWorkspaceToolStream(response, (event) => seen.push(normalizeWorkspaceRuntimeEvent(event)));
  const result = stream.result as {
    message?: string;
    guiAskUser?: { source?: string; choices?: Array<{ commandText?: string }>; relatedRefs?: string[] };
    guiPresentation?: { source?: string; displayedRefs?: string[] };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string }; recoverActions?: string[] } };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Computer Use confirmation required/);
  assert.match(result.message ?? '', /Allow Computer Use to click the guarded Submit button/);
  assert.equal(result.guiAskUser?.source, `gui.ask_user:${commandId}:computer-use`);
  assert.deepEqual(result.guiAskUser?.relatedRefs, [traceRef, screenshotRef]);
  assert.equal(result.guiAskUser?.choices?.[0]?.commandText, '/computer-use approve --approval-ref "approval:computer-use:ndjson"');
  assert.equal(result.guiPresentation?.source, `gui.present:${commandId}:computer-use`);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(traceRef));
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'needs-human');
  assert.deepEqual(result.displayIntent?.conversationProjection?.recoverActions, [
    '/computer-use approve --approval-ref "approval:computer-use:ndjson"',
    '/computer-use reject --approval-ref "approval:computer-use:ndjson"',
  ]);
  assert.match((seen[0] as AgentStreamEvent | undefined)?.detail ?? '', /visible GUI confirmation/);
});

test('Runtime Codex foreground Computer Use host actions preserve gui.present and gui.ask_user for default chat', async () => {
  const originalFetch = globalThis.fetch;
  const traceRef = '.sciforge/vision-runs/cu-risk/vision-trace.json';
  const screenshotRef = '.sciforge/vision-runs/cu-risk/step-001-before.png';
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = `${commandId}-attempt-1`;
      return new Response([
        'event: message\n',
        'data: {"type":"message","text":"RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER"}\n\n',
        'event: workspace_event\n',
        `data: ${JSON.stringify({
          type: 'computer-use.tui-host-actions',
          source: 'computer-use-package-bridge',
          commandId,
          attemptId,
          detail: JSON.stringify({
            actions: [{
              schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
              port: 'gui.present',
              target: 'computer-use.trace-summary',
              payload: {
                title: 'Computer Use result',
                status: 'needs-confirmation',
                message: 'Computer Use stopped before the guarded action.',
                traceRefs: [traceRef],
                screenshotRefs: [screenshotRef],
                artifactRefs: [],
                executionUnitRefs: ['EU-computer-use-risk'],
                workEvidenceRefs: ['workEvidence:vision-sense-computer-use:cu-risk'],
              },
            }, {
              schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
              port: 'gui.ask_user',
              target: 'computer-use.approval-request',
              payload: {
                approvalRequest: {
                  id: 'approval:computer-use:cu-risk',
                  confirmation_text: 'Allow Computer Use to click the visible Submit button?',
                  risk_level: 'high',
                  action_kind: 'click',
                },
                relatedRefs: [traceRef, screenshotRef],
              },
            }],
          }),
        })}\n\n`,
        'event: done\n',
        `data: ${JSON.stringify({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          status: 'done',
          message: 'Runtime Codex completed successfully.',
          provider: 'sciforge-deepseek-proxy',
          model: 'bailian/deepseek-v4-flash',
          profile: 'sciforge-runtime-deepseek',
          workspace: '/tmp/current',
          commandId,
          attemptId,
        })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const guiPresentation = raw.guiPresentation as Record<string, unknown>;
    const guiAskUser = raw.guiAskUser as Record<string, unknown>;

    assert.equal(response.message.provenance?.requiresUserConfirmation, true);
    assert.match(String(response.message.provenance?.source), /^gui\.ask_user:codex-command-.*:computer-use$/);
    assert.match(response.message.content, /Allow Computer Use to click the visible Submit button/);
    assert.match(response.message.content, /Action kind: `click`/);
    assert.equal(guiPresentation.source, `gui.present:${response.run.id}:computer-use`);
    assert.equal(guiPresentation.status, 'needs-confirmation');
    assert.deepEqual(guiPresentation.displayedRefs, [
      traceRef,
      screenshotRef,
      'EU-computer-use-risk',
      'workEvidence:vision-sense-computer-use:cu-risk',
    ]);
    assert.equal(guiAskUser.source, `gui.ask_user:${response.run.id}:computer-use`);
    assert.equal((guiAskUser.approvalRequest as Record<string, unknown>).id, 'approval:computer-use:cu-risk');
    assert.deepEqual(guiAskUser.relatedRefs, [traceRef, screenshotRef]);
    assert.deepEqual(response.message.objectReferences?.map((reference) => reference.ref), [
      `file:${traceRef}`,
      `file:${screenshotRef}`,
    ]);
    assert.doesNotMatch(response.message.content, /RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Computer Use approval retry sends approvalRef only for approve terminal-equivalent text', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      return new Response(`${JSON.stringify({
        result: {
          status: 'done',
          message: 'Computer Use approval retry accepted.',
          claimType: 'execution',
          evidenceLevel: 'runtime',
          reasoningTrace: 'test Computer Use approval retry',
          claims: [],
          uiManifest: [],
          executionUnits: [{ id: `EU-${body.commandId}`, status: 'done' }],
          artifacts: [],
        },
      })}\n`, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: '/computer-use approve --approval-ref "approval:computer-use:cu-risk"',
    });
    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: '/computer-use reject --approval-ref "approval:computer-use:cu-risk"',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const approveBody = bodies[0]!;
  const rejectBody = bodies[1]!;
  const approveUiState = approveBody.uiState as Record<string, unknown>;
  const rejectUiState = rejectBody.uiState as Record<string, unknown>;
  assert.equal(approveBody.prompt, '/computer-use approve --approval-ref "approval:computer-use:cu-risk"');
  assert.deepEqual(approveBody.humanApproval, { approvalRef: 'approval:computer-use:cu-risk' });
  assert.equal(approveUiState.approvalRef, 'approval:computer-use:cu-risk');
  assert.deepEqual(approveUiState.humanApproval, { approvalRef: 'approval:computer-use:cu-risk' });
  assert.equal(rejectBody.prompt, '/computer-use reject --approval-ref "approval:computer-use:cu-risk"');
  assert.equal(rejectBody.humanApproval, undefined);
  assert.equal(rejectUiState.approvalRef, undefined);
  assert.equal(rejectUiState.humanApproval, undefined);
});

test('Runtime Codex realtime transport marker declares RT-02 WebSocket bridge complete', () => {
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.rtGapId, 'RT-02');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.currentTransport, 'websocket');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.targetTransport, 'websocket');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.targetCapability, 'bidirectional-send-receive');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.websocketComplete, true);
  assert.deepEqual(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.blockers, []);
});

test('Runtime Codex raw JSONL and stderr warnings normalize to folded audit summaries', () => {
  const rawJsonl = normalizeWorkspaceRuntimeEvent({
    type: 'raw_jsonl',
    rawJsonl: '{"secret":"RAW_JSONL_SHOULD_NOT_RENDER"}',
    presentationRole: 'audit',
  });
  const stderr = normalizeWorkspaceRuntimeEvent({
    type: 'audit',
    status: 'stderr',
    message: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json',
    raw: { stream: 'stderr', chunk: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json' },
  });

  assert.match(rawJsonl.detail ?? '', /raw JSONL recorded/i);
  assert.match(stderr.detail ?? '', /plugin manifest warning recorded/i);
  assert.doesNotMatch(rawJsonl.detail ?? '', /RAW_JSONL_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(stderr.detail ?? '', /failed to load plugin|\/tmp\/plugin\.json/);
});

test('Runtime Codex provider message events summarize native-message layering without leaking raw payload internals', () => {
  const event = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'message',
    text: 'RAW_PROVIDER_MESSAGE_SHOULD_NOT_SURFACE',
    commandId: 'codex-command-provider-message',
    profile: 'sciforge-runtime-deepseek',
  });

  assert.match(event.detail ?? '', /native assistant message recorded/i);
  assert.match(event.detail ?? '', /folded in the run audit/i);
  assert.doesNotMatch(event.detail ?? '', /RAW_PROVIDER_MESSAGE_SHOULD_NOT_SURFACE/);
});

test('Runtime Codex foreground final message can use native assistant message provenance', async () => {
  const originalFetch = globalThis.fetch;
  const commandIdPattern = /^codex-command-/;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      assert.match(commandId, commandIdPattern);
      return new Response([
        'event: message\n',
        `data: ${JSON.stringify({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'message',
          text: 'VISIBLE_FOREGROUND_NATIVE_MESSAGE',
          provider: 'sciforge-deepseek-proxy',
          model: 'bailian/deepseek-v4-flash',
          profile: 'sciforge-runtime-deepseek',
          workspace: '/tmp/current',
          commandId,
          attemptId: `${commandId}-attempt-1`,
        })}\n\n`,
        'event: done\n',
        `data: ${JSON.stringify({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          status: 'done',
          message: 'Runtime Codex completed successfully.',
          provider: 'sciforge-deepseek-proxy',
          model: 'bailian/deepseek-v4-flash',
          profile: 'sciforge-runtime-deepseek',
          workspace: '/tmp/current',
          commandId,
          attemptId: `${commandId}-attempt-1`,
        })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());

    assert.equal(response.message.content, 'VISIBLE_FOREGROUND_NATIVE_MESSAGE');
    assert.equal(response.message.provenance?.kind, 'live-runtime-codex');
    assert.match(String(response.message.provenance?.source), /^codex\.native-message:codex-command-/);
    assert.equal(response.message.provenance?.liveAcceptanceEligible, false);
    const raw = response.run.raw as Record<string, unknown>;
    const nativeMessage = raw.nativeCodexMessage as Record<string, unknown>;
    assert.equal(nativeMessage.liveAcceptanceEligible, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex foreground final message uses gui.present provenance', async () => {
  const originalFetch = globalThis.fetch;
  const commandIdPattern = /^codex-command-/;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      assert.match(commandId, commandIdPattern);
      return new Response([
        'event: message\n',
        'data: {"type":"message","text":"RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER"}\n\n',
        'event: gui_present\n',
        `data: ${JSON.stringify({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'gui_present',
          text: 'VISIBLE_FOREGROUND_GUI_PRESENT',
          provider: 'sciforge-deepseek-proxy',
          model: 'bailian/deepseek-v4-flash',
          profile: 'sciforge-runtime-deepseek',
          workspace: '/tmp/current',
          commandId,
          attemptId: `${commandId}-attempt-1`,
          raw: {
            source: `gui.present:${commandId}`,
            presentation: {
              source: `gui.present:${commandId}`,
              text: 'VISIBLE_FOREGROUND_GUI_PRESENT',
              ref: '.sciforge/artifacts/live-selected-report.md',
              title: 'Live selected report',
              hint: 'markdown',
            },
          },
        })}\n\n`,
        'event: done\n',
        `data: ${JSON.stringify({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          status: 'done',
          message: 'Runtime Codex completed successfully.',
          provider: 'sciforge-deepseek-proxy',
          model: 'bailian/deepseek-v4-flash',
          profile: 'sciforge-runtime-deepseek',
          workspace: '/tmp/current',
          commandId,
          attemptId: `${commandId}-attempt-1`,
        })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());

    assert.equal(response.message.content, 'VISIBLE_FOREGROUND_GUI_PRESENT');
    assert.equal(response.message.provenance?.kind, 'live-runtime-codex');
    assert.match(String(response.message.provenance?.source), /^gui\.present:codex-command-/);
    assert.equal(response.message.provenance?.liveAcceptanceEligible, true);
    assert.deepEqual(response.message.objectReferences?.map((reference) => reference.ref), ['file:.sciforge/artifacts/live-selected-report.md']);
    assert.equal(response.message.objectReferences?.[0]?.provenance?.path, '.sciforge/artifacts/live-selected-report.md');
    assert.deepEqual(response.run.objectReferences?.map((reference) => reference.ref), ['file:.sciforge/artifacts/live-selected-report.md']);
    assert.doesNotMatch(response.message.content, /RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex gui.present preserves explicit file and run references instead of coercing to artifacts', async () => {
  const originalFetch = globalThis.fetch;
  const refs = ['file:reports/final.md', 'run:run-visible-preview'];
  try {
    for (const ref of refs) {
      globalThis.fetch = (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const commandId = String(body.commandId);
        return new Response([
          'event: gui_present\n',
          `data: ${JSON.stringify({
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'gui_present',
            text: `PRESENTED ${ref}`,
            provider: 'sciforge-deepseek-proxy',
            model: 'bailian/deepseek-v4-flash',
            profile: 'sciforge-runtime-deepseek',
            workspace: '/tmp/current',
            commandId,
            attemptId: `${commandId}-attempt-1`,
            raw: {
              presentation: {
                source: `gui.present:${commandId}`,
                text: `PRESENTED ${ref}`,
                intent: 'focus-existing',
                ref,
                hint: ref.startsWith('file:') ? 'markdown' : 'auto',
              },
            },
          })}\n\n`,
          'event: done\n',
          `data: ${JSON.stringify({
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            status: 'done',
            message: 'Runtime Codex completed successfully.',
            provider: 'sciforge-deepseek-proxy',
            model: 'bailian/deepseek-v4-flash',
            profile: 'sciforge-runtime-deepseek',
            workspace: '/tmp/current',
            commandId,
            attemptId: `${commandId}-attempt-1`,
          })}\n\n`,
        ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }) as typeof fetch;

      const response = await sendSciForgeToolMessage(runtimeRequestInput());
      assert.deepEqual(response.message.objectReferences?.map((reference) => [reference.kind, reference.ref]), [
        ref.startsWith('file:') ? ['file', ref] : ['run', ref],
      ]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex gui.present stores event session lineage for selected artifact resume', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const eventCodexSessionId = '019e4332-4e6a-79a0-9a01-d35253a5614a';
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      const commandId = String(body.commandId);
      if (bodies.length === 1) {
        return new Response([
          'event: gui_present\n',
          `data: ${JSON.stringify({
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'gui_present',
            text: 'VISIBLE_EVENT_SESSION_ARTIFACT',
            provider: 'sciforge-deepseek-proxy',
            model: 'bailian/deepseek-v4-flash',
            profile: 'sciforge-runtime-deepseek',
            workspace: '/tmp/current',
            commandId,
            attemptId: `${commandId}-attempt-1`,
            codexSessionId: eventCodexSessionId,
            raw: {
              source: `gui.present:${commandId}`,
              presentation: {
                source: `gui.present:${commandId}`,
                text: 'VISIBLE_EVENT_SESSION_ARTIFACT',
                ref: '.sciforge/artifacts/live-selected-report.md',
                title: 'Live selected report',
                hint: 'markdown',
              },
            },
          })}\n\n`,
          'event: done\n',
          `data: ${JSON.stringify({
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            status: 'done',
            message: 'Runtime Codex completed successfully.',
            provider: 'sciforge-deepseek-proxy',
            model: 'bailian/deepseek-v4-flash',
            profile: 'sciforge-runtime-deepseek',
            workspace: '/tmp/current',
            commandId,
            attemptId: `${commandId}-attempt-1`,
          })}\n\n`,
        ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const first = await sendSciForgeToolMessage(runtimeRequestInput());
    assert.equal((first.run.raw as Record<string, unknown>).codexSessionId, eventCodexSessionId);
    assert.deepEqual(first.run.objectReferences?.map((reference) => reference.ref), [
      'file:.sciforge/artifacts/live-selected-report.md',
      `codex-thread:${eventCodexSessionId}`,
    ]);

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: 'Follow the selected artifact only',
      references: [{
        id: 'ref-live-selected-report',
        kind: 'task-result',
        title: 'Live selected report',
        ref: 'artifact:live-selected-report',
        runId: first.run.id,
        payload: {
          currentReference: {
            id: 'live-selected-report',
            ref: 'artifact:live-selected-report',
            runId: first.run.id,
            provenance: {
              dataRef: '.sciforge/artifacts/live-selected-report.md',
            },
          },
        },
      }],
      artifacts: [{
        id: 'live-selected-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/artifacts/live-selected-report.md',
        metadata: { runId: first.run.id },
      }],
      runs: [first.run],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const secondBody = bodies[1]!;
  assert.equal(secondBody.codexSessionId, eventCodexSessionId);
  assert.match(String(secondBody.commandText ?? ''), /^Continue the active Runtime Codex session\./);
  assert.match(String(secondBody.commandText ?? ''), /artifact:live-selected-report/);
});

test('Runtime Codex annotation quick action starts a fresh native thread even with selected lineage', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const previousCodexSessionId = '019e4f00-0000-7000-9000-annotationold';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      turnMode: 'annotation-quick-action',
      conversationLaneId: 'annotation:session-test:draft-quick:quick-action',
      runtimeResumePolicy: 'none',
      conversationEnvelope: {
        schemaVersion: 'sciforge.annotation-quick-action-envelope.v1',
        kind: 'annotation-quick-action',
        draftId: 'draft-quick',
      },
      prompt: 'Apply a small local wording tweak',
      references: [{
        id: 'ref-selected-report',
        kind: 'task-result',
        title: 'Selected report',
        ref: 'artifact:selected-report',
        runId: 'run-selected-report',
        payload: {
          currentReference: {
            id: 'selected-report',
            ref: 'artifact:selected-report',
            runId: 'run-selected-report',
            provenance: { dataRef: '.sciforge/artifacts/selected-report.md' },
          },
        },
      }],
      artifacts: [{
        id: 'selected-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/artifacts/selected-report.md',
        metadata: { runId: 'run-selected-report' },
      }],
      runs: [{
        id: 'run-selected-report',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'create selected report',
        response: 'selected report',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: { codexSessionId: previousCodexSessionId },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  const realtimeSession = body.realtimeSession as Record<string, unknown>;
  assert.equal(body.codexSessionId, undefined);
  assert.equal(realtimeSession.codexSessionId, undefined);
  assert.equal(realtimeSession.resumeRequested, false);
  assert.doesNotMatch(String(body.commandText ?? ''), /^Continue the active Runtime Codex session\./);
  assert.match(String(body.commandText ?? ''), /artifact:selected-report/);
  assert.equal('turnMode' in body, false);
  assert.equal('conversationEnvelope' in body, false);
  assert.equal('conversationLaneId' in body, false);
});

test('Runtime Codex stream request carries command text and adapter metadata only', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage(runtimeRequestInput());
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  assert.deepEqual(Object.keys(body).sort(), [
    'allowOpenAiRuntime',
    'attemptId',
    'auditMetadata',
    'commandId',
    'commandText',
    'guiExtension',
    'profile',
    'realtimeSession',
    'schemaVersion',
    'workspacePath',
  ].sort());
  assert.equal(body.commandText, 'ask --ref "artifact:report-1" "Summarize current context"');
  assert.equal(body.workspacePath, '/tmp/current');
  assert.equal(body.profile, 'sciforge-runtime-deepseek');
  const realtimeSession = body.realtimeSession as Record<string, unknown>;
  assert.equal(realtimeSession.schemaVersion, 'sciforge.codex-realtime-session.v1');
  assert.equal(realtimeSession.bridge, 'codex-native-realtime-session');
  assert.equal(realtimeSession.streamKind, 'structured-events-plus-terminal-equivalent-text');
  assert.equal(realtimeSession.eventTransport, 'sse');
  assert.equal(realtimeSession.eventContract, 'structured-events');
  assert.equal(realtimeSession.inputTextKind, 'terminal-equivalent-text');
  assert.equal(realtimeSession.rawTerminal, false);
  assert.equal(realtimeSession.commandId, body.commandId);
  assert.equal(realtimeSession.attemptId, body.attemptId);
  assert.equal(realtimeSession.resumeRequested, false);
  assert.match(String(body.commandId), /^codex-command-/);
  assert.match(String(body.attemptId), /^codex-command-.*-attempt-1$/);
  assert.deepEqual(body.guiExtension, { enabled: true });
  assert.equal(typeof body.auditMetadata, 'object');

  const forbiddenKeys = [
    'prompt',
    'messages',
    'transcript',
    'sessionMessages',
    'seedMessages',
    'demoMessages',
    'artifacts',
    'artifactBody',
    'artifactData',
    'claims',
    'claim',
    'expectedArtifactTypes',
    'expectedResult',
    'expectedResults',
    'selectedSkillIds',
    'selectedToolIds',
    'toolProviderRoutes',
    'providerRoute',
    'toolRoute',
    'routeDecision',
    'failureRecoveryPolicy',
    'uiState',
    'references',
    'turnMode',
    'conversationEnvelope',
    'conversationLaneId',
    'runtimeResumePolicy',
  ];
  assert.deepEqual(recursiveForbiddenKeys(body, forbiddenKeys), []);
  assert.doesNotMatch(JSON.stringify(body), /SEED_MESSAGE_SHOULD_NOT_LEAK|ARTIFACT_BODY_SHOULD_NOT_LEAK|CLAIM_BODY_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(JSON.stringify(body), /legacy\.skill|127\.0\.0\.1:7777|preserve-context/);
  assert.doesNotMatch(JSON.stringify(body), /raw-terminal|pty|raw-bytes/);
});

test('Runtime Codex stream request resumes from persisted nested Runtime Codex session metadata', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const previousCodexSessionId = '019e3e82-164d-79b2-a5d4-b16241620b10';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      runs: [{
        id: 'codex-command-previous',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'previous prompt',
        response: 'previous answer',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: {
          ok: true,
          data: {
            run: {
              id: 'codex-command-previous',
              output: {
                result: JSON.stringify({
                  type: 'done',
                  status: 'done',
                  codexSessionId: previousCodexSessionId,
                  output: {
                    codexSessionId: previousCodexSessionId,
                    message: 'previous answer',
                  },
                }),
              },
            },
          },
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies[0]?.codexSessionId, previousCodexSessionId);
  assert.equal((bodies[0]?.realtimeSession as Record<string, unknown>).codexSessionId, previousCodexSessionId);
  assert.equal((bodies[0]?.realtimeSession as Record<string, unknown>).threadRef, `codex-thread:${previousCodexSessionId}`);
  assert.equal((bodies[0]?.realtimeSession as Record<string, unknown>).resumeRequested, true);
});

test('Runtime Codex same-lane resume ignores latest native session from another conversation lane', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const otherLaneCodexSessionId = '019e3e82-9999-79b2-a5d4-otherlane';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      conversationLaneId: 'workbench:literature-evidence-review:session-b',
      runs: [{
        id: 'codex-command-other-lane',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'other lane prompt',
        response: 'other lane answer',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: {
          codexSessionId: otherLaneCodexSessionId,
          conversationLaneId: 'workbench:literature-evidence-review:session-a',
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies[0]?.codexSessionId, undefined);
  assert.equal((bodies[0]?.realtimeSession as Record<string, unknown>).resumeRequested, false);
  assert.doesNotMatch(String(bodies[0]?.commandText ?? ''), /^Continue the active Runtime Codex session\./);
});

test('Runtime Codex native resume keeps GUI follow-up as command text plus refs only', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const previousCodexSessionId = '019e3f11-3ef6-7d8a-90e7-2a55304fcb21';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: 'Extract reusable method notes from the selected report',
      references: [{
        id: 'ref-selected-report',
        kind: 'task-result',
        title: 'Selected report',
        ref: 'artifact:selected-report',
        payload: {
          dataRef: '.sciforge/sessions/session-live/task-results/selected-report.md',
          selectedText: 'SELECTED_REPORT_BODY_SHOULD_NOT_REPLAY',
        },
      }],
      messages: [{
        id: 'msg-old-gui',
        role: 'scenario',
        content: 'GUI_TRANSCRIPT_SHOULD_NOT_REPLAY',
        createdAt: '2026-05-19T00:00:00.000Z',
        status: 'completed',
      }],
      artifacts: [{
        id: 'selected-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        data: { markdown: 'FULL_ARTIFACT_BODY_SHOULD_NOT_REPLAY' },
      }],
      runs: [{
        id: 'codex-command-previous-native',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'PREVIOUS_USER_REQUEST_SHOULD_NOT_REPLAY',
        response: 'PREVIOUS_NATIVE_ANSWER_SHOULD_NOT_REPLAY',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: {
          codexRuntimeFailure: {
            recoverState: {
              codexSessionId: previousCodexSessionId,
            },
          },
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  const commandText = String(body.commandText ?? '');
  assert.equal(body.codexSessionId, previousCodexSessionId);
  assert.match(commandText, /^Continue the active Runtime Codex session\./);
  assert.match(commandText, /immediately preceding non-seed user\/assistant exchange/);
  assert.match(commandText, /ask --ref "\.sciforge\/sessions\/session-live\/task-results\/selected-report\.md" --ref "artifact:selected-report" "Extract reusable method notes from the selected report"/);
  assert.doesNotMatch(JSON.stringify(body), /GUI_TRANSCRIPT_SHOULD_NOT_REPLAY|FULL_ARTIFACT_BODY_SHOULD_NOT_REPLAY|SELECTED_REPORT_BODY_SHOULD_NOT_REPLAY/);
  assert.doesNotMatch(commandText, /PREVIOUS_USER_REQUEST_SHOULD_NOT_REPLAY|PREVIOUS_NATIVE_ANSWER_SHOULD_NOT_REPLAY/);
});

test('Runtime Codex same-chat relative follow-up carries bounded continuity when native thread id is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: message\n',
        'data: {"type":"message","text":"SCIFORGE-CODEX-BROWSER-MT-20260520A"}\n\n',
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: 'Now reply only with the passphrase from the previous turn.',
      references: [],
      artifacts: [],
      messages: [
        {
          id: 'msg-prior-user',
          role: 'user',
          content: '[previous-message omitted]',
          continuityContent: 'Remember this passphrase: SCIFORGE-CODEX-BROWSER-MT-20260520A.',
          createdAt: '2026-05-19T00:00:00.000Z',
          status: 'completed',
        } as NonNullable<SendAgentMessageInput['messages']>[number] & { continuityContent: string },
        {
          id: 'msg-current',
          role: 'user',
          content: 'Now reply only with the passphrase from the previous turn.',
          createdAt: '2026-05-19T00:00:01.000Z',
          status: 'completed',
        },
      ],
      runs: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  const commandText = String(body.commandText ?? '');
  assert.equal(body.codexSessionId, undefined);
  assert.match(commandText, /^Same-chat continuity context for relative references\./);
  assert.match(commandText, /SCIFORGE-CODEX-BROWSER-MT-20260520A/);
  assert.match(commandText, /Current request:\n\nNow reply only with the passphrase from the previous turn\./);
});

test('Runtime Codex selected artifact resume prefers selected lineage session over latest session', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const selectedCodexSessionId = '019e3f11-0000-7000-9000-selectedcodex';
  const latestCodexSessionId = '019e3f11-9999-7000-9000-latestcodex';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: 'Continue from the selected report only',
      references: [{
        id: 'ref-selected-report',
        kind: 'task-result',
        title: 'Selected report',
        ref: 'artifact:selected-report',
        runId: 'run-selected-report',
        payload: {
          currentReference: {
            id: 'selected-report',
            ref: 'artifact:selected-report',
            runId: 'run-selected-report',
            provenance: {
              dataRef: '.sciforge/sessions/session-live/task-results/selected-report.md',
            },
          },
        },
      }],
      artifacts: [{
        id: 'selected-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/sessions/session-live/task-results/selected-report.md',
        metadata: { runId: 'run-selected-report' },
      }],
      runs: [{
        id: 'run-selected-report',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'create selected report',
        response: 'selected report',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: { codexSessionId: selectedCodexSessionId },
        objectReferences: [{ id: 'obj-selected-report', kind: 'artifact', title: 'Selected report', ref: 'artifact:selected-report', runId: 'run-selected-report' }],
      }, {
        id: 'run-latest-unselected',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'newer unrelated report',
        response: 'latest report',
        createdAt: '2026-05-19T00:10:00.000Z',
        completedAt: '2026-05-19T00:10:01.000Z',
        raw: { codexSessionId: latestCodexSessionId },
        objectReferences: [{ id: 'obj-latest-report', kind: 'artifact', title: 'Latest report', ref: 'artifact:latest-report', runId: 'run-latest-unselected' }],
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  assert.equal(body.codexSessionId, selectedCodexSessionId);
  assert.notEqual(body.codexSessionId, latestCodexSessionId);
  assert.match(String(body.commandText ?? ''), /artifact:selected-report/);
});

test('Runtime Codex selected artifact resume prefers producer object lineage over newer follow-up references', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const selectedCodexSessionId = '019e3f11-1111-7000-9000-selectedsource';
  const newerFollowupSessionId = '019e3f11-2222-7000-9000-newerfollowup';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      prompt: 'Continue from the selected source artifact only',
      references: [{
        id: 'ref-selected-source',
        kind: 'task-result',
        title: 'Selected source',
        ref: 'artifact:r-resume-01-clean-source',
        sourceId: 'r-resume-01-clean-source',
        payload: {
          currentReference: {
            id: 'r-resume-01-clean-source',
            ref: 'artifact:r-resume-01-clean-source',
            provenance: {
              dataRef: '.sciforge/artifacts/r-resume-01-clean-source.md',
            },
          },
        },
      }],
      runs: [{
        id: 'run-selected-source',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'create source',
        response: 'source',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: { codexSessionId: selectedCodexSessionId },
        objectReferences: [{
          id: 'r-resume-01-clean-source',
          kind: 'artifact',
          title: 'Selected source',
          ref: 'artifact:r-resume-01-clean-source',
          runId: 'run-selected-source',
          provenance: { dataRef: '.sciforge/artifacts/r-resume-01-clean-source.md' },
        }],
      }, {
        id: 'run-newer-followup',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'newer follow-up',
        response: 'newer',
        createdAt: '2026-05-19T00:10:00.000Z',
        completedAt: '2026-05-19T00:10:01.000Z',
        raw: { codexSessionId: newerFollowupSessionId },
        references: [{
          id: 'ref-followup-source',
          kind: 'task-result',
          title: 'Selected source',
          ref: 'artifact:r-resume-01-clean-source',
        }],
        objectReferences: [{
          id: 'r-resume-01-derived',
          kind: 'artifact',
          title: 'Derived',
          ref: 'artifact:r-resume-01-derived',
          runId: 'run-newer-followup',
        }],
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  assert.equal(body.codexSessionId, selectedCodexSessionId);
  assert.notEqual(body.codexSessionId, newerFollowupSessionId);
  assert.match(String(body.commandText ?? ''), /artifact:r-resume-01-clean-source/);
});

test('Runtime Codex stream request carries selected artifact dataRef before short artifact ref', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      references: [{
        id: 'ref-report',
        kind: 'task-result',
        title: 'Report',
        ref: 'artifact:report-1',
        payload: {
          dataRef: '.sciforge/sessions/session-live/task-results/report.md',
          selectedText: 'ARTIFACT_BODY_SHOULD_NOT_LEAK',
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const commandText = String(bodies[0]?.commandText ?? '');
  assert.equal(commandText.includes('--ref ".sciforge/sessions/session-live/task-results/report.md"'), true);
  assert.equal(commandText.includes('--ref "artifact:report-1"'), true);
  assert.equal(commandText.indexOf('task-results/report.md') < commandText.indexOf('artifact:report-1'), true);
  assert.doesNotMatch(commandText, /ARTIFACT_BODY_SHOULD_NOT_LEAK/);
});

test('Runtime Codex stream request excludes selected seed and fixture refs from command text and audit refs', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      references: [{
        id: 'ref-seed-message',
        kind: 'message',
        title: 'Seed message',
        ref: 'message:seed-demo',
      }, {
        id: 'ref-seed-ui-text',
        kind: 'ui',
        title: 'Seed selection',
        ref: 'ui-text:message:seed-demo#quote',
        payload: {
          sourceRef: 'message:seed-demo',
          selectedText: 'SEED_SELECTED_TEXT_SHOULD_NOT_ENTER_CODEX',
        },
      }, {
        id: 'ref-live-report',
        kind: 'task-result',
        title: 'Live report',
        ref: 'artifact:report-1',
      }],
      messages: [{
        id: 'seed-demo',
        role: 'scenario',
        content: 'SEED_MESSAGE_SHOULD_NOT_LEAK',
        createdAt: '2026-05-19T00:00:00.000Z',
        status: 'completed',
        provenance: {
          kind: 'seed-demo',
          source: 'scenarioDemoData:literature-evidence-review',
          runtimeRequestEligible: false,
          liveAcceptanceEligible: false,
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  const serialized = JSON.stringify(body);
  assert.equal(body.commandText, 'ask --ref "artifact:report-1" "Summarize current context"');
  assert.doesNotMatch(serialized, /message:seed-demo|ui-text:message:seed-demo|SEED_SELECTED_TEXT_SHOULD_NOT_ENTER_CODEX/);
  assert.match(serialized, /artifact:report-1/);
});

test('Runtime Codex stream request keeps live native-session refs even when not live-acceptance eligible', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      references: [{
        id: 'ref-live-native-message',
        kind: 'message',
        title: 'Native Runtime Codex answer',
        ref: 'message:live-native',
      }],
      messages: [{
        id: 'live-native',
        role: 'scenario',
        content: 'VISIBLE_BUT_NOT_LIVE_ACCEPTANCE',
        createdAt: '2026-05-19T00:00:00.000Z',
        status: 'completed',
        provenance: {
          kind: 'live-runtime-codex',
          source: 'codex.native-message:codex-command-native',
          runtimeRequestEligible: false,
          liveAcceptanceEligible: false,
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const serialized = JSON.stringify(bodies[0]);
  assert.match(String(bodies[0]?.commandText ?? ''), /message:live-native/);
  assert.match(serialized, /message:live-native/);
});

test('Runtime Codex failed SSE returns a persistable failed run with folded audit refs', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = String(body.attemptId);
      const stderrRef = `audit:codex-runtime:${commandId}:${attemptId}:stderr`;
      return new Response([
      'event: run_started\n',
      `data: ${JSON.stringify({ type: 'run_started', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, evidenceRefs: [stderrRef] })}\n\n`,
      'event: audit\n',
      `data: ${JSON.stringify({ type: 'audit', status: 'stderr', message: 'RAW_STDERR_SHOULD_NOT_RENDER', raw: { stream: 'stderr', chunk: 'RAW_STDERR_SHOULD_NOT_RENDER' }, commandId, attemptId })}\n\n`,
      'event: failed\n',
      `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: 'Runtime Codex exited with code 7.', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, exitCode: 7, raw: { stderrSummary: 'RAW_STDERR_SHOULD_NOT_RENDER', evidenceRefs: [stderrRef] } })}\n\n`,
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const failure = raw.codexRuntimeFailure as Record<string, unknown>;
    const audit = raw.runtimeAudit as Record<string, unknown>;

    assert.equal(response.run.status, 'failed');
    assert.equal(response.run.id.startsWith('codex-command-'), true);
    assert.equal(failure.schemaVersion, 'sciforge.runtime-codex-failed-run.v1');
    assert.equal(failure.commandId, response.run.id);
    assert.equal(failure.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(failure.workspace, '/tmp/current');
    assert.equal(failure.profile, 'sciforge-runtime-deepseek');
    assert.equal(failure.provider, 'sciforge-deepseek-proxy');
    assert.equal(failure.model, 'bailian/deepseek-v4-flash');
    assert.equal(failure.exitCode, 7);
    assert.equal(failure.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.equal(failure.failureKind, 'runtime-exit');
    assert.equal(failure.ownerLayer, 'runtime-codex');
    assert.equal(failure.retryable, true);
    assert.equal(failure.nativeResumeSupported, false);
    assert.ok((failure.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
    const recoverState = failure.recoverState as Record<string, unknown>;
    assert.equal(recoverState.status, 'repair-needed');
    assert.equal(recoverState.failureKind, 'runtime-exit');
    assert.equal(recoverState.ownerLayer, 'runtime-codex');
    assert.equal(recoverState.retryable, true);
    assert.equal(recoverState.nativeResumeSupported, false);
    assert.equal(recoverState.resumeStrategy, 'audit-only-retry');
    assert.equal(recoverState.commandId, response.run.id);
    assert.equal(recoverState.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(recoverState.workspace, '/tmp/current');
    assert.equal(recoverState.profile, 'sciforge-runtime-deepseek');
    assert.equal(recoverState.provider, 'sciforge-deepseek-proxy');
    assert.equal(recoverState.model, 'bailian/deepseek-v4-flash');
    assert.equal(recoverState.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.ok((recoverState.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
    assert.equal(audit.foldedByDefault, true);
    assert.doesNotMatch(response.message.content, /RAW_STDERR_SHOULD_NOT_RENDER/);

    const reloadedRun = JSON.parse(JSON.stringify(response.run)) as typeof response.run;
    const reloadedRaw = reloadedRun.raw as Record<string, unknown>;
    const reloadedFailure = reloadedRaw.codexRuntimeFailure as Record<string, unknown>;
    assert.equal(reloadedRun.status, 'failed');
    assert.equal(reloadedFailure.commandId, response.run.id);
    assert.equal(reloadedFailure.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(reloadedFailure.workspace, '/tmp/current');
    assert.equal(reloadedFailure.profile, 'sciforge-runtime-deepseek');
    assert.equal(reloadedFailure.provider, 'sciforge-deepseek-proxy');
    assert.equal(reloadedFailure.model, 'bailian/deepseek-v4-flash');
    assert.equal(reloadedFailure.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    const reloadedRecoverState = reloadedFailure.recoverState as Record<string, unknown>;
    assert.equal(reloadedRecoverState.status, 'repair-needed');
    assert.equal(reloadedRecoverState.commandId, response.run.id);
    assert.equal(reloadedRecoverState.workspace, '/tmp/current');
    assert.equal(reloadedRecoverState.profile, 'sciforge-runtime-deepseek');
    assert.equal(reloadedRecoverState.provider, 'sciforge-deepseek-proxy');
    assert.equal(reloadedRecoverState.model, 'bailian/deepseek-v4-flash');
    assert.equal(reloadedRecoverState.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.ok((reloadedFailure.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex provider auth failures surface a sanitized recoverable reason', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = String(body.attemptId);
      const stderrRef = `audit:codex-runtime:${commandId}:${attemptId}:stderr`;
      const rawStderr = 'unexpected status 401 Unauthorized: Invalid token (request id: req-secret-123), url: http://127.0.0.1:3891/v1/responses';
      return new Response([
        'event: run_started\n',
        `data: ${JSON.stringify({ type: 'run_started', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, evidenceRefs: [stderrRef] })}\n\n`,
        'event: failed\n',
        `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: rawStderr, provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId })}\n\n`,
        'event: failed\n',
        `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: 'Runtime Codex exited with code 1.', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, exitCode: 1, raw: { stderrSummary: 'startup warning before provider failure', evidenceRefs: [stderrRef] } })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const failure = raw.codexRuntimeFailure as Record<string, unknown>;
    const recoverState = failure.recoverState as Record<string, unknown>;
    const publicReason = 'Runtime Codex provider rejected credentials (401 Unauthorized). Check SCIFORGE_RUNTIME_API_KEY and the configured proxy upstream.';

    assert.equal(failure.publicFailureReason, publicReason);
    assert.equal(recoverState.publicFailureReason, publicReason);
    assert.equal(failure.failureKind, 'provider-auth');
    assert.equal(failure.ownerLayer, 'provider-config');
    assert.equal(failure.retryable, false);
    assert.doesNotMatch(response.message.content, /Invalid token|req-secret-123|127\.0\.0\.1:3891/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex provider gateway failures surface a retryable upstream reason', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = String(body.attemptId);
      const rawGateway = 'unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses';
      return new Response([
        'event: failed\n',
        `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: rawGateway, provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId })}\n\n`,
        'event: failed\n',
        `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: 'Runtime Codex exited with code 1.', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, exitCode: 1 })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const failure = raw.codexRuntimeFailure as Record<string, unknown>;
    const recoverState = failure.recoverState as Record<string, unknown>;
    const publicReason = 'Runtime Codex provider gateway returned 502 Bad Gateway. Treat this as an upstream/transient provider failure and retry with preserved audit refs.';

    assert.equal(failure.publicFailureReason, publicReason);
    assert.equal(recoverState.publicFailureReason, publicReason);
    assert.equal(failure.failureKind, 'provider-gateway');
    assert.equal(failure.ownerLayer, 'provider-upstream');
    assert.equal(failure.retryable, true);
    assert.doesNotMatch(response.message.content, /127\.0\.0\.1:3891/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Runtime Codex DNS failures are classified as retryable external-network without leaking raw URLs', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = String(body.attemptId);
      const stderrRef = `audit:codex-runtime:${commandId}:${attemptId}:stderr`;
      const rawDnsFailure = 'getaddrinfo ENOTFOUND export.arxiv.org, url: https://export.arxiv.org/api/query?search_query=agentic+RL';
      return new Response([
        'event: audit\n',
        `data: ${JSON.stringify({ type: 'audit', status: 'stderr', raw: { stream: 'stderr', chunk: rawDnsFailure }, commandId, attemptId })}\n\n`,
        'event: failed\n',
        `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: 'Runtime Codex exited with code 1.', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, exitCode: 1, raw: { stderrSummary: rawDnsFailure, evidenceRefs: [stderrRef] } })}\n\n`,
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const failure = raw.codexRuntimeFailure as Record<string, unknown>;
    const recoverState = failure.recoverState as Record<string, unknown>;
    const publicReason = 'Runtime Codex provider network request failed. Check network access and the configured proxy upstream.';

    assert.equal(failure.failureKind, 'external-network');
    assert.equal(failure.ownerLayer, 'external-network');
    assert.equal(failure.retryable, true);
    assert.equal(failure.nativeResumeSupported, false);
    assert.equal(failure.publicFailureReason, publicReason);
    assert.equal(recoverState.resumeStrategy, 'audit-only-retry');
    assert.equal(recoverState.publicFailureReason, publicReason);
    assert.doesNotMatch(response.message.content, /export\.arxiv\.org|search_query/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function runtimeRequestInput(): SendAgentMessageInput {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'Summarize current context',
    references: [{
      id: 'ref-report',
      kind: 'task-result',
      title: 'Report',
      ref: 'artifact:report-1',
      payload: { selectedText: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    roleView: 'researcher',
    messages: [{
      id: 'seed-demo',
      role: 'scenario',
      content: 'SEED_MESSAGE_SHOULD_NOT_LEAK',
      createdAt: '2026-05-19T00:00:00.000Z',
      status: 'completed',
    }],
    artifacts: [{
      id: 'report-1',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    claims: [{
      id: 'claim-1',
      text: 'CLAIM_BODY_SHOULD_NOT_LEAK',
      type: 'inference',
      confidence: 0.8,
      evidenceLevel: 'review',
    }],
    executionUnits: [],
    runs: [],
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/tmp/current',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 60_000,
      maxContextWindowTokens: 200000,
      visionAllowSharedSystemInput: true,
      updatedAt: '2026-05-19T00:00:00.000Z',
    },
    scenarioOverride: {
      title: 'Test scenario',
      description: 'Test scenario override',
      skillDomain: 'literature',
      scenarioMarkdown: '# Test',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      selectedSkillIds: ['legacy.skill'],
      toolProviderRoutes: {
        web: { source: 'mcp', endpoint: 'http://127.0.0.1:7777/mcp' },
      },
      failureRecoveryPolicy: {
        mode: 'preserve-context',
      },
    },
    availableComponentIds: ['report-viewer'],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
  };
}

function recursiveForbiddenKeys(value: unknown, forbiddenKeys: string[], path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => recursiveForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbiddenKeys.includes(key) ? [current] : [];
    return [...hit, ...recursiveForbiddenKeys(entry, forbiddenKeys, current)];
  });
}
