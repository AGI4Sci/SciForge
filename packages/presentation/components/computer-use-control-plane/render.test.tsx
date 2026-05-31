import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  computerUseControlPlaneCommand,
  computerUseControlPlaneConfirmationResult,
  normalizeComputerUseControlPlanePayload,
} from './contract';
import { renderComputerUseControlPlane } from './render';
import { basicComputerUseControlPlaneFixture } from './fixtures/basic';
import { emptyComputerUseControlPlaneFixture } from './fixtures/empty';
import { selectionComputerUseControlPlaneFixture } from './fixtures/selection';

function htmlFor(fixture = basicComputerUseControlPlaneFixture) {
  return renderToStaticMarkup(renderComputerUseControlPlane(fixture));
}

function forbiddenPaths(value: unknown, forbidden: string[], path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPaths(item, forbidden, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbidden.includes(key) ? [current] : [];
    return [...hit, ...forbiddenPaths(entry, forbidden, current)];
  });
}

test('computer-use control plane renders refs, status, and presentation-only boundary', () => {
  const html = htmlFor();

  assert.match(html, /computer-use-control-plane/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-status="needs-confirmation"/);
  assert.match(html, /data-approval-mode="required"/);
  assert.match(html, /computer-use:permission\/basic-session\.json/);
  assert.match(html, /computer-use:allowlist\/apps\/presentation\.json/);
  assert.match(html, /computer-use:risk\/basic-preview\.json/);
  assert.match(html, /data-event="computer-use-terminal-equivalent-text"/);
  assert.match(html, /data-event="computer-use-confirmation-result"/);
  assert.match(html, /\/computer-use stop --stop-ref/);
  assert.match(html, /\/computer-use cancel --cancel-lease-ref/);
  assert.match(html, /\/computer-use approve --approval-ref/);
});

test('computer-use control plane shows empty state without fabricating controls', () => {
  const html = htmlFor(emptyComputerUseControlPlaneFixture);

  assert.match(html, /data-status="empty"/);
  assert.match(html, /Computer Use control refs are not attached/);
  assert.doesNotMatch(html, /data-command-text="\/computer-use/);
});

test('computer-use control plane supports running stop and cancel without confirmation buttons', () => {
  const html = htmlFor(selectionComputerUseControlPlaneFixture);

  assert.match(html, /data-status="running"/);
  assert.match(html, /data-approval-mode="not-required"/);
  assert.match(html, /\/computer-use stop --stop-ref/);
  assert.match(html, /\/computer-use cancel --cancel-lease-ref/);
  assert.doesNotMatch(html, /data-confirmation-decision="approved"/);
});

test('computer-use control plane normalizer keeps only public presentation fields', () => {
  const payload = normalizeComputerUseControlPlanePayload({
    sessionPermissionRef: 'computer-use:permission/private-test.json',
    allowedAppRefs: ['computer-use:allowlist/apps/test.json'],
    riskPreviewRef: 'computer-use:risk/test.json',
    dataVisibilityRef: 'computer-use:data-visibility/test.json',
    stopRef: 'computer-use:stop/test',
    cancelLeaseRef: 'computer-use:lease/test',
    approvalMode: 'required',
    status: 'needs-confirmation',
    approvalRef: 'approval:computer-use:test',
    providerRoute: 'SHOULD_NOT_LEAK',
    executorLease: { screenId: 'SHOULD_NOT_LEAK' },
    schedulerParams: { leaseScope: 'SHOULD_NOT_LEAK' },
    desktopBridgePolicy: { allowSharedSystemInput: true },
    x: 12,
    y: 42,
  });

  assert.ok(payload);
  assert.equal(payload.sessionPermissionRef, 'computer-use:permission/private-test.json');
  assert.deepEqual(forbiddenPaths(payload, [
    'providerRoute',
    'executorLease',
    'schedulerParams',
    'desktopBridgePolicy',
    'screenId',
    'leaseScope',
    'allowSharedSystemInput',
    'x',
    'y',
  ]), []);
});

test('computer-use control plane actions return terminal text or confirmation result only', () => {
  const payload = normalizeComputerUseControlPlanePayload({
    sessionPermissionRef: 'computer-use:permission/action-test.json',
    stopRef: 'computer-use:stop/action-test',
    cancelLeaseRef: 'computer-use:lease/action-test',
    approvalRef: 'approval:computer-use:action-test',
    approvalRequestRef: 'computer-use:approval/action-test.json',
    riskPreviewRef: 'computer-use:risk/action-test.json',
    dataVisibilityRef: 'computer-use:data-visibility/action-test.json',
    approvalMode: 'required',
    status: 'needs-confirmation',
  });
  assert.ok(payload);

  const stop = computerUseControlPlaneCommand(payload, 'stop');
  const cancel = computerUseControlPlaneCommand(payload, 'cancel-lease');
  const approved = computerUseControlPlaneConfirmationResult(payload, 'approved');
  const rejected = computerUseControlPlaneConfirmationResult(payload, 'rejected');

  assert.equal(stop?.commandText, '/computer-use stop --stop-ref "computer-use:stop/action-test"');
  assert.equal(cancel?.commandText, '/computer-use cancel --cancel-lease-ref "computer-use:lease/action-test"');
  assert.equal(approved.commandText, '/computer-use approve --approval-ref "approval:computer-use:action-test"');
  assert.equal(rejected.commandText, '/computer-use reject --approval-ref "approval:computer-use:action-test"');
  for (const event of [stop, cancel, approved, rejected]) {
    assert.deepEqual(forbiddenPaths(event, ['provider', 'providerRoute', 'executor', 'executorLease', 'scheduler', 'schedulerParams', 'desktopBridgePolicy']), []);
  }
});

test('computer-use control plane renderer imports no Computer Use executor modules', () => {
  const renderSource = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');
  const contractSource = readFileSync(new URL('./contract.ts', import.meta.url), 'utf8');
  const combined = `${renderSource}\n${contractSource}`;

  assert.doesNotMatch(combined, /packages\/actions\/computer-use|observe\/vision|src\/runtime\/computer-use|executeScoped|runComputerUse|desktopBridge|scheduler|providerRoute/);
});
