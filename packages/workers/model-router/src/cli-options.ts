export type ModelRouterCliOptions = {
  host?: string;
  port?: number;
  configPath?: string;
  workspaceRoot?: string;
  quiet?: boolean;
};

export function resolveModelRouterCliOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): ModelRouterCliOptions {
  const parsed = parseModelRouterCliArgs(args);
  return {
    ...parsed,
    host: parsed.host ?? stringEnv(env, 'SCIFORGE_MODEL_ROUTER_HOST'),
    port: parsed.port ?? numberEnv(env, 'SCIFORGE_MODEL_ROUTER_PORT'),
    configPath: parsed.configPath ?? stringEnv(env, 'SCIFORGE_MODEL_ROUTER_CONFIG'),
    workspaceRoot: parsed.workspaceRoot ?? stringEnv(env, 'SCIFORGE_WORKSPACE_PATH'),
  };
}

export function parseModelRouterCliArgs(args: string[]): ModelRouterCliOptions {
  const parsed: ModelRouterCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') parsed.host = args[++index];
    else if (arg === '--port') parsed.port = Number(args[++index]);
    else if (arg === '--config') parsed.configPath = args[++index];
    else if (arg === '--workspace-root') parsed.workspaceRoot = args[++index];
    else if (arg === '--quiet') parsed.quiet = true;
  }
  return parsed;
}

function stringEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function numberEnv(env: Record<string, string | undefined>, key: string): number | undefined {
  const value = stringEnv(env, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
