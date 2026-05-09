export type CapabilityLevel = 'none' | 'basic' | 'deterministic' | 'schema-checked' | 'self-healing' | 'external-tool';

export interface RuntimeCapabilityProfile {
  id: string;
  label: string;
  description: string;
  capabilities: Record<string, CapabilityLevel>;
  runtimePriority: number;
  failureModes: string[];
}

export const runtimeCapabilityProfiles: RuntimeCapabilityProfile[] = [
  {
    id: 'package-skill',
    label: 'Core capability package',
    description: 'Schema-checked SciForge capability contracts that guide AgentServer workspace task generation.',
    capabilities: {
      'agentserver-generation': 'self-healing',
      'artifact-emission': 'schema-checked',
      'http-fetch': 'basic',
      'artifact-inspection': 'deterministic',
      'ui-fallback': 'schema-checked',
    },
    runtimePriority: 1,
    failureModes: ['backend-unavailable', 'network-unavailable', 'schema-mismatch', 'missing-input'],
  },
  {
    id: 'workspace-python',
    label: 'Workspace Python',
    description: 'Deterministic workspace-local Python task execution.',
    capabilities: {
      'workspace-task': 'deterministic',
      'artifact-emission': 'schema-checked',
      'http-fetch': 'basic',
      'scientific-compute': 'deterministic',
    },
    runtimePriority: 2,
    failureModes: ['runtime-error', 'missing-input', 'schema-mismatch'],
  },
  {
    id: 'scp-hub',
    label: 'SCP Hub adapter',
    description: 'Package markdown skills and tool adapters with stricter input contracts.',
    capabilities: {
      'external-tool': 'external-tool',
      'artifact-emission': 'schema-checked',
      'agentserver-generation': 'self-healing',
    },
    runtimePriority: 3,
    failureModes: ['backend-unavailable', 'missing-input', 'schema-mismatch'],
  },
  {
    id: 'agentserver-codex',
    label: 'AgentServer Codex backend',
    description: 'Code generation, repair, and workspace task synthesis backend.',
    capabilities: {
      'agentserver-generation': 'self-healing',
      'code-generation': 'self-healing',
      'filesystem-ops': 'deterministic',
      'artifact-emission': 'schema-checked',
    },
    runtimePriority: 4,
    failureModes: ['backend-unavailable', 'schema-mismatch', 'runtime-error'],
  },
  {
    id: 'agentserver-native',
    label: 'AgentServer native backend',
    description: 'Structured chat and JSON response backend.',
    capabilities: {
      'structured-json': 'schema-checked',
      'artifact-emission': 'basic',
      'agentserver-generation': 'basic',
    },
    runtimePriority: 5,
    failureModes: ['backend-unavailable', 'schema-mismatch'],
  },
];

export function profileSupportsCapability(profile: RuntimeCapabilityProfile, capability: string) {
  const level = profile.capabilities[capability];
  return Boolean(level && level !== 'none');
}
