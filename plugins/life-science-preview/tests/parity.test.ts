/**
 * Parity evidence (24-1 §4.5 style, following plugins/biology-room/tests/parity.test.ts):
 *
 * 1. Port parity (core-spike rehearsal, extended to the binary slot): the
 *    same core driven through in-memory port fakes and through the real
 *    node:fs adapter ports — with the REAL workspace-* pure services on both
 *    sides — must produce identical observation envelopes, for a text slot
 *    (sequence-genomics) and the binary slot (bioimaging).
 *
 * 2. Static-domain parity: the trusted domain package's provider
 *    (@sciforge/domain-life-science-preview/main, node:fs in-process) and
 *    this plugin's provider over its node ports receive the same inputs over
 *    the same workspace files; observation envelopes, action results, the
 *    molecular applyEdit session update, and the bioimaging artifact PNG
 *    bytes must match field-for-field.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { WorkspacePreviewExtensionId } from '@sciforge/domain-sdk/workspace-preview'
import { createLifeScienceWorkspacePreviewProvider as createStaticProvider } from '@sciforge/domain-life-science-preview/main'
import {
  createLifeScienceWorkspacePreviewProvider,
  decodeLifeScienceObservationMetadata,
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE
} from '../src/core/index.js'
import type { LifeSciencePorts } from '../src/ports/index.js'
import { createNodeFilePorts } from '../src/dsh-adapter/node-file-ports.js'
import {
  CONTRACTS,
  FASTA_FIXTURE,
  makeActionInput,
  makeObservationInput,
  MGF_FIXTURE,
  PDB_FIXTURE,
  tinyRgbTiffFixture
} from './helpers/inputs.js'
import { createMemoryFilePorts, createRealDataPorts } from './helpers/memory-ports.js'

const WORKSPACE_ROOT = resolve('/tmp/lsp-plugin-parity-memory-workspace')

function nodePorts(): LifeSciencePorts {
  const node = createNodeFilePorts()
  return { files: node.read, writes: node.write, data: createRealDataPorts() }
}

describe('port parity: memory ports and node:fs ports agree (real pure services)', () => {
  it('sequence observe yields the same envelope via both port implementations', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/demo.fasta': FASTA_FIXTURE } })
    const memoryPorts: LifeSciencePorts = { files: memory.read, writes: memory.write, data: createRealDataPorts() }
    const tempWorkspace = await mkdtemp(join(tmpdir(), 'lsp-plugin-parity-'))
    try {
      await mkdir(join(tempWorkspace, 'seqs'), { recursive: true })
      await writeFile(join(tempWorkspace, 'seqs', 'demo.fasta'), FASTA_FIXTURE)
      const fastaPath = join(tempWorkspace, 'seqs', 'demo.fasta')
      const envelopes = []
      for (const ports of [memoryPorts, nodePorts()]) {
        const workspaceRoot = ports === memoryPorts ? WORKSPACE_ROOT : tempWorkspace
        const path = ports === memoryPorts ? join(WORKSPACE_ROOT, 'seqs', 'demo.fasta') : fastaPath
        const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
        const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, workspaceRoot, path, 'seqs/demo.fasta'))
        assert.equal(result.ok, true)
        if (!result.ok) return
        envelopes.push(decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0]))
      }
      assert.deepEqual(envelopes[0], envelopes[1])
    } finally {
      await rm(tempWorkspace, { recursive: true, force: true })
    }
  })

  it('bioimaging observe + thumbnail bytes agree via both port implementations', async () => {
    const tiff = tinyRgbTiffFixture()
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.tif': tiff } })
    const memoryPorts: LifeSciencePorts = { files: memory.read, writes: memory.write, data: createRealDataPorts() }
    const tempWorkspace = await mkdtemp(join(tmpdir(), 'lsp-plugin-parity-bio-'))
    try {
      await mkdir(join(tempWorkspace, 'images'), { recursive: true })
      await writeFile(join(tempWorkspace, 'images', 'demo.tif'), tiff)
      const tiffPath = join(tempWorkspace, 'images', 'demo.tif')
      const observations = []
      const thumbnails = []
      for (const ports of [memoryPorts, nodePorts()]) {
        const workspaceRoot = ports === memoryPorts ? WORKSPACE_ROOT : tempWorkspace
        const path = ports === memoryPorts ? join(WORKSPACE_ROOT, 'images', 'demo.tif') : tiffPath
        const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, ports)
        const observed = await provider.observe!(makeObservationInput(CONTRACTS.bioimaging, workspaceRoot, path, 'images/demo.tif'))
        assert.equal(observed.ok, true)
        if (!observed.ok) return
        observations.push(decodeLifeScienceObservationMetadata(observed.observation.pluginMetadata?.[0]))
        const thumbnail = await provider.prepareArtifact!({
          ...makeObservationInput(CONTRACTS.bioimaging, workspaceRoot, path, 'images/demo.tif'),
          request: { kind: 'thumbnail', width: 4, height: 4 }
        })
        assert.equal(thumbnail.ok, true)
        if (!thumbnail.ok) return
        thumbnails.push(thumbnail)
      }
      assert.deepEqual(observations[0], observations[1])
      assert.deepEqual(thumbnails[0], thumbnails[1])
      assert.deepEqual([...thumbnails[0].bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    } finally {
      await rm(tempWorkspace, { recursive: true, force: true })
    }
  })
})

describe('static-domain parity: trusted domain provider vs plugin provider', () => {
  let workspace = ''

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'lsp-plugin-static-parity-'))
    await mkdir(join(workspace, 'seqs'), { recursive: true })
    await mkdir(join(workspace, 'spectra'), { recursive: true })
    await mkdir(join(workspace, 'structures'), { recursive: true })
    await mkdir(join(workspace, 'images'), { recursive: true })
    await writeFile(join(workspace, 'seqs', 'demo.fasta'), FASTA_FIXTURE)
    await writeFile(join(workspace, 'spectra', 'demo.mgf'), MGF_FIXTURE)
    await writeFile(join(workspace, 'structures', 'demo.pdb'), PDB_FIXTURE)
    await writeFile(join(workspace, 'images', 'demo.tif'), tinyRgbTiffFixture())
  })

  after(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('sequence observe matches the trusted provider field-for-field', async () => {
    const staticProvider = createStaticProvider(CONTRACTS.sequence.manifest)
    const pluginProvider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, nodePorts())
    const fastaPath = join(workspace, 'seqs', 'demo.fasta')
    const input = makeObservationInput(CONTRACTS.sequence, workspace, fastaPath, 'seqs/demo.fasta')
    const [staticResult, pluginResult] = await Promise.all([
      staticProvider.observe!(input),
      pluginProvider.observe!(input)
    ])
    assert.equal(staticResult.ok, true)
    assert.equal(pluginResult.ok, true)
    if (!staticResult.ok || !pluginResult.ok) return
    assert.deepEqual(
      decodeLifeScienceObservationMetadata(pluginResult.observation.pluginMetadata?.[0]),
      decodeLifeScienceObservationMetadata(staticResult.observation.pluginMetadata?.[0])
    )
    assert.deepEqual(pluginResult.observation, staticResult.observation)
    assert.deepEqual(
      { bytesRead: pluginResult.bytesRead, truncated: pluginResult.truncated },
      { bytesRead: staticResult.bytesRead, truncated: staticResult.truncated }
    )
  })

  it('sequence.search action results match the trusted provider', async () => {
    const staticProvider = createStaticProvider(CONTRACTS.sequence.manifest)
    const pluginProvider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, nodePorts())
    const fastaPath = join(workspace, 'seqs', 'demo.fasta')
    const input = {
      ...makeObservationInput(CONTRACTS.sequence, workspace, fastaPath, 'seqs/demo.fasta'),
      action: makeActionInput('sequence.search', { query: 'ACGT' })
    }
    const [staticResult, pluginResult] = await Promise.all([
      staticProvider.invokeAction!(input),
      pluginProvider.invokeAction!(input)
    ])
    assert.equal(staticResult.ok, true)
    assert.equal(pluginResult.ok, true)
    if (!staticResult.ok || !pluginResult.ok) return
    assert.deepEqual(pluginResult.result, staticResult.result)
  })

  it('spectra observe matches the trusted provider field-for-field', async () => {
    const staticProvider = createStaticProvider(CONTRACTS.spectra.manifest)
    const pluginProvider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.spectra.manifest, nodePorts())
    const mgfPath = join(workspace, 'spectra', 'demo.mgf')
    const input = makeObservationInput(CONTRACTS.spectra, workspace, mgfPath, 'spectra/demo.mgf')
    const [staticResult, pluginResult] = await Promise.all([
      staticProvider.observe!(input),
      pluginProvider.observe!(input)
    ])
    assert.equal(staticResult.ok, true)
    assert.equal(pluginResult.ok, true)
    if (!staticResult.ok || !pluginResult.ok) return
    assert.deepEqual(pluginResult.observation, staticResult.observation)
  })

  it('molecular observe and applyEdit session update match the trusted provider', async () => {
    const staticProvider = createStaticProvider(CONTRACTS.molecular.manifest)
    const pluginProvider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, nodePorts())
    const pdbPath = join(workspace, 'structures', 'demo.pdb')
    const observationInput = makeObservationInput(CONTRACTS.molecular, workspace, pdbPath, 'structures/demo.pdb')
    const [staticObserved, pluginObserved] = await Promise.all([
      staticProvider.observe!(observationInput),
      pluginProvider.observe!(observationInput)
    ])
    assert.equal(staticObserved.ok, true)
    assert.equal(pluginObserved.ok, true)
    if (!staticObserved.ok || !pluginObserved.ok) return
    assert.deepEqual(pluginObserved.observation, staticObserved.observation)

    const applyEditInput = {
      ...observationInput,
      now: '2026-10-17T00:00:00.000Z',
      operation: {
        kind: 'domain.applyEdit' as const,
        path: pdbPath,
        operationType: LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE as WorkspacePreviewExtensionId,
        data: {
          selection: {
            kind: 'domain',
            selectionType: 'sciforge.life-science-preview.molecular.selection',
            data: {
              wireVersion: 2 as const,
              selection: { kind: 'molecular' as const, chains: ['A'] }
            }
          }
        }
      }
    }
    const [staticEdit, pluginEdit] = await Promise.all([
      staticProvider.applyEdit!(applyEditInput),
      pluginProvider.applyEdit!(applyEditInput)
    ])
    assert.deepEqual(pluginEdit, staticEdit)
  })

  it('bioimaging thumbnail artifact PNG bytes match the trusted provider byte-for-byte', async () => {
    const staticProvider = createStaticProvider(CONTRACTS.bioimaging.manifest)
    const pluginProvider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, nodePorts())
    const tiffPath = join(workspace, 'images', 'demo.tif')
    const artifactInput = {
      ...makeObservationInput(CONTRACTS.bioimaging, workspace, tiffPath, 'images/demo.tif'),
      request: { kind: 'thumbnail' as const, width: 4, height: 4 }
    }
    const [staticResult, pluginResult] = await Promise.all([
      staticProvider.prepareArtifact!(artifactInput),
      pluginProvider.prepareArtifact!(artifactInput)
    ])
    assert.equal(staticResult.ok, true)
    assert.equal(pluginResult.ok, true)
    if (!staticResult.ok || !pluginResult.ok) return
    assert.equal(staticResult.kind, 'thumbnail')
    assert.equal(pluginResult.kind, 'thumbnail')
    assert.deepEqual(pluginResult.thumbnail, staticResult.thumbnail)
    assert.equal(pluginResult.mimeType, staticResult.mimeType)
    assert.deepEqual(pluginResult.bytes, staticResult.bytes, 'plugin PNG payload must equal the trusted provider byte-for-byte')
    assert.equal(pluginResult.bytesRead, staticResult.bytesRead)
  })
})
