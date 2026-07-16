import { describe, expect, it } from 'vitest'
import { datasetApiDisplayMetadata } from './codex-service'

describe('datasetApiDisplayMetadata', () => {
  it('preserves a bounded machine-readable metadata result beyond the text summary limit', () => {
    const longValue = 'x'.repeat(5_000)
    const response = {
      success: true,
      contentItems: [{
        type: 'inputText' as const,
        text: `structuredContent:\n${JSON.stringify({
          result: {
            source: { id: 'uniprot', name: 'UniProt REST' },
            response: { status: 200, bytes: 869_335 },
            metadata: { primaryAccession: 'P04637', description: longValue }
          }
        })}`
      }]
    }

    const display = datasetApiDisplayMetadata('mcp__dataset__dataset_api_metadata', response)
    expect(display).toMatchObject({
      toolName: 'dataset_api_metadata',
      success: true,
      result: {
        source: { id: 'uniprot' },
        metadata: { primaryAccession: 'P04637' }
      }
    })
    const description = ((display?.result as Record<string, unknown>).metadata as Record<string, unknown>).description
    expect(String(description).length).toBeLessThan(1_100)
  })

  it('ignores non-Dataset dynamic tools', () => {
    expect(datasetApiDisplayMetadata('gui_workspace_read', {
      success: true,
      contentItems: [{ type: 'inputText', text: 'structuredContent:\n{"result":{"ok":true}}' }]
    })).toBeUndefined()
  })
})
