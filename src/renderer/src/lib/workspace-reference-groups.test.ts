import { describe, expect, it } from 'vitest'
import { buildWorkspaceReferenceGroups } from './workspace-reference-groups'

describe('buildWorkspaceReferenceGroups', () => {
  it('deduplicates project and worktree workspace roots in display order', () => {
    expect(buildWorkspaceReferenceGroups({
      activeThreadWorkspace: '/workspace/project',
      workspaceRoot: '/workspace/project/',
      codeWorkspaceRoots: [
        '/workspace/project',
        '/workspace/project-worktree',
        '/workspace/project-worktree'
      ]
    })).toEqual([
      {
        id: 'project:/workspace/project',
        label: 'project',
        workspaceRoot: '/workspace/project',
        kind: 'project'
      },
      {
        id: 'worktree:/workspace/project-worktree',
        label: 'project-worktree',
        workspaceRoot: '/workspace/project-worktree',
        kind: 'worktree'
      }
    ])
  })
})
