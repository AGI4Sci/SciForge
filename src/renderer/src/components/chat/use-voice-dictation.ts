import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  normalizeSpeechToTextSettings,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS,
  type SpeechToTextSettingsV1,
  type SpeechTranscriptionRequest,
  type SpeechTranscriptionResult
} from '@shared/speech-to-text'
import type { AppSettingsV1 } from '@shared/app-settings'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'

export type VoiceDictationStatus = 'idle' | 'recording' | 'transcribing'
export type VoiceDictationIntent = 'insert' | 'send'
type SpeechTranscriptionBridge = {
  speechToText?: {
    transcribe?: (payload: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
  }
}

type VoiceDictationNotice = {
  kind: 'max-duration'
  message: string
} | null

const TRANSCRIPTION_SAMPLE_RATE = 16_000
const MIN_RECORDING_MS = 500
const RECORDER_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export function resolveSpeechToTextSettingsFromAppSettings(
  settings: AppSettingsV1
): SpeechToTextSettingsV1 | null {
  const normalized = normalizeSpeechToTextSettings(settings.speechToText)
  return isSpeechToTextSettingsConfigured(normalized) ? normalized : null
}

export function isSpeechToTextSettingsConfigured(
  speechToText: Pick<SpeechToTextSettingsV1, 'enabled' | 'protocol' | 'model'> | null | undefined
): speechToText is SpeechToTextSettingsV1 {
  return Boolean(speechToText?.enabled && speechToText.protocol === 'mimo-asr' && speechToText.model.trim())
}

export function isSpeechTranscriptionBridgeAvailable(): boolean {
  return typeof getSpeechTranscribe() === 'function'
}

export function useSpeechToTextSettings(): SpeechToTextSettingsV1 | null {
  const [speechToText, setSpeechToText] = useState<SpeechToTextSettingsV1 | null>(null)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) setSpeechToText(resolveSpeechToTextSettingsFromAppSettings(settings))
    }
    if (typeof window !== 'undefined' && typeof window.sciforge?.getSettings === 'function') {
      void window.sciforge.getSettings().then(apply).catch(() => {
        if (!cancelled) setSpeechToText(null)
      })
    }
    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return isSpeechTranscriptionBridgeAvailable() ? speechToText : null
}

export function useVoiceDictation({
  onText,
  speechToText
}: {
  onText: (text: string, intent: VoiceDictationIntent) => void
  speechToText?: SpeechToTextSettingsV1 | null
}): {
  status: VoiceDictationStatus
  error: string | null
  notice: VoiceDictationNotice
  startedAtMs: number
  clearError: () => void
  start: () => void
  stop: (intent?: VoiceDictationIntent) => void
  cancel: () => void
  toggle: () => void
  getLevel: () => number
} {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<VoiceDictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<VoiceDictationNotice>(null)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const stopIntentRef = useRef<VoiceDictationIntent>('insert')
  const discardOnStopRef = useRef(false)
  const maxDurationTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const startedAtRef = useRef(0)
  const onTextRef = useRef(onText)
  const mountedRef = useRef(true)

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const releaseStream = useCallback((): void => {
    if (maxDurationTimerRef.current != null) {
      window.clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    analyserRef.current = null
    levelDataRef.current = null
    void audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
  }, [])

  const clearError = useCallback((): void => {
    setError(null)
  }, [])

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current
    const data = levelDataRef.current
    if (!analyser || !data) return 0
    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128
      sumSquares += value * value
    }
    return Math.min(1, Math.sqrt(sumSquares / data.length) * 3)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (recorderRef.current?.state === 'recording') {
        discardOnStopRef.current = true
        recorderRef.current.stop()
      }
      releaseStream()
    }
  }, [releaseStream])

  const transcribeBlob = useCallback(async (blob: Blob, durationMs: number, intent: VoiceDictationIntent): Promise<void> => {
    try {
      const transcribeSpeech = getSpeechTranscribe()
      if (typeof transcribeSpeech !== 'function') {
        throw new Error(t('composerVoiceUnavailable'))
      }
      const wav = await encodeBlobAsWav(blob)
      const result = await transcribeSpeech({
        audioBase64: wav.base64,
        mimeType: 'audio/wav',
        durationMs: Math.min(durationMs, SPEECH_TRANSCRIPTION_MAX_DURATION_MS)
      })
      if (!mountedRef.current) return
      if (result.ok) {
        const text = result.text.trim()
        if (text) {
          onTextRef.current(text, intent)
        } else {
          setError(t('composerVoiceEmpty'))
        }
      } else {
        setError(formatTranscriptionFailure(result.message, t))
      }
    } catch (cause) {
      if (mountedRef.current) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(formatTranscriptionFailure(message, t))
      }
    } finally {
      if (mountedRef.current) {
        setStatus('idle')
        setNotice(null)
      }
    }
  }, [t])

  const start = useCallback((): void => {
    if (recorderRef.current) return
    setError(null)
    setNotice(null)
    if (!speechToText || !isSpeechTranscriptionBridgeAvailable()) {
      setError(t('composerVoiceUnavailable'))
      return
    }
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setError(t('composerVoiceMicUnavailable'))
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setError(t('composerVoiceRecorderUnavailable'))
      return
    }

    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (cause) {
        const denied = cause instanceof DOMException &&
          (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
        if (mountedRef.current) {
          setError(denied
            ? t('composerVoiceMicDenied')
            : t('composerVoiceFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
        }
        return
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const mimeType = RECORDER_MIME_CANDIDATES.find((candidate) =>
        typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(candidate)
      )
      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      } catch (cause) {
        stream.getTracks().forEach((track) => track.stop())
        if (mountedRef.current) {
          setError(t('composerVoiceFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
        }
        return
      }
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current
        const intent = stopIntentRef.current
        const discard = discardOnStopRef.current
        discardOnStopRef.current = false
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        releaseStream()
        if (!mountedRef.current) return
        if (discard) {
          setStatus('idle')
          setNotice(null)
          return
        }
        if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
          setStatus('idle')
          setNotice(null)
          setError(t('composerVoiceTooShort'))
          return
        }
        setStatus('transcribing')
        void transcribeBlob(blob, durationMs, intent)
      }
      try {
        const audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.55
        audioContext.createMediaStreamSource(stream).connect(analyser)
        audioContextRef.current = audioContext
        analyserRef.current = analyser
        levelDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      } catch {
        // Level metering is visual only; recording still works without it.
      }
      streamRef.current = stream
      recorderRef.current = recorder
      stopIntentRef.current = 'insert'
      discardOnStopRef.current = false
      startedAtRef.current = Date.now()
      setStartedAtMs(startedAtRef.current)
      try {
        recorder.start()
      } catch (cause) {
        releaseStream()
        if (mountedRef.current) {
          setError(t('composerVoiceFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
        }
        return
      }
      setStatus('recording')
      maxDurationTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current?.state !== 'recording') return
        setNotice({ kind: 'max-duration', message: t('composerVoiceMaxDurationReached') })
        recorderRef.current.stop()
      }, SPEECH_TRANSCRIPTION_MAX_DURATION_MS)
    })()
  }, [releaseStream, speechToText, t, transcribeBlob])

  const stop = useCallback((intent: VoiceDictationIntent = 'insert'): void => {
    if (recorderRef.current?.state === 'recording') {
      stopIntentRef.current = intent
      recorderRef.current.stop()
    }
  }, [])

  const cancel = useCallback((): void => {
    if (recorderRef.current?.state === 'recording') {
      discardOnStopRef.current = true
      recorderRef.current.stop()
      return
    }
    releaseStream()
    setStatus('idle')
    setNotice(null)
  }, [releaseStream])

  const toggle = useCallback((): void => {
    if (status === 'recording') {
      stop()
    } else if (status === 'idle') {
      start()
    }
  }, [start, status, stop])

  return { status, error, notice, startedAtMs, clearError, start, stop, cancel, toggle, getLevel }
}

function getSpeechTranscriptionBridge(): SpeechTranscriptionBridge | null {
  if (typeof window === 'undefined') return null
  return window.sciforge as SpeechTranscriptionBridge
}

function getSpeechTranscribe(): ((payload: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>) | undefined {
  const bridge = getSpeechTranscriptionBridge()
  return bridge?.speechToText?.transcribe
}

function formatTranscriptionFailure(message: string, t: ReturnType<typeof useTranslation<'common'>>['t']): string {
  return /time(?:d)?\s*out|timeout/i.test(message)
    ? t('composerVoiceTimedOut', { message })
    : t('composerVoiceFailed', { message })
}

async function encodeBlobAsWav(blob: Blob): Promise<{ base64: string }> {
  const compressed = await blob.arrayBuffer()
  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(compressed)
  } finally {
    void decodeContext.close()
  }
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frameCount, TRANSCRIPTION_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  const wavBytes = encodeWavPcm16(rendered.getChannelData(0), TRANSCRIPTION_SAMPLE_RATE)
  return { base64: bytesToBase64(wavBytes) }
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)
  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
