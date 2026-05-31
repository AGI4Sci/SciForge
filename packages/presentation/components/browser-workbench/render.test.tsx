import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicBrowserWorkbenchFixture } from './fixtures/basic';
import { emptyBrowserWorkbenchFixture } from './fixtures/empty';
import { selectionBrowserWorkbenchFixture } from './fixtures/selection';
import { manifest } from './manifest';
import {
  browserWorkbenchDefaultCommands,
  browserWorkbenchStateFromPayload,
  normalizeBrowserWorkbenchUrl,
  renderBrowserWorkbench,
} from './render';

function htmlFor(fixture = basicBrowserWorkbenchFixture) {
  return renderToStaticMarkup(renderBrowserWorkbench(fixture));
}

test('browser-workbench package exposes manifest and renders browser_runtime refs', () => {
  assert.equal(manifest.componentId, 'browser-workbench');
  const html = htmlFor();

  assert.match(html, /browser-workbench-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-session-ref="browser-session-demo"/);
  assert.match(html, /data-browser-state="ready"/);
  assert.match(html, /SciForge/);
  assert.match(html, /blob:\/\/browser\/demo-screenshot\.png/);
  assert.match(html, /blob:\/\/browser\/demo-dom\.json/);
  assert.match(html, /data-event="browser-command-request"/);
  assert.match(html, /data-browser-command-id="open-external"/);
  assert.match(html, /\/browser snapshot --url &quot;http:\/\/localhost:5173\/&quot; --screenshot --dom --logs/);
  assert.doesNotMatch(html, /Presentation only: browser_runtime owns provider routing/);
});

test('browser-workbench renders an empty state without pretending to own browser execution', () => {
  const html = htmlFor(emptyBrowserWorkbenchFixture);

  assert.match(html, /data-status="idle"/);
  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /No browser runtime projection is attached/);
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
    '/browser back --url "https://example.org"',
    '/browser forward --url "https://example.org"',
    '/browser reload --url "https://example.org"',
    '/browser snapshot --url "https://example.org" --screenshot --dom --logs',
    '/browser state --url "https://example.org" --dom --ax --console --network',
    '/browser takeover --url "https://example.org" --approval required',
    '/browser copy-url "https://example.org" --surface workbench',
    '/browser open-external "https://example.org" --approval required',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.id), [
    'open',
    'back',
    'forward',
    'reload',
    'snapshot',
    'state',
    'takeover',
    'copy-url',
    'open-external',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org', { status: 'loading' })[3], {
    id: 'stop',
    label: 'Stop',
    command: '/browser stop --url "https://example.org"',
    disabled: false,
    risk: 'allowed',
    kind: 'terminal-equivalent',
  });
});

test('browser-workbench normalizes scheme-less urls for commands and iframe previews', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5175'), 'http://localhost:5175');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org/docs'), 'https://example.org/docs');
  assert.equal(normalizeBrowserWorkbenchUrl('/api/sciforge/browser/proxy?url=https%3A%2F%2Fexample.org'), '/api/sciforge/browser/proxy?url=https%3A%2F%2Fexample.org');
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

test('browser-workbench preserves relative proxy fallback urls', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'https://external.example',
        proxyFallbackUrl: '/api/sciforge/browser/proxy?url=https%3A%2F%2Fexternal.example',
        embedPolicy: {
          embeddable: false,
          reason: 'External embedding blocked',
        },
      },
    },
  }));

  assert.match(html, /data-browser-state-action="proxy-fallback"/);
  assert.match(html, /href="\/api\/sciforge\/browser\/proxy\?url=https%3A%2F%2Fexternal\.example"/);
  assert.doesNotMatch(html, /https:\/\/\/api\/sciforge\/browser\/proxy/);
});

test('browser-workbench normalizes idle/loading/ready/blocked/error/offline state machine inputs', () => {
  assert.equal(browserWorkbenchStateFromPayload({}, undefined, undefined, undefined).status, 'idle');
  assert.equal(browserWorkbenchStateFromPayload({}, undefined, { id: 'tab', status: 'loading' }, undefined).status, 'loading');
  assert.equal(browserWorkbenchStateFromPayload({}, { id: 'session', mode: 'agent-headless', providerId: 'browser_runtime', tabs: [] }, undefined, undefined).status, 'ready');
  assert.equal(browserWorkbenchStateFromPayload({ embedPolicy: { embeddable: false } }, undefined, undefined, undefined, 'https://blocked.example').status, 'blocked');
  assert.equal(browserWorkbenchStateFromPayload({ errorRef: 'blob://browser/error.json' }, undefined, undefined, undefined).status, 'error');
  assert.equal(browserWorkbenchStateFromPayload({ offlineReason: 'network unreachable' }, undefined, undefined, undefined).status, 'offline');
});

test('browser-workbench renders blocked/error/offline as typed state instead of a white iframe', () => {
  for (const status of ['blocked', 'error', 'offline'] as const) {
    const html = renderToStaticMarkup(renderBrowserWorkbench({
      ...emptyBrowserWorkbenchFixture,
      slot: {
        ...emptyBrowserWorkbenchFixture.slot,
        props: {
          previewUrl: 'https://example.org',
          state: {
            status,
            reason: `${status} reason`,
            ref: `blob://browser/${status}.json`,
          },
        },
      },
    }));

    assert.match(html, new RegExp(`data-status="${status}"`));
    assert.match(html, /data-browser-object-type="browser-state"/);
    assert.match(html, new RegExp(`${status} reason`));
    assert.match(html, new RegExp(`blob://browser/${status}\\.json`));
    assert.doesNotMatch(html, /<iframe/);
  }
});

test('browser-workbench uses embed policy to show external blocked state without embedding', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'https://external.example',
        embedPolicy: {
          embeddable: false,
          reason: 'X-Frame-Options or CSP denied embedding',
          ref: 'blob://browser/embed-policy.json',
        },
      },
    },
  }));

  assert.match(html, /data-status="blocked"/);
  assert.match(html, /X-Frame-Options or CSP denied embedding/);
  assert.match(html, /blob:\/\/browser\/embed-policy\.json/);
  assert.doesNotMatch(html, /<iframe/);
  assert.equal(
    browserWorkbenchStateFromPayload(
      { status: 'ready', embedPolicy: { embeddable: false } },
      undefined,
      undefined,
      undefined,
      'https://external.example',
    ).status,
    'blocked',
  );
});

test('browser-workbench rejects inline large refs and keeps safe object refs', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    artifact: {
      ...emptyBrowserWorkbenchFixture.artifact,
      data: {
        snapshot: {
          schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
          url: 'https://example.org',
          screenshotRef: 'data:image/png;base64,AAAA',
          domSnapshotRef: '{"html":"too large"}',
          networkLogRef: 'blob://browser/network.jsonl',
        },
        traceRefs: [
          { kind: 'console-log', ref: 'blob://browser/console.jsonl' },
          { kind: 'dom-snapshot', ref: '[{"node":"inline"}]' },
        ],
      },
    },
  }));

  assert.match(html, /blob:\/\/browser\/network\.jsonl/);
  assert.match(html, /blob:\/\/browser\/console\.jsonl/);
  assert.doesNotMatch(html, /data:image\/png;base64/);
  assert.doesNotMatch(html, /too large/);
  assert.doesNotMatch(html, /inline/);
});

test('browser-workbench imports no TUI runtime or browser provider packages', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /@sciforge-observe\/web|playwright|computer-use|computer_use|child_process|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(/);
});
