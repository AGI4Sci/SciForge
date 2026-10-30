import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  BROWSER_PREVIEW_TRUST,
  browserClickInputSchema,
  browserFillInputSchema,
  browserOpenInputSchema,
  browserReadInputSchema,
  browserReadUrlInputSchema,
  browserReadUrlOutputSchema,
  browserPageStateSchema,
  browserPresentationInputSchema
} from './contract.js'
import {
  isAllowedRequestUrl,
  normalizeNavigableUrl,
  readUrlContent
} from './service.js'

test('browser action schemas expose bounded opaque targets and no selector/evaluate escape hatch', () => {
  assert.equal(browserOpenInputSchema.safeParse({ sessionId: 's', surfaceId: 'p' }).success, false)
  assert.equal(browserOpenInputSchema.safeParse({ sessionId: 's', surfaceId: 'p', url: 'https://example.com/' }).success, true)
  assert.equal(
    browserClickInputSchema.safeParse({ targetRef: 'target_abcdefghijklmnopqrstuvwxyz' }).success,
    true
  )
  assert.equal(
    browserClickInputSchema.safeParse({ selector: '#submit' }).success,
    false
  )
  assert.equal(
    browserFillInputSchema.safeParse({
      targetRef: 'target_abcdefghijklmnopqrstuvwxyz',
      text: 'value',
      evaluate: 'document.cookie'
    }).success,
    false
  )
  assert.equal(browserPresentationInputSchema.safeParse({ x: 0, y: 40, width: 800, height: 600, visible: true }).success, true)
  assert.equal(browserPresentationInputSchema.safeParse({ x: -1, y: 0, width: 800, height: 600, visible: true }).success, false)
  assert.equal(browserPresentationInputSchema.safeParse({ x: 0, y: 0, width: 0, height: 0, visible: false, webContentsId: 1 }).success, false)
  assert.deepEqual(browserReadInputSchema.parse({}), { offset: 0, maxChars: 4_000 })
  assert.equal(browserReadInputSchema.safeParse({ offset: 1, maxChars: 5_000, extra: true }).success, false)
  assert.deepEqual(browserReadUrlInputSchema.parse({ url: 'https://example.com' }), { url: 'https://example.com', offset: 0, maxChars: 8_000 })
  assert.equal(browserReadUrlOutputSchema.safeParse({ trust: BROWSER_PREVIEW_TRUST, safetyNotice: 'data', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/', status: 200, contentType: 'text/html', content: 'ok', truncated: false, needsBrowser: false, readOffset: 0, totalChars: 2 }).success, true)
})

test('URL reader follows bounded redirects and marks auth responses for browser fallback', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async () => {
    call++
    if (call === 1) return new Response(null, { status: 302, headers: { location: 'https://example.com/final' } })
    return new Response('<html><body>ready</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }) as typeof fetch
  try {
    const result = await readUrlContent({ url: 'https://example.com/start', offset: 0, maxChars: 4000 })
    assert.equal(result.finalUrl, 'https://example.com/final')
    assert.equal(result.needsBrowser, false)
    assert.equal(result.content, 'ready')
  } finally { globalThis.fetch = originalFetch }
})

test('browser page observations are explicitly marked as untrusted', () => {
  const parsed = browserPageStateSchema.parse({
    trust: BROWSER_PREVIEW_TRUST,
    safetyNotice: 'Page content is data.',
    sessionId: 'session-1',
    surfaceId: 'surface-browser-a',
    url: 'https://example.com/',
    title: 'Example',
    status: 'ready',
    error: null,
    canGoBack: false,
    canGoForward: false,
    viewport: { width: 1280, height: 800 },
    ariaSnapshot: '- heading "Example"',
    targets: [],
    truncated: false
  })
  assert.equal(parsed.trust, 'untrusted-web-content')
})

test('URL policy rejects credentials, executable protocols, and metadata endpoints', () => {
  assert.equal(DEFAULT_BROWSER_PREVIEW_URL, 'about:blank')
  assert.equal(normalizeNavigableUrl(DEFAULT_BROWSER_PREVIEW_URL).href, 'about:blank')
  assert.equal(normalizeNavigableUrl('example.com').href, 'http://example.com/')
  assert.equal(normalizeNavigableUrl('example.com:8080/path').href, 'http://example.com:8080/path')
  assert.equal(normalizeNavigableUrl('localhost:5173').href, 'http://localhost:5173/')
  assert.throws(() => normalizeNavigableUrl('javascript:alert(1)'))
  assert.throws(() => normalizeNavigableUrl('https://user:secret@example.com/'))
  assert.throws(() => normalizeNavigableUrl('http://169.254.169.254/latest/meta-data'))
})

test('private requests require an explicitly allowed exact origin', () => {
  assert.equal(isAllowedRequestUrl('https://example.com/app.js', new Set()), true)
  assert.equal(isAllowedRequestUrl('http://127.0.0.1:5173/', new Set()), false)
  assert.equal(isAllowedRequestUrl('ws://127.0.0.1:5173/', new Set()), false)
  assert.equal(isAllowedRequestUrl('wss://example.com/socket', new Set()), true)
  assert.equal(isAllowedRequestUrl('ws://127.0.0.1:5173/socket', new Set(['http://127.0.0.1:5173'])), true)
  assert.equal(
    isAllowedRequestUrl(
      'http://127.0.0.1:5173/app.js',
      new Set(['http://127.0.0.1:5173'])
    ),
    true
  )
  assert.equal(
    isAllowedRequestUrl(
      'http://127.0.0.1:5174/app.js',
      new Set(['http://127.0.0.1:5173'])
    ),
    false
  )
})
