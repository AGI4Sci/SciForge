import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID,
  assertDeepSeekTransparency,
  assertFailedRunAuditBundleRefs,
  assertProviderOutageRecovery,
  assertProviderSecurityBudgetAuditFixture,
  assertRawStreamsAndSecretsAreScrubbed,
  createProviderSecurityBudgetAuditFixture,
} from './provider-security-budget-audit-fixture.js';

test('SA-WEB-38 covers provider/security budget, scrub, audit export, and outage recovery as an offline fixture', () => {
  const fixture = createProviderSecurityBudgetAuditFixture();

  assert.equal(fixture.caseId, PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID);
  assertProviderSecurityBudgetAuditFixture(fixture);
});

test('SA-WEB-38 keeps each provider/security requirement independently assertable', () => {
  const fixture = createProviderSecurityBudgetAuditFixture();

  assertDeepSeekTransparency(fixture);
  assertRawStreamsAndSecretsAreScrubbed(fixture);
  assertFailedRunAuditBundleRefs(fixture);
  assertProviderOutageRecovery(fixture);
});
