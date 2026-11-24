import { describe, expect, it } from 'vitest'
import { knowledgeNoteSchema, NOTE_LAYER_MAX_CHARS } from './contract.js'

const valid = {
  definition: 'Eccentricity bias: cortical response varies with retinal eccentricity.',
  roleInPaper: 'The paper uses it to explain the scene-selective layout.',
  argumentativeRelation: { relation: 'support', detail: 'Supports the central claim.' },
  criticalExtension: 'Feedforward accounts are not excluded.'
}

describe('knowledgeNoteSchema', () => {
  it('accepts a complete note and one without relation detail', () => {
    expect(knowledgeNoteSchema.safeParse(valid).success).toBe(true)
    expect(knowledgeNoteSchema.safeParse({
      ...valid, argumentativeRelation: { relation: 'qualify' }
    }).success).toBe(true)
  })

  it('rejects a fifth layer', () => {
    expect(knowledgeNoteSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false)
  })

  it('rejects a relation outside the enum', () => {
    expect(knowledgeNoteSchema.safeParse({
      ...valid, argumentativeRelation: { relation: 'agree' }
    }).success).toBe(false)
  })

  it('rejects an oversized layer', () => {
    expect(knowledgeNoteSchema.safeParse({
      ...valid, definition: 'x'.repeat(NOTE_LAYER_MAX_CHARS + 1)
    }).success).toBe(false)
  })

  it('rejects a missing layer', () => {
    const { criticalExtension: _omitted, ...rest } = valid
    expect(knowledgeNoteSchema.safeParse(rest).success).toBe(false)
  })
})
