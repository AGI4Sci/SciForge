import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings-types'
import {
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS
} from '../../shared/speech-to-text'
import {
  SpeechHttpError,
  isSpeechToTextConfigured,
  requestSpeechTranscription
} from './speech-to-text-service'

const AUDIO_BASE64 = Buffer.from('fake-wav-bytes').toString('base64')

function settingsWithSpeech(overrides: Record<string, unknown> = {}): AppSettingsV1 {
  return {
    modelRouter: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:49876/v1',
      autoStart: true,
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    speechToText: {
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-1',
      language: '',
      timeoutMs: 30000,
      ...overrides
    }
  } as unknown as AppSettingsV1
}

type RecordedRequest = { url: string; init: RequestInit }

function fakeFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('speech-to-text service', () => {
  it('reports router-backed configuration state from enabled/model', () => {
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'mimo-asr', baseUrl: '', apiKey: '', model: 'mimo-v2.5-asr' })).toBe(true)
    expect(isSpeechToTextConfigured({ enabled: false, protocol: 'mimo-asr', baseUrl: '', apiKey: '', model: 'mimo-v2.5-asr' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'mimo-asr', baseUrl: '', apiKey: '', model: '' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'openai-transcriptions' as never, baseUrl: 'x', apiKey: 'y', model: 'z' })).toBe(false)
  })

  it('rejects when the speech provider is not configured', async () => {
    const result = await requestSpeechTranscription(settingsWithSpeech({ model: '' }), {
      audioBase64: AUDIO_BASE64,
      mimeType: 'audio/wav'
    })

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not configured') })
  })

  it('enforces payload size and duration caps before network requests', async () => {
    const fetchImpl = (() => Promise.reject(new Error('should not fetch'))) as typeof fetch

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: '', mimeType: 'audio/wav' },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'audio payload is empty or too large' })

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: 'a'.repeat(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS + 1), mimeType: 'audio/wav' },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'audio payload is empty or too large' })

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      {
        audioBase64: AUDIO_BASE64,
        mimeType: 'audio/wav',
        durationMs: SPEECH_TRANSCRIPTION_MAX_DURATION_MS + 1
      },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'recording duration exceeds the speech-to-text limit' })
  })

  it('transcribes via Model Router responses with a base64 audio data URI', async () => {
    const { fetchImpl, requests } = fakeFetch({
      choices: [{ message: { content: ' ni hao ' } }]
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ protocol: 'mimo-asr', model: 'mimo-v2.5-asr' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'ni hao' })
    expect(requests[0].url).toBe('http://127.0.0.1:49876/v1/responses')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer local-runtime-router-key')
    expect(headers['api-key']).toBeUndefined()
    const payload = JSON.parse(String(requests[0].init.body))
    expect(payload).toMatchObject({
      model: 'sciforge-router',
      asr_options: { language: 'auto' },
      stream: false
    })
    expect(payload.input[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: `data:audio/wav;base64,${AUDIO_BASE64}` }
    })
  })

  it('passes language hints through Model Router ASR options', async () => {
    const { fetchImpl, requests } = fakeFetch({
      output_text: '你好'
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ language: 'zh' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/mp4' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: '你好' })
    const payload = JSON.parse(String(requests[0].init.body))
    expect(payload.asr_options).toEqual({ language: 'zh' })
  })

  it('redacts secret-looking upstream response text from error messages', async () => {
    const { fetchImpl } = fakeFetch({ error: { message: 'Authorization: Bearer sk-speech' } }, 401)
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('HTTP 401')
      expect(result.message).not.toContain('sk-speech')
      expect(result.message).toContain('<redacted>')
    }
  })

  it('rejects an empty transcription result', async () => {
    const { fetchImpl } = fakeFetch({ output_text: '   ' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
  })

  it('stores redacted HTTP error bodies only', () => {
    const error = new SpeechHttpError(400, 'api_key=sk-secret')

    expect(error.message).toBe('HTTP 400: api_key=<redacted>')
    expect(error.body).toBe('api_key=<redacted>')
  })
})
