import { describe, expect, it, vi } from 'vitest'
import { resolveModelProviderSecret } from './model-provider-secret'

describe('resolveModelProviderSecret', () => {
  it('preserves existing literal keys after trimming', () => {
    expect(resolveModelProviderSecret('  literal-test-key  ', {})).toBe('literal-test-key')
  })

  it('resolves only allowlisted exact references from the provided environment', () => {
    expect(resolveModelProviderSecret('${ENV:SCIFORGE_PROVIDER_TASK_KEY}', {
      SCIFORGE_PROVIDER_TASK_KEY: ' runtime-test-secret '
    })).toBe('runtime-test-secret')
  })

  it('rejects missing, blank, nested and non-allowlisted references without echoing inputs', () => {
    for (const reference of [
      '${ENV:OPENAI_API_KEY}', '${ENV:SCIFORGE_TASK_PROVIDER_KEY}',
      '${ENV:SCIFORGE_PROVIDER_}', '${ENV:SCIFORGE_PROVIDER_lowercase}',
      '${ENV:SCIFORGE_PROVIDER_A}suffix', '${ENV:SCIFORGE_PROVIDER_A'
    ]) {
      expect(() => resolveModelProviderSecret(reference, {})).toThrow('Invalid provider credential environment reference.')
    }
    for (const value of [undefined, '', ' ', '${ENV:SCIFORGE_PROVIDER_OTHER}']) {
      expect(() => resolveModelProviderSecret('${ENV:SCIFORGE_PROVIDER_TASK_KEY}', {
        SCIFORGE_PROVIDER_TASK_KEY: value
      })).toThrow('Provider credential environment reference is unavailable.')
    }
  })

  it('uses process.env only when no explicit environment was supplied', () => {
    vi.stubEnv('SCIFORGE_PROVIDER_HELPER_TEST_KEY', 'process-only-test-secret')
    try {
      const reference = '${ENV:SCIFORGE_PROVIDER_HELPER_TEST_KEY}'
      expect(resolveModelProviderSecret(reference)).toBe('process-only-test-secret')
      expect(() => resolveModelProviderSecret(reference, {})).toThrow(/unavailable/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
