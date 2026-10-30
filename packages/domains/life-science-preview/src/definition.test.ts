import { describe, expect, it } from 'vitest'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-preview'
import {
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-server'
import {
  LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS,
  LIFE_SCIENCE_PREVIEW_DOMAIN_MODULE_ID,
  LIFE_SCIENCE_PREVIEW_DOMAIN_PACKAGE_NAME,
  LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS,
  LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS,
  LIFE_SCIENCE_PREVIEW_RENDERER_LIFECYCLE_CONTRIBUTIONS,
  LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS,
  domainPackageDefinition
} from './definition.js'

const expectedContributionIds = [
  'sciforge.life-science-preview.molecular',
  'sciforge.life-science-preview.sequence-genomics',
  'sciforge.life-science-preview.biology-index-transport',
  'sciforge.life-science-preview.omics-matrix',
  'sciforge.life-science-preview.bioimaging',
  'sciforge.life-science-preview.proteomics-spectra'
]

describe('Life Science Preview domain definition', () => {
  it('declares the canonical package and module identity', () => {
    expect(LIFE_SCIENCE_PREVIEW_DOMAIN_PACKAGE_NAME)
      .toBe('@sciforge/domain-life-science-preview')
    expect(LIFE_SCIENCE_PREVIEW_DOMAIN_MODULE_ID).toBe('sciforge.life-science-preview')
    expect(domainPackageDefinition).toMatchObject({
      contractVersion: 1,
      kind: 'trusted-compile-time',
      module: { hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' } }
    })
  })

  it('declares the same ordered preview contributions for every provider and renderer process', () => {
    expect(LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS).toEqual(expectedContributionIds)
    expect(LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS.map(({ id }) => id))
      .toEqual(expectedContributionIds)
    expect(LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS.map(({ id }) => id))
      .toEqual(expectedContributionIds)
    expect(LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS.map(({ id }) => id))
      .toEqual(expectedContributionIds)
    expect(LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS.every(
      ({ kind }) => kind === MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
    )).toBe(true)
    expect(LIFE_SCIENCE_PREVIEW_RENDERER_CONTRIBUTIONS.every(
      ({ kind }) => kind === RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
    )).toBe(true)
    expect(LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS.every(
      ({ kind }) => kind === WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
    )).toBe(true)
    expect(LIFE_SCIENCE_PREVIEW_RENDERER_LIFECYCLE_CONTRIBUTIONS).toEqual([
      expect.objectContaining({
        kind: 'renderer.lifecycle',
        id: 'sciforge.life-science-preview.molstar-prewarm'
      })
    ])
  })

  it('provides exactly one canonical JSON contract for every cross-process preview', () => {
    expect(Object.keys(domainPackageDefinition.contributionContracts))
      .toEqual(expectedContributionIds)
    expect(Object.values(domainPackageDefinition.contributionContracts).map((contract) =>
      (contract as { id: string }).id
    )).toEqual([
      'molecular',
      'sequence-genomics',
      'biology-index-transport',
      'omics-matrix',
      'bioimaging',
      'proteomics-spectra'
    ])
  })
})
