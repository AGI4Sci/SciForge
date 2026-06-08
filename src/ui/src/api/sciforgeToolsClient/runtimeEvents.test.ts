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

test('SSE reader pushes backend deltas, tool lifecycle, approval, and progress before missing-final-answer failure', async () => {
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

  assert.deepEqual(seen.map((event) => event.type), [
    'text-delta',
    'tool-call',
    'tool-result',
    'process-progress',
    'human-approval-required',
    'done',
    'failed',
  ]);
  assert.equal(seen.at(-1)?.type, 'failed');
  assert.equal(seen[0]?.detail, 'Partial answer');
  assert.equal(assistantDraftFromStreamEvents(seen.slice(0, 1)), 'Partial answer');
  assert.equal(seen.find((event) => event.type === 'process-progress')?.raw, seen[3]?.raw);
});

test('SSE reader requires a safe final assistant answer for Runtime Codex completion', async () => {
  const commandId = 'codex-command-final-answer-required';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
  assert.match(stream.error ?? '', /without a safe final assistant answer/);
  assert.equal((seen.at(-1) as { type?: string }).type, 'failed');
});

test('SSE reader materializes structured VirtualAppScreen artifacts from done payloads without raw text fallback', async () => {
  const commandId = 'codex-command-virtual-screen-done';
  const legacyScreenArtifactId = `computer-use-virtual-screen-${commandId}`;
  const screenArtifactId = `computer-use-screen-evidence-${commandId}`;
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex returned a structured Computer Use screen artifact.',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      uiManifest: [{
        componentId: 'virtual-screen-viewer',
        title: 'Computer Use screen',
        artifactRef: legacyScreenArtifactId,
        priority: -6,
      }],
      artifacts: [{
        id: legacyScreenArtifactId,
        type: 'computer-use-virtual-screen',
        schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
        metadata: {
          title: 'Computer Use screen',
          producer: 'workspace-runtime',
        },
        data: {
          schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
          status: 'blocked',
          attachState: 'blocked',
          surfaceMode: 'empty',
          screenRef: 'virtual-app-screen:structured-done/screen',
          targetAppRef: 'app:profile/vscode-editor',
          preflightRef: 'computer-use:native-host/preflights/structured-done/preflight.json',
          preflightLedgerRef: 'computer-use:native-host/preflights/structured-done/preflight-ledger.json',
          preflightLedgerEntryRef: 'computer-use:native-host/preflights/structured-done/preflight-ledger.json/events/0001-preflight.recorded.json',
          hostReadinessRef: 'computer-use:native-host/preflights/structured-done/host-readiness.json',
          adapterReadinessRef: 'computer-use:structured-done/provider-readiness.json',
          handoffRef: 'computer-use:structured-done/attach-request.json',
          evidenceLedgerRef: 'ledger:computer-use/structured-done/screen-activation.json',
          guiPresentRefs: ['gui.present:structured-done/screen-pane'],
          isolationFlags: {
            affectsPhysicalDisplay: false,
            sharedSystemInputUsed: false,
            systemPointerMoved: false,
            systemKeyboardEventsSent: false,
          },
        },
      }],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));
  const result = stream.result as {
    structuredRuntimeProjection?: { artifactRefs?: string[]; failClosedRawText?: boolean };
    artifacts?: Array<{ id?: string; type?: string; data?: Record<string, unknown> }>;
    uiManifest?: Array<{ componentId?: string; artifactRef?: string }>;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { artifactRefs?: string[] } } };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.structuredRuntimeProjection?.failClosedRawText, true);
  assert.deepEqual(result.structuredRuntimeProjection?.artifactRefs, [`artifact:${screenArtifactId}`]);
  assert.ok(result.displayIntent?.conversationProjection?.visibleAnswer?.artifactRefs?.includes(`artifact:${screenArtifactId}`));
  assert.equal(result.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
  assert.ok(result.uiManifest?.some((slot) => slot.componentId === 'image-evidence-viewer' && slot.artifactRef === screenArtifactId));
  const screenArtifact = result.artifacts?.find((artifact) => artifact.id === screenArtifactId);
  assert.equal(screenArtifact?.type, 'image-evidence');
  assert.equal(screenArtifact?.data?.screenRef, 'virtual-app-screen:structured-done/screen');
  assert.equal(screenArtifact?.data?.preflightRef, 'computer-use:native-host/preflights/structured-done/preflight.json');
  assert.equal(screenArtifact?.data?.preflightLedgerRef, 'computer-use:native-host/preflights/structured-done/preflight-ledger.json');
  assert.equal(screenArtifact?.data?.preflightLedgerEntryRef, 'computer-use:native-host/preflights/structured-done/preflight-ledger.json/events/0001-preflight.recorded.json');
  assert.equal(screenArtifact?.data?.hostReadinessRef, 'computer-use:native-host/preflights/structured-done/host-readiness.json');
  assert.equal(screenArtifact?.data?.sessionRef, undefined);
  assert.equal(screenArtifact?.data?.currentFrameRef, undefined);
  assert.equal((seen.at(-1) as { type?: string }).type, 'done');
});

test('SSE reader fails closed on native Runtime Codex assistant messages without Host final-answer envelope', async () => {
  const commandId = 'codex-command-native-message';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: 'VISIBLE_FROM_CODEX_NATIVE_MESSAGE',
      commandId,
      profile: 'sciforge-runtime-default',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
    finalAnswerEnvelope?: unknown;
    nativeCodexMessage?: unknown;
    output?: Record<string, unknown>;
  };
  const failed = seen.at(-1) as { type?: string; status?: string; raw?: Record<string, unknown> } | undefined;

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.output?.finalAnswerEnvelope, undefined);
  assert.equal(failed?.type, 'failed');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(JSON.stringify(result), /VISIBLE_FROM_CODEX_NATIVE_MESSAGE|codex\.app-server\.final-answer/);
});

test('SSE reader does not synthesize FinalAnswerEnvelope from native done text without Host final-answer envelope', async () => {
  const commandId = 'codex-command-native-done-no-host-final-envelope';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      finalText: 'Computer Use live diagnostic completed.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [
        `computer-use:vscode/${commandId}/action.completed`,
        `computer-use:vscode/${commandId}/run-procedure.completed`,
      ],
    })}`,
    '',
  ].join('\n');

  const stream = await readWorkspaceToolStream(createSseResponse(body), () => undefined);
  const result = (stream.result ?? {}) as {
    finalAnswerEnvelope?: unknown;
    nativeCodexMessage?: unknown;
    output?: Record<string, unknown>;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string; text?: string } } };
  };
  const visible = result.displayIntent?.conversationProjection?.visibleAnswer;

  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.output?.finalAnswerEnvelope, undefined);
  assert.notEqual(visible?.status, 'completed');
  assert.ok(stream.error || visible?.status === 'blocked' || visible?.status === 'partial');
});

test('SSE reader projects Host-owned Agent Host final-answer envelope from native done evidence', async () => {
  const commandId = 'codex-command-native-agent-host-final-answer';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'LOCAL COMPLETION ACK SHOULD NOT BE FINAL',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [
        `computer-use:vscode/${commandId}/observation.current`,
        `computer-use:vscode/${commandId}/action.completed`,
      ],
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status: 'completed',
        text: 'HOST OWNED FINAL ANSWER',
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
        evidenceRefs: [`computer-use:vscode/${commandId}/observation.current`],
        cleanupRefs: [`computer-use:vscode/${commandId}/control.release`],
      },
    })}`,
    '',
  ].join('\n');

  const stream = await readWorkspaceToolStream(createSseResponse(body), () => undefined);
  const result = stream.result as {
    message?: string;
    finalAnswerEnvelope?: { source?: string; text?: string; kind?: string; liveAcceptanceEligible?: boolean };
    nativeCodexMessage?: unknown;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { status?: string; text?: string } } };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'HOST OWNED FINAL ANSWER');
  assert.equal(result.finalAnswerEnvelope?.source, `codex.app-server.final-answer:${commandId}`);
  assert.equal(result.finalAnswerEnvelope?.kind, 'assistant-message');
  assert.equal(result.finalAnswerEnvelope?.text, 'HOST OWNED FINAL ANSWER');
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'completed');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, 'HOST OWNED FINAL ANSWER');
  assert.equal(result.finalAnswerEnvelope?.liveAcceptanceEligible, true);
});

test('SSE reader rejects unbound final-answer envelopes without same-run evidence', async () => {
  const commandId = 'codex-command-native-unbound-final-envelope';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`runtime-codex:${commandId}:done`],
      finalAnswerEnvelope: {
        schemaVersion: 'sciforge.final-answer-envelope.v1',
        source: `codex.app-server.final-answer:${commandId}`,
        kind: 'assistant-message',
        text: 'UNBOUND ENVELOPE SHOULD NOT PROJECT',
        commandId,
        evidenceRefs: ['runtime-codex:other-run:done'],
      },
    })}`,
    '',
  ].join('\n');

  const stream = await readWorkspaceToolStream(createSseResponse(body), () => undefined);
  const result = (stream.result ?? {}) as {
    message?: string;
    finalAnswerEnvelope?: unknown;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.notEqual(result.message, 'UNBOUND ENVELOPE SHOULD NOT PROJECT');
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, undefined);
});

test('SSE reader prefers Agent Host Browser finalizer text over structured done summaries', async () => {
  const commandId = 'codex-command-browser-finalizer-visible';
  const finalizerText = [
    '根据已通过 Browser 读取的页面，OpenAI API 文档首页的标题或页面主题是“OpenAI API Platform Documentation”。',
    '',
    '来源：',
    '- OpenAI API Platform Documentation — https://developers.openai.com/api/docs',
    '证据 refs：',
    '- `browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.source.json`',
    '- `browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.txt`',
  ].join('\n');
  const sourceOnlySummary = [
    'https://developers.openai.com/api/docs 证据 refs：',
    '- browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.source.json',
    '- browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.txt',
  ].join('\n');
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: finalizerText,
      message: finalizerText,
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [
        'browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.source.json',
        'browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.txt',
      ],
      raw: { boundary: 'agent-host-browser-finalizer' },
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: sourceOnlySummary,
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [
        'browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.source.json',
        'browser-host-session:browser-host-08543b2b2e7c/source-pages/source-1-459f78e7b1.txt',
      ],
      uiManifest: [{
        componentId: 'image-evidence-viewer',
        artifactRef: 'browser-proof-screen',
      }],
      artifacts: [{
        id: 'browser-proof-screen',
        type: 'image-evidence',
        data: { screenRef: 'browser-host-session:browser-host-08543b2b2e7c/frame/current.png' },
      }],
      raw: { boundary: 'agent-host-browser-finalizer' },
    })}`,
    '',
  ].join('\n');
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    finalAnswerEnvelope?: { text?: string; source?: string };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, finalizerText);
  assert.equal(result.finalAnswerEnvelope?.text, finalizerText);
  assert.equal(result.finalAnswerEnvelope?.source, `codex.app-server.final-answer:${commandId}`);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, finalizerText);
  assert.match(result.message ?? '', /OpenAI API Platform Documentation/);
  assert.notEqual(result.message, sourceOnlySummary);
});

test('SSE reader prefers Agent Host Browser finalizer text over legacy GUI projection text', async () => {
  const commandId = 'codex-command-browser-finalizer-gui-priority';
  const finalizerText = '最终可见答案：OpenAI API Platform Documentation。来源：https://developers.openai.com/api/docs';
  const guiSummary = 'https://developers.openai.com/api/docs 证据 refs：browser-host-session:source.txt';
  const body = [
    'event: gui_present',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_present',
      commandId,
      displayIntent: {
        source: `gui.present:${commandId}:legacy`,
        conversationProjection: {
          visibleAnswer: { text: guiSummary, status: 'completed' },
        },
      },
    })}`,
    '',
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: finalizerText,
      commandId,
      raw: { boundary: ' Agent-Host-Browser-Finalizer ' },
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: guiSummary,
      commandId,
      evidenceRefs: ['browser-host-session:source.txt'],
    })}`,
    '',
  ].join('\n');

  const stream = await readWorkspaceToolStream(createSseResponse(body), () => undefined);
  const result = stream.result as {
    message?: string;
    finalAnswerEnvelope?: { text?: string; kind?: string };
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, finalizerText);
  assert.equal(result.finalAnswerEnvelope?.kind, 'assistant-message');
  assert.equal(result.finalAnswerEnvelope?.text, finalizerText);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, finalizerText);
  assert.notEqual(result.message, guiSummary);
});

test('SSE reader fails closed when native Runtime Codex message is an internal tool-call protocol', async () => {
  const commandId = 'codex-command-native-tool-protocol';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: 'I will inspect an internal tool.\\n\\n<｜DSML｜tool_call><｜DSML｜parameter name="path" string="true">/tmp/private-skill.md</｜DSML｜parameter></｜DSML｜tool_call>',
      commandId,
      profile: 'sciforge-runtime-default',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /DSML|private-skill|tool_call/);
});

test('SSE reader fails closed when native Runtime Codex message uses plural DSML tool_calls protocol', async () => {
  const commandId = 'codex-command-native-tool-calls-protocol';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: '我先打开浏览器搜索相关信息。\\n\\n<｜DSML｜tool_calls><｜DSML｜invoke name="multi_agent_v1_spawn_agent"><｜DSML｜parameter name="title" string="true">搜索伊朗局势</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>',
      commandId,
      profile: 'sciforge-runtime-default',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /DSML|multi_agent|tool_calls|伊朗/);
});

test('SSE reader fails closed when native Runtime Codex message contains module invoke markup', async () => {
  const commandId = 'codex-command-native-module-invoke-protocol';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: 'Looking for papers.\\n\\n<module_invoke>{\"moduleId\":\"browser\",\"intent\":\"executeBoundedOperation\"}</module_invoke>',
      commandId,
      profile: 'sciforge-runtime-default',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /module_invoke|browser|executeBoundedOperation/);
});

test('SSE reader fails closed when native Runtime Codex message contains malformed function_calls protocol', async () => {
  const commandId = 'codex-command-native-malformed-function-calls-protocol';
  const protocolText = [
    `name="module_invoke">browser executeBoundedOperation {'operationKind': 'browser.search_read', 'targetScope': {'query': 'arxiv.org agentic reinforcement learning 2026'}}`,
    '<function_calls>',
    `browser executeBoundedOperation {'operationKind': 'browser.search_read', 'targetScope': {'query': 'arxiv.org agentic reinforcement learning 2026'}}`,
    '</function_calls>',
  ].join('\n');
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: protocolText,
      commandId,
      profile: 'sciforge-runtime-default',
    })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [`audit:codex-runtime:${commandId}:${commandId}-attempt-1:normalized-events`],
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /module_invoke|function_calls|browser|executeBoundedOperation|agentic reinforcement/i);
});

test('SSE reader fails closed when native Runtime Codex message is only a Browser tool intent', async () => {
  const commandId = 'codex-command-native-browser-tool-intent-only';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: '使用 Browser 模块搜索 arxiv 上 agentic RL 相关的今天论文，并用中文总结结果。',
      commandId,
      profile: 'sciforge-runtime-default',
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
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /Browser|agentic RL|arxiv/i);
});

test('SSE reader fails closed when text-only Runtime Codex message contains stdoutRef or raw provider output', async () => {
  const commandId = 'codex-command-native-text-only-transport-diagnostic';
  const body = [
    'event: message',
    'data: stdoutRef=.sciforge/runtime-events/stdout.log raw provider output: {"secret":"provider-payload"}',
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
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /stdoutRef|raw provider output|provider-payload/);
});

test('SSE reader fails closed when streamed native Runtime Codex message contains transport diagnostics', async () => {
  const commandId = 'codex-command-native-record-transport-diagnostic';
  const body = [
    'event: message',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message',
      text: 'stderrRef=.sciforge/runtime-events/stderr.log raw provider payload: {"secret":"provider-payload"}',
      commandId,
      profile: 'sciforge-runtime-default',
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
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /stderrRef|raw provider payload|provider-payload/);
});

test('SSE reader fails closed when done-only final text contains raw provider output', async () => {
  const commandId = 'codex-command-native-done-only-transport-diagnostic';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      finalText: 'raw provider output: {"secret":"provider-payload"}',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /raw provider output|provider-payload/);
});

test('SSE reader fails closed when done-only final text is only a Browser tool intent', async () => {
  const commandId = 'codex-command-native-done-only-tool-intent';
  const body = [
    'event: done',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      finalText: 'I will use the Browser module to search today arXiv agentic RL papers and summarize them.',
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.equal(stream.result, undefined);
  const failed = seen.at(-1) as { type?: string; status?: string; message?: string; raw?: Record<string, unknown> };
  assert.equal(failed.type, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.raw?.boundary, 'final-answer-required');
  assert.doesNotMatch(`${stream.error}\n${failed.message}`, /Browser|agentic RL|arXiv/i);
});

test('SSE reader fails closed on CJK native assistant deltas without Host final-answer envelope', async () => {
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
    finalAnswerEnvelope?: unknown;
    nativeCodexMessage?: unknown;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.notEqual(result.message, '简洁直给 / 少说废话');
  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, undefined);
});

test('SSE reader fails closed on markdown native assistant deltas without Host final-answer envelope', async () => {
  const commandId = 'codex-command-native-markdown-message';
  const expected = [
    '## 多轮 Markdown 验收',
    '',
    '这是一段中文与 English 混排的段落。',
    '',
    '- 一级要点：assistant final prose 应该独立于 process rows。',
    '  - 二级要点：nested list 需要缩进稳定。',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| Markdown | pass |',
    '',
    '```ts',
    'const ok = true;',
    '```',
  ].join('\n');
  const body = [
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '## 多轮 Markdown 验收',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '\n\n这是一段中文与 English 混排的段落。',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '\n\n- 一级要点：assistant final prose 应该独立于 process rows。',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '\n  - 二级要点：nested list 需要缩进稳定。',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '\n\n| 项目 | 状态 |\n| --- | --- |\n| Markdown | pass |',
      commandId,
    })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'message_delta',
      text: '\n\n```ts\nconst ok = true;\n```',
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
    finalAnswerEnvelope?: unknown;
    nativeCodexMessage?: unknown;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.notEqual(result.message, expected);
  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, undefined);
  assert.doesNotMatch(result.message ?? '', /验收这是一段|\| 项目 \| 状态 \||const ok = true/);
});

test('SSE reader fails closed on exact native assistant deltas without Host final-answer envelope', async () => {
  const commandId = 'codex-command-native-markdown-exact-delta';
  const expected = [
    '## Markdown sample',
    '',
    '```typescript',
    'function greet(name: string): string {',
    '  return `hello ${name}`;',
    '}',
    '```',
  ].join('\n');
  const body = [
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: '## Mark', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: 'down sample', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: '\n\n```', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: 'typescript\n', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: 'function greet', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: '(name: string): string {', commandId })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', text: '\n  return `hello ${name}`;\n}\n```', commandId })}`,
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
    finalAnswerEnvelope?: unknown;
    nativeCodexMessage?: unknown;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } };
  };

  assert.match(stream.error ?? '', /without a safe final assistant answer/i);
  assert.notEqual(result.message, expected);
  assert.equal(result.finalAnswerEnvelope, undefined);
  assert.equal(result.nativeCodexMessage, undefined);
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.text, undefined);
  assert.doesNotMatch(result.message ?? '', /Markdown sample|function greet|```\s*typescript/);
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
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
  const result = stream.result as {
    message?: string;
    displayIntent?: {
      source?: string;
      conversationProjection?: {
        artifacts?: Array<{ mime?: string }>;
        verificationState?: { status?: string; verdict?: string };
      };
    };
    guiPresentation?: { source?: string; hint?: string };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'VISIBLE_FROM_GUI_PRESENT');
  assert.equal(result.guiPresentation?.source, `gui.present:${commandId}`);
  assert.equal(result.guiPresentation?.hint, 'markdown');
  assert.equal(result.displayIntent?.source, `gui.present:${commandId}`);
  assert.equal(result.displayIntent?.conversationProjection?.artifacts?.[0]?.mime, 'markdown');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.status, 'unverified');
  assert.doesNotMatch(JSON.stringify(result), /RAW_PROVIDER_MESSAGE_SHOULD_NOT_RENDER/);
});

test('SSE reader does not mark Agent Host gui.present verified from taskOutcome and evidence refs alone', async () => {
  const commandId = 'codex-command-gui-present-no-completion-truth';
  const sourceRef = 'browser-host-session:browser-verified/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:browser-verified/source-pages/source-1.txt';
  const body = [
    'event: gui_present',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_present',
      status: 'completed',
      text: 'VISIBLE_VERIFIED_BROWSER_ANSWER',
      provider: 'sciforge-agent-host',
      model: 'codex-agent-host-turn-loop',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [sourceRef, textRef],
      raw: {
        source: `gui.present:${commandId}:agent-host`,
        presentation: {
          source: `gui.present:${commandId}:agent-host`,
          text: 'VISIBLE_VERIFIED_BROWSER_ANSWER',
          ref: sourceRef,
          title: 'Runtime answer',
          hint: 'markdown',
          status: 'completed',
          displayedRefs: [sourceRef, textRef],
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
      provider: 'sciforge-agent-host',
      model: 'codex-agent-host-turn-loop',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [sourceRef, textRef],
      displayIntent: {
        protocolStatus: 'protocol-success',
        taskOutcome: 'satisfied',
        status: 'completed',
      },
    })}`,
    '',
  ].join('\n');
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    displayIntent?: {
      conversationProjection?: {
        verificationState?: { status?: string; verdict?: string; verifierRef?: string };
        auditRefs?: string[];
      };
    };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'VISIBLE_VERIFIED_BROWSER_ANSWER');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.status, 'unverified');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.verdict, undefined);
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.verifierRef, `gui.present:${commandId}:agent-host`);
  assert.deepEqual(result.displayIntent?.conversationProjection?.auditRefs, [sourceRef, textRef]);
});

test('SSE reader marks Agent Host gui.present verified from satisfied completionTruth', async () => {
  const commandId = 'codex-command-gui-present-completion-truth';
  const sourceRef = 'browser-host-session:browser-verified/source-pages/source-1.source.json';
  const textRef = 'browser-host-session:browser-verified/source-pages/source-1.txt';
  const body = [
    'event: gui_present',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_present',
      status: 'completed',
      text: 'VISIBLE_VERIFIED_BROWSER_ANSWER',
      provider: 'sciforge-agent-host',
      model: 'codex-agent-host-turn-loop',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [sourceRef, textRef],
      raw: {
        source: `gui.present:${commandId}:agent-host`,
        presentation: {
          source: `gui.present:${commandId}:agent-host`,
          text: 'VISIBLE_VERIFIED_BROWSER_ANSWER',
          ref: sourceRef,
          title: 'Runtime answer',
          hint: 'markdown',
          status: 'completed',
          displayedRefs: [sourceRef, textRef],
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
      provider: 'sciforge-agent-host',
      model: 'codex-agent-host-turn-loop',
      profile: 'sciforge-runtime-default',
      workspace: '/tmp/current',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      evidenceRefs: [sourceRef, textRef],
      completionTruth: {
        schemaVersion: 'sciforge.agent-host.completion-truth.v1',
        scope: 'user-task',
        status: 'satisfied',
        evidenceRefs: [sourceRef, textRef],
        validator: 'agent-host-browser-acceptance',
      },
      displayIntent: {
        protocolStatus: 'protocol-success',
        taskOutcome: 'satisfied',
        status: 'completed',
      },
    })}`,
    '',
  ].join('\n');
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    displayIntent?: {
      conversationProjection?: {
        verificationState?: { status?: string; verdict?: string; verifierRef?: string };
        auditRefs?: string[];
      };
    };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.message, 'VISIBLE_VERIFIED_BROWSER_ANSWER');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.status, 'verified');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.verdict, 'pass');
  assert.equal(result.displayIntent?.conversationProjection?.verificationState?.verifierRef, 'agent-host-browser-acceptance');
  assert.deepEqual(result.displayIntent?.conversationProjection?.auditRefs, [sourceRef, textRef]);
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
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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

test('SSE reader exposes generic public hard-confirm fields without leaking commands or private refs', async () => {
  const commandId = 'codex-command-public-hard-confirm';
  const body = [
    'event: gui_ask_user',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_ask_user',
      provider: 'https://provider.example.test/v1',
      model: 'private-model-token-sk-secret',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      raw: {
        source: `gui.ask_user:${commandId}`,
        askUser: {
          kind: 'hard-confirm',
          title: 'External form submission requires confirmation',
          message: 'Please confirm the external submission.',
          approvalRequest: {
            id: 'approval:browser:submit-application',
            action: 'submit application form',
            actionKind: 'submit-form',
            target: 'Example Jobs application form',
            impact: 'Submits the prepared application to the external site.',
            evidenceRefs: [
              'browser-runtime:job-application/review-state',
              'artifact:application-preview',
              '.sciforge/raw/private-trace.json',
              'stdout:.sciforge/stdout.log',
            ],
            authorizationProfile: {
              label: 'High Autonomy',
              scope: 'current-turn',
              privatePolicyRef: '.sciforge/private/policy.json',
            },
            commandText: '/browser click --selector "#submit" --token sk-secret',
            rawPayload: { token: 'sk-secret', url: 'https://private.example.test/?token=sk-secret' },
          },
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
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');
  const response = createSseResponse(body);

  const stream = await readWorkspaceToolStream(response, () => undefined);
  const result = stream.result as {
    message?: string;
    guiAskUser?: {
      publicProjection?: {
        action?: string;
        target?: string;
        impact?: string;
        evidenceRefs?: string[];
        authorizationProfile?: string;
      };
      choices?: Array<{ label?: string; commandText?: string }>;
      approvalRequest?: Record<string, unknown>;
    };
  };

  assert.equal(stream.error, undefined);
  assert.deepEqual(result.guiAskUser?.publicProjection, {
    action: 'submit application form',
    target: 'Example Jobs application form',
    impact: 'Submits the prepared application to the external site.',
    evidenceRefs: ['browser-runtime:job-application/review-state', 'artifact:application-preview'],
    authorizationProfile: 'High Autonomy',
  });
  assert.equal(result.guiAskUser?.choices?.[0]?.label, 'Confirm');
  assert.equal(result.guiAskUser?.choices?.[1]?.label, 'Cancel');
  assert.match(result.guiAskUser?.choices?.[0]?.commandText ?? '', /^\/computer-use approve --approval-ref /);
  assert.match(result.message ?? '', /Action: submit application form/);
  assert.match(result.message ?? '', /Target: Example Jobs application form/);
  assert.match(result.message ?? '', /Impact: Submits the prepared application/);
  assert.match(result.message ?? '', /Authorization profile: High Autonomy/);
  assert.doesNotMatch(JSON.stringify(result), /provider\.example|sk-secret|private\.example|private-trace|stdout\.log|rawPayload|commandText.*#submit/);
});

test('SSE reader preserves approval refs containing risk-missing without treating them as sk secrets', async () => {
  const commandId = 'codex-command-public-approval-ref-risk-missing';
  const approvalRef = 'approval:computer-use:chat-live-risk-missing-round-1';
  const secretApprovalRef = 'approval:computer-use:sk-real-secret-token-12345678';
  const body = [
    'event: gui_ask_user',
    `data: ${JSON.stringify({
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'gui_ask_user',
      commandId,
      attemptId: `${commandId}-attempt-1`,
      raw: {
        source: `gui.ask_user:${commandId}`,
        askUser: {
          kind: 'hard-confirm',
          title: 'External action requires confirmation',
          approvalRequest: {
            id: approvalRef,
            approvalRef,
            approval_ref: secretApprovalRef,
            risk_level: 'high',
            action_kind: 'external-send',
          },
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
      commandId,
      attemptId: `${commandId}-attempt-1`,
    })}`,
    '',
  ].join('\n');

  const stream = await readWorkspaceToolStream(createSseResponse(body), () => undefined);
  const result = stream.result as {
    guiAskUser?: {
      approvalRequest?: Record<string, unknown>;
      choices?: Array<{ commandText?: string }>;
    };
  };

  assert.equal(stream.error, undefined);
  assert.equal(result.guiAskUser?.approvalRequest?.id, approvalRef);
  assert.equal(result.guiAskUser?.approvalRequest?.approvalRef, approvalRef);
  assert.equal(result.guiAskUser?.approvalRequest?.approval_ref, undefined);
  assert.equal(result.guiAskUser?.choices?.[0]?.commandText, `/computer-use approve --approval-ref "${approvalRef}"`);
  assert.doesNotMatch(JSON.stringify(result), /sk-real-secret-token/);
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
      provider: 'sciforge-model-router',
      model: 'sciforge-router',
      profile: 'sciforge-runtime-default',
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
    artifacts?: Array<{ type?: string; data?: Record<string, unknown> }>;
  };

  assert.equal(stream.error, undefined);
  assert.match(result.message ?? '', /Confirmation required/);
  assert.match(result.message ?? '', /Allow the operation to click/);
  assert.doesNotMatch(result.message ?? '', /approval:computer-use:cu-risk|vision-trace|Approval ref|Evidence refs|Choices|\/computer-use/);
  assert.equal(result.guiAskUser?.approvalRequest?.id, 'approval:computer-use:cu-risk');
  assert.deepEqual(result.guiAskUser?.relatedRefs, [traceRef, screenshotRef]);
  assert.ok(result.guiPresentation?.displayedRefs?.includes(traceRef));
  const artifactRefs = result.displayIntent?.conversationProjection?.artifacts?.map((artifact) => artifact.ref) ?? [];
  assert.ok(artifactRefs.includes(traceRef));
  assert.ok(artifactRefs.includes(screenshotRef));
  assert.ok(artifactRefs.includes('EU-computer-use-risk'));
  assert.ok(artifactRefs.includes('workEvidence:vision-sense-computer-use:cu-risk'));
  assert.ok(artifactRefs.some((ref) => ref?.startsWith('artifact:computer-use-screen-evidence-')));
  const screenArtifact = result.artifacts?.find((artifact) => artifact.type === 'image-evidence');
  assert.equal(screenArtifact?.data?.currentFrameRef, screenshotRef);
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

test('NDJSON reader preserves VirtualAppScreen target binding and frame dimensions in gui.present artifacts', async () => {
  const commandId = 'computer-use-command-screen-carrier';
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
              title: 'Computer Use screen',
              status: 'ready',
              sessionRef: 'computer-use:session/screen-carrier/session.json',
              screenRef: 'virtual-app-screen:screen-carrier/main',
              targetAppRef: 'app:vscode',
              targetWindowRef: 'window:vscode/main',
              currentFrameRef: 'computer-use:session/screen-carrier/frames/current.png',
              frameStreamRef: 'computer-use:session/screen-carrier/frame-stream.json',
              inputLeaseRef: 'computer-use:session/screen-carrier/leases/active.json',
              actionAdapterRef: 'computer-use:session/screen-carrier/adapters/native-window.json',
              adapterReadinessRef: 'computer-use:session/screen-carrier/readiness/native-window.json',
              evidenceLedgerRef: 'computer-use:session/screen-carrier/evidence-ledger.json',
              inputIntentRefs: ['computer-use:session/screen-carrier/input-intents/latest.json'],
              executorEventRefs: ['computer-use:session/screen-carrier/executor-events/latest.json'],
              screen: { width: 1440, height: 900, label: 'screen-1' },
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
    artifacts?: Array<{ type?: string; data?: Record<string, unknown> }>;
    displayIntent?: { conversationProjection?: { visibleAnswer?: { artifactRefs?: string[] } } };
  };
  const screenArtifact = result.artifacts?.find((artifact) => artifact.type === 'image-evidence');
  const data = screenArtifact?.data as Record<string, unknown> | undefined;

  assert.equal(stream.error, undefined);
  assert.ok(data);
  assert.equal(data?.targetAppRef, 'app:vscode');
  assert.equal(data?.targetWindowRef, 'window:vscode/main');
  assert.equal(data?.currentFrameRef, 'computer-use:session/screen-carrier/frames/current.png');
  assert.equal(data?.frameStreamRef, 'computer-use:session/screen-carrier/frame-stream.json');
  assert.deepEqual(data?.screen, { width: 1440, height: 900, label: 'screen-1' });
  assert.equal(data?.inputLeaseRef, 'computer-use:session/screen-carrier/leases/active.json');
  assert.equal(data?.actionAdapterRef, 'computer-use:session/screen-carrier/adapters/native-window.json');
  assert.equal(data?.adapterReadinessRef, 'computer-use:session/screen-carrier/readiness/native-window.json');
  assert.equal(data?.evidenceLedgerRef, 'computer-use:session/screen-carrier/evidence-ledger.json');
  assert.ok(result.displayIntent?.conversationProjection?.visibleAnswer?.artifactRefs?.some((ref) => ref.startsWith('artifact:computer-use-screen-evidence-')));
  assert.doesNotMatch(JSON.stringify(data), /data:image|base64|providerRoute|desktopBridge|executorLease|schedulerParams/);
});

test('NDJSON reader exposes Computer Use repair sidecars without GUI-derived continuation actions', async () => {
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
  assert.deepEqual(projection?.recoverActions, []);
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
  assert.equal(result.displayIntent?.conversationProjection?.visibleAnswer?.status, 'partial-ready');
  assert.ok(result.displayIntent?.conversationProjection?.visibleAnswer?.artifactRefs?.includes(diagnosticRef));
});

test('NDJSON reader projects Computer Use blocked sidecars without GUI-derived continuation actions', async () => {
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
  assert.deepEqual(projection?.recoverActions, []);
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

test('Runtime event normalization folds raw HTML and JSON bodies before presentation', () => {
  const html = normalizeWorkspaceRuntimeEvent({
    type: 'status',
    message: '<!DOCTYPE html><html><title>Attention Required</title><body>CF-RAY provider page</body></html>',
  });
  const json = normalizeWorkspaceRuntimeEvent({
    type: 'status',
    message: JSON.stringify({
      stdoutRef: '.sciforge/logs/stdout.log',
      rawRef: '.sciforge/raw/provider.json',
      payload: 'RAW_PROVIDER_BODY_SHOULD_NOT_RENDER',
    }),
  });

  assert.match(html.detail ?? '', /Runtime event recorded|transport output recorded/i);
  assert.match(json.detail ?? '', /Runtime event recorded|folded run audit/i);
  assert.doesNotMatch(`${html.detail}\n${json.detail}`, /Attention Required|CF-RAY|RAW_PROVIDER_BODY|stdoutRef|rawRef|<html/i);
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

test('Runtime Codex metadata event details redact private workspace paths before presentation', () => {
  const event = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'run_started',
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    profile: 'sciforge-runtime-deepseek',
    workspace: '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
    commandId: 'codex-command-visible',
    message: 'Runtime Codex started with sciforge-deepseek-proxy/bailian/deepseek-v4-flash profile sciforge-runtime-deepseek workspace /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
  });

  assert.match(event.detail ?? '', /Runtime Codex metadata/);
  assert.match(event.detail ?? '', /workspace=\[redacted-workspace\]/);
  assert.match(event.detail ?? '', /command=codex-command-visible/);
  assert.doesNotMatch(event.detail ?? '', /\/Applications\/workspace|parallel\/p1/);
});

test('Runtime Codex provider message events summarize native-message layering without leaking raw payload internals', () => {
  const event = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'message',
    text: 'RAW_PROVIDER_MESSAGE_SHOULD_NOT_SURFACE',
    commandId: 'codex-command-provider-message',
    profile: 'sciforge-runtime-default',
  });

  assert.match(event.detail ?? '', /native assistant message recorded/i);
  assert.match(event.detail ?? '', /folded in the run audit/i);
  assert.doesNotMatch(event.detail ?? '', /RAW_PROVIDER_MESSAGE_SHOULD_NOT_SURFACE/);
});

test('Runtime Codex context window events preserve Cursor-like public category breakdown', () => {
  const event = normalizeWorkspaceRuntimeEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'contextWindowState',
    usedTokens: 70500,
    windowTokens: 200000,
    source: 'native',
    provider: 'private-provider-should-not-render',
    model: 'private-model-should-not-render',
    contextBreakdown: {
      system_prompt_tokens: 501,
      tool_definition_tokens: 7500,
      rules_tokens: 3100,
      skills_tokens: 1500,
      mcp_tokens: 3100,
      subagent_definition_tokens: 577,
      conversation_tokens: 54100,
    },
  });

  assert.equal(event.type, 'contextWindowState');
  assert.deepEqual(event.contextWindowState?.breakdown, {
    systemPrompt: 501,
    toolDefinitions: 7500,
    rules: 3100,
    skills: 1500,
    mcp: 3100,
    subagentDefinitions: 577,
    conversation: 54100,
  });
  assert.equal(event.contextWindowState?.provider, 'private-provider-should-not-render');
  assert.equal(event.contextWindowState?.model, 'private-model-should-not-render');
});
