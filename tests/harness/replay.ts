import assert from 'node:assert/strict';

import { getHarnessProfile } from '../../packages/agent-harness/src/profiles';
import { harnessRuntimeInternals } from '../../packages/agent-harness/src/runtime';
import type { HarnessContract, HarnessEvaluation, HarnessInput, HarnessTrace } from '../../packages/agent-harness/src/contracts';
import type { HarnessExperimentMetrics } from './metrics';

export interface HarnessReplayRecord {
  schemaVersion: 'sciforge.agent-harness-replay.v1';
  id: string;
  input: HarnessInput;
  refs: Record<string, unknown>;
  trace: HarnessTrace;
  finalContract: HarnessContract;
  metrics?: HarnessExperimentMetrics;
}

export function createHarnessReplayRecord(input: {
  id: string;
  harnessInput: HarnessInput;
  evaluation: HarnessEvaluation;
  refs?: Record<string, unknown>;
  metrics?: HarnessExperimentMetrics;
}): HarnessReplayRecord {
  return {
    schemaVersion: 'sciforge.agent-harness-replay.v1',
    id: input.id,
    input: input.harnessInput,
    refs: input.refs ?? {},
    trace: input.evaluation.trace,
    finalContract: input.evaluation.contract,
    metrics: input.metrics,
  };
}

export function replayContractFromSavedTrace(record: HarnessReplayRecord): HarnessContract {
  assert.equal(record.schemaVersion, 'sciforge.agent-harness-replay.v1', `${record.id}: unsupported replay schema`);
  assert.equal(record.trace.schemaVersion, 'sciforge.agent-harness-trace.v1', `${record.id}: unsupported trace schema`);
  assert.equal(record.trace.profileId, record.finalContract.profileId, `${record.id}: trace/contract profile mismatch`);

  if (record.trace.stages.length === 0) return record.finalContract;

  const profile = getHarnessProfile(record.trace.profileId);
  let contract = cloneContract(record.trace.stages[0].contractSnapshot);
  assert.equal(contract.traceRef, record.trace.traceId, `${record.id}: first snapshot must preserve trace ref`);

  for (const stage of record.trace.stages.slice(1)) {
    const result = harnessRuntimeInternals.mergeDecision(contract, stage.decision, {
      profile,
      stage: stage.stage,
      callbackId: stage.callbackId,
      humanApprovalSatisfied: record.input.humanApprovalSatisfied === true,
    });
    contract = result.contract;
    assert.deepEqual(contract, stage.contractSnapshot, `${record.id}: replay diverged at ${stage.stage}/${stage.callbackId}`);
  }

  return contract;
}

export function assertReplayRecord(record: HarnessReplayRecord): HarnessContract {
  const replayedContract = replayContractFromSavedTrace(record);
  assert.deepEqual(replayedContract, record.finalContract, `${record.id}: replayed contract differs from final contract`);
  assert.ok(record.trace.stages.length > 0, `${record.id}: replay requires at least one trace stage`);
  assert.ok(Object.keys(record.refs).length > 0, `${record.id}: replay record should pin fixture refs`);
  return replayedContract;
}

function cloneContract(contract: HarnessContract): HarnessContract {
  return JSON.parse(JSON.stringify(contract)) as HarnessContract;
}
