/**
 * Contribution assembly, manifest-drift guard, channel registration surface,
 * and the plugin entry surface.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND, workspacePreviewPluginManifestSchema, type WorkspacePreviewExtensionId } from '@sciforge/domain-sdk/workspace-preview'
import {
  createLifeScienceWorkspacePreviewContributions,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from '../src/dsh-adapter/contributions.js'
import { getWorkspacePreviewProviders } from '../src/dsh-adapter/register-preview-contributions.js'
import {
  createPluginContributions,
  createPluginPorts,
  dispose,
  getCapabilityDefinitions,
  activate,
  deactivate,
  unregister
} from '../src/dsh-adapter/index.js'
import {
  CONTRACTS,
  FASTA_FIXTURE,
  makeObservationInput,
  tinyRgbTiffFixture
} from './helpers/inputs.js'
import { makePorts } from './helpers/memory-ports.js'

const here = dirname(fileURLToPath(import.meta.url))
const DOMAIN_MANIFEST_JSON = join(here, '..', '..', '..', 'packages', 'domains', 'life-science-preview', 'sciforge.domain.json')

const ALL_DECLARATIONS = LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => ({
  id: contract.contributionId
}))

describe('six-slot contribution assembly', () => {
  it('assembles all six declarations into manifest+provider contributions', () => {
    const { ports } = makePorts({}, '/tmp/lsp-plugin-contribs')
    const contributions = createLifeScienceWorkspacePreviewContributions(
      ALL_DECLARATIONS,
      MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      'main',
      ports
    )
    assert.equal(contributions.length, 6)
    const expectedOrder = [
      'sciforge.life-science-preview.molecular',
      'sciforge.life-science-preview.sequence-genomics',
      'sciforge.life-science-preview.biology-index-transport',
      'sciforge.life-science-preview.omics-matrix',
      'sciforge.life-science-preview.bioimaging',
      'sciforge.life-science-preview.proteomics-spectra'
    ]
    assert.deepEqual(contributions.map((contribution) => contribution.id), expectedOrder)
    for (const contribution of contributions) {
      assert.equal(contribution.kind, 'main.workspace-preview-plugin')
      assert.equal(contribution.contract, contribution.value.manifest)
      assert.equal(contribution.value.provider.pluginId, contribution.value.manifest.id)
      assert.equal(typeof contribution.value.provider.observe, 'function')
    }
  })

  it('matches per-slot provider surface shapes to the trusted backend', () => {
    const { ports } = makePorts({}, '/tmp/lsp-plugin-contribs')
    const contributions = createLifeScienceWorkspacePreviewContributions(
      ALL_DECLARATIONS,
      MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      'main',
      ports
    )
    const surface = Object.fromEntries(contributions.map((contribution) => [
      contribution.value.manifest.id,
      Object.keys(contribution.value.provider).sort()
    ])) as Record<string, string[]>
    assert.deepEqual(surface.molecular, ['applyEdit', 'exportPreview', 'invokeAction', 'observe', 'pluginId'])
    assert.deepEqual(surface['sequence-genomics'], ['exportPreview', 'invokeAction', 'observe', 'pluginId'])
    assert.deepEqual(surface['biology-index-transport'], ['observe', 'pluginId'])
    assert.deepEqual(surface['omics-matrix'], ['exportPreview', 'invokeAction', 'observe', 'pluginId'])
    assert.deepEqual(surface.bioimaging, ['exportPreview', 'invokeAction', 'observe', 'pluginId', 'prepareArtifact'])
    assert.deepEqual(surface['proteomics-spectra'], ['exportPreview', 'invokeAction', 'observe', 'pluginId'])
  })

  it('rejects declarations without a canonical manifest', () => {
    const { ports } = makePorts({}, '/tmp/lsp-plugin-contribs')
    assert.throws(
      () => createLifeScienceWorkspacePreviewContributions(
        [{ id: 'sciforge.life-science-preview.not-a-slot' }],
        MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        'main',
        ports
      ),
      /has no canonical manifest/
    )
  })

  it('canonical manifests never drift from the trusted sciforge.domain.json', async () => {
    const domainJson = JSON.parse(await readFile(DOMAIN_MANIFEST_JSON, 'utf8')) as {
      contributionContracts: Record<string, unknown>
    }
    for (const contract of LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS) {
      const domainRaw = domainJson.contributionContracts[contract.contributionId]
      assert.ok(domainRaw, `domain JSON is missing ${contract.contributionId}`)
      const reparsed = workspacePreviewPluginManifestSchema.parse(domainRaw)
      assert.deepEqual(contract.manifest, reparsed, `${contract.contributionId} manifest drifted from sciforge.domain.json`)
    }
    assert.equal(
      LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.length,
      Object.keys(domainJson.contributionContracts).length,
      'slot count drifted from sciforge.domain.json'
    )
  })
})

describe('workspace-preview channel registration surface', () => {
  const REGISTRATION_WORKSPACE_ROOT = '/tmp/lsp-plugin-registration'

  it('getWorkspacePreviewProviders exposes the six slots with governed artifact kinds', () => {
    const slots = getWorkspacePreviewProviders()
    assert.equal(slots.length, 6)
    assert.deepEqual(slots.map((slot) => slot.slotId), [
      'molecular',
      'sequence-genomics',
      'biology-index-transport',
      'omics-matrix',
      'bioimaging',
      'proteomics-spectra'
    ])
    for (const slot of slots) {
      assert.equal((slot.manifest as { id: string }).id, slot.slotId)
      assert.equal(typeof (slot.provider as { observe?: unknown }).observe, 'function')
    }
    const bioimaging = slots.find((slot) => slot.slotId === 'bioimaging')!
    assert.deepEqual([...bioimaging.artifactKinds], ['tile', 'thumbnail'])
    const sequence = slots.find((slot) => slot.slotId === 'sequence-genomics')!
    assert.deepEqual([...sequence.artifactKinds], [])
  })

  it('slot providers serve observe from the registered contribution', async () => {
    const fastaPath = join(REGISTRATION_WORKSPACE_ROOT, 'seqs', 'demo.fasta')
    const { ports } = makePorts({ 'seqs/demo.fasta': FASTA_FIXTURE }, REGISTRATION_WORKSPACE_ROOT)
    const contributions = createLifeScienceWorkspacePreviewContributions(
      ALL_DECLARATIONS,
      MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      'main',
      ports
    )
    const sequence = contributions.find((contribution) => contribution.value.manifest.id === 'sequence-genomics')!
    const result = await sequence.value.provider.observe!(
      makeObservationInput(CONTRACTS.sequence, REGISTRATION_WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta')
    )
    assert.equal(result.ok, true)
  })
})

describe('plugin entry surface', () => {
  it('exposes the named-runner lifecycle with an empty capability list', async () => {
    for (const lifecycle of [activate, deactivate, unregister, dispose]) {
      assert.equal(typeof lifecycle, 'function')
      await lifecycle()
    }
    const definitions = getCapabilityDefinitions()
    assert.deepEqual(definitions, [], 'preview providers are not capabilities; the list stays empty until the SDK channel lands')
  })

  it('createPluginPorts/createPluginContributions assemble the full six-slot set', () => {
    const ports = createPluginPorts()
    assert.equal(typeof ports.files.stat, 'function')
    assert.equal(typeof ports.writes.copyExclusive, 'function')
    assert.equal(typeof ports.data.bioimaging.decodeTile, 'function')
    const contributions = createPluginContributions(ports)
    assert.equal(contributions.length, 6)
    assert.equal(contributions[0].value.manifest.id, 'molecular')
  })
})
