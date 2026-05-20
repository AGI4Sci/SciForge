import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { RuntimeExecutionUnit } from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { WebE2eFixtureWorkspace } from '../types.js';

export const GUI_ASK_USER_CLARIFICATION_CASE_ID = 'SA-WEB-24';

export type GuiAskUserClarificationEvent =
  | {
    step: number;
    type: 'intent';
    intent: 'needs-clarification';
    reason: string;
  }
  | {
    step: number;
    type: 'gui.ask_user';
    tool: 'gui.ask_user';
    visiblePrompt: string;
    promptVisible: boolean;
    responseMode: 'terminal-equivalent-commandText';
  }
  | {
    step: number;
    type: 'user-text';
    text: string;
  }
  | {
    step: number;
    type: 'commandText';
    commandText: string;
    terminalEquivalent: true;
  }
  | {
    step: number;
    type: 'dispatch';
    route: 'runtime-dispatch';
    commandText: string;
    localBusinessFunction?: never;
  };

export interface GuiAskUserClarificationCaseResult {
  fixture: WebE2eFixtureWorkspace;
  transcript: GuiAskUserClarificationEvent[];
  intentPrompt: string;
  visiblePrompt: string;
  userText: string;
  commandText: string;
  forbiddenLocalBusinessFunctions: string[];
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-24';
const scenarioId = 'scenario-sa-web-24';
const runId = 'run-sa-web-24-current';
const intentPrompt = 'The user wants to rerun the differential expression filter with q_value < 0.01, but destructive reruns require confirmation.';
const visiblePrompt = 'Confirm rerun with q_value < 0.01 and replace the previous result?';
const userText = 'Confirm: rerun with q_value < 0.01 and replace the previous result.';
const visibleAnswerText = [
  'gui.ask_user clarification completed.',
  'The clarification intent produced a visible prompt, the user reply was returned as terminal-equivalent commandText,',
  'and no GUI local business function applied the q_value change.',
].join(' ');
const forbiddenLocalBusinessFunctions = [
  'gui.apply_batch',
  'local.applyThreshold',
  'ui.applyFilter',
  'business.rerunDifferentialExpression',
];

export async function runGuiAskUserClarificationCase(options: {
  baseDir?: string;
  now?: string;
} = {}): Promise<GuiAskUserClarificationCaseResult> {
  const fixedNow = options.now ?? now;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: GUI_ASK_USER_CLARIFICATION_CASE_ID,
    baseDir: options.baseDir,
    scenarioId,
    sessionId,
    runId,
    now: fixedNow,
    title: 'gui.ask_user clarification Web E2E case',
    prompt: intentPrompt,
  });
  const transcript = guiAskUserClarificationTranscript();
  await finalizeGuiAskUserClarificationFixture(fixture, transcript, fixedNow);

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const browserVisibleState = browserVisibleStateFromExpected(fixture);
  const verifierInput: WebE2eContractVerifierInput = {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
  assertWebE2eContract(verifierInput);

  const result: GuiAskUserClarificationCaseResult = {
    fixture,
    transcript,
    intentPrompt,
    visiblePrompt,
    userText,
    commandText: userText,
    forbiddenLocalBusinessFunctions,
    browserVisibleState,
    verifierInput,
  };
  assertGuiAskUserClarificationCase(result);
  return result;
}

export function assertGuiAskUserClarificationCase(result: GuiAskUserClarificationCaseResult): void {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  const sequence = result.transcript.map((event) => event.type);
  assert.deepEqual(
    sequence,
    ['intent', 'gui.ask_user', 'user-text', 'commandText', 'dispatch'],
    'gui.ask_user clarification must preserve intent -> visible prompt -> user text -> commandText -> dispatch order',
  );

  const intent = result.transcript[0];
  assert.equal(intent?.type, 'intent');
  assert.match(intent.reason, /destructive reruns require confirmation/i);

  const askUser = result.transcript[1];
  assert.equal(askUser?.type, 'gui.ask_user');
  assert.equal(askUser.tool, 'gui.ask_user');
  assert.equal(askUser.visiblePrompt, result.visiblePrompt);
  assert.equal(askUser.promptVisible, true, 'gui.ask_user prompt must be visible to the user');
  assert.equal(askUser.responseMode, 'terminal-equivalent-commandText');

  const userEvent = result.transcript[2];
  assert.equal(userEvent?.type, 'user-text');
  assert.equal(userEvent.text, result.userText);

  const commandEvent = result.transcript[3];
  assert.equal(commandEvent?.type, 'commandText');
  assert.equal(commandEvent.commandText, result.userText, 'user text confirmation must return as commandText');
  assert.equal(commandEvent.terminalEquivalent, true, 'commandText must be terminal-equivalent');
  assert.equal(result.commandText, result.userText);

  const dispatch = result.transcript[4];
  assert.equal(dispatch?.type, 'dispatch');
  assert.equal(dispatch.route, 'runtime-dispatch', 'confirmed commandText must route like a terminal command');
  assert.equal(dispatch.commandText, result.commandText);

  const transcriptBlob = JSON.stringify(result.transcript);
  for (const forbidden of result.forbiddenLocalBusinessFunctions) {
    assert.doesNotMatch(transcriptBlob, new RegExp(escapeRegExp(forbidden), 'i'), `${forbidden}: GUI local business function must not run`);
  }
  assert.match(result.browserVisibleState.visibleAnswerText ?? '', /no GUI local business function/i);
}

function guiAskUserClarificationTranscript(): GuiAskUserClarificationEvent[] {
  return [
    {
      step: 1,
      type: 'intent',
      intent: 'needs-clarification',
      reason: 'q_value rerun can replace the previous result, so destructive reruns require confirmation',
    },
    {
      step: 2,
      type: 'gui.ask_user',
      tool: 'gui.ask_user',
      visiblePrompt,
      promptVisible: true,
      responseMode: 'terminal-equivalent-commandText',
    },
    {
      step: 3,
      type: 'user-text',
      text: userText,
    },
    {
      step: 4,
      type: 'commandText',
      commandText: userText,
      terminalEquivalent: true,
    },
    {
      step: 5,
      type: 'dispatch',
      route: 'runtime-dispatch',
      commandText: userText,
    },
  ];
}

async function finalizeGuiAskUserClarificationFixture(
  fixture: WebE2eFixtureWorkspace,
  transcript: GuiAskUserClarificationEvent[],
  fixedNow: string,
): Promise<void> {
  const auditRefs = uniqueStrings([
    ...fixture.expectedProjection.runAuditRefs,
    'runtime-dispatch://sa-web-24/gui-ask-user/intent',
    'gui://sa-web-24/ask-user/prompt',
    'message://sa-web-24/user-confirmation',
    'runtime-dispatch://sa-web-24/terminal-commandText-dispatch',
  ]);
  const projection: ConversationProjection = {
    ...fixture.expectedProjection.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: visibleAnswerText,
      artifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    },
    activeRun: { id: fixture.runId, status: 'satisfied' },
    executionProcess: [
      {
        eventId: 'sa-web-24-intent',
        type: 'HarnessDecisionRecorded',
        summary: 'Clarification intent selected gui.ask_user instead of a GUI-local mutation.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-24-visible-prompt',
        type: 'NeedsHuman',
        summary: visiblePrompt,
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-24-commandText',
        type: 'Satisfied',
        summary: 'User text confirmation returned as terminal-equivalent commandText and was dispatched through Runtime Codex.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs,
    diagnostics: [{
      severity: 'info',
      code: 'gui-ask-user-clarification',
      message: 'gui.ask_user produced a visible prompt and returned user text as terminal-equivalent commandText.',
      refs: auditRefs.map((ref) => ({ ref })),
    }],
  };
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.runAuditRefs = auditRefs;

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = {
    ...session,
    title: 'gui.ask_user clarification Web E2E case',
    messages: session.messages.map((message) => message.role === 'scenario'
      ? { ...message, content: visibleAnswerText, status: 'completed' }
      : message),
    runs: session.runs.map((run) => run.id === fixture.runId
      ? {
        ...run,
        status: 'completed',
        response: visibleAnswerText,
        completedAt: fixedNow,
        raw: {
          ...(isRecord(run.raw) ? run.raw : {}),
          displayIntent: {
            ...(isRecord(run.raw) && isRecord(run.raw.displayIntent) ? run.raw.displayIntent : {}),
            source: 'runtime-dispatch',
            conversationProjection: projection,
            guiAskUserClarification: {
              transcript,
              visiblePrompt,
              commandText: userText,
              terminalEquivalent: true,
              localBusinessFunctionCalls: [],
            },
          },
          resultPresentation: { conversationProjection: projection },
        },
      }
      : run),
    executionUnits: [
      ...(session.executionUnits ?? []),
      ...executionUnitsForTranscript(transcript, fixedNow),
    ],
    updatedAt: fixedNow,
  };
  await writeJson(fixture.expectedProjectionPath, fixture.expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);
}

function executionUnitsForTranscript(
  transcript: GuiAskUserClarificationEvent[],
  fixedNow: string,
): RuntimeExecutionUnit[] {
  return transcript.map((event): RuntimeExecutionUnit => ({
    id: `EU-sa-web-24-${event.step}`,
    tool: event.type === 'gui.ask_user' ? 'gui.ask_user' : `protocol.${event.type}`,
    params: event.type === 'commandText' || event.type === 'dispatch' ? `commandText=${event.commandText}` : `event=${event.type}`,
    status: 'done',
    hash: `sa-web-24-${event.step}`,
    runId,
    outputRef: outputRefForEvent(event),
    time: fixedNow,
  }));
}

function outputRefForEvent(event: GuiAskUserClarificationEvent): string {
  if (event.type === 'intent') return 'runtime-dispatch://sa-web-24/gui-ask-user/intent';
  if (event.type === 'gui.ask_user') return 'gui://sa-web-24/ask-user/prompt';
  if (event.type === 'user-text') return 'message://sa-web-24/user-confirmation';
  return 'runtime-dispatch://sa-web-24/terminal-commandText-dispatch';
}

function browserVisibleStateFromExpected(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
  return {
    status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    visibleAnswerText,
    visibleArtifactRefs: [
      ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
      ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
