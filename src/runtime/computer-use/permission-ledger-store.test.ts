import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createComputerUsePermissionLedgerStore } from './permission-ledger-store.js';

test('permission ledger materializes turn-scoped permission for low-risk High Autonomy with bounded runtime refs', () => {
  const ledger = createComputerUsePermissionLedgerStore({ now: () => '2026-06-06T00:00:00.000Z' });
  const evidenceRefs = [
    ...Array.from({ length: 18 }, (_, index) => `evidence:low-risk-${index}`),
    'fixture:low-risk-replay',
    'replay:low-risk-replay',
    'https://example.com/raw-page',
    'data:image/png;base64,AAAA',
    'audit:api-token-should-not-pass',
  ];

  const result = ledger.requestTurnPermission({
    turnId: 'turn-low',
    actionId: 'click-settings',
    authorizationProfileId: 'high-autonomy',
    risk: {
      decision: 'auto',
      level: 'low',
      category: 'ordinary-navigation',
      hardConfirm: false,
    },
    evidenceRefs,
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(result.approvalState, 'not-required');
  assert.equal(result.permissionRef, 'permission:turn/turn-low/computer-use/click-settings');
  assert.equal(result.approvalRequestRef, undefined);
  assert.equal(result.approvalRef, undefined);
  assert.equal(result.evidenceRefs.length, 16);
  assert.deepEqual(result.evidenceRefs, evidenceRefs.slice(0, 16));
  assert.equal(ledger.getByPermissionRef('permission:turn/turn-low/computer-use/click-settings')?.status, 'confirmed');
  assert.doesNotMatch(JSON.stringify(result), /fixture|replay|https:\/\/|data:image|api-token/i);
});

test('permission ledger records hard-confirm actions as pending without confirmed permission', () => {
  const ledger = createComputerUsePermissionLedgerStore({ now: () => '2026-06-06T00:01:00.000Z' });

  const result = ledger.requestTurnPermission({
    turnId: 'turn-payment',
    actionId: 'submit-payment',
    authorizationProfileId: 'high-autonomy',
    risk: {
      decision: 'needs-confirmation',
      level: 'high',
      category: 'payments-transfers-purchases',
      hardConfirm: true,
    },
    evidenceRefs: ['browser-host-session:pay-session/observation/latest'],
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.approvalState, 'needs-confirmation');
  assert.equal(result.permissionRef, undefined);
  assert.equal(result.approvalRequestRef, 'approval-request:computer-use/turn-payment/submit-payment');
  assert.equal(result.approvalRef, 'approval:computer-use/turn-payment/submit-payment');
  assert.equal(
    ledger.getByApprovalRequestRef('approval-request:computer-use/turn-payment/submit-payment')?.status,
    'pending',
  );
});

test('permission ledger confirms hard-confirm action only from runtime-owned approval refs', () => {
  const ledger = createComputerUsePermissionLedgerStore({ now: () => '2026-06-06T00:02:00.000Z' });
  const pending = ledger.requestTurnPermission({
    turnId: 'turn-mail',
    actionId: 'send-draft',
    authorizationProfileId: 'high-autonomy',
    risk: {
      decision: 'needs-confirmation',
      level: 'high',
      category: 'external-communications',
      hardConfirm: true,
    },
    evidenceRefs: ['browser-host-session:mail-session/observation/latest'],
  });

  const result = ledger.requestTurnPermission({
    turnId: 'turn-mail',
    actionId: 'send-draft',
    authorizationProfileId: 'high-autonomy',
    risk: {
      decision: 'needs-confirmation',
      level: 'high',
      category: 'external-communications',
      hardConfirm: true,
    },
    evidenceRefs: ['browser-host-session:mail-session/observation/latest'],
    approval: {
      approvalRef: pending.approvalRef ?? '',
      sourceRefs: [
        pending.approvalRequestRef ?? '',
        'approval:computer-use/turn-mail/send-draft/decision',
        'audit:computer-use/turn-mail/send-draft/approval',
      ],
    },
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(result.approvalState, 'approved');
  assert.equal(result.permissionRef, 'permission:turn/turn-mail/computer-use/send-draft');
  assert.equal(result.approvalRef, 'approval:computer-use/turn-mail/send-draft');
  assert.deepEqual(result.approvalSourceRefs, [
    'approval-request:computer-use/turn-mail/send-draft',
    'approval:computer-use/turn-mail/send-draft/decision',
    'audit:computer-use/turn-mail/send-draft/approval',
  ]);
  assert.equal(ledger.getByPermissionRef('permission:turn/turn-mail/computer-use/send-draft')?.status, 'confirmed');
});

test('permission ledger rejects UI-projected approvals instead of expanding them to permission refs', () => {
  const ledger = createComputerUsePermissionLedgerStore({ now: () => '2026-06-06T00:03:00.000Z' });

  const result = ledger.requestTurnPermission({
    turnId: 'turn-delete',
    actionId: 'delete-remote-file',
    authorizationProfileId: 'high-autonomy',
    risk: {
      decision: 'needs-confirmation',
      level: 'high',
      category: 'remote-delete-overwrite-archive',
      hardConfirm: true,
    },
    evidenceRefs: ['browser-host-session:danger-session/observation/latest'],
    approval: {
      approvalRef: 'approval:computer-use/turn-delete/delete-remote-file',
      sourceRefs: [
        'gui.ask_user:danger-confirmed',
        'ui:confirm-button',
        'fixture:approval-replay',
        'https://example.com/approval',
      ],
    },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.approvalState, 'denied');
  assert.equal(result.permissionRef, undefined);
  assert.deepEqual(result.approvalSourceRefs, []);
  assert.match(result.reason, /runtime-owned approval/i);
  assert.doesNotMatch(JSON.stringify(result), /gui\.ask_user|ui:|fixture|https:\/\//i);
});
