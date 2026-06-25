// Public library surface for the sci-modality router worker.
// The executable entry point is ./cli.ts; in-repo callers, tests, and tooling import
// the contract and factories from here.
export { createSciModalityRouterServer, SERVICE_ID, SERVICE_VERSION } from './server.js';
export type { SciModalityRouterOptions } from './server.js';
export {
  EXPERT_MODEL,
  translateModality,
  detectModality,
  ProviderError,
  ClientAbortError,
  UndetectableModalityError,
} from './experts.js';
export type { ExpertConfig } from './experts.js';
export * from './types.js';
