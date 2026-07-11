import { describe, expect, it } from 'vitest'
import {
  extractScientificObjectComparisons,
  extractScientificObjectMetadata,
  extractScientificObjects,
  extractWorkspaceObservations,
  scientificObjectAnnotationSchema,
  scientificObjectComparisonSchema,
  scientificObjectRefSchema,
  type ScientificObjectModality,
  type ScientificObjectRef,
  type WorkspaceObservation
} from './scientific-objects'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)

function observation(
  path = '/workspace/structure.pdb',
  modality: ScientificObjectModality = 'molecular'
): WorkspaceObservation {
  return {
    schemaVersion: 1,
    file: {
      path,
      workspaceRoot: '/workspace',
      mimeType: 'chemical/x-pdb'
    },
    view: {
      pluginId: `workspace-${modality}`,
      modality,
      mode: 'preview',
      title: 'Scientific object'
    },
    actions: ['workspace.open']
  }
}

function scientificObject(overrides: Partial<ScientificObjectRef> = {}): ScientificObjectRef {
  return {
    schemaVersion: 1,
    id: 'structure-1',
    modality: 'molecular',
    title: 'Structure 1',
    source: 'workspace',
    path: '/workspace/structure.pdb',
    workspaceRoot: '/workspace',
    mimeType: 'chemical/x-pdb',
    hash: { algorithm: 'sha256', digest: DIGEST_A },
    ...overrides
  }
}

describe('scientific object contracts', () => {
  it.each<ScientificObjectModality>([
    'molecular',
    'sequence',
    'spectra',
    'omics',
    'bioimaging'
  ])('accepts the %s modality with stable source fields', (modality) => {
    const parsed = scientificObjectRefSchema.parse(scientificObject({
      id: `${modality}-1`,
      modality,
      path: `/workspace/${modality}.data`,
      mimeType: 'application/octet-stream',
      observation: observation(`/workspace/${modality}.data`, modality),
      preview: {
        kind: 'image',
        path: `/workspace/.previews/${modality}.png`,
        mimeType: 'image/png',
        alt: `${modality} preview`,
        width: 640,
        height: 480,
        hash: { algorithm: 'sha256', digest: DIGEST_B }
      },
      provenance: {
        sourceUri: `https://example.test/${modality}`,
        toolName: 'SciForge importer',
        toolVersion: '1.0.0',
        model: 'example-model',
        modelVersion: '2026-01',
        createdAt: '2026-07-11T00:00:00.000Z',
        metadata: { confidence: 0.98 }
      }
    }))

    expect(parsed.modality).toBe(modality)
    expect(parsed.hash.digest).toBe(DIGEST_A)
  })

  it('rejects unknown fields and inconsistent embedded observations', () => {
    expect(scientificObjectRefSchema.safeParse({
      ...scientificObject(),
      unexpected: true
    }).success).toBe(false)
    expect(scientificObjectRefSchema.safeParse(scientificObject({
      observation: observation('/workspace/other.pdb')
    })).success).toBe(false)
    expect(scientificObjectRefSchema.safeParse(scientificObject({
      observation: observation('/workspace/structure.pdb', 'sequence')
    })).success).toBe(false)
  })

  it('supports annotations targeting an object or a structured selection', () => {
    const objectAnnotation = scientificObjectAnnotationSchema.parse({
      schemaVersion: 1,
      id: 'annotation-object',
      target: { kind: 'object', objectId: 'structure-1' },
      text: 'Review the full structure.',
      createdAt: '2026-07-11T00:00:00.000Z'
    })
    const selectionAnnotation = scientificObjectAnnotationSchema.parse({
      schemaVersion: 1,
      id: 'annotation-selection',
      target: {
        kind: 'selection',
        objectId: 'structure-1',
        selection: {
          kind: 'molecular',
          chains: ['A'],
          residues: [{ chain: 'A', index: 42, name: 'GLY' }]
        }
      },
      kind: 'comment',
      text: 'This residue contacts the ligand.',
      createdAt: '2026-07-11T00:00:00.000Z'
    })

    const ref = scientificObjectRefSchema.parse(scientificObject({
      annotations: [objectAnnotation, selectionAnnotation]
    }))
    expect(ref.annotations).toHaveLength(2)
    expect(selectionAnnotation.target.kind).toBe('selection')
  })

  it('requires comparisons to contain at least two distinct objects', () => {
    const second = scientificObject({
      id: 'structure-2',
      path: '/workspace/structure-2.pdb',
      hash: { algorithm: 'sha256', digest: DIGEST_B }
    })
    expect(scientificObjectComparisonSchema.parse({
      schemaVersion: 1,
      id: 'comparison-1',
      objects: [scientificObject(), second]
    }).objects).toHaveLength(2)
    expect(scientificObjectComparisonSchema.safeParse({
      schemaVersion: 1,
      id: 'comparison-short',
      objects: [scientificObject()]
    }).success).toBe(false)
    expect(scientificObjectComparisonSchema.safeParse({
      schemaVersion: 1,
      id: 'comparison-duplicate',
      objects: [scientificObject(), scientificObject({ id: 'alias-id' })]
    }).success).toBe(false)
  })
})

describe('scientific object metadata extraction', () => {
  it('recursively extracts explicit camelCase and snake_case containers', () => {
    const first = scientificObject({ observation: observation() })
    const second = scientificObject({
      id: 'sequence-1',
      modality: 'sequence',
      path: '/workspace/sequence.fasta',
      mimeType: 'text/x-fasta',
      hash: { algorithm: 'sha256', digest: DIGEST_B }
    })
    const extraObservation = observation('/workspace/spectrum.mzML', 'spectra')
    const metadata = {
      outer: [{
        toolResult: {
          scientificObjects: [first, { invalid: true }],
          workspace_observations: [extraObservation]
        }
      }],
      nested: {
        scientific_objects: second,
        workspaceObservation: observation()
      }
    }

    const extracted = extractScientificObjectMetadata(metadata)
    expect(extracted.scientificObjects.map((item) => item.id)).toEqual(['structure-1', 'sequence-1'])
    expect(extracted.workspaceObservations.map((item) => item.file.path)).toEqual([
      '/workspace/structure.pdb',
      '/workspace/spectrum.mzML'
    ])
    expect(extractScientificObjects(metadata)).toHaveLength(2)
    expect(extractWorkspaceObservations(metadata)).toHaveLength(2)
  })

  it('extracts and deduplicates comparisons and their embedded objects', () => {
    const comparison = {
      schemaVersion: 1,
      id: 'comparison-1',
      objects: [
        scientificObject(),
        scientificObject({
          id: 'structure-2',
          path: '/workspace/structure-2.pdb',
          hash: { algorithm: 'sha256', digest: DIGEST_B }
        })
      ]
    }
    const metadata = {
      scientificObjectComparisons: [comparison, comparison],
      nested: { scientific_object_comparisons: comparison }
    }

    const extracted = extractScientificObjectMetadata(metadata)
    expect(extracted.comparisons.map((item) => item.id)).toEqual(['comparison-1'])
    expect(extracted.scientificObjects.map((item) => item.id)).toEqual(['structure-1', 'structure-2'])
    expect(extractScientificObjectComparisons(metadata)).toHaveLength(1)
  })

  it('deduplicates objects by stable content identity rather than display id', () => {
    const original = scientificObject()
    const alias = scientificObject({ id: 'another-message-alias', title: 'Same structure' })
    expect(extractScientificObjects({ scientificObjects: [original, alias] })).toEqual([original])
  })

  it('does not guess scientific objects from arbitrary object shapes', () => {
    const object = scientificObject()
    expect(extractScientificObjectMetadata({ result: object, objects: [object] })).toEqual({
      scientificObjects: [],
      comparisons: [],
      workspaceObservations: []
    })
    expect(extractScientificObjects([object])).toEqual([])
  })

  it('is cycle-safe, getter-safe, and skips malformed entries', () => {
    const cyclic: Record<string, unknown> = {
      scientificObjects: [scientificObject(), { modality: 'molecular' }]
    }
    cyclic.self = cyclic
    Object.defineProperty(cyclic, 'broken', {
      enumerable: true,
      get(): never {
        throw new Error('metadata getter failed')
      }
    })

    expect(() => extractScientificObjectMetadata(cyclic)).not.toThrow()
    expect(extractScientificObjects(cyclic)).toHaveLength(1)
    expect(extractScientificObjectMetadata(new Proxy({}, {
      ownKeys(): never {
        throw new Error('proxy failed')
      }
    }))).toEqual({ scientificObjects: [], comparisons: [], workspaceObservations: [] })
  })

  it('honors traversal depth, node, and result bounds', () => {
    const deeplyNested = { one: { two: { scientificObjects: [scientificObject()] } } }
    expect(extractScientificObjects(deeplyNested, { maxDepth: 1 })).toEqual([])
    expect(extractScientificObjects(deeplyNested, { maxDepth: 2 })).toHaveLength(1)

    const objects = Array.from({ length: 5 }, (_, index) => scientificObject({
      id: `structure-${index}`,
      path: `/workspace/structure-${index}.pdb`,
      hash: { algorithm: 'sha256', digest: index.toString(16).repeat(64) }
    }))
    expect(extractScientificObjects({ scientific_objects: objects }, { maxItems: 2 })).toHaveLength(2)
    expect(extractScientificObjects({ branch: { scientificObjects: objects } }, { maxNodes: 1 })).toEqual([])
  })
})
