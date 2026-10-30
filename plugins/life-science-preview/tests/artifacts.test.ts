/**
 * Artifact byte-path, bounded-read enforcement, path-escape governance, and
 * export tests. The bioimaging tile/thumbnail smoke test drives the REAL
 * binary decode path (baseline TIFF in, PNG bytes out) through the file
 * ports — the plugin-side rehearsal the core spike left un-rehearsed
 * (spike README §3.4). No host facilities are needed for it: the decode
 * runs entirely inside the workspace-bioimaging pure package.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { WorkspacePreviewPrepareArtifactRequest } from '@sciforge/domain-sdk/workspace-preview'
import {
  createLifeScienceWorkspacePreviewProvider,
  decodeLifeScienceObservationMetadata
} from '../src/core/index.js'
import { LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES } from '../src/ports/index.js'
import { createNodeFilePorts } from '../src/dsh-adapter/node-file-ports.js'
import type { LifeSciencePorts } from '../src/ports/index.js'
import {
  CONTRACTS,
  FASTA_FIXTURE,
  makeObservationInput,
  tinyRgbTiffFixture
} from './helpers/inputs.js'
import { createMemoryFilePorts, createRealDataPorts } from './helpers/memory-ports.js'

const WORKSPACE_ROOT = resolve('/tmp/lsp-plugin-artifacts-workspace')

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

function thumbnailRequest(): WorkspacePreviewPrepareArtifactRequest {
  return { kind: 'thumbnail', width: 4, height: 4 }
}

describe('prepareArtifact — bioimaging thumbnail (real binary decode path)', () => {
  const tiffPath = join(WORKSPACE_ROOT, 'images', 'demo.tif')

  it('decodes a tiny real TIFF into PNG bytes through the ports', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.tif': tinyRgbTiffFixture() } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/demo.tif'),
      request: thumbnailRequest()
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.kind, 'thumbnail')
    assert.equal(result.mimeType, 'image/png')
    assert.equal(result.truncated, false)
    assert.equal(result.pixelDecoding, true)
    assert.equal(result.thumbnailRendererImplemented, true)
    assert.deepEqual([...result.bytes.subarray(0, 4)], PNG_MAGIC, 'decoded artifact must be a real PNG payload')
    assert.ok(result.bytes.length > 8, 'PNG payload must not be empty')
    assert.equal(
      memory.calls.filter((call) => call.startsWith('readPrefix:')).length,
      1,
      'artifact decode must read the file exactly once through the ports'
    )
  })

  it('decodes a level-0 tile with real PNG bytes', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.tif': tinyRgbTiffFixture() } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/demo.tif'),
      request: { kind: 'tile', level: 0, x: 0, y: 0, width: 2, height: 2 }
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.kind, 'tile')
    assert.equal(result.mimeType, 'image/png')
    assert.deepEqual(result.tile, { level: 0, x: 0, y: 0, width: 2, height: 2 })
    assert.deepEqual([...result.bytes.subarray(0, 4)], PNG_MAGIC)
  })

  it('rejects cache-artifact requests (bioimaging implements tile/thumbnail only)', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.tif': tinyRgbTiffFixture() } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/demo.tif'),
      request: { kind: 'cache-artifact', source: 'observation' }
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'unsupported-artifact')
  })

  it('rejects non-TIFF sources with unsupported-format before any read', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.png': tinyRgbTiffFixture() } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const pngPath = join(WORKSPACE_ROOT, 'images', 'demo.png')
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, pngPath, 'images/demo.png'),
      request: thumbnailRequest()
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'unsupported-format')
    assert.equal(
      memory.calls.filter((call) => call.startsWith('stat:')).length,
      0,
      'format gate must fire before the stat'
    )
  })
})

describe('bounded-read enforcement', () => {
  const tiffPath = join(WORKSPACE_ROOT, 'images', 'huge.tif')

  it('rejects files over the 4MiB binary limit without reading them', async () => {
    const oversize = new Uint8Array(LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES + 1).fill(65)
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/huge.tif': oversize } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, tiffPath, 'images/huge.tif'),
      request: thumbnailRequest()
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'too-large')
    assert.match(result.message, /4194304/)
    assert.equal(
      memory.calls.filter((call) => call.startsWith('readPrefix:')).length,
      0,
      'oversize file must be rejected at stat time, before any read'
    )
  })

  it('observe truncates at the 2MiB text limit instead of rejecting', async () => {
    const twoMiBPlus = new Uint8Array(2_000_000 + 64).fill(65)
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/big.fasta': twoMiBPlus } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const bigPath = join(WORKSPACE_ROOT, 'seqs', 'big.fasta')
    const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, bigPath, 'seqs/big.fasta'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.truncated, true)
    assert.equal(result.bytesRead, 2_000_000)
  })
})

describe('path-escape governance', () => {
  const fastaPath = join(WORKSPACE_ROOT, 'seqs', 'demo.fasta')

  it('memory ports reject a workspace escape attempt on observe', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/demo.fasta': FASTA_FIXTURE } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const escapePath = join(WORKSPACE_ROOT, 'seqs', '..', '..', 'etc', 'passwd')
    const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, escapePath))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'worker-error')
    assert.match(result.message, /path-escape/)
  })

  it('artifact reads are governed too', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'images/demo.tif': tinyRgbTiffFixture() } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const escapePath = resolve(WORKSPACE_ROOT, '..', 'outside.tif')
    const result = await provider.prepareArtifact!({
      ...makeObservationInput(CONTRACTS.bioimaging, WORKSPACE_ROOT, escapePath),
      request: thumbnailRequest()
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /path-escape/)
  })
})

describe('path-escape governance on node:fs ports', () => {
  let tempOutside = ''
  let tempWorkspace = ''

  before(async () => {
    tempOutside = await mkdtemp(join(tmpdir(), 'lsp-plugin-outside-'))
    tempWorkspace = await mkdtemp(join(tmpdir(), 'lsp-plugin-governed-'))
  })

  after(async () => {
    await rm(tempOutside, { recursive: true, force: true })
    await rm(tempWorkspace, { recursive: true, force: true })
  })

  it('node ports reject a real on-disk escape attempt', async () => {
    const outsideFile = join(tempOutside, 'secret.fasta')
    await writeFile(outsideFile, FASTA_FIXTURE)
    const nodePorts = createNodeFilePorts()
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: nodePorts.read,
      writes: nodePorts.write,
      data: createRealDataPorts()
    })
    const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, tempWorkspace, outsideFile))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /path-escape/)
  })

  it('node ports serve a real workspace file end to end', async () => {
    await mkdir(join(tempWorkspace, 'seqs'), { recursive: true })
    await writeFile(join(tempWorkspace, 'seqs', 'demo.fasta'), FASTA_FIXTURE)
    const nodePorts = createNodeFilePorts()
    const ports: LifeSciencePorts = { files: nodePorts.read, writes: nodePorts.write, data: createRealDataPorts() }
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, ports)
    const fastaPath = join(tempWorkspace, 'seqs', 'demo.fasta')
    const result = await provider.observe!(makeObservationInput(CONTRACTS.sequence, tempWorkspace, fastaPath, 'seqs/demo.fasta'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.bytesRead, FASTA_FIXTURE.length)
    const envelope = decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])
    assert.equal(envelope?.kind, 'sequence')
    assert.equal(envelope?.observation.sequenceCount, 2)
  })
})

describe('exportPreview over the write ports', () => {
  const fastaPath = join(WORKSPACE_ROOT, 'seqs', 'demo.fasta')

  it('copies the source file to a resolved workspace target', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/demo.fasta': FASTA_FIXTURE } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.exportPreview!({
      ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
      target: { kind: 'workspace-file', format: 'fasta', path: 'exports/copy.fasta' },
      now: '2026-10-17T00:00:00.000Z'
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.path, memory.resolveInWorkspace('exports/copy.fasta'))
    assert.ok(
      memory.calls.some((call) => call === `copyExclusive:${fastaPath}->${result.path}`),
      `expected a recorded exclusive copy, got ${memory.calls.join(', ')}`
    )
    assert.equal(result.audit.effect, 'source-copy')
  })

  it('rejects format-mismatched exports (source-copy only)', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/demo.fasta': FASTA_FIXTURE } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    const result = await provider.exportPreview!({
      ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
      target: { kind: 'workspace-file', format: 'gb' },
      now: '2026-10-17T00:00:00.000Z'
    })
    assert.equal(result.ok, false)
  })

  it('rejects export targets that escape the workspace', async () => {
    const memory = createMemoryFilePorts({ workspaceRoot: WORKSPACE_ROOT, files: { 'seqs/demo.fasta': FASTA_FIXTURE } })
    const provider = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: memory.read,
      writes: memory.write,
      data: createRealDataPorts()
    })
    await assert.rejects(
      provider.exportPreview!({
        ...makeObservationInput(CONTRACTS.sequence, WORKSPACE_ROOT, fastaPath, 'seqs/demo.fasta'),
        target: { kind: 'workspace-file', format: 'fasta', path: '../outside.fasta' },
        now: '2026-10-17T00:00:00.000Z'
      }),
      /escapes workspace root/
    )
  })
})
