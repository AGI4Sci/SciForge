import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import type { ScientificObjectRef } from '@shared/scientific-objects'
import {
  scientificObjectDataFromTimelineBlocks,
  scientificObjectSelectionPrompt
} from './TimelineScientificObjectsPanel'

function scientificObject(id: string, modality: ScientificObjectRef['modality']): ScientificObjectRef {
  return {
    schemaVersion: 1,
    id,
    modality,
    title: `${modality} object`,
    source: 'tool',
    path: `/workspace/${id}.dat`,
    workspaceRoot: '/workspace',
    mimeType: 'application/octet-stream',
    hash: { algorithm: 'sha256', digest: id.padEnd(64, 'a').slice(0, 64) }
  }
}

describe('TimelineScientificObjectsPanel', () => {
  it('extracts and deduplicates objects from assistant metadata and JSON tool results', () => {
    const molecule = scientificObject('1', 'molecular')
    const sequence = scientificObject('2', 'sequence')
    const blocks: ChatBlock[] = [
      { kind: 'assistant', id: 'assistant-1', text: 'Ready', meta: { scientificObjects: [molecule] } },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Scientific preview',
        status: 'success',
        detail: JSON.stringify({ scientific_objects: [molecule, sequence] })
      },
      {
        kind: 'tool',
        id: 'tool-error',
        summary: 'Failed preview',
        status: 'error',
        detail: JSON.stringify({ scientificObjects: [scientificObject('3', 'omics')] })
      }
    ]

    expect(scientificObjectDataFromTimelineBlocks(blocks).objects.map((object) => object.id))
      .toEqual(['1', '2'])
  })

  it('includes a structured, provenance-bound selection in the continue prompt', () => {
    const prompt = scientificObjectSelectionPrompt({
      object: scientificObject('1', 'molecular'),
      selection: { kind: 'molecular', chains: ['A'], ligands: ['ATP'] },
      language: 'zh-CN'
    })

    expect(prompt).toContain('当前结构化选择')
    expect(prompt).toContain('"chains": [')
    expect(prompt).toContain('sha256:')
    expect(prompt).toContain('/workspace/1.dat')
  })
})
