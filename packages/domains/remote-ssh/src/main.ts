import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type {
  WorkspaceHostClient,
  WorkspaceHostProvider,
  WorkspaceHostProviderAttachInput,
  WorkspaceHostProviderContext
} from '@sciforge/domain-sdk/workspace-host'
import type { z } from 'zod'
import {
  REMOTE_SSH_CAPABILITY_IDS,
  REMOTE_SSH_TARGET_RESOURCE_KIND,
  remoteSshBindingGetInputSchema,
  remoteSshBindingGetResultSchema,
  remoteSshBindingSaveInputSchema,
  remoteSshBindingSaveResultSchema,
  remoteSshCommandCancelInputSchema,
  remoteSshCommandCancelResultSchema,
  remoteSshCommandExecuteInputSchema,
  remoteSshCommandExecuteResultSchema,
  remoteSshFileDownloadInputSchema,
  remoteSshFileDownloadResultSchema,
  remoteSshFileUploadInputSchema,
  remoteSshFileUploadResultSchema,
  remoteSshEgressSessionOpenInputSchema,
  remoteSshEgressSessionOpenResultSchema,
  remoteSshLabDeleteInputSchema,
  remoteSshLabDeleteResultSchema,
  remoteSshLabEnvironmentEnsureInputSchema,
  remoteSshLabEnvironmentGetInputSchema,
  remoteSshLabEnvironmentOpenConsoleInputSchema,
  remoteSshLabEnvironmentOpenConsoleResultSchema,
  remoteSshLabEnvironmentResultSchema,
  remoteSshLabEnvironmentStopInputSchema,
  remoteSshLabListInputSchema,
  remoteSshLabListResultSchema,
  remoteSshOpenConfigInputSchema,
  remoteSshOpenConfigResultSchema,
  remoteSshVirtualBoxMachineListInputSchema,
  remoteSshVirtualBoxMachineListResultSchema,
  remoteSshLabSaveInputSchema,
  remoteSshLabSaveResultSchema,
  remoteSshTargetDeleteInputSchema,
  remoteSshTargetDeleteResultSchema,
  remoteSshTargetCatalogInputSchema,
  remoteSshTargetCatalogResultSchema,
  remoteSshTargetListInputSchema,
  remoteSshTargetListResultSchema,
  remoteSshTargetObserveResultSchema,
  remoteSshTargetProbeInputSchema,
  remoteSshTargetProbeResultSchema,
  remoteSshTargetSaveInputSchema,
  remoteSshTargetSaveResultSchema,
  remoteSshTargetSummarySchema,
  remoteSshWorkspaceHostSessionOpenInputSchema,
  remoteSshWorkspaceHostSessionOpenResultSchema,
  type RemoteSshBindingGetResult,
  type RemoteSshBindingSaveInput,
  type RemoteSshBindingSaveResult,
  type RemoteSshCommandCancelInput,
  type RemoteSshCommandCancelResult,
  type RemoteSshCommandExecuteInput,
  type RemoteSshCommandExecuteResult,
  type RemoteSshFileDownloadInput,
  type RemoteSshFileDownloadResult,
  type RemoteSshFileUploadInput,
  type RemoteSshFileUploadResult,
  type RemoteSshEgressSessionOpenResult,
  type RemoteSshLabDeleteInput,
  type RemoteSshLabDeleteResult,
  type RemoteSshLabEnvironmentOpenConsoleResult,
  type RemoteSshLabEnvironmentResult,
  type RemoteSshLabListResult,
  type RemoteSshOpenConfigResult,
  type RemoteSshVirtualBoxMachineListResult,
  type RemoteSshLabSaveInput,
  type RemoteSshLabSaveResult,
  type RemoteSshTarget,
  type RemoteSshTargetDeleteInput,
  type RemoteSshTargetDeleteResult,
  type RemoteSshTargetObserveResult,
  type RemoteSshTargetProbeResult,
  type RemoteSshTargetSaveInput,
  type RemoteSshTargetSaveResult,
  type RemoteSshWorkspaceHostSessionOpenInput,
  type RemoteSshWorkspaceHostSessionOpenResult
} from './contract.js'
import {
  REMOTE_SSH_CAPABILITY_FACTORY_CONTRIBUTION,
  REMOTE_SSH_DOMAIN_MODULE_ID,
  REMOTE_SSH_WORKSPACE_HOST_PROVIDER_CONTRIBUTION,
  REMOTE_SSH_WORKSPACE_HOST_PROVIDER_CONTRACT,
  domainPackageDefinition
} from './definition.js'
import {
  createRemoteSshService,
  type RemoteSshServiceOptions
} from './main/service.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'workspace-write' | 'external-write' | 'destructive'

export type RemoteSshCapabilityResourceRegistration = Readonly<{
  resourceId: string
  resourceKind: typeof REMOTE_SSH_TARGET_RESOURCE_KIND
  workspaceId: string
  audiences: CapabilityAudience[]
  semanticRevision: string
  observe: (caller: Readonly<{ audience: CapabilityAudience }>) => Promise<Readonly<{
    semanticRevision: string
    state: unknown
    operationIds: string[]
  }>>
}>

export type RemoteSshCapabilityHandlerContext = Readonly<{
  caller: Readonly<{
    audience: CapabilityAudience
    workspaceId?: string
  }>
  resource?: Readonly<{
    resourceId: string
    workspaceId?: string
    semanticRevision: string
  }>
  issueResource: (registration: RemoteSshCapabilityResourceRegistration) => unknown
  signal?: AbortSignal
}>

export type RemoteSshCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'global' | 'workspace' | 'resource'
  resourceKinds?: readonly string[]
  effect: CapabilityEffect
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
    context: RemoteSshCapabilityHandlerContext
  ) => { output: unknown; changed?: boolean } |
    Promise<{ output: unknown; changed?: boolean }>
}>

/** Injected by the host so this domain never imports application internals. */
export type RemoteSshCapabilityBuilder<CapabilityDefinition = unknown> = (
  options: RemoteSshCapabilityOptions
) => CapabilityDefinition

export type RemoteSshServicePort = Readonly<{
  openOpenSshConfig(): Promise<RemoteSshOpenConfigResult>
  listLabs(): Promise<RemoteSshLabListResult>
  listVirtualBoxMachines(): Promise<RemoteSshVirtualBoxMachineListResult>
  saveLab(input: RemoteSshLabSaveInput): Promise<RemoteSshLabSaveResult>
  deleteLab(input: RemoteSshLabDeleteInput): Promise<RemoteSshLabDeleteResult>
  getLabEnvironment(labId: string): Promise<RemoteSshLabEnvironmentResult>
  ensureLabEnvironment(labId: string, expectedRevision: string): Promise<RemoteSshLabEnvironmentResult>
  openLabEnvironmentConsole(
    labId: string,
    expectedRevision: string
  ): Promise<RemoteSshLabEnvironmentOpenConsoleResult>
  stopLabEnvironment(labId: string, expectedRevision: string): Promise<RemoteSshLabEnvironmentResult>
  getBinding(workspaceId: string): Promise<RemoteSshBindingGetResult>
  saveBinding(
    workspaceId: string,
    input: RemoteSshBindingSaveInput
  ): Promise<RemoteSshBindingSaveResult>
  listTargetCatalog(): Promise<RemoteSshTarget[]>
  listTargets(
    workspaceId: string
  ): Promise<RemoteSshTarget[]>
  saveTarget(input: RemoteSshTargetSaveInput): Promise<RemoteSshTargetSaveResult>
  deleteTarget(input: RemoteSshTargetDeleteInput): Promise<RemoteSshTargetDeleteResult>
  observeTarget(
    workspaceId: string,
    targetId: string
  ): Promise<Omit<RemoteSshTargetObserveResult, 'target'> & Readonly<{ target: RemoteSshTarget }>>
  probeTarget(
    workspaceId: string,
    targetId: string,
    signal?: AbortSignal
  ): Promise<RemoteSshTargetProbeResult>
  executeCommand(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshCommandExecuteInput,
    signal?: AbortSignal
  ): Promise<RemoteSshCommandExecuteResult>
  cancelCommand(
    workspaceId: string,
    input: RemoteSshCommandCancelInput
  ): Promise<RemoteSshCommandCancelResult>
  uploadFile(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshFileUploadInput,
    signal?: AbortSignal
  ): Promise<RemoteSshFileUploadResult>
  downloadFile(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshFileDownloadInput,
    signal?: AbortSignal
  ): Promise<RemoteSshFileDownloadResult>
  authorizeWorkspaceHostSession(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshWorkspaceHostSessionOpenInput
  ): Promise<RemoteSshWorkspaceHostSessionOpenResult>
  authorizeEgressSession(
    workspaceId: string,
    targetId: string,
    expectedRevision: string
  ): Promise<RemoteSshEgressSessionOpenResult>
  attachWorkspaceHost(
    input: WorkspaceHostProviderAttachInput,
    context: WorkspaceHostProviderContext
  ): Promise<WorkspaceHostClient>
  close(): void
}>

export type RemoteSshCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof REMOTE_SSH_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'remote-ssh'
    title: 'Remote SSH'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type RemoteSshMainContribution<CapabilityDefinition = unknown> =
  RemoteSshCapabilityFactory<CapabilityDefinition> | WorkspaceHostProvider

type RemoteSshMainHost = DomainMainHost & Readonly<{
  createService?: (options: RemoteSshServiceOptions) => RemoteSshServicePort
}>

/** Creates the raw main-process entry and lazily owns exactly one service. */
export function createDomainMainEntry(
  host: RemoteSshMainHost
): TrustedDomainProcessEntryInput<RemoteSshMainContribution> {
  let service: RemoteSshServicePort | undefined
  const getService = (): RemoteSshServicePort => {
    service ??= (host.createService ?? createRemoteSshService)({
      userDataDir: host.getUserDataDir(),
      ...(host.openPath ? { openPath: host.openPath } : {}),
      ...(host.resolveWorkspaceServerArtifact
        ? { workspaceServerArtifact: host.resolveWorkspaceServerArtifact }
        : {})
    })
    return service
  }
  const capabilityFactory = createRemoteSshCapabilityFactory({
    defineCapability: host.defineCapability,
    getService
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...REMOTE_SSH_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory,
        onDispose: () => {
          service?.close()
          service = undefined
        }
      },
      {
        ...REMOTE_SSH_WORKSPACE_HOST_PROVIDER_CONTRIBUTION,
        contract: REMOTE_SSH_WORKSPACE_HOST_PROVIDER_CONTRACT,
        value: Object.freeze({
          attach: (
            input: WorkspaceHostProviderAttachInput,
            context: WorkspaceHostProviderContext
          ) => getService().attachWorkspaceHost(input, context)
        }) satisfies WorkspaceHostProvider
      }
    ]
  }
}

export function createRemoteSshCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: RemoteSshCapabilityBuilder<CapabilityDefinition>
  getService: () => RemoteSshServicePort
}>): RemoteSshCapabilityFactory<CapabilityDefinition> {
  const { defineCapability, getService } = options
  const allAudiences = ['ui', 'agent', 'system'] as const
  const interactiveAudiences = ['ui', 'agent'] as const
  const uiAudience = ['ui'] as const
  const targetResourceKinds = [REMOTE_SSH_TARGET_RESOURCE_KIND] as const

  return Object.freeze({
    moduleId: REMOTE_SSH_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'remote-ssh' as const,
      title: 'Remote SSH' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.openOpenSshConfig,
        version: '1.0.0', title: 'Open the local OpenSSH configuration',
        description: 'Creates ~/.ssh/config when needed and opens it with the configured local editor.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'openssh', 'configuration'],
        inputSchema: remoteSshOpenConfigInputSchema,
        outputSchema: remoteSshOpenConfigResultSchema,
        handler: async () => ({
          output: remoteSshOpenConfigResultSchema.parse(
            await getService().openOpenSshConfig()
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.listLabs,
        version: '1.0.0', title: 'List Remote SSH labs',
        description: 'Lists the laboratory groups configured for Remote SSH.',
        audiences: uiAudience,
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'lab', 'discovery'],
        inputSchema: remoteSshLabListInputSchema,
        outputSchema: remoteSshLabListResultSchema,
        handler: async () => ({
          output: remoteSshLabListResultSchema.parse(await getService().listLabs())
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.listVirtualBoxMachines,
        version: '1.0.0', title: 'List VirtualBox machines',
        description: 'Lists VirtualBox virtual machines available for Remote SSH laboratory isolation.',
        audiences: uiAudience,
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'virtualbox', 'vm', 'discovery'],
        inputSchema: remoteSshVirtualBoxMachineListInputSchema,
        outputSchema: remoteSshVirtualBoxMachineListResultSchema,
        handler: async () => ({
          output: remoteSshVirtualBoxMachineListResultSchema.parse(
            await getService().listVirtualBoxMachines()
          )
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.saveLab,
        version: '1.0.0', title: 'Save Remote SSH lab',
        description: 'Creates or updates one Remote SSH laboratory group.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'lab', 'configuration'],
        inputSchema: remoteSshLabSaveInputSchema,
        outputSchema: remoteSshLabSaveResultSchema,
        handler: async (input) => ({
          output: remoteSshLabSaveResultSchema.parse(await getService().saveLab(input)),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.deleteLab,
        version: '1.0.0', title: 'Delete Remote SSH lab',
        description: 'Deletes one Remote SSH laboratory group.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'lab', 'configuration'],
        inputSchema: remoteSshLabDeleteInputSchema,
        outputSchema: remoteSshLabDeleteResultSchema,
        handler: async (input) => ({
          output: remoteSshLabDeleteResultSchema.parse(await getService().deleteLab(input)),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.getLabEnvironment,
        version: '1.0.0', title: 'Inspect laboratory VPN environment',
        description: 'Reads the configured VPN environment provider and connection state for one laboratory.',
        audiences: uiAudience,
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'lab', 'environment', 'vpn', 'diagnostics'],
        inputSchema: remoteSshLabEnvironmentGetInputSchema,
        outputSchema: remoteSshLabEnvironmentResultSchema,
        handler: async (input) => ({
          output: remoteSshLabEnvironmentResultSchema.parse(
            await getService().getLabEnvironment(input.labId)
          )
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment,
        version: '1.0.0', title: 'Ensure laboratory VPN environment',
        description: 'Ensures the configured VPN environment is available and running.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'lab', 'environment', 'vpn', 'lifecycle'],
        inputSchema: remoteSshLabEnvironmentEnsureInputSchema,
        outputSchema: remoteSshLabEnvironmentResultSchema,
        handler: async (input) => ({
          output: remoteSshLabEnvironmentResultSchema.parse(
            await getService().ensureLabEnvironment(input.labId, input.expectedRevision)
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole,
        version: '1.0.0', title: 'Open laboratory VPN console',
        description: 'Opens the configured VPN environment console for interactive sign-in.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'lab', 'environment', 'vpn', 'console'],
        inputSchema: remoteSshLabEnvironmentOpenConsoleInputSchema,
        outputSchema: remoteSshLabEnvironmentOpenConsoleResultSchema,
        handler: async (input) => ({
          output: remoteSshLabEnvironmentOpenConsoleResultSchema.parse(
            await getService().openLabEnvironmentConsole(input.labId, input.expectedRevision)
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment,
        version: '1.0.0', title: 'Stop laboratory VPN environment',
        description: 'Stops the configured VPN environment while retaining its persistent state.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'lab', 'environment', 'vpn', 'lifecycle'],
        inputSchema: remoteSshLabEnvironmentStopInputSchema,
        outputSchema: remoteSshLabEnvironmentResultSchema,
        handler: async (input) => ({
          output: remoteSshLabEnvironmentResultSchema.parse(
            await getService().stopLabEnvironment(input.labId, input.expectedRevision)
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.getBinding,
        version: '1.0.0', title: 'Read workspace Remote SSH binding',
        description: 'Reads the Remote SSH targets authorized for the caller workspace.',
        audiences: uiAudience,
        scope: 'workspace', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'workspace', 'authorization'],
        inputSchema: remoteSshBindingGetInputSchema,
        outputSchema: remoteSshBindingGetResultSchema,
        handler: async (_, context) => ({
          output: remoteSshBindingGetResultSchema.parse(
            await getService().getBinding(requireCallerWorkspace(context))
          )
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.saveBinding,
        version: '1.0.0', title: 'Save workspace Remote SSH binding',
        description: 'Updates the Remote SSH targets authorized for the caller workspace.',
        audiences: uiAudience,
        scope: 'workspace', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'workspace', 'authorization'],
        inputSchema: remoteSshBindingSaveInputSchema,
        outputSchema: remoteSshBindingSaveResultSchema,
        handler: async (input, context) => ({
          output: remoteSshBindingSaveResultSchema.parse(
            await getService().saveBinding(requireCallerWorkspace(context), input)
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog,
        version: '1.0.0', title: 'List Remote SSH target catalog',
        description: 'Lists full Remote SSH target configuration for the management UI.',
        audiences: uiAudience,
        scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'target', 'configuration'],
        inputSchema: remoteSshTargetCatalogInputSchema,
        outputSchema: remoteSshTargetCatalogResultSchema,
        handler: async () => ({
          output: remoteSshTargetCatalogResultSchema.parse(
            { targets: await getService().listTargetCatalog() }
          )
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.listTargets,
        version: '1.0.0', title: 'List Remote SSH targets',
        description: 'Lists Remote SSH targets authorized for the caller workspace.',
        audiences: allAudiences,
        scope: 'workspace', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'target', 'discovery'],
        inputSchema: remoteSshTargetListInputSchema,
        outputSchema: remoteSshTargetListResultSchema,
        handler: async (_, context) => {
          const workspaceId = requireCallerWorkspace(context)
          const targets = await getService().listTargets(workspaceId)
          return {
            output: remoteSshTargetListResultSchema.parse({
              targets: targets.map((target) => ({
                target: targetSummary(target),
                resource: context.issueResource(targetResource(getService, workspaceId, target))
              }))
            })
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.probeTarget,
        version: '1.0.0', title: 'Probe Remote SSH target',
        description: 'Tests final-target reachability through the canonical OpenSSH alias.',
        audiences: allAudiences,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['remote-ssh', 'target', 'diagnostics'],
        inputSchema: remoteSshTargetProbeInputSchema,
        outputSchema: remoteSshTargetProbeResultSchema,
        handler: async (_, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshTargetProbeResultSchema.parse(
              await getService().probeTarget(target.workspaceId, target.targetId, context.signal)
            )
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.saveTarget,
        version: '1.0.0', title: 'Save Remote SSH target',
        description: 'Creates or updates one logical OpenSSH target.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'target', 'configuration'],
        inputSchema: remoteSshTargetSaveInputSchema,
        outputSchema: remoteSshTargetSaveResultSchema,
        handler: async (input) => ({
          output: remoteSshTargetSaveResultSchema.parse(await getService().saveTarget(input)),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.deleteTarget,
        version: '1.0.0', title: 'Delete Remote SSH target',
        description: 'Deletes one logical OpenSSH target.',
        audiences: uiAudience,
        scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'target', 'configuration'],
        inputSchema: remoteSshTargetDeleteInputSchema,
        outputSchema: remoteSshTargetDeleteResultSchema,
        handler: async (input) => ({
          output: remoteSshTargetDeleteResultSchema.parse(await getService().deleteTarget(input)),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.executeCommand,
        version: '1.0.0', title: 'Execute Remote SSH command',
        description: 'Executes a confirmed script on the authorized target through system OpenSSH.',
        audiences: interactiveAudiences,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'destructive', approval: 'confirmation',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['remote-ssh', 'command', 'execution'],
        inputSchema: remoteSshCommandExecuteInputSchema,
        outputSchema: remoteSshCommandExecuteResultSchema,
        handler: async (input, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshCommandExecuteResultSchema.parse(
              await getService().executeCommand(
                target.workspaceId,
                target.targetId,
                target.semanticRevision,
                input,
                context.signal
              )
            ),
            changed: false
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.cancelCommand,
        version: '1.0.0', title: 'Cancel Remote SSH command',
        description: 'Cancels an active Remote SSH command owned by the caller workspace.',
        audiences: interactiveAudiences,
        scope: 'workspace', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['remote-ssh', 'command', 'cancellation'],
        inputSchema: remoteSshCommandCancelInputSchema,
        outputSchema: remoteSshCommandCancelResultSchema,
        handler: async (input, context) => ({
          output: remoteSshCommandCancelResultSchema.parse(
            await getService().cancelCommand(requireCallerWorkspace(context), input)
          ),
          changed: false
        })
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.openEgressSession,
        version: '1.0.0', title: 'Authorize Remote SSH network egress',
        description: 'Authorizes this target as a network-egress hop for the caller workspace.',
        audiences: uiAudience,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['remote-ssh', 'workspace-egress', 'session'],
        inputSchema: remoteSshEgressSessionOpenInputSchema,
        outputSchema: remoteSshEgressSessionOpenResultSchema,
        handler: async (_, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshEgressSessionOpenResultSchema.parse(
              await getService().authorizeEgressSession(
                target.workspaceId,
                target.targetId,
                target.semanticRevision
              )
            ),
            changed: false
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.openWorkspaceHostSession,
        version: '1.0.0', title: 'Open Remote Workspace session',
        description: 'Authorizes a private Remote Workspace host session on this target.',
        audiences: uiAudience,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['remote-ssh', 'workspace-host', 'session'],
        inputSchema: remoteSshWorkspaceHostSessionOpenInputSchema,
        outputSchema: remoteSshWorkspaceHostSessionOpenResultSchema,
        handler: async (input, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshWorkspaceHostSessionOpenResultSchema.parse(
              await getService().authorizeWorkspaceHostSession(
                target.workspaceId,
                target.targetId,
                target.semanticRevision,
                input
              )
            ),
            changed: false
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.uploadFile,
        version: '1.0.0', title: 'Upload file over Remote SSH',
        description: 'Uploads one workspace-relative file to the authorized target.',
        audiences: interactiveAudiences,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['remote-ssh', 'file-transfer', 'upload'],
        inputSchema: remoteSshFileUploadInputSchema,
        outputSchema: remoteSshFileUploadResultSchema,
        handler: async (input, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshFileUploadResultSchema.parse(
              await getService().uploadFile(
                target.workspaceId,
                target.targetId,
                target.semanticRevision,
                input,
                context.signal
              )
            ),
            changed: false
          }
        }
      }),
      defineCapability({
        id: REMOTE_SSH_CAPABILITY_IDS.downloadFile,
        version: '1.0.0', title: 'Download file over Remote SSH',
        description: 'Downloads one remote file into a workspace-relative destination.',
        audiences: interactiveAudiences,
        scope: 'resource', resourceKinds: targetResourceKinds,
        effect: 'workspace-write', approval: 'confirmation',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['remote-ssh', 'file-transfer', 'download'],
        inputSchema: remoteSshFileDownloadInputSchema,
        outputSchema: remoteSshFileDownloadResultSchema,
        handler: async (input, context) => {
          const target = requireTargetResource(context)
          return {
            output: remoteSshFileDownloadResultSchema.parse(
              await getService().downloadFile(
                target.workspaceId,
                target.targetId,
                target.semanticRevision,
                input,
                context.signal
              )
            ),
            changed: false
          }
        }
      })
    ]
  })
}

function targetResource(
  getService: () => RemoteSshServicePort,
  workspaceId: string,
  target: RemoteSshTarget
): RemoteSshCapabilityResourceRegistration {
  return {
    resourceId: target.id,
    resourceKind: REMOTE_SSH_TARGET_RESOURCE_KIND,
    workspaceId,
    audiences: ['ui', 'agent', 'system'],
    semanticRevision: target.revision,
    observe: async (caller) => {
      const observation = await getService().observeTarget(workspaceId, target.id)
      const operationIds: string[] = [REMOTE_SSH_CAPABILITY_IDS.probeTarget]
      if (caller.audience !== 'system') {
        if (observation.target.capabilities.includes('shell')) {
          operationIds.push(REMOTE_SSH_CAPABILITY_IDS.executeCommand)
        }
        if (observation.target.capabilities.includes('file-transfer')) {
          operationIds.push(
            REMOTE_SSH_CAPABILITY_IDS.uploadFile,
            REMOTE_SSH_CAPABILITY_IDS.downloadFile
          )
        }
        if (
          observation.target.capabilities.includes('shell') &&
          observation.target.capabilities.includes('file-transfer') &&
          caller.audience === 'ui'
        ) {
          operationIds.push(REMOTE_SSH_CAPABILITY_IDS.openWorkspaceHostSession)
        }
        if (
          observation.target.capabilities.includes('shell') &&
          caller.audience === 'ui'
        ) {
          operationIds.push(REMOTE_SSH_CAPABILITY_IDS.openEgressSession)
        }
      }
      return {
        semanticRevision: observation.target.revision,
        state: remoteSshTargetObserveResultSchema.parse({
          ...observation,
          target: targetSummary(observation.target)
        }),
        operationIds
      }
    }
  }
}

function targetSummary(target: RemoteSshTarget) {
  return remoteSshTargetSummarySchema.parse({
    id: target.id,
    labId: target.labId,
    displayName: target.displayName,
    labels: target.labels,
    capabilities: target.capabilities,
    maxConcurrentExecutions: target.maxConcurrentExecutions
  })
}

function requireCallerWorkspace(context: RemoteSshCapabilityHandlerContext): string {
  const workspaceId = context.caller.workspaceId?.trim()
  if (!workspaceId) throw new Error('Remote SSH requires a workspace-scoped caller.')
  return workspaceId
}

function requireTargetResource(context: RemoteSshCapabilityHandlerContext): Readonly<{
  workspaceId: string
  targetId: string
  semanticRevision: string
}> {
  const resource = context.resource
  if (!resource) throw new Error('Remote SSH target resource is required.')
  const workspaceId = resource.workspaceId?.trim()
  if (!workspaceId) throw new Error('Remote SSH target workspace scope is required.')
  const callerWorkspaceId = requireCallerWorkspace(context)
  if (callerWorkspaceId !== workspaceId) {
    throw new Error('Remote SSH target does not belong to the caller workspace.')
  }
  return {
    workspaceId,
    targetId: resource.resourceId,
    semanticRevision: resource.semanticRevision
  }
}
