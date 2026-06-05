import type { ToolWorkerManifest } from '../../../contracts/tool-worker/src/index';

export const modelRouterManifest: ToolWorkerManifest = {
  protocolVersion: 'sciforge.tools.v1',
  workerId: 'sciforge.model-router',
  workerVersion: '0.1.0',
  description: 'Provider-compatible SciForge /v1/responses facade for text reasoning and refs-first visual translation.',
  capabilities: [
    'model_router_responses',
    'text_reasoning',
    'vision_translation',
    'refs_first_trace',
  ],
  providers: [
    {
      providerId: 'sciforge.model-router.responses',
      capabilityId: 'model_router_responses',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/health',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.vision-translator',
      capabilityId: 'vision_translation',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/health',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
  ],
  tools: [
    {
      id: 'model_router_responses',
      name: 'Model Router Responses',
      version: '0.1.0',
      description: 'Expose a Codex provider-compatible /v1/responses endpoint backed by profile-selected text and vision roles.',
      inputSchema: {
        input: { type: 'object', required: true, description: 'Responses-compatible input payload with optional visual refs.' },
        profile: { type: 'string', description: 'Optional registered Model Router profile id.' },
      },
      outputSchema: {
        output_text: { type: 'string', required: true },
        traceRef: { type: 'string', required: true },
      },
      sideEffects: ['network', 'write'],
      timeoutMs: 120000,
      tags: ['model-router', 'responses', 'vision', 'refs-first'],
    },
  ],
};
