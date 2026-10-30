/**
 * Channel round-trip for the wired plugin: the real named-runner child
 * (packages/plugin-sdk/src/process-extension-runner.mjs) loads the built
 * dist/main.js, activates it via the workspace-preview contribution channel
 * (gap-1b, sciforge-preview.v1), and serves render-time calls out of a real
 * temp workspace. Asserts the wire contract end to end and cross-process
 * parity against the same provider running in-process in the test process.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { pluginAdapterDeclarationSchema } from '@sciforge/plugin-sdk'

import { createLifeScienceWorkspacePreviewProvider } from '../src/core/index.js'
import { createNodeFilePorts } from '../src/dsh-adapter/node-file-ports.js'
import { createRealDataPorts } from './helpers/memory-ports.js'
import {
  CONTRACTS,
  FASTA_FIXTURE,
  makeObservationInput,
  tinyRgbTiffFixture
} from './helpers/inputs.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const runnerPath = resolve(pluginRoot, '..', '..', 'packages', 'plugin-sdk', 'src', 'process-extension-runner.mjs')
const entryPath = join(pluginRoot, 'dist', 'main.js')

function request(child: ChildProcess, command: string, payload: unknown): Promise<{
  ok: boolean
  result?: unknown
  error?: { message?: string; code?: string }
}> {
  const requestId = randomUUID()
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage)
      reject(new Error(`Runner ${command} request timed out.`))
    }, 30_000)
    function onMessage(message: unknown) {
      const response = message as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: { message?: string; code?: string } }
      if (response.type !== 'response' || response.requestId !== requestId) return
      clearTimeout(timer)
      child.off('message', onMessage)
      resolveRequest({ ok: response.ok === true, result: response.result, error: response.error })
    }
    child.on('message', onMessage)
    child.send({ type: 'request', requestId, command, payload })
  })
}

function previewEnvelope(method: string, slotId: string, workspaceRoot: string, input: unknown) {
  return {
    protocol: 'sciforge-preview.v1',
    requestId: randomUUID(),
    slotId,
    method,
    workspaceRoot,
    input
  }
}

function decodeWireResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const candidate = result as { ok?: unknown; bytesBase64?: unknown }
  if (candidate.ok !== true || typeof candidate.bytesBase64 !== 'string') return result
  const { bytesBase64, ...rest } = candidate as { bytesBase64: string } & Record<string, unknown>
  return { ...rest, bytes: new Uint8Array(Buffer.from(bytesBase64, 'base64')) }
}

describe('workspace-preview channel round-trip (real runner + built entry)', () => {
  let workspace = ''
  let child: ChildProcess

  before(async () => {
    await execFileAsync(process.execPath, [join(pluginRoot, 'build.mjs')])
    workspace = await mkdtemp(join(tmpdir(), 'lsp-channel-workspace-'))
    await mkdir(join(workspace, 'seqs'), { recursive: true })
    await mkdir(join(workspace, 'images'), { recursive: true })
    await writeFile(join(workspace, 'seqs', 'demo.fasta'), FASTA_FIXTURE)
    await writeFile(join(workspace, 'images', 'demo.tif'), tinyRgbTiffFixture())
    child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    await once(child, 'message', { signal: AbortSignal.timeout(10_000) })
    const activated = await request(child, 'activate', { packageName: '@sciforge/plugin-life-science-preview' })
    assert.equal(activated.ok, true, activated.error?.message)
  })

  after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(workspace, { recursive: true, force: true })
  })

  it('lists exactly the six declared slots with bioimaging byte kinds', async () => {
    const slots = await request(child, 'preview-slots', undefined)
    assert.equal(slots.ok, true)
    const listed = slots.result as Array<{ slotId: string; artifactKinds: string[]; manifest: { id: string } }>
    assert.deepEqual(listed.map((slot) => slot.slotId), [
      'molecular',
      'sequence-genomics',
      'biology-index-transport',
      'omics-matrix',
      'bioimaging',
      'proteomics-spectra'
    ])
    for (const slot of listed) assert.equal(slot.manifest.id, slot.slotId)
    const bioimaging = listed.find((slot) => slot.slotId === 'bioimaging')!
    assert.deepEqual(bioimaging.artifactKinds, ['tile', 'thumbnail'])
  })

  it('serves sequence observe over the channel with cross-process parity', async () => {
    const fastaPath = join(workspace, 'seqs', 'demo.fasta')
    const input = makeObservationInput(CONTRACTS.sequence, workspace, fastaPath, 'seqs/demo.fasta')
    const channel = await request(child, 'preview', previewEnvelope('observe', 'sequence-genomics', workspace, input))
    assert.equal(channel.ok, true, channel.error?.message)

    const nodePorts = createNodeFilePorts()
    const inProcess = createLifeScienceWorkspacePreviewProvider(CONTRACTS.sequence.manifest, {
      files: nodePorts.read,
      writes: nodePorts.write,
      data: createRealDataPorts()
    })
    const local = await inProcess.observe!(input)

    assert.equal((channel.result as { ok: boolean }).ok, true)
    assert.deepEqual(channel.result, local)
  })

  it('serves bioimaging thumbnail bytes over the channel, byte-identical in process', async () => {
    const tiffPath = join(workspace, 'images', 'demo.tif')
    const input = {
      ...makeObservationInput(CONTRACTS.bioimaging, workspace, tiffPath, 'images/demo.tif'),
      request: { kind: 'thumbnail' as const, width: 4, height: 4 }
    }
    const channel = await request(child, 'preview', previewEnvelope('prepareArtifact', 'bioimaging', workspace, input))
    assert.equal(channel.ok, true, channel.error?.message)
    const decoded = decodeWireResult(channel.result) as { ok: true; bytes: Uint8Array; mimeType: string; kind: string; bytesRead: number }
    assert.equal(decoded.kind, 'thumbnail')
    assert.equal(decoded.mimeType, 'image/png')
    assert.deepEqual([...decoded.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

    const nodePorts = createNodeFilePorts()
    const inProcess = createLifeScienceWorkspacePreviewProvider(CONTRACTS.bioimaging.manifest, {
      files: nodePorts.read,
      writes: nodePorts.write,
      data: createRealDataPorts()
    })
    const local = await inProcess.prepareArtifact!(input)
    assert.equal(local.ok, true)
    if (!local.ok) return
    assert.deepEqual(decoded.bytes, local.bytes, 'channel PNG payload must equal the in-process provider byte-for-byte')
    assert.equal(decoded.bytesRead, local.bytesRead)
  })

  it('rejects workspace mismatches and unknown slots child-side', async () => {
    const fastaPath = join(workspace, 'seqs', 'demo.fasta')
    const input = makeObservationInput(CONTRACTS.sequence, workspace, fastaPath, 'seqs/demo.fasta')
    const mismatched = await request(child, 'preview', previewEnvelope('observe', 'sequence-genomics', '/ws/other', input))
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error?.code, 'workspace_mismatch')

    const unknown = await request(child, 'preview', previewEnvelope('observe', 'not-a-slot', workspace, input))
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error?.code, 'unsupported_slot')
  })

  it('adapter declaration parses and names exactly the wired slots', async () => {
    const declaration = pluginAdapterDeclarationSchema.parse(
      JSON.parse(await readFile(join(pluginRoot, 'sciforge.adapter.json'), 'utf8'))
    )
    assert.equal(declaration.kind, 'workspace-preview')
    assert.deepEqual(
      declaration.previewSlots?.map((slot) => slot.slotId).sort(),
      ['bioimaging', 'biology-index-transport', 'molecular', 'omics-matrix', 'proteomics-spectra', 'sequence-genomics']
    )
  })
})
