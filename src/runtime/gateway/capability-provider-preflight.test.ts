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
        workers: [{
          id: 'backend-server',
          status: 'online',
          tools: ['web_search', 'web_fetch'],
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
    assert.equal(preflight.routes[0]?.primaryProviderId, 'agentserver.backend-server.web_search');
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
        id: 'agentserver.backend-server.web_search',
        available: true,
        status: 'available',
      }],
    },
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.routes[0]?.primaryProviderId, 'agentserver.backend-server.web_search');
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
          primaryProviderId: 'agentserver.backend-server.web_search',
          health: 'ready',
        },
      },
    },
  };

  const preflight = capabilityProviderPreflight(request);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.routes[0]?.primaryProviderId, 'agentserver.backend-server.web_search');
});
