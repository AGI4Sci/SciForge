import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows blob image URLs for local attachment previews', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('blob:')
    expect(imgSrc.split(/\s+/)).not.toContain('file:')
  })

  it('allows the dev browser bridge fetch and EventSource endpoints', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1] ?? ''

    expect(connectSrc.split(/\s+/)).toEqual(expect.arrayContaining([
      "'self'",
      'data:',
      'blob:',
      'sciforge-resource:',
      'http://127.0.0.1:5174',
      'http://localhost:5174'
    ]))
  })

  it('allows HTTP(S) iframe web pages without allowing local files', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const frameSrc = csp.match(/frame-src\s+([^;]+)/)?.[1] ?? ''

    expect(frameSrc.split(/\s+/)).toEqual(expect.arrayContaining(["'self'", 'http:', 'https:']))
    expect(frameSrc.split(/\s+/)).not.toContain('file:')
  })

  it('allows Mol* runtime evaluation and WebGL workers without opening local file URLs', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const workerSrc = csp.match(/worker-src\s+([^;]+)/)?.[1] ?? ''
    const childSrc = csp.match(/child-src\s+([^;]+)/)?.[1] ?? ''
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? ''

    expect(workerSrc.split(/\s+/)).toEqual(expect.arrayContaining(["'self'", 'blob:']))
    expect(childSrc.split(/\s+/)).toEqual(expect.arrayContaining(["'self'", 'blob:']))
    expect(scriptSrc.split(/\s+/)).toContain("'unsafe-eval'")
    expect(scriptSrc.split(/\s+/)).toContain("'wasm-unsafe-eval'")
    expect(workerSrc.split(/\s+/)).not.toContain('file:')
  })
})
