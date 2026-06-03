import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_RUNTIME_CAPABILITY_ID,
  BROWSER_RUNTIME_CONTRACT_ID,
  BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
  browserRuntimeCommandRisk,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
  buildBrowserRuntimeStableRef,
  normalizeBrowserRuntimePageQuery,
  type BrowserHostSessionActionRequest,
  type BrowserHostSessionState,
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

test('BrowserHostSession public contract carries bounded native OS UI proof requests and state', () => {
  const request = {
    sessionId: 'native-proof-session',
    action: 'native-os-ui-proof',
    capture: 'none',
    proofGroup: 'cursorCaret',
    probe: 'focus-caret',
    expectedProofNames: ['input-caret-visible', 'focus-blur-restore'],
    actionId: 'focus-input-caret',
  } satisfies BrowserHostSessionActionRequest;

  const state = {
    schemaVersion: 'sciforge.browser-host-session.state.v1',
    id: request.sessionId,
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    workspacePath: '/workspace',
    requestedUrl: 'https://example.org',
    url: 'https://example.org',
    startedAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:01.000Z',
    viewport: { width: 1280, height: 720 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: 'browser-host-session:native-proof-session/live-surface',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    nativeOsUiProof: {
      schemaVersion: BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
      boundedEvidenceOnly: true,
      rawDomRecorded: false,
      rawTextRecorded: false,
      rawUrlRecorded: false,
      rawTitleRecorded: false,
      rawSelectorRecorded: false,
      rawCoordsRecorded: false,
      rawPayloadRecorded: false,
      source: 'native-embedded-action-state',
      proofGroup: 'cursorCaret',
      actionId: 'focus-input-caret',
      observedProofNames: ['input-caret-visible', 'focus-blur-restore'],
      evidenceTokens: ['proof:input-caret-visible:observed', 'proof:focus-blur-restore:observed'],
      diagnostics: ['proof:input-caret-visible:observed'],
    },
    diagnostics: [],
  } satisfies BrowserHostSessionState;

  assert.equal(request.action, 'native-os-ui-proof');
  assert.equal(request.capture, 'none');
  assert.deepEqual(request.expectedProofNames, state.nativeOsUiProof.observedProofNames);
  assert.equal(state.nativeOsUiProof.boundedEvidenceOnly, true);
  assert.doesNotMatch(JSON.stringify(state.nativeOsUiProof), /<html|data:image|https?:|clipboard:raw|payload:|secret/i);
});
