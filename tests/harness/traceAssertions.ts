import assert from 'node:assert/strict';

import type {
  HarnessContract,
  HarnessDecision,
  HarnessStage,
  HarnessTrace,
} from '../../packages/agent-harness/src/contracts';

export interface ExpectedTraceStage {
  stage: HarnessStage;
  callbackId?: string;
}

export function assertTraceStageOrder(trace: HarnessTrace, expected: ExpectedTraceStage[], message = 'trace stage order'): void {
  const actual = trace.stages.map((entry) => ({ stage: entry.stage, callbackId: entry.callbackId }));
  let cursor = 0;
  for (const expectedStage of expected) {
    const foundAt = actual.findIndex((entry, index) => index >= cursor
      && entry.stage === expectedStage.stage
      && (!expectedStage.callbackId || entry.callbackId === expectedStage.callbackId));
    assert.notEqual(foundAt, -1, `${message}: missing ${formatExpectedStage(expectedStage)} in ${formatActualStages(actual)}`);
    cursor = foundAt + 1;
  }
}

export function assertDecisionMerged(
  trace: HarnessTrace,
  callbackId: string,
  expected: Record<string, unknown>,
  message = 'decision merge',
): void {
  const stage = trace.stages.find((entry) => entry.callbackId === callbackId);
  assert.ok(stage, `${message}: missing callback ${callbackId}`);
  assertObjectIncludes(stage.contractSnapshot as unknown as Record<string, unknown>, expected, `${message}: ${callbackId}`);
}

export function assertBudgetTightening(
  before: Pick<HarnessContract, 'contextBudget' | 'toolBudget'>,
  after: Pick<HarnessContract, 'contextBudget' | 'toolBudget'>,
  message = 'budget tightening',
): void {
  const contextBudgetKeys = ['maxPromptTokens', 'maxHistoryTurns', 'maxReferenceDigests', 'maxFullTextRefs'] as const;
  const toolBudgetKeys = [
    'maxWallMs',
    'maxContextTokens',
    'maxToolCalls',
    'maxObserveCalls',
    'maxActionSteps',
    'maxNetworkCalls',
    'maxDownloadBytes',
    'maxResultItems',
    'maxProviders',
    'maxRetries',
    'perProviderTimeoutMs',
    'costUnits',
  ] as const;

  for (const key of contextBudgetKeys) {
    assert.ok(after.contextBudget[key] <= before.contextBudget[key], `${message}: contextBudget.${key} widened`);
  }
  for (const key of toolBudgetKeys) {
    assert.ok(after.toolBudget[key] <= before.toolBudget[key], `${message}: toolBudget.${key} widened`);
  }
}

export function assertBlockedRefs(contract: HarnessContract, refs: string[], message = 'blocked refs'): void {
  for (const ref of refs) {
    assert.ok(contract.blockedContextRefs.includes(ref), `${message}: ${ref} was not blocked`);
    assert.ok(!contract.allowedContextRefs.includes(ref), `${message}: ${ref} remained allowed`);
  }
}

export function assertTraceDecisionIncludes(
  trace: HarnessTrace,
  callbackId: string,
  expected: Partial<HarnessDecision>,
  message = 'trace decision',
): void {
  const stage = trace.stages.find((entry) => entry.callbackId === callbackId);
  assert.ok(stage, `${message}: missing callback ${callbackId}`);
  assertObjectIncludes(stage.decision as Record<string, unknown>, expected as Record<string, unknown>, `${message}: ${callbackId}`);
}

function assertObjectIncludes(actual: Record<string, unknown>, expected: Record<string, unknown>, message: string): void {
  for (const [key, value] of Object.entries(expected)) {
    if (isRecord(value)) {
      assert.ok(isRecord(actual[key]), `${message}: ${key} is not an object`);
      assertObjectIncludes(actual[key] as Record<string, unknown>, value, `${message}.${key}`);
      continue;
    }
    assert.deepEqual(actual[key], value, `${message}: ${key}`);
  }
}

function formatExpectedStage(stage: ExpectedTraceStage): string {
  return stage.callbackId ? `${stage.stage}/${stage.callbackId}` : stage.stage;
}

function formatActualStages(stages: Array<{ stage: HarnessStage; callbackId: string }>): string {
  return stages.map((stage) => `${stage.stage}/${stage.callbackId}`).join(' -> ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
