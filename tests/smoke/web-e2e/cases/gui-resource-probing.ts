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

export const GUI_RESOURCE_PROBING_CASE_ID = 'SA-WEB-23';

export type GuiResourceProbePhase = 'shell' | 'hot-region' | 'narrow-question';
export type GuiResourceProbeTool = 'gui.list' | 'gui.stat' | 'gui.read';

export interface GuiResourceProbeOperation {
  step: number;
  tool: GuiResourceProbeTool;
  phase: GuiResourceProbePhase;
  path: string;
  reason: string;
  resultRef: string;
}

export interface GuiResource {
  path: string;
  disclosure: 'shell' | 'hot-region' | 'region-detail' | 'debug';
  revision: number;
  body: string;
}

export interface GuiResourceProbingCaseResult {
  fixture: WebE2eFixtureWorkspace;
  resources: Map<string, GuiResource>;
  operations: GuiResourceProbeOperation[];
  forbiddenResourcePaths: string[];
  narrowQuestion: string;
  terminalCommandText: string;
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-23';
const scenarioId = 'scenario-sa-web-23';
const runId = 'run-sa-web-23-current';
const fullDomSentinel = 'SA_WEB_23_FULL_DOM_SNAPSHOT_SENTINEL_DO_NOT_READ';
const debugSnapshotSentinel = 'SA_WEB_23_DEBUG_SNAPSHOT_SENTINEL_DO_NOT_READ';
const narrowQuestion = 'What commandText will the focused submit action send?';
const terminalCommandText = '/runtime-codex submit --from=chat-composer';
const visibleAnswerText = [
  'Progressive GUI resource probing completed.',
  'The agent read shell first, then hot-region, and only read region-detail after a narrow commandText question.',
  'No full DOM or debug snapshot resource was read.',
].join(' ');

export async function runGuiResourceProbingCase(options: {
  baseDir?: string;
  now?: string;
} = {}): Promise<GuiResourceProbingCaseResult> {
  const fixedNow = options.now ?? now;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: GUI_RESOURCE_PROBING_CASE_ID,
    baseDir: options.baseDir,
    scenarioId,
    sessionId,
    runId,
    now: fixedNow,
    title: 'Progressive GUI resource probing Web E2E case',
    prompt: 'Inspect the visible GUI state using progressive GUI resources and report the focused submit commandText.',
  });
  const resources = createGuiResourceTree();
  const operations = progressiveGuiProbeTranscript(resources, narrowQuestion);
  await finalizeGuiResourceProbingFixture(fixture, operations, fixedNow);

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

  const result: GuiResourceProbingCaseResult = {
    fixture,
    resources,
    operations,
    forbiddenResourcePaths: ['/gui/dom-snapshot.full.json', '/gui/debug-snapshot.json'],
    narrowQuestion,
    terminalCommandText,
    browserVisibleState,
    verifierInput,
  };
  assertGuiResourceProbingCase(result);
  return result;
}

export function assertGuiResourceProbingCase(result: GuiResourceProbingCaseResult): void {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  const shell = result.resources.get('/gui/shell.json');
  const hotRegion = result.resources.get('/gui/hot-region.json');
  const regionDetail = result.resources.get('/gui/regions/chat-composer.detail.json');
  const fullDom = result.resources.get('/gui/dom-snapshot.full.json');
  const debugSnapshot = result.resources.get('/gui/debug-snapshot.json');
  assert.ok(shell, 'shell resource must exist');
  assert.ok(hotRegion, 'hot-region resource must exist');
  assert.ok(regionDetail, 'region-detail resource must exist');
  assert.match(fullDom?.body ?? '', new RegExp(fullDomSentinel), 'full DOM sentinel must exist in unread debug resource');
  assert.match(debugSnapshot?.body ?? '', new RegExp(debugSnapshotSentinel), 'debug snapshot sentinel must exist in unread debug resource');

  assert.deepEqual(
    result.operations.slice(0, 2).map((operation) => operation.path),
    ['/gui/shell.json', '/gui/hot-region.json'],
    'progressive probing must begin with shell and hot-region resources',
  );
  assert.deepEqual(
    result.operations.slice(0, 2).map((operation) => operation.phase),
    ['shell', 'hot-region'],
    'progressive probing must begin at shell and hot-region disclosure levels',
  );

  const readOperations = result.operations.filter((operation) => operation.tool === 'gui.read');
  assert.deepEqual(
    readOperations.slice(0, 2).map((operation) => operation.path),
    ['/gui/shell.json', '/gui/hot-region.json'],
    'progressive probing must read shell and hot-region before any detail resource',
  );
  assert.deepEqual(
    readOperations.slice(0, 2).map((operation) => operation.phase),
    ['shell', 'hot-region'],
    'first GUI reads must stay at shell and hot-region disclosure levels',
  );

  const firstHotRegionIndex = result.operations.findIndex((operation) => operation.path === '/gui/hot-region.json');
  const detailOperations = result.operations.filter((operation) => operation.path === '/gui/regions/chat-composer.detail.json');
  assert.ok(firstHotRegionIndex >= 0, 'hot-region resource must be read before detail resources');
  assert.ok(
    detailOperations.every((operation) => result.operations.indexOf(operation) > firstHotRegionIndex),
    'region-detail operations must occur after hot-region probing',
  );
  assert.ok(
    detailOperations.every((operation) => operation.phase === 'narrow-question' && /commandText/i.test(operation.reason)),
    'region-detail operations must be narrow commandText questions',
  );

  const detailReads = readOperations.filter((operation) => operation.path === '/gui/regions/chat-composer.detail.json');
  assert.equal(detailReads.length, 1, 'region-detail must be read exactly once');
  assert.equal(detailReads[0]?.phase, 'narrow-question', 'region-detail may only be read for a narrow question');
  assert.match(detailReads[0]?.reason ?? '', /commandText/i, 'region-detail read must be justified by the narrow commandText question');
  assert.equal(result.narrowQuestion, narrowQuestion);

  for (const forbiddenPath of result.forbiddenResourcePaths) {
    assert.equal(
      result.operations.some((operation) => operation.path === forbiddenPath),
      false,
      `${forbiddenPath}: full DOM/debug snapshot must not be requested`,
    );
  }

  const transcriptBlob = JSON.stringify({
    operations: result.operations,
    projection: result.fixture.expectedProjection.conversationProjection,
    browserVisibleState: result.browserVisibleState,
  });
  assert.doesNotMatch(transcriptBlob, new RegExp(fullDomSentinel), 'full DOM body must not enter transcript or Projection');
  assert.doesNotMatch(transcriptBlob, new RegExp(debugSnapshotSentinel), 'debug snapshot body must not enter transcript or Projection');
  assert.equal(result.terminalCommandText, terminalCommandText);
  assert.match(result.browserVisibleState.visibleAnswerText ?? '', /No full DOM or debug snapshot resource was read/);
}

function createGuiResourceTree(): Map<string, GuiResource> {
  return new Map([
    resource('/gui/shell.json', 'shell', {
      schemaVersion: 'sciforge.gui-context.v1',
      revision: 17,
      focusedPanel: 'chat',
      disclosurePolicy: 'shell-and-hot-region-first',
      availableResources: ['/gui/shell.json', '/gui/hot-region.json'],
      availableGuiTools: ['gui.list', 'gui.stat', 'gui.read', 'gui.ask_user'],
    }),
    resource('/gui/hot-region.json', 'hot-region', {
      schemaVersion: 'sciforge.gui-hot-region.v1',
      revision: 17,
      hotRegion: {
        panel: 'chat',
        regionId: 'chat-composer',
        interactionMode: 'ready',
        visibleText: 'Runtime Codex input is focused.',
        detailRef: '/gui/regions/chat-composer.detail.json',
        availableActions: [{ label: 'Submit', commandText: terminalCommandText }],
      },
    }),
    resource('/gui/regions/chat-composer.detail.json', 'region-detail', {
      schemaVersion: 'sciforge.gui-region-detail.v1',
      revision: 17,
      regionId: 'chat-composer',
      disclosureReason: 'narrow-commandText-question',
      controls: [{
        role: 'button',
        label: 'Submit',
        commandText: terminalCommandText,
        terminalEquivalent: true,
      }],
    }),
    resource('/gui/dom-snapshot.full.json', 'debug', {
      schemaVersion: 'sciforge.gui-debug-dom-snapshot.v1',
      revision: 17,
      sentinel: fullDomSentinel,
      body: '<html><body>debug-only full DOM snapshot</body></html>',
    }),
    resource('/gui/debug-snapshot.json', 'debug', {
      schemaVersion: 'sciforge.gui-debug-snapshot.v1',
      revision: 17,
      sentinel: debugSnapshotSentinel,
      logs: ['debug-only snapshot'],
    }),
  ]);
}

function progressiveGuiProbeTranscript(
  resources: Map<string, GuiResource>,
  question: string,
): GuiResourceProbeOperation[] {
  assert.equal(question, narrowQuestion, 'fixture transcript expects the commandText narrow question');
  const steps: Array<Omit<GuiResourceProbeOperation, 'step' | 'resultRef'>> = [
    {
      tool: 'gui.read',
      phase: 'shell',
      path: '/gui/shell.json',
      reason: 'discover focused panel and disclosure policy before reading specific regions',
    },
    {
      tool: 'gui.read',
      phase: 'hot-region',
      path: '/gui/hot-region.json',
      reason: 'inspect the visible hot region before any region-detail resource',
    },
    {
      tool: 'gui.stat',
      phase: 'narrow-question',
      path: '/gui/regions/chat-composer.detail.json',
      reason: 'the user asks for the exact focused submit commandText',
    },
    {
      tool: 'gui.read',
      phase: 'narrow-question',
      path: '/gui/regions/chat-composer.detail.json',
      reason: 'answer the narrow commandText question without reading a full DOM snapshot',
    },
  ];
  return steps.map((step, index) => {
    assert.ok(resources.has(step.path), `${step.path}: resource must exist`);
    return {
      ...step,
      step: index + 1,
      resultRef: `gui-resource://${step.path.replace(/^\/+/, '')}@17`,
    };
  });
}

async function finalizeGuiResourceProbingFixture(
  fixture: WebE2eFixtureWorkspace,
  operations: GuiResourceProbeOperation[],
  fixedNow: string,
): Promise<void> {
  const auditRefs = uniqueStrings([
    ...fixture.expectedProjection.runAuditRefs,
    ...operations.map((operation) => operation.resultRef),
    'offline-web-e2e-fixture://sa-web-23/gui-resource-probing/transcript',
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
        eventId: 'sa-web-23-shell',
        type: 'HarnessDecisionRecorded',
        summary: 'GUI resource probing read shell first.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-23-hot-region',
        type: 'HarnessDecisionRecorded',
        summary: 'GUI resource probing read hot-region before region-detail.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-23-region-detail',
        type: 'Satisfied',
        summary: 'Region-detail was read only after the narrow commandText question.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs,
    diagnostics: [{
      severity: 'info',
      code: 'progressive-gui-resource-probing',
      message: 'Shell and hot-region were probed before region-detail; debug snapshots were not read.',
      refs: auditRefs.map((ref) => ({ ref })),
    }],
  };
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.runAuditRefs = auditRefs;

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = {
    ...session,
    title: 'Progressive GUI resource probing Web E2E case',
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
            guiResourceProbe: {
              policy: 'shell-and-hot-region-first',
              narrowQuestion,
              terminalCommandText,
              readPaths: operations.filter((operation) => operation.tool === 'gui.read').map((operation) => operation.path),
            },
          },
          resultPresentation: { conversationProjection: projection },
        },
      }
      : run),
    executionUnits: [
      ...(session.executionUnits ?? []),
      ...executionUnitsForOperations(operations, fixedNow),
    ],
    updatedAt: fixedNow,
  };
  await writeJson(fixture.expectedProjectionPath, fixture.expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);
}

function executionUnitsForOperations(operations: GuiResourceProbeOperation[], fixedNow: string): RuntimeExecutionUnit[] {
  return operations.map((operation): RuntimeExecutionUnit => ({
    id: `EU-sa-web-23-${operation.step}`,
    tool: operation.tool,
    params: `path=${operation.path} phase=${operation.phase}`,
    status: 'done',
    hash: `sa-web-23-${operation.step}`,
    runId,
    outputRef: operation.resultRef,
    time: fixedNow,
  }));
}

function browserVisibleStateFromExpected(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
  return {
    status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    visibleAnswerText: visibleAnswerText,
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

function resource(path: string, disclosure: GuiResource['disclosure'], body: JsonRecord): [string, GuiResource] {
  return [path, {
    path,
    disclosure,
    revision: 17,
    body: JSON.stringify(body, null, 2),
  }];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
