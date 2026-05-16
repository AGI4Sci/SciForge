import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  capabilityProviderPreflight,
  capabilityProviderRoutesForHandoff,
  requestWithDiscoveredCapabilityProviders,
} from './capability-provider-preflight.js';

test('capability provider preflight blocks web search when provider is not configured', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '检索今天 arxiv 上 agentic harness evolution 的最新文章',
    selectedToolIds: ['web_search'],
    artifacts: [],
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, false);
  assert.ok(preflight.requiredCapabilityIds.includes('web_search'));
  assert.match(preflight.blockingRoutes[0]?.reason ?? '', /requires config|unknown health|No provider/);
});

test('AgentServer discovery maps worker tool routes into provider availability', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        providers: [{
          id: 'sciforge.web-worker.web_search',
        providerId: 'sciforge.web-worker.web_search',
        capabilityId: 'web_search',
        workerId: 'sciforge.web-worker',
        status: 'available',
        endpoint: 'https://private-provider.example.test/internal',
        baseUrl: 'https://private-base.example.test',
        invokeUrl: 'https://private-invoke.example.test/run',
        runtimeLocation: 'PRIVATE_RUNTIME_LOCATION_SHOULD_NOT_LEAK',
      }],
    }),
  } as Response;
  }) as typeof fetch;
  try {
    const request = await requestWithDiscoveredCapabilityProviders({
      skillDomain: 'literature',
      prompt: 'search latest papers',
      selectedToolIds: ['web_search'],
      agentServerBaseUrl: 'http://agentserver.example.test',
      artifacts: [],
    });

    assert.ok(calls > 0);
    assertNoProviderRouteLeaks(request.uiState?.capabilityProviderAvailability);
    const preflight = capabilityProviderPreflight(request);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_search');
    assert.equal(preflight.routes[0]?.providers[0]?.endpoint, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capability provider preflight accepts explicit AgentServer provider availability', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'search latest papers',
    selectedToolIds: ['web_search'],
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        available: true,
        status: 'available',
      }],
    },
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_search');
});

test('capability provider handoff exposes only public route shape', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'fetch url with web_fetch provider',
    selectedToolIds: ['web_fetch'],
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_fetch',
        providerId: 'sciforge.web-worker.web_fetch',
        capabilityId: 'web_fetch',
        workerId: 'PRIVATE_WORKER_ID_SHOULD_NOT_LEAK',
        runtimeLocation: 'PRIVATE_RUNTIME_LOCATION_SHOULD_NOT_LEAK',
        available: true,
        status: 'available',
        endpoint: 'https://private-provider.example.test/internal',
        baseUrl: 'https://private-base.example.test',
        url: 'https://private-url.example.test',
        invokeUrl: 'https://private-invoke.example.test/run',
        invokePath: '/private/invoke',
        timeoutMs: 1234,
        auth: { token: 'PRIVATE_AUTH_SHOULD_NOT_LEAK' },
        workspaceRoots: ['/private/workspace/root'],
      }],
    },
  };

  const internal = capabilityProviderPreflight(request);
  assert.equal(internal.ok, true);
  assert.equal(internal.routes[0]?.providers[0]?.endpoint, 'https://private-provider.example.test/internal');

  const handoff = capabilityProviderRoutesForHandoff(request);
  assert.equal(handoff.ok, true);
  assert.equal(handoff.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_fetch');
  assert.deepEqual(Object.keys(handoff.routes[0]?.providers[0] ?? {}).sort(), [
    'healthStatus',
    'providerId',
    'source',
    'transport',
  ]);
  assertNoProviderRouteLeaks(handoff);
});

test('capability provider handoff redacts unavailable route internals', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'search latest papers',
    selectedToolIds: ['web_search'],
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        providerId: 'sciforge.web-worker.web_search',
        capabilityId: 'web_search',
        available: false,
        status: 'offline',
        endpoint: 'https://private-provider.example.test/internal',
        baseUrl: 'https://private-base.example.test',
        invokeUrl: 'https://private-invoke.example.test/run',
        invokePath: '/private/invoke',
        auth: { token: 'PRIVATE_AUTH_SHOULD_NOT_LEAK' },
        workspaceRoots: ['/private/workspace/root'],
      }],
    },
  };

  const handoff = capabilityProviderRoutesForHandoff(request);

  assert.equal(handoff.ok, false);
  assertNoProviderRouteLeaks(handoff);
});

test('capability provider preflight accepts scenario tool provider routes', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Search today arxiv papers about agentic harness evolution.',
    artifacts: [],
    uiState: {
      toolProviderRoutes: {
        web_search: {
          enabled: true,
          capabilityId: 'web_search',
          source: 'agentserver',
          primaryProviderId: 'sciforge.web-worker.web_search',
          health: 'ready',
        },
      },
    },
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_search');
});

test('AgentServer discovery overrides stale scenario route health', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Search today arxiv papers about agentic harness evolution.',
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        available: true,
        status: 'available',
      }],
      toolProviderRoutes: {
        web_search: {
          enabled: true,
          capabilityId: 'web_search',
          source: 'package',
          primaryProviderId: 'sciforge.web-worker.web_search',
          health: 'unknown',
        },
      },
    },
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_search');
});

test('capability provider preflight detects underscored selected tool names', () => {
  const result = capabilityProviderPreflight({
    skillDomain: 'literature',
    prompt: 'Say whether web_fetch and web_search tool providers are available.',
    selectedToolIds: ['web_fetch', 'web_search'],
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [
        {
          id: 'sciforge.web-worker.web_fetch',
          providerId: 'sciforge.web-worker.web_fetch',
          capabilityId: 'web_fetch',
          workerId: 'sciforge.web-worker',
          available: true,
          status: 'available',
        },
        {
          id: 'sciforge.web-worker.web_search',
          providerId: 'sciforge.web-worker.web_search',
          capabilityId: 'web_search',
          workerId: 'sciforge.web-worker',
          available: true,
          status: 'available',
        },
      ],
    },
  } as GatewayRequest);

  assert.deepEqual(result.requiredCapabilityIds, ['web_fetch', 'web_search']);
  assert.equal(result.ok, true);
});

test('capability provider preflight treats explicit capability ids in prompts as required routes', () => {
  const result = capabilityProviderPreflight({
    skillDomain: 'literature',
    prompt: 'Require web_search and web_fetch provider routes for this retrieval task.',
    artifacts: [],
    uiState: {
      capabilityProviderAvailability: [
        {
          id: 'sciforge.web-worker.web_search',
          providerId: 'sciforge.web-worker.web_search',
          capabilityId: 'web_search',
          available: false,
          status: 'provider-unavailable',
          reason: 'provider health check failed',
        },
        {
          id: 'sciforge.web-worker.web_fetch',
          providerId: 'sciforge.web-worker.web_fetch',
          capabilityId: 'web_fetch',
          available: false,
          status: 'provider-unavailable',
          reason: 'provider health check failed',
        },
      ],
    },
  } as GatewayRequest);

  assert.deepEqual(result.requiredCapabilityIds, ['web_fetch', 'web_search']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockingRoutes.map((route) => route.capabilityId), ['web_fetch', 'web_search']);
});

function assertNoProviderRouteLeaks(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:\\")?(endpoint|baseUrl|invokeUrl|invokePath|workerId|runtimeLocation|auth|workspaceRoots)(?:\\")?\s*:/);
  assert.doesNotMatch(serialized, /private-provider|private-base|private-url|private-invoke|PRIVATE_|\/private\/workspace/);
}
