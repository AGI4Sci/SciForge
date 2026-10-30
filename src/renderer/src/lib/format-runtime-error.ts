import i18n from '../i18n'
import { redactSecrets, redactSecretText } from '@shared/secret-redaction'

type RuntimeErrorPayload = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}

export type RuntimeErrorView = {
  summary: string
  detail?: string
  code?: string
  settingsAction?: 'agents'
}

const EXECUTION_INTEGRITY_ERROR_CODES = new Set([
  'runtime_execution_incomplete',
  'runtime_execution_claim_unverified',
  'runtime_visual_execution_missing'
])

const RUNTIME_ERROR_TRANSLATION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  fetch_failed: 'runtimeFetchFailed',
  missing_api_key: 'runtimeMissingApiKey',
  provider_auth_blocked: 'runtimeProviderAuthBlocked',
  runtime_offline: 'runtimeAutoStartDisabled',
  runtime_auth_required: 'runtimeAuthRequired',
  runtime_request_user_input_unsupported: 'runtimeUserInputUnsupported',
  runtime_execution_interrupted: 'runtimeExecutionInterrupted',
  runtime_port_conflict: 'runtimePortConflict',
  runtime_unhealthy: 'runtimeUnhealthy',
  turn_in_progress: 'runtimeActiveTurn',
  runtime_binary_not_installed: 'runtimeBinaryNotInstalled',
  preload_bridge_missing: 'preloadBridgeMissing',
  runtime_not_found: 'runtimeDiscoveryNotFound',
  runtime_path_invalid: 'runtimeDiscoveryPathInvalid',
  runtime_not_executable: 'runtimeDiscoveryNotExecutable',
  runtime_architecture_incompatible: 'runtimeDiscoveryArchitectureIncompatible',
  runtime_version_unsupported: 'runtimeDiscoveryVersionUnsupported',
  runtime_capability_unsupported: 'runtimeDiscoveryCapabilityUnsupported',
  runtime_probe_failed: 'runtimeDiscoveryProbeFailed',
  runtime_probe_unsupported: 'runtimeDiscoveryProbeUnsupported',
  runtime_start_failed: 'runtimeDiscoveryStartFailed',
  runtime_authentication_failed: 'runtimeDiscoveryAuthenticationFailed',
  unsupported_reasoning_effort: 'runtimeUnsupportedReasoningEffort'
})

export function runtimeErrorTranslationKey(code: string | null | undefined): string | null {
  return RUNTIME_ERROR_TRANSLATION_KEYS[code?.trim().toLowerCase() ?? ''] ?? null
}

export function isExecutionIntegrityErrorCode(code: string | null | undefined): boolean {
  return EXECUTION_INTEGRITY_ERROR_CODES.has(code?.trim().toLowerCase() ?? '')
}

function readJsonPayload(raw: string): RuntimeErrorPayload | null {
  try {
    return JSON.parse(raw) as RuntimeErrorPayload
  } catch {
    return null
  }
}

function stripIpcPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function getRuntimeErrorCode(error: unknown): string | null {
  const raw = stripIpcPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const payload = readJsonPayload(raw)
  return runtimeErrorCode(payload, raw)
}

function runtimeErrorCode(payload: RuntimeErrorPayload | null, raw: string): string | null {
  const fromCode = typeof payload?.code === 'string' ? payload.code.trim() : ''
  if (fromCode) return fromCode.toLowerCase()
  const fromError = typeof payload?.error === 'string' ? payload.error.trim() : ''
  if (fromError) return fromError.toLowerCase()
  const lowered = stripIpcPrefix(payloadMessage(payload) || raw).toLowerCase()
  if (lowered.includes('fetch failed')) return 'fetch_failed'
  if (
    lowered.includes('provider_http_401') ||
    lowered.includes('provider_http_403') ||
    lowered.includes('provider auth') ||
    lowered.includes('provider credentials') ||
    lowered.includes('upstream provider returned 401') ||
    lowered.includes('upstream provider returned 403')
  ) {
    return 'provider_auth_blocked'
  }
  if (lowered.includes('runtime unhealthy')) return 'runtime_unhealthy'
  if (lowered.includes('active turn')) return 'turn_in_progress'
  if (lowered.includes('preload bridge missing')) return 'preload_bridge_missing'
  if (
    lowered.includes('exceeds the available context size') ||
    lowered.includes('exceed context size')
  ) return 'context_size_exceeded'
  if (
    lowered.includes('managed runtime npm package missing') ||
    lowered.includes('kun npm package missing') ||
    lowered.includes('cannot find package.json')
  ) {
    return 'runtime_binary_not_installed'
  }
  if (lowered.includes('unsupported_reasoning_effort')) return 'unsupported_reasoning_effort'
  return null
}

function payloadMessage(payload: RuntimeErrorPayload | null): string {
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim()
  if (payload?.error && typeof payload.error === 'object') {
    const message = payload.error.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return ''
}

function detailString(value: unknown): string {
  if (value === undefined) return ''
  const redacted = redactSecrets(value)
  if (typeof redacted === 'string') return redactSecretText(redacted)
  try {
    return JSON.stringify(redacted, null, 2)
  } catch {
    return String(redacted)
  }
}

function localizedRuntimeSummary(code: string | null, text: string, details?: unknown): string | null {
  const lowered = text.toLowerCase()

  if (isExecutionIntegrityErrorCode(code)) {
    return i18n.t('common:runtimeExecutionBlocked')
  }

  const translationKey = runtimeErrorTranslationKey(code)
  if (translationKey) {
    const summary = i18n.t(`common:${translationKey}`)
    if (!details || typeof details !== 'object' || Array.isArray(details)) return summary
    const record = details as Record<string, unknown>
    const executablePath = typeof record.executablePath === 'string'
      ? record.executablePath.trim()
      : ''
    const version = typeof record.version === 'string' ? record.version.trim() : ''
    if (executablePath && (code === 'runtime_path_invalid' || code === 'runtime_not_executable')) {
      return `${summary} ${i18n.t('common:runtimeDiscoveryPathDetail', { path: executablePath })}`
    }
    if (version && (code === 'runtime_version_unsupported' || code === 'runtime_capability_unsupported')) {
      return `${summary} ${i18n.t('common:runtimeDiscoveryVersionDetail', { version })}`
    }
    return summary
  }

  if (code === 'fetch_failed' || lowered.includes('fetch failed')) {
    return i18n.t('common:runtimeFetchFailed')
  }

  if (code === 'missing_api_key') {
    return i18n.t('common:runtimeMissingApiKey')
  }

  if (code === 'provider_auth_blocked') {
    return i18n.t('common:runtimeProviderAuthBlocked')
  }

  if (code === 'runtime_offline') {
    return i18n.t('common:runtimeAutoStartDisabled')
  }

  if (code === 'runtime_auth_required') {
    return i18n.t('common:runtimeAuthRequired')
  }

  if (code === 'runtime_request_user_input_unsupported') {
    return i18n.t('common:runtimeUserInputUnsupported')
  }

  if (code === 'runtime_execution_interrupted') {
    return i18n.t('common:runtimeExecutionInterrupted')
  }

  if (code === 'runtime_port_conflict') {
    return i18n.t('common:runtimePortConflict')
  }

  if (code === 'runtime_unhealthy' || lowered.includes('runtime unhealthy')) {
    return i18n.t('common:runtimeUnhealthy')
  }

  if (code === 'turn_in_progress' || lowered.includes('active turn')) {
    return i18n.t('common:runtimeActiveTurn')
  }

  if (
    code === 'context_size_exceeded' ||
    lowered.includes('exceeds the available context size') ||
    lowered.includes('exceed context size')
  ) {
    return i18n.t('common:runtimeContextExceeded')
  }

  if (code === 'runtime_binary_not_installed') {
    return i18n.t('common:runtimeBinaryNotInstalled')
  }

  if (code === 'preload_bridge_missing' || lowered.includes('preload bridge missing')) {
    return i18n.t('common:preloadBridgeMissing')
  }

  return null
}

function shouldOpenAgentsSettings(code: string | null): boolean {
  return code === 'missing_api_key' ||
    code === 'provider_auth_blocked' ||
    code === 'runtime_offline' ||
    code === 'runtime_auth_required' ||
    code === 'runtime_port_conflict'
}

export function describeRuntimeError(error: unknown): RuntimeErrorView {
  const raw = stripIpcPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const payload = readJsonPayload(raw)
  const errorCode = runtimeErrorCode(payload, raw)
  const payloadText = payloadMessage(payload)
  const text = stripIpcPrefix(payloadText || raw)
  const redactedText = redactSecretText(text)
  const summary = localizedRuntimeSummary(errorCode, redactedText, payload?.details) ||
    redactedText ||
    i18n.t('common:runtimeActionFailed')
  const details: string[] = []
  if (errorCode) details.push(`Code: ${errorCode}`)
  if (payload?.severity) details.push(`Severity: ${payload.severity}`)
  if (redactedText && redactedText !== summary) {
    details.push(`Message:\n${redactedText}`)
  }
  const payloadDetails = detailString(payload?.details)
  if (payloadDetails) details.push(`Details:\n${payloadDetails}`)
  if (!payload && raw && raw !== redactedText) {
    details.push(`Raw:\n${redactSecretText(raw)}`)
  }
  return {
    summary,
    ...(details.length > 0 ? { detail: details.join('\n\n') } : {}),
    ...(errorCode ? { code: errorCode } : {}),
    ...(shouldOpenAgentsSettings(errorCode) ? { settingsAction: 'agents' as const } : {})
  }
}

export function formatRuntimeError(error: unknown): string {
  return describeRuntimeError(error).summary
}
