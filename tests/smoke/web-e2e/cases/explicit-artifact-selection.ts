import assert from 'node:assert/strict';

import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import {
  createWebE2eEvidenceBundleManifest,
  type WebE2eEvidenceBundleManifest,
} from '../evidence-bundle.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerRecordedRequest,
  ScriptableAgentServerToolPayload,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const explicitArtifactSelectionCaseId = 'SA-WEB-03';
export const explicitArtifactSelectionPrompt = '基于这个继续';
export const selectedOldArtifactRef = 'artifact:fixture-old-report';
export const latestArtifactRef = 'artifact:fixture-current-report';

export type ExplicitArtifactSelectionResult = {
  fixture: WebE2eFixtureWorkspace;
  requestBody: JsonRecord;
  recordedRunRequest: ScriptableAgentServerRecordedRequest;
  runEvents: JsonRecord[];
  resultRun: JsonRecord;
  toolPayload: JsonRecord;
  browserVisibleState: WebE2eBrowserVisibleState;
  runAudit: WebE2eRunAuditEvidence;
  contractInput: WebE2eContractVerifierInput;
  evidenceBundle: WebE2eEvidenceBundleManifest;
};

export async function runExplicitArtifactSelectionCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<ExplicitArtifactSelectionResult> {
  const now = options.now ?? '2026-05-16T00:00:00.000Z';
  const agentServer = await startScriptableAgentServerMock({
    seed: explicitArtifactSelectionCaseId,
    fixedNow: now,
    script: {
      runId: `run-${explicitArtifactSelectionCaseId}-followup`,
      steps: [
        { kind: 'status', status: 'running', message: 'Applying explicit artifact selection.' },
        { kind: 'toolPayload', payload: explicitOldReportToolPayload(now) },
      ],
    },
  });

  try {
    const fixture = await buildWebE2eFixtureWorkspace({
      caseId: explicitArtifactSelectionCaseId,
      baseDir: options.baseDir,
      now,
      prompt: explicitArtifactSelectionPrompt,
      agentServerBaseUrl: agentServer.baseUrl,
    });
    const requestBody = buildExplicitSelectionRequest(fixture);
    const run = await fetchRun(agentServer.baseUrl, requestBody);
    const recordedRunRequest = agentServer.requests.runs[0];
    assert.ok(recordedRunRequest, 'scriptable AgentServer mock should record the follow-up run request');

    const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
    const browserVisibleState = browserVisibleStateFromExpected(fixture.expectedProjection);
    const runAudit = runAuditFromSession(session, fixture.expectedProjection);
    const contractInput: WebE2eContractVerifierInput = {
      caseId: fixture.caseId,
      expected: fixture.expectedProjection,
      browserVisibleState,
      kernelProjection: fixture.expectedProjection.conversationProjection,
      sessionBundle: { session, workspaceState: fixture.workspaceState },
      runAudit,
      artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
    };
    assertWebE2eContract(contractInput);

    const toolPayload = extractToolPayload(run.resultRun);
    const evidenceBundle = createWebE2eEvidenceBundleManifest({
      caseId: fixture.caseId,
      generatedAt: now,
      outputRoot: options.outputRoot,
      runs: [{
        runId: String(run.resultRun.id),
        eventIds: run.events.map((event) => String(event.id)).filter(Boolean),
        requestDigest: recordedRunRequest.digest,
        resultDigest: String(run.resultRun.digest ?? ''),
        status: String(run.resultRun.status ?? ''),
      }],
      projection: {
        projectionVersion: fixture.expectedProjection.projectionVersion,
        terminalState: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
      },
      note: {
        status: 'passed',
        summary: 'Explicit old artifact selection was preserved across request, currentTask, result payload, and contract verification.',
      },
      extra: {
        explicitRefs: refsFromRequestList(requestBody.explicitRefs),
        currentTaskExplicitRefs: refsFromRequestList((requestBody.currentTask as JsonRecord).explicitRefs),
        selectedOldArtifactRef,
        latestArtifactRef,
      },
    });

    const result = {
      fixture,
      requestBody,
      recordedRunRequest,
      runEvents: run.events,
      resultRun: run.resultRun,
      toolPayload,
      browserVisibleState,
      runAudit,
      contractInput,
      evidenceBundle,
    };
    assertExplicitArtifactSelectionEvidence(result);
    return result;
  } finally {
    await agentServer.close();
  }
}

export function assertExplicitArtifactSelectionEvidence(result: ExplicitArtifactSelectionResult): void {
  const session = result.fixture.workspaceState.sessionsByScenario[result.fixture.scenarioId];
  assert.ok(
    session.artifacts.some((artifact) => artifact.delivery?.ref === selectedOldArtifactRef),
    'fixture session should contain the old selected report',
  );
  assert.ok(
    session.artifacts.some((artifact) => artifact.delivery?.ref === latestArtifactRef),
    'fixture session should also contain the latest generated report',
  );

  assert.deepEqual(
    refsFromRequestList(result.requestBody.explicitRefs),
    [selectedOldArtifactRef],
    'top-level explicitRefs must point at the clicked old artifact',
  );
  const currentTask = result.requestBody.currentTask as JsonRecord;
  assert.deepEqual(
    refsFromRequestList(currentTask.explicitRefs),
    [selectedOldArtifactRef],
    'currentTask.explicitRefs must point at the clicked old artifact',
  );
  assert.ok(
    refsFromRequestList(currentTask.selectedRefs).includes(latestArtifactRef),
    'selectedRefs should prove the latest artifact existed in the same session context',
  );

  assertNoLatestArtifactLeak(result.toolPayload, 'AgentServer result payload');
  assertNoLatestArtifactLeak(result.evidenceBundle.extra?.explicitRefs, 'evidence explicitRefs');
  assertNoLatestArtifactLeak(result.evidenceBundle.extra?.currentTaskExplicitRefs, 'evidence currentTaskExplicitRefs');
  assert.deepEqual(result.runAudit.explicitRefs, [selectedOldArtifactRef]);
}

export function buildExplicitSelectionRequest(fixture: WebE2eFixtureWorkspace): JsonRecord {
  const explicitRefs = fixture.expectedProjection.currentTask.explicitRefs;
  return {
    caseId: fixture.caseId,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    prompt: explicitArtifactSelectionPrompt,
    explicitRefs: explicitRefs.map(refForRequest),
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
  };
}

function explicitOldReportToolPayload(now: string): ScriptableAgentServerToolPayload {
  return {
    message: '基于旧报告继续：沿用 IL7R baseline interpretation，并只把点击的旧报告作为本轮显式对象。',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'scriptable-agentserver-explicit-selection',
    reasoningTrace: 'SA-WEB-03 explicit artifact selection follows the clicked old report ref.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'satisfied',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: explicitArtifactSelectionCaseId,
        visibleAnswer: {
          status: 'satisfied',
          text: '基于旧报告继续：IL7R signal remains the baseline interpretation.',
          artifactRefs: [selectedOldArtifactRef],
        },
        activeRun: { id: `run-${explicitArtifactSelectionCaseId}-followup`, status: 'completed' },
        artifacts: [{ id: 'fixture-old-report', type: 'research-report', ref: selectedOldArtifactRef }],
        executionProcess: [],
        recoverActions: [],
        auditRefs: ['artifact:fixture-run-audit'],
      },
    },
    claims: [{
      id: 'claim-explicit-old-report',
      text: 'The follow-up is grounded in the explicitly selected prior report.',
      refs: [selectedOldArtifactRef],
      createdAt: now,
    }],
    uiManifest: [{
      componentId: 'report-viewer',
      title: 'Prior selected literature report',
      artifactRef: 'fixture-old-report',
      priority: 1,
    }],
    executionUnits: [{
      id: 'EU-explicit-old-report-followup',
      tool: 'agentserver.mock.explicit-artifact-selection',
      status: 'done',
      outputArtifacts: ['fixture-old-report'],
      time: now,
    }],
    artifacts: [{
      id: 'fixture-old-report',
      type: 'research-report',
      delivery: {
        ref: selectedOldArtifactRef,
        role: 'supporting-evidence',
      },
    }],
  };
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer && 'text' in answer ? answer.text : undefined,
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function refForRequest(ref: WebE2eInitialRef): JsonRecord {
  return {
    id: ref.id,
    kind: ref.kind,
    title: ref.title,
    ref: ref.ref,
    source: ref.source,
    ...(ref.artifactType ? { artifactType: ref.artifactType } : {}),
    ...(ref.digest ? { digest: ref.digest } : {}),
  };
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<{ events: JsonRecord[]; resultRun: JsonRecord }> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, 'explicit artifact selection run should return 2xx');
  const text = await response.text();
  const envelopes = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  assert.ok(resultEnvelope, 'run stream should include a final result envelope');
  const result = resultEnvelope.result as JsonRecord;
  const data = result.data as JsonRecord;
  return {
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    resultRun: data.run as JsonRecord,
  };
}

function extractToolPayload(resultRun: JsonRecord): JsonRecord {
  const output = resultRun.output as JsonRecord | undefined;
  const toolPayload = output?.toolPayload as JsonRecord | undefined;
  assert.ok(toolPayload, 'run result should include a toolPayload');
  return toolPayload;
}

function refsFromRequestList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && 'ref' in entry) return String((entry as { ref: unknown }).ref);
    return '';
  }).filter(Boolean);
}

function assertNoLatestArtifactLeak(value: unknown, label: string): void {
  const encoded = JSON.stringify(value);
  assert.ok(!encoded.includes(latestArtifactRef), `${label} must not include ${latestArtifactRef}`);
  assert.ok(!encoded.includes('fixture-current-report'), `${label} must not include fixture-current-report`);
}
