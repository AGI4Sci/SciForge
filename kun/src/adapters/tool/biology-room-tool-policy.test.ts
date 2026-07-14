import { describe, expect, it } from 'vitest'
import {
  biologyRoomApplyRequiresApproval,
  isBiologyRoomToolContext
} from './biology-room-tool-policy.js'

describe('biologyRoomApplyRequiresApproval', () => {
  it.each([
    'setActiveAsset',
    'setSelection',
    'setViewport',
    'setTrackVisibility',
    'setMolecularView'
  ])('allows viewer-only %s without approval', (type) => {
    expect(biologyRoomApplyRequiresApproval({ operations: [{ type }] })).toBe(false)
  })

  it.each([
    'addAsset',
    'removeAsset',
    'setTrackReference',
    'upsertAnnotation',
    'deleteAnnotation',
    'restoreRevision'
  ])('requires approval for persistent %s', (type) => {
    expect(biologyRoomApplyRequiresApproval({ operations: [{ type }] })).toBe(true)
  })

  it('treats dry runs as non-mutating even for protected operations', () => {
    expect(biologyRoomApplyRequiresApproval({
      dryRun: true,
      operations: [{ type: 'restoreRevision' }]
    })).toBe(false)
  })

  it.each([
    {},
    { operations: [] },
    { operations: [{ type: 'futureMutation' }] },
    { operations: [null] },
    { operations: [{ type: 42 }] }
  ])('fails closed for malformed or unknown operations: %j', (args) => {
    expect(biologyRoomApplyRequiresApproval(args as Record<string, unknown>)).toBe(true)
  })
})

describe('isBiologyRoomToolContext', () => {
  it.each([
    'Active Biology Room context: protein review',
    'Annotate residue 42 in the protein structure',
    'Open variants.vcf against the genome reference',
    '给这个蛋白结构的活性位点添加批注'
  ])('recognizes relevant room requests: %s', (text) => {
    expect(isBiologyRoomToolContext(text)).toBe(true)
  })

  it.each([
    undefined,
    'Research the latest coding agents',
    'Refactor the settings panel',
    'Summarize this PDF'
  ])('hides Biology Room tools from unrelated requests: %s', (text) => {
    expect(isBiologyRoomToolContext(text)).toBe(false)
  })
})
