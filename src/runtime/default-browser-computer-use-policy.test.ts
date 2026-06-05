import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTONOMY_PROFILE_IDS,
  capabilityAnswerProjection,
  classifyComputerUseRisk,
  defaultAuthorizationProfile,
  evaluateBrowserEvidenceNeed,
  evaluateComputerUsePreflight,
} from '../../packages/contracts/runtime/default-browser-computer-use-policy.js';

test('default authorization profile is High Autonomy with immutable hard-confirm categories', () => {
  const profile = defaultAuthorizationProfile();

  assert.equal(profile.id, 'high-autonomy');
  assert.deepEqual(AUTONOMY_PROFILE_IDS, ['assisted-autonomy', 'high-autonomy', 'research-sandbox-max']);
  assert.equal(profile.scope.user, 'current-user');
  assert.equal(profile.scope.workspace, 'current-workspace');
  assert.ok(profile.hardConfirmCategories.includes('payments-transfers-purchases'));
  assert.ok(profile.hardConfirmCategories.includes('external-communications'));
  assert.ok(profile.hardConfirmCategories.includes('external-system-execution'));
});

test('browser evidence decision defaults external current citation requests to search and honors no-network', () => {
  assert.deepEqual(evaluateBrowserEvidenceNeed({
    prompt: 'What is the current Python release? Please cite source URLs.',
  }), {
    decision: 'search',
    reason: 'current-external-or-citation-request',
    query: 'What is the current Python release? Please cite source URLs.',
  });

  assert.deepEqual(evaluateBrowserEvidenceNeed({
    prompt: 'Open https://example.com/docs and summarize it with references.',
  }), {
    decision: 'search',
    reason: 'url-or-browser-ref-request',
    query: 'https://example.com/docs',
  });

  assert.equal(evaluateBrowserEvidenceNeed({
    prompt: 'Do not use the internet. Summarize the current Python release from local notes only.',
  }).decision, 'skip');
});

test('computer use risk classifier separates auto, hard-confirm, and blocked categories', () => {
  assert.deepEqual(classifyComputerUseRisk({
    action: 'scroll the current web page and read the visible results',
    authorizationProfile: defaultAuthorizationProfile(),
  }), {
    decision: 'auto',
    category: 'ordinary-navigation',
    hardConfirm: false,
    reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
  });

  assert.deepEqual(classifyComputerUseRisk({
    action: 'send this email to the external collaborator',
    authorizationProfile: defaultAuthorizationProfile(),
  }), {
    decision: 'needs-confirmation',
    category: 'external-communications',
    hardConfirm: true,
    reason: 'external communications require hard confirmation',
  });

  assert.deepEqual(classifyComputerUseRisk({
    action: 'bypass the captcha and create many accounts',
    authorizationProfile: defaultAuthorizationProfile(),
  }), {
    decision: 'blocked',
    category: 'security-boundary-bypass',
    hardConfirm: false,
    reason: 'security, access-control, or platform-abuse bypass is blocked by default',
  });
});

test('computer use preflight fails closed for missing readiness and returns hard-confirm projection', () => {
  const ready = evaluateComputerUsePreflight({
    intent: 'scroll the page',
    target: { bound: true, summary: 'BrowserHostSession tab', refs: ['browser-host-session:ready'] },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    observation: { fresh: true, refs: ['browser-host-session:ready/frame.png'] },
    permissions: { refs: ['permission:turn/low-risk'], stopCancelPath: true },
    authorizationProfile: defaultAuthorizationProfile(),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.risk.decision, 'auto');

  const blocked = evaluateComputerUsePreflight({
    intent: 'click the visible button',
    target: { bound: true, summary: 'BrowserHostSession tab', refs: ['browser-host-session:blocked'] },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'blocked',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    observation: { fresh: true, refs: ['browser-host-session:blocked/frame.png'] },
    permissions: { refs: ['permission:turn/low-risk'], stopCancelPath: true },
    authorizationProfile: defaultAuthorizationProfile(),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.blockers[0]?.reason, 'native-surface-unavailable');
  assert.match(blocked.blockers[0]?.recovery ?? '', /Desktop native/i);

  const confirm = evaluateComputerUsePreflight({
    intent: 'submit the registration form',
    target: { bound: true, summary: 'Registration form', refs: ['browser-host-session:form'] },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    observation: { fresh: true, refs: ['browser-host-session:form/frame.png'] },
    permissions: { refs: ['permission:turn/form-draft'], stopCancelPath: true },
    authorizationProfile: defaultAuthorizationProfile(),
  });
  assert.equal(confirm.status, 'needs-confirmation');
  assert.equal(confirm.confirmation?.action, 'submit the registration form');
  assert.equal(confirm.confirmation?.target, 'Registration form');
  assert.equal(confirm.confirmation?.authorizationProfile.id, 'high-autonomy');
  assert.deepEqual(confirm.confirmation?.evidenceRefs, ['browser-host-session:form/frame.png', 'permission:turn/form-draft']);
});

test('capability answer projection is grounded in product support plus runtime readiness', () => {
  const projection = capabilityAnswerProjection({
    capability: 'computer-use',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'blocked',
      nativeSurface: 'blocked',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    refs: ['runtime-health:computer-use'],
  });

  assert.equal(projection.productCapability, 'supported');
  assert.equal(projection.runtimeReadiness, 'blocked');
  assert.deepEqual(projection.blockers, ['native-bridge-unavailable', 'native-surface-unavailable']);
  assert.match(projection.nextAction, /Desktop native/i);
  assert.doesNotMatch(projection.answerSummary, /没有直接|no direct computer use/i);
});
