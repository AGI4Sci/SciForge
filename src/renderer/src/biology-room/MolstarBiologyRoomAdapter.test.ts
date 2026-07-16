import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  BiologyRoomAsset,
  BiologyRoomManifest
} from '@shared/biology-room'
import {
  MolstarBiologyRoomAdapter,
  defaultBiologyMolecularViewState
} from './MolstarBiologyRoomAdapter'

const NOW = '2026-07-11T10:00:00.000Z'

describe('MolstarBiologyRoomAdapter', () => {
  it('exposes persisted representation, color, camera, and local screenshot controls', () => {
    const asset = molecularAsset()
    const room = molecularRoom(asset)
    const html = renderToStaticMarkup(createElement(MolstarBiologyRoomAdapter, {
      room,
      asset,
      selection: room.selection ?? null,
      source: { sourceUrl: 'sciforge-resource://asset/molecular-session' },
      onApply: () => true
    }))

    expect(html).toContain('data-molstar-biology-room-adapter')
    expect(html).toContain('aria-label="Molecular representation"')
    expect(html).toContain('value="surface" selected=""')
    expect(html).toContain('aria-label="Molecular color scheme"')
    expect(html).toContain('value="uniform" selected=""')
    expect(html).toContain('aria-label="Uniform molecular color"')
    expect(html).toContain('Camera saved')
    expect(html).toContain('Mol* screenshot controls are available')
  })

  it('uses a safe cartoon-by-chain default without inventing camera state', () => {
    expect(defaultBiologyMolecularViewState('protein')).toEqual({
      assetId: 'protein',
      representation: 'cartoon',
      colorScheme: 'chain'
    })
  })
})

function molecularAsset(): BiologyRoomAsset {
  return {
    id: 'protein',
    path: 'structures/protein.pdb',
    format: 'pdb',
    modality: 'structure',
    sha256: 'a'.repeat(64),
    sizeBytes: 4_096,
    mtimeMs: 1,
    indexPaths: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function molecularRoom(asset: BiologyRoomAsset): BiologyRoomManifest {
  return {
    schemaVersion: 1,
    roomId: 'room-molecular',
    title: 'Protein review',
    revision: 3,
    assets: [asset],
    activeAssetId: asset.id,
    selection: {
      kind: 'molecular',
      assetId: asset.id,
      locators: [{ modelId: 1, chainId: 'A', residueNumber: 42, residueName: 'GLY' }]
    },
    viewerStates: {
      molecular: {
        assetId: asset.id,
        representation: 'surface',
        colorScheme: 'uniform',
        uniformColor: '#336699',
        camera: {
          mode: 'perspective',
          fov: Math.PI / 4,
          position: [1, 2, 3],
          target: [0, 0, 0],
          up: [0, 1, 0],
          radius: 10,
          radiusMax: 20,
          fog: 50,
          clipFar: true,
          minNear: 5,
          minFar: 0
        }
      }
    },
    annotations: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}
