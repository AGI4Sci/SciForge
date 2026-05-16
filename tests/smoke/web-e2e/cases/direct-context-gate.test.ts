import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertWebE2eContract } from '../contract-verifier.js';
import { buildDirectContextGateCase } from './direct-context-gate.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-13-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-13 direct context gate answers current run status only from sufficient structured decision', async () => {
  const result = await buildDirectContextGateCase({ baseDir });

  try {
    assertWebE2eContract(result.directStatus.verifierInput);

    assert.equal(result.directStatus.route, 'direct-context-answer');
    assert.equal(result.directStatus.serverRequests, 0, 'current run status must not call AgentServer when DirectContextDecision is sufficient');
    assert.equal(result.directStatus.decision.sufficiency, 'sufficient');
    assert.equal(result.directStatus.decision.decisionOwner, 'AgentServer');
    assert.ok(result.directStatus.decision.requiredTypedContext.includes('run-status'));
    assert.ok(result.directStatus.decision.usedRefs.includes(result.directStatus.fixture.expectedProjection.runAuditRefs.find((ref) => ref === 'artifact:fixture-run-audit') ?? ''));
    assert.ok(result.directStatus.directPayload, 'sufficient current-run status should produce direct-context payload');
    assert.equal(result.directStatus.directPayload?.executionUnits[0]?.tool, 'sciforge.direct-context-fast-path');
    assert.match(
      String(result.directStatus.directPayload?.executionUnits[0]?.params ?? ''),
      /directContextGate/,
      'direct payload must retain gate audit in execution params',
    );
    const directGate = directContextGateAudit(result.directStatus.directPayload?.executionUnits[0]?.params);
    assert.equal(directGate.intent, 'run-diagnostic');
    assert.equal(directGate.sufficiency, 'sufficient');
    assert.deepEqual(directGate.requiredContext, ['run-status', 'visible-answer', 'run-audit-ref']);
    assert.ok(directGate.usedContextRefs.includes('artifact:fixture-current-report'));
    assert.match(
      result.directStatus.fixture.expectedProjection.conversationProjection.visibleAnswer?.text ?? '',
      /DirectContextDecision decision:sa-web-13-run-status/,
    );

    for (const routed of result.routed) {
      assertWebE2eContract(routed.verifierInput);
    }
  } finally {
    await result.server.close();
  }
});

test('SA-WEB-13 routes generation, repair, and insufficient tool status decisions to AgentServer', async () => {
  const result = await buildDirectContextGateCase({ baseDir });

  try {
    assert.equal(result.routed.length, 3);
    assert.equal(result.server.requests.runs.length, 3, 'only insufficient branches should call AgentServer');

    for (const routed of result.routed) {
      assertWebE2eContract(routed.verifierInput);

      assert.equal(routed.route, 'route-to-agentserver');
      assert.equal(routed.directPayload, undefined, `${routed.scenario} must not be answered by direct-context fast path`);
      assert.ok(routed.agentServerRun, `${routed.scenario} must have a scriptable AgentServer mock run`);
      assert.equal(routed.decision.sufficiency, 'insufficient');
      assert.equal(routed.decision.allowDirectContext, false);
      assert.ok(routed.decision.decisionRef.startsWith('decision:sa-web-13-'));
      assert.ok(routed.decision.requiredTypedContext.length > 0);
      assert.ok(routed.runAudit.refs.includes(routed.decision.decisionRef));
      assert.match(
        routed.fixture.expectedProjection.conversationProjection.visibleAnswer?.text ?? '',
        /Routed to AgentServer/,
      );
      assert.ok(
        routed.agentServerRun.events.some((event) => event.type === 'status' && event.status === 'route-to-agentserver'),
        `${routed.scenario} mock stream must expose route-to-agentserver status`,
      );
    }

    const routedScenarios = result.server.requests.runs.map((request) => request.body.scenario);
    assert.deepEqual(routedScenarios, ['generation', 'repair', 'tool-status-insufficient']);
    for (const request of result.server.requests.runs) {
      const decision = request.body.directContextDecision;
      assert.equal(typeof decision, 'object');
      assert.equal((decision as { sufficiency?: unknown }).sufficiency, 'insufficient');
      assert.equal((decision as { route?: unknown }).route, 'route-to-agentserver');
      assert.equal((decision as { allowDirectContext?: unknown }).allowDirectContext, false);
    }
  } finally {
    await result.server.close();
  }
});

function directContextGateAudit(params: unknown): {
  intent?: unknown;
  requiredContext?: unknown;
  usedContextRefs: string[];
  sufficiency?: unknown;
} {
  assert.equal(typeof params, 'string');
  if (typeof params !== 'string') throw new Error('direct context params must be a JSON string');
  const parsed = JSON.parse(params) as { directContextGate?: unknown };
  assert.ok(parsed.directContextGate && typeof parsed.directContextGate === 'object');
  const gate = parsed.directContextGate as { usedContextRefs?: unknown };
  assert.ok(Array.isArray(gate.usedContextRefs));
  return {
    ...gate,
    usedContextRefs: gate.usedContextRefs.filter((ref): ref is string => typeof ref === 'string'),
  };
}
