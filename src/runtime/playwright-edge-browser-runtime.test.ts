import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';

import {
  playwrightEdgeBrowserExecutionParams,
  playwrightEdgeBrowserInvocationInputFromRequest,
} from './playwright-edge-browser-runtime.js';

test('Playwright Edge browser runtime builds invocation input from configured provider route', () => {
  const input = playwrightEdgeBrowserInvocationInputFromRequest({
    skillDomain: 'literature',
    prompt: '请使用 playwright_edge_browser / sciforge.observe.playwright-edge-mcp 打开 https://example.com 并读取页面。',
    workspacePath: '/tmp/sciforge',
    artifacts: [],
    uiState: {
      toolProviderRoutes: {
        playwright_edge_browser: {
          enabled: true,
          capabilityId: 'playwright_edge_browser',
          source: 'mcp',
          primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
          health: 'ready',
          endpoint: 'http://localhost:8931/mcp',
        },
      },
    },
  });

  assert.deepEqual(input, {
    task: '请使用 playwright_edge_browser / sciforge.observe.playwright-edge-mcp 打开 https://example.com 并读取页面。',
    url: 'https://example.com',
    mode: 'read',
    maxChars: 1800,
    timeoutMs: 60000,
    mcpUrl: 'http://localhost:8931/mcp',
    workspaceProfileDir: '/tmp/sciforge/.sciforge/browser-host/profile',
    outputDir: '/tmp/sciforge/.sciforge/browser-host/playwright-edge-output',
  });
});

test('Playwright Edge browser runtime derives workspace-local profile without exposing private paths or full URLs in public params', () => {
  const workspacePath = '/tmp/sciforge-edge-workspace';
  const input = playwrightEdgeBrowserInvocationInputFromRequest({
    skillDomain: 'literature',
    prompt: '请使用 playwright_edge_browser 打开 https://example.com/private?token=secret-value 并读取页面。',
    workspacePath,
    artifacts: [],
    uiState: {
      toolProviderRoutes: {
        playwright_edge_browser: {
          enabled: true,
          capabilityId: 'playwright_edge_browser',
          source: 'mcp',
          primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
          health: 'ready',
          endpoint: 'http://localhost:8931/mcp',
        },
      },
    },
  });

  assert.equal(input?.workspaceProfileDir, join(workspacePath, '.sciforge', 'browser-host', 'profile'));
  assert.equal(input?.outputDir, join(workspacePath, '.sciforge', 'browser-host', 'playwright-edge-output'));

  const publicParams = playwrightEdgeBrowserExecutionParams(input);
  assert.doesNotMatch(publicParams, /\/tmp\/sciforge-edge-workspace|secret-value|token=|https:\/\/example\.com\/private/i);
  assert.match(publicParams, /workspaceProfileRef/);
  assert.match(publicParams, /urlDigest/);
});

test('Playwright Edge browser runtime ignores generic browser prompts without explicit Edge MCP intent', () => {
  const input = playwrightEdgeBrowserInvocationInputFromRequest({
    skillDomain: 'literature',
    prompt: '打开 https://example.com 并总结网页。',
    workspacePath: '/tmp/sciforge',
    artifacts: [],
    uiState: {
      toolProviderRoutes: {
        playwright_edge_browser: {
          enabled: true,
          capabilityId: 'playwright_edge_browser',
          source: 'mcp',
          primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
          health: 'ready',
          endpoint: 'http://localhost:8931/mcp',
        },
      },
    },
  });

  assert.equal(input, undefined);
});
