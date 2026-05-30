import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AgentStreamEvent } from '../../domain';
import { CODEX_REALTIME_SESSION_TRANSPORT_STATUS } from './codexRealtimeSession';
import { normalizeWorkspaceRuntimeEvent, readWorkspaceToolStream } from './runtimeEvents';
import { createNdjsonResponse, createSseResponse } from './runtimeEvents.testHelpers';
import { assistantDraftFromStreamEvents } from '../../streamEventPresentation';

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
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.equal(seen.length, 2);
  assert.equal((stream.result as { message?: string }).message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal((stream.result as { output?: { message?: string } }).output?.message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal('displayIntent' in (stream.result as Record<string, unknown>), false);
});

test('SSE reader pushes backend deltas, tool lifecycle, approval, and progress before final result', async () => {
  const commandId = 'codex-command-realtime-reducer';
  const body = [
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: 'Partial answer',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
    'event: tool_started',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_started',
      toolName: 'module.query',
      message: 'Querying skills module',
      commandId,
    })}`,
    '',
    'event: tool_completed',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'tool_completed',
      toolName: 'module.query',
      message: 'Skills query completed',
      commandId,
    })}`,
    '',
    'event: operation_progress',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'operation_progress',
      progress: { phase: 'execute', title: 'Operation running', detail: 'Streaming operation progress' },
      status: 'running',
      commandId,
    })}`,
    '',
    'event: approval_requested',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'approval_requested',
      message: 'Confirm external action',
      commandId,
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      commandId,
    })}`,
    '',
  ].join('\n');
  const seen: AgentStreamEvent[] = [];
  const response = createSseResponse(body);

  await readWorkspaceToolStream(response, (event) => seen.push(normalizeWorkspaceRuntimeEvent(event)));

  assert.deepEqual(seen.slice(0, -1).map((event) => event.type), [
    'text-delta',
    'tool-call',
    'tool-result',
    'process-progress',
    'human-approval-required',
  ]);
  assert.equal(seen.at(-1)?.type, 'done');
  assert.equal(seen[0]?.detail, 'Partial answer');
  assert.equal(assistantDraftFromStreamEvents(seen.slice(0, 1)), 'Partial answer');
  assert.equal(seen.find((event) => event.type === 'process-progress')?.raw, seen[3]?.raw);
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
  const response = createSseResponse(body);

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
  const response = createSseResponse(body);

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

test('SSE reader joins CJK native assistant deltas without inserting word spaces', async () => {
  const commandId = 'codex-command-native-cjk-message';
  const body = [
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '简洁直',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '给 / 少说',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '废话',
      commandId,
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, '简洁直给 / 少说废话');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, '简洁直给 / 少说废话');
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
  const response = createSseResponse(body);

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
  const response = createSseResponse(body);

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
  assert.match(result.message ?? '', /Confirmation required/);
  assert.doesNotMatch(result.message ?? '', /vision-trace\.json|Approval ref|Action ref|Choices|\/computer-use approve/);
  assert.equal(result.guiAskUser?.source, `gui.ask_user:${commandId}`);
  assert.deepEqual(result.guiAskUser?.relatedRefs, ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.equal(result.guiAskUser?.choices?.[0]?.commandText, '/computer-use approve --approval-ref approval-1');
  assert.equal(result.displayIntent?.source, `gui.ask_user:${commandId}`);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'needs-human');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.liveAcceptanceEligible, true);
  assert.deepEqual(result.displayIntent?.conversationProjection?.artifacts?.map((artifact) => artifact.ref), ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.deepEqual(result.displayIntent?.conversationProjection?.recoverActions, []);
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
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(normalizeWorkspaceRuntimeEvent(event)));
  const result = stream.result as {
    message?: string;
    guiAskUser?: { approvalRequest?: { id?: string }; relatedRefs?: string[] };
    guiPresentation?: { displayedRefs?: string[] };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string }; artifacts?: Array<{ ref?: string }> } };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Confirmation required/);
  assert.match(result.message ?? '', /Allow the operation to click/);
  assert.doesNotMatch(result.message ?? '', /approval:computer-use:cu-risk|vision-trace|Approval ref|Evidence refs|Choices|\/computer-use/);
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
  const response = createNdjsonResponse([
    {
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
                id: 'display-only-approval-request-ndjson',
                approvalRef: 'approval:computer-use:ndjson',
                confirmation_text: 'Allow Computer Use to click the guarded Submit button?',
                risk_level: 'high',
                action_kind: 'click',
              },
              relatedRefs: [traceRef, screenshotRef],
            },
          }],
        }),
      },
    },
    {
      result: {
        status: 'done',
        message: 'Raw provider result should not be the visible answer.',
        commandId,
        executionUnits: [{ id: 'EU-computer-use-ndjson', status: 'done' }],
      },
    },
  ]);

  const seen: unknown[] = [];
  const stream = await readWorkspaceToolStream(response, (event) => seen.push(normalizeWorkspaceRuntimeEvent(event)));
  const result = stream.result as {
    message?: string;
    guiAskUser?: { source?: string; choices?: Array<{ commandText?: string }>; relatedRefs?: string[] };
    guiPresentation?: { source?: string; displayedRefs?: string[] };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string }; recoverActions?: string[] } };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Confirmation required/);
  assert.match(result.message ?? '', /Allow the operation to click the guarded Submit button/);
  assert.doesNotMatch(result.message ?? '', /approval:computer-use:ndjson|\/computer-use approve|\/computer-use reject|Evidence refs|Choices/);
  assert.equal(result.guiAskUser?.source, `gui.ask_user:${commandId}:computer-use`);
  assert.deepEqual(result.guiAskUser?.relatedRefs, [traceRef, screenshotRef]);
  assert.equal(result.guiAskUser?.choices?.[0]?.commandText, '/computer-use approve --approval-ref "approval:computer-use:ndjson"');
  assert.equal(result.guiPresentation?.source, `gui.present:${commandId}:computer-use`);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(traceRef));
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'needs-human');
  assert.deepEqual(result.displayIntent?.conversationProjection?.recoverActions, []);
  assert.match((seen[0] as AgentStreamEvent | undefined)?.detail ?? '', /visible GUI confirmation/);
});

test('NDJSON reader exposes Computer Use repair sidecars and continuation action', async () => {
  const commandId = 'computer-use-command-repair';
  const traceRef = '.sciforge/vision-runs/cu-repair/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair/continuation-request.json';
  const directoryListingRef = '.sciforge/vision-runs/cu-repair/directory-listing.json';
  const runTaskChainRef = '.sciforge/vision-runs/cu-repair/tui-host-run-task-chain.json';
  const response = createNdjsonResponse([
    {
      event: {
        type: 'computer-use.tui-host-actions',
        source: 'computer-use-package-bridge',
        commandId,
        attemptId: `${commandId}-attempt-1`,
        evidenceRefs: [`audit:codex-runtime:${commandId}:normalized-events`],
        detail: JSON.stringify({
          actions: [{
            schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
            port: 'gui.present',
            target: 'computer-use.trace-summary',
            payload: {
              title: 'Computer Use result',
              status: 'repair-needed',
              message: 'Verifier requested another round before accepting the task.',
              traceRefs: [traceRef],
              blockedManifestRefs: [blockedManifestRef],
              repairHintRefs: [repairHintRef],
              continuationRequestRefs: [continuationRequestRef],
              directoryListingRefs: [directoryListingRef],
              runTaskChainRefs: [runTaskChainRef],
            },
          }],
        }),
      },
    },
    {
      result: {
        status: 'done',
        message: 'Raw provider result should not be the visible answer.',
        commandId,
      },
    },
  ]);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    guiPresentation?: { displayedRefs?: string[] };
    displayIntent?: {
      conversationProjection?: {
        visibleAnswer?: { status?: string; artifactRefs?: string[] };
        artifacts?: Array<{ ref?: string; mime?: string }>;
        auditRefs?: string[];
        recoverActions?: string[];
      };
    };
  };
  const projection = result.displayIntent?.conversationProjection;

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Repair hint refs/);
  assert.match(result.message ?? '', /Continuation request refs/);
  assert.match(result.message ?? '', /Run task chain refs/);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(continuationRequestRef));
  assert.equal(projection?.visibleAnswer?.status, 'repair-needed');
  assert.ok(projection?.visibleAnswer?.artifactRefs?.includes(blockedManifestRef));
  assert.ok(projection?.artifacts?.some((artifact) => artifact.ref === continuationRequestRef && artifact.mime === 'json'));
  assert.ok(projection?.auditRefs?.includes(runTaskChainRef));
  assert.deepEqual(projection?.recoverActions, [
    `/computer-use continue --continuation-request-ref "${continuationRequestRef}"`,
  ]);
});

test('NDJSON reader surfaces Computer Use completion-grade and producer diagnostics in gui.present text', async () => {
  const commandId = 'computer-use-command-completion-diagnostics';
  const runDir = '.sciforge/vision-runs/cu-completion-diagnostics';
  const traceRef = `${runDir}/vision-trace.json`;
  const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
  const diagnosticRef = `${runDir}/completion-grade-diagnostics.json`;
  const producerDiagnosticRef = `${runDir}/embedded-l3-completion-producer-diagnostics.json`;
  const response = createNdjsonResponse([
    {
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
              status: 'completed',
              message: 'Computer Use claimed completion, but completion-grade evidence is blocked.',
              traceRefs: [traceRef],
              artifactRefs: [diagnosticRef, producerDiagnosticRef],
              runTaskChainRefs: [runTaskChainRef],
            },
          }],
        }),
      },
    },
    {
      result: {
        status: 'completed',
        message: 'Raw provider result should not be the visible answer.',
        commandId,
      },
    },
  ]);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    guiPresentation?: { ref?: string; displayedRefs?: string[] };
    displayIntent?: {
      conversationProjection?: {
        visibleAnswer?: { status?: string; artifactRefs?: string[] };
      };
    };
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Completion diagnostic: completed status did not include a visible final artifact ref/);
  assert.match(result.message ?? '', /Completion-grade diagnostic refs/);
  assert.match(result.message ?? '', /L3 producer diagnostic refs/);
  assert.equal(result.guiPresentation?.ref, diagnosticRef);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(producerDiagnosticRef));
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'output-materialized');
  assert.ok(result.displayIntent?.conversationProjection?.visibleAnswer?.artifactRefs?.includes(diagnosticRef));
});

test('NDJSON reader projects Computer Use blocked sidecars as external blocked with continuation action', async () => {
  const commandId = 'computer-use-command-blocked';
  const traceRef = '.sciforge/vision-runs/cu-blocked/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-blocked/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-blocked/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-blocked/continuation-request.json';
  const runTaskChainRef = '.sciforge/vision-runs/cu-blocked/tui-host-run-task-chain.json';
  const response = createNdjsonResponse([
    {
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
              title: 'Computer Use blocked result',
              status: 'blocked',
              message: 'Provider raw blocker should be summarized through refs.',
              traceRefs: [traceRef],
              blockedManifestRefs: [blockedManifestRef],
              repairHintRefs: [repairHintRef],
              continuationRequestRefs: [continuationRequestRef],
              runTaskChainRefs: [runTaskChainRef],
            },
          }],
        }),
      },
    },
    {
      result: {
        status: 'failed-with-reason',
        message: 'Raw provider result should not be the visible answer.',
        commandId,
      },
    },
  ]);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    displayIntent?: {
      conversationProjection?: {
        visibleAnswer?: { status?: string; artifactRefs?: string[] };
        auditRefs?: string[];
        recoverActions?: string[];
      };
    };
  };
  const projection = result.displayIntent?.conversationProjection;

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Blocked manifest refs/);
  assert.match(result.message ?? '', /Run task chain refs/);
  assert.doesNotMatch(result.message ?? '', /Raw provider result/);
  assert.equal(projection?.visibleAnswer?.status, 'external-blocked');
  assert.ok(projection?.visibleAnswer?.artifactRefs?.includes(blockedManifestRef));
  assert.ok(projection?.auditRefs?.includes(runTaskChainRef));
  assert.deepEqual(projection?.recoverActions, [
    `/computer-use continue --continuation-request-ref "${continuationRequestRef}"`,
  ]);
});

test('Runtime Codex realtime transport marker declares RT-02 WebSocket bridge complete', () => {
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.rtGapId, 'RT-02');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.currentTransport, 'websocket');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.targetTransport, 'websocket');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.targetCapability, 'bidirectional-send-receive');
  assert.equal(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.websocketComplete, true);
  assert.deepEqual(CODEX_REALTIME_SESSION_TRANSPORT_STATUS.blockers, []);
});

test('Runtime Codex raw runtime events and stderr warnings normalize to folded audit summaries', () => {
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

  assert.match(rawJsonl.detail ?? '', /raw runtime events recorded/i);
  assert.doesNotMatch(rawJsonl.detail ?? '', /raw JSONL/i);
  assert.match(stderr.detail ?? '', /plugin manifest warning recorded/i);
  assert.doesNotMatch(rawJsonl.detail ?? '', /RAW_JSONL_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(stderr.detail ?? '', /failed to load plugin|\/tmp\/plugin\.json/);
});

test('Runtime Codex product client does not predeclare raw JSONL audit refs', async () => {
  const source = await readFile(new URL('./client.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /audit:codex-runtime:[^`]*:raw-jsonl/);
  assert.doesNotMatch(source, /Runtime Codex raw JSONL audit/);
  assert.match(source, /audit:codex-app-server:[^`]*:raw-events/);
  assert.match(source, /Runtime Codex runtime-event audit/);
});

test('Runtime Codex shell lifecycle details prefer structured command fields', () => {
  const started = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'tool_started',
    toolName: 'shell',
    command: "/bin/zsh -lc 'cat PROJECT.md | head -20'",
    status: 'in_progress',
  });
  const completed = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'tool_completed',
    toolName: 'shell',
    command: "/bin/zsh -lc 'cat PROJECT.md | head -20'",
    status: 'completed',
    exitCode: 0,
    outputSummary: 'PROJECT heading and contract summary',
  });

  assert.equal(started.type, 'tool-call');
  assert.equal(started.label, 'Calling shell');
  assert.match(started.detail ?? '', /Shell command started/);
  assert.match(started.detail ?? '', /cat PROJECT\.md/);
  assert.equal(completed.type, 'tool-result');
  assert.match(completed.detail ?? '', /Shell command completed/);
  assert.match(completed.detail ?? '', /exit=0/);
  assert.match(completed.detail ?? '', /PROJECT heading/);
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
