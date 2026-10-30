import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceReferenceService } from './workspace-reference-service'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsgui-workspace-ref-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('WorkspaceReferenceService', () => {
  it('lists and previews workspace-relative references', async () => {
    const workspaceRoot = await tempDir()
    await mkdir(join(workspaceRoot, 'src'))
    await writeFile(join(workspaceRoot, 'src', 'index.ts'), 'export const answer = 42\n', 'utf8')
    await writeFile(join(workspaceRoot, 'README.md'), '# Hello\n', 'utf8')
    const service = new WorkspaceReferenceService()

    const list = await service.list({ workspaceRoot, recursive: true })
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.references.map((reference) => reference.relativePath)).toEqual(
        expect.arrayContaining(['README.md', 'src', 'src/index.ts'])
      )
      expect(list.references.every((reference) => !reference.relativePath.startsWith('/'))).toBe(true)
    }

    const preview = await service.preview({ workspaceRoot, path: 'src/index.ts' })
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.preview.reference.relativePath).toBe('src/index.ts')
      expect(preview.preview.contentSummary).toContain('answer')
      expect(preview.preview.content).toContain('42')
    }
  })

  it('rejects path traversal outside the workspace', async () => {
    const workspaceRoot = await tempDir()
    const outsideRoot = await tempDir()
    await writeFile(join(outsideRoot, 'secret.txt'), 'secret', 'utf8')
    const service = new WorkspaceReferenceService()

    const preview = await service.preview({
      workspaceRoot,
      path: join('..', outsideRoot.split('/').pop() ?? '', 'secret.txt')
    })

    expect(preview.ok).toBe(false)
  })

  it('omits symlink escapes from lists and rejects symlink previews outside the workspace', async () => {
    const workspaceRoot = await tempDir()
    const outsideRoot = await tempDir()
    await writeFile(join(outsideRoot, 'secret.txt'), 'secret', 'utf8')
    await symlink(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'linked-secret.txt'))
    const service = new WorkspaceReferenceService()

    const list = await service.list({ workspaceRoot, recursive: true })
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.references.some((reference) => reference.relativePath === 'linked-secret.txt')).toBe(false)
    }

    const preview = await service.preview({ workspaceRoot, path: 'linked-secret.txt' })
    expect(preview.ok).toBe(false)
  })
})
