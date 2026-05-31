import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicBrowserWorkbenchFixture } from './fixtures/basic';
import { emptyBrowserWorkbenchFixture } from './fixtures/empty';
import { selectionBrowserWorkbenchFixture } from './fixtures/selection';
import { manifest } from './manifest';
import { browserWorkbenchDefaultCommands, normalizeBrowserWorkbenchUrl, renderBrowserWorkbench } from './render';

function htmlFor(fixture = basicBrowserWorkbenchFixture) {
  return renderToStaticMarkup(renderBrowserWorkbench(fixture));
}

test('browser-workbench package exposes manifest and renders browser_runtime refs', () => {
  assert.equal(manifest.componentId, 'browser-workbench');
  const html = htmlFor();

  assert.match(html, /browser-workbench-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-session-ref="browser-session-demo"/);
  assert.match(html, /SciForge/);
  assert.match(html, /blob:\/\/browser\/demo-screenshot\.png/);
  assert.match(html, /blob:\/\/browser\/demo-dom\.json/);
  assert.match(html, /data-event="browser-command-request"/);
  assert.match(html, /\/browser snapshot --url &quot;http:\/\/localhost:5173\/&quot; --screenshot --dom --logs/);
  assert.doesNotMatch(html, /Presentation only: browser_runtime owns provider routing/);
});

test('browser-workbench renders an empty state without pretending to own browser execution', () => {
  const html = htmlFor(emptyBrowserWorkbenchFixture);

  assert.match(html, /Attach a browser_runtime projection/);
  assert.match(html, /\/browser open &quot;about:blank&quot; --surface workbench/);
  assert.doesNotMatch(html, /playwright_browser_automation/);
});

test('browser-workbench supports host-declared preview and approval-tagged commands', () => {
  const html = htmlFor(selectionBrowserWorkbenchFixture);

  assert.match(html, /<iframe/);
  assert.match(html, /sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation"/);
  assert.match(html, /data-browser-risk="needs-approval"/);
  assert.match(html, /Visible takeover requires TUI-host approval/);
});

test('browser-workbench default commands are terminal-equivalent text', () => {
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.command), [
    '/browser open "https://example.org" --surface workbench',
    '/browser snapshot --url "https://example.org" --screenshot --dom --logs',
    '/browser state --url "https://example.org" --dom --ax --console --network',
    '/browser takeover --url "https://example.org" --approval required',
  ]);
});

test('browser-workbench normalizes scheme-less urls for commands and iframe previews', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5175'), 'http://localhost:5175');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org/docs'), 'https://example.org/docs');
  assert.equal(normalizeBrowserWorkbenchUrl('https://example.org/about:blank'), 'https://example.org/');
  assert.equal(browserWorkbenchDefaultCommands('localhost:5175')[0]?.command, '/browser open "http://localhost:5175" --surface workbench');

  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'localhost:5175',
      },
    },
  }));
  assert.match(html, /src="http:\/\/localhost:5175"/);
});

test('browser-workbench imports no TUI runtime or browser provider packages', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /@sciforge-observe\/web|playwright|child_process|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(/);
});
