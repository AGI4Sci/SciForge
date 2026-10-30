import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceHtmlPreviewService } from './workspace-html-preview-service'

describe('WorkspaceHtmlPreviewService', () => {
  let service: WorkspaceHtmlPreviewService | null = null

  afterEach(async () => {
    await service?.close()
    service = null
  })

  it('serves an HTML file and relative assets from the preview directory behind a token', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    const previewDirectory = join(workspaceRoot, 'site')
    await mkdir(previewDirectory)
    await writeFile(
      join(previewDirectory, 'status.html'),
      '<link rel="stylesheet" href="style.css"><h1>Ready</h1>',
      'utf8'
    )
    await writeFile(join(previewDirectory, 'style.css'), 'body { color: rgb(1, 2, 3); }', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    const preview = await service.preview({ workspaceRoot, path: 'site/status.html' })
    expect(preview).toMatchObject({ ok: true })
    if (!preview.ok) return
    expect(new URL(preview.url).pathname).toMatch(/^\/[A-Za-z0-9_-]{32}\/status\.html$/)

    const html = await fetch(preview.url)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    await expect(html.text()).resolves.toContain('<h1>Ready</h1>')

    const css = await fetch(new URL('style.css', preview.url))
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
    await expect(css.text()).resolves.toContain('rgb(1, 2, 3)')
  })

  it('rejects missing or invalid preview tokens', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    await writeFile(join(workspaceRoot, 'status.html'), '<h1>Ready</h1>', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    const preview = await service.preview({ workspaceRoot, path: 'status.html' })
    expect(preview).toMatchObject({ ok: true })
    if (!preview.ok) return

    const previewUrl = new URL(preview.url)
    await expect(fetch(`${previewUrl.origin}/status.html`).then((response) => response.status)).resolves.toBe(403)
    await expect(fetch(`${previewUrl.origin}/not-the-token/status.html`).then((response) => response.status)).resolves.toBe(403)
  })

  it('rejects non-HTML entry points', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    await writeFile(join(workspaceRoot, 'notes.txt'), 'hello', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    await expect(service.preview({ workspaceRoot, path: 'notes.txt' })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Only .html and .htm')
    })
  })

  it('rejects absolute HTML previews without a workspace root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    const htmlPath = join(workspaceRoot, 'status.html')
    await writeFile(htmlPath, '<h1>Ready</h1>', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    await expect(service.preview({ path: htmlPath })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Workspace root is required')
    })
  })

  it('blocks served paths outside the preview directory', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    const previewDirectory = join(workspaceRoot, 'site')
    await mkdir(previewDirectory)
    await writeFile(join(previewDirectory, 'status.html'), '<h1>Ready</h1>', 'utf8')
    await writeFile(join(workspaceRoot, 'secret.txt'), 'hidden', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    const preview = await service.preview({ workspaceRoot, path: 'site/status.html' })
    expect(preview).toMatchObject({ ok: true })
    if (!preview.ok) return

    const previewUrl = new URL(preview.url)
    const token = previewUrl.pathname.split('/')[1]
    const blocked = await fetch(`${previewUrl.origin}/${token}/..%2Fsecret.txt`)
    expect(blocked.status).toBe(403)
  })
})
