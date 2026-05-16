import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertWebE2eContract } from '../contract-verifier.js';
import { buildFailedRunRepairCase, type FailedRunRepairFailureMode } from './failed-run-repair.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-04-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

for (const failureMode of ['provider-unavailable', 'schema-validation'] as const satisfies readonly FailedRunRepairFailureMode[]) {
  test(`SA-WEB-04 failed run repair explains ${failureMode}, circuit-breaks auto repair, and continues from refs`, async () => {
    const result = await buildFailedRunRepairCase({ baseDir, failureMode });

    try {
      assertWebE2eContract(result.verifierInput);

      assert.equal(result.repairPolicy.action, 'fail-closed', 'RepairPolicy must circuit-break automatic rerun');
      assert.equal(result.validation.findings[0]?.severity, 'blocking');
      assert.equal(result.audit.repairDecisionId, result.repairPolicy.decisionId);

      assert.match(result.failureSignature.id, /^failure:sa-web-04-/);
      assert.equal(result.failureSignature.refs.includes(result.fixture.expectedProjection.providerManifestRef), true);
      assert.ok(
        result.fixture.expectedProjection.conversationProjection.diagnostics.some((diagnostic) => diagnostic.code.includes(failureMode.split('-')[0])),
        'Projection diagnostics must retain the normalized failure class',
      );
      assert.ok(
        result.fixture.expectedProjection.conversationProjection.auditRefs.includes(result.failureSignature.id),
        'Projection audit refs must include failureSignature',
      );

      assert.deepEqual(
        result.browserVisibleState.recoverActions,
        result.recoverActions,
        'browser-visible repair actions must come from Projection',
      );
      assert.ok(
        result.recoverActions.some((action) => /Explain|解释/i.test(action)),
        'recoverActions must tell the user to explain the failure first',
      );
      assert.ok(
        result.recoverActions.some((action) => /Do not rerun|不重跑/i.test(action)),
        'recoverActions must forbid rerunning unrelated completed steps',
      );
      assert.ok(
        result.recoverActions.some((action) => /Continue repair|继续修复/i.test(action)),
        'recoverActions must preserve a continuation path',
      );

      assert.ok(
        result.runAudit.refs.includes(result.failureSignature.id),
        'RunAudit evidence must include the failureSignature ref',
      );
      assert.ok(
        result.runAudit.refs.includes(result.audit.auditId),
        'RunAudit evidence must include the validation/repair audit ref',
      );
      assert.ok(
        result.runAudit.refs.includes(result.fixture.expectedProjection.providerManifestRef),
        'RunAudit evidence must include provider manifest refs',
      );

      assert.equal(result.server.requests.runs.length, 2, 'case should make one failing run and one explicit repair continuation');
      const repairRequest = result.server.requests.runs[1]?.body;
      assert.equal(repairRequest?.prompt, '解释失败，不重跑无关步骤，再继续修复。');
      assert.equal(repairRequest?.skipUnrelatedCompletedSteps, true);
      assert.equal(repairRequest?.failureSignature, result.failureSignature.id);
      assert.deepEqual(repairRequest?.preserveRefs, result.failureSignature.refs);
    } finally {
      await result.server.close();
    }
  });
}
