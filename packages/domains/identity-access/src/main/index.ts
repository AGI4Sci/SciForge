import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  principalDeviceIdSchema,
  type DomainMainPrincipalProvider
} from '@sciforge/domain-sdk/principal'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'
import {
  IDENTITY_CAPABILITY_IDS,
  IDENTITY_PRINCIPAL_AUTHORITY,
  accountRenameInputSchema,
  accountSelectionInputSchema,
  emptyIdentityInputSchema,
  identityAvailableStateSchema,
  identityBackupAndResetInputSchema,
  identityBackupAndResetOutputSchema,
  identityListAccountsOutputSchema,
  identityUiStateSchema,
  usernameInputSchema
} from '../contract.js'
import {
  IDENTITY_ACCESS_DOMAIN_MODULE_ID,
  IDENTITY_CAPABILITY_FACTORY_CONTRIBUTION,
  IDENTITY_PRINCIPAL_PROVIDER_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { IdentityService } from './service.js'

type IdentityCapabilityEffect = 'read' | 'external-write' | 'destructive'

type IdentityCapabilityContext = Readonly<{
  caller: Readonly<{ audience: 'ui' | 'agent' | 'system' }>
  assertPrincipalCurrent: () => void
}>

export type IdentityCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global'
  effect: IdentityCapabilityEffect
  principalTransition?: 'host-authority'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none' | 'optimistic'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: IdentityCapabilityContext
  ) => Readonly<{ output: unknown; changed?: boolean; semanticRevision?: string }> |
    Promise<Readonly<{ output: unknown; changed?: boolean; semanticRevision?: string }>>
}>

export type IdentityCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof IDENTITY_ACCESS_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'identity'
    title: 'Identity and Access'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

type IdentityMainContribution =
  | IdentityCapabilityFactory
  | DomainMainPrincipalProvider

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<IdentityMainContribution> {
  let service: IdentityService | undefined
  const getService = (): IdentityService => {
    service ??= new IdentityService(host.getUserDataDir(), requireDeviceId(host))
    return service
  }
  const principalProvider: DomainMainPrincipalProvider = Object.freeze({
    current: () => getService().current(),
    snapshot: () => getService().snapshot(),
    subscribe: (listener: Parameters<DomainMainPrincipalProvider['subscribe']>[0]) =>
      getService().subscribe(listener)
  })
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    service?.close()
    service = undefined
  }

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...IDENTITY_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createIdentityCapabilityFactory({
          defineCapability: host.defineCapability as (
            options: IdentityCapabilityOptions
          ) => unknown,
          getService
        }),
        onDispose: dispose
      },
      {
        ...IDENTITY_PRINCIPAL_PROVIDER_CONTRIBUTION,
        value: principalProvider,
        onDispose: dispose
      }
    ]
  }
}

export function createIdentityCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: (options: IdentityCapabilityOptions) => CapabilityDefinition
  getService: () => IdentityService
}>): IdentityCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<IdentityCapabilityOptions, 'version' | 'audiences' | 'scope' | 'tags'>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    audiences: ['ui'],
    scope: 'global',
    tags: ['identity-access', 'local-account']
  })

  const read = (
    context: IdentityCapabilityContext,
    operation: () => unknown
  ): Readonly<{ output: unknown }> => {
    requireHumanUi(context)
    return { output: operation() }
  }
  const mutate = (
    context: IdentityCapabilityContext,
    operation: () => unknown
  ): Readonly<{ output: unknown }> => {
    requireHumanUi(context)
    return { output: operation() }
  }
  const transition = (
    context: IdentityCapabilityContext,
    operation: () => unknown
  ): Readonly<{ output: unknown }> => {
    requireHumanUi(context)
    const output = operation()
    try {
      context.assertPrincipalCurrent()
    } catch (error) {
      if (!isPrincipalChangedError(error)) throw error
    }
    return { output }
  }

  return Object.freeze({
    moduleId: IDENTITY_ACCESS_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'identity' as const,
      title: 'Identity and Access' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: IDENTITY_CAPABILITY_IDS.inspect,
        title: 'Inspect Local Identity',
        description: 'Reads the current installation-local account selection state.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: emptyIdentityInputSchema,
        outputSchema: identityUiStateSchema,
        handler: (_input, context) => read(context, () => options.getService().inspect())
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.listAccounts,
        title: 'List Local Accounts',
        description: 'Lists display-only Local Accounts stored in this installation.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: emptyIdentityInputSchema,
        outputSchema: identityListAccountsOutputSchema,
        handler: (_input, context) => read(context, () => options.getService().listAccounts())
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.createAccount,
        title: 'Create Local Account',
        description: 'Creates and selects a display-only Local Account on this installation.',
        effect: 'external-write',
        principalTransition: 'host-authority',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: usernameInputSchema,
        outputSchema: identityAvailableStateSchema,
        handler: (input, context) => transition(
          context,
          () => options.getService().createAccount(input.username)
        )
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.selectAccount,
        title: 'Select Local Account',
        description: 'Selects an existing display-only Local Account on this installation.',
        effect: 'external-write',
        principalTransition: 'host-authority',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: accountSelectionInputSchema,
        outputSchema: identityAvailableStateSchema,
        handler: (input, context) => transition(
          context,
          () => options.getService().selectAccount(input.userId)
        )
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.renameAccount,
        title: 'Rename Local Account',
        description: 'Changes a Local Account display name without changing its user ID.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: accountRenameInputSchema,
        outputSchema: identityAvailableStateSchema,
        handler: (input, context) => mutate(
          context,
          () => options.getService().renameAccount(input.userId, input.username)
        )
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.exitAccount,
        title: 'Exit Local Account',
        description: 'Clears Local Account selection without changing installation-local data.',
        effect: 'external-write',
        principalTransition: 'host-authority',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: emptyIdentityInputSchema,
        outputSchema: identityAvailableStateSchema,
        handler: (_input, context) => transition(context, () => options.getService().exitAccount())
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.dismissFirstPrompt,
        title: 'Dismiss Local Account Prompt',
        description: 'Persists dismissal of the optional Local Account first-run prompt.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: emptyIdentityInputSchema,
        outputSchema: identityAvailableStateSchema,
        handler: (_input, context) => mutate(
          context,
          () => options.getService().dismissFirstPrompt()
        )
      }),
      define({
        id: IDENTITY_CAPABILITY_IDS.backupAndReset,
        title: 'Back Up and Reset Local Identity',
        description: 'Backs up an unavailable Identity database before establishing a fresh one.',
        effect: 'destructive',
        principalTransition: 'host-authority',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: identityBackupAndResetInputSchema,
        outputSchema: identityBackupAndResetOutputSchema,
        handler: (input, context) => transition(
          context,
          () => options.getService().backupAndReset(input.secondConfirmation)
        )
      })
    ]
  })
}

function requireHumanUi(context: IdentityCapabilityContext): void {
  if (context.caller.audience !== 'ui') {
    throw new Error('Local Account operations require trusted Human UI.')
  }
}

function isPrincipalChangedError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'principal_changed'
}

function requireDeviceId(host: DomainMainHost): string {
  const deviceId = host.getDeviceId?.()
  if (deviceId === undefined) {
    throw new Error('Identity requires the stable installation device ID.')
  }
  return principalDeviceIdSchema.parse(deviceId)
}
