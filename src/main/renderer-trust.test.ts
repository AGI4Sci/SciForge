import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './renderer-trust'

describe('isTrustedRendererUrl', () => {
  it('allows the expected renderer document and hash routes', () => {
    expect(isTrustedRendererUrl(
      'http://127.0.0.1:5173/#/workspace',
      'http://127.0.0.1:5173/'
    )).toBe(true)
    expect(isTrustedRendererUrl(
      'file:///Applications/SciForge/out/renderer/index.html#/write',
      'file:///Applications/SciForge/out/renderer/index.html'
    )).toBe(true)
  })

  it('rejects other origins, paths, credentials, and schemes', () => {
    const expected = 'http://127.0.0.1:5173/'
    expect(isTrustedRendererUrl('https://example.com/', expected)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/', expected)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/other', expected)).toBe(false)
    expect(isTrustedRendererUrl('http://user@127.0.0.1:5173/', expected)).toBe(false)
    expect(isTrustedRendererUrl('javascript:alert(1)', expected)).toBe(false)
  })
})
