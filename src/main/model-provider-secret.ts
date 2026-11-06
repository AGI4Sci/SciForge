/** Runtime-only upstream credential references. Never expand into persisted settings. */
export const MODEL_PROVIDER_SECRET_ENV_PREFIX = 'SCIFORGE_PROVIDER_'
const ENV_REFERENCE = /^\$\{ENV:(SCIFORGE_PROVIDER_[A-Z][A-Z0-9_]{0,127})\}$/

export function resolveModelProviderSecret(
  value: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = value.trim()
  const reference = ENV_REFERENCE.exec(configured)
  if (!reference) {
    // Malformed or non-allowlisted references must never reach an upstream as
    // a literal credential. Ordinary existing literal keys remain supported.
    if (configured.includes('${ENV:')) {
      throw new Error('Invalid provider credential environment reference.')
    }
    return configured
  }
  const secret = env[reference[1]]?.trim()
  if (!secret || secret.includes('${ENV:')) {
    throw new Error('Provider credential environment reference is unavailable.')
  }
  return secret
}
