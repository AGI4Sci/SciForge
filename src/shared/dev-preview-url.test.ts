import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEV_PREVIEW_ADDRESS,
  DEFAULT_DEV_PREVIEW_URL,
  isDefaultDevPreviewUrl
} from './dev-preview-url'

describe('dev preview default URL', () => {
  it('uses the Vite loopback default as the stable preview entry', () => {
    expect(DEFAULT_DEV_PREVIEW_ADDRESS).toBe('127.0.0.1:5173')
    expect(DEFAULT_DEV_PREVIEW_URL).toBe('http://127.0.0.1:5173/')
  })

  it('recognizes normalized default preview inputs', () => {
    expect(isDefaultDevPreviewUrl('5173')).toBe(true)
    expect(isDefaultDevPreviewUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isDefaultDevPreviewUrl('http://localhost:5173')).toBe(false)
  })
})
