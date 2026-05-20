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
import type { JsonRecord, WebE2eFixtureWorkspace } from '../types.js';

export const GUI_ACTION_COMMAND_TRACE_CASE_ID = 'SA-WEB-28';

export type GuiActionKind = 'open' | 'retry' | 'export' | 'recover' | 'delete';
export type GuiActionSurface = 'artifact-card' | 'run-panel' | 'audit-panel' | 'recovery-panel' | 'selected-object-panel';

export interface GuiActionCommandTraceEvent {
  step: number;
  action: GuiActionKind;
  surface: GuiActionSurface;
  visibleLabel: string;
  selectedObjectRef?: string;
  panelId: string;
  commandText: string;
  terminalEquivalent: true;
  refs: string[];
  auditTraceRef: string;
  dispatchRoute: 'runtime-dispatch';
  businessPayload?: never;
  localBusinessExecution?: never;
}

export interface GuiActionCommandTraceCaseResult {
  fixture: WebE2eFixtureWorkspace;
  actions: GuiActionCommandTraceEvent[];
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
  forbiddenBusinessPayloadKeys: string[];
}

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-28';
const scenarioId = 'scenario-sa-web-28';
const runId = 'run-sa-web-28-current';
const visibleAnswerText = [
  'Text-only GUI action contract completed.',
  'Open, retry, export, recover, and delete visible GUI actions were reduced to terminal-equivalent commandText.',
  'Each dispatch carried refs plus audit trace, and no hidden business payload or local GUI business execution was present.',
].join(' ');

const forbiddenBusinessPayloadKeys = [
  'businessPayload',
  'localBusinessExecution',
  'hiddenPayload',
  'mutationPayload',
  'artifactBody',
  'runRecoveryObject',
  'deleteFile',
  'triggerRecover',
  'UserActionApi',
  'ProjectionApi',
];

export async function runGuiActionCommandTraceCase(options: {
  baseDir?: string;
  now?: string;
} = {}): Promise<GuiActionCommandTraceCaseResult> {
  const fixedNow = options.now ?? now;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: GUI_ACTION_COMMAND_TRACE_CASE_ID,
    baseDir: options.baseDir,
    scenarioId,
    sessionId,
    runId,
    now: fixedNow,
    title: 'Text-only GUI action command trace Web E2E case',
    prompt: 'Exercise visible GUI actions across artifact, panel, and selected-object changes and report their terminal commandText.',
  });
  const actions = guiActionCommandTraceTranscript();
  await finalizeGuiActionCommandTraceFixture(fixture, actions, fixedNow);

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

  const result: GuiActionCommandTraceCaseResult = {
    fixture,
    actions,
    browserVisibleState,
    verifierInput,
    forbiddenBusinessPayloadKeys,
  };
  assertGuiActionCommandTraceCase(result);
  return result;
}

export function assertGuiActionCommandTraceCase(result: GuiActionCommandTraceCaseResult): void {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.deepEqual(
    result.actions.map((event) => event.action),
    ['open', 'retry', 'export', 'recover', 'delete'],
    'contract must cover open/retry/export/recover/delete visible GUI actions',
  );
  assert.deepEqual(
    result.actions.map((event) => event.surface),
    ['artifact-card', 'run-panel', 'audit-panel', 'recovery-panel', 'selected-object-panel'],
    'actions must span artifact, panel, and selected-object GUI surfaces',
  );

  const changedPanels = new Set(result.actions.map((event) => event.panelId));
  assert.ok(changedPanels.has('artifact-preview') && changedPanels.has('run-control') && changedPanels.has('selected-object'), 'case must move across panels');
  assert.ok(
    result.actions.some((event) => event.selectedObjectRef === 'artifact:fixture-current-report')
      && result.actions.some((event) => event.selectedObjectRef === 'artifact:fixture-old-report'),
    'case must exercise selected object changes',
  );

  for (const event of result.actions) {
    assert.equal(event.terminalEquivalent, true, `${event.action}: GUI action must be terminal-equivalent`);
    assert.equal(event.dispatchRoute, 'runtime-dispatch', `${event.action}: GUI action must dispatch like a terminal command`);
    assert.match(event.commandText, /\S/, `${event.action}: commandText must be non-empty text`);
    assert.equal(isTerminalEquivalentCommandText(event.commandText), true, `${event.action}: commandText must not contain GUI business function calls`);
    assert.ok(event.refs.length > 0, `${event.action}: refs must accompany commandText`);
    assert.ok(event.refs.every((ref) => /^(artifact|run|audit|approval|file):/.test(ref)), `${event.action}: refs must be durable ref strings`);
    assert.match(event.auditTraceRef, /^audit:\/\/sa-web-28\/gui-action\//, `${event.action}: audit trace ref must be present`);
    assert.equal(hasOwn(event, 'businessPayload'), false, `${event.action}: hidden business payload must be absent`);
    assert.equal(hasOwn(event, 'localBusinessExecution'), false, `${event.action}: local GUI business execution must be absent`);
  }

  assert.equal(commandFor(result.actions, 'open'), 'open "artifact:fixture-current-report"');
  assert.match(commandFor(result.actions, 'retry'), /^\/rerun "run-sa-web-28-current" --with-repair-evidence/);
  assert.equal(commandFor(result.actions, 'export'), 'export --audit "run-sa-web-28-current" --ref "artifact:fixture-current-report"');
  assert.match(commandFor(result.actions, 'recover'), /^\/recover "run-sa-web-28-current" --with-evidence --action "Regenerate missing preview metadata\."/);
  assert.equal(commandFor(result.actions, 'delete'), '/approve approval-delete-fixture-old-report --ref "artifact:fixture-old-report"');

  const transcriptBlob = JSON.stringify({
    actions: result.actions,
    projection: result.fixture.expectedProjection.conversationProjection,
    browserVisibleState: result.browserVisibleState,
  });
  for (const forbidden of result.forbiddenBusinessPayloadKeys) {
    assert.doesNotMatch(transcriptBlob, new RegExp(escapeRegExp(forbidden), 'i'), `${forbidden}: hidden GUI business payload/local execution must be absent`);
  }
  assert.match(result.browserVisibleState.visibleAnswerText ?? '', /no hidden business payload or local GUI business execution/i);
}

function guiActionCommandTraceTranscript(): GuiActionCommandTraceEvent[] {
  return [
    {
      step: 1,
      action: 'open',
      surface: 'artifact-card',
      visibleLabel: 'Open report',
      selectedObjectRef: 'artifact:fixture-current-report',
      panelId: 'artifact-preview',
      commandText: 'open "artifact:fixture-current-report"',
      terminalEquivalent: true,
      refs: ['artifact:fixture-current-report'],
      auditTraceRef: 'audit://sa-web-28/gui-action/open-current-report',
      dispatchRoute: 'runtime-dispatch',
    },
    {
      step: 2,
      action: 'retry',
      surface: 'run-panel',
      visibleLabel: 'Retry with repair evidence',
      selectedObjectRef: 'run:run-sa-web-28-current',
      panelId: 'run-control',
      commandText: '/rerun "run-sa-web-28-current" --with-repair-evidence --reason "repair missing verifier refs" --ref "audit:sa-web-28-action-open"',
      terminalEquivalent: true,
      refs: ['run:run-sa-web-28-current', 'audit:sa-web-28-action-open'],
      auditTraceRef: 'audit://sa-web-28/gui-action/retry-current-run',
      dispatchRoute: 'runtime-dispatch',
    },
    {
      step: 3,
      action: 'export',
      surface: 'audit-panel',
      visibleLabel: 'Export action trace',
      selectedObjectRef: 'artifact:fixture-current-report',
      panelId: 'audit-export',
      commandText: 'export --audit "run-sa-web-28-current" --ref "artifact:fixture-current-report"',
      terminalEquivalent: true,
      refs: ['run:run-sa-web-28-current', 'artifact:fixture-current-report', 'audit:sa-web-28-action-retry'],
      auditTraceRef: 'audit://sa-web-28/gui-action/export-trace',
      dispatchRoute: 'runtime-dispatch',
    },
    {
      step: 4,
      action: 'recover',
      surface: 'recovery-panel',
      visibleLabel: 'Recover preview metadata',
      selectedObjectRef: 'artifact:fixture-current-report',
      panelId: 'recovery-panel',
      commandText: '/recover "run-sa-web-28-current" --with-evidence --action "Regenerate missing preview metadata." --ref "artifact:fixture-current-report"',
      terminalEquivalent: true,
      refs: ['run:run-sa-web-28-current', 'artifact:fixture-current-report', 'audit:sa-web-28-action-export'],
      auditTraceRef: 'audit://sa-web-28/gui-action/recover-preview-metadata',
      dispatchRoute: 'runtime-dispatch',
    },
    {
      step: 5,
      action: 'delete',
      surface: 'selected-object-panel',
      visibleLabel: 'Delete stale selected report',
      selectedObjectRef: 'artifact:fixture-old-report',
      panelId: 'selected-object',
      commandText: '/approve approval-delete-fixture-old-report --ref "artifact:fixture-old-report"',
      terminalEquivalent: true,
      refs: ['approval:approval-delete-fixture-old-report', 'artifact:fixture-old-report', 'audit:sa-web-28-action-recover'],
      auditTraceRef: 'audit://sa-web-28/gui-action/delete-stale-selection',
      dispatchRoute: 'runtime-dispatch',
    },
  ];
}

async function finalizeGuiActionCommandTraceFixture(
  fixture: WebE2eFixtureWorkspace,
  actions: GuiActionCommandTraceEvent[],
  fixedNow: string,
): Promise<void> {
  const auditRefs = uniqueStrings([
    ...fixture.expectedProjection.runAuditRefs,
    ...actions.map((event) => event.auditTraceRef),
    ...actions.flatMap((event) => event.refs),
    'runtime-dispatch://sa-web-28/gui-action-commandText-dispatches',
  ]);
  const projection: ConversationProjection = {
    ...fixture.expectedProjection.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: visibleAnswerText,
      artifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    },
    activeRun: { id: fixture.runId, status: 'satisfied' },
    executionProcess: actions.map((event) => ({
      eventId: `sa-web-28-${event.step}-${event.action}`,
      type: 'HarnessDecisionRecorded',
      summary: `${event.visibleLabel} reduced to terminal-equivalent commandText and dispatched with refs/audit trace.`,
      timestamp: fixedNow,
    })),
    recoverActions: [],
    auditRefs,
    diagnostics: [{
      severity: 'info',
      code: 'text-only-gui-action-command-trace',
      message: 'Visible GUI actions carried only commandText, refs, and audit trace; GUI-local business execution was absent.',
      refs: auditRefs.map((ref) => ({ ref })),
    }],
  };
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.runAuditRefs = auditRefs;

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = {
    ...session,
    title: 'Text-only GUI action command trace Web E2E case',
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
            guiActionCommandTrace: {
              actions: actions.map(actionTraceForRaw),
              reducedTo: 'terminal-equivalent-commandText',
              localBusinessFunctionCalls: [],
            },
          },
          resultPresentation: { conversationProjection: projection },
        },
      }
      : run),
    executionUnits: [
      ...(session.executionUnits ?? []),
      ...executionUnitsForActions(actions, fixedNow),
    ],
    updatedAt: fixedNow,
  };
  await writeJson(fixture.expectedProjectionPath, fixture.expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);
}

function executionUnitsForActions(actions: GuiActionCommandTraceEvent[], fixedNow: string): RuntimeExecutionUnit[] {
  return actions.map((event): RuntimeExecutionUnit => ({
    id: `EU-sa-web-28-${event.step}`,
    tool: 'gui.commandTextAction',
    params: `action=${event.action} commandText=${event.commandText}`,
    status: 'done',
    hash: `sa-web-28-${event.step}`,
    runId,
    outputRef: event.auditTraceRef,
    outputArtifacts: event.refs,
    time: fixedNow,
  }));
}

function actionTraceForRaw(event: GuiActionCommandTraceEvent): JsonRecord {
  return {
    step: event.step,
    action: event.action,
    surface: event.surface,
    visibleLabel: event.visibleLabel,
    selectedObjectRef: event.selectedObjectRef ?? null,
    panelId: event.panelId,
    commandText: event.commandText,
    terminalEquivalent: event.terminalEquivalent,
    refs: event.refs,
    auditTraceRef: event.auditTraceRef,
    dispatchRoute: event.dispatchRoute,
  };
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

function commandFor(actions: GuiActionCommandTraceEvent[], action: GuiActionKind): string {
  const event = actions.find((candidate) => candidate.action === action);
  assert.ok(event, `${action}: action must exist`);
  return event.commandText;
}

function isTerminalEquivalentCommandText(commandText: string): boolean {
  return commandText.trim().length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi|localBusinessExecution|businessPayload)\b/.test(commandText);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
