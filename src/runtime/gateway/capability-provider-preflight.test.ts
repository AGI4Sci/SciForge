import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  capabilityProviderPreflight,
  capabilityProviderPreflightPayload,
  requestWithDiscoveredCapabilityProviders,
} from './capability-provider-preflight.js';

test('capability provider preflight blocks web search when provider is not configured', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: '检索今天 arxiv 上 agentic harness evolution 的最新文章',
    artifacts: [],
  };

  const preflight = capabilityProviderPreflight(request);
  const payload = capabilityProviderPreflightPayload(request, preflight);

  assert.equal(preflight.ok, false);
  assert.ok(preflight.requiredCapabilityIds.includes('web_search'));
  assert.match(preflight.blockingRoutes[0]?.reason ?? '', /requires config|unknown health|No provider/);
  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.capability-provider-preflight');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.match(payload.message, /尚未就绪的工具能力/);
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
        }],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const request = await requestWithDiscoveredCapabilityProviders({
      skillDomain: 'literature',
      prompt: 'search latest papers',
      agentServerBaseUrl: 'http://agentserver.example.test',
      artifacts: [],
    });

    assert.ok(calls > 0);
    const preflight = capabilityProviderPreflight(request);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.routes[0]?.primaryProviderId, 'sciforge.web-worker.web_search');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capability provider preflight accepts explicit AgentServer provider availability', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'search latest papers',
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
  assert.equal(capabilityProviderPreflightPayload(request, preflight), undefined);
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

test('capability provider preflight detects underscored tool names in prompts', () => {
  const result = capabilityProviderPreflight({
    skillDomain: 'literature',
    prompt: 'Say whether web_fetch and web_search tool providers are available.',
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
