import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { WorkspacePreviewHost } from './host'

describe('document processing through canonical preview operations', () => {
  it('reads PDF pages with source anchors within the structured tool output budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preview-document-'))
    try {
      const pdf = await PDFDocument.create()
      for (let i = 1; i <= 3; i++) pdf.addPage().drawText(`Page ${i}: verifiable evidence.`)
      const path = join(root, 'paper.pdf')
      await writeFile(path, await pdf.save())
      const host = new WorkspacePreviewHost()
      const opened = await host.open({ workspaceRoot: root, path })
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const result = await host.readRange(opened.session.id, { maxCharacters: 4000 })
      expect(result.ok && 'text' in result).toBe(true)
      if (!result.ok || !('text' in result)) return
      expect(result.text).toContain('Page 3: verifiable evidence.')
      expect(result.anchors?.map(a => a.frameIndex)).toEqual([1, 2, 3])
      const selected = await host.readRange(opened.session.id, { frameIndex: 2, query: 'verifiable', maxCharacters: 4000 })
      expect(selected.ok && 'text' in selected && selected.text).toBe('verifiable evidence. \n\n')
      expect(selected.ok && 'anchors' in selected && selected.anchors?.map(a => a.frameIndex)).toEqual([2])
      const serialized = JSON.stringify(result)
      expect(JSON.stringify([{ type: 'text', text: serialized }]).length).toBeLessThan(6000)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  for (const format of ['png', 'jpeg', 'pdf'] as const) {
    it(`exports a normalized ${format} region with provenance, without replacing existing files`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-export-')))
      try {
        const path = join(root, `source.${format}`)
        if (format === 'pdf') {
          const pdf = await PDFDocument.create()
          pdf.addPage([200, 100]).drawRectangle({ x: 20, y: 40, width: 60, height: 40, color: rgb(1, 0, 0) })
          await writeFile(path, await pdf.save())
        } else {
          const canvas = createCanvas(200, 100)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(20, 20, 60, 40)
          await writeFile(path, format === 'png' ? canvas.encodeSync('png') : canvas.encodeSync('jpeg', 90))
        }
        const host = new WorkspacePreviewHost()
        const opened = await host.open({ workspaceRoot: root, path })
        expect(opened.ok).toBe(true)
        if (!opened.ok) return
        const destination = join(root, 'crop.png')
        const target = { kind: 'workspace-file' as const, format: 'png', path: destination,
          render: { region: { x: 0, y: 0, width: 0.5, height: 1 }, maxDimension: 100 } }
        const exported = await host.exportPreview(opened.session.id, target)
        expect(exported.ok, JSON.stringify(exported)).toBe(true)
        if (!exported.ok) return
        expect(exported.visual).toMatchObject({ width: 100, height: 100 })
        expect(exported.visual?.sha256).toMatch(/^[a-f0-9]{64}$/)
        const original = await readFile(destination)
        const image = await loadImage(original)
        expect([image.width, image.height]).toEqual([100, 100])
        const canvas = createCanvas(100, 100)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        // RGB encoding alone does not prove color fidelity: a grayscale mask
        // converted back to RGB also has three channels. Check actual chroma.
        const [red, green, blue, alpha] = ctx.getImageData(30, 30, 1, 1).data
        expect(red).toBeGreaterThan(230)
        expect(green).toBeLessThan(20)
        expect(blue).toBeLessThan(20)
        expect(alpha).toBe(255)
        if (format === 'png') {
          expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0)
          expect(ctx.getImageData(30, 30, 1, 1).data[3]).toBe(255)
        }
        expect((await host.exportPreview(opened.session.id, target)).ok).toBe(false)
        expect(await readFile(destination)).toEqual(original)
        expect((await host.exportPreview(opened.session.id, { ...target, path: join(root, '..', 'outside.png') })).ok).toBe(false)
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }
})
