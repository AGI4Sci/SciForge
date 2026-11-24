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

  it('invokes the Cloud configuration inspection and update capabilities', async () => {
    const configuration = {
      configured: false,
      oidcIssuer: null,
      cloudBaseUrl: null,
      source: { oidcIssuer: null, cloudBaseUrl: null },
      missing: ['oidcIssuer', 'cloudBaseUrl'] as const,
      invalid: [] as const,
      storage: 'available' as const
    }
    const invoke = vi.fn(async (
      _contract: Readonly<{ actionId: string }>,
      _input: unknown,
      _options?: unknown
    ) => configuration)
    const client = createIdentityRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await client.inspectCloudConfiguration()
    await client.configureCloud({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })

    expect(invoke.mock.calls.map(([contract]) => contract.actionId)).toEqual([
      IDENTITY_CAPABILITY_IDS.cloudInspectConfiguration,
      IDENTITY_CAPABILITY_IDS.cloudConfigure
    ])
    expect(invoke.mock.calls[1]?.[1]).toEqual({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })
  })

  it('invokes one destructive Local Account delete with the account id', async () => {
    const invoke = vi.fn(async (
      _contract: Readonly<{ actionId: string }>,
      _input: unknown,
      _options?: unknown
    ) => ({
      status: 'available',
      identityVersion: 1,
      currentAccount: null,
      accountCount: 0,
      firstPromptDismissed: false
    }))
    const client = createIdentityRendererClient({
      invoke,
      observe: vi.fn()
    } as unknown as DomainRendererCapabilityInvoker)

    await client.deleteAccount('00000000-0000-4000-8000-000000000000')

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      actionId: IDENTITY_CAPABILITY_IDS.deleteAccount,
      effect: 'destructive'
    })
    expect(invoke.mock.calls[0]?.[1]).toEqual({
      accountId: '00000000-0000-4000-8000-000000000000'
    })
    expect(invoke.mock.calls[0]?.[2]).toBeUndefined()
  })
})
