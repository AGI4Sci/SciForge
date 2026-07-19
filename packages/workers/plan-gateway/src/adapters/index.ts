import { createCodexPlanAdapter } from './codex';
import { CodingPlanAdapterRegistry } from '../registry';

export function createBuiltInPlanAdapterRegistry(): CodingPlanAdapterRegistry {
  return new CodingPlanAdapterRegistry([
    createCodexPlanAdapter(),
  ]);
}

export {
  CODEX_PLAN_ADAPTER_ID,
  CODEX_PLAN_ALLOWED_ROUTES,
  CODEX_PLAN_PROVIDER_ID,
  CODEX_PLAN_UPSTREAM_BASE_URL,
  createCodexPlanAdapter,
  createCodexPlanRuntimeConfig,
  extractCodexTraceCorrelation,
} from './codex';
