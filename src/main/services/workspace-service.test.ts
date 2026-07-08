import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn()
  },
  clipboard: {
    availableFormats: vi.fn(),
    read: vi.fn(),
    readBookmark: vi.fn(),
    readBuffer: vi.fn(),
    readImage: vi.fn(),
    readText: vi.fn()
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import { clipboard, shell } from 'electron'

import {
  copyWorkspaceEntry,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  importWorkspaceEntries,
  listWorkspaceDirectory,
  openEditorPath,
  pasteWorkspaceClipboard,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  saveWorkspaceClipboardImage,
  writeWorkspaceDocxText,
  writeWorkspaceFile
} from './workspace-service'

describe('workspace-service boundary checks', () => {
  let rootDir = ''
  let workspaceRoot = ''
  let outsideFile = ''

  beforeEach(async () => {
    vi.mocked(clipboard.readImage).mockReset()
    vi.mocked(clipboard.readText).mockReset()
    vi.mocked(clipboard.availableFormats).mockReset()
    vi.mocked(clipboard.read).mockReset()
    vi.mocked(clipboard.readBookmark).mockReset()
    vi.mocked(clipboard.readBuffer).mockReset()
    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => true
    } as Electron.NativeImage)
    vi.mocked(clipboard.readText).mockReturnValue('')
    vi.mocked(clipboard.availableFormats).mockReturnValue([])
    vi.mocked(clipboard.read).mockReturnValue('')
    vi.mocked(clipboard.readBookmark).mockReturnValue({ title: '', url: '' })
    vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.alloc(0))
    vi.mocked(shell.openPath).mockReset()
    vi.mocked(shell.openPath).mockResolvedValue('')
    rootDir = await mkdtemp(join(tmpdir(), 'sciforge-workspace-'))
    workspaceRoot = join(rootDir, 'workspace')
    outsideFile = join(rootDir, 'outside.txt')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'inside.txt'), 'inside', 'utf8')
    await writeFile(outsideFile, 'outside', 'utf8')
  })

  async function writeMinimalDocx(path: string): Promise<void> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>'
    ].join(''))
    zip.file('_rels/.rels', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join(''))
    zip.file('word/document.xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Study note</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>First paragraph</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>with tab</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''))
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  }

  it('allows files inside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(await realpath(join(workspaceRoot, 'inside.txt')))
    }
  })

  it('rejects relative paths that escape the selected workspace', async () => {
    const result = await readWorkspaceFile({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('rejects absolute paths outside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: outsideFile,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('rejects absolute workspace file operations without a workspace root', async () => {
    const imagePath = join(rootDir, 'outside.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const results = await Promise.all([
      resolveWorkspaceFile({ path: outsideFile }),
      readWorkspaceFile({ path: outsideFile }),
      readWorkspaceImage({ path: imagePath }),
      writeWorkspaceFile({ path: outsideFile, content: 'overwrite' }),
      createWorkspaceFile({ path: join(rootDir, 'created.txt'), workspaceRoot: '', content: 'created' }),
      createWorkspaceDirectory({ path: join(rootDir, 'created-dir'), workspaceRoot: '' }),
      deleteWorkspaceEntry({ path: outsideFile, workspaceRoot: '' }),
      openEditorPath({ path: outsideFile, editorId: 'system' })
    ])

    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Workspace root is required')
      }
    }
    expect(shell.openPath).not.toHaveBeenCalled()
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('lists directories and files inside the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'draft.md'), '# draft', 'utf8')
    const result = await listWorkspaceDirectory({ workspaceRoot, path: workspaceRoot })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries.map((entry) => entry.name)).toEqual(['notes', 'inside.txt'])
      expect(result.entries[0].type).toBe('directory')
    }
  })

  it('creates and saves files within the selected workspace', async () => {
    const createResult = await createWorkspaceFile({
      path: 'notes/new.md',
      workspaceRoot,
      content: '# first draft'
    })

    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const saveResult = await writeWorkspaceFile({
      path: createResult.path,
      workspaceRoot,
      content: '# revised draft'
    })
    expect(saveResult.ok).toBe(true)

    const readResult = await readWorkspaceFile({
      path: createResult.path,
      workspaceRoot
    })
    expect(readResult.ok).toBe(true)
    if (readResult.ok) {
      expect(readResult.kind).toBe('text')
      expect(readResult.content).toBe('# revised draft')
    }
  })

  it('writes binary workspace files from base64 payloads', async () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00])
    const saveResult = await writeWorkspaceFile({
      path: 'papers/uploaded.pdf',
      workspaceRoot,
      contentBase64: pdfBytes.toString('base64')
    })

    expect(saveResult.ok).toBe(true)
    const written = await readFile(join(workspaceRoot, 'papers', 'uploaded.pdf'))
    expect(written).toEqual(pdfBytes)
  })

  it('rejects workspace writes through symlinked parent directories that leave the workspace', async () => {
    const outsideDir = join(rootDir, 'outside-dir')
    await mkdir(outsideDir)
    await symlink(outsideDir, join(workspaceRoot, 'linked-out'), 'dir')

    const saveResult = await writeWorkspaceFile({
      path: 'linked-out/escaped.md',
      workspaceRoot,
      content: 'escape'
    })
    const createResult = await createWorkspaceDirectory({
      path: 'linked-out/generated',
      workspaceRoot
    })

    expect(saveResult.ok).toBe(false)
    expect(createResult.ok).toBe(false)
    if (!saveResult.ok) expect(saveResult.message).toContain('within the selected workspace')
    if (!createResult.ok) expect(createResult.message).toContain('within the selected workspace')
    await expect(readFile(join(outsideDir, 'escaped.md'), 'utf8')).rejects.toThrow()
    await expect(readdir(join(outsideDir, 'generated'))).rejects.toThrow()
  })

  it('rejects existing symlink write targets instead of following them', async () => {
    await symlink(outsideFile, join(workspaceRoot, 'linked-target.txt'))

    const result = await writeWorkspaceFile({
      path: 'linked-target.txt',
      workspaceRoot,
      content: 'overwrite'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/within the selected workspace|symlink/)
    }
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('marks oversized files as truncated when loading preview content', async () => {
    const largePath = join(workspaceRoot, 'large.md')
    await writeFile(largePath, 'a'.repeat(1_500_001), 'utf8')

    const result = await readWorkspaceFile({
      path: largePath,
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.truncated).toBe(true)
    expect(result.size).toBe(1_500_001)
    expect(result.content.length).toBeLessThan(result.size)
  })

  it('creates directories inside the selected workspace', async () => {
    const result = await createWorkspaceDirectory({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const listResult = await listWorkspaceDirectory({ workspaceRoot })
    expect(listResult.ok).toBe(true)
    if (listResult.ok) {
      expect(listResult.entries.some((entry) => entry.name === 'notes' && entry.type === 'directory')).toBe(true)
    }
  })

  it('saves pasted clipboard images into the workspace img directory and returns a markdown path', async () => {
    const currentFilePath = join(workspaceRoot, 'notes', 'draft.md')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(currentFilePath, '# draft', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('fake-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, 'img')))
    expect(result.markdownPath.startsWith('../img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('fake-png-bytes'))
  })

  it('reads clipboard images as PNG base64 without writing workspace files', async () => {
    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('clipboard-png-bytes'),
      getSize: () => ({ width: 12, height: 8 })
    } as Electron.NativeImage)

    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toMatch(/^pasted-image-.+\.png$/)
    expect(result.mimeType).toBe('image/png')
    expect(result.dataBase64).toBe(Buffer.from('clipboard-png-bytes').toString('base64'))
    expect(result.byteSize).toBe(Buffer.byteLength('clipboard-png-bytes'))
    expect(result.width).toBe(12)
    expect(result.height).toBe(8)
  })

  it('pastes clipboard text into a workspace directory', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    vi.mocked(clipboard.readText).mockReturnValue('clipboard note')

    const result = await pasteWorkspaceClipboard({
      workspaceRoot,
      targetDirectory: 'notes'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.name).toMatch(/^pasted-text-.+\.txt$/)
    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, 'notes')))
    await expect(readFile(result.path, 'utf8')).resolves.toBe('clipboard note')
  })

  it('pastes clipboard images before falling back to clipboard text', async () => {
    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('clipboard-png-bytes')
    } as Electron.NativeImage)
    vi.mocked(clipboard.readText).mockReturnValue('text fallback')

    const result = await pasteWorkspaceClipboard({
      workspaceRoot,
      targetDirectory: ''
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('image')
    if (result.kind !== 'image') return
    expect(result.name).toMatch(/^pasted-image-.+\.png$/)
    expect(await realpath(dirname(result.path))).toBe(await realpath(workspaceRoot))
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('clipboard-png-bytes'))
  })

  it('pastes clipboard files into a workspace directory through the import path', async () => {
    const sourceDir = join(rootDir, 'clipboard-source')
    await mkdir(join(sourceDir, 'images'), { recursive: true })
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(sourceDir, 'samples.csv'), 'sample,count\ns1,1\n', 'utf8')
    await writeFile(join(sourceDir, 'images', 'cell.txt'), 'cell', 'utf8')
    await writeFile(join(workspaceRoot, 'notes', 'samples.csv'), 'existing', 'utf8')
    vi.mocked(clipboard.availableFormats).mockReturnValue(['text/uri-list'])
    vi.mocked(clipboard.read).mockImplementation((format) =>
      format === 'text/uri-list'
        ? [
            pathToFileURL(join(sourceDir, 'samples.csv')).href,
            pathToFileURL(join(sourceDir, 'images')).href
          ].join('\n')
        : ''
    )
    vi.mocked(clipboard.readText).mockReturnValue('text fallback')

    const result = await pasteWorkspaceClipboard({
      workspaceRoot,
      targetDirectory: 'notes'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('files')
    if (result.kind !== 'files') return
    expect(result.imported.map((item) => item.name)).toEqual(['samples copy.csv', 'images'])
    await expect(readFile(join(workspaceRoot, 'notes', 'samples copy.csv'), 'utf8'))
      .resolves.toBe('sample,count\ns1,1\n')
    await expect(readFile(join(workspaceRoot, 'notes', 'images', 'cell.txt'), 'utf8')).resolves.toBe('cell')
    expect(clipboard.readImage).not.toHaveBeenCalled()
    expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('pastes clipboard files with skip conflict policy through the import path', async () => {
    const sourceDir = join(rootDir, 'clipboard-skip-source')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(sourceDir, 'samples.csv'), 'sample,count\ns1,1\n', 'utf8')
    await writeFile(join(workspaceRoot, 'notes', 'samples.csv'), 'existing', 'utf8')
    vi.mocked(clipboard.availableFormats).mockReturnValue(['text/uri-list'])
    vi.mocked(clipboard.read).mockImplementation((format) =>
      format === 'text/uri-list'
        ? pathToFileURL(join(sourceDir, 'samples.csv')).href
        : ''
    )

    const result = await pasteWorkspaceClipboard({
      workspaceRoot,
      targetDirectory: 'notes',
      conflictPolicy: { strategy: 'skip' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('files')
    if (result.kind !== 'files') return
    const skippedPath = await realpath(join(workspaceRoot, 'notes', 'samples.csv'))
    expect(result.imported).toEqual([
      expect.objectContaining({
        name: 'samples.csv',
        path: skippedPath,
        skipped: true
      })
    ])
    await expect(readFile(join(workspaceRoot, 'notes', 'samples.csv'), 'utf8')).resolves.toBe('existing')
    expect(clipboard.readImage).not.toHaveBeenCalled()
    expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('saves SDD pasted clipboard images into the requirement image directory', async () => {
    const draftId = '123e4567-e89b-12d3-a456-426614174000'
    const currentFilePath = join(workspaceRoot, '.sciforge', 'sdd', 'requirements', draftId, 'requirement.md')
    await mkdir(join(workspaceRoot, '.sciforge', 'sdd', 'requirements', draftId), { recursive: true })
    await writeFile(currentFilePath, '# requirement', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('sdd-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath,
      imageDirectory: `.sciforge/sdd/requirements/${draftId}/img`
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, '.sciforge', 'sdd', 'requirements', draftId, 'img')))
    expect(result.markdownPath.startsWith('img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('sdd-png-bytes'))
  })

  it('rejects pasted clipboard image writes through symlinked image directories outside the workspace', async () => {
    const currentFilePath = join(workspaceRoot, 'notes', 'draft.md')
    const outsideDir = join(rootDir, 'outside-images')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await mkdir(outsideDir)
    await writeFile(currentFilePath, '# draft', 'utf8')
    await symlink(outsideDir, join(workspaceRoot, 'linked-images'), 'dir')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('clipboard-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath,
      imageDirectory: 'linked-images'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
    await expect(readdir(outsideDir)).resolves.toEqual([])
  })

  it('reads supported workspace images as data URLs', async () => {
    const imagePath = join(workspaceRoot, 'img', 'sample.png')
    await mkdir(join(workspaceRoot, 'img'), { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await readWorkspaceImage({
      path: 'img/sample.png',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.path).toBe(await realpath(imagePath))
    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toBe('data:image/png;base64,iVBORw==')
  })

  it('reads supported workspace PDFs through the generic workspace file reader', async () => {
    const pdfPath = join(workspaceRoot, 'papers', 'study.pdf')
    const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF')
    await mkdir(join(workspaceRoot, 'papers'), { recursive: true })
    await writeFile(pdfPath, pdfBytes)

    const result = await readWorkspaceFile({
      path: 'papers/study.pdf',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.kind !== 'pdf') {
      throw new Error(`Expected PDF preview, received ${result.kind}`)
    }

    expect(result.path).toBe(await realpath(pdfPath))
    expect(result.content).toBe('')
    expect(result.mimeType).toBe('application/pdf')
    expect(result.dataBase64).toBe(pdfBytes.toString('base64'))
    expect(result.size).toBe(pdfBytes.length)
    expect(result.truncated).toBe(false)
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('extracts DOCX paragraphs through the generic workspace file reader', async () => {
    const docxPath = join(workspaceRoot, 'notes', 'commentary.docx')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeMinimalDocx(docxPath)

    const result = await readWorkspaceFile({
      path: 'notes/commentary.docx',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.kind !== 'docx') {
      throw new Error(`Expected DOCX preview, received ${result.kind}`)
    }

    expect(result.path).toBe(await realpath(docxPath))
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(result.content).toContain('Study note')
    expect(result.content).toContain('First paragraph\twith tab')
    expect(result.paragraphs).toEqual([
      expect.objectContaining({ index: 1, text: 'Study note', style: 'Heading1' }),
      expect.objectContaining({ index: 2, text: 'First paragraph\twith tab' })
    ])
    expect(result.truncated).toBe(false)
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('writes edited DOCX paragraph text while preserving a readable document package', async () => {
    const docxPath = join(workspaceRoot, 'notes', 'editable.docx')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeMinimalDocx(docxPath)

    const saveResult = await writeWorkspaceDocxText({
      path: 'notes/editable.docx',
      workspaceRoot,
      paragraphs: [
        { index: 1, text: 'Updated study note' },
        { index: 2, text: 'Changed paragraph\twith tab\nand safe XML chars: & < > "' }
      ]
    })

    expect(saveResult.ok).toBe(true)
    if (!saveResult.ok) return
    expect(saveResult.paragraphCount).toBe(2)

    const readResult = await readWorkspaceFile({
      path: 'notes/editable.docx',
      workspaceRoot
    })

    expect(readResult.ok).toBe(true)
    if (!readResult.ok || readResult.kind !== 'docx') return
    expect(readResult.content).toContain('Updated study note')
    expect(readResult.content).toContain('Changed paragraph\twith tab\nand safe XML chars: & < > "')
  })

  it('labels text previews from the generic workspace file reader', async () => {
    const result = await readWorkspaceFile({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.kind).toBe('text')
    expect(result.mimeType).toBe('text/plain; charset=utf-8')
    expect(result.content).toBe('inside')
  })

  it('uses workspace-intel text preview metadata for source files', async () => {
    await writeFile(join(workspaceRoot, 'app.ts'), 'export const value = 42\n', 'utf8')

    const result = await readWorkspaceFile({
      path: 'app.ts',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.kind).toBe('text')
    expect(result.mimeType).toBe('text/typescript; charset=utf-8')
    expect(result.content).toBe('export const value = 42\n')
  })

  it('rejects binary-looking text previews without relying only on null bytes', async () => {
    await writeFile(join(workspaceRoot, 'binary-looking.md'), Buffer.from([1, 2, 3, 4, 5, 6, 65, 66, 67, 68]))

    const result = await readWorkspaceFile({
      path: 'binary-looking.md',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('binary')
    }
  })

  it('renames files within the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'renamed.txt'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await readFile(join(workspaceRoot, 'renamed.txt'), 'utf8')).toBe('inside')
  })

  it('rejects rename names that escape the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: '../outside.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('path separators')
    }
  })

  it('rejects rename conflicts', async () => {
    await writeFile(join(workspaceRoot, 'existing.txt'), 'existing', 'utf8')
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'existing.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('already exists')
    }
  })

  it('copies files and defaults conflict handling to rename', async () => {
    const first = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot
    })
    const second = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(await readFile(join(workspaceRoot, 'inside copy.txt'), 'utf8')).toBe('inside')
    expect(await readFile(join(workspaceRoot, 'inside copy 2.txt'), 'utf8')).toBe('inside')
  })

  it('keeps fixed rename conflict templates progressing after the first collision', async () => {
    await writeFile(join(workspaceRoot, 'inside copy.txt'), 'existing copy', 'utf8')

    const result = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot,
      conflictPolicy: {
        strategy: 'rename',
        renameTemplate: '{name} copy{ext}',
        maxAttempts: 3
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await realpath(result.path)).toBe(await realpath(join(workspaceRoot, 'inside copy 2.txt')))
    expect(await readFile(join(workspaceRoot, 'inside copy.txt'), 'utf8')).toBe('existing copy')
    expect(await readFile(join(workspaceRoot, 'inside copy 2.txt'), 'utf8')).toBe('inside')
  })

  it('copies files with overwrite conflict policy', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'inside.txt'), 'old target', 'utf8')

    const result = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: 'notes',
      targetWorkspaceRoot: workspaceRoot,
      conflictPolicy: { strategy: 'overwrite' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await realpath(result.path)).toBe(await realpath(join(workspaceRoot, 'notes', 'inside.txt')))
    expect(await readFile(join(workspaceRoot, 'notes', 'inside.txt'), 'utf8')).toBe('inside')
    expect(await readFile(join(workspaceRoot, 'inside.txt'), 'utf8')).toBe('inside')
  })

  it('rejects unsupported interactive and merge conflict policies', async () => {
    const askResult = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot,
      conflictPolicy: { strategy: 'ask' }
    })
    const mergeResult = await copyWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot,
      conflictPolicy: { strategy: 'merge' }
    })

    expect(askResult.ok).toBe(false)
    expect(mergeResult.ok).toBe(false)
    if (!askResult.ok) expect(askResult.message).toContain('not supported')
    if (!mergeResult.ok) expect(mergeResult.message).toContain('not supported')
  })

  it('copies directories recursively', async () => {
    await mkdir(join(workspaceRoot, 'notes', 'nested'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'nested', 'draft.md'), '# draft', 'utf8')

    const result = await copyWorkspaceEntry({
      sourcePath: 'notes',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      targetWorkspaceRoot: workspaceRoot
    })

    expect(result.ok).toBe(true)
    expect(await readFile(join(workspaceRoot, 'notes copy', 'nested', 'draft.md'), 'utf8')).toBe('# draft')
  })

  it('imports external files and directories with conflict-safe names', async () => {
    const externalDir = join(rootDir, 'external')
    await mkdir(join(externalDir, 'images'), { recursive: true })
    await writeFile(join(externalDir, 'samples.csv'), 'sample,count\ns1,1\n', 'utf8')
    await writeFile(join(externalDir, 'images', 'cell.txt'), 'cell', 'utf8')
    await writeFile(join(workspaceRoot, 'samples.csv'), 'existing', 'utf8')

    const result = await importWorkspaceEntries({
      sourcePaths: [join(externalDir, 'samples.csv'), join(externalDir, 'images')],
      targetWorkspaceRoot: workspaceRoot,
      targetDirectory: ''
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.imported.map((item) => item.name)).toEqual(['samples copy.csv', 'images'])
    expect(await readFile(join(workspaceRoot, 'samples copy.csv'), 'utf8')).toBe('sample,count\ns1,1\n')
    expect(await readFile(join(workspaceRoot, 'images', 'cell.txt'), 'utf8')).toBe('cell')
  })

  it('imports external files with skip conflict policy', async () => {
    const externalDir = join(rootDir, 'external-skip')
    await mkdir(externalDir, { recursive: true })
    await writeFile(join(externalDir, 'samples.csv'), 'sample,count\ns1,1\n', 'utf8')
    await writeFile(join(workspaceRoot, 'samples.csv'), 'existing', 'utf8')

    const result = await importWorkspaceEntries({
      sourcePaths: [join(externalDir, 'samples.csv')],
      targetWorkspaceRoot: workspaceRoot,
      targetDirectory: '',
      conflictPolicy: { strategy: 'skip' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const skippedPath = await realpath(join(workspaceRoot, 'samples.csv'))
    expect(result.imported).toEqual([
      expect.objectContaining({
        name: 'samples.csv',
        path: skippedPath,
        skipped: true
      })
    ])
    expect(await readFile(join(workspaceRoot, 'samples.csv'), 'utf8')).toBe('existing')
  })

  it('rejects importing a directory into one of its descendants', async () => {
    const sourceDir = join(rootDir, 'source-parent')
    await mkdir(join(sourceDir, 'workspace', 'target'), { recursive: true })
    const result = await importWorkspaceEntries({
      sourcePaths: [sourceDir],
      targetWorkspaceRoot: join(sourceDir, 'workspace'),
      targetDirectory: 'target'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('descendants')
    }
  })

  it('moves files into a target directory', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })

    const result = await moveWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: 'notes',
      targetWorkspaceRoot: workspaceRoot
    })

    expect(result.ok).toBe(true)
    expect(await readFile(join(workspaceRoot, 'notes', 'inside.txt'), 'utf8')).toBe('inside')
    await expect(readFile(join(workspaceRoot, 'inside.txt'), 'utf8')).rejects.toThrow()
  })

  it('moves files with overwrite conflict policy', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'inside.txt'), 'old target', 'utf8')

    const result = await moveWorkspaceEntry({
      sourcePath: 'inside.txt',
      sourceWorkspaceRoot: workspaceRoot,
      targetDirectory: 'notes',
      targetWorkspaceRoot: workspaceRoot,
      conflictPolicy: { strategy: 'overwrite' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await realpath(result.path)).toBe(await realpath(join(workspaceRoot, 'notes', 'inside.txt')))
    expect(await readFile(join(workspaceRoot, 'notes', 'inside.txt'), 'utf8')).toBe('inside')
    await expect(readFile(join(workspaceRoot, 'inside.txt'), 'utf8')).rejects.toThrow()
  })

  it('deletes files within the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    const readResult = await readWorkspaceFile({ path: 'inside.txt', workspaceRoot })
    expect(readResult.ok).toBe(false)
  })

  it('deletes directories within the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes', 'nested'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'nested', 'draft.md'), '# draft', 'utf8')

    const result = await deleteWorkspaceEntry({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    await expect(readdir(join(workspaceRoot, 'notes'))).rejects.toThrow()
  })

  it('rejects deleting the workspace root', async () => {
    const result = await deleteWorkspaceEntry({
      path: workspaceRoot,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('workspace root')
    }
  })

  it('rejects delete paths that escape the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })
})
