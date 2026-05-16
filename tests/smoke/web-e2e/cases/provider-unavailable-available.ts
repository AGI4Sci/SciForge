import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest } from '../../../../src/runtime/runtime-types.js';
import {
  capabilityProviderPreflight,
  capabilityProviderRoutesForHandoff,
  requestWithDiscoveredCapabilityProviders,
  type PublicCapabilityProviderPreflightResult,
} from '../../../../src/runtime/gateway/capability-provider-preflight.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerProvider,
  WebE2eFixtureWorkspace,
} from '../types.js';

export const PROVIDER_UNAVAILABLE_AVAILABLE_CASE_ID = 'SA-WEB-05-provider-unavailable-available';

export const PROVIDER_TRANSITION_PROMPT = [
  '请检索最近关于 agent workflow reliability 的论文，返回中文证据摘要。',
  '如果 web_search 或 web_fetch provider 不可用，请说明缺失 provider route 和可恢复下一步，不要伪造结果。',
].join(' ');

export const PROVIDER_READY_CONTINUE_PROMPT = [
  'provider status 已更新，请复用同一个任务继续检索。',
  '不要回答纯状态检查；必须进入 AgentServer dispatch，并通过 web_search/web_fetch provider route 完成或返回可恢复 empty result。',
].join(' ');

export interface ProviderTransitionHarness {
  workspace: WebE2eFixtureWorkspace;
  agentServer: ScriptableAgentServerMockHandle;
  close(): Promise<void>;
}

export interface ProviderTransitionRound {
  prompt: string;
  request: GatewayRequest;
  handoffRoutes: PublicCapabilityProviderPreflightResult;
  gatewayBlockedReason?: string;
  agentServerRunCountBefore: number;
  agentServerRunCountAfter: number;
  dispatched: boolean;
  dispatchRequest?: JsonRecord;
  dispatchEvents: JsonRecord[];
  dispatchRun?: JsonRecord;
}

export async function createProviderUnavailableAvailableHarness(): Promise<ProviderTransitionHarness> {
  const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-05-'));
  const agentServer = await startScriptableAgentServerMock({
    seed: PROVIDER_UNAVAILABLE_AVAILABLE_CASE_ID,
    discovery: { providers: unavailableWebProviders() },
    script: {
      runId: 'run-SA-WEB-05-agentserver-ready',
      steps: [
        { kind: 'status', message: 'SA-WEB-05 AgentServer dispatch accepted ready provider routes.' },
        { kind: 'toolPayload', payload: providerReadyEmptyResultPayload() },
      ],
    },
  });
  const workspace = await buildWebE2eFixtureWorkspace({
    caseId: PROVIDER_UNAVAILABLE_AVAILABLE_CASE_ID,
    baseDir,
    prompt: PROVIDER_TRANSITION_PROMPT,
    agentServerBaseUrl: agentServer.baseUrl,
    providerCapabilities: [
      providerCapability('sciforge.web-worker.web_search', 'web_search', 'unavailable'),
      providerCapability('sciforge.web-worker.web_fetch', 'web_fetch', 'unavailable'),
    ],
    now: '2026-05-16T00:00:00.000Z',
  });

  return {
    workspace,
    agentServer,
    async close() {
      await agentServer.close();
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

export function markWebProvidersReady(harness: ProviderTransitionHarness) {
  harness.agentServer.setDiscoveryProviders(readyWebProvidersWithPrivateEndpointShape());
}

export async function runProviderTransitionRound(
  harness: ProviderTransitionHarness,
  prompt: string,
): Promise<ProviderTransitionRound> {
  const request = await requestWithDiscoveredCapabilityProviders(baseGatewayRequest(harness, prompt));
  const preflight = capabilityProviderPreflight(request);
  const handoffRoutes = capabilityProviderRoutesForHandoff(request);
  const agentServerRunCountBefore = harness.agentServer.requests.runs.length;

  if (!preflight.ok) {
    return {
      prompt,
      request,
      handoffRoutes,
      gatewayBlockedReason: preflight.blockingRoutes.map((route) => `${route.capabilityId}: ${route.reason}`).join('; '),
      agentServerRunCountBefore,
      agentServerRunCountAfter: harness.agentServer.requests.runs.length,
      dispatched: false,
      dispatchEvents: [],
    };
  }

  const dispatchRequest = agentServerDispatchRequest(prompt, handoffRoutes, harness.workspace);
  const response = await fetch(`${harness.agentServer.baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dispatchRequest),
  });
  assert.equal(response.ok, true, 'ready provider route should dispatch to AgentServer');
  const { events, run } = parseNdjsonRunStream(await response.text());
  return {
    prompt,
    request,
    handoffRoutes,
    agentServerRunCountBefore,
    agentServerRunCountAfter: harness.agentServer.requests.runs.length,
    dispatched: true,
    dispatchRequest,
    dispatchEvents: events,
    dispatchRun: run,
  };
}

export function assertFailClosedBeforeAgentServerDispatch(round: ProviderTransitionRound) {
  assert.equal(round.dispatched, false, 'unavailable providers must fail closed before AgentServer dispatch');
  assert.equal(round.agentServerRunCountAfter, round.agentServerRunCountBefore, 'fail-closed provider routing must not call /runs/stream');
  assert.match(round.gatewayBlockedReason ?? '', /web_fetch|web_search/);
  assert.deepEqual(round.handoffRoutes.requiredCapabilityIds, ['web_fetch', 'web_search']);
  assert.deepEqual(round.handoffRoutes.blockingRoutes.map((route) => route.capabilityId), ['web_fetch', 'web_search']);
  assert.equal(round.handoffRoutes.ok, false);
}

export function assertReadyRoundDispatchesToAgentServer(round: ProviderTransitionRound) {
  assert.equal(round.gatewayBlockedReason, undefined, 'ready provider status must not become a visible Runtime preflight stage');
  assert.equal(round.dispatched, true, 'ready providers should enter AgentServer dispatch');
  assert.equal(round.agentServerRunCountAfter, round.agentServerRunCountBefore + 1);
  assert.equal(round.handoffRoutes.ok, true);
  assert.deepEqual(round.handoffRoutes.requiredCapabilityIds, ['web_fetch', 'web_search']);
  assert.deepEqual(round.handoffRoutes.routes.map((route) => [route.capabilityId, route.status]), [
    ['web_fetch', 'ready'],
    ['web_search', 'ready'],
  ]);
  assert.ok(round.dispatchRun, 'AgentServer dispatch should return a run');
  assert.equal(round.dispatchRun.status, 'completed');
  assert.ok(round.dispatchRequest, 'AgentServer dispatch should carry a handoff request');
  assert.match(JSON.stringify(round.dispatchRequest), /capabilityProviderRoutes/);
  assert.doesNotMatch(
    JSON.stringify({ events: round.dispatchEvents, run: round.dispatchRun }),
    /Capability provider preflight|sciforge\.capability-provider-preflight/,
    'ready provider status must not render Runtime preflight as a visible AgentServer stage',
  );
}

export function assertNoProviderEndpointShapeLeaks(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:\\")?(endpoint|baseUrl|url|invokeUrl|invokePath|runtimeLocation|workerId|timeoutMs|auth|workspaceRoots)(?:\\")?\s*:/);
  assert.doesNotMatch(serialized, /private-provider|private-base|private-url|private-invoke|PRIVATE_|\/private\/workspace/);
}

function baseGatewayRequest(harness: ProviderTransitionHarness, prompt: string): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt,
    selectedToolIds: ['web_search', 'web_fetch'],
    externalIoRequired: true,
    agentServerBaseUrl: harness.agentServer.baseUrl,
    artifacts: [],
    uiState: {
      caseId: PROVIDER_UNAVAILABLE_AVAILABLE_CASE_ID,
      sessionId: harness.workspace.sessionId,
      currentTask: {
        currentTurnRef: harness.workspace.expectedProjection.currentTask.currentTurnRef,
        explicitRefs: harness.workspace.expectedProjection.currentTask.explicitRefs,
      },
    },
  };
}

function agentServerDispatchRequest(
  prompt: string,
  capabilityProviderRoutes: PublicCapabilityProviderPreflightResult,
  workspace: WebE2eFixtureWorkspace,
): JsonRecord {
  return {
    prompt,
    input: {
      text: prompt,
      currentTask: {
        sessionId: workspace.sessionId,
        currentTurnRef: workspace.expectedProjection.currentTask.currentTurnRef.ref,
        explicitRefs: workspace.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
      },
      capabilityProviderRoutes: capabilityProviderRoutes as unknown as JsonRecord,
    },
  };
}

function parseNdjsonRunStream(text: string): { events: JsonRecord[]; run?: JsonRecord } {
  const envelopes = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const events = envelopes.map((envelope) => envelope.event).filter(isRecord);
  const result = envelopes.find((envelope) => isRecord(envelope.result))?.result;
  const data = isRecord(result) && isRecord(result.data) ? result.data : undefined;
  return {
    events,
    run: isRecord(data?.run) ? data.run : undefined,
  };
}

function providerCapability(
  id: string,
  capabilityId: 'web_search' | 'web_fetch',
  status: 'available' | 'unavailable',
) {
  return {
    id,
    providerId: id,
    capabilityId,
    workerId: 'sciforge.web-worker',
    status,
    fixtureMode: 'scripted-mock' as const,
  };
}

function unavailableWebProviders(): ScriptableAgentServerProvider[] {
  return [
    provider('sciforge.web-worker.web_search', 'web_search', 'unavailable'),
    provider('sciforge.web-worker.web_fetch', 'web_fetch', 'unavailable'),
  ];
}

function readyWebProvidersWithPrivateEndpointShape(): ScriptableAgentServerProvider[] {
  return [
    provider('sciforge.web-worker.web_search', 'web_search', 'available', {
      endpoint: 'https://private-provider.example.test/search',
      baseUrl: 'https://private-base.example.test',
      url: 'https://private-url.example.test/tools/search',
      invokeUrl: 'https://private-invoke.example.test/run',
      invokePath: '/private/invoke/search',
      timeoutMs: 1234,
      runtimeLocation: 'PRIVATE_RUNTIME_LOCATION_SHOULD_NOT_LEAK',
      auth: { token: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' },
      workspaceRoots: ['/private/workspace/root'],
    }),
    provider('sciforge.web-worker.web_fetch', 'web_fetch', 'available', {
      endpoint: 'https://private-provider.example.test/fetch',
      baseUrl: 'https://private-base.example.test',
      url: 'https://private-url.example.test/tools/fetch',
      invokeUrl: 'https://private-invoke.example.test/run',
      invokePath: '/private/invoke/fetch',
      timeoutMs: 5678,
      runtimeLocation: 'PRIVATE_RUNTIME_LOCATION_SHOULD_NOT_LEAK',
      auth: { token: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' },
      workspaceRoots: ['/private/workspace/root'],
    }),
  ];
}

function provider(
  id: string,
  capabilityId: 'web_search' | 'web_fetch',
  status: 'available' | 'unavailable',
  extra: JsonRecord = {},
): ScriptableAgentServerProvider {
  return {
    id,
    providerId: id,
    capabilityId,
    workerId: 'sciforge.web-worker',
    status,
    ...extra,
  } as ScriptableAgentServerProvider;
}

function providerReadyEmptyResultPayload() {
  return {
    message: 'SA-WEB-05 provider route ready, but mock search returned empty results; retry with a broader query.',
    confidence: 0.78,
    claimType: 'limitation',
    evidenceLevel: 'mock-agentserver',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: 'repair-needed',
    },
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-SA-WEB-05-ready-provider-empty',
      tool: 'sciforge.web-worker.web_search',
      status: 'repair-needed',
      failureReason: 'empty-results',
      recoverActions: ['broaden query', 'relax date range'],
      outputRef: 'provider-result:sa-web-05-empty',
    }],
    artifacts: [],
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
