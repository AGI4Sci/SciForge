import { workspaceRootIdentityKey } from '../lib/workspace-path'
import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { buildSidebarWorkspaceGroups } from '../components/chat/SidebarProjectsSection'
import { partitionNavigationSessions } from './workbench-session-ownership'

function thread(id: string, workspace: string, runtimeId: NormalizedThread['runtimeId'] = 'codex'): NormalizedThread {
  return { id, workspace, runtimeId, title: `Title ${id}`, updatedAt: '2026-09-17T00:00:00Z', model: 'model', mode: 'agent' }
}

describe('exclusive navigation ownership', () => {
  it.each(['/Users/user/work/execution', '/home/user/work/execution', 'C:\\Users\\user\\work\\execution', '\\\\server\\share\\execution'])(
    'removes owned sessions and remembered/selected empty execution folders: %s', workspace => {
      const all = [thread('owned', workspace), thread('local', '/work/local')]
      const partition = partitionNavigationSessions(all, [{ runtimeId: 'codex', threadId: 'owned' }])
      const groups = buildSidebarWorkspaceGroups({ threads: partition.localThreads, excludedWorkspaceKeys: partition.ownedWorkspaceKeys, workspaceRoot: workspace, workspaceRoots: [workspace, '/work/local'], searchQuery: '', showArchived: false })
      expect(groups).toEqual([['/work/local', [all[1]]]])
    }
  )

  it('keeps ordinary conversations sharing an owned workspace and distinguishes runtime identities', () => {
    const all = [thread('same-id', '/work/shared'), thread('same-id', '/work/shared', 'claude')]
    const partition = partitionNavigationSessions(all, [{ runtimeId: 'codex', threadId: 'same-id' }])
    expect(partition.localThreads).toEqual([all[1]])
    expect([...partition.ownedWorkspaceKeys]).toEqual([])
  })

  it('keeps sessions local when no installed package owns them', () => {
    const all = [thread('ordinary', '/work/exe_not_an_owner')]
    expect(partitionNavigationSessions(all, []).localThreads).toEqual(all)
  })

  it('normalizes Windows drive and UNC separators and case, retaining POSIX case', () => {
    expect(workspaceRootIdentityKey('C:\\Users\\WORK\\')).toBe(workspaceRootIdentityKey('c:/users/work'))
    expect(workspaceRootIdentityKey('C:\\')).toBe(workspaceRootIdentityKey('c:/'))
    expect(workspaceRootIdentityKey('\\\\SERVER\\Share\\')).toBe(workspaceRootIdentityKey('//server/share'))
    expect(workspaceRootIdentityKey('/home/user/Work')).not.toBe(workspaceRootIdentityKey('/home/user/work'))
  })
})

it('preserves an explicitly added workspace even when its only session belongs to a domain', () => {
  const workspace = 'C:\\Research\\Shared'
  const partition = partitionNavigationSessions([thread('owned', workspace)], [{ runtimeId: 'codex', threadId: 'owned' }])
  expect(buildSidebarWorkspaceGroups({ threads: partition.localThreads, excludedWorkspaceKeys: partition.ownedWorkspaceKeys, explicitWorkspaceRoots: ['c:/research/shared'], workspaceRoots: [workspace], workspaceRoot: '', searchQuery: '', showArchived: false })).toEqual([[workspace, []]])
})
