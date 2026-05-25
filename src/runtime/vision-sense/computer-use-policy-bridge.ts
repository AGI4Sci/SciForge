import { resolve } from 'node:path';

import { isRecord } from '../gateway-utils.js';
import { parseJson, runCommand } from '../computer-use/utils.js';
import type { LoopStep } from '../computer-use/types.js';

type ComputerUsePolicyRequest =
  | { mode: 'planner-only-evidence-task'; text: string }
  | { mode: 'action-ledger-completion'; task: string; steps: unknown[] };

export type ActionLedgerCompletionPolicy = {
  complete: boolean;
  kind?: string;
  reason?: string;
};

export async function evaluateComputerUsePolicy(request: ComputerUsePolicyRequest): Promise<unknown | undefined> {
  const python = process.env.SCIFORGE_VISION_SENSE_PYTHON || 'python3';
  const modulePath = resolve('packages/observe/vision/sciforge_vision_sense/computer_use_policy.py');
  const code = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("sciforge_vision_sense_computer_use_policy_runtime", ${JSON.stringify(modulePath)})`,
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'main = module.main',
    'raise SystemExit(main([sys.argv[1]]))',
  ].join('; ');
  const result = await runCommand(python, ['-c', code, JSON.stringify(request)], { timeoutMs: 10000 });
  if (result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout.trim());
  if (!isRecord(parsed) || parsed.ok !== true) return undefined;
  return parsed.result;
}

export async function shouldCompleteFromFileRefsOnlyPolicy(text: string) {
  const result = await evaluateComputerUsePolicy({ mode: 'planner-only-evidence-task', text });
  return isRecord(result) && result.plannerOnly === true;
}

export async function actionLedgerCompletionPolicy(task: string, steps: LoopStep[]): Promise<ActionLedgerCompletionPolicy | undefined> {
  const result = await evaluateComputerUsePolicy({
    mode: 'action-ledger-completion',
    task,
    steps: policyStepLedger(steps),
  });
  if (!isRecord(result) || typeof result.complete !== 'boolean') return undefined;
  return {
    complete: result.complete,
    kind: typeof result.kind === 'string' ? result.kind : undefined,
    reason: typeof result.reason === 'string' ? result.reason : undefined,
  };
}

function policyStepLedger(steps: LoopStep[]) {
  return steps.map((step) => ({
    kind: step.kind,
    status: step.status,
    plannedAction: step.plannedAction,
    verifier: step.verifier,
    windowTarget: step.windowTarget,
    execution: step.execution,
    grounding: step.grounding,
  }));
}
