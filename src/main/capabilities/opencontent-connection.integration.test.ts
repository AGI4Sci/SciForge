import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainMainHost, DomainMainInternalServiceHost } from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS
} from '@sciforge/domain-opencontent-connector/contract'
import { createDomainMainEntry } from '@sciforge/domain-opencontent-connector/main'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityCallerContextInput } from '../../shared/capability-broker'
import { CapabilityBroker } from './broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition
} from './registry'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo'
const PASSWORD_CANARY = 'password-canary-must-not-cross-public-bind'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'opencontent-integration-user',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-integration-device',
  identityVersion: 7
})

const caller: CapabilityCallerContextInput = Object.freeze({
  audience: 'ui' as const,
  callerId: 'opencontent-integration-window'
})

const applicationRoot = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-host-integration-'))
afterAll(() => rmSync(applicationRoot, { recursive: true, force: true }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenContent connection through the Host capability Broker', () => {
  it('rejects public credential fields before native enrollment or Provider HTTP', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('Provider HTTP must not receive a public credential bind.')
    })
    vi.stubGlobal('fetch', fetchImplementation)
    const harness = createHarness()

    await expect(harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-public-secret-denied',
      input: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        username: 'fixture-scientist',
        password: PASSWORD_CANARY
      }
    })).rejects.toMatchObject({ code: 'invalid_input' })

    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
  })

  it('maps an unavailable private enrollment prerequisite to one bounded public result', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('Provider HTTP must not run without native enrollment.')
    })
    vi.stubGlobal('fetch', fetchImplementation)
    const harness = createHarness()

    const result = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-native-unavailable',
      input: { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }
    })

    expect(result.output).toEqual(process.platform === 'darwin' ? {
      outcome: 'error',
      error: {
        code: 'provider_unavailable',
        action: 'retry'
      }
    } : {
      outcome: 'error',
      error: {
        code: 'native_enrollment_unavailable',
        action: 'install_native_support'
      }
    })
    expect(JSON.stringify(result.output)).not.toContain(PASSWORD_CANARY)
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
  })

  it('returns an invalid Provider Instance before private enrollment or settings access', async () => {
    const harness = createHarness()
    const result = await harness.broker.invoke(caller, {
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      invocationId: 'opencontent-bind-wrong-provider',
      input: { providerInstanceRef: 'opencontent-unknown-provider' }
    })

    expect(result.output).toEqual({
      outcome: 'error',
      error: {
        code: 'invalid_provider_instance',
        action: 'select_provider'
      }
    })
    expect(harness.settings.read).not.toHaveBeenCalled()
    expect(harness.settings.write).not.toHaveBeenCalled()
    expect(harness.settings.clear).not.toHaveBeenCalled()
  })
})

function createHarness() {
  const settings = inMemorySettings()
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => '/opencontent-integration-user-data',
    getAppRoot: () => applicationRoot,
    isPackaged: () => false,
    defineCapability: (options: unknown) => defineCapability(options as never),
    packageSettings: settings,
    internalServices: inMemoryInternalServices()
  })
  const entry = createDomainMainEntry(host)
  const factory: unknown = entry.contributions
    .find((contribution) => contribution.kind === 'main.capability-factory')
    ?.value
  if (!hasCapabilityDefinitions(factory)) {
    throw new Error('OpenContent capability factory is missing from its main entry.')
  }
  const registry = new CapabilityRegistry(factory.createDefinitions())
  const broker = new CapabilityBroker(registry, {
    resolveCurrentPrincipal: () => principal
  })
  return { broker, settings }
}

function hasCapabilityDefinitions(value: unknown): value is Readonly<{
  createDefinitions(): readonly CapabilityDefinition[]
}> {
  return typeof value === 'object' && value !== null &&
    'createDefinitions' in value && typeof value.createDefinitions === 'function'
}

function inMemorySettings(): DomainMainPackageSettingsHost & Readonly<{
  read: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['read']>>
  write: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['write']>>
  clear: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['clear']>>
}> {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  const read = vi.fn<DomainMainPackageSettingsHost['read']>(async () => ({
    revision,
    value: value === null ? null : structuredClone(value)
  }))
  const write = vi.fn<DomainMainPackageSettingsHost['write']>(async (next, expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = structuredClone(next)
    revision += 1
    return { revision, value: structuredClone(value) }
  })
  const clear = vi.fn<DomainMainPackageSettingsHost['clear']>(async (expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = null
    revision += 1
    return { revision, value }
  })
  return Object.freeze({ read, write, clear })
}

function inMemoryInternalServices(): DomainMainInternalServiceHost {
  const services = new Map<string, Readonly<{ contractVersion: string; service: object }>>()
  return Object.freeze({
    register: (registration) => {
      services.set(registration.serviceId, {
        contractVersion: registration.contractVersion,
        service: registration.service
      })
    },
    acquire: <Service extends object>(serviceId: string, contractVersion: string): Service => {
      const registered = services.get(serviceId)
      if (!registered || registered.contractVersion !== contractVersion) {
        throw new Error(`Internal service ${serviceId} is unavailable.`)
      }
      return registered.service as Service
    }
  })
}
