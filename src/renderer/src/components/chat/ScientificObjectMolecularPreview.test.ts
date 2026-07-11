import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  SCIENTIFIC_OBJECT_SCHEMA_VERSION,
  type ScientificObjectRef
} from '@shared/scientific-objects'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import ScientificObjectMolecularPreview, {
  createScientificObjectMolecularChainSelection,
  createScientificObjectMolecularLigandSelection,
  createScientificObjectMolecularPreviewOpenInput,
  resolveScientificObjectMolecularPreviewTarget,
  resolveScientificObjectMolecularSelection
} from './ScientificObjectMolecularPreview'

const SHA256 = 'a'.repeat(64)

function createMolecularObservation(): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/protein.pdb',
      workspaceRoot: '/workspace/lab',
      mimeType: 'chemical/x-pdb',
      size: 1024
    },
    view: {
      pluginId: 'molecular',
      modality: 'molecular',
      mode: 'inspect',
      title: 'Protein structure'
    },
    selection: {
      kind: 'molecular',
      chains: ['A']
    },
    molecular: {
      modelCount: 1,
      chains: ['A', 'B'],
      ligands: ['ATP']
    },
    actions: ['molecular.workbench', 'workspace.setSelection']
  }
}

function createMolecularObject(
  overrides: Partial<ScientificObjectRef> = {}
): ScientificObjectRef {
  return {
    schemaVersion: SCIENTIFIC_OBJECT_SCHEMA_VERSION,
    id: 'object-protein',
    modality: 'molecular',
    title: 'Protein structure',
    source: 'workspace',
    path: '/workspace/lab/protein.pdb',
    workspaceRoot: '/workspace/lab',
    mimeType: 'chemical/x-pdb',
    hash: {
      algorithm: 'sha256',
      digest: SHA256
    },
    observation: createMolecularObservation(),
    ...overrides
  }
}

describe('ScientificObjectMolecularPreview', () => {
  it('resolves only workspace-backed molecular formats supported by Mol*', () => {
    expect(resolveScientificObjectMolecularPreviewTarget(createMolecularObject())).toEqual({
      ok: true,
      path: '/workspace/lab/protein.pdb',
      workspaceRoot: '/workspace/lab',
      mimeType: 'chemical/x-pdb'
    })

    expect(resolveScientificObjectMolecularPreviewTarget(createMolecularObject({
      path: '/workspace/lab/model.unsupported',
      observation: undefined
    }))).toEqual({
      ok: false,
      reason: 'Mol* does not support the molecular format for model.unsupported.'
    })

    const sequenceObject: ScientificObjectRef = {
      ...createMolecularObject({ observation: undefined }),
      modality: 'sequence'
    }
    expect(resolveScientificObjectMolecularPreviewTarget(sequenceObject)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('only renders molecular')
    })
  })

  it('creates an integrity-checked workspace-preview open request without embedding asset data', () => {
    const input = createScientificObjectMolecularPreviewOpenInput(
      createMolecularObject(),
      { kind: 'molecular', ligands: ['ATP'] }
    )

    expect(input).toEqual({
      path: '/workspace/lab/protein.pdb',
      workspaceRoot: '/workspace/lab',
      mimeType: 'chemical/x-pdb',
      mode: 'inspect',
      selection: { kind: 'molecular', ligands: ['ATP'] },
      integrity: {
        algorithm: 'sha256',
        expectedDigest: SHA256
      }
    })
    expect(JSON.stringify(input)).not.toContain('base64')
    expect(JSON.stringify(input)).not.toContain('data:')
  })

  it('prefers the controlled molecular selection, then object and observation selections', () => {
    const controlled: WorkspaceStructuredSelection = {
      kind: 'molecular',
      ligands: ['ATP']
    }
    const object = createMolecularObject({
      selection: { kind: 'molecular', chains: ['B'] }
    })

    expect(resolveScientificObjectMolecularSelection(object, controlled)).toBe(controlled)
    expect(resolveScientificObjectMolecularSelection(object)).toEqual({
      kind: 'molecular',
      chains: ['B']
    })
    expect(resolveScientificObjectMolecularSelection(createMolecularObject())).toEqual({
      kind: 'molecular',
      chains: ['A']
    })
    expect(resolveScientificObjectMolecularSelection(object, {
      kind: 'sequence',
      sequenceId: 'seq-1',
      ranges: [{ start: 1, end: 5 }]
    })).toEqual({
      kind: 'molecular',
      chains: ['B']
    })
  })

  it('creates compact structured selections for card-level chain and ligand controls', () => {
    expect(createScientificObjectMolecularChainSelection('A')).toEqual({
      kind: 'molecular',
      chains: ['A']
    })
    expect(createScientificObjectMolecularLigandSelection('ATP')).toEqual({
      kind: 'molecular',
      ligands: ['ATP']
    })
  })

  it('renders a lazy loading viewport and compact quick selections without the workspace inspector', () => {
    const markup = renderToStaticMarkup(createElement(ScientificObjectMolecularPreview, {
      object: createMolecularObject(),
      className: 'custom-preview'
    }))

    expect(markup).toContain('data-scientific-object-molecular-preview="true"')
    expect(markup).toContain('data-preview-state="loading"')
    expect(markup).toContain('Connecting molecular preview')
    expect(markup).toContain('data-molecular-select-chain="A"')
    expect(markup).toContain('data-molecular-select-chain="B"')
    expect(markup).toContain('data-molecular-select-ligand="ATP"')
    expect(markup).not.toContain('data-molecular-workbench-inspector')
  })

  it('renders a stable fallback instead of attempting Mol* for another modality', () => {
    const sequenceObject: ScientificObjectRef = {
      ...createMolecularObject({ observation: undefined }),
      modality: 'sequence',
      title: 'Genome sequence'
    }
    const markup = renderToStaticMarkup(createElement(ScientificObjectMolecularPreview, {
      object: sequenceObject
    }))

    expect(markup).toContain('data-preview-state="fallback"')
    expect(markup).toContain('Static molecular card')
    expect(markup).toContain('only renders molecular scientific objects')
  })
})
