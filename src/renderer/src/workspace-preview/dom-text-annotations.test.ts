import { describe, expect, it } from 'vitest'
import {
  createDocumentTextAnchor,
  documentTextPositionAtOffset,
  isNewDocumentNavigationRequest,
  resolveDocumentTextAnchor
} from './dom-text-annotations'

describe('DOM text annotation anchors', () => {
  it('creates a trimmed text anchor with stable offsets, context, and line positions', () => {
    const text = 'Heading\n\nAlpha beta cells gamma\nTail'
    const start = text.indexOf(' beta')
    const anchor = createDocumentTextAnchor(text, start, start + ' beta cells '.length)

    expect(anchor).toMatchObject({
      from: text.indexOf('beta cells'),
      to: text.indexOf('beta cells') + 'beta cells'.length,
      quote: 'beta cells',
      contextBefore: 'Heading Alpha',
      contextAfter: 'gamma Tail',
      start: { line: 3, column: 7 },
      end: { line: 3, column: 17 }
    })
  })

  it('uses quote context to resolve the intended duplicate occurrence', () => {
    const text = 'First target before. Middle target after. Last.'
    const anchor = resolveDocumentTextAnchor(text, {
      quote: 'target',
      contextBefore: 'before. Middle',
      contextAfter: 'after. Last'
    })

    expect(anchor?.from).toBe(text.lastIndexOf('target'))
    expect(anchor?.quote).toBe('target')
  })

  it('prefers a valid stable text range and falls back when the range is stale', () => {
    const text = 'First target. Second target.'
    const secondTarget = text.lastIndexOf('target')

    expect(resolveDocumentTextAnchor(text, {
      quote: 'target',
      textRange: { start: secondTarget, end: secondTarget + 'target'.length }
    })?.from).toBe(secondTarget)
    expect(resolveDocumentTextAnchor(text, {
      quote: 'target',
      contextBefore: 'Second',
      textRange: { start: 0, end: 5 }
    })?.from).toBe(secondTarget)
  })

  it('matches annotations across rendered whitespace without losing DOM offsets', () => {
    const text = 'Alpha\n  beta\t cells\nGamma'
    const anchor = resolveDocumentTextAnchor(text, {
      quote: 'beta cells',
      contextBefore: 'Alpha',
      contextAfter: 'Gamma'
    })

    expect(anchor).toMatchObject({
      from: text.indexOf('beta'),
      to: text.indexOf('cells') + 'cells'.length,
      quote: 'beta cells'
    })
  })

  it('returns no anchor for empty or missing quotes', () => {
    expect(resolveDocumentTextAnchor('Alpha beta', { quote: '' })).toBeNull()
    expect(resolveDocumentTextAnchor('Alpha beta', { quote: 'gamma' })).toBeNull()
    expect(createDocumentTextAnchor('Alpha beta', 3, 3)).toBeNull()
  })

  it('treats navigation as an explicit request-id event', () => {
    const request = {
      requestId: 'locate-2',
      threadId: 'thread-1',
      quote: 'beta'
    }
    expect(isNewDocumentNavigationRequest(null, request)).toBe(true)
    expect(isNewDocumentNavigationRequest('locate-1', request)).toBe(true)
    expect(isNewDocumentNavigationRequest('locate-2', request)).toBe(false)
    expect(isNewDocumentNavigationRequest('locate-2', null)).toBe(false)
    expect(documentTextPositionAtOffset('A\nBC', 3)).toEqual({ line: 2, column: 2 })
  })
})
