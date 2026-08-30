import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { IDENTITY_CAPABILITY_IDS, type CloudIdentitySnapshot } from '../contract.js'
import { createIdentityRendererClient } from './client.js'

const cloudSignedOut: CloudIdentitySnapshot = {
  identity: { state: 'signed-out' },
  device: { state: 'signed-out' },
  devices: [],
  revision: 'cloud-1'
}

describe('IdentityRendererClient', () => {
  it('invokes all Cloud mutations globally without a resource or expected revision', async () => {
    const invoke = vi.fn(async (
      _contract: Readonly<{ actionId: string }>,
      _input: unknown,
      _options?: unknown
    ) => cloudSignedOut)
    const client = createIdentityRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await client.loginCloud()
    await client.reauthenticateCloud()
    await client.logoutCloud()
    await client.enrollCloudDevice()
    await client.refreshCloudDevices()
    await client.revokeCloudDevice('dev_CloudDevice0001')

    expect(invoke.mock.calls.map(([contract]) => contract.actionId)).toEqual([
      IDENTITY_CAPABILITY_IDS.cloudLogin,
      IDENTITY_CAPABILITY_IDS.cloudReauthenticate,
      IDENTITY_CAPABILITY_IDS.cloudLogout,
      IDENTITY_CAPABILITY_IDS.cloudEnrollDevice,
      IDENTITY_CAPABILITY_IDS.cloudRefreshDevices,
      IDENTITY_CAPABILITY_IDS.cloudRevokeDevice
    ])
    for (const call of invoke.mock.calls) expect(call[2]).toBeUndefined()
  })

  it('invokes account deletion as a destructive confirmed capability', async () => {
    const invoke = vi.fn(async (
      _contract: Readonly<{ actionId: string }>,
      _input: unknown,
      _options?: unknown
    ) => cloudSignedOut)
    const client = createIdentityRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await client.openCloudAccountDeletion()

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: IDENTITY_CAPABILITY_IDS.cloudOpenAccountDeletion,
        effect: 'destructive'
      }),
      {},
      { approval: { mode: 'confirmation' } }
    )
  })
})
