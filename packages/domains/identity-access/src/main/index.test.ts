import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IDENTITY_CAPABILITY_IDS,
  IDENTITY_RESET_CONFIRMATION
} from '../contract.js'
import {
  createDomainMainEntry,
  createIdentityCapabilityFactory,
  type IdentityCapabilityOptions
} from './index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Identity main contributions', () => {
  it('declares one UI-only global capability set with governed mutation policies', () => {
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({}) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    expect(definitions.map((definition) => definition.id)).toEqual(Object.values(IDENTITY_CAPABILITY_IDS))
    for (const definition of definitions) {
      expect(definition.audiences).toEqual(['ui'])
      expect(definition.scope).toBe('global')
      expect(definition.concurrency.idempotency).toBe(
        definition.effect === 'read' ? 'none' : 'required'
      )
    }
    expect(definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset))
      .toMatchObject({ effect: 'destructive', approval: 'confirmation' })
    expect(definitions.filter((definition) => (
      definition.principalTransition === 'host-authority'
    )).map(({ id }) => id)).toEqual([
      IDENTITY_CAPABILITY_IDS.createAccount,
      IDENTITY_CAPABILITY_IDS.selectAccount,
      IDENTITY_CAPABILITY_IDS.exitAccount,
      IDENTITY_CAPABILITY_IDS.backupAndReset
    ])
  })

  it('shares one lazy service between capabilities and Principal provider and rejects Agent calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-main-'))
    roots.push(root)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      defineCapability: (definition) => definition
    })
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const provider = entry.contributions[1]!.value as { current(): unknown }
    expect(provider.current()).toBeUndefined()
    const definitions = factory.createDefinitions() as unknown as IdentityCapabilityOptions[]
    const create = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.createAccount)!
    expect(() => create.handler({ username: 'Alice' }, {
      caller: { audience: 'agent' },
      assertPrincipalCurrent: vi.fn()
    }))
      .toThrow('trusted Human UI')
    const created = await create.handler({ username: 'Alice' }, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => {
        throw codedError('principal_changed')
      })
    })
    expect(created.output).toMatchObject({ currentAccount: { username: 'Alice' } })
    expect(created).not.toHaveProperty('changed')
    expect(provider.current()).toMatchObject({
      authority: 'sciforge.identity-access',
      subject: (created.output as { currentAccount: { userId: string } }).currentAccount.userId,
      assurance: 'local-selection',
      deviceId: 'device-1'
    })
    const reset = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset)!
    expect(reset.inputSchema.safeParse({ secondConfirmation: IDENTITY_RESET_CONFIRMATION }).success).toBe(true)
    entry.contributions[0]!.onDispose?.()
    entry.contributions[1]!.onDispose?.()
  })

  it('acknowledges only committed Host Principal transitions and keeps no-op repeats valid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-transition-'))
    roots.push(root)
    const entry = createDomainMainEntry({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-1',
      defineCapability: (definition) => definition
    })
    const factory = entry.contributions[0]!.value as ReturnType<typeof createIdentityCapabilityFactory>
    const provider = entry.contributions[1]!.value as {
      current(): { subject: string; identityVersion: number } | undefined
    }
    const definitions = factory.createDefinitions() as unknown as IdentityCapabilityOptions[]
    const definition = (id: string): IdentityCapabilityOptions =>
      definitions.find((candidate) => candidate.id === id)!
    const transitionContext = (
      verifyCommittedPrincipal: () => void
    ): Parameters<IdentityCapabilityOptions['handler']>[1] => ({
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => {
        verifyCommittedPrincipal()
        throw codedError('principal_changed')
      })
    })

    const create = definition(IDENTITY_CAPABILITY_IDS.createAccount)
    const select = definition(IDENTITY_CAPABILITY_IDS.selectAccount)
    const exit = definition(IDENTITY_CAPABILITY_IDS.exitAccount)

    const aliceResult = await create.handler(
      { username: 'Alice' },
      transitionContext(() => expect(provider.current()?.subject).toEqual(expect.any(String)))
    )
    const alice = (aliceResult.output as { currentAccount: { userId: string } }).currentAccount
    const bobResult = await create.handler(
      { username: 'Bob' },
      transitionContext(() => expect(provider.current()?.subject).toEqual(expect.any(String)))
    )
    const bob = (bobResult.output as { currentAccount: { userId: string } }).currentAccount

    await select.handler(
      { userId: alice.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(alice.userId))
    )
    const selectedBob = await select.handler(
      { userId: bob.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(bob.userId))
    )
    const selectedVersion = (selectedBob.output as { identityVersion: number }).identityVersion
    const unchangedSelectionAssert = vi.fn(() => {
      expect(provider.current()).toMatchObject({ subject: bob.userId, identityVersion: selectedVersion })
    })
    const unchangedSelection = await select.handler(
      { userId: bob.userId },
      { caller: { audience: 'ui' }, assertPrincipalCurrent: unchangedSelectionAssert }
    )
    expect((unchangedSelection.output as { identityVersion: number }).identityVersion).toBe(selectedVersion)
    expect(unchangedSelectionAssert).toHaveBeenCalledOnce()

    await select.handler(
      { userId: alice.userId },
      transitionContext(() => expect(provider.current()?.subject).toBe(alice.userId))
    )
    await exit.handler(
      {},
      transitionContext(() => expect(provider.current()).toBeUndefined())
    )
    const signedOutVersion = (
      (await exit.handler({}, {
        caller: { audience: 'ui' },
        assertPrincipalCurrent: vi.fn(() => expect(provider.current()).toBeUndefined())
      })).output as { identityVersion: number }
    ).identityVersion
    expect(provider.current()).toBeUndefined()
    expect(signedOutVersion).toBeGreaterThan(selectedVersion)

    entry.contributions[0]!.onDispose?.()
    entry.contributions[1]!.onDispose?.()
  })

  it('does not acknowledge non-transition assertion failures after a committed mutation', async () => {
    const operation = vi.fn(() => ({ status: 'available' as const }))
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({ createAccount: operation }) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    const create = definitions.find(({ id }) => id === IDENTITY_CAPABILITY_IDS.createAccount)!
    const failure = codedError('principal_provider_failed')

    expect(() => create.handler({ username: 'Alice' }, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent: vi.fn(() => { throw failure })
    })).toThrow(failure)
    expect(operation).toHaveBeenCalledOnce()
  })

  it('acknowledges a committed unavailable-database reset as a signed-out context transition', async () => {
    const reset = vi.fn(() => ({
      state: {
        status: 'available' as const,
        identityVersion: 1,
        currentAccount: null,
        accountCount: 0,
        firstPromptDismissed: false
      },
      backupPath: '/private/tmp/identity.backup.sqlite'
    }))
    const definitions = createIdentityCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => ({ backupAndReset: reset }) as never
    }).createDefinitions() as IdentityCapabilityOptions[]
    const capability = definitions.find(
      ({ id }) => id === IDENTITY_CAPABILITY_IDS.backupAndReset
    )!
    const assertPrincipalCurrent = vi.fn(() => {
      throw codedError('principal_changed')
    })

    await expect(Promise.resolve(capability.handler(
      { secondConfirmation: IDENTITY_RESET_CONFIRMATION },
      { caller: { audience: 'ui' }, assertPrincipalCurrent }
    ))).resolves.toMatchObject({ output: { state: { identityVersion: 1 } } })
    expect(reset).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
  })

  it('fails closed when the Host does not provide a canonical installation identity', () => {
    for (const getDeviceId of [undefined, () => ' device-1']) {
      const entry = createDomainMainEntry({
        getUserDataDir: () => '/private/tmp/sciforge-identity-missing-device',
        ...(getDeviceId ? { getDeviceId } : {}),
        defineCapability: (definition) => definition
      })
      const provider = entry.contributions[1]!.value as { current(): unknown }

      expect(() => provider.current()).toThrow()
      entry.contributions[0]!.onDispose?.()
      entry.contributions[1]!.onDispose?.()
    }
  })
})

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
