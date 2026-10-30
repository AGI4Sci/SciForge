import type { AppSettingsV1 } from '../../shared/app-settings-types'
import { resolveRuntimeModelRouterSettings } from '../../shared/app-settings-model-router'
import { buildModelRouterResponsesUrl } from '../../shared/model-router-url'
import { redactSecretText } from '../../shared/secret-redaction'
import {
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS,
  resolveSpeechToTextSettings,
  type SpeechToTextSettingsV1,
  type SpeechTranscriptionRequest,
  type SpeechTranscriptionResult
} from '../../shared/speech-to-text'

export function isSpeechToTextConfigured(
  speechToText: Pick<SpeechToTextSettingsV1, 'enabled' | 'protocol' | 'baseUrl' | 'apiKey' | 'model'>
): boolean {
  return speechToText.enabled && speechToText.protocol === 'mimo-asr' && Boolean(speechToText.model.trim())
}

export async function requestSpeechTranscription(
  settings: AppSettingsV1,
  request: SpeechTranscriptionRequest,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<SpeechTranscriptionResult> {
  const speechToText = resolveSpeechToTextSettings(settings)
  if (!isSpeechToTextConfigured(speechToText)) {
    return { ok: false, message: 'speech-to-text provider is not configured' }
  }
  const payloadError = validateAudioPayload(request)
  if (payloadError) return { ok: false, message: payloadError }

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const text = await transcribeViaMimoAsr(settings, speechToText, request, fetchImpl)
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'transcription result is empty' }
    return { ok: true, text: trimmed }
  } catch (error) {
    return { ok: false, message: describeTranscriptionError(error, speechToText.timeoutMs) }
  }
}

function validateAudioPayload(request: SpeechTranscriptionRequest): string | null {
  if (!request.audioBase64 || request.audioBase64.length > SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS) {
    return 'audio payload is empty or too large'
  }
  if (!request.mimeType.trim()) return 'audio MIME type is required'
  if (typeof request.durationMs === 'number') {
    if (!Number.isFinite(request.durationMs) || request.durationMs < 0) {
      return 'recording duration is invalid'
    }
    if (request.durationMs > SPEECH_TRANSCRIPTION_MAX_DURATION_MS) {
      return 'recording duration exceeds the speech-to-text limit'
    }
  }
  return null
}

async function transcribeViaMimoAsr(
  settings: AppSettingsV1,
  speechToText: SpeechToTextSettingsV1,
  request: SpeechTranscriptionRequest,
  fetchImpl: typeof fetch
): Promise<string> {
  const router = resolveRuntimeModelRouterSettings(settings)
  const response = await fetchImpl(buildModelRouterResponsesUrl(router.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${router.apiKey}`
    },
    body: JSON.stringify({
      model: router.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:${request.mimeType};base64,${request.audioBase64}`
              }
            }
          ]
        }
      ],
      asr_options: {
        language: speechToText.language || 'auto'
      },
      stream: false,
      metadata: {
        speechProtocol: 'mimo-asr',
        requestedSpeechModel: speechToText.model || undefined
      }
    }),
    signal: AbortSignal.timeout(speechToText.timeoutMs)
  })
  const body = await response.text()
  if (!response.ok) throw new SpeechHttpError(response.status, body)
  const parsed = JSON.parse(body) as {
    output_text?: unknown
    choices?: Array<{ message?: { content?: unknown } }>
  }
  if (typeof parsed.output_text === 'string') return parsed.output_text
  const content = parsed.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  throw new Error('speech response has no transcript content')
}

export class SpeechHttpError extends Error {
  readonly body: string

  constructor(
    readonly status: number,
    body: string
  ) {
    const redactedBody = redactSecretText(body)
    super(`HTTP ${status}: ${redactedBody.slice(0, 500)}`)
    this.body = redactedBody
  }
}

function describeTranscriptionError(error: unknown, timeoutMs: number): string {
  if (error instanceof SpeechHttpError) return error.message
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `speech request timed out after ${timeoutMs}ms`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'speech request was canceled'
  }
  if (error instanceof SyntaxError) return 'speech response is not valid JSON'
  if (error instanceof Error) return redactSecretText(error.message || error.name)
  return redactSecretText(String(error))
}
