import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContractFn, HookFn } from './index';
import {
  classifyFailureOwner,
  contractPass,
  createDeterministicProfileFixture,
  evaluateDeterministicProfileFixture,
  evaluateThinWaist,
  failureOwnerContract,
  failureOwnerRouteHook,
  hookTighten,
  mergeFailureOwnerDecisions,
  stableHarnessDigest,
} from './index';

test('failure owner contract classifies external provider failures without backend repair', () => {
  const decision = classifyFailureOwner({
    statusCode: 429,
    evidenceRefs: ['log:b', 'log:a', 'log:a'],
  });

  assert.equal(decision.owner, 'external-provider');
  assert.equal(decision.nextStep, 'retry-provider');
  assert.equal(decision.retryable, true);
  assert.deepEqual(decision.evidenceRefs, ['log:a', 'log:b']);

  const result = failureOwnerContract({ statusCode: 429, evidenceRefs: ['log:b', 'log:a'] });
  assert.equal(result.kind, 'pass');
  assert.equal(result.ownerDecision?.owner, 'external-provider');
  assert.equal(result.ownerDecision?.nextStep, 'retry-provider');
});

test('failure owner route hook blocks backend code repair for external provider failures', () => {
  const result = failureOwnerContract({
    errorCode: 'timeout',
    evidenceRefs: ['trace:provider-timeout'],
  });
  const route = failureOwnerRouteHook({}, [result]);

  assert.equal(route.kind, 'defer');
  assert.equal(route.decision?.action, 'retry-provider');
  assert.deepEqual(route.requiredRefs, ['trace:provider-timeout']);
  assert.deepEqual(route.blockedCapabilities, ['backend-code-repair']);
});

test('mergeFailureOwnerDecisions deterministically chooses the action-routing owner', () => {
  const external = classifyFailureOwner({ statusCode: 500, evidenceRefs: ['log:provider'] });
  const payload = classifyFailureOwner({ validationFailures: [{ path: 'payload.answer' }], evidenceRefs: ['ref:payload'] });
  const selected = mergeFailureOwnerDecisions([external, payload]);
  const reversed = mergeFailureOwnerDecisions([payload, external]);

  assert.deepEqual(selected, reversed);
  assert.equal(selected?.owner, 'payload-contract');
  assert.equal(selected?.nextStep, 'repair-payload');
});

test('thin waist evaluation applies contract and hook fns with stable trace digest', () => {
  type Input = { value: number };
  type Facts = { tighten: boolean };
  type Decision = { maxToolCalls: number };

  const contract: ContractFn<Input, { doubled: number }> = (input) => contractPass(
    { doubled: input.value * 2 },
    { contractId: 'double-value' },
  );
  const hook: HookFn<Facts, Decision> = (facts) => facts.tighten
    ? hookTighten({ maxToolCalls: 1 }, { hookId: 'tighten-tools' })
    : hookTighten({ maxToolCalls: 2 }, { hookId: 'loose-tools' });

  const first = evaluateThinWaist({
    input: { value: 4 },
    facts: { tighten: true },
    contracts: [contract],
    hooks: [hook],
  });
  const second = evaluateThinWaist({
    input: { value: 4 },
    facts: { tighten: true },
    contracts: [contract],
    hooks: [hook],
  });

  assert.equal(first.digest, second.digest);
  assert.equal(first.contractResults[0].output && (first.contractResults[0].output as { doubled: number }).doubled, 8);
  assert.equal(first.hookDecisions[0].decision?.maxToolCalls, 1);
  assert.equal(first.trace.schemaVersion, 'sciforge.agent-harness-thin-waist-trace.v1');
});

test('deterministic profile fixture evaluates profile, refs, event log, contracts, and hooks repeatably', () => {
  const contract: ContractFn<{ ref: string }, { ref: string }> = (input) => contractPass(input, { contractId: 'ref-shape' });
  const fixture = createDeterministicProfileFixture({
    profileId: 'fast-answer',
    input: { ref: 'artifact:1' },
    facts: { mode: 'fixture' },
    contracts: [contract],
    hooks: [failureOwnerRouteHook],
    materializedRefs: ['ref:b', 'ref:a'],
    eventLog: [{ type: 'TurnReceived', id: 'turn-1' }],
  });
  const first = evaluateDeterministicProfileFixture(fixture);
  const second = evaluateDeterministicProfileFixture(fixture);

  assert.equal(fixture.schemaVersion, 'sciforge.agent-harness-deterministic-profile-fixture.v1');
  assert.equal(first.profile.id, 'fast-answer');
  assert.equal(first.digest, second.digest);
  assert.equal(first.eventLogDigest, stableHarnessDigest([{ type: 'TurnReceived', id: 'turn-1' }]));
  assert.deepEqual(first.materializedRefs, ['ref:a', 'ref:b']);
});
