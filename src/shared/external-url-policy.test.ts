import { describe, expect, it } from 'vitest'
import {
  hasSafeEmbeddedMediaExtension,
  isSafeEmbeddedMediaMimeType,
  MACOS_SCREEN_RECORDING_SETTINGS_URL,
  normalizeSafeEmbeddedMediaUrl,
  normalizeSafeExternalUrl,
  normalizeSafeRemoteEmbeddedMediaUrl,
  normalizeSafeSystemSettingsUrl
} from './external-url-policy'

describe('external URL policy', () => {
  it('keeps open-external URLs limited to browser-safe protocols', () => {
    expect(normalizeSafeExternalUrl(' https://example.com/docs ')).toBe('https://example.com/docs')
    expect(normalizeSafeExternalUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
    expect(normalizeSafeExternalUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(normalizeSafeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeSafeExternalUrl('file:///tmp/secret')).toBeNull()
  })

  it('keeps system settings URLs on an exact allowlist separate from open-external', () => {
    expect(normalizeSafeExternalUrl(MACOS_SCREEN_RECORDING_SETTINGS_URL)).toBeNull()
    expect(normalizeSafeSystemSettingsUrl(MACOS_SCREEN_RECORDING_SETTINGS_URL)).toBe(
      MACOS_SCREEN_RECORDING_SETTINGS_URL
    )
    expect(normalizeSafeSystemSettingsUrl(`${MACOS_SCREEN_RECORDING_SETTINGS_URL}&extra=1`)).toBeNull()
    expect(normalizeSafeSystemSettingsUrl('x-apple.systempreferences:com.apple.preference.security')).toBeNull()
  })

  it('allows only explicit embedded media protocols and data URL MIME types', () => {
    expect(normalizeSafeEmbeddedMediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(normalizeSafeEmbeddedMediaUrl('blob:shot-preview')).toBe('blob:shot-preview')
    expect(normalizeSafeEmbeddedMediaUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(normalizeSafeEmbeddedMediaUrl('data:image/png;charset=utf-8;base64,AAAA')).toBe(
      'data:image/png;charset=utf-8;base64,AAAA'
    )
    expect(normalizeSafeEmbeddedMediaUrl('data:image/svg+xml;base64,AAAA')).toBeNull()
    expect(normalizeSafeEmbeddedMediaUrl('data:text/html;base64,AAAA')).toBeNull()
    expect(normalizeSafeEmbeddedMediaUrl('data:image/png,raw')).toBeNull()
    expect(normalizeSafeEmbeddedMediaUrl('mailto:test@example.com')).toBeNull()
    expect(normalizeSafeEmbeddedMediaUrl('file:///tmp/secret.png')).toBeNull()
  })

  it('separates remote embedded media from blob and data preview URLs', () => {
    expect(normalizeSafeRemoteEmbeddedMediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(normalizeSafeRemoteEmbeddedMediaUrl('http://localhost/a.png')).toBe('http://localhost/a.png')
    expect(normalizeSafeRemoteEmbeddedMediaUrl('blob:shot-preview')).toBeNull()
    expect(normalizeSafeRemoteEmbeddedMediaUrl('data:image/png;base64,AAAA')).toBeNull()
  })

  it('checks embedded media MIME types and path extensions from one allowlist', () => {
    expect(isSafeEmbeddedMediaMimeType('IMAGE/PNG')).toBe(true)
    expect(isSafeEmbeddedMediaMimeType('image/vnd.microsoft.icon')).toBe(true)
    expect(isSafeEmbeddedMediaMimeType('image/svg+xml')).toBe(false)
    expect(hasSafeEmbeddedMediaExtension('/tmp/plot.PNG')).toBe(true)
    expect(hasSafeEmbeddedMediaExtension('https://example.com/plot.webp?download=1')).toBe(true)
    expect(hasSafeEmbeddedMediaExtension('/tmp/plot.svg')).toBe(false)
  })
})
