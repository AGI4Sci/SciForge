import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_RUNTIME_CAPABILITY_ID,
  BROWSER_RUNTIME_CONTRACT_ID,
  browserRuntimeCommandRisk,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
  buildBrowserRuntimeStableRef,
  normalizeBrowserRuntimePageQuery,
} from './browser-runtime';

test('browser runtime shared contract is usable by GUI and TUI packages without provider ownership', () => {
  assert.equal(BROWSER_RUNTIME_CAPABILITY_ID, 'browser_runtime');
  assert.equal(BROWSER_RUNTIME_CONTRACT_ID, 'sciforge.browser-runtime.v1');

  const projection = browserRuntimeProjection({
    session: {
      id: 'browser-session-1',
      mode: 'agent-headless',
      providerId: 'sciforge.observe.browser-runtime',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', url: 'https://example.org', status: 'ready' }],
    },
    snapshot: browserRuntimeSnapshotFromRefs({
      screenshotRef: 'blob://browser/screenshot.png',
      domSnapshotRef: 'blob://browser/dom.json',
    }),
    trace: browserRuntimeTraceForCommand({
      command: { type: 'tab.snapshot', screenshot: true, dom: true },
      refs: [{ kind: 'screenshot', ref: 'blob://browser/screenshot.png' }],
    }),
  });

  assert.equal(projection.guiBoundary.presentationOnly, true);
  assert.equal(projection.guiBoundary.providerRouting, false);
  assert.deepEqual(projection.traceRefs, [{ kind: 'screenshot', ref: 'blob://browser/screenshot.png' }]);
});

test('browser runtime shared helpers keep risk and page-query validation deterministic', () => {
  const takeover = browserRuntimeCommandRisk({
    type: 'session.open',
    startUrl: 'https://example.org/login',
    visible: true,
  });
  assert.equal(takeover.requiresApproval, true);
  assert.equal(takeover.suggestedMode, 'visible-takeover');

  const ref = buildBrowserRuntimeStableRef({
    selector: '[data-testid="preview"]',
    domPath: 'main > button',
    text: 'Preview',
    bbox: { x: 1, y: 2, width: 80, height: 24 },
  });
  assert.equal(ref.resolveStrategy, 'exact');

  const query = normalizeBrowserRuntimePageQuery({
    select: { role: 'button', name: 'Preview', visible: true },
    fields: ['tagName', 'bbox', 'attribute.aria-label'],
    limit: 1000,
  });
  assert.equal(query.limit, 100);
  assert.deepEqual(query.fields, ['tagName', 'bbox', 'attribute.aria-label']);
});
