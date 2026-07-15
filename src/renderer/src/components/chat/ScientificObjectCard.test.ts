import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ScientificObjectAnnotation,
  ScientificObjectModality,
  ScientificObjectRef
} from '@shared/scientific-objects'
import type { WorkspaceObservation } from '@shared/workspace-preview'
import {
  ScientificObjectCard,
  scientificObjectCardViewModel,
  summarizeScientificObjectSelection
} from './ScientificObjectCard'

const HASH = 'a'.repeat(64)

function objectFixture(
  modality: ScientificObjectModality,
  observationPatch: Partial<WorkspaceObservation> = {},
  overrides: Partial<ScientificObjectRef> = {}
): ScientificObjectRef {
  const path = `/workspace/${modality}.${modality === 'molecular' ? 'pdb' : 'dat'}`
  const observation: WorkspaceObservation = {
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
    mimeType: modality === 'molecular' ? 'chemical/x-pdb' : 'application/octet-stream',
    hash: { algorithm: 'sha256', digest: HASH },
    observation,
    ...overrides
  }
}

describe('scientificObjectCardViewModel', () => {
  it.each([
    {
      modality: 'molecular' as const,
      observation: { molecular: { modelCount: 2, chains: ['A', 'B'], ligands: ['ATP'] } },
      expected: ['Models', '2', 'Chains', '2 · A, B', 'Ligands', '1 · ATP']
    },
    {
      modality: 'sequence' as const,
      observation: { sequence: { sequenceCount: 3, totalLength: 4200, alphabet: 'dna' as const, features: [] } },
      expected: ['Sequences', '3', 'Length', '4,200', 'Alphabet', 'dna']
    },
    {
      modality: 'spectra' as const,
      observation: { spectra: { spectrumCount: 12, peakCount: 850, scanCount: 4, xAxis: 'm/z', mzRange: { min: 50, max: 1600 } } },
      expected: ['Spectra', '12', 'Peaks', '850', 'm/z range', '50–1,600']
    },
    {
      modality: 'omics' as const,
      observation: { omics: { format: 'h5ad', matrixShape: [120, 4800] as [number, number], observationCount: 120, variableCount: 4800 } },
      expected: ['Format', 'h5ad', 'Matrix', '120 × 4,800', 'Variables', '4,800']
    },
    {
      modality: 'bioimaging' as const,
      observation: { bioimaging: { format: 'ome-tiff', channels: ['DAPI', 'GFP'], dimensions: { width: 2048, height: 1024, z: 12, t: 3 } } },
      expected: ['Format', 'ome-tiff', 'Dimensions', '2,048 × 1,024 · Z=12 · T=3', 'Channels', '2 · DAPI, GFP']
    }
  ])('builds a recognizable $modality summary', ({ modality, observation, expected }) => {
    const model = scientificObjectCardViewModel(objectFixture(modality, observation))
    const flattened = model.facts.flatMap((fact) => [fact.label, fact.value])
    for (const value of expected) expect(flattened).toContain(value)
  })

  it('falls back to source and MIME format when observations are absent', () => {
    const object = objectFixture('sequence', {}, { observation: undefined, mimeType: 'text/fasta' })
    const model = scientificObjectCardViewModel(object)

    expect(model.sourceLabel).toBe('sequence.dat')
    expect(model.formatLabel).toBe('FASTA')
    expect(model.facts).toEqual([])
  })
})

describe('ScientificObjectCard', () => {
  it('renders a compact molecular card with one workspace action and selection context', () => {
    const object = objectFixture(
      'molecular',
      { molecular: { modelCount: 1, chains: ['A'], ligands: ['ATP'] } },
      { selection: { kind: 'molecular', chains: ['A'] } }
    )
    const html = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object,
      compact: true,
      onOpenWorkspace: vi.fn(),
      onAskAboutSelection: vi.fn()
    }))

    expect(html).toContain('<article')
    expect(html).toContain('data-scientific-object-modality="molecular"')
    expect(html).toContain('Open in workspace')
    expect(html).toContain('Ask about current selection')
    expect(html).toContain('molecular · 1 chains')
    expect(html).not.toContain('interactive 3D')
  })

  it('uses a static placeholder for non-molecular modalities and exposes an injectable preview seam', () => {
    const sequenceHtml = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture('sequence')
    }))
    const customHtml = renderToStaticMarkup(createElement(ScientificObjectCard, {
      object: objectFixture('bioimaging'),
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
      object: objectFixture('molecular'),
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
      object: objectFixture('sequence'),
      compact: true,
      onAskAboutSelection: vi.fn()
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('Select a chain, residue, atom, or ligand first')
  })
})

describe('summarizeScientificObjectSelection', () => {
  it('summarizes bounded structured selection counts', () => {
    expect(summarizeScientificObjectSelection({
      kind: 'molecular',
      chains: ['A', 'B'],
      ligands: ['ATP']
    })).toBe('molecular · 2 chains · 1 ligands')
  })
})
