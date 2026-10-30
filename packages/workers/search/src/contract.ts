import type { ResearchProviderDiagnostic } from './types.js';

export const RESEARCH_SEARCH_WORKER_VERSION = '0.1.0';
export const RESEARCH_SEARCH_WORKER_TRANSPORT = 'stdio';
export const RESEARCH_SEARCH_WORKER_CAPABILITIES = [
  'research_search',
  'research_search_diagnostics',
] as const;

export type ResearchSearchWorkerTransport = typeof RESEARCH_SEARCH_WORKER_TRANSPORT;
export type ResearchSearchWorkerCapability = typeof RESEARCH_SEARCH_WORKER_CAPABILITIES[number];
export type ResearchSearchWorkerHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ResearchSearchWorkerHealth = {
  status: ResearchSearchWorkerHealthStatus;
  available: boolean;
  enabledProviders: number;
  availableProviders: number;
  reason?: string;
};

export type ResearchSearchWorkerDiagnostics = {
  version: string;
  transport: ResearchSearchWorkerTransport;
  health: ResearchSearchWorkerHealth;
  recentError: string | null;
  capabilities: ResearchSearchWorkerCapability[];
  providers: ResearchProviderDiagnostic[];
};
