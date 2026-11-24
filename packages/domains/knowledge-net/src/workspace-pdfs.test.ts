import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listWorkspacePdfs, MAX_PDF_FILES } from './workspace-pdfs.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kn-pdfs-')))
  tempDirs.push(root)
  return root
}

describe('listWorkspacePdfs', () => {
  it('lists PDFs with sizes, relative paths and a stable order', async () => {
    const root = await workspace()
    await mkdir(join(root, 'refs', 'nested'), { recursive: true })
    await writeFile(join(root, 'b.PDF'), 'second')
    await writeFile(join(root, 'refs', 'a.pdf'), 'first')
    await writeFile(join(root, 'refs', 'nested', 'c.pdf'), 'third')
    await writeFile(join(root, 'refs', 'notes.txt'), 'ignored')

    const scan = await listWorkspacePdfs(root)
    expect(scan.files.map((file) => file.path)).toEqual(['b.PDF', 'refs/a.pdf', 'refs/nested/c.pdf'])
    expect(scan.files.find((file) => file.path === 'refs/a.pdf')!.sizeBytes).toBe(5)
    expect(scan.truncated).toBe(false)
    expect(scan.truncatedReasons).toEqual([])
  })

  it('skips hidden and dependency directories', async () => {
    const root = await workspace()
    for (const directory of ['.git', 'node_modules', '.cache']) {
      await mkdir(join(root, directory), { recursive: true })
      await writeFile(join(root, directory, 'hidden.pdf'), 'x')
    }
    await writeFile(join(root, 'visible.pdf'), 'x')

    const scan = await listWorkspacePdfs(root)
    expect(scan.files.map((file) => file.path)).toEqual(['visible.pdf'])
  })

  it('does not follow symbolic links', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'secret.pdf'), 'x')
    await symlink(outside, join(root, 'linked'))
    await symlink(join(outside, 'secret.pdf'), join(root, 'linked.pdf'))
    await writeFile(join(root, 'real.pdf'), 'x')

    const scan = await listWorkspacePdfs(root)
    expect(scan.files.map((file) => file.path)).toEqual(['real.pdf'])
  })

  it('stops at the depth limit and says so', async () => {
    const root = await workspace()
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'deep.pdf'), 'x')
    await writeFile(join(root, 'shallow.pdf'), 'x')

    const scan = await listWorkspacePdfs(root, { maxDepth: 1 })
    expect(scan.files.map((file) => file.path)).toEqual(['shallow.pdf'])
    expect(scan.truncated).toBe(true)
    expect(scan.truncatedReasons.join(' ')).toMatch(/depth 1/u)
  })

  it('stops at the file limit and says so', async () => {
    const root = await workspace()
    await writeFile(join(root, 'one.pdf'), 'x')
    await writeFile(join(root, 'two.pdf'), 'x')

    const scan = await listWorkspacePdfs(root, { maxFiles: 1 })
    expect(scan.files).toHaveLength(1)
    expect(scan.truncated).toBe(true)
    expect(scan.truncatedReasons.join(' ')).toMatch(/1 PDF files/u)
  })

  it('rejects bounds it cannot honour', async () => {
    const root = await workspace()
    await expect(listWorkspacePdfs(root, { maxDepth: 13 })).rejects.toThrow('Invalid PDF scan depth')
    await expect(listWorkspacePdfs(root, { maxFiles: MAX_PDF_FILES + 1 })).rejects.toThrow('Invalid PDF file limit')
  })

  it('honours an abort signal', async () => {
    const root = await workspace()
    await writeFile(join(root, 'one.pdf'), 'x')
    const controller = new AbortController()
    controller.abort()
    await expect(listWorkspacePdfs(root, { signal: controller.signal })).rejects.toThrow()
  })
})
