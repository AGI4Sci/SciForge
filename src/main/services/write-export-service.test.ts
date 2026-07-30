import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  dialog: {
    showSaveDialog: vi.fn()
  }
}))

import {
  buildWriteExportFileName,
  buildWriteExportHtmlFragment,
  buildWriteExportHtmlDocument,
  buildWriteExportLatexDocument,
  exportWriteDocument
} from './write-export-service'
import { dialog } from 'electron'

describe('write-export-service helpers', () => {
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-export-'))
    vi.mocked(dialog.showSaveDialog).mockReset()
  })

  it('builds export file names with the requested extension', () => {
    expect(buildWriteExportFileName('/tmp/draft.md', 'html')).toBe('draft.html')
    expect(buildWriteExportFileName('/tmp/draft.md', 'pdf')).toBe('draft.pdf')
    expect(buildWriteExportFileName('/tmp/draft.md', 'doc')).toBe('draft.doc')
    expect(buildWriteExportFileName('/tmp/draft.md', 'docx')).toBe('draft.docx')
    expect(buildWriteExportFileName('/tmp/draft.md', 'tex')).toBe('draft.tex')
  })

  it('renders markdown exports with resolved links and inlined local images', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: '# Heading\n\n![Cover](./cover.png)\n\n[Notes](./notes.md)',
      workspaceRoot
    })

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain('href="./notes.md"')
  })

  it('does not inline markdown images outside the workspace', async () => {
    const sourcePath = join(workspaceRoot, 'docs', 'draft.md')
    const outsideImagePath = join(workspaceRoot, '..', 'outside.png')
    await writeFile(outsideImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: '![Outside](../../outside.png)',
      workspaceRoot
    })

    expect(html).not.toContain('src="data:image/png;base64,')
    expect(html).toContain('alt="Outside"')
  })

  it('filters unsafe embedded media URLs from exported markdown', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteExportHtmlFragment({
      sourcePath,
      content: [
        '![Safe](data:image/png;base64,AAAA)',
        '![Svg](data:image/svg+xml;base64,AAAA)',
        '![Html](data:text/html;base64,PHNjcmlwdA==)',
        '[Bad](javascript:alert(1))'
      ].join('\n\n'),
      workspaceRoot
    })

    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('image/svg+xml')
    expect(html).not.toContain('data:text/html')
    expect(html).not.toContain('javascript:alert')
  })

  it('renders markdown math in export html', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: 'Inline $E=mc^2$ and \\(F=ma\\).\n\n$$\na^2 + b^2 = c^2\n$$\n\n\\[x+y=z\\]'
    })

    expect(html).toContain('katex')
    expect(html).toContain('E')
    expect(html).toContain('mc')
    expect(html).toContain('F')
    expect(html).toContain('ma')
  })

  it('builds latex documents from markdown content', () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const latex = buildWriteExportLatexDocument({
      sourcePath,
      content: '# Heading\n\nInline \\(E=mc^2\\).\n\n![Cover](./cover.png)',
      title: 'Draft'
    })

    expect(latex).toContain('\\documentclass[UTF8]{ctexart}')
    expect(latex).toContain('\\section{Heading}')
    expect(latex).toContain('\\(E=mc^2\\)')
    expect(latex).toContain('\\includegraphics')
  })

  it('exports tex sources without wrapping them again', () => {
    const sourcePath = join(workspaceRoot, 'draft.tex')
    const latex = buildWriteExportLatexDocument({
      sourcePath,
      content: '\\section{Existing}',
      title: 'Draft'
    })

    expect(latex).toBe('\\section{Existing}')
  })

  it('writes exports through the workspace safe-write path', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const exportPath = join(workspaceRoot, 'draft.html')
    await writeFile(sourcePath, '# Draft', 'utf8')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: exportPath
    })

    const result = await exportWriteDocument({
      path: sourcePath,
      workspaceRoot,
      format: 'html',
      content: '# Draft'
    })

    expect(result).toMatchObject({ ok: true, path: await realpath(exportPath), format: 'html' })
    expect(await readFile(exportPath, 'utf8')).toContain('<h1>Draft</h1>')
  })

  it('does not follow symlinked export targets inside the workspace', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const outsideRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-export-outside-'))
    const outsideTarget = join(outsideRoot, 'outside.html')
    const symlinkTarget = join(workspaceRoot, 'draft.html')
    await writeFile(sourcePath, '# Draft', 'utf8')
    await writeFile(outsideTarget, 'outside stays unchanged', 'utf8')
    await symlink(outsideTarget, symlinkTarget)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: symlinkTarget
    })

    const result = await exportWriteDocument({
      path: sourcePath,
      workspaceRoot,
      format: 'html',
      content: '# Draft'
    })

    expect(result).toMatchObject({ ok: false, canceled: false })
    expect(result.ok ? '' : result.message).toMatch(/workspace|symlink/i)
    expect(await readFile(outsideTarget, 'utf8')).toBe('outside stays unchanged')
  })

  it('renders export html fragments for markdown content', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteExportHtmlFragment({
      sourcePath,
      content: '# Heading\n\n**Bold**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Notes](./notes.md)',
      workspaceRoot
    })

    expect(html).toContain('<article class="markdown-body">')
    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('href="./notes.md"')
  })

  it('renders export html fragments for plain text content', async () => {
    const sourcePath = join(workspaceRoot, 'draft.txt')
    const html = await buildWriteExportHtmlFragment({
      sourcePath,
      content: 'plain text\nline two',
      workspaceRoot
    })

    expect(html).toContain('<article class="markdown-body">')
    expect(html).toContain('<pre class="plain-text">plain text\nline two</pre>')
  })
})
