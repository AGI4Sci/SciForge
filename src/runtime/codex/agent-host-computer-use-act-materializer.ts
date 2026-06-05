import {
  createDefaultBrowserHostComputerUseActMaterializer,
} from './agent-host-browser-computer-use-act-materializer.js';
import {
  createDefaultVirtualAppScreenComputerUseActMaterializer,
} from './agent-host-virtual-app-screen-computer-use-act-materializer.js';
import {
  requiresComputerUseProductCompletionEvidence,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import {
  createComputerUseActLoopMaterializer,
} from './agent-host-computer-use-act-loop.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
} from './agent-host-turn-loop.js';

export function createDefaultComputerUseActMaterializer(options: {
  browser?: Parameters<typeof createDefaultBrowserHostComputerUseActMaterializer>[0];
  virtualAppScreen?: Parameters<typeof createDefaultVirtualAppScreenComputerUseActMaterializer>[0];
  env?: NodeJS.ProcessEnv;
  maxActLoopSteps?: number;
} = {}): CodexAgentHostComputerUseActMaterializer {
  const browser = createDefaultBrowserHostComputerUseActMaterializer({
    ...options.browser,
    env: options.browser?.env ?? options.env,
  });
  const virtualAppScreen = createDefaultVirtualAppScreenComputerUseActMaterializer({
    ...options.virtualAppScreen,
    env: options.virtualAppScreen?.env ?? options.env,
  });

  const singleStep: CodexAgentHostComputerUseActMaterializer = async (input) => {
    if (hasBrowserHostSessionRef(input)) return browser(input);
    return virtualAppScreen(input);
  };
  const actLoop = createComputerUseActLoopMaterializer({
    baseMaterializer: singleStep,
    maxSteps: options.maxActLoopSteps ?? 4,
  });

  return async (input) => {
    if (requiresDefaultActLoop(input)) return actLoop(input);
    return singleStep(input);
  };
}

function requiresDefaultActLoop(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return requiresComputerUseProductCompletionEvidence({ commandText: input.commandText });
}

function hasBrowserHostSessionRef(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return [
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
    ...input.agentHostInput.refs,
  ].some((ref) => /^browser-host-session:/i.test(ref));
}
