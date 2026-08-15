import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeSvgForPreview } from './safe-svg.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

test('sanitizes executable, foreign-document, and external-fetch SVG content', () => {
  const sanitized = decoder.decode(sanitizeSvgForPreview(encoder.encode([
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">',
    '<defs><linearGradient id="local"><stop offset="0" stop-color="red"/></linearGradient></defs>',
    '<script>globalThis.compromised = true</script>',
    '<foreignObject><iframe src="https://example.invalid/private"/></foreignObject>',
    '<image href="https://example.invalid/pixel.png"/>',
    '<use href="https://example.invalid/icons.svg#secret"/>',
    '<a href="https://example.invalid"><rect width="10" height="10"/></a>',
    '<rect width="120" height="80" fill="url(https://example.invalid/paint)"/>',
    '<circle cx="4" cy="4" r="2" fill="url(#local)" onclick="alert(1)"/>',
    '</svg>'
  ].join(''))))

  assert.match(sanitized, /^<svg\b/u)
  assert.match(sanitized, /fill="url\(#local\)"/u)
  assert.doesNotMatch(sanitized, /script|foreignObject|iframe|<image|<use|<a\b/iu)
  assert.doesNotMatch(sanitized, /example\.invalid|onclick/iu)
})

test('enforces the 20k element and 256-level nesting budgets', () => {
  assert.throws(
    () => sanitizeSvgForPreview(encoder.encode(`<svg>${'<rect/>'.repeat(20_000)}</svg>`)),
    /exceeds 20000 elements/u
  )
  assert.throws(
    () => sanitizeSvgForPreview(encoder.encode(`<svg>${'<g>'.repeat(256)}${'</g>'.repeat(256)}</svg>`)),
    /exceeds nesting depth 256/u
  )
})
