import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveDevelopmentUserDataPath } from './development-user-data'

describe('development user-data isolation', () => {
  it('uses one deterministic profile for each source workspace', () => {
    expect(resolveDevelopmentUserDataPath({
      isPackaged: false,
      appDataPath: '/application-data',
      workspaceId: 'fd1c9a2a2dd364b6',
      argv: ['/electron', '.']
    })).toBe(join(
      '/application-data',
      'SciForge Development',
      'fd1c9a2a2dd364b6'
    ))
  })

  it('preserves packaged and explicitly selected profiles', () => {
    expect(resolveDevelopmentUserDataPath({
      isPackaged: true,
      appDataPath: '/application-data',
      workspaceId: 'fd1c9a2a2dd364b6',
      argv: ['/electron', '.']
    })).toBeUndefined()
    expect(resolveDevelopmentUserDataPath({
      isPackaged: false,
      appDataPath: '/application-data',
      workspaceId: 'fd1c9a2a2dd364b6',
      argv: ['/electron', '.', '--user-data-dir=/explicit-profile']
    })).toBeUndefined()
  })

  it('ignores absent or malformed workspace identities', () => {
    for (const workspaceId of [undefined, '', '../shared-profile', 'not-a-workspace-id']) {
      expect(resolveDevelopmentUserDataPath({
        isPackaged: false,
        appDataPath: '/application-data',
        workspaceId,
        argv: ['/electron', '.']
      })).toBeUndefined()
    }
  })
})
