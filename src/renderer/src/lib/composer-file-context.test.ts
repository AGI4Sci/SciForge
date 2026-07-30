import { describe, expect, it, vi } from 'vitest'
import { readComposerFileContextEntries } from './composer-file-context'

describe('composer file context', () => {
  it('expands directory references into bounded workspace file context', async () => {
    const listWorkspaceReferences = vi.fn(async () => ({
      ok: true as const,
      references: [
        {
          workspaceRoot: '/tmp/workspace',
          relativePath: 'docs/guide.md',
          name: 'guide.md',
          kind: 'file' as const
        },
        {
          workspaceRoot: '/tmp/workspace',
          relativePath: 'docs/spec.pdf',
          name: 'spec.pdf',
          kind: 'pdf' as const,
          mimeType: 'application/pdf'
        }
      ]
    }))
    const readWorkspaceFile = vi.fn(async ({ path }: { path: string }) => {
      if (path === 'docs/spec.pdf') {
        return {
          ok: true as const,
          kind: 'pdf' as const,
          path,
          content: '' as const,
          dataBase64: '',
          mimeType: 'application/pdf' as const,
          size: 128,
          truncated: false as const,
          mtimeMs: 0,
          revision: 'revision-1'
        }
      }
      return {
        ok: true as const,
        kind: 'text' as const,
        path,
        content: 'Use Vitest for runtime tests.',
        mimeType: 'text/plain; charset=utf-8',
        size: 30,
        truncated: false,
        revision: 'revision-1'
      }
    })

    await expect(readComposerFileContextEntries([
      { path: 'docs', relativePath: 'docs', name: 'docs', kind: 'directory' }
    ], '/tmp/workspace', {
      listWorkspaceReferences,
      readWorkspaceFile
    })).resolves.toEqual([
      expect.objectContaining({
        relativePath: 'docs',
        content: expect.stringContaining('Expanded files: docs/guide.md, docs/spec.pdf')
      }),
      expect.objectContaining({
        relativePath: 'docs/guide.md',
        content: 'Use Vitest for runtime tests.'
      }),
      expect.objectContaining({
        relativePath: 'docs/spec.pdf',
        content: expect.stringContaining('PDF document: docs/spec.pdf')
      })
    ])
  })

  it('reports directory listing failures without leaking absolute paths from refs', async () => {
    await expect(readComposerFileContextEntries([
      { path: '/tmp/workspace/private', relativePath: 'private', name: 'private', kind: 'directory' }
    ], '/tmp/workspace', {
      listWorkspaceReferences: async () => ({ ok: false, message: 'missing directory' }),
      readWorkspaceFile: vi.fn()
    })).rejects.toThrow('Failed to read workspace reference "private": missing directory')
  })

  it('reads each reference from its own workspace root', async () => {
    const readWorkspaceFile = vi.fn(async ({ workspaceRoot, path }: { workspaceRoot: string; path: string }) => ({
      ok: true as const,
      kind: 'text' as const,
      path,
      content: `${workspaceRoot}:${path}`,
      mimeType: 'text/plain; charset=utf-8',
      size: 30,
      truncated: false,
      revision: 'revision-1'
    }))

    await expect(readComposerFileContextEntries([
      {
        path: 'README.md',
        relativePath: 'README.md',
        name: 'README.md',
        workspaceRoot: '/tmp/project',
        kind: 'file'
      },
      {
        path: 'README.md',
        relativePath: 'README.md',
        name: 'README.md',
        workspaceRoot: '/tmp/worktree',
        kind: 'file'
      }
    ], '/tmp/project', {
      listWorkspaceReferences: vi.fn(),
      readWorkspaceFile
    })).resolves.toEqual([
      expect.objectContaining({
        relativePath: 'README.md',
        workspaceRoot: '/tmp/project',
        content: '/tmp/project:README.md'
      }),
      expect.objectContaining({
        relativePath: 'README.md',
        workspaceRoot: '/tmp/worktree',
        content: '/tmp/worktree:README.md'
      })
    ])
    expect(readWorkspaceFile).toHaveBeenNthCalledWith(1, {
      workspaceRoot: '/tmp/project',
      path: 'README.md'
    })
    expect(readWorkspaceFile).toHaveBeenNthCalledWith(2, {
      workspaceRoot: '/tmp/worktree',
      path: 'README.md'
    })
  })
})
