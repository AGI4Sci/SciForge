export const AGENT_RUNTIME_PRIVATE_ENV_NAMES = [
  'SCIFORGE_BIOGYM_INTERNAL_BASE_URL',
  'SCIFORGE_BIOGYM_INTERNAL_TOKEN'
] as const

export function sanitizeAgentRuntimeEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  for (const name of AGENT_RUNTIME_PRIVATE_ENV_NAMES) {
    delete env[name]
  }
  return env
}
