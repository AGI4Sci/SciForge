import { describe, expect, it } from 'vitest'
import {
  MAX_COMPOSER_COMMENT_REFERENCES,
  MAX_COMPOSER_COMMENT_TEXT_CHARS,
  buildAnchoredCommentContextPrompt
} from './anchored-comment-chat'

describe('buildAnchoredCommentContextPrompt', () => {
  it('returns the original prompt without selected comments', () => {
    expect(buildAnchoredCommentContextPrompt('Explain this result.', [])).toBe('Explain this result.')
  })

  it('renders selected comments without granting automatic modification permission', () => {
    const prompt = buildAnchoredCommentContextPrompt('What should I change?', [{
      id: 'comment-1',
      label: 'Figure 2 · peak 3',
      comment: 'This peak looks shifted.',
      route: 'chat',
      anchor: { kind: 'component', componentId: 'figure-preview', elementId: 'peak-3' }
    }])
    expect(prompt).toContain('comment-1')
    expect(prompt).toContain('This peak looks shifted.')
    expect(prompt).toContain('not automatic permission')
    expect(prompt.endsWith('What should I change?')).toBe(true)
  })

  it('bounds the reference count and comment length', () => {
    const prompt = buildAnchoredCommentContextPrompt('Continue.', Array.from(
      { length: MAX_COMPOSER_COMMENT_REFERENCES + 2 },
      (_, index) => ({
        id: `comment-${index}`,
        label: `Target ${index}`,
        comment: index === 0 ? 'x'.repeat(MAX_COMPOSER_COMMENT_TEXT_CHARS + 100) : `Note ${index}`
      })
    ))
    expect(prompt).toContain('comment-7')
    expect(prompt).not.toContain('comment-8')
    expect(prompt).not.toContain('x'.repeat(MAX_COMPOSER_COMMENT_TEXT_CHARS + 1))
  })
})

