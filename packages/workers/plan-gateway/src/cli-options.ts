import {
  PLAN_GATEWAY_DEFAULT_HOST,
  PLAN_GATEWAY_DEFAULT_MOUNT_PATH,
  PLAN_GATEWAY_DEFAULT_PORT,
} from './manifest';

export type PlanGatewayCliOptions = {
  adapterId: string;
  host: string;
  port: number;
  mountPath: string;
  instanceId?: string;
  userDataDirectory?: string;
  traceStorageDirectory?: string;
  proxyRules?: string;
  quiet: boolean;
};

export function resolvePlanGatewayCliOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): PlanGatewayCliOptions {
  const parsed = parsePlanGatewayCliArgs(args);
  return {
    adapterId: parsed.adapterId ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_ADAPTER') ?? 'codex',
    host: parsed.host ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_HOST') ?? PLAN_GATEWAY_DEFAULT_HOST,
    port: parsed.port ?? numberEnv(env, 'SCIFORGE_PLAN_GATEWAY_PORT') ?? PLAN_GATEWAY_DEFAULT_PORT,
    mountPath: parsed.mountPath ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_MOUNT_PATH') ?? PLAN_GATEWAY_DEFAULT_MOUNT_PATH,
    instanceId: parsed.instanceId ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_INSTANCE_ID'),
    userDataDirectory: parsed.userDataDirectory ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_USER_DATA_DIR'),
    traceStorageDirectory: parsed.traceStorageDirectory ?? stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_TRACE_STORAGE_DIR'),
    proxyRules: stringEnv(env, 'SCIFORGE_PLAN_GATEWAY_PROXY_RULES'),
    quiet: parsed.quiet ?? false,
  };
}

export function parsePlanGatewayCliArgs(args: string[]): Partial<PlanGatewayCliOptions> {
  const parsed: Partial<PlanGatewayCliOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--adapter') parsed.adapterId = requireValue(args, ++index, arg);
    else if (arg === '--host') parsed.host = requireValue(args, ++index, arg);
    else if (arg === '--port') parsed.port = Number(requireValue(args, ++index, arg));
    else if (arg === '--mount-path') parsed.mountPath = requireValue(args, ++index, arg);
    else if (arg === '--instance-id') parsed.instanceId = requireValue(args, ++index, arg);
    else if (arg === '--user-data-dir') parsed.userDataDirectory = requireValue(args, ++index, arg);
    else if (arg === '--trace-storage-dir') parsed.traceStorageDirectory = requireValue(args, ++index, arg);
    else if (arg === '--quiet') parsed.quiet = true;
    else throw new Error(`Unknown Plan Gateway argument: ${arg}`);
  }
  return parsed;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index]?.trim();
  if (!value) throw new Error(`Missing value for ${option}`);
  return value;
}

function stringEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function numberEnv(env: Record<string, string | undefined>, key: string): number | undefined {
  const value = stringEnv(env, key);
  return value === undefined ? undefined : Number(value);
}
