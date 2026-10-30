import type { AppSettingsV1 } from './app-settings-types'

export const SPEECH_TO_TEXT_PROTOCOLS = ['mimo-asr'] as const
export type SpeechToTextProtocol = (typeof SPEECH_TO_TEXT_PROTOCOLS)[number]
export const DEFAULT_SPEECH_TO_TEXT_PROTOCOL: SpeechToTextProtocol = 'mimo-asr'

/**
 * Base64 payload cap for one transcription request (~12 MB of audio).
 * This bounds what the renderer can push over IPC.
 */
export const SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS = 16_000_000

/** Hard cap on a single dictation so the payload stays under the IPC limit. */
export const SPEECH_TRANSCRIPTION_MAX_DURATION_MS = 5 * 60 * 1000

export const DEFAULT_SPEECH_TRANSCRIPTION_TIMEOUT_MS = 60_000
export const MAX_SPEECH_TRANSCRIPTION_TIMEOUT_MS = 600_000

export type SpeechToTextSettingsV1 = {
  enabled: boolean
  protocol: SpeechToTextProtocol
  baseUrl: string
  apiKey: string
  model: string
  language: string
  timeoutMs: number
}

export type SpeechToTextSettingsPatchV1 = Partial<SpeechToTextSettingsV1>

export type SpeechTranscriptionRequest = {
  /** Base64-encoded audio bytes (no data: prefix). */
  audioBase64: string
  /** Audio MIME type, e.g. "audio/wav". */
  mimeType: string
  /** Optional recording duration, for enforcing the renderer-side cap again in main. */
  durationMs?: number
}

export type SpeechTranscriptionResult =
  | {
      ok: true
      text: string
    }
  | {
      ok: false
      message: string
    }

export function defaultSpeechToTextSettings(): SpeechToTextSettingsV1 {
  return {
    enabled: false,
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    language: '',
    timeoutMs: DEFAULT_SPEECH_TRANSCRIPTION_TIMEOUT_MS
  }
}

export function normalizeSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  void value
  return DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

export function normalizeSpeechToTextSettings(
  input: SpeechToTextSettingsPatchV1 | undefined
): SpeechToTextSettingsV1 {
  const defaults = defaultSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    protocol: normalizeSpeechToTextProtocol(input?.protocol),
    baseUrl: defaults.baseUrl,
    apiKey: defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    language: typeof input?.language === 'string'
      ? input.language.trim().toLowerCase().slice(0, 16)
      : defaults.language,
    timeoutMs: boundedPositiveInt(
      input?.timeoutMs,
      defaults.timeoutMs,
      MAX_SPEECH_TRANSCRIPTION_TIMEOUT_MS
    )
  }
}

export function resolveSpeechToTextSettings(
  settings: AppSettingsV1 | { speechToText?: SpeechToTextSettingsPatchV1 }
): SpeechToTextSettingsV1 {
  return normalizeSpeechToTextSettings(
    (settings as { speechToText?: SpeechToTextSettingsPatchV1 }).speechToText
  )
}

export function isSpeechToTextConfigured(
  speechToText: Pick<SpeechToTextSettingsV1, 'enabled' | 'protocol' | 'baseUrl' | 'apiKey' | 'model'> | null | undefined
): speechToText is SpeechToTextSettingsV1 {
  return Boolean(speechToText?.enabled && speechToText.model.trim())
}

export function mergeSpeechToTextSettings(
  current: SpeechToTextSettingsV1 | undefined,
  patch: SpeechToTextSettingsPatchV1 | undefined
): SpeechToTextSettingsV1 {
  return normalizeSpeechToTextSettings({
    ...(current ?? defaultSpeechToTextSettings()),
    ...(patch ?? {})
  })
}

function boundedPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(5_000, Math.min(max, Math.round(parsed)))
}
