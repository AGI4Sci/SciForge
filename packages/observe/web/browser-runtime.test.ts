import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserRuntimePageQueryRisk,
  browserRuntimeCodexFeatureMatrix,
  browserRuntimeCommandRisk,
  browserRuntimePlaywrightActionsForCommand,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
  buildBrowserRuntimeStableRef,
  BROWSER_RUNTIME_CAPABILITY_ID,
  normalizeBrowserRuntimePageQuery,
} from './browser-runtime';
import { webObserveCapabilityManifest, webObserveCapabilityManifests } from './manifest';

test('browser runtime feature matrix maps Codex in-app browser concepts to SciForge owners', () => {
  const matrix = browserRuntimeCodexFeatureMatrix();

  assert.ok(matrix.some((feature) => /tabs session/i.test(feature.codexFeature) && feature.owner === 'browser_runtime'));
  assert.ok(matrix.some((feature) => /screenshots/i.test(feature.codexFeature) && /refs-first/i.test(feature.notes)));
  assert.ok(matrix.some((feature) => feature.owner === 'playwright_edge_browser' && /takeover/i.test(feature.sciforgeSurface)));
  assert.ok(matrix.some((feature) => /clipboard/i.test(feature.codexFeature) && /approval/i.test(feature.notes)));
  assert.ok(matrix.some((feature) => /CUA coordinate/i.test(feature.codexFeature) && feature.owner === 'browser_host_session'));
  assert.ok(matrix.some((feature) => /coordinate CUA handoff/i.test(feature.codexFeature) && feature.owner === 'computer_use'));
  assert.ok(matrix.some((feature) => /visibility and viewport/i.test(feature.codexFeature) && feature.owner === 'browser_host_session'));
  assert.ok(matrix.every((feature) => !/GUI.*route|GUI.*prompt/i.test(`${feature.notes} ${feature.sciforgeSurface}`)));
});

test('browser runtime command risk requires approval for high-risk browser actions', () => {
  assert.equal(browserRuntimeCommandRisk({ type: 'tab.navigate', url: 'https://example.com' }).requiresApproval, false);

  const visible = browserRuntimeCommandRisk({ type: 'session.open', startUrl: 'https://example.com/login', visible: true });
  assert.equal(visible.level, 'high');
  assert.equal(visible.requiresApproval, true);
  assert.equal(visible.suggestedMode, 'visible-takeover');

  const clipboard = browserRuntimeCommandRisk({ type: 'clipboard.write', text: 'copy this' });
  assert.equal(clipboard.requiresApproval, true);

  const secretLikeType = browserRuntimeCommandRisk({ type: 'page.type', target: 'Password', text: 'my-api-key-secret' });
  assert.equal(secretLikeType.requiresApproval, true);
  assert.ok(secretLikeType.reasons.some((reason) => /secret-like/i.test(reason)));
});

test('browser runtime command risk covers frames, dialogs, uploads, storage, idle, and media emulation', () => {
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.list_frames' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.switch_frame', target: 'frame:checkout' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.list_dialogs' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.handle_dialog', text: 'accept' }).requiresApproval, true);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.get_network_log' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.wait_for_idle' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.get_storage' }).requiresApproval, false);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.upload_file', target: 'input[type=file]' }).requiresApproval, true);
  assert.equal(browserRuntimeCommandRisk({ type: 'browser.emulate_media', target: 'prefers-color-scheme:dark' }).requiresApproval, false);
});

test('browser runtime commands project to Playwright browser actions including scroll', () => {
  assert.deepEqual(browserRuntimePlaywrightActionsForCommand({ type: 'tab.navigate', url: 'https://example.com' }), [
    { type: 'navigate', url: 'https://example.com' },
  ]);

  assert.deepEqual(browserRuntimePlaywrightActionsForCommand({ type: 'page.scroll', deltaY: 900 }), [
    { type: 'scroll', deltaX: 0, deltaY: 900 },
  ]);

  assert.deepEqual(browserRuntimePlaywrightActionsForCommand({ type: 'tab.snapshot', screenshot: true, logs: true }), [
    { type: 'snapshot' },
    { type: 'screenshot', fullPage: true },
    { type: 'consoleMessages', all: true },
    { type: 'networkRequests' },
  ]);

  assert.deepEqual(browserRuntimePlaywrightActionsForCommand({ type: 'browser.wait_for_idle', timeoutMs: 1200 }), [
    { type: 'wait', idle: true, timeoutMs: 1200 },
  ]);

  assert.deepEqual(browserRuntimePlaywrightActionsForCommand({ type: 'browser.get_network_log' }), [
    { type: 'networkRequests' },
  ]);
});

test('browser runtime trace is refs-first and drops inline large browser evidence', () => {
  const trace = browserRuntimeTraceForCommand({
    command: { type: 'tab.snapshot', screenshot: true, dom: true, logs: true },
    sessionId: 'browser-session-1',
    tabId: 'tab-1',
    raw: {
      screenshotDataUrl: `data:image/png;base64,${'a'.repeat(64)}`,
      dom: '<html>'.padEnd(5000, 'x'),
      screenshotRef: 'blob://browser/screenshot-1.png',
      consoleLogRef: 'blob://browser/console-1.jsonl',
    },
  });

  assert.equal(trace.schemaVersion, 'sciforge.browser-runtime.trace.v1');
  assert.deepEqual(trace.refs.map((ref) => `${ref.kind}:${ref.ref}`), [
    'screenshot:blob://browser/screenshot-1.png',
    'console-log:blob://browser/console-1.jsonl',
  ]);
  assert.deepEqual(trace.inlineLargeObjectsDropped.sort(), ['dom', 'screenshotDataUrl'].sort());
  assert.ok(trace.diagnostics.some((diagnostic) => /Dropped inline browser evidence fields/i.test(diagnostic)));
});

test('browser runtime projection keeps GUI as presentation-only boundary', () => {
  const snapshot = browserRuntimeSnapshotFromRefs({
    url: 'https://example.com',
    title: 'Example',
    screenshotRef: 'blob://browser/screenshot.png',
    domSnapshotRef: 'blob://browser/dom.json',
  });
  const projection = browserRuntimeProjection({
    session: {
      id: 'browser-session-1',
      mode: 'agent-headless',
      providerId: 'sciforge.observe.browser-runtime',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', status: 'ready' }],
    },
    snapshot,
    trace: browserRuntimeTraceForCommand({
      command: { type: 'tab.snapshot', screenshot: true },
      refs: [{ kind: 'screenshot', ref: 'blob://browser/screenshot.png' }],
    }),
  });

  assert.equal(projection.schemaVersion, 'sciforge.browser-runtime.projection.v1');
  assert.equal(projection.activeTab?.id, 'tab-1');
  assert.equal(projection.guiBoundary.presentationOnly, true);
  assert.equal(projection.guiBoundary.providerRouting, false);
  assert.deepEqual(projection.traceRefs, [{ kind: 'screenshot', ref: 'blob://browser/screenshot.png' }]);
});

test('stable refs combine selector, accessible, text, bbox, and visual signals for reload-safe matching', () => {
  const ref = buildBrowserRuntimeStableRef({
    selector: '[data-testid="submit"]',
    domPath: 'main > form > button',
    role: 'button',
    accessibleName: 'Submit',
    text: 'Submit request',
    bbox: { x: 12, y: 30, width: 120, height: 40 },
    componentPath: 'SubmitButton@src/ui/SubmitButton.tsx:12',
    visualHash: 'phash:abc',
  });

  assert.equal(ref.schemaVersion, 'sciforge.browser-runtime.stable-ref.v1');
  assert.equal(ref.primary, '[data-testid="submit"]');
  assert.equal(ref.resolveStrategy, 'exact');
  assert.equal(ref.signals.textHash?.length, 16);
  assert.equal(ref.signals.componentPath, 'SubmitButton@src/ui/SubmitButton.tsx:12');
});

test('PageQuery DSL normalizes read-only page inspection without arbitrary JavaScript', () => {
  const query = normalizeBrowserRuntimePageQuery({
    select: { role: 'button', name: 'Submit*', visible: true },
    fields: ['tagName', 'role', 'bbox', 'computedStyle.color', 'attribute.aria-label', 'dataset.testid'],
    limit: 500,
  });

  assert.equal(query.schemaVersion, 'sciforge.browser-runtime.page-query.v1');
  assert.equal(query.limit, 100);
  assert.deepEqual(query.fields, ['tagName', 'role', 'bbox', 'computedStyle.color', 'attribute.aria-label', 'dataset.testid']);
  assert.equal(browserRuntimePageQueryRisk(query).requiresApproval, false);

  assert.throws(() => normalizeBrowserRuntimePageQuery({
    select: { selector: 'button:has(:has(span))' },
    fields: ['innerText'],
  }), /nested :has/);
  assert.throws(() => normalizeBrowserRuntimePageQuery({
    select: { selector: 'button' },
    fields: ['computedStyle.behavior'],
  }), /field is not allowed/);
});

test('browser_runtime manifest is discoverable from web observe package registry', () => {
  assert.ok(webObserveCapabilityManifests.some((manifest) => manifest.id === BROWSER_RUNTIME_CAPABILITY_ID));
  assert.equal(webObserveCapabilityManifest(BROWSER_RUNTIME_CAPABILITY_ID)?.id, BROWSER_RUNTIME_CAPABILITY_ID);
});
