import assert from 'node:assert/strict';
import type { AgentStreamEvent, SendAgentMessageInput } from '../../src/ui/src/domain';
import { sendSciForgeToolMessage } from '../../src/ui/src/api/sciforgeToolsClient';

const originalFetch = globalThis.fetch;
const COMPUTER_USE_ACTION_PROVIDER_ID = 'action.sciforge.computer-use';

try {
  await smokeNaturalLanguageGuiPresent();
  await smokeNeedsConfirmationProjection();
  console.log('[ok] Computer Use chat E2E protocol smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}

async function smokeNaturalLanguageGuiPresent() {
  const bodies: Array<Record<string, unknown>> = [];
  const events: AgentStreamEvent[] = [];
  const finalArtifactRef = '.sciforge/vision-runs/chat-e2e-present/report.md';
  globalThis.fetch = (async (url, init) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    assert.match(String(url), /\/api\/sciforge\/tools\/run\/stream$/);
    return ndjsonResponse([
      {
        event: computerUseHostActionsEvent(String(bodies[0]?.uiState && (bodies[0].uiState as Record<string, unknown>).commandId), [{
          port: 'gui.present',
          target: 'computer-use.trace-summary',
          payload: {
            title: 'Computer Use report',
            status: 'completed',
            message: 'Computer Use produced a visible report artifact.',
            traceRefs: ['.sciforge/vision-runs/chat-e2e-present/vision-trace.json'],
            screenshotRefs: ['.sciforge/vision-runs/chat-e2e-present/step-001-after.png'],
            artifactRefs: [finalArtifactRef],
            executionUnitRefs: ['EU-chat-e2e-present'],
            workEvidenceRefs: ['workEvidence:computer-use-action-provider:chat-e2e-present'],
          },
        }]),
      },
      { result: workspaceResult('completed') },
    ]);
  }) as typeof fetch;

  const response = await sendSciForgeToolMessage(input({
    prompt: 'Use the visible desktop to inspect the files and produce a short index report.',
    selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
  }), {
    onEvent: (event) => events.push(event),
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.handoffSource, 'ui-chat');
  assert.equal(bodies[0]?.prompt, 'Use the visible desktop to inspect the files and produce a short index report.');
  assert.deepEqual(bodies[0]?.selectedActionIds, [COMPUTER_USE_ACTION_PROVIDER_ID]);
  assert.ok(events.some((event) => event.type === 'computer-use.tui-host-actions'));
  assert.equal(response.message.status, 'completed');
  assert.match(response.message.content, /Computer Use produced a visible report artifact/);
  assert.match(String(response.message.provenance?.source), /^gui\.present:computer-use-command-.*:computer-use$/);
  assert.ok(response.message.objectReferences?.some((reference) => reference.ref === `file:${finalArtifactRef}`));
}

async function smokeNeedsConfirmationProjection() {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const commandId = String((bodies[0]?.uiState as Record<string, unknown> | undefined)?.commandId);
    return ndjsonResponse([
      {
        event: computerUseHostActionsEvent(commandId, [{
          port: 'gui.present',
          target: 'computer-use.trace-summary',
          payload: {
            title: 'Computer Use guarded action',
            status: 'needs-confirmation',
            message: 'Computer Use stopped before the external send.',
            traceRefs: ['.sciforge/vision-runs/chat-e2e-risk/vision-trace.json'],
            screenshotRefs: ['.sciforge/vision-runs/chat-e2e-risk/step-003-before-send.png'],
            artifactRefs: ['.sciforge/vision-runs/chat-e2e-risk/mail-draft.md'],
            executionUnitRefs: ['EU-chat-e2e-risk'],
            workEvidenceRefs: ['workEvidence:computer-use-action-provider:chat-e2e-risk'],
          },
        }, {
          port: 'gui.ask_user',
          target: 'computer-use.approval-request',
          payload: {
            approvalRequest: {
              id: 'approval:computer-use:chat-e2e-risk',
              confirmation_text: 'Allow Computer Use to send the drafted external email?',
              risk_level: 'high',
              action_kind: 'external-send',
            },
            relatedRefs: [
              '.sciforge/vision-runs/chat-e2e-risk/vision-trace.json',
              '.sciforge/vision-runs/chat-e2e-risk/risk-audit.json',
            ],
          },
        }]),
      },
      { result: workspaceResult('needs-confirmation') },
    ]);
  }) as typeof fetch;

  const response = await sendSciForgeToolMessage(input({
    prompt: 'Research the topic and draft an email, but stop before sending it.',
    selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
  }));

  assert.equal(response.message.provenance?.requiresUserConfirmation, true);
  assert.match(response.message.content, /Allow Computer Use to send the drafted external email/);
  assert.match(response.message.content, /Approval ref: `approval:computer-use:chat-e2e-risk`/);
  assert.match(String(response.message.provenance?.source), /^gui\.ask_user:computer-use-command-.*:computer-use$/);
  const raw = response.run.raw as Record<string, unknown>;
  assert.equal((raw.guiAskUser as Record<string, unknown> | undefined)?.source, `gui.ask_user:${response.run.id}:computer-use`);
  assert.ok(response.message.objectReferences?.some((reference) => reference.ref.endsWith('risk-audit.json')));
}

function input(options: {
  prompt: string;
  selectedActionIds: string[];
}): SendAgentMessageInput {
  return {
    sessionId: 'computer-use-chat-e2e-session',
    scenarioId: 'literature-evidence-review',
    agentName: 'SciForge',
    agentDomain: 'literature',
    prompt: options.prompt,
    references: [],
    roleView: 'researcher',
    messages: [],
    artifacts: [],
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
      visionAllowSharedSystemInput: false,
      updatedAt: '2026-05-29T00:00:00.000Z',
    },
    availableComponentIds: [],
    scenarioOverride: {
      title: 'Computer Use chat E2E',
      description: 'Chat-triggered Computer Use E2E protocol smoke.',
      skillDomain: 'literature',
      scenarioMarkdown: '# Computer Use chat E2E',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      selectedActionIds: options.selectedActionIds,
    },
  };
}

function computerUseHostActionsEvent(commandId: string, actions: Array<Record<string, unknown>>) {
  return {
    type: 'computer-use.tui-host-actions',
    source: 'computer-use-package-bridge',
    commandId,
    attemptId: `${commandId}-attempt-1`,
    detail: {
      schemaVersion: 'sciforge.computer-use.tui-host-actions-batch.v1',
      actions: actions.map((action) => ({
        schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
        ...action,
      })),
    },
  };
}

function workspaceResult(status: string) {
  return {
    status,
    message: `Computer Use chat E2E ${status}.`,
    executionUnits: [{ id: `EU-chat-e2e-${status}`, status: status === 'completed' ? 'done' : 'blocked' }],
    artifacts: [],
  };
}

function ndjsonResponse(items: unknown[]) {
  return new Response(`${items.map((item) => JSON.stringify(item)).join('\n')}\n`, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
