import {
  RESEARCH_SEARCH_WORKER_CAPABILITIES,
  RESEARCH_SEARCH_WORKER_TRANSPORT,
  RESEARCH_SEARCH_WORKER_VERSION,
  type ResearchSearchWorkerDiagnostics
} from './contract.js';
import {
  ResearchSearchService,
  createResearchSearchService,
  researchSearchConfigFromEnv,
  type ResearchSearchServiceOptions
} from './research-service.js';
import type {
  ResearchProviderDiagnostic,
  ResearchSearchConfig,
  ResearchSearchInput,
  ResearchSearchOutput
} from './types.js';

export {
  ResearchSearchService,
  createResearchSearchService,
  researchSearchConfigFromEnv,
  type ResearchSearchServiceOptions
} from './research-service.js';

export type ResearchSearchWorkerServiceOptions = ResearchSearchServiceOptions & {
  service?: ResearchSearchService;
};

export class ResearchSearchWorkerService {
  private recentError: string | null = null;
  readonly service: ResearchSearchService;

  constructor(
    config: ResearchSearchConfig = researchSearchConfigFromEnv(),
    options: ResearchSearchWorkerServiceOptions = {}
  ) {
    this.service = options.service ?? createResearchSearchService(config, options);
  }

  get config(): ResearchSearchConfig {
    return this.service.config;
  }

  configuredDiagnostics(): ResearchProviderDiagnostic[] {
    return this.service.configuredDiagnostics();
  }

  async search(input: ResearchSearchInput): Promise<ResearchSearchOutput> {
    try {
      const result = await this.service.search(input);
      this.recentError = null;
      return result;
    } catch (error) {
      this.recentError = errorMessage(error);
      throw error;
    }
  }

  diagnostics(): ResearchSearchWorkerDiagnostics {
    return researchSearchWorkerDiagnosticsFromProviders(this.configuredDiagnostics(), this.recentError);
  }
}

export function createResearchSearchWorkerService(
  config: ResearchSearchConfig = researchSearchConfigFromEnv(),
  options: ResearchSearchWorkerServiceOptions = {}
): ResearchSearchWorkerService {
  return new ResearchSearchWorkerService(config, options);
}

export function researchSearchWorkerDiagnosticsFromProviders(
  providers: ResearchProviderDiagnostic[],
  recentError: string | null = null
): ResearchSearchWorkerDiagnostics {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const availableProviders = enabledProviders.filter((provider) => provider.available);
  const firstUnavailable = enabledProviders.find((provider) => !provider.available);
  const health = researchSearchWorkerHealth({
    enabledCount: enabledProviders.length,
    availableCount: availableProviders.length,
    reason: recentError ?? firstUnavailable?.reason
  });

  return {
    version: RESEARCH_SEARCH_WORKER_VERSION,
    transport: RESEARCH_SEARCH_WORKER_TRANSPORT,
    health,
    recentError,
    capabilities: [...RESEARCH_SEARCH_WORKER_CAPABILITIES],
    providers
  };
}

function researchSearchWorkerHealth(input: {
  enabledCount: number;
  availableCount: number;
  reason?: string;
}): ResearchSearchWorkerDiagnostics['health'] {
  const available = input.availableCount > 0;
  if (input.enabledCount === 0 || input.availableCount === 0) {
    return {
      status: 'unhealthy',
      available,
      enabledProviders: input.enabledCount,
      availableProviders: input.availableCount,
      ...(input.reason ? { reason: input.reason } : {})
    };
  }
  if (input.availableCount < input.enabledCount || input.reason) {
    return {
      status: 'degraded',
      available,
      enabledProviders: input.enabledCount,
      availableProviders: input.availableCount,
      ...(input.reason ? { reason: input.reason } : {})
    };
  }
  return {
    status: 'healthy',
    available,
    enabledProviders: input.enabledCount,
    availableProviders: input.availableCount
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
