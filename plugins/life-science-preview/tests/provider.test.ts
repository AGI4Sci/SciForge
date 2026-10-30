/**
 * Provider behavior tests for all six slots, driving the plugin core through
 * in-memory port fakes with the REAL workspace-* pure services behind the
 * data ports. node:fs-backed parity lives in parity.test.ts; bounded-read
 * and artifact byte paths live in artifacts.test.ts.
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import type { WorkspacePreviewExtensionId, WorkspacePreviewProviderApplyEditInput } from '@sciforge/domain-sdk/workspace-preview'
import {
  createLifeScienceWorkspacePreviewProvider,
  decodeLifeScienceObservationMetadata,
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE
} from '../src/core/index.js'
import {
  CONTRACTS,
  FASTA_FIXTURE,
  makeActionInput,
  makeObservationInput,
  MGF_FIXTURE,
  MTX_FIXTURE,
  PDB_FIXTURE,
  tinyRgbTiffFixture
} from './helpers/inputs.js'
import { makePorts } from './helpers/memory-ports.js'

const WORKSPACE_ROOT = resolve('/tmp/lsp-plugin-test-workspace')

describe('sequence-genomics slot', () => {
  const fastaPath = join(WORKSPACE_ROOT, 'seqs', 'demo.fasta')

  it('observe returns the sequence envelope over memory ports + real pure service', async () => {
    const { ports } = makePorts({ 'seqs/demo.fasta': FASTA_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
    const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.truncated, false)
    assert.equal(result.bytesRead, FASTA_FIXTURE.length)
    assert.equal(result.observation.view.pluginId, 'sequence-genomics')
    assert.equal(result.observation.view.title, 'demo.fasta')
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.ok(envelope, 'expected a decodable sequence observation envelope')
    assert.equal(envelope.kind, 'sequence')
    assert.equal(envelope.observation.sequenceCount, 2)
    assert.equal(envelope.observation.totalLength, 26)
    assert.equal(envelope.observation.alphabet, 'dna')
  })

  it('sequence.search invokeAction returns encoded results', async () => {
    const { ports } = makePorts({ 'seqs/demo.fasta': FASTA_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
      action: makeActionInput('sequence.search', { query: 'ACGT' })
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const search = result.result as { ok: boolean; matchCount: number; matches: unknown[]; query: string }
    assert.equal(search.ok, true)
    assert.equal(search.query, 'ACGT')
    assert.equal(search.matchCount, search.matches.length)
    assert.ok(search.matchCount >= 1)
  })

  it('sequence.exportSummary matches the trusted provider (wire-guard quirk included)', async () => {
    // Faithfulness note: exportSummary leaks the worker references' indexedRange
    // (kind: 'sequence') into the legacy-selection wire guard, so the trusted
    // in-process provider rejects with the bounded-v2-wire-contract error too
    // (verified against @sciforge/domain-life-science-preview/main). The plugin
    // must reproduce that behavior exactly, not silently "fix" it.
    const { ports } = makePorts({ 'seqs/demo.fasta': FASTA_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
    await assert.rejects(
      provider.invokeAction!({
        ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
        action: makeActionInput('sequence.exportSummary')
      }),
      /bounded v2 wire contract/
    )
  })

  it('unknown action id is rejected as unsupported-action', async () => {
    const { ports } = makePorts({ 'seqs/demo.fasta': FASTA_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
      action: makeActionInput('sequence.notARealAction')
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'unsupported-action')
  })
})

describe('proteomics-spectra slot', () => {
  const mgfPath = join(WORKSPACE_ROOT, 'spectra', 'demo.mgf')

  it('observe returns the spectra envelope', async () => {
    const { ports } = makePorts({ 'spectra/demo.mgf': MGF_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.spectra.manifest, ports)
    const result = await provider.observe!(makeObservationInput(CONTRACTS.spectra, WORKSPACE_ROOT, mgfPath, 'spectra/demo.mgf'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.bytesRead, MGF_FIXTURE.length)
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.ok(envelope, 'expected a decodable spectra observation envelope')
    assert.equal(envelope.kind, 'spectra')
    assert.equal(envelope.observation.format, 'mgf')
    assert.equal(envelope.observation.spectrumCount, 2)
    assert.equal(envelope.observation.peakCount, 4)
    assert.equal(envelope.observation.xAxis, 'm/z')
    assert.deepEqual(envelope.observation.mzRange, { min: 100, max: 300.25 })
  })

  it('spectra.selectPeaksByRange invokeAction filters sampled peaks', async () => {
    const { ports } = makePorts({ 'spectra/demo.mgf': MGF_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.spectra.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.spectra, WORKSPACE_ROOT, mgfPath, 'spectra/demo.mgf'),
      action: makeActionInput('spectra.selectPeaksByRange', { range: { mzMin: 150 } })
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const selection = result.result as { peakCount: number; peaks: unknown[] }
    assert.equal(selection.peakCount, 3)
    assert.equal(selection.peaks.length, 3)
  })

  it('spectra.exportPeakList round-trips a CSV peak table', async () => {
    const { ports } = makePorts({ 'spectra/demo.mgf': MGF_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.spectra.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.spectra, WORKSPACE_ROOT, mgfPath, 'spectra/demo.mgf'),
      action: makeActionInput('spectra.exportPeakList', { range: {}, format: 'csv', includeHeader: true })
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const exported = result.result as { ok: boolean; format: string; text?: string }
    assert.equal(exported.ok, true)
    assert.equal(exported.format, 'csv')
    assert.match(exported.text ?? '', /mz,intensity/)
  })
})

describe('molecular slot', () => {
  const pdbPath = join(WORKSPACE_ROOT, 'structures', 'demo.pdb')

  it('observe returns the molecular envelope with chains and ligands', async () => {
    const { ports } = makePorts({ 'structures/demo.pdb': PDB_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, ports)
    const result = await provider.observe!(makeObservationInput(CONTRACTS.molecular, WORKSPACE_ROOT, pdbPath, 'structures/demo.pdb'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.ok(envelope, 'expected a decodable molecular observation envelope')
    assert.equal(envelope.kind, 'molecular')
    assert.equal(envelope.observation.modelCount, 1)
    assert.deepEqual(envelope.observation.chains, ['A', 'B'])
    assert.deepEqual(envelope.observation.ligands, ['ATP'])
  })

  it('molecular.workbench invokeAction resolves the requested chains', async () => {
    const { ports } = makePorts({ 'structures/demo.pdb': PDB_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.molecular, WORKSPACE_ROOT, pdbPath, 'structures/demo.pdb'),
      action: makeActionInput('molecular.workbench', { selection: { chains: ['A'] } })
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const workbench = result.result as { ok: boolean; chainCount: number; chains: Array<{ id?: string }> }
    assert.equal(workbench.ok, true)
    assert.equal(workbench.chainCount, 1)
    assert.equal(workbench.chains[0]?.id, 'A')
  })

  it('applyEdit accepts a v2 molecular selection as a session update', async () => {
    const { ports } = makePorts({ 'structures/demo.pdb': PDB_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, ports)
    const input: WorkspacePreviewProviderApplyEditInput = {
      ...makeObservationInput(CONTRACTS.molecular, WORKSPACE_ROOT, pdbPath, 'structures/demo.pdb'),
      now: '2026-10-17T00:00:00.000Z',
      operation: {
        kind: 'domain.applyEdit',
        path: pdbPath,
        operationType: LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE as WorkspacePreviewExtensionId,
        data: {
          selection: {
            kind: 'domain',
            selectionType: 'sciforge.life-science-preview.molecular.selection',
            data: {
              wireVersion: 2,
              selection: { kind: 'molecular', chains: ['A'] }
            }
          }
        }
      }
    }
    const result = await provider.applyEdit!(input)
    assert.ok(result, 'expected the molecular selection edit to be handled')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.operationKind, 'domain.applyEdit')
    assert.equal(result.audit.effect, 'session-update')
    assert.equal(result.session.selection?.kind, 'domain')
  })

  it('applyEdit returns null (host fall-through) for other operation types', async () => {
    const { ports } = makePorts({ 'structures/demo.pdb': PDB_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, ports)
    const result = await provider.applyEdit!({
      ...makeObservationInput(CONTRACTS.molecular, WORKSPACE_ROOT, pdbPath, 'structures/demo.pdb'),
      now: '2026-10-17T00:00:00.000Z',
      operation: { kind: 'domain.applyEdit', path: pdbPath, operationType: 'sciforge.other.operation' as WorkspacePreviewExtensionId, data: {} }
    })
    assert.equal(result, null)
  })

  it('rejects observe for unsupported molecular formats', async () => {
    const { ports } = makePorts({ 'structures/demo.pdb': PDB_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.molecular.manifest, ports)
    const gifPath = join(WORKSPACE_ROOT, 'structures', 'demo.gif')
    const result = await provider.observe!(makeObservationInput(CONTRACTS.molecular, WORKSPACE_ROOT, gifPath, 'structures/demo.gif'))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'unsupported-format')
  })
})

describe('omics-matrix slot', () => {
  const mtxPath = join(WORKSPACE_ROOT, 'omics', 'demo.mtx')

  it('observe returns the omics envelope for a Matrix Market file', async () => {
    const { ports } = makePorts({ 'omics/demo.mtx': MTX_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.omics.manifest, ports)
    const result = await provider.observe!(makeObservationInput(CONTRACTS.omics, WORKSPACE_ROOT, mtxPath, 'omics/demo.mtx'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.ok(envelope, 'expected a decodable omics observation envelope')
    assert.equal(envelope.kind, 'omics')
    assert.equal(envelope.observation.format, 'matrix-market')
    assert.deepEqual(envelope.observation.matrixShape, [2, 3])
    assert.equal(envelope.observation.observationCount, 2)
    assert.equal(envelope.observation.variableCount, 3)
  })

  it('omics.selectDataset resolves a matrix by name (wire-encoded selection)', async () => {
    const { ports } = makePorts({ 'omics/demo.mtx': MTX_FIXTURE }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.omics.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.omics, WORKSPACE_ROOT, mtxPath, 'omics/demo.mtx'),
      action: makeActionInput('omics.selectDataset', { matrixNames: ['Matrix Market matrix'] })
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const selection = result.result as {
      ok: boolean
      selection?: { kind: string; selectionType?: string; data?: { selection?: { matrixIds?: string[] } } }
    }
    assert.equal(selection.ok, true)
    assert.equal(selection.selection?.kind, 'domain')
    assert.equal(selection.selection?.selectionType, 'sciforge.life-science-preview.omics.selection')
    assert.deepEqual(selection.selection?.data?.selection?.matrixIds, ['matrix-1'])
  })
})

describe('bioimaging slot', () => {
  const tiffPath = join(WORKSPACE_ROOT, 'images', 'demo.tif')

  it('observe returns the bioimaging envelope with dimensions and tile plan', async () => {
    const { ports } = makePorts({ 'images/demo.tif': tinyRgbTiffFixture() }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, ports)
    const result = await provider.observe!(makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/demo.tif'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.ok(envelope, 'expected a decodable bioimaging observation envelope')
    assert.equal(envelope.kind, 'bioimaging')
    assert.equal(envelope.observation.format, 'tiff')
    assert.deepEqual(envelope.observation.dimensions, { width: 2, height: 2 })
    assert.equal(envelope.observation.tilePlan?.levelCount, 1)
    assert.equal(envelope.observation.tilePlan?.tileRendererImplemented, true)
  })

  it('bioimaging.inspectHeader invokeAction returns the TIFF summary', async () => {
    const { ports } = makePorts({ 'images/demo.tif': tinyRgbTiffFixture() }, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, ports)
    const result = await provider.invokeAction!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/demo.tif'),
      action: makeActionInput('bioimaging.inspectHeader')
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const header = result.result as { ok: boolean; tiff?: { imageWidth?: number; imageHeight?: number } }
    assert.equal(header.ok, true)
    assert.equal(header.tiff?.imageWidth, 2)
    assert.equal(header.tiff?.imageHeight, 2)
  })
})

describe('biology-index-transport slot', () => {
  it('observe is a passive descriptor-only observation (no file read)', async () => {
    const { ports, memory } = makePorts({}, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.biologyIndex.manifest, ports)
    const faiPath = join(WORKSPACE_ROOT, 'seqs', 'demo.fasta.fai')
    const result = await provider.observe!(makeObservationInput(CONTRACTS.biologyIndex, WORKSPACE_ROOT, faiPath, 'seqs/demo.fasta.fai'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.bytesRead, 0)
    assert.equal(result.truncated, false)
    assert.deepEqual(result.observation.actions, ['observe'])
    assert.equal(
      memory.calls.filter((call) => call.startsWith('stat:') || call.startsWith('readPrefix:')).length,
      0,
      'passive transport must not touch the file ports'
    )
  })

  it('has no invokeAction/exportPreview surface', () => {
    const { ports } = makePorts({}, WORKSPACE_ROOT)
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.biologyIndex.manifest, ports)
    assert.equal(provider.invokeAction, undefined)
    assert.equal(provider.exportPreview, undefined)
    assert.equal(provider.prepareArtifact, undefined)
    assert.equal(provider.applyEdit, undefined)
  })
})

describe('provider factory', () => {
  it('rejects unsupported manifest ids', () => {
    const { ports } = makePorts({}, WORKSPACE_ROOT)
    assert.throws(
      () => createLifeScienceWorkspacePreviewProvider({ ...CONTRACTS.sequence.manifest, id: 'not-a-slot' }, ports),
      /Unsupported Life Science Preview provider manifest: not-a-slot/
    )
  })
})
