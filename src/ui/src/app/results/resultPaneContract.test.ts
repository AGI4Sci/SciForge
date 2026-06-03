import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference } from '../../domain';
import { objectActions } from '../../runtimeContracts';
import {
  RESULT_PANE_CONTRACTS,
  RESULT_PANE_LIFECYCLE_STATES,
  RESULT_PANE_TABS,
  allowedActionsForResultPaneObject,
  focusResultPaneRouteForObjectReference,
  openResultPaneRouteForObjectReference,
  resolveResultPaneObjectState,
  resolveResultPaneRoute,
  resultPaneContractForTab,
} from './resultPaneContract';

test('result pane contracts declare states, refs, actions, and redaction hints for every pane', () => {
  assert.deepEqual(Object.keys(RESULT_PANE_CONTRACTS).sort(), [...RESULT_PANE_TABS].sort());
  for (const tab of RESULT_PANE_TABS) {
    const contract = resultPaneContractForTab(tab);
    assert.equal(contract.pane, tab);
    assert.ok(contract.objectKinds.length, `${tab} declares object kinds`);
    assert.ok(contract.refPrefixes.length, `${tab} declares ref prefixes`);
    assert.ok(contract.requiredRefs.length, `${tab} declares required refs`);
    assert.ok(contract.redactionHints.includes('refs-first'), `${tab} is refs-first`);
    assert.ok(contract.redactionHints.includes('no-raw-dump'), `${tab} forbids raw dumps`);
    for (const state of RESULT_PANE_LIFECYCLE_STATES) {
      assert.equal(contract.states[state].state, state, `${tab} declares ${state}`);
    }
    for (const action of contract.allowedActions) {
      assert.ok(objectActions.includes(action), `${tab} action ${action} is runtime-supported`);
    }
  }
});

test('image result pane declares refs-first visual evidence contract without live screen control', () => {
  assert.ok(RESULT_PANE_TABS.includes('image'));
  assert.equal((RESULT_PANE_TABS as readonly string[]).includes('screen'), false);

  const image = resultPaneContractForTab('image');
  assert.equal(image.pane, 'image');
  assert.deepEqual(image.attachStates, undefined);
  assert.ok(image.refPrefixes.includes('image:'));
  assert.ok(image.refPrefixes.includes('screenshot:'));
  assert.ok(image.refPrefixes.includes('annotation:'));
  assert.ok(image.refPrefixes.includes('browser-evidence:'));
  assert.ok(image.refPrefixes.includes('window-capture:'));
  assert.ok(image.refPrefixes.includes('screen-region:'));
  assert.ok(image.refPrefixes.includes('replay:'));
  for (const field of [
    'imageRef',
    'sourceKind',
    'mime',
    'width',
    'height',
    'sha256',
    'createdAt',
    'bounds',
    'provenanceRef',
    'annotationRefs',
    'targetRef',
    'windowRef',
    'browserSessionRef',
    'artifactRef',
    'redactionRef',
  ]) {
    assert.ok(image.acceptedPayloadRefs?.includes(field), `Image accepts ${field}`);
  }
  for (const field of [
    'rawScreenshot',
    'screenshotBase64',
    'imageBase64',
    'base64',
    'dataUrl',
    'frameUrl',
    'providerRoute',
    'providerParams',
    'executorParams',
    'inputLeaseRef',
    'actionAdapterRef',
    'liveSurfaceRef',
    'frameStreamRef',
    'sessionRef',
  ]) {
    assert.ok(image.rejectedPayloadFields?.includes(field), `Image rejects ${field}`);
  }
  assert.ok(image.redactionHints.includes('no-raw-screenshot-bytes'));
  assert.ok(image.redactionHints.includes('no-provider-payloads'));
  assert.ok(image.redactionHints.includes('no-gui-computer-use-execution'));
  assert.equal(image.allowedActions.includes('open-external'), true);
  assert.equal(image.allowedActions.includes('copy-path'), true);
});

test('legacy screen pane route inputs resolve to Image Evidence without exposing a Screen contract', () => {
  assert.equal(resultPaneContractForTab('screen').pane, 'image');
  assert.equal(focusResultPaneRouteForObjectReference({
    id: 'legacy-screen-ref',
    kind: 'artifact',
    title: 'Legacy screen frame',
    ref: 'screen:run/frame.png',
  }).pane, 'image');
  assert.equal(focusResultPaneRouteForObjectReference({
    id: 'legacy-preferred-view',
    kind: 'artifact',
    title: 'Legacy screen preferred view',
    ref: 'artifact:legacy-screen',
    preferredView: 'screen-observation',
  }).pane, 'image');
  assert.equal(focusResultPaneRouteForObjectReference({
    id: 'legacy-screen-artifact',
    kind: 'artifact',
    title: 'Legacy screen artifact',
    ref: 'artifact:legacy-screen',
    artifactType: 'computer-use-virtual-screen',
  }).pane, 'image');
});

test('browser result pane declares BrowserHostSession refs-first evidence contract', () => {
  const browser = resultPaneContractForTab('browser');

  assert.ok(browser.refPrefixes.includes('browser-host-session:'));
  for (const field of ['liveSurfaceRef', 'frameStreamRef', 'frameRef', 'screenshotRef', 'domSnapshotRef', 'axSnapshotRef', 'consoleLogRef', 'networkLogRef', 'searchResultRef']) {
    assert.ok(browser.acceptedPayloadRefs?.includes(field), `Browser accepts ${field}`);
  }
  for (const field of [
    'frameUrl',
    'framePreviewUrl',
    'frameRenderer',
    'frameTransport',
    'liveTransportHandoff',
    'rawFrame',
    'frameData',
    'frameBase64',
    'screenshotBase64',
    'rawDom',
    'domHtml',
    'proxyUrl',
    'webviewTag',
    'webrtcCandidate',
  ]) {
    assert.ok(browser.rejectedPayloadFields?.includes(field), `Browser rejects ${field}`);
  }
  assert.ok(browser.redactionHints.includes('native-only-live-surface'));
  assert.ok(browser.redactionHints.includes('no-full-dom'));
  assert.ok(browser.redactionHints.includes('no-auth-headers'));
});

test('result pane route helper maps preferred view, ref prefix, and object kind to shell tabs', () => {
  const cases: Array<[string, Partial<ObjectReference>, string, string]> = [
    ['primary artifact', { kind: 'artifact', ref: 'artifact:report-1' }, 'primary', 'ref-prefix'],
    ['browser url', { kind: 'url', ref: 'https://example.test/paper' }, 'browser', 'ref-prefix'],
    ['screen ref', { kind: 'artifact', ref: 'screen:attempt:before' }, 'image', 'ref-prefix'],
    ['annotation ref', { kind: 'artifact', ref: 'annotation:attempt:crop' }, 'image', 'ref-prefix'],
    ['image ref', { kind: 'artifact', ref: 'image:attempt:before.png' }, 'image', 'ref-prefix'],
    ['terminal execution', { kind: 'execution-unit', ref: 'execution-unit:EU-1' }, 'terminal', 'ref-prefix'],
    ['workspace file', { kind: 'file', ref: 'file:.sciforge/artifacts/report.md' }, 'files', 'ref-prefix'],
    ['workspace diff preferred view', { kind: 'file', ref: 'file:patches/update.diff', preferredView: 'workspace-diff-viewer' }, 'files', 'preferred-view'],
    ['run evidence', { kind: 'run', ref: 'run:latest' }, 'evidence', 'ref-prefix'],
    ['subagent evidence', { kind: 'run', ref: 'subagent:worker-1' }, 'evidence', 'ref-prefix'],
    ['preferred view override', { kind: 'file', ref: 'file:trace.txt', preferredView: 'terminal-session-viewer' }, 'terminal', 'preferred-view'],
    ['subagent preferred view', { kind: 'run', ref: 'run:worker-1', preferredView: 'subagent-result' }, 'evidence', 'preferred-view'],
    ['screen artifact type', { kind: 'artifact', ref: 'artifact:screen-run', artifactType: 'computer-use-virtual-screen' }, 'image', 'artifact-type'],
    ['computer-use control plane artifact type', { kind: 'artifact', ref: 'artifact:control-plane', artifactType: 'computer-use-control-plane' }, 'primary', 'ref-prefix'],
    ['computer-use control plane preferred view', { kind: 'artifact', ref: 'artifact:control-plane', artifactType: 'computer-use-control-plane', preferredView: 'computer-use-control-plane' }, 'primary', 'ref-prefix'],
    ['browser artifact type', { kind: 'artifact', ref: 'artifact:browser-run', artifactType: 'browser-runtime-snapshot' }, 'browser', 'artifact-type'],
    ['terminal artifact type', { kind: 'artifact', ref: 'artifact:terminal-run', artifactType: 'terminal-transcript' }, 'terminal', 'artifact-type'],
  ];

  for (const [name, reference, pane, reason] of cases) {
    const route = resolveResultPaneRoute(reference);
    assert.equal(route.pane, pane, name);
    assert.equal(route.reason, reason, name);
    assert.equal(route.composerInsertion, false, name);
  }

  const focusRoute = focusResultPaneRouteForObjectReference({ kind: 'file', ref: 'file:result.csv' });
  const openRoute = openResultPaneRouteForObjectReference({ kind: 'file', ref: 'file:result.csv' });
  assert.equal(focusRoute.purpose, 'focus');
  assert.equal(openRoute.purpose, 'open');
  assert.equal(openRoute.composerInsertion, false);
});

test('unknown result objects resolve to typed unsupported state without raw payload leakage', () => {
  const state = resolveResultPaneObjectState({
    id: 'opaque-object',
    title: 'opaque unsupported result',
    kind: 'model-private-output',
    ref: 'mystery:sk-secret-do-not-show',
    preferredView: 'browser-workbench',
    raw: {
      token: 'sk-secret-do-not-show',
      text: 'raw dump should stay private',
    },
  });

  assert.equal(state.state, 'unsupported');
  assert.equal(state.pane, 'browser');
  assert.equal(state.route.objectRef, undefined);
  assert.deepEqual(state.allowedActions, []);
  assert.ok(state.redactionHints.includes('no-raw-dump'));
  assert.ok(state.diagnostics.some((diagnostic) => diagnostic.includes('unsupported')));
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /sk-secret-do-not-show/);
  assert.doesNotMatch(serialized, /raw dump should stay private/);
});

test('known object states use lifecycle status and pane-filtered actions', () => {
  const reference: ObjectReference = {
    id: 'blocked-file',
    title: 'blocked output',
    kind: 'file',
    ref: 'file:.sciforge/artifacts/output.csv',
    status: 'blocked',
    actions: ['focus-right-pane', 'inspect', 'copy-path', 'open-external', 'pin'],
  };

  const state = resolveResultPaneObjectState(reference);
  assert.equal(state.state, 'blocked');
  assert.equal(state.pane, 'files');
  assert.equal(state.route.reason, 'ref-prefix');
  const allowedActions = [...state.allowedActions];
  assert.ok(allowedActions.includes('focus-right-pane'));
  assert.ok(allowedActions.includes('copy-path'));
  assert.equal(allowedActions.includes('inspect'), false);

  const terminalActions = allowedActionsForResultPaneObject({
    actions: ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
  }, 'terminal');
  assert.deepEqual(terminalActions, ['focus-right-pane', 'copy-path', 'pin']);
});

test('terminal and references contracts separate terminal sessions from provenance refs', () => {
  const terminal = resultPaneContractForTab('terminal');
  assert.ok(terminal.refPrefixes.includes('terminal-session:'));
  assert.ok(terminal.refPrefixes.includes('terminal-transcript:'));
  assert.ok(terminal.refPrefixes.includes('pty-transcript:'));
  assert.equal(terminal.refPrefixes.includes('trace:'), false);
  assert.equal(terminal.refPrefixes.includes('log:'), false);

  const references = resultPaneContractForTab('evidence');
  for (const kind of ['file', 'folder', 'execution-unit'] as const) {
    assert.ok(references.objectKinds.includes(kind), `References inspector accepts ${kind}`);
  }
  assert.ok(references.refPrefixes.includes('file:'));
  assert.ok(references.refPrefixes.includes('execution-unit:'));
  assert.ok(references.refPrefixes.includes('subagent:'));
  assert.ok(references.refPrefixes.includes('agent-result:'));
});

test('object focus/open routes cover chat, process, references, and tool panes without composer insertion', () => {
  const routeCases: Array<[string, Partial<ObjectReference>, string]> = [
    ['chat citation reference', { kind: 'run', ref: 'citation:paper-1', title: 'Paper citation' }, 'evidence'],
    ['process file action', { kind: 'file', ref: 'file:src/ui/src/app/ResultsRenderer.tsx', title: 'Edited file' }, 'files'],
    ['process browser action', { kind: 'url', ref: 'https://example.test/result', title: 'Opened page' }, 'browser'],
    ['process terminal action', { kind: 'execution-unit', ref: 'terminal-transcript:right-pane', title: 'Terminal transcript' }, 'terminal'],
    ['references inspector object', { kind: 'run', ref: 'subagent:reviewer', title: 'Subagent review' }, 'evidence'],
    ['browser host object', { kind: 'url', ref: 'browser-host-session:session-1', title: 'Host session' }, 'browser'],
    ['screen replay object', { kind: 'artifact', ref: 'replay:computer-use-run', title: 'Screen replay' }, 'image'],
  ];

  for (const [label, reference, pane] of routeCases) {
    const focusRoute = focusResultPaneRouteForObjectReference(reference);
    const openRoute = openResultPaneRouteForObjectReference(reference);
    assert.equal(focusRoute.pane, pane, label);
    assert.equal(openRoute.pane, pane, label);
    assert.equal(focusRoute.composerInsertion, false, label);
    assert.equal(openRoute.composerInsertion, false, label);
  }
});
