import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_SPEECH_TRANSCRIPTION_TIMEOUT_MS,
  MAX_SPEECH_TRANSCRIPTION_TIMEOUT_MS,
  defaultSpeechToTextSettings,
  mergeSpeechToTextSettings,
  normalizeSpeechToTextProtocol,
  normalizeSpeechToTextSettings,
  resolveSpeechToTextSettings
} from './speech-to-text'

describe('speech-to-text settings', () => {
  it('defaults to disabled router-backed transcription settings', () => {
    expect(defaultSpeechToTextSettings()).toEqual({
      enabled: false,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: '',
      language: '',
      timeoutMs: DEFAULT_SPEECH_TRANSCRIPTION_TIMEOUT_MS
    })
    expect(DEFAULT_SPEECH_TO_TEXT_PROTOCOL).toBe('mimo-asr')
  })

  it('normalizes to the router-backed protocol and drops legacy provider credentials', () => {
    expect(normalizeSpeechToTextProtocol('mimo-asr')).toBe('mimo-asr')
    expect(normalizeSpeechToTextProtocol('custom')).toBe('mimo-asr')

    const normalized = normalizeSpeechToTextSettings({
      enabled: true,
      protocol: 'openai-transcriptions' as never,
      baseUrl: '  https://speech.example.test/v1/ ',
      apiKey: ' sk-secret ',
      model: ' whisper-1 ',
      language: ' ZH-CN-TOO-LONG ',
      timeoutMs: MAX_SPEECH_TRANSCRIPTION_TIMEOUT_MS + 1
    })

    expect(normalized).toEqual({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-1',
      language: 'zh-cn-too-long',
      timeoutMs: MAX_SPEECH_TRANSCRIPTION_TIMEOUT_MS
    })
  })

  it('resolves and merges top-level app speech settings without provider presets', () => {
    const current = normalizeSpeechToTextSettings({
      enabled: true,
      baseUrl: 'https://speech.example.test/v1',
      apiKey: 'sk-speech',
      model: 'whisper-1'
    })
    const merged = mergeSpeechToTextSettings(current, { model: 'gpt-4o-transcribe', language: 'en' })

    expect(merged).toMatchObject({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-transcribe',
      language: 'en'
    })
    expect(resolveSpeechToTextSettings({ speechToText: merged })).toEqual(merged)
  })
})
