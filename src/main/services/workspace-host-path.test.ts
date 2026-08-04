import { describe, expect, it } from 'vitest'
import {
  requireWorkspaceLocatorRoot,
  workspaceHostDisplayPath,
  workspaceHostWirePath
} from './workspace-host-path'

const locator = {
  contractVersion: 1 as const,
  hostSessionId: 'workspace-session-1',
  path: '/cluster/project'
}

describe('Workspace Host path conversion', () => {
  it('uses dot for the root and normalizes contained relative paths', () => {
    expect(workspaceHostWirePath(locator)).toBe('.')
    expect(workspaceHostWirePath(locator, '/cluster/project')).toBe('.')
    expect(workspaceHostWirePath(locator, './src//domain/../main.ts')).toBe('src/main.ts')
  })

  it('converts contained absolute paths to wire-relative paths', () => {
    expect(workspaceHostWirePath(locator, '/cluster/project/src/main.ts'))
      .toBe('src/main.ts')
    expect(workspaceHostDisplayPath(locator, 'src/main.ts'))
      .toBe('/cluster/project/src/main.ts')
  })

  it('rejects absolute and relative traversal outside the locator root', () => {
    expect(() => workspaceHostWirePath(locator, '/cluster/project-other/file.txt'))
      .toThrow(/outside/u)
    expect(() => workspaceHostWirePath(locator, '../secret.txt'))
      .toThrow(/outside/u)
    expect(() => workspaceHostWirePath(locator, 'src\\main.ts'))
      .toThrow(/POSIX/u)
  })

  it('requires an exact claimed workspace identity', () => {
    expect(() => requireWorkspaceLocatorRoot(locator, '/cluster/another-project'))
      .toThrow(/does not match/u)
    expect(requireWorkspaceLocatorRoot(locator, ' /cluster/project ')).toEqual(locator)
  })
})
