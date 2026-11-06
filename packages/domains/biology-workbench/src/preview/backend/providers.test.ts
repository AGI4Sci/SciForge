import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspacePreviewJsonValueSchema, type WorkspacePreviewProviderObservationInput } from '@sciforge/domain-sdk/workspace-preview'
import { LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID } from '../contract.js'
import { decodeLifeScienceObservationMetadata } from '../wire.js'
import {
  createLifeScienceWorkspacePreviewProvider,
  LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES,
  LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES
} from './providers.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const roots: string[] = []
const fasta = '>alpha\nACGTACGT\n'

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map(async (root) => {
    expect(root.startsWith(join(tmpdir(), 'sciforge-builtin-preview-'))).toBe(true)
    await rm(root, { recursive: true, force: true })
  }))
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-builtin-preview-'))
  roots.push(root)
  return root
}

function inputFor(pluginId: string, workspaceRoot: string, path: string): WorkspacePreviewProviderObservationInput {
  const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID[pluginId]!
  return {
    manifest,
    file: { workspaceRoot, path },
    session: {
      id: `session-${pluginId}`,
      pluginId,
      workspaceRoot,
      path,
      modality: manifest.modality,
      mode: 'preview',
      openedAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z'
    }
  }
}

function providerFor(input: WorkspacePreviewProviderObservationInput) {
  return createLifeScienceWorkspacePreviewProvider(input.manifest)
}

describe('built-in Life Science Preview read governance', () => {
  it.each(['sequence-genomics', 'molecular', 'omics-matrix', 'proteomics-spectra', 'bioimaging'])('rejects an outside source in %s before opening it', async (pluginId) => {
    const root = await workspace()
    const outside = await workspace()
    const path = join(outside, pluginId === 'molecular' ? 'secret.pdb' : 'secret.fasta')
    await writeFile(path, fasta)
    const input = inputFor(pluginId, root, path)
    const { open } = await import('node:fs/promises')
    await expect(providerFor(input).observe!(input)).resolves.toMatchObject({ ok: false, reason: 'worker-error' })
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects symlink escapes for observation, action, and artifact reads', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'secret.tif'), tinyRgbTiff())
    const path = join(root, 'escape.tif')
    await symlink(join(outside, 'secret.tif'), path)
    const input = inputFor('bioimaging', root, path)
    const provider = providerFor(input)
    await expect(provider.observe!(input)).resolves.toMatchObject({ ok: false, reason: 'worker-error' })
    await expect(provider.invokeAction!({ ...input, action: { actionId: 'bioimaging.inspectHeader', input: {} } })).resolves.toMatchObject({ ok: false, reason: 'worker-error' })
    await expect(provider.prepareArtifact!({ ...input, request: { kind: 'thumbnail', width: 2, height: 2 } })).resolves.toMatchObject({ ok: false, reason: 'worker-error' })
  })

  it.each(['missing.fasta', 'directory.fasta'])('returns a structured failure for %s', async (name) => {
    const root = await workspace()
    const path = join(root, name)
    if (name.startsWith('directory')) await mkdir(path)
    const input = inputFor('sequence-genomics', root, path)
    await expect(providerFor(input).observe!(input)).resolves.toMatchObject({ ok: false, reason: 'worker-error' })
  })

  it('returns a structured failure if the source disappears between resolution and open', async () => {
    const root = await workspace()
    const path = join(root, 'source.fasta')
    await writeFile(path, fasta)
    const input = inputFor('sequence-genomics', root, path)
    const { open } = await import('node:fs/promises')
    vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('Source disappeared before open.'), { code: 'ENOENT' }))
    await expect(providerFor(input).observe!(input)).resolves.toMatchObject({ ok: false, reason: 'worker-error', message: 'Source disappeared before open.' })
  })

  it('permits in-workspace symlinks and a symlinked workspace root', async () => {
    const root = await workspace()
    const aliases = await workspace()
    await writeFile(join(root, 'source.fasta'), fasta)
    await symlink(join(root, 'source.fasta'), join(root, 'alias.fasta'))
    await symlink(root, join(aliases, 'workspace'))
    const input = inputFor('sequence-genomics', join(aliases, 'workspace'), join(aliases, 'workspace', 'alias.fasta'))
    await expect(providerFor(input).observe!(input)).resolves.toMatchObject({ ok: true, bytesRead: Buffer.byteLength(fasta), truncated: false })
  })

  it('truncates text reads at 2,000,000 bytes', async () => {
    const root = await workspace()
    const path = join(root, 'large.fasta')
    await writeFile(path, `>large\n${'A'.repeat(LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES + 64)}`)
    const input = inputFor('sequence-genomics', root, path)
    await expect(providerFor(input).observe!(input)).resolves.toMatchObject({ ok: true, bytesRead: 2_000_000, truncated: true })
  })

  it('truncates binary observation and action reads at 4MiB', async () => {
    const root = await workspace()
    const path = join(root, 'large.tif')
    const bytes = Buffer.alloc(LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES + 1)
    bytes.set(tinyRgbTiff())
    await writeFile(path, bytes)
    const input = inputFor('bioimaging', root, path)
    const provider = providerFor(input)
    await expect(provider.observe!(input)).resolves.toMatchObject({ ok: true, bytesRead: 4194304, truncated: true })
    await expect(provider.invokeAction!({ ...input, action: { actionId: 'bioimaging.inspectHeader', input: {} } })).resolves.toMatchObject({ ok: true, bytesRead: 4194304, truncated: true })
  })

  it('rejects oversized artifacts from actual stat before opening, ignoring a stale file size', async () => {
    const root = await workspace()
    const path = join(root, 'huge.tif')
    await writeFile(path, Buffer.alloc(LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES + 1))
    const input = inputFor('bioimaging', root, path)
    const { open } = await import('node:fs/promises')
    await expect(providerFor(input).prepareArtifact!({ ...input, file: { ...input.file, size: 1 }, request: { kind: 'thumbnail', width: 2, height: 2 } })).resolves.toMatchObject({ ok: false, reason: 'too-large', message: expect.stringContaining('4194304') })
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps biology-index-transport passive and observation-only without reading a missing file', async () => {
    const root = await workspace()
    const input = inputFor('biology-index-transport', root, join(root, 'missing.fasta.fai'))
    const provider = providerFor(input)
    await expect(provider.observe!(input)).resolves.toMatchObject({ ok: true, bytesRead: 0, truncated: false, observation: { actions: ['observe'] } })
    expect(provider.invokeAction).toBeUndefined()
    expect(provider.exportPreview).toBeUndefined()
    expect(provider.prepareArtifact).toBeUndefined()
  })
})

describe('built-in Life Science Preview artifact and export parity', () => {
  it.each(['tile', 'thumbnail'] as const)('decodes real TIFF %s bytes into PNG at the inclusive binary limit', async (kind) => {
    const root = await workspace()
    const path = join(root, 'image.tif')
    const bytes = Buffer.alloc(LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES)
    bytes.set(tinyRgbTiff())
    await writeFile(path, bytes)
    const input = inputFor('bioimaging', root, path)
    const request = kind === 'tile'
      ? { kind, level: 0, x: 0, y: 0, width: 2, height: 2 }
      : { kind, width: 2, height: 2 }
    const result = await providerFor(input).prepareArtifact!({ ...input, request })
    expect(result).toMatchObject({ ok: true, kind, mimeType: 'image/png', bytesRead: 4194304, truncated: false })
    if (result.ok && (result.kind === 'tile' || result.kind === 'thumbnail')) {
      expect([...result.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    }
  })

  it('rejects unsupported artifact kinds and formats before opening a file', async () => {
    const root = await workspace()
    const input = inputFor('bioimaging', root, join(root, 'missing.png'))
    const provider = providerFor(input)
    await expect(provider.prepareArtifact!({ ...input, request: { kind: 'cache-artifact', source: 'observation' } })).resolves.toMatchObject({ ok: false, reason: 'unsupported-artifact' })
    await expect(provider.prepareArtifact!({ ...input, request: { kind: 'thumbnail', width: 2, height: 2 } })).resolves.toMatchObject({ ok: false, reason: 'unsupported-format' })
    const { open } = await import('node:fs/promises')
    expect(open).not.toHaveBeenCalled()
  })

  it('copies source bytes exclusively and keeps default exports unique', async () => {
    const root = await workspace()
    const path = join(root, 'source.fasta')
    await writeFile(path, fasta)
    const input = inputFor('sequence-genomics', root, path)
    const provider = providerFor(input)
    const target = { kind: 'workspace-file' as const, format: 'fasta' }
    const first = await provider.exportPreview!({ ...input, target, now: input.session.updatedAt })
    const second = await provider.exportPreview!({ ...input, target, now: input.session.updatedAt })
    expect(first).toMatchObject({ ok: true, path: join(await realpath(root), 'source.export.fasta') })
    expect(second).toMatchObject({ ok: true, path: join(await realpath(root), 'source.export-2.fasta') })
    if (!first.ok) return
    expect(await readFile(first.path, 'utf8')).toBe(fasta)
    await expect(provider.exportPreview!({ ...input, target: { ...target, path: first.path }, now: input.session.updatedAt })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe(fasta)
  })

  it('rejects format conversion, outside targets, and symlink-parent targets', async () => {
    const root = await workspace()
    const outside = await workspace()
    const path = join(root, 'source.fasta')
    await writeFile(path, fasta)
    await symlink(outside, join(root, 'exports'))
    const input = inputFor('sequence-genomics', root, path)
    const provider = providerFor(input)
    const now = input.session.updatedAt
    await expect(provider.exportPreview!({ ...input, target: { kind: 'workspace-file', format: 'gb' }, now })).resolves.toMatchObject({ ok: false })
    for (const targetPath of [join(outside, 'copy.fasta'), 'exports/copy.fasta']) {
      await expect(provider.exportPreview!({ ...input, target: { kind: 'workspace-file', format: 'fasta', path: targetPath }, now })).rejects.toThrow(/within the selected workspace/)
    }
  })

  it('rejects an outside export source before creating target directories', async () => {
    const root = await workspace()
    const outside = await workspace()
    const path = join(outside, 'source.fasta')
    await writeFile(path, fasta)
    const input = inputFor('sequence-genomics', root, path)
    await expect(providerFor(input).exportPreview!({ ...input, target: { kind: 'workspace-file', format: 'fasta', path: 'exports/copy.fasta' }, now: input.session.updatedAt })).rejects.toThrow(/within the selected workspace/)
    await expect(readFile(join(root, 'exports', 'copy.fasta'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('observes a bounded package-owned bioimaging metadata envelope', async () => {
    const root = await workspace()
    const path = join(root, 'image.tif')
    await writeFile(path, tinyRgbTiff())
    const input = inputFor('bioimaging', root, path)
    const result = await providerFor(input).observe!(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(decodeLifeScienceObservationMetadata(result.observation.pluginMetadata?.[0])).toMatchObject({ kind: 'bioimaging', observation: { format: 'tiff', dimensions: { width: 2, height: 2 }, tilePlan: { tileRendererImplemented: true } } })
  })
})

describe('built-in Life Science Preview action JSON contract', () => {
  it.each([
    ['omics-matrix', 'counts.mtx', 'omics.preview', ['dataset', 'placeholder']],
    ['omics-matrix', 'counts.mtx', 'omics.inspectMetadata', ['dataset']],
    ['omics-matrix', 'counts.mtx', 'omics.declareCapabilities', ['placeholder']],
    ['proteomics-spectra', 'peaks.mgf', 'spectra.preview', ['fcs']],
    ['proteomics-spectra', 'empty.mgf', 'spectra.inspectScans', ['mzRange', 'intensityRange']],
    ['bioimaging', 'image.tif', 'bioimaging.observeMetadata', ['placeholder']],
    ['bioimaging', 'image.tif', 'bioimaging.inspectHeader', ['ome', 'placeholder']],
    ['bioimaging', 'image.tif', 'bioimaging.describeTilePlan', ['placeholder']]
  ] as const)('%s %s %s omits absent optional output properties', async (pluginId, name, actionId, absentKeys) => {
    const root = await workspace()
    const path = join(root, name)
    const contents = pluginId === 'bioimaging'
      ? tinyRgbTiff()
      : pluginId === 'omics-matrix'
        ? '%%MatrixMarket matrix coordinate integer general\n2 2 1\n1 1 0\n'
        : name === 'empty.mgf'
          ? 'BEGIN IONS\nTITLE=empty\nEND IONS\n'
          : 'BEGIN IONS\nTITLE=sample\n0 0\n100 200\nEND IONS\n'
    await writeFile(path, contents)
    const input = inputFor(pluginId, root, path)
    const result = await providerFor(input).invokeAction!({ ...input, action: { actionId, input: {} } })
    expect(result).toMatchObject({ ok: true, bytesRead: Buffer.byteLength(contents), truncated: false })
    if (!result.ok) throw new Error(result.message)
    expect(workspacePreviewJsonValueSchema.parse(result.result)).toEqual(result.result)
    for (const key of absentKeys) expect(result.result).not.toHaveProperty(key)
    if (actionId === 'spectra.preview') {
      expect(result.result).toMatchObject({ scanCount: 0, mzRange: { min: 0, max: 100 }, intensityRange: { min: 0, max: 200 } })
    }
    if (actionId === 'bioimaging.describeTilePlan') {
      expect(result.result).toMatchObject({ tilePlan: { levels: [{ level: 0 }] } })
    }
  })
})

function tinyRgbTiff(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(140)
  const view = new DataView(bytes.buffer)
  bytes.set([73, 73, 42, 0, 8, 0, 0, 0])
  view.setUint16(8, 9, true)
  const entries = [
    [256, 4, 1, 2], [257, 4, 1, 2], [258, 3, 3, 122],
    [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 128],
    [277, 3, 1, 3], [278, 4, 1, 2], [279, 4, 1, 12]
  ]
  entries.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12
    view.setUint16(offset, tag!, true)
    view.setUint16(offset + 2, type!, true)
    view.setUint32(offset + 4, count!, true)
    view.setUint32(offset + 8, value!, true)
  })
  for (const offset of [122, 124, 126]) view.setUint16(offset, 8, true)
  bytes.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255], 128)
  return bytes
}
