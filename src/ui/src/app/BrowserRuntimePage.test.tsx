import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BrowserRuntimePage,
  buildBrowserAnnotationCommand,
  buildBrowserTerminalCommands,
  normalizeBrowserWorkbenchUrl,
} from './BrowserRuntimePage';

test('BrowserRuntimePage exposes a real browser workbench plus Codex-like coverage without GUI routing ownership', () => {
  const html = renderToStaticMarkup(createElement(BrowserRuntimePage));

  assert.match(html, /内置浏览器/);
  assert.match(html, /内置浏览器工作台/);
  assert.match(html, /browser-workbench-pro/);
  assert.match(html, /browser-framebar/);
  assert.match(html, /browser-viewport-stage/);
  assert.match(html, /browser-inspector/);
  assert.match(html, /运行时细节与安全策略/);
  assert.match(html, /浏览器地址/);
  assert.match(html, /SciForge embedded browser preview/);
  assert.match(html, /标注页面/);
  assert.match(html, /读取状态/);
  assert.match(html, /页面标注/);
  assert.match(html, /browser_runtime/);
  assert.match(html, /Session \/ Tabs/);
  assert.match(html, /Navigation/);
  assert.match(html, /DOM \/ Playwright/);
  assert.match(html, /CUA Fallback/);
  assert.match(html, /Snapshot \/ Logs/);
  assert.match(html, /Clipboard \/ Safety/);
  assert.match(html, /browser\.list_frames/);
  assert.match(html, /browser\.handle_dialog/);
  assert.match(html, /browser\.get_storage/);
  assert.match(html, /browser\.wait_for_idle/);
  assert.match(html, /playwright_browser_automation/);
  assert.match(html, /playwright_edge_browser/);
  assert.match(html, /SciForge Browser Workbench/);
  assert.match(html, /\/browser open &quot;about:blank&quot;/);
  assert.match(html, /\/browser snapshot --url &quot;about:blank&quot; --screenshot --dom --logs/);
  assert.match(html, /needs approval/);
  assert.doesNotMatch(html, /GUI owns provider route/i);
  assert.doesNotMatch(html, /GUI owns prompt assembly/i);
});

test('normalizeBrowserWorkbenchUrl preserves local browser targets and defaults schemes', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5173/foo'), 'http://localhost:5173/foo');
  assert.equal(normalizeBrowserWorkbenchUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org'), 'https://example.org');
  assert.equal(normalizeBrowserWorkbenchUrl('https://example.org/a'), 'https://example.org/a');
});

test('browser command builders keep GUI input as terminal-equivalent text', () => {
  const commands = buildBrowserTerminalCommands('http://localhost:5173/');
  assert.deepEqual(commands.map((command) => command.label), ['打开页面', '页面快照', '读取页面状态', '滚动页面', '人工接管']);
  assert.match(commands[0].command, /^\/browser open "http:\/\/localhost:5173\/"$/);
  assert.match(commands[1].command, /--screenshot --dom --logs/);

  const annotationCommand = buildBrowserAnnotationCommand({
    url: 'http://localhost:5173/',
    comment: '按钮溢出，请修复。',
    target: {
      kind: 'region',
      stableRef: {
        schemaVersion: 'sciforge.browser-runtime.stable-ref.v1',
        primary: '[data-testid="submit"]',
        resolveStrategy: 'exact',
        signals: {
          selector: '[data-testid="submit"]',
          domPath: 'main > button',
          bbox: { x: 10, y: 20, width: 300, height: 44 },
        },
      },
      rect: { x: 10, y: 20, width: 300, height: 44 },
    },
  });
  assert.match(annotationCommand, /^\/browser annotate /);
  assert.match(annotationCommand, /--stable-ref "\[data-testid=\\"submit\\"\]"/);
  assert.match(annotationCommand, /--snapshot --dom --refs-first/);
});
