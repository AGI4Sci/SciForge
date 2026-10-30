import { describe, expect, it } from 'vitest'
import {
  composerFileReferenceKey,
  mergeComposerFileReferences,
  type ComposerFileReference
} from './composer-file-references'

describe('composer file references', () => {
  it('keeps references with the same relative path distinct across workspace roots', () => {
    const project: ComposerFileReference = {
      path: 'README.md',
      relativePath: 'README.md',
      name: 'README.md',
      workspaceRoot: '/tmp/project'
    }
    const worktree: ComposerFileReference = {
      path: 'README.md',
      relativePath: 'README.md',
      name: 'README.md',
      workspaceRoot: '/tmp/worktree'
    }

    expect(composerFileReferenceKey(project)).not.toBe(composerFileReferenceKey(worktree))
    expect(mergeComposerFileReferences([project], worktree)).toEqual([project, worktree])
  })
})
