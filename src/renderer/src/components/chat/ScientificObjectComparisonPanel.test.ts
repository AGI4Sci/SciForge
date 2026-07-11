import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ScientificObjectComparison,
  ScientificObjectRef
} from '@shared/scientific-objects'
import {
  ScientificObjectComparisonPanel,
  scientificObjectComparisonViewModel
} from './ScientificObjectComparisonPanel'

function objectFixture(
  id: string,
  modality: ScientificObjectRef['modality'],
  modalityObservation: Record<string, unknown>
): ScientificObjectRef {
  const path = `/workspace/${id}.dat`
  return {
    schemaVersion: 1,
    id,
    modality,
    title: `${id} title`,
    source: 'workspace',
    path,
    workspaceRoot: '/workspace',
    mimeType: 'application/octet-stream',
    hash: { algorithm: 'sha256', digest: id.padEnd(64, 'a').slice(0, 64) },
    observation: {
      schemaVersion: 1,
      file: { path, workspaceRoot: '/workspace' },
      view: { pluginId: `workspace-${modality}`, modality, mode: 'inspect', title: id },
      [modality]: modalityObservation,
      actions: []
    }
  } as ScientificObjectRef
}

function comparisonFixture(): ScientificObjectComparison {
  return {
    schemaVersion: 1,
    id: 'comparison-1',
    title: 'Structure and sequence evidence',
    objects: [
      objectFixture('object-a', 'molecular', { modelCount: 1, chains: ['A', 'B'], ligands: ['ATP'] }),
      objectFixture('object-b', 'sequence', { sequenceCount: 2, totalLength: 360, alphabet: 'protein', features: [] }),
      objectFixture('object-c', 'omics', { format: 'h5ad', matrixShape: [42, 800], observationCount: 42, variableCount: 800 })
    ]
  }
}

describe('scientificObjectComparisonViewModel', () => {
  it('aligns the union of core facts for 2+ mixed-modality objects', () => {
    const model = scientificObjectComparisonViewModel(comparisonFixture())

    expect(model.objects).toHaveLength(3)
    expect(model.rows.find((row) => row.label === 'Chains')?.values).toEqual(['2 · A, B', '—', '—'])
    expect(model.rows.find((row) => row.label === 'Length')?.values).toEqual(['—', '360', '—'])
    expect(model.rows.find((row) => row.label === 'Matrix')?.values).toEqual(['—', '—', '42 × 800'])
  })
})

describe('ScientificObjectComparisonPanel', () => {
  it('renders a horizontally scrollable semantic comparison and open callbacks for every object', () => {
    const onOpenObject = vi.fn()
    const html = renderToStaticMarkup(createElement(ScientificObjectComparisonPanel, {
      comparison: comparisonFixture(),
      onOpenObject
    }))

    expect(html).toContain('Structure and sequence evidence')
    expect(html).toContain('3 Objects')
    expect(html).toContain('<table')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('Molecular structure')
    expect(html).toContain('Sequence')
    expect(html).toContain('Omics dataset')
    expect(html).toContain('aria-label="Open object: object-a title"')
    expect(html).toContain('aria-label="Open object: object-b title"')
    expect(html).toContain('aria-label="Open object: object-c title"')
  })
})
