import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IDENTITY_CAPABILITY_IDS,
  IDENTITY_RESET_CONFIRMATION
} from '@sciforge/domain-identity-access/contract'
import {
  createDomainMainEntry,
  type IdentityCapabilityFactory
} from '@sciforge/domain-identity-access/main'
import type { DomainMainPrincipalProvider } from '@sciforge/domain-sdk/principal'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { CapabilityBroker } from './broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition,
  type DefineCapabilityOptions
} from './registry'
import type { z } from 'zod'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Identity Principal transition Host integration', () => {
  it('executes create, select, and exit through the real Broker transition handshake', async () => {
    const fixture = identityBrokerFixture(temporaryRoot('sciforge-identity-broker-'))
    const alice = await fixture.invoke(IDENTITY_CAPABILITY_IDS.createAccount, 'create-alice', {
      username: 'Alice'
    })
    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.createAccount, 'create-alice', {
      username: 'Alice'
    })).resolves.toMatchObject({ replayed: true, output: alice.output })
    const bob = await fixture.invoke(IDENTITY_CAPABILITY_IDS.createAccount, 'create-bob', {
      username: 'Bob'
    })
    const aliceId = currentAccountId(alice.output)
    const bobId = currentAccountId(bob.output)

    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.selectAccount, 'select-alice', {
      userId: aliceId
    })).resolves.toMatchObject({
      output: { currentAccount: { userId: aliceId } },
      replayed: false
    })
    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.selectAccount, 'select-alice', {
      userId: aliceId
    })).resolves.toMatchObject({ replayed: true })
    expect(fixture.provider.current()).toMatchObject({ subject: aliceId })

    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.selectAccount, 'select-bob', {
      userId: bobId
    })).resolves.toMatchObject({ output: { currentAccount: { userId: bobId } } })
    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.selectAccount, 'select-alice', {
      userId: aliceId
    })).rejects.toMatchObject({ code: 'idempotency_post_state_mismatch' })

    const exited = await fixture.invoke(IDENTITY_CAPABILITY_IDS.exitAccount, 'exit-account', {})
    expect(exited).toMatchObject({ output: { currentAccount: null }, replayed: false })
    await expect(fixture.invoke(IDENTITY_CAPABILITY_IDS.exitAccount, 'exit-account', {}))
      .resolves.toMatchObject({ output: exited.output, replayed: true })
    expect(fixture.provider.current()).toBeUndefined()
    expect(fixture.calls(IDENTITY_CAPABILITY_IDS.createAccount)).toBe(2)
    expect(fixture.calls(IDENTITY_CAPABILITY_IDS.selectAccount)).toBe(2)
    expect(fixture.calls(IDENTITY_CAPABILITY_IDS.exitAccount)).toBe(1)
    fixture.dispose()
  })

  it('backs up a corrupt database once and binds reset replay to the committed signed-out state', async () => {
    const root = temporaryRoot('sciforge-identity-reset-broker-')
    const identityDirectory = join(root, 'identity-access')
    mkdirSync(identityDirectory, { recursive: true })
    writeFileSync(join(identityDirectory, 'identity.sqlite'), 'corrupt identity database')
    const fixture = identityBrokerFixture(root)
    expect(fixture.provider.snapshot()).toMatchObject({ principal: null })

    const reset = await fixture.invoke(
      IDENTITY_CAPABILITY_IDS.backupAndReset,
      'reset-corrupt-identity',
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      'confirmation'
    )
    expect(reset).toMatchObject({
      output: { state: { status: 'available', currentAccount: null } },
      replayed: false
    })
    await expect(fixture.invoke(
      IDENTITY_CAPABILITY_IDS.backupAndReset,
      'reset-corrupt-identity',
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      'confirmation'
    )).resolves.toMatchObject({ output: reset.output, replayed: true })
    expect(fixture.calls(IDENTITY_CAPABILITY_IDS.backupAndReset)).toBe(1)
    expect(readdirSync(identityDirectory).filter((name) => name.includes('.backup-'))).toHaveLength(1)

    await expect(fixture.invoke(
      IDENTITY_CAPABILITY_IDS.backupAndReset,
      'reset-corrupt-identity-again',
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      'confirmation'
    )).rejects.toMatchObject({ code: 'handler_failed' })
    expect(fixture.calls(IDENTITY_CAPABILITY_IDS.backupAndReset)).toBe(2)
    expect(readdirSync(identityDirectory).filter((name) => name.includes('.backup-'))).toHaveLength(1)

    await fixture.invoke(IDENTITY_CAPABILITY_IDS.createAccount, 'create-after-reset', {
      username: 'Alice'
    })
    await expect(fixture.invoke(
      IDENTITY_CAPABILITY_IDS.backupAndReset,
      'reset-corrupt-identity',
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      'confirmation'
    )).rejects.toMatchObject({ code: 'idempotency_post_state_mismatch' })
    expect(readdirSync(identityDirectory).filter((name) => name.includes('.backup-'))).toHaveLength(1)
    fixture.dispose()
  })
})

function identityBrokerFixture(root: string) {
  const entry = createDomainMainEntry({
    getUserDataDir: () => root,
    getDeviceId: () => 'device-integration-1',
    defineCapability: (options) => defineCapability(
      options as DefineCapabilityOptions<z.ZodType, z.ZodType>
    )
  })
  const factory = entry.contributions.find(
    (contribution) => contribution.kind === 'main.capability-factory'
  )?.value as IdentityCapabilityFactory<CapabilityDefinition> | undefined
  const provider = entry.contributions.find(
    (contribution) => contribution.kind === 'main.principal-provider'
  )?.value as DomainMainPrincipalProvider | undefined
  if (!factory || !provider) throw new Error('Identity main contributions are incomplete.')
  const callCounts = new Map<string, number>()
  const definitions = factory.createDefinitions().map((definition) => ({
    ...definition,
    handler: vi.fn(async (...args: Parameters<CapabilityDefinition['handler']>) => {
      callCounts.set(definition.descriptor.id, (callCounts.get(definition.descriptor.id) ?? 0) + 1)
      return await definition.handler(...args)
    })
  }))
  const broker = new CapabilityBroker(new CapabilityRegistry(definitions), {
    resolveCurrentPrincipalContext: () => provider.snapshot()
  })
  const callerId = 'window:identity-integration'
  return {
    provider,
    calls: (actionId: string) => callCounts.get(actionId) ?? 0,
    invoke: (
      actionId: string,
      invocationId: string,
      input: CapabilityJsonValue,
      approval?: 'confirmation'
    ) => broker.invoke({
      audience: 'ui',
      callerId,
      approvals: approval ? [{ actionId, invocationId, mode: approval }] : []
    }, {
      actionId,
      invocationId,
      input
    }),
    dispose: () => {
      for (const contribution of entry.contributions) contribution.onDispose?.()
    }
  }
}

function currentAccountId(output: unknown): string {
  const candidate = output as { currentAccount?: { userId?: unknown } }
  if (typeof candidate.currentAccount?.userId !== 'string') {
    throw new Error('Identity transition did not return a current account.')
  }
  return candidate.currentAccount.userId
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join('/private/tmp', prefix))
  roots.push(root)
  return root
}
