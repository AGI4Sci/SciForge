export const PLAN_GATEWAY_WORKER_VERSION = '0.1.0';
export const PLAN_GATEWAY_WORKER_ID = 'sciforge.plan-gateway';
export const PLAN_GATEWAY_DEFAULT_HOST = '127.0.0.1';
export const PLAN_GATEWAY_DEFAULT_PORT = 3893;
export const PLAN_GATEWAY_DEFAULT_MOUNT_PATH = '/v1';

export const planGatewayManifest = {
  protocolVersion: 'sciforge.tools.v1',
  workerId: PLAN_GATEWAY_WORKER_ID,
  workerVersion: PLAN_GATEWAY_WORKER_VERSION,
  description: 'Loopback-only transparent forwarding for login-backed coding plans.',
  capabilities: ['coding_plan_gateway', 'full_agent_model_tracing'],
  providers: [
    {
      providerId: 'sciforge.plan-gateway',
      capabilityId: 'coding_plan_gateway',
      transport: 'http',
      invokePath: `${PLAN_GATEWAY_DEFAULT_MOUNT_PATH}/responses`,
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network'],
      status: 'available',
    },
  ],
  tools: [],
} as const;
