import { describe, expect, it } from 'vitest'
import { workspacePreviewPluginManifestSchema } from '@sciforge/domain-sdk/workspace-preview'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS,
  lifeScienceWorkspacePreviewManifestForContribution
} from './contract.js'
import { domainPackageDefinition } from './definition.js'

describe('Life Science Preview package contract', () => {
  it('exposes validated canonical manifests without cloning the JSON contracts', () => {
    expect(LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => manifest.id))
      .toEqual([
        'molecular',
        'sequence-genomics',
        'biology-index-transport',
        'omics-matrix',
        'bioimaging',
        'proteomics-spectra'
      ])

    for (const { contributionId, manifest } of LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS) {
      expect(workspacePreviewPluginManifestSchema.parse(manifest)).toEqual(manifest)
      expect(manifest).toBe(domainPackageDefinition.contributionContracts[contributionId])
      expect(lifeScienceWorkspacePreviewManifestForContribution(contributionId)).toBe(manifest)
      expect(LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID[manifest.id]).toBe(manifest)
      expect(Object.isFrozen(manifest)).toBe(true)
    }
  })

  it('keeps supported formats on the canonical manifests', () => {
    for (const manifest of LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS) {
      if (manifest.id === 'biology-index-transport') {
        expect(manifest.extensions).toEqual(['.fai', '.gzi', '.tbi', '.csi'])
        expect(manifest.workerPackage).toBeUndefined()
        continue
      }
      expect(manifest.extensions.length).toBeGreaterThan(0)
      expect(manifest.capabilities).toMatchObject({
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: true
      })
      expect(manifest.workerPackage).toMatch(/^@sciforge\/workspace-/)
    }
  })
})
