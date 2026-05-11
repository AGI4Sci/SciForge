import { harnessModules } from './modules';
import type { HarnessModule, PromptDirective } from './contracts';

export interface HarnessResearchEntryPoint {
  id: string;
  path: string;
  purpose: string;
  ownsPolicyTruth: boolean;
}

export const harnessResearchEntryPoints: HarnessResearchEntryPoint[] = [
  {
    id: 'contract',
    path: 'packages/agent-harness/src/contracts.ts',
    purpose: 'Versioned runtime contracts, trace records, budgets, and policy projections.',
    ownsPolicyTruth: true,
  },
  {
    id: 'profiles',
    path: 'packages/agent-harness/src/profiles.ts',
    purpose: 'Default profiles and stage callbacks for harness policy choices.',
    ownsPolicyTruth: true,
  },
  {
    id: 'runtime',
    path: 'packages/agent-harness/src/runtime.ts',
    purpose: 'Stage execution, merge rules, and trace materialization.',
    ownsPolicyTruth: true,
  },
  {
    id: 'gateway-handoff',
    path: 'src/runtime/gateway/agent-harness-shadow.ts',
    purpose: 'Runtime gateway handoff metadata and bounded prompt render projection.',
    ownsPolicyTruth: false,
  },
  {
    id: 'prompt-renderer',
    path: 'src/runtime/gateway/agentserver-prompts.ts',
    purpose: 'Final prompt rendering from contract/directives; governance remains in harness contracts and modules.',
    ownsPolicyTruth: false,
  },
];

export function promptDirectivePreviewForModule(module: HarnessModule): PromptDirective {
  return {
    id: `preview:${module.id}`,
    sourceCallbackId: `module:${module.id}`,
    priority: module.cost === 'free' ? 10 : module.cost === 'cheap' ? 20 : 30,
    text: `${module.id} owns ${module.ownedStages.join(', ')} and emits ${module.outputs.join(', ')}.`,
  };
}

export function promptDirectivePreviewsForModules(moduleIds?: string[]): PromptDirective[] {
  const selected = moduleIds?.length
    ? moduleIds.map((id) => harnessModules[id]).filter((module): module is HarnessModule => Boolean(module))
    : Object.values(harnessModules);
  return selected.map(promptDirectivePreviewForModule);
}

export function assertPromptPolicyRendererBoundary(promptText: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (promptText.includes('"schemaVersion":"sciforge.agent-harness-contract.v1"') || promptText.includes('"stages":[')) {
    issues.push('Prompt renderer appears to inline full contract or trace payload.');
  }
  for (const forbidden of ['fresh guidance:', 'repair guidance:', 'latency guidance:', 'tool-use guidance:']) {
    if (promptText.toLowerCase().includes(forbidden)) {
      issues.push(`Prompt renderer appears to inline ${forbidden.replace(':', '')}.`);
    }
  }
  return { ok: issues.length === 0, issues };
}
