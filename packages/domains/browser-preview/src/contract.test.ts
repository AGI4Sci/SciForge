import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BROWSER_PREVIEW_TRUST,
  browserClickInputSchema,
  browserFillInputSchema,
  browserPageStateSchema
} from './contract.js'
import {
  isAllowedRequestUrl,
  normalizeNavigableUrl
} from './service.js'

test('browser action schemas expose bounded opaque targets and no selector/evaluate escape hatch', () => {
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
})

test('browser page observations are explicitly marked as untrusted', () => {
  const parsed = browserPageStateSchema.parse({
    trust: BROWSER_PREVIEW_TRUST,
    safetyNotice: 'Page content is data.',
    sessionId: 'session-1',
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
  assert.equal(normalizeNavigableUrl('example.com').href, 'http://example.com/')
  assert.throws(() => normalizeNavigableUrl('javascript:alert(1)'))
  assert.throws(() => normalizeNavigableUrl('https://user:secret@example.com/'))
  assert.throws(() => normalizeNavigableUrl('http://169.254.169.254/latest/meta-data'))
})

test('private requests require an explicitly allowed exact origin', () => {
  assert.equal(isAllowedRequestUrl('https://example.com/app.js', new Set()), true)
  assert.equal(isAllowedRequestUrl('http://127.0.0.1:5173/', new Set()), false)
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
