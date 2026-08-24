import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import { defineDomainMainInternalServiceDescriptor } from '@sciforge/domain-sdk/host'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID
} from '../authenticated-cloud-transport.js'
import {
  DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
  DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID
} from '../device-fact-attestation-signing.js'
import {
  AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  AGENT_CLOUD_RUNTIME_SERVICE_ID
} from '../agent-cloud-runtime.js'
import {
  principalDeviceIdSchema,
  type DomainMainPrincipalProvider
} from '@sciforge/domain-sdk/principal'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'
import {
  IDENTITY_CAPABILITY_IDS,
  cloudDeviceRevokeInputSchema,
  cloudIdentityInspectOutputSchema,
  cloudIdentityObservationContract,
  cloudIdentitySnapshotSchema,
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
  IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT,
  IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRIBUTION,
  IDENTITY_PRINCIPAL_PROVIDER_CONTRIBUTION,
  IDENTITY_RUNTIME_LIFECYCLE_CONTRIBUTION,
  IDENTITY_DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT,
  IDENTITY_DEVICE_FACT_ATTESTATION_SIGNING_CONTRIBUTION,
  IDENTITY_AGENT_CLOUD_RUNTIME_CONTRACT,
  IDENTITY_AGENT_CLOUD_RUNTIME_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { IdentityService } from './service.js'
import { CloudIdentityRuntime } from './cloud-runtime.js'
import { createIdentityAuthenticatedCloudTransport } from './authenticated-cloud-transport.js'
import { createIdentityDeviceFactAttestationSigningService } from './device-fact-attestation-signing.js'
import { createIdentityAgentCloudRuntime } from './agent-cloud-runtime.js'
import { cloudInstallationId } from './device-service.js'
import { createNativeIdentityPrivateVault } from './private-vault.js'

export { LocalCloudIdentityLinkService } from './cloud-link-service.js'

type IdentityCapabilityEffect = 'read' | 'external-write' | 'destructive'
type IdentityCloudCapabilityRuntime = Readonly<{
  snapshot: () => unknown
  semanticRevision: () => string
  subscribe: (listener: () => void) => () => void
  login: () => Promise<unknown>
  reauthenticate: () => Promise<unknown>
  logout: () => Promise<unknown>
  enrollDevice: () => Promise<unknown>
  refreshDevices: () => Promise<unknown>
  revokeDevice: (deviceId: string) => Promise<unknown>
}>
type IdentityCapabilityContext = Readonly<{
  caller: Readonly<{ audience: 'ui' | 'agent' | 'system' }>
  assertPrincipalCurrent: () => void
  resource?: Readonly<{
    resourceId: string
    resourceKind: string
    semanticRevision: string
  }>
  issueResource?: (registration: Readonly<{
    resourceId: string
    resourceKind: string
    audiences: readonly ['ui']
    semanticRevision: string
    observe: () => Promise<Readonly<{
      state: unknown
      semanticRevision: string
      operationIds: readonly string[]
    }>>
    subscribeChanges: (listener: (change: Readonly<{
      semanticRevision: string
      layoutRevision?: string
    }>) => void) => () => void
    dispose: () => void
    retireAfterLastHandleExpires: true
  }>) => unknown
}>

export type IdentityCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global' | 'resource'
  resourceKinds?: readonly string[]
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
  | DomainMainRuntimeLifecycleContribution
  | typeof authenticatedCloudTransportDescriptor
  | typeof deviceFactAttestationSigningDescriptor
  | typeof agentCloudRuntimeDescriptor

const authenticatedCloudTransportDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  allowedConsumerModuleIds: [
    'sciforge.collaboration',
    'sciforge.project-coordinator'
  ]
})

const deviceFactAttestationSigningDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
  contractVersion: DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
  allowedConsumerModuleIds: ['sciforge.project-coordinator']
})

const agentCloudRuntimeDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: AGENT_CLOUD_RUNTIME_SERVICE_ID,
  contractVersion: AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  allowedConsumerModuleIds: ['sciforge.collaboration']
})

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<IdentityMainContribution> {
  if (!host.internalServices) {
    throw new Error('Identity requires Host internal-service mediation.')
  }
  let service: IdentityService | undefined
  const getService = (): IdentityService => {
    service ??= new IdentityService(
      host.getUserDataDir(),
      requireDeviceId(host)
    )
    return service
  }
  const principalProvider: DomainMainPrincipalProvider = Object.freeze({
    current: () => getService().current(),
    snapshot: () => getService().snapshot(),
    subscribe: (listener) => getService().subscribe(listener)
  })
  let cloudRuntime: CloudIdentityRuntime | null = null
  let cloudActivation: Promise<CloudIdentityRuntime> | null = null
  const closedCloudRuntimes = new WeakSet<CloudIdentityRuntime>()
  const installationId = cloudInstallationId(requireDeviceId(host))
  const privateVault = createNativeIdentityPrivateVault({ installationId })
  const getCloudRuntime = (): CloudIdentityRuntime => {
    if (!cloudRuntime) throw new Error('Cloud identity runtime is not active.')
    return cloudRuntime
  }
  const authenticatedCloudTransport = createIdentityAuthenticatedCloudTransport({
    getRuntime: () => cloudRuntime
  })
  host.internalServices.register({
    serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
    contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
    allowedConsumerModuleIds: authenticatedCloudTransportDescriptor.allowedConsumerModuleIds,
    service: authenticatedCloudTransport
  })
  const deviceFactAttestationSigning = createIdentityDeviceFactAttestationSigningService({
    getRuntime: () => cloudRuntime
  })
  host.internalServices.register({
    serviceId: DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
    contractVersion: DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
    allowedConsumerModuleIds: deviceFactAttestationSigningDescriptor.allowedConsumerModuleIds,
    service: deviceFactAttestationSigning
  })
  const agentCloudRuntime = createIdentityAgentCloudRuntime({
    getRuntime: () => cloudRuntime,
    vault: privateVault
  })
  host.internalServices.register({
    serviceId: AGENT_CLOUD_RUNTIME_SERVICE_ID,
    contractVersion: AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
    allowedConsumerModuleIds: agentCloudRuntimeDescriptor.allowedConsumerModuleIds,
    service: agentCloudRuntime
  })
  const closeCloudRuntime = (runtime: CloudIdentityRuntime | null): void => {
    if (!runtime || closedCloudRuntimes.has(runtime)) return
    closedCloudRuntimes.add(runtime)
    if (cloudRuntime === runtime) cloudRuntime = null
    runtime.close()
  }
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      if (cloudRuntime || cloudActivation) {
        throw new Error('Cloud identity runtime lifecycle is already active.')
      }
      const pending = (async () => {
        const appVersion = requireAppVersion(host)
        const runtime = await CloudIdentityRuntime.create({
          userDataDir: context.userDataDir,
          appRoot: context.appRoot,
          appVersion,
          environment: context.environment,
          installationId: requireDeviceId(host),
          privateVault,
          externalNavigation: host.externalNavigation
        })
        try {
          await runtime.initialize()
          return runtime
        } catch (error) {
          closeCloudRuntime(runtime)
          throw error
        }
      })()
      cloudActivation = pending
      try {
        const runtime = await pending
        cloudRuntime = runtime
        return () => closeCloudRuntime(runtime)
      } finally {
        if (cloudActivation === pending) cloudActivation = null
      }
    }
  })
  let localDisposed = false
  const disposeLocal = (): void => {
    if (localDisposed) return
    localDisposed = true
    service?.close()
    service = undefined
  }
  const disposeCloud = async (): Promise<void> => {
    const pending = cloudActivation
    if (!pending) {
      closeCloudRuntime(cloudRuntime)
      return
    }
    try {
      closeCloudRuntime(await pending)
    } catch {
      // A failed activation already reports through the lifecycle owner.
    }
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
          getService,
          getCloudRuntime
        }),
        onDispose: disposeLocal
      },
      {
        ...IDENTITY_PRINCIPAL_PROVIDER_CONTRIBUTION,
        value: principalProvider,
        onDispose: disposeLocal
      },
      {
        ...IDENTITY_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: disposeCloud
      },
      {
        ...IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRIBUTION,
        contract: IDENTITY_AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT,
        value: authenticatedCloudTransportDescriptor
      },
      {
        ...IDENTITY_DEVICE_FACT_ATTESTATION_SIGNING_CONTRIBUTION,
        contract: IDENTITY_DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT,
        value: deviceFactAttestationSigningDescriptor
      },
      {
        ...IDENTITY_AGENT_CLOUD_RUNTIME_CONTRIBUTION,
        contract: IDENTITY_AGENT_CLOUD_RUNTIME_CONTRACT,
        value: agentCloudRuntimeDescriptor
      }
    ]
  }
}

export function createIdentityCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: (options: IdentityCapabilityOptions) => CapabilityDefinition
  getService: () => IdentityService
  getCloudRuntime: () => IdentityCloudCapabilityRuntime
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
  const observeCloud = async () => {
    const runtime = options.getCloudRuntime()
    const state = cloudIdentitySnapshotSchema.parse(runtime.snapshot())
    return {
      state,
      semanticRevision: runtime.semanticRevision(),
      operationIds: []
    }
  }
  const disposeCloudResource = (): void => undefined
  const subscribeCloudChanges = (
    listener: (change: Readonly<{ semanticRevision: string; layoutRevision?: string }>) => void
  ): (() => void) => {
    const runtime = options.getCloudRuntime()
    return runtime.subscribe(() => listener({ semanticRevision: runtime.semanticRevision() }))
  }
  const mutateCloud = async (
    context: IdentityCapabilityContext,
    operation: (runtime: IdentityCloudCapabilityRuntime) => Promise<unknown>
  ): Promise<Readonly<{
    output: unknown
  }>> => {
    requireHumanUi(context)
    const runtime = options.getCloudRuntime()
    const output = cloudIdentitySnapshotSchema.parse(await operation(runtime))
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
      }),
      options.defineCapability({
        id: IDENTITY_CAPABILITY_IDS.cloudInspect,
        version: '1.0.0',
        title: 'Inspect Cloud Identity',
        description: 'Issues the canonical observable Desktop cloud identity resource.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['identity-access', 'cloud', 'oidc', 'device'],
        inputSchema: emptyIdentityInputSchema,
        outputSchema: cloudIdentityInspectOutputSchema,
        handler: async (_input, context) => {
          requireHumanUi(context)
          const runtime = options.getCloudRuntime()
          const snapshot = cloudIdentitySnapshotSchema.parse(runtime.snapshot())
          const resource = requireIssueResource(context)({
            resourceId: 'desktop-cloud-identity',
            resourceKind: cloudIdentityObservationContract.resourceKind,
            audiences: ['ui'],
            semanticRevision: runtime.semanticRevision(),
            observe: observeCloud,
            subscribeChanges: subscribeCloudChanges,
            dispose: disposeCloudResource,
            retireAfterLastHandleExpires: true
          })
          return {
            output: cloudIdentityInspectOutputSchema.parse({ snapshot, resource })
          }
        }
      }),
      ...cloudMutationDefinitions(options.defineCapability, mutateCloud)
    ]
  })
}

function cloudMutationDefinitions<CapabilityDefinition>(
  defineCapability: (options: IdentityCapabilityOptions) => CapabilityDefinition,
  mutate: (
    context: IdentityCapabilityContext,
    operation: (runtime: IdentityCloudCapabilityRuntime) => Promise<unknown>
  ) => Promise<Readonly<{
    output: unknown
  }>>
): readonly CapabilityDefinition[] {
  const define = (
    id: string,
    title: string,
    description: string,
    inputSchema: z.ZodType,
    operation: (runtime: IdentityCloudCapabilityRuntime, input: any) => Promise<unknown>
  ): CapabilityDefinition => defineCapability({
    id,
    version: '1.0.0',
    title,
    description,
    audiences: ['ui'],
    scope: 'global',
    effect: 'external-write',
    principalTransition: 'host-authority',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'required' },
    tags: ['identity-access', 'cloud', 'oidc', 'device'],
    inputSchema,
    outputSchema: cloudIdentitySnapshotSchema,
    handler: (input, context) => mutate(
      context,
      (runtime) => operation(runtime, input)
    )
  })

  return [
    define(
      IDENTITY_CAPABILITY_IDS.cloudLogin,
      'Sign In to SciForge Cloud',
      'Starts Authorization Code with PKCE in the system browser.',
      emptyIdentityInputSchema,
      (runtime) => runtime.login()
    ),
    define(
      IDENTITY_CAPABILITY_IDS.cloudReauthenticate,
      'Reauthenticate SciForge Cloud',
      'Requires a fresh browser authentication for the current cloud User.',
      emptyIdentityInputSchema,
      (runtime) => runtime.reauthenticate()
    ),
    define(
      IDENTITY_CAPABILITY_IDS.cloudLogout,
      'Sign Out of SciForge Cloud',
      'Revokes the refresh session and clears local cloud credentials.',
      emptyIdentityInputSchema,
      (runtime) => runtime.logout()
    ),
    define(
      IDENTITY_CAPABILITY_IDS.cloudEnrollDevice,
      'Enroll This Desktop',
      'Registers this installation as a SciForge Cloud Device.',
      emptyIdentityInputSchema,
      (runtime) => runtime.enrollDevice()
    ),
    define(
      IDENTITY_CAPABILITY_IDS.cloudRefreshDevices,
      'Refresh Cloud Devices',
      'Reloads the current User Device list from SciForge Cloud.',
      emptyIdentityInputSchema,
      (runtime) => runtime.refreshDevices()
    ),
    define(
      IDENTITY_CAPABILITY_IDS.cloudRevokeDevice,
      'Revoke Cloud Device',
      'Revokes one Device owned by the authenticated cloud User.',
      cloudDeviceRevokeInputSchema,
      (runtime, input) => runtime.revokeDevice(input.deviceId)
    )
  ]
}

function requireHumanUi(context: IdentityCapabilityContext): void {
  if (context.caller.audience !== 'ui') {
    throw new Error('Local Account operations require trusted Human UI.')
  }
}

function requireIssueResource(
  context: IdentityCapabilityContext
): NonNullable<IdentityCapabilityContext['issueResource']> {
  if (!context.issueResource) {
    throw new Error('Cloud identity inspection requires the Host resource broker.')
  }
  return context.issueResource
}

function isPrincipalChangedError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'principal_changed'
}

function requireAppVersion(host: DomainMainHost): string {
  const appVersion = host.getAppVersion?.()
  if (
    typeof appVersion !== 'string' ||
    appVersion.length === 0 ||
    appVersion.length > 256 ||
    appVersion.trim() !== appVersion
  ) {
    throw new Error('Identity requires the canonical Host application version.')
  }
  return appVersion
}

function requireDeviceId(host: DomainMainHost): string {
  const deviceId = host.getDeviceId?.()
  if (deviceId === undefined) {
    throw new Error('Identity requires the stable installation device ID.')
  }
  return principalDeviceIdSchema.parse(deviceId)
}
