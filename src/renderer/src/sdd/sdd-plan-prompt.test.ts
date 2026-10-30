import { describe, expect, it } from 'vitest'
import { buildSddDraftToPlanPrompt } from './sdd-plan-prompt'
import type { SddDraftImageReference } from './sdd-draft-images'

function image(partial: Partial<SddDraftImageReference> = {}): SddDraftImageReference {
  return {
    index: 1,
    alt: 'wireframe',
    markdownPath: 'img/wireframe.png',
    relativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/img/wireframe.png',
    mimeType: 'image/png',
    dataBase64: 'ZmFrZS1pbWFnZQ==',
    byteSize: 10,
    width: 320,
    height: 240,
    ...partial
  }
}

describe('buildSddDraftToPlanPrompt', () => {
  it('keeps Markdown image syntax and maps visual attachments by image number', () => {
    const prompt = buildSddDraftToPlanPrompt({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      planRelativePath: '.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md',
      draftMarkdown: '# Need login\n\n![wireframe](img/wireframe.png)',
      imageMode: 'attachments',
      images: [image({ attachmentId: 'att_1' })]
    })

    expect(prompt).toContain('![wireframe](img/wireframe.png)')
    expect(prompt).toContain('Image Reference Map:')
    expect(prompt).toContain('Image 1: img/wireframe.png')
    expect(prompt).toContain('Attachment: att_1')
    expect(prompt).toContain('You MUST use the `create_plan` tool exactly once')
    expect(prompt).toContain('Reserved plan file: .sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md')
    expect(prompt).toContain('`plan_relative_path` to `.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md`')
  })

  it('includes base64 fallback when visual attachments are unavailable', () => {
    const prompt = buildSddDraftToPlanPrompt({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      planRelativePath: '.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md',
      draftMarkdown: '# Need login\n\n![wireframe](img/wireframe.png)',
      imageMode: 'base64',
      images: [image()]
    })

    expect(prompt).toContain('base64 text')
    expect(prompt).toContain('MIME: image/png')
    expect(prompt).toContain('Dimensions: 320x240')
    expect(prompt).toContain('```base64\nZmFrZS1pbWFnZQ==\n```')
  })

  it('includes sidebar Requirement AI conversation context when provided', () => {
    const prompt = buildSddDraftToPlanPrompt({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      planRelativePath: '.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md',
      draftMarkdown: '# Need login',
      assistantContext: 'Requirement AI:\nConfirm OAuth edge cases.',
      imageMode: 'none',
      images: []
    })

    expect(prompt).toContain('Requirement AI conversation context:')
    expect(prompt).toContain('Confirm OAuth edge cases.')
  })

  it('requires covers tags for structured requirement blocks', () => {
    const prompt = buildSddDraftToPlanPrompt({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      planRelativePath: '.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md',
      draftMarkdown: [
        '### R-1: Login form {draft}',
        '- [ ] User can submit credentials',
        '',
        '### R-2: Error state',
        '- [ ] Invalid credentials show a message'
      ].join('\n'),
      imageMode: 'none',
      images: []
    })

    expect(prompt).toContain('Requirement traceability (covers tags):')
    expect(prompt).toContain('`### R-1: title {status}`')
    expect(prompt).toContain('(covers: R-1)')
    expect(prompt).toContain('Do not leave any R-id uncovered')
    expect(prompt).toContain('do not invent R-ids')
  })
})
