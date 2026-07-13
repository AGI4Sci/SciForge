import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from './format-runtime-error'

describe('format runtime error', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses code fields for localized summaries and settings actions', () => {
    const error = new Error(JSON.stringify({
      code: 'missing_api_key',
      message: 'api-key=sk-test is missing',
      details: { Authorization: 'Bearer runtime-token' }
    }))

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(i18n.t('common:runtimeMissingApiKey'))
    expect(view.code).toBe('missing_api_key')
    expect(view.settingsAction).toBe('agents')
    expect(view.detail).toContain('<redacted>')
    expect(view.detail).not.toContain('sk-test')
    expect(view.detail).not.toContain('runtime-token')
  })

  it('supports legacy error envelopes and Electron IPC prefixes', () => {
    const error = new Error(
      `Error invoking remote method 'agentRuntime:startTurn': Error: ${JSON.stringify({
        error: 'fetch_failed',
        message: 'fetch failed'
      })}`
    )

    expect(getRuntimeErrorCode(error)).toBe('fetch_failed')
    expect(formatRuntimeError(error)).toBe(i18n.t('common:runtimeFetchFailed'))
  })

  it('maps provider auth failures to a shared Model Router settings action', () => {
    const error = new Error('stream disconnected before completion: provider_http_401')

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(i18n.t('common:runtimeProviderAuthBlocked'))
    expect(view.code).toBe('provider_auth_blocked')
    expect(view.settingsAction).toBe('agents')
  })

  it.each([
    'runtime_execution_incomplete',
    'runtime_execution_claim_unverified',
    'runtime_visual_execution_missing'
  ])('labels %s as blocked and unverified execution', (code) => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      code,
      message: 'The model claimed the required tool action completed without a trusted receipt.',
      severity: 'error'
    })))

    expect(view.summary).toBe(i18n.t('common:runtimeExecutionBlocked'))
    expect(view.code).toBe(code)
    expect(view.detail).toContain('The model claimed the required tool action completed')
    expect(view.settingsAction).toBeUndefined()
  })

  it('localizes execution integrity failures in Chinese', async () => {
    await i18n.changeLanguage('zh')

    expect(formatRuntimeError(new Error(JSON.stringify({
      code: 'runtime_execution_incomplete',
      message: 'missing receipt'
    })))).toBe('已阻止 / 执行未验证：运行时没有提供可信凭证，无法证明所需工具操作已经完成。')
  })
})
