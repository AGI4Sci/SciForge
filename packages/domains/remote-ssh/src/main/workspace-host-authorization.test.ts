import { describe, expect, it } from 'vitest'
import {
  REMOTE_SSH_WORKSPACE_HOST_PROVIDER_ID
} from '../contract.js'
import {
  RemoteSshWorkspaceHostAuthorizationStore
} from './workspace-host-authorization.js'

describe('Remote Workspace Host authorization store', () => {
  it('issues opaque one-attach identities and keeps target details package-private', () => {
    const store = new RemoteSshWorkspaceHostAuthorizationStore(
      () => new Date('2026-07-30T00:00:00.000Z')
    )
    const output = store.authorize({
      workspaceId: '/local/workspace',
      targetId: 'gpu-01',
      targetRevision: 'target-r1',
      targetDisplayName: 'GPU 01',
      request: {
        workspaceRoot: '/cluster/project',
        egress: {
          mode: 'local',
          allowlist: { rules: [{ host: 'api.openai.com', ports: [443] }] }
        }
      }
    })

    expect(output.providerId).toBe(REMOTE_SSH_WORKSPACE_HOST_PROVIDER_ID)
    expect(JSON.stringify(output)).not.toContain('gpu-01')
    expect(JSON.stringify(output)).not.toContain('/cluster/project')
    expect(store.acquire(output.authorizedSessionId)).toMatchObject({
      targetId: 'gpu-01',
      targetRevision: 'target-r1',
      workspaceRoot: '/cluster/project',
      egress: {
        mode: 'local',
        allowlist: { rules: [{ host: 'api.openai.com', ports: [443] }] }
      }
    })
    expect(() => store.acquire(output.authorizedSessionId)).toThrow(/already attached/i)
    expect(store.requireActive(output.authorizedSessionId).targetId).toBe('gpu-01')
  })

  it('expires an unused ticket but keeps an attached session active beyond the ticket TTL', () => {
    let now = new Date('2026-07-30T00:00:00.000Z')
    const store = new RemoteSshWorkspaceHostAuthorizationStore(() => now, 1_000)
    const unused = store.authorize({
      workspaceId: '/local/workspace',
      targetId: 'gpu-01',
      targetRevision: 'target-r1',
      targetDisplayName: 'GPU 01',
      request: {
        workspaceRoot: '/cluster/project',
        egress: { mode: 'none' }
      }
    })
    const active = store.authorize({
      workspaceId: '/local/workspace',
      targetId: 'gpu-01',
      targetRevision: 'target-r1',
      targetDisplayName: 'GPU 01',
      request: {
        workspaceRoot: '/cluster/project',
        egress: { mode: 'none' }
      }
    })
    store.acquire(active.authorizedSessionId)
    now = new Date('2026-07-30T00:00:01.001Z')

    expect(() => store.acquire(unused.authorizedSessionId)).toThrow(/expired/i)
    expect(store.requireActive(active.authorizedSessionId).targetId).toBe('gpu-01')
    store.revoke(active.authorizedSessionId)
    expect(() => store.requireActive(active.authorizedSessionId))
      .toThrow(/no longer active/i)
  })
})
