import { mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, rgb } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewPluginManifestSchema
} from '../../../shared/workspace-preview'
import { WorkspacePreviewHost } from './host'

describe('WorkspacePreviewHost visual rendering', () => {
  let rootDir = ''
  let workspaceRoot = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'workspace-preview-visual-'))
    workspaceRoot = join(rootDir, 'workspace')
    await mkdir(workspaceRoot)
  })

  for (const fixture of [
    { extension: 'png', mimeType: 'image/png', encoding: 'png' },
    { extension: 'jpg', mimeType: 'image/jpeg', encoding: 'jpeg' },
    { extension: 'webp', mimeType: 'image/webp', encoding: 'webp' }
  ] as const) {
    it(`renders ${fixture.extension.toUpperCase()} through the image provider with trusted metadata`, async () => {
      const canvas = createCanvas(120, 80)
      const context = canvas.getContext('2d')
      context.fillStyle = '#2255cc'
      context.fillRect(0, 0, 120, 80)
      const bytes = fixture.encoding === 'png'
        ? canvas.encodeSync('png')
        : canvas.encodeSync(fixture.encoding, 80)
      const path = join(workspaceRoot, `figure.${fixture.extension}`)
      await writeFile(path, bytes)

      const host = new WorkspacePreviewHost({
        createSessionId: () => `session-${fixture.extension}`
      })
      const opened = await host.open({
        workspaceRoot,
        path,
        mimeType: fixture.mimeType,
        now: '2026-07-26T10:00:00.000Z'
      })
      expect(opened.ok).toBe(true)
      if (!opened.ok) return

      const frame = await host.renderVisual(opened.session.id, {
        maxDimension: 512
      })

      expect(frame).toMatchObject({
        mimeType: fixture.mimeType,
        width: 120,
        height: 80,
        sourceRevision: opened.session.updatedAt,
        anchor: {
          kind: 'workspace-preview-image'
        }
      })
      const decoded = await loadImage(Buffer.from(frame.bytes))
      expect({ width: decoded.width, height: decoded.height }).toEqual({
        width: frame.width,
        height: frame.height
      })
    })
  }

  it('maps the generic 1-based frameIndex to a PDF page and renders a bounded PNG', async () => {
    const pdf = await PDFDocument.create()
    const first = pdf.addPage([200, 100])
    first.drawRectangle({
      x: 10,
      y: 10,
      width: 60,
      height: 40,
      color: rgb(1, 0, 0)
    })
    const second = pdf.addPage([300, 180])
    second.drawRectangle({
      x: 20,
      y: 20,
      width: 100,
      height: 70,
      color: rgb(0, 0, 1)
    })
    const path = join(workspaceRoot, 'paper.pdf')
    await writeFile(path, await pdf.save())

    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-pdf-visual'
    })
    const opened = await host.open({
      workspaceRoot,
      path,
      mimeType: 'application/pdf',
      now: '2026-07-26T10:10:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const frame = await host.renderVisual(opened.session.id, {
      frameIndex: 2,
      maxDimension: 600
    })

    expect(frame).toMatchObject({
      mimeType: 'image/png',
      width: 600,
      height: 360,
      sourceRevision: opened.session.updatedAt,
      anchor: {
        kind: 'workspace-preview-document-frame',
        metadata: {
          frameIndex: 2
        }
      }
    })
    const decoded = await loadImage(Buffer.from(frame.bytes))
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: frame.width,
      height: frame.height
    })
  })

  it('renders a normalized PDF region without exposing provider coordinates to the host', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([300, 180])
    page.drawRectangle({
      x: 100,
      y: 60,
      width: 100,
      height: 60,
      color: rgb(0, 0, 1)
    })
    const path = join(workspaceRoot, 'region.pdf')
    await writeFile(path, await pdf.save())

    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-pdf-region'
    })
    const opened = await host.open({
      workspaceRoot,
      path,
      mimeType: 'application/pdf',
      now: '2026-07-26T10:20:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const frame = await host.renderVisual(opened.session.id, {
      frameIndex: 1,
      maxDimension: 300,
      target: {
        kind: 'region',
        region: {
          x: 0.25,
          y: 0.25,
          width: 0.5,
          height: 0.5
        }
      }
    })

    expect(frame).toMatchObject({
      mimeType: 'image/png',
      width: 300,
      height: 180,
      sourceRevision: opened.session.updatedAt,
      anchor: {
        kind: 'workspace-preview-document-region',
        metadata: {
          frameIndex: 1
        }
      }
    })
    const decoded = await loadImage(Buffer.from(frame.bytes))
    const inspected = createCanvas(decoded.width, decoded.height)
    const inspectedContext = inspected.getContext('2d')
    inspectedContext.drawImage(decoded, 0, 0)
    const pixels = inspectedContext.getImageData(0, 0, decoded.width, decoded.height).data
    let bluePixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 2]! > 150 && pixels[index + 2]! > pixels[index]! + 50) {
        bluePixels += 1
      }
    }
    expect(bluePixels).toBeGreaterThan(1_000)
  })

  it('rejects a visual render after the session source changes', async () => {
    const canvas = createCanvas(40, 30)
    const path = join(workspaceRoot, 'changing.png')
    await writeFile(path, canvas.encodeSync('png'))
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-changing-image'
    })
    const opened = await host.open({
      workspaceRoot,
      path,
      mimeType: 'image/png'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await writeFile(path, Buffer.concat([canvas.encodeSync('png'), Buffer.from('changed')]))

    await expect(host.renderVisual(opened.session.id)).rejects.toThrow(
      'source changed after the session was opened'
    )
  })

  it('rejects a provider frame whose source revision does not match the session', async () => {
    const canvas = createCanvas(20, 10)
    const frameBytes = canvas.encodeSync('png')
    const path = join(workspaceRoot, 'source.visual')
    await writeFile(path, 'fixture', 'utf8')
    const manifest = workspacePreviewPluginManifestSchema.parse({
      contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      id: 'fixture.visual',
      displayName: 'Fixture visual',
      version: '1.0.0',
      modality: 'fixture.visual',
      lifecycle: 'main',
      extensions: ['.visual'],
      mimeTypes: ['application/x-fixture-visual'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: false
      }
    })
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-wrong-revision',
      domainPlugins: [{
        ownerId: 'fixture.visual',
        manifest,
        provider: {
          pluginId: manifest.id,
          renderVisual: async () => ({
            bytes: new Uint8Array(frameBytes),
            mimeType: 'image/png',
            width: 20,
            height: 10,
            sourceRevision: 'wrong-revision',
            anchor: {
              kind: 'fixture'
            }
          })
        }
      }]
    })
    const opened = await host.open({
      workspaceRoot,
      path,
      mimeType: 'application/x-fixture-visual',
      now: '2026-07-26T10:30:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(host.renderVisual(opened.session.id)).rejects.toThrow(
      'rendered revision wrong-revision'
    )
  })

  it('revalidates workspace confinement before delegating a visual render', async () => {
    const canvas = createCanvas(40, 30)
    const sourcePath = join(workspaceRoot, 'confined.png')
    await writeFile(sourcePath, canvas.encodeSync('png'))
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-confined-image'
    })
    const opened = await host.open({
      workspaceRoot,
      path: sourcePath,
      mimeType: 'image/png'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await rename(sourcePath, join(workspaceRoot, 'original.png'))
    const outsidePath = join(rootDir, 'outside.png')
    await writeFile(outsidePath, canvas.encodeSync('png'))
    await symlink(outsidePath, sourcePath)

    await expect(host.renderVisual(opened.session.id)).rejects.toThrow(
      'must remain inside the selected workspace'
    )
  })
})
