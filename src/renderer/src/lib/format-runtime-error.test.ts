import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import {
  describeRuntimeError,
  formatRuntimeError,
  getRuntimeErrorCode,
  runtimeErrorTranslationKey
} from './format-runtime-error'

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

  it.each([
    'runtime_not_found',
    'runtime_path_invalid',
    'runtime_not_executable',
    'runtime_architecture_incompatible',
    'runtime_version_unsupported',
    'runtime_capability_unsupported',
    'runtime_probe_failed',
    'runtime_probe_unsupported',
    'runtime_start_failed',
    'runtime_authentication_failed'
  ])('maps %s to an existing English and Chinese translation key', (code) => {
    const key = runtimeErrorTranslationKey(code)
    expect(key).toBeTruthy()
    expect(i18n.exists(`common:${key}`, { lng: 'en' })).toBe(true)
    expect(i18n.exists(`common:${key}`, { lng: 'zh' })).toBe(true)
  })

  it('keeps ENOENT in technical details and never shows it in the user summary', async () => {
    const error = new Error(JSON.stringify({
      code: 'runtime_not_found',
      message: 'runtime_not_found',
      details: { technicalDetail: 'spawn codex ENOENT' }
    }))

    const english = describeRuntimeError(error)
    expect(english.summary).toBe('SciForge could not find a compatible local assistant.')
    expect(english.summary).not.toContain('ENOENT')
    expect(english.detail).toContain('ENOENT')

    await i18n.changeLanguage('zh')
    const chinese = describeRuntimeError(error)
    expect(chinese.summary).toBe('SciForge 未找到兼容的本地智能体。')
    expect(chinese.summary).not.toContain('ENOENT')
    expect(chinese.detail).toContain('ENOENT')
  })

  it('interpolates discovered paths and versions through English and Chinese translations', async () => {
    const pathError = new Error(JSON.stringify({
      code: 'runtime_path_invalid',
      message: 'runtime_path_invalid',
      details: { executablePath: '/Applications/ChatGPT.app/Contents/Resources/codex' }
    }))
    expect(formatRuntimeError(pathError)).toContain('/Applications/ChatGPT.app/Contents/Resources/codex')

    await i18n.changeLanguage('zh')
    expect(formatRuntimeError(pathError)).toContain('/Applications/ChatGPT.app/Contents/Resources/codex')
    const versionError = new Error(JSON.stringify({
      code: 'runtime_version_unsupported',
      message: 'runtime_version_unsupported',
      details: { version: '0.1.0' }
    }))
    expect(formatRuntimeError(versionError)).toContain('0.1.0')
  })

  it('localizes an upstream context-size overflow with a new-conversation hint', async () => {
    await i18n.changeLanguage('zh')
    const error = new Error(
      'request (32026 tokens) exceeds the available context size (16384 tokens), try increasing it'
    )
    expect(formatRuntimeError(error)).toContain('上下文超限')
    expect(describeRuntimeError(error).code).toBe('context_size_exceeded')
  })

  it('explains an unsupported reasoning level with a fix path', () => {
    const error = new Error('upstream request failed: unsupported_reasoning_effort (422)')
    const view = describeRuntimeError(error)
    expect(view.code).toBe('unsupported_reasoning_effort')
    expect(view.summary).toBe(i18n.t('common:runtimeUnsupportedReasoningEffort'))
  })
})

