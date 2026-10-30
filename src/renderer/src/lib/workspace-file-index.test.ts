import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearWorkspaceFileIndexCacheForTests,
  fileReferenceFromWorkspaceEntry,
  isMentionableWorkspaceEntry,
  loadWorkspaceFileIndex
} from './workspace-file-index'

afterEach(() => {
  clearWorkspaceFileIndexCacheForTests()
  vi.unstubAllGlobals()
})

describe('workspace file index', () => {
  it('includes mentionable directories and files as composer references', async () => {
    const listWorkspaceDirectory = vi.fn(async ({ path }: { path: string }) => {
      if (path === '/tmp/workspace') {
        return {
          ok: true,
          entries: [
            { name: 'src', path: '/tmp/workspace/src', type: 'directory', ext: '' },
            { name: 'node_modules', path: '/tmp/workspace/node_modules', type: 'directory', ext: '' },
            { name: 'README.md', path: '/tmp/workspace/README.md', type: 'file', ext: '.md' }
          ]
        }
      }
      if (path === '/tmp/workspace/src') {
        return {
          ok: true,
          entries: [
            { name: 'index.ts', path: '/tmp/workspace/src/index.ts', type: 'file', ext: '.ts' },
            { name: 'design.pdf', path: '/tmp/workspace/src/design.pdf', type: 'file', ext: '.pdf' }
          ]
        }
      }
      return { ok: false, message: 'missing' }
    })
    vi.stubGlobal('window', { sciforge: { listWorkspaceDirectory } })

    await expect(loadWorkspaceFileIndex('/tmp/workspace')).resolves.toMatchObject({
      files: [
        { relativePath: 'src', workspaceRoot: '/tmp/workspace', kind: 'directory' },
        { relativePath: 'README.md', workspaceRoot: '/tmp/workspace', kind: 'file' },
        { relativePath: 'src/index.ts', workspaceRoot: '/tmp/workspace', kind: 'file' },
        { relativePath: 'src/design.pdf', workspaceRoot: '/tmp/workspace', kind: 'pdf' }
      ]
    })
    expect(listWorkspaceDirectory).not.toHaveBeenCalledWith(expect.objectContaining({
      path: '/tmp/workspace/node_modules'
    }))
  })

  it('converts workspace entries without absolute paths', () => {
    expect(isMentionableWorkspaceEntry({
      name: 'src',
      path: '/tmp/workspace/src',
      type: 'directory',
      ext: ''
    })).toBe(true)

    expect(fileReferenceFromWorkspaceEntry({
      name: 'guide.pdf',
      path: '/tmp/workspace/docs/guide.pdf',
      type: 'file',
      ext: '.pdf'
    }, '/tmp/workspace')).toEqual({
      path: 'docs/guide.pdf',
      relativePath: 'docs/guide.pdf',
      name: 'guide.pdf',
      workspaceRoot: '/tmp/workspace',
      kind: 'pdf'
    })
  })
})
