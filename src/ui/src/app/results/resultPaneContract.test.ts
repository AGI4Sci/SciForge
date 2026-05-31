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

test('result pane route helper maps preferred view, ref prefix, and object kind to shell tabs', () => {
  const cases: Array<[string, Partial<ObjectReference>, string, string]> = [
    ['primary artifact', { kind: 'artifact', ref: 'artifact:report-1' }, 'primary', 'ref-prefix'],
    ['browser url', { kind: 'url', ref: 'https://example.test/paper' }, 'browser', 'ref-prefix'],
    ['screen ref', { kind: 'artifact', ref: 'screen:attempt:before' }, 'screen', 'ref-prefix'],
    ['terminal execution', { kind: 'execution-unit', ref: 'execution-unit:EU-1' }, 'terminal', 'ref-prefix'],
    ['workspace file', { kind: 'file', ref: 'file:.sciforge/artifacts/report.md' }, 'files', 'ref-prefix'],
    ['run evidence', { kind: 'run', ref: 'run:latest' }, 'evidence', 'ref-prefix'],
    ['preferred view override', { kind: 'file', ref: 'file:trace.txt', preferredView: 'terminal-session-viewer' }, 'terminal', 'preferred-view'],
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
