type ToolWorkerManifest = {
  protocolVersion: string;
  workerId: string;
  workerVersion: string;
  description: string;
  capabilities: string[];
  providers: Array<{
    providerId: string;
    capabilityId: string;
    transport: string;
    invokePath: string;
    healthPath: string;
    manifestPath: string;
    permissions: string[];
    status: string;
  }>;
  tools: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    sideEffects: string[];
    timeoutMs: number;
    tags: string[];
  }>;
};

export const MODEL_ROUTER_WORKER_VERSION = '0.1.0';
export const MODEL_ROUTER_WORKER_TRANSPORT = 'http';
export const MODEL_ROUTER_WORKER_CAPABILITIES = [
  'model_router_responses',
  'model_router_messages',
  'model_router_image_generations',
  'model_router_image_edits',
  'text_reasoning',
  'image_generation',
  'vision_translation',
  'scientific_translation',
  'refs_first_trace',
] as const;

export type ModelRouterWorkerTransport = typeof MODEL_ROUTER_WORKER_TRANSPORT;
export type ModelRouterWorkerCapability = typeof MODEL_ROUTER_WORKER_CAPABILITIES[number];
export type ModelRouterWorkerHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type ModelRouterUpstreamDiagnosticCategory =
  | 'ready'
  | 'repo-bug'
  | 'provider-auth'
  | 'provider-network'
  | 'provider-bad-response'
  | 'provider-error';

export type ModelRouterUpstreamDiagnostic = {
  category: ModelRouterUpstreamDiagnosticCategory;
  ok: boolean;
  retryable: boolean;
  httpStatus?: number;
  role?: 'textReasoner' | 'imageGenerator' | 'visionTranslator' | 'scientificTranslator';
  releaseAcceptance: 'not-evaluated';
};

export type ModelRouterWorkerDiagnostics = {
  version: string;
  transport: ModelRouterWorkerTransport;
  health: {
    status: ModelRouterWorkerHealthStatus;
    available: boolean;
    reason?: string;
  };
  recentError: string | null;
  capabilities: ModelRouterWorkerCapability[];
  upstream: ModelRouterUpstreamDiagnostic;
};

export const modelRouterManifest: ToolWorkerManifest = {
  protocolVersion: 'sciforge.tools.v1',
  workerId: 'sciforge.model-router',
  workerVersion: MODEL_ROUTER_WORKER_VERSION,
  description: 'Provider-compatible SciForge /v1/responses, /v1/messages, /v1/images/generations, and /v1/images/edits facade for text reasoning, image generation/editing, and refs-first visual/scientific translation.',
  capabilities: [...MODEL_ROUTER_WORKER_CAPABILITIES],
  providers: [
    {
      providerId: 'sciforge.model-router.responses',
      capabilityId: 'model_router_responses',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.messages',
      capabilityId: 'model_router_messages',
      transport: 'http',
      invokePath: '/v1/messages',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.image-generations',
      capabilityId: 'model_router_image_generations',
      transport: 'http',
      invokePath: '/v1/images/generations',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.image-edits',
      capabilityId: 'model_router_image_edits',
      transport: 'http',
      invokePath: '/v1/images/edits',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.vision-translator',
      capabilityId: 'vision_translation',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.scientific-translator',
      capabilityId: 'scientific_translation',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/healthz',
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
      description: 'Expose a Codex provider-compatible /v1/responses endpoint backed by profile-selected text, vision, and managed scientific translation roles.',
      inputSchema: {
        input: { type: 'object', required: true, description: 'Responses-compatible input payload with optional visual refs.' },
        profile: { type: 'string', description: 'Optional registered Model Router profile id.' },
      },
      outputSchema: {
        output_text: { type: 'string', required: true },
        traceRef: { type: 'string', required: true },
      },
      sideEffects: ['network', 'filesystem'],
      timeoutMs: 120000,
      tags: ['model-router', 'responses', 'vision', 'refs-first'],
    },
    {
      id: 'model_router_messages',
      name: 'Model Router Messages',
      version: '0.1.0',
      description: 'Expose an Anthropic Messages-compatible /v1/messages endpoint backed by the same Model Router profiles.',
      inputSchema: {
        input: { type: 'object', required: true, description: 'Messages-compatible payload.' },
        profile: { type: 'string', description: 'Optional registered Model Router profile id.' },
      },
      outputSchema: {
        content: { type: 'array', required: true },
      },
      sideEffects: ['network', 'filesystem'],
      timeoutMs: 120000,
      tags: ['model-router', 'messages', 'claude-code'],
    },
    {
      id: 'model_router_image_generations',
      name: 'Model Router Image Generations',
      version: '0.1.0',
      description: 'Expose an OpenAI-compatible /v1/images/generations endpoint backed by the profile-selected image generator role.',
      inputSchema: {
        prompt: { type: 'string', required: true },
        model: { type: 'string', description: 'Public Model Router alias.' },
      },
      outputSchema: {
        data: { type: 'array', required: true },
      },
      sideEffects: ['network'],
      timeoutMs: 120000,
      tags: ['model-router', 'images', 'generation'],
    },
    {
      id: 'model_router_image_edits',
      name: 'Model Router Image Edits',
      version: '0.1.0',
      description: 'Expose an OpenAI-compatible multipart /v1/images/edits endpoint backed by the profile-selected image generator role.',
      inputSchema: {
        model: { type: 'string', required: true, description: 'Public Model Router alias.' },
        prompt: { type: 'string', required: true },
        image: { type: 'file', required: true },
        mask: { type: 'file' },
        size: { type: 'string' },
        n: { type: 'integer' },
        quality: { type: 'string' },
        input_fidelity: { type: 'string' },
      },
      outputSchema: {
        data: { type: 'array', required: true },
      },
      sideEffects: ['network'],
      timeoutMs: 120000,
      tags: ['model-router', 'images', 'editing'],
    },
  ],
};

export function createModelRouterWorkerDiagnostics(
  upstream: ModelRouterUpstreamDiagnostic,
  recentError: string | null = upstream.ok ? null : upstream.category
): ModelRouterWorkerDiagnostics {
  return {
    version: MODEL_ROUTER_WORKER_VERSION,
    transport: MODEL_ROUTER_WORKER_TRANSPORT,
    health: {
      status: upstream.ok ? 'healthy' : 'unhealthy',
      available: upstream.ok,
      ...(upstream.ok ? {} : { reason: upstream.category })
    },
    recentError,
    capabilities: [...MODEL_ROUTER_WORKER_CAPABILITIES],
    upstream
  };
}
