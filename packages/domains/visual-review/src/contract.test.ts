import { describe, expect, it } from 'vitest'
import {
  visualReviewActivationSchema,
  visualReviewOpenOutputSchema,
  visualReviewSaveAnnotationsInputSchema
} from './contract.js'

describe('Visual Review public contract', () => {
  it('accepts bounded artifact activation and rejects unknown fields', () => {
    expect(visualReviewActivationSchema.parse({
      documentId: 'figure-1',
      artifact: {
        kind: 'scientific_plot',
        sourcePath: 'outputs/figure.png'
      }
    })).toEqual({
      documentId: 'figure-1',
      artifact: {
        kind: 'scientific_plot',
        sourcePath: 'outputs/figure.png'
      }
    })
    expect(() => visualReviewActivationSchema.parse({
      documentId: 'figure-1',
      hostPath: '/private/host/state'
    })).toThrow()
    expect(() => visualReviewActivationSchema.parse({
      documentId: 'figure-1',
      artifact: {
        kind: 'presentation_slide',
        sourcePath: 'outputs/unsafe.svg'
      }
    })).toThrow('raster images')
  })

  it('requires geometry to stay inside normalized artifact bounds', () => {
    expect(() => visualReviewSaveAnnotationsInputSchema.parse({
      documentId: 'figure-1',
      annotations: [{
        geometry: {
          kind: 'box',
          bounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 }
        },
        instruction: 'Overflowing region'
      }]
    })).toThrow('Normalized bounds')
  })

  it('rejects partial or malformed capability output objects', () => {
    expect(() => visualReviewOpenOutputSchema.parse({
      ok: true,
      status: 'opened',
      workspaceRoot: '/workspace',
      document: { documentId: 'figure-1' },
      paths: {}
    })).toThrow()
  })
})
