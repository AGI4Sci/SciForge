import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildParallelPlaywrightBrowserMcpServersConfig,
  buildPlaywrightBrowserMcpCodexTomlSnippet,
  buildPlaywrightBrowserMcpProviderAvailability,
  buildPlaywrightBrowserMcpServerConfig,
  buildPlaywrightBrowserMcpToolProviderRoutes,
  playwrightBrowserMcpHttpUrl,
  playwrightBrowserMcpOutputDir,
  playwrightBrowserMcpServerName,
  playwrightBrowserMcpUserDataDir,
  PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
  PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
} from './playwright-browser';
import { pageExtractionSpecField } from './playwright-browser-provider';

test('buildPlaywrightBrowserMcpServerConfig defaults to headless isolated browser automation', () => {
  const config = buildPlaywrightBrowserMcpServerConfig({
    homeDir: '/Users/example',
  });

  assert.equal(config.command, 'npx');
  assert.deepEqual(config.args, [
    '@playwright/mcp@latest',
    '--browser=msedge',
    '--viewport-size=1440x900',
    '--output-dir=/Users/example/.pw-mcp-browser-output',
    '--headless',
    '--isolated',
  ]);
  assert.equal(config.args.some((arg) => arg.startsWith('--user-data-dir=')), false);
});

test('persistent profile is opt-in for authorized browser sessions', () => {
  const config = buildPlaywrightBrowserMcpServerConfig({
    homeDir: '/Users/example',
    isolated: false,
    browser: 'firefox',
    port: 8933,
  });

  assert.ok(config.args.includes('--browser=firefox'));
  assert.ok(config.args.includes('--headless'));
  assert.ok(config.args.includes('--user-data-dir=/Users/example/.pw-mcp-browser-profile'));
  assert.ok(config.args.includes('--port=8933'));
  assert.equal(config.args.includes('--isolated'), false);
});

test('buildParallelPlaywrightBrowserMcpServersConfig allocates independent headless MCP endpoints', () => {
  const config = buildParallelPlaywrightBrowserMcpServersConfig(['p1', 'p2'], {
    homeDir: '/Users/example',
    portBase: 8933,
  });

  assert.deepEqual(Object.keys(config.mcpServers), ['playwright-browser-p1', 'playwright-browser-p2']);
  assert.ok(config.mcpServers['playwright-browser-p1']?.args.includes('--port=8933'));
  assert.ok(config.mcpServers['playwright-browser-p2']?.args.includes('--port=8934'));
  assert.ok(config.mcpServers['playwright-browser-p1']?.args.includes('--isolated'));
  assert.ok(config.mcpServers['playwright-browser-p2']?.args.includes('--isolated'));
});

test('Playwright browser helpers project MCP config and provider availability', () => {
  assert.equal(playwrightBrowserMcpServerName({ instanceId: 'P1 Browser' }), 'playwright-browser-p1-browser');
  assert.equal(playwrightBrowserMcpUserDataDir({ homeDir: '/Users/example', instanceId: 'p1' }), '/Users/example/.pw-mcp-browser-profile-p1');
  assert.equal(playwrightBrowserMcpOutputDir({ homeDir: '/Users/example', instanceId: 'p1' }), '/Users/example/.pw-mcp-browser-output/p1');
  assert.equal(playwrightBrowserMcpHttpUrl(8933), 'http://localhost:8933/mcp');

  const availability = buildPlaywrightBrowserMcpProviderAvailability({ port: 8933 });
  assert.equal(availability.id, PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID);
  assert.equal(availability.capabilityId, PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID);
  assert.equal(availability.transport, 'mcp');
  assert.equal(availability.url, 'http://localhost:8933/mcp');
  assert.equal(availability.available, true);

  const routes = buildPlaywrightBrowserMcpToolProviderRoutes({ port: 8933 });
  assert.equal(routes.playwright_browser_automation.primaryProviderId, PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID);
  assert.equal(routes.playwright_browser_automation.capabilityId, PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID);
});

test('Codex TOML snippet uses the headless isolated default', () => {
  const snippet = buildPlaywrightBrowserMcpCodexTomlSnippet({
    homeDir: '/Users/example',
    serverName: 'playwright-browser',
  });

  assert.match(snippet, /^\[mcp_servers\.playwright-browser\]/);
  assert.match(snippet, /"--browser=msedge"/);
  assert.match(snippet, /"--headless"/);
  assert.match(snippet, /"--isolated"/);
  assert.doesNotMatch(snippet, /--user-data-dir/);
});

test('page extraction spec normalizes bounded repeated-item extraction', () => {
  const spec = pageExtractionSpecField({
    kind: 'repeated-items',
    itemSelector: 'dt',
    detailSource: 'nextElementSibling',
    maxItems: 99999,
    section: {
      headingSelector: 'h3',
      startText: 'New submissions',
      stopTexts: ['Cross-lists', 'Replacements'],
    },
    fields: [
      { name: 'id', source: 'item', regex: 'arXiv:\\s*([0-9.]+)' },
      { name: 'title', source: 'detail', selector: '.list-title', regex: 'Title:\\s*(.*)' },
      { name: '', selector: '.ignored' },
    ],
  });

  assert.equal(spec?.kind, 'repeated-items');
  assert.equal(spec.itemSelector, 'dt');
  assert.equal(spec.detailSource, 'nextElementSibling');
  assert.equal(spec.maxItems, 2000);
  assert.deepEqual(spec.section?.stopTexts, ['Cross-lists', 'Replacements']);
  assert.equal(spec.fields?.length, 2);
  assert.equal(spec.fields?.[0]?.source, 'item');
});
