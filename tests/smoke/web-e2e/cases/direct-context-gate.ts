import { writeFile } from 'node:fs/promises';

import type {
  RuntimeExecutionUnit,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';

import type { GatewayRequest, ToolPayload } from '../../../../src/runtime/runtime-types.js';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import { directContextFastPathPayload } from '../../../../src/runtime/gateway/direct-context-fast-path.js';
import {
  artifactDeliveryManifestFromSession,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerToolPayload,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
} from '../types.js';

export const DIRECT_CONTEXT_GATE_CASE_ID = 'SA-WEB-13';

export type DirectContextGateScenario = 'run-status' | 'generation' | 'repair' | 'tool-status-insufficient';

export interface DirectContextDecisionEvidence {
  schemaVersion: 'sciforge.direct-context-decision.v1';
  decisionRef: string;
  decisionOwner: 'AgentServer' | 'Backend' | 'harness-policy';
  intent: 'run-status' | 'generation' | 'repair' | 'tool-status';
  requiredTypedContext: string[];
  usedRefs: string[];
  sufficiency: 'sufficient' | 'insufficient';
  route: 'direct-context-answer' | 'route-to-agentserver';
  allowDirectContext: boolean;
  blockReason?: string;
}

export interface DirectContextGateScenarioResult {
  scenario: DirectContextGateScenario;
  fixture: WebE2eFixtureWorkspace;
  decision: DirectContextDecisionEvidence;
  route: 'direct-context-answer' | 'route-to-agentserver';
  directPayload?: ToolPayload;
  agentServerRun?: MockRunFetchResult;
  serverRequests: number;
  runAudit: WebE2eRunAuditEvidence;
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

export interface DirectContextGateCaseResult {
  server: ScriptableAgentServerMockHandle;
  directStatus: DirectContextGateScenarioResult;
  routed: DirectContextGateScenarioResult[];
}

interface MockRunFetchResult {
  envelopes: JsonRecord[];
  events: JsonRecord[];
  resultRun: JsonRecord;
}

const now = '2026-05-16T00:00:00.000Z';
const sessionId = 'session-sa-web-13';
const scenarioId = 'scenario-sa-web-13';
const runId = 'run-sa-web-13-current';
const currentRunStatusText = 'Current run run-sa-web-13-current is completed; DirectContextDecision decision:sa-web-13-run-status authorized a bounded status answer from current run refs only.';

const routePrompts: Record<Exclude<DirectContextGateScenario, 'run-status'>, string> = {
  generation: 'Generate a new repaired evidence matrix from the previous report.',
  repair: 'Repair the failed run and write the missing output artifact.',
  'tool-status-insufficient': 'Tell me whether web_search is healthy enough to use and invoke it if needed.',
};

const routeTexts: Record<Exclude<DirectContextGateScenario, 'run-status'>, string> = {
  generation: 'Routed to AgentServer because generation requires fresh backend execution beyond the current run-status context.',
  repair: 'Routed to AgentServer because repair requires validation/repair policy and bounded execution, not a local direct answer.',
  'tool-status-insufficient': 'Routed to AgentServer because tool/provider status was insufficient without registry-backed AgentServer judgement.',
};

export async function buildDirectContextGateCase(options: { baseDir?: string } = {}): Promise<DirectContextGateCaseResult> {
  const server = await startScriptableAgentServerMock({
    seed: DIRECT_CONTEXT_GATE_CASE_ID,
    fixedNow: now,
    script: (request, exchange) => {
      const scenario = scenarioFromRequest(request);
      const text = routeTexts[scenario];
      return {
        id: `${DIRECT_CONTEXT_GATE_CASE_ID}-${scenario}`,
        runId: `agentserver-sa-web-13-${scenario}`,
        steps: [
          {
            kind: 'status',
            status: 'route-to-agentserver',
            message: text,
            fields: {
              routeReason: scenario,
              directContextDecision: jsonRecord(decisionForScenario(scenario)),
            },
          },
          {
            kind: 'toolPayload',
            payload: agentServerPayload(scenario, text),
          },
        ],
      };
    },
  });

  const directStatus = await buildScenarioResult({
    scenario: 'run-status',
    baseDir: options.baseDir,
    server,
  });
  const routed: DirectContextGateScenarioResult[] = [];
  for (const scenario of ['generation', 'repair', 'tool-status-insufficient'] as const) {
    routed.push(await buildScenarioResult({ scenario, baseDir: options.baseDir, server }));
  }

  return { server, directStatus, routed };
}

async function buildScenarioResult(input: {
  scenario: DirectContextGateScenario;
  baseDir: string | undefined;
  server: ScriptableAgentServerMockHandle;
}): Promise<DirectContextGateScenarioResult> {
  const decision = decisionForScenario(input.scenario);
  const prompt = input.scenario === 'run-status' ? 'What is the current run status?' : routePrompts[input.scenario];
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: DIRECT_CONTEXT_GATE_CASE_ID,
    baseDir: input.baseDir,
    now,
    prompt,
    agentServerBaseUrl: input.server.baseUrl,
    sessionId,
    scenarioId: `${scenarioId}-${input.scenario}`,
    runId,
  });
  const request = gatewayRequest(fixture, prompt, decision);
  const directPayload = directContextFastPathPayload(request);
  const agentServerRun = directPayload ? undefined : await fetchRun(input.server.baseUrl, {
    prompt,
    scenario: input.scenario,
    route: 'route-to-agentserver',
    directContextDecision: jsonRecord(decision),
    currentTurnRef: fixture.expectedProjection.currentTask.currentTurnRef.ref,
    explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
  });
  const expectedProjection = expectedForScenario(fixture.expectedProjection, {
    scenario: input.scenario,
    decision,
    directPayload,
  });
  const session = sessionForScenario(fixture.workspaceState.sessionsByScenario[fixture.scenarioId], {
    scenario: input.scenario,
    prompt,
    expectedProjection,
    directPayload,
  });
  fixture.expectedProjection = expectedProjection;
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = session;
  await writeJson(fixture.expectedProjectionPath, expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);

  const runAudit = {
    ...runAuditFromSession(session, expectedProjection),
    refs: uniqueStrings([
      ...runAuditFromSession(session, expectedProjection).refs,
      decision.decisionRef,
      ...decision.usedRefs,
    ]),
  };
  const browserVisibleState = browserVisibleStateFromExpected(expectedProjection);

  return {
    scenario: input.scenario,
    fixture,
    decision,
    route: decision.route,
    directPayload,
    agentServerRun,
    serverRequests: input.server.requests.runs.length,
    runAudit,
    browserVisibleState,
    verifierInput: {
      caseId: DIRECT_CONTEXT_GATE_CASE_ID,
      expected: expectedProjection,
      browserVisibleState,
      kernelProjection: expectedProjection.conversationProjection,
      sessionBundle: { session, workspaceState: fixture.workspaceState },
      runAudit,
      artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, expectedProjection),
    },
  };
}

function decisionForScenario(scenario: DirectContextGateScenario): DirectContextDecisionEvidence {
  if (scenario === 'run-status') {
    return {
      schemaVersion: 'sciforge.direct-context-decision.v1',
      decisionRef: 'decision:sa-web-13-run-status',
      decisionOwner: 'AgentServer',
      intent: 'run-status',
      requiredTypedContext: ['run-status', 'visible-answer', 'run-audit-ref'],
      usedRefs: ['run:run-sa-web-13-current', 'artifact:fixture-run-audit'],
      sufficiency: 'sufficient',
      route: 'direct-context-answer',
      allowDirectContext: true,
    };
  }
  const blockReason = {
    generation: 'generation-required',
    repair: 'repair-policy-required',
    'tool-status-insufficient': 'tool-status-insufficient',
  }[scenario];
  return {
    schemaVersion: 'sciforge.direct-context-decision.v1',
    decisionRef: `decision:sa-web-13-${scenario}`,
    decisionOwner: scenario === 'tool-status-insufficient' ? 'Backend' : 'harness-policy',
    intent: scenario === 'tool-status-insufficient' ? 'tool-status' : scenario,
    requiredTypedContext: requiredTypedContextForScenario(scenario),
    usedRefs: ['run:run-sa-web-13-current', 'artifact:fixture-run-audit'],
    sufficiency: 'insufficient',
    route: 'route-to-agentserver',
    allowDirectContext: false,
    blockReason,
  };
}

function requiredTypedContextForScenario(scenario: Exclude<DirectContextGateScenario, 'run-status'>): string[] {
  if (scenario === 'generation') return ['backend-routing', 'generation-capability', 'artifact-contract'];
  if (scenario === 'repair') return ['validation-decision', 'repair-policy', 'failed-run-evidence'];
  return ['capability-registry', 'provider-health', 'agentserver-worker-registry'];
}

function gatewayRequest(
  fixture: WebE2eFixtureWorkspace,
  prompt: string,
  decision: DirectContextDecisionEvidence,
): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt,
    artifacts: fixture.seedArtifacts.map(jsonRecord),
    references: fixture.objectReferences.map(jsonRecord),
    expectedArtifactTypes: decision.route === 'route-to-agentserver' ? ['research-report'] : undefined,
    selectedToolIds: decision.intent === 'tool-status' ? ['web_search'] : undefined,
    uiState: {
      activeRunId: fixture.runId,
      directContextDecision: {
        schemaVersion: decision.schemaVersion,
        decisionRef: decision.decisionRef,
        decisionOwner: decision.decisionOwner,
        intent: decision.intent === 'run-status' ? 'run-diagnostic' : decision.intent === 'tool-status' ? 'unknown' : 'fresh-execution',
        requiredContext: decision.requiredTypedContext,
        requiredTypedContext: decision.requiredTypedContext,
        usedRefs: decision.usedRefs,
        sufficiency: decision.sufficiency,
        allowDirectContext: decision.allowDirectContext,
        blockReason: decision.blockReason,
      },
      conversationPolicy: {
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        directContextDecision: {
          schemaVersion: decision.schemaVersion,
          decisionRef: decision.decisionRef,
          decisionOwner: decision.decisionOwner,
          intent: decision.intent === 'run-status' ? 'run-diagnostic' : decision.intent === 'tool-status' ? 'unknown' : 'fresh-execution',
          requiredContext: decision.requiredTypedContext,
          requiredTypedContext: decision.requiredTypedContext,
          usedRefs: decision.usedRefs,
          sufficiency: decision.sufficiency,
          allowDirectContext: decision.allowDirectContext,
          blockReason: decision.blockReason,
        },
        executionModePlan: { executionMode: decision.route === 'direct-context-answer' ? 'direct-context-answer' : 'agentserver' },
        responsePlan: { initialResponseMode: decision.route === 'direct-context-answer' ? 'direct-context-answer' : 'streaming' },
      },
      recentExecutionRefs: [{
        id: 'EU-sa-web-13-current-run',
        tool: 'agentserver.direct-context',
        status: 'done',
        outputRef: 'artifact:fixture-current-report',
        runId,
      }],
      currentReferences: fixture.objectReferences,
    },
  };
}

function expectedForScenario(
  expected: WebE2eExpectedProjection,
  input: {
    scenario: DirectContextGateScenario;
    decision: DirectContextDecisionEvidence;
    directPayload: ToolPayload | undefined;
  },
): WebE2eExpectedProjection {
  const direct = input.scenario === 'run-status';
  const text = direct ? currentRunStatusText : routeTexts[input.scenario as Exclude<DirectContextGateScenario, 'run-status'>];
  const status = direct ? 'satisfied' : 'background-running';
  const projection: ConversationProjection = {
    ...expected.conversationProjection,
    visibleAnswer: {
      status,
      text,
      artifactRefs: expected.artifactDelivery.primaryArtifactRefs,
      diagnostic: input.decision.decisionRef,
    },
    activeRun: { id: expected.runId, status },
    executionProcess: [
      ...expected.conversationProjection.executionProcess,
      {
        eventId: `direct-context-gate:${input.scenario}`,
        type: direct ? 'HarnessDecisionRecorded' : 'Dispatched',
        summary: direct
          ? 'Structured DirectContextDecision was sufficient for current run status.'
          : `Structured DirectContextDecision was insufficient; ${input.scenario} routed to AgentServer.`,
        timestamp: now,
      },
    ],
    auditRefs: uniqueStrings([
      ...expected.conversationProjection.auditRefs,
      input.decision.decisionRef,
      ...input.decision.usedRefs,
    ]),
    diagnostics: [
      ...expected.conversationProjection.diagnostics,
      {
        severity: direct ? 'info' : 'warning',
        code: direct ? 'direct-context-sufficient' : 'route-to-agentserver',
        message: direct
          ? 'Direct context answer used only structured current run status refs.'
          : input.decision.blockReason ?? 'Direct context decision insufficient.',
        refs: input.decision.usedRefs.map((ref) => ({ ref })),
      },
    ],
  };
  return {
    ...expected,
    conversationProjection: projection,
    runAuditRefs: uniqueStrings([
      ...expected.runAuditRefs,
      input.decision.decisionRef,
      ...input.decision.usedRefs,
      ...(input.directPayload?.executionUnits ?? []).map((unit) => `execution-unit:${String(unit.id)}`),
    ]),
  };
}

function sessionForScenario(
  session: SciForgeSession,
  input: {
    scenario: DirectContextGateScenario;
    prompt: string;
    expectedProjection: WebE2eExpectedProjection;
    directPayload: ToolPayload | undefined;
  },
): SciForgeSession {
  const text = input.expectedProjection.conversationProjection.visibleAnswer?.text ?? '';
  const run = session.runs.find((candidate) => candidate.id === input.expectedProjection.runId);
  const runRaw = isRecord(run?.raw) ? run.raw : {};
  const nextRun: SciForgeRun | undefined = run ? {
    ...run,
    status: input.scenario === 'run-status' ? 'completed' : 'running',
    prompt: input.prompt,
    response: text,
    raw: {
      ...runRaw,
      displayIntent: {
        ...(isRecord(runRaw.displayIntent) ? runRaw.displayIntent : {}),
        source: input.scenario === 'run-status' ? 'direct-context-decision' : 'agentserver',
        conversationProjection: input.expectedProjection.conversationProjection,
        taskOutcomeProjection: {
          conversationProjection: input.expectedProjection.conversationProjection,
        },
      },
      resultPresentation: {
        conversationProjection: input.expectedProjection.conversationProjection,
      },
    },
  } : undefined;
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (message.role === 'user') return { ...message, content: input.prompt };
      if (message.role === 'scenario') return { ...message, content: text, status: input.scenario === 'run-status' ? 'completed' : 'running' };
      return message;
    }),
    runs: nextRun ? session.runs.map((candidate) => candidate.id === nextRun.id ? nextRun : candidate) : session.runs,
    executionUnits: [
      ...(session.executionUnits ?? []),
      executionUnitForScenario(input),
    ],
  };
}

function executionUnitForScenario(input: {
  scenario: DirectContextGateScenario;
  expectedProjection: WebE2eExpectedProjection;
  directPayload: ToolPayload | undefined;
}): RuntimeExecutionUnit {
  const payloadUnit = input.directPayload?.executionUnits?.[0];
  if (payloadUnit) {
    return {
      id: String(payloadUnit.id),
      tool: String(payloadUnit.tool),
      params: String(payloadUnit.params ?? ''),
      status: 'done',
      hash: String(payloadUnit.hash ?? 'direct-context-gate'),
      runId: input.expectedProjection.runId,
      outputRef: String(payloadUnit.outputRef ?? 'runtime://direct-context-fast-path'),
      outputArtifacts: input.directPayload?.artifacts?.map((artifact) => String(artifact.id)),
      time: now,
    };
  }
  return {
    id: `EU-sa-web-13-route-${input.scenario}`,
    tool: 'agentserver.route-to-agentserver',
    params: `scenario=${input.scenario}`,
    status: 'running',
    hash: `sa-web-13-${input.scenario}`,
    runId: input.expectedProjection.runId,
    outputRef: `agentserver://mock/direct-context-gate/${input.scenario}`,
    time: now,
  };
}

function agentServerPayload(
  scenario: Exclude<DirectContextGateScenario, 'run-status'>,
  message: string,
): ScriptableAgentServerToolPayload {
  return {
    message,
    confidence: 0.8,
    claimType: 'route-to-agentserver',
    evidenceLevel: 'scriptable-agentserver-mock',
    reasoningTrace: 'SA-WEB-13 route-to-agentserver branch consumed an insufficient DirectContextDecision.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'running',
      status: 'running',
      route: 'route-to-agentserver',
    },
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: `EU-sa-web-13-agentserver-${scenario}`,
      tool: 'agentserver.route-to-agentserver',
      status: 'running',
      outputRef: `agentserver://mock/direct-context-gate/${scenario}`,
      evidenceRefs: [`decision:sa-web-13-${scenario}`],
      runId: `agentserver-sa-web-13-${scenario}`,
    }],
    artifacts: [],
  };
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<MockRunFetchResult> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AgentServer mock run failed: ${response.status}`);
  const text = await response.text();
  const envelopes = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(isRecord),
    resultRun: envelopes.at(-1) ?? {},
  };
}

function scenarioFromRequest(request: JsonRecord): Exclude<DirectContextGateScenario, 'run-status'> {
  const scenario = request.scenario;
  if (scenario === 'generation' || scenario === 'repair' || scenario === 'tool-status-insufficient') return scenario;
  throw new Error(`Unexpected SA-WEB-13 routed scenario: ${String(scenario)}`);
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer && 'text' in answer && typeof answer.text === 'string' ? answer.text : undefined,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
