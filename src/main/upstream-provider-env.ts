export const UPSTREAM_PROVIDER_SECRET_ENV_NAMES = [
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'OPENROUTER_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'XAI_API_KEY',
  'PERPLEXITY_API_KEY',
  'MOONSHOT_API_KEY',
  'ZHIPU_API_KEY',
  'SILICONFLOW_API_KEY',
  'ARK_API_KEY'
] as const

export const UPSTREAM_PROVIDER_ENV_PREFIXES = [
  'OPENAI',
  'DEEPSEEK',
  'ANTHROPIC',
  'QWEN',
  'DASHSCOPE',
  'GEMINI',
  'GOOGLE',
  'GROQ',
  'MISTRAL',
  'COHERE',
  'OPENROUTER',
  'AZURE_OPENAI',
  'TOGETHER',
  'FIREWORKS',
  'XAI',
  'PERPLEXITY',
  'MOONSHOT',
  'ZHIPU',
  'SILICONFLOW',
  'ARK'
] as const

export const UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES = [
  'MODEL',
  'BASE_URL',
  'API_BASE',
  'API_BASE_URL'
] as const

export const UPSTREAM_PROVIDER_CONFIG_ENV_NAMES = [
  'MODEL_PROVIDER',
  'KUN_BASE_URL'
] as const

export const DIRECT_PROVIDER_WORKER_ENV_PREFIXES = [
  'SCIFORGE_IMAGE_'
] as const

export const SCI_MODALITY_SERVICE_ENV_PREFIXES = [
  'SCIFORGE_SCIMODALITY_SERVICE_'
] as const

export const SCI_MODALITY_WORKER_PRIVATE_ENV_PREFIXES = [
  'EXPERT_PROVIDER_',
  'SCIMODALITY_ROUTER_'
] as const

export const MODEL_ROUTER_PRIVATE_ENV_PREFIXES = [
  'SCIFORGE_MODEL_ROUTER_IMAGE_',
  'SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_'
] as const

export const STANDALONE_MODEL_ROUTER_ENV_PREFIXES = [
  'SCIFORGE_TEXT_',
  'SCIFORGE_VISION_'
] as const

export function isUpstreamProviderConfigEnv(key: string): boolean {
  if (UPSTREAM_PROVIDER_CONFIG_ENV_NAMES.includes(key as typeof UPSTREAM_PROVIDER_CONFIG_ENV_NAMES[number])) {
    return true
  }
  if (/^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key)) {
    return true
  }
  return UPSTREAM_PROVIDER_ENV_PREFIXES.some((prefix) =>
    UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES.some((suffix) => key === `${prefix}_${suffix}`)
  )
}

export function isPrefixedEnv(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix))
}
