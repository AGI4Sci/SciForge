import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ScientificObjectAnnotation,
  ScientificObjectRef
} from '@shared/scientific-objects'
import {
  workspacePreviewExtensionIdSchema,
  workspacePreviewModalitySchema
} from '@shared/workspace-preview'
import {
  ScientificObjectCard,
  scientificObjectCardViewModel,
  summarizeScientificObjectSelection
} from './ScientificObjectCard'

const HASH = 'a'.repeat(64)
const MOLECULAR_MODALITY = 'sciforge.life-science-preview.molecular'
const MOLECULAR_SELECTION_TYPE = workspacePreviewExtensionIdSchema.parse(
  'sciforge.life-science-preview.molecular.selection'
)
type ScientificObjectObservation = NonNullable<ScientificObjectRef['observation']>

function objectFixture(
  modalityInput: ScientificObjectRef['modality'],
  observationPatch: Partial<ScientificObjectObservation> = {},
  overrides: Partial<ScientificObjectRef> = {}
): ScientificObjectRef {
  const modality = workspacePreviewModalitySchema.parse(modalityInput)
  const path = `/workspace/${modality}.dat`
  const observation: ScientificObjectObservation = {
    schemaVersion: 1,
    file: {
      path,
      workspaceRoot: '/workspace',
      mimeType: 'application/octet-stream'
    },
    view: {
      pluginId: `workspace-${modality}`,
      modality,
      mode: 'inspect',
      title: `${modality} observation`
    },
    actions: [],
    ...observationPatch
  }
  return {
    schemaVersion: 1,
    id: `${modality}-1`,
    modality,
    title: `${modality} example`,
    source: 'workspace',
    path,
    workspaceRoot: '/workspace',
    mimeType: 'application/octet-stream',
    hash: { algorithm: 'sha256', digest: HASH },
    observation,
    ...overrides
  }
}

describe('scientificObjectCardViewModel', () => {
  it('falls back to source and MIME format when observations are absent', () => {
    const object = objectFixture('genomics.sequence', {}, { observation: undefined, mimeType: 'text/fasta' })
    const model = scientificObjectCardViewModel(object)

    expect(model.sourceLabel).toBe('genomics.sequence.dat')
    expect(model.formatLabel).toBe('FASTA')
    expect(model.facts).toEqual([])
  })

  it('renders a custom modality with generic metadata instead of coercing it to a core modality', () => {
    const object: ScientificObjectRef = {
      schemaVersion: 1,
      id: 'terrain-1',
      modality: 'geospatial-terrain',
      title: 'Terrain survey',
      source: 'tool',
      path: '/workspace/terrain.geojson',
      workspaceRoot: '/workspace',
      mimeType: 'application/geo+json',
      hash: { algorithm: 'sha256', digest: HASH },
      metadata: {
        'geospatial-terrain': {
          coordinateReferenceSystem: 'EPSG:4326',
          featureCount: 128,
          bounds: [-180, -90, 180, 90]
        }
      }
    }

    const model = scientificObjectCardViewModel(object)
    const html = renderToStaticMarkup(createElement(ScientificObjectCard, { object }))

    expect(model.modality).toBe('geospatial-terrain')
    expect(model.modalityLabel).toBe('Geospatial Terrain')
    expect(model.facts).toEqual([
      { label: 'Coordinate Reference System', value: 'EPSG:4326' },
      { label: 'Feature Count', value: '128' },
      { label: 'Bounds', value: '4 · -180, -90, 180, …' }
    ])
    expect(html).toContain('data-scientific-object-modality="geospatial-terrain"')
    expect(html).toContain('aria-label="Geospatial Terrain"')
    expect(html).not.toContain('Molecular structure')
  })
})

describe('ScientificObjectCard', () => {
  it('renders a compact domain card with one workspace action and selection context', () => {
    const object = objectFixture(
      MOLECULAR_MODALITY,
      {},
      {
        metadata: {
          [MOLECULAR_MODALITY]: { modelCount: 1, chains: ['A'], ligands: ['ATP'] }
        },
        selection: {
          kind: 'domain',
          selectionType: MOLECULAR_SELECTION_TYPE,
          data: { wireVersion: 2, selection: { kind: 'molecular', chains: ['A'] } }
        }
      }
    )
    const html = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object,
      compact: true,
      onOpenWorkspace: vi.fn(),
      onAskAboutSelection: vi.fn()
    }))

    expect(html).toContain('<article')
    expect(html).toContain(`data-scientific-object-modality="${MOLECULAR_MODALITY}"`)
    expect(html).toContain('Open in workspace')
    expect(html).toContain('Ask about current selection')
    expect(html).toContain('molecular · 1 chains')
    expect(html).not.toContain('interactive 3D')
  })

  it('uses a static placeholder for arbitrary modalities and exposes an injectable preview seam', () => {
    const sequenceHtml = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture('genomics.sequence')
    }))
    const customHtml = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture('microscopy.image-stack'),
      renderStaticPreview: () => createElement('div', { 'data-testid': 'safe-thumbnail' }, 'Resolved thumbnail')
    }))

    expect(sequenceHtml).toContain('aria-label="Sequence"')
    expect(sequenceHtml).not.toContain('interactive 3D')
    expect(customHtml).toContain('data-testid="safe-thumbnail"')
    expect(customHtml).toContain('Resolved thumbnail')
  })

  it('shows annotations and callback-backed add/delete controls', () => {
    const annotation: ScientificObjectAnnotation = {
      schemaVersion: 1,
      id: 'annotation-1',
      target: { kind: 'object', objectId: 'molecular-1' },
      kind: 'note',
      text: 'Conserved ATP-binding pocket',
      authorId: 'researcher-1',
      createdAt: '2026-07-11T00:00:00.000Z'
    }
    const html = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture(MOLECULAR_MODALITY),
      annotations: [annotation],
      compact: true,
      onAddAnnotation: vi.fn(),
      onDeleteAnnotation: vi.fn()
    }))

    expect(html).toContain('Annotations · 1')
    expect(html).toContain('Conserved ATP-binding pocket')
    expect(html).toContain('researcher-1')
    expect(html).toContain('Add annotation')
    expect(html).toContain('aria-label="Delete annotation: Conserved ATP-binding pocket"')
  })

  it('disables selection questions when no structured selection exists', () => {
    const html = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture('genomics.sequence'),
      compact: true,
      onAskAboutSelection: vi.fn()
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('Select an item or region first')
  })
})

describe('summarizeScientificObjectSelection', () => {
  it('summarizes bounded structured selection counts', () => {
    expect(summarizeScientificObjectSelection({
      kind: 'domain',
      selectionType: MOLECULAR_SELECTION_TYPE,
      data: {
        wireVersion: 2,
        selection: { kind: 'molecular', chains: ['A', 'B'], ligands: ['ATP'] }
      }
    })).toBe('molecular · 2 chains · 1 ligands')
  })
})
