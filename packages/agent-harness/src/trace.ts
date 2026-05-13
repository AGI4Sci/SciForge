import type { ContractFn, ContractResult } from './contract-fns';
import { normalizeContractResult } from './contract-fns';
import type { HookDecision, HookFn } from './hook-fns';
import { normalizeHookDecision } from './hook-fns';
import { mergeThinWaistDecisions, type ThinWaistMergeDiagnostics } from './merge-policy';

export interface ContractFnTraceRecord {
  kind: 'contract';
  index: number;
  contractId?: string;
  resultKind: ContractResult<unknown>['kind'];
  digest: string;
}

export interface HookFnTraceRecord {
  kind: 'hook';
  index: number;
  hookId?: string;
  decisionKind: HookDecision<unknown>['kind'];
  digest: string;
}

export interface ThinWaistEvaluationTrace {
  schemaVersion: 'sciforge.agent-harness-thin-waist-trace.v1';
  traceId: string;
  inputDigest: string;
  factsDigest: string;
  records: Array<ContractFnTraceRecord | HookFnTraceRecord>;
  mergeDiagnostics: ThinWaistMergeDiagnostics;
}

export interface ThinWaistEvaluation<Input, Facts, Decision> {
  input: Readonly<Input>;
  facts: Readonly<Facts>;
  contractResults: ContractResult<unknown>[];
  hookDecisions: HookDecision<Decision>[];
  trace: ThinWaistEvaluationTrace;
  digest: string;
}

export function evaluateContractFns<Input>(
  input: Readonly<Input>,
  contracts: readonly ContractFn<Input, unknown>[],
): ContractResult<unknown>[] {
  const inputDigest = stableHarnessDigest(input);
  return contracts.map((contract, index) => {
    const result = contract(input);
    return normalizeContractResult({
      ...result,
      inputDigest,
      contractId: result.contractId ?? `contract-${index}`,
    });
  });
}

export function evaluateHookFns<Facts, Decision>(
  facts: Readonly<Facts>,
  prior: readonly ContractResult<unknown>[],
  hooks: readonly HookFn<Facts, Decision>[],
): HookDecision<Decision>[] {
  return hooks.map((hook, index) => {
    const decision = hook(facts, prior);
    return normalizeHookDecision({
      ...decision,
      hookId: decision.hookId ?? `hook-${index}`,
    });
  });
}

export function evaluateThinWaist<Input, Facts, Decision>(options: {
  input: Readonly<Input>;
  facts: Readonly<Facts>;
  contracts?: readonly ContractFn<Input, unknown>[];
  hooks?: readonly HookFn<Facts, Decision>[];
  traceId?: string;
}): ThinWaistEvaluation<Input, Facts, Decision> {
  const inputDigest = stableHarnessDigest(options.input);
  const factsDigest = stableHarnessDigest(options.facts);
  const contractResults = evaluateContractFns(options.input, options.contracts ?? []);
  const hookDecisions = evaluateHookFns(options.facts, contractResults, options.hooks ?? []);
  const merged = mergeThinWaistDecisions(contractResults, hookDecisions);
  const records: ThinWaistEvaluationTrace['records'] = [
    ...contractResults.map((result, index) => ({
      kind: 'contract' as const,
      index,
      contractId: result.contractId,
      resultKind: result.kind,
      digest: stableHarnessDigest(result),
    })),
    ...hookDecisions.map((decision, index) => ({
      kind: 'hook' as const,
      index,
      hookId: decision.hookId,
      decisionKind: decision.kind,
      digest: stableHarnessDigest(decision),
    })),
  ];
  const trace: ThinWaistEvaluationTrace = {
    schemaVersion: 'sciforge.agent-harness-thin-waist-trace.v1',
    traceId: options.traceId ?? `thin-waist-${stableHarnessDigest({ inputDigest, factsDigest, records }).slice(0, 12)}`,
    inputDigest,
    factsDigest,
    records,
    mergeDiagnostics: merged.diagnostics,
  };
  return {
    input: options.input,
    facts: options.facts,
    contractResults: merged.contractResults,
    hookDecisions: merged.hookDecisions,
    trace,
    digest: stableHarnessDigest({ contractResults: merged.contractResults, hookDecisions: merged.hookDecisions, trace }),
  };
}

export function stableHarnessDigest(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => typeof record[key] !== 'undefined' && typeof record[key] !== 'function')
      .sort()
      .map((key) => [key, sortForStableStringify(record[key])]),
  );
}
