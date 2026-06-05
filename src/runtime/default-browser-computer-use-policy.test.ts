import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTONOMY_PROFILE_IDS,
  authorizationProfileOrDefault,
  capabilityAnswerProjection,
  classifyComputerUseRisk,
  defaultAuthorizationProfile,
  defaultGuiOperationIntent,
  evaluateBrowserEvidenceNeed,
  evaluateComputerUsePreflight,
  hasCurrentRunComputerUseCompletionEvidenceRefs,
  requiresComputerUseProductCompletionEvidence,
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

test('authorization profile normalization preserves declared profile and labels invalid fallback', () => {
  const declared = authorizationProfileOrDefault('research-sandbox-max');
  assert.equal(declared.profile.id, 'research-sandbox-max');
  assert.equal(declared.source, 'declared');

  const fallback = authorizationProfileOrDefault('private-provider-max');
  assert.equal(fallback.profile.id, 'high-autonomy');
  assert.equal(fallback.source, 'declared-invalid-profile');

  const empty = authorizationProfileOrDefault(undefined);
  assert.equal(empty.profile.id, 'high-autonomy');
  assert.equal(empty.source, 'default');
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

test('gui operation intent keeps hard-confirm actions out of browser evidence routing', () => {
  assert.equal(defaultGuiOperationIntent({
    prompt: 'Send this email to the external collaborator.',
  }), true);
  assert.equal(defaultGuiOperationIntent({
    prompt: 'What is the current Python release? Please cite source URLs.',
  }), false);
  assert.equal(defaultGuiOperationIntent({
    prompt: 'Open https://example.com/docs and summarize it with references.',
  }), false);
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

test('computer use risk classifier keeps High Autonomy behind every hard-confirm category', () => {
  const cases = [
    ['pay the invoice', 'payments-transfers-purchases'],
    ['send this email to the collaborator', 'external-communications'],
    ['submit the external registration form', 'external-system-submission'],
    ['delete the remote project file', 'remote-delete-overwrite-archive'],
    ['upload this report to the portal', 'external-upload'],
    ['change the account security token', 'account-security-privacy-billing'],
    ['sign the legal contract', 'legal-compliance-contracts'],
    ['deploy this release to the external production system', 'external-system-execution'],
  ] as const;

  for (const [action, category] of cases) {
    const risk = classifyComputerUseRisk({
      action,
      authorizationProfile: defaultAuthorizationProfile(),
    });
    assert.equal(risk.decision, 'needs-confirmation');
    assert.equal(risk.category, category);
    assert.equal(risk.hardConfirm, true);
    assert.equal(typeof risk.reason, 'string');
    assert.notEqual(risk.reason.length, 0);
  }
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

test('computer use preflight reports every required fail-closed blocker', () => {
  const blocked = evaluateComputerUsePreflight({
    intent: 'click the visible button',
    target: { bound: false, summary: 'Unbound target', refs: [] },
    readiness: {
      browserHostSession: 'blocked',
      nativeBridge: 'blocked',
      nativeSurface: 'blocked',
      windowActionSession: 'blocked',
      computerUseAdapter: 'blocked',
    },
    observation: { fresh: false, refs: [] },
    permissions: { refs: [], stopCancelPath: false },
    authorizationProfile: defaultAuthorizationProfile(),
  });

  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.blockers.map((item) => item.reason), [
    'browser-host-session-unavailable',
    'native-bridge-unavailable',
    'native-surface-unavailable',
    'window-action-session-unavailable',
    'computer-use-adapter-unavailable',
    'target-unbound',
    'needs-observation',
    'permission-missing',
    'cancel-path-missing',
  ]);
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

test('computer use product completion evidence policy separates action completion from workflow completion', () => {
  assert.equal(requiresComputerUseProductCompletionEvidence({
    commandText: 'Scroll the current browser page.',
    message: 'Computer Use action executed.',
    claimType: 'runtime-action',
  }), false);

  assert.equal(requiresComputerUseProductCompletionEvidence({
    commandText: 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.',
    message: 'Workflow completed successfully.',
    claimType: 'product-workflow-completion',
    claimTexts: ['The workflow is complete.'],
  }), true);

  assert.equal(requiresComputerUseProductCompletionEvidence({
    commandText: '点击编辑窗口，输入摘要，保存报告，打开预览窗口，并标记工作流完成。',
    message: '最终产物已完成。',
    claimTexts: ['报告产物已经保存并预览。'],
  }), true);

  assert.equal(requiresComputerUseProductCompletionEvidence({
    commandText: 'Open the editor, write the final artifact report, save the file, preview it, and complete the artifact workflow.',
    message: 'Final artifact produced.',
    claimTexts: ['The final report artifact is saved and previewed.'],
  }), true);

  const runDir = '.sciforge/vision-runs/product-completion-policy';
  assert.equal(hasCurrentRunComputerUseCompletionEvidenceRefs([
    'action-ledger:browser-host-session/visible/type-1',
  ]), false);
  assert.equal(hasCurrentRunComputerUseCompletionEvidenceRefs([
    `${runDir}/current-run.json`,
    `${runDir}/cu-user-acceptance-manifest.json`,
    `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
  ]), true);
  assert.equal(hasCurrentRunComputerUseCompletionEvidenceRefs([
    `${runDir}/current-run.json`,
    `${runDir}/cu-user-acceptance-manifest.json`,
    '.sciforge/vision-runs/other-run/isolated-desktop-l3-workflow-evidence.json',
  ]), false);
  assert.equal(hasCurrentRunComputerUseCompletionEvidenceRefs([
    `${runDir}/current-run.json`,
    `${runDir}/cu-user-acceptance-manifest.json`,
    'gui.present:fake-completion',
    'https://example.test/isolated-desktop-l3-workflow-evidence.json',
  ]), false);
});
