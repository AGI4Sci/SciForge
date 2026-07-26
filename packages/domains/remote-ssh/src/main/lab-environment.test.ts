import { describe, expect, it } from 'vitest'
import type {
  RemoteSshLab,
  RemoteSshLabEnvironmentResult
} from '../contract.js'
import { REMOTE_SSH_SCHEMA_VERSION } from '../contract.js'
import {
  RoutingRemoteSshLabEnvironmentManager,
  type RemoteSshLabEnvironmentProvider
} from './lab-environment.js'

const now = '2026-07-23T00:00:00.000Z'
const vmUuid = '11111111-2222-4333-8444-555555555555'
const vmLab: RemoteSshLab = {
  schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
  id: 'lab-a',
  displayName: 'Lab A',
  environment: {
    provider: 'vm',
    driver: 'virtualbox',
    vmId: vmUuid,
    gatewaySshAlias: 'sciforge-lab-a-gateway'
  },
  maxConcurrentExecutions: 4,
  revision: 'lab-r1',
  createdAt: now,
  updatedAt: now
}

function result(lab: RemoteSshLab): RemoteSshLabEnvironmentResult {
  return {
    labId: lab.id,
    provider: lab.environment.provider,
    state: 'login-required',
    consoleAvailable: true,
    checkedAt: now
  }
}

function provider(
  providerId: RemoteSshLabEnvironmentProvider['provider'],
  ensure: (lab: RemoteSshLab) => Promise<RemoteSshLabEnvironmentResult> =
    async (lab) => result(lab)
): RemoteSshLabEnvironmentProvider {
  return {
    provider: providerId,
    close: () => undefined,
    canonicalize: async (environment) => environment.provider === 'vm'
      ? { ...environment, vmId: vmUuid }
      : environment,
    get: async (lab) => result(lab),
    ensure,
    openConsole: async (lab) => ({
      labId: lab.id,
      presentation: { kind: 'opened' }
    }),
    stop: async (lab) => ({ ...result(lab), state: 'stopped' }),
    remove: async () => undefined,
    proxyEndpoint: async () => ({ host: '127.0.0.1', port: 41_023 })
  }
}

describe('RoutingRemoteSshLabEnvironmentManager', () => {
  it('rejects duplicate providers at composition time', () => {
    expect(() => new RoutingRemoteSshLabEnvironmentManager([
      provider('vm'),
      provider('vm')
    ])).toThrow('Duplicate Remote SSH lab environment provider: vm')
  })

  it('fails closed when the lab provider is unavailable', async () => {
    const manager = new RoutingRemoteSshLabEnvironmentManager([])

    await expect(manager.get(vmLab)).rejects.toThrow(
      'requires unavailable environment provider: vm'
    )
  })

  it('routes only to the provider explicitly selected by the lab', async () => {
    const calls: string[] = []
    const vmProvider = provider('vm', async (lab) => {
      calls.push(`vm:${lab.id}`)
      return result(lab)
    })
    const dockerProvider = provider('docker', async (lab) => {
      calls.push(`docker:${lab.id}`)
      return result(lab)
    })
    const manager = new RoutingRemoteSshLabEnvironmentManager([
      dockerProvider,
      vmProvider
    ])

    await manager.ensure(vmLab)

    expect(calls).toEqual(['vm:lab-a'])
  })

  it('routes canonical identity resolution through the selected provider', async () => {
    const manager = new RoutingRemoteSshLabEnvironmentManager([provider('vm')])

    await expect(manager.canonicalize({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'Research VPN',
      gatewaySshAlias: 'research-vpn-gateway'
    })).resolves.toEqual({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: vmUuid,
      gatewaySshAlias: 'research-vpn-gateway'
    })
  })

  it('serializes concurrent lifecycle operations for the same lab', async () => {
    const calls: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const vmProvider = provider('vm', async (lab) => {
      calls.push(`start:${calls.length + 1}`)
      if (calls.length === 1) await firstBlocked
      calls.push(`finish:${calls.length}`)
      return result(lab)
    })
    const manager = new RoutingRemoteSshLabEnvironmentManager([vmProvider])

    const first = manager.ensure(vmLab)
    const second = manager.ensure(vmLab)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['start:1'])

    releaseFirst()
    await Promise.all([first, second])

    expect(calls).toEqual(['start:1', 'finish:1', 'start:3', 'finish:3'])
  })

  it('closes every provider and rejects subsequent lifecycle operations', async () => {
    const closed: string[] = []
    const vmProvider = {
      ...provider('vm'),
      close: () => closed.push('vm')
    }
    const dockerProvider = {
      ...provider('docker'),
      close: () => closed.push('docker')
    }
    const manager = new RoutingRemoteSshLabEnvironmentManager([
      vmProvider,
      dockerProvider
    ])

    manager.close()
    manager.close()

    expect(closed).toEqual(['vm', 'docker'])
    await expect(manager.get(vmLab)).rejects.toThrow(
      'lab environment manager is closed'
    )
  })
})
