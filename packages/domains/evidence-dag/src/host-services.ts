import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSION_READ_CONTRACT
} from '@sciforge/domain-artifact-versions/contract'
import type { HostServiceClientFactory, HostServiceProvider } from '@sciforge/plugin-sdk'
import { evidenceDagStorageRoot } from './storage.js'
import {
  createEvidenceProductionService,
  type EvidenceCallContext
} from './host/production-service.js'
import type { Json, Scope, ThreadProjection } from './host/ports.js'

export type EvidenceDomainHostServiceOptions = Readonly<{
  userDataDir: string
  environment: NodeJS.ProcessEnv
  reasoner: (input: Json, signal: AbortSignal, assertCurrent?: () => void) => Promise<string>
  threads: {
    read(scope: Scope, context: EvidenceCallContext): Promise<ThreadProjection>
    list(scope: Scope, context: EvidenceCallContext): Promise<readonly Scope[]>
  }
  capabilities: {
    invoke(
      request: Readonly<{ actionId: string; input: unknown; invocationId?: string }>,
      context: EvidenceCallContext
    ): Promise<unknown>
  }
  logUnavailable: () => void
}>

export type DomainHostServiceResolver = Readonly<{
  resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  serviceIds: readonly string[]
}>

export function createDomainHostServiceResolver(
  rawOptions: Readonly<Record<string, unknown>>
): DomainHostServiceResolver {
  const options = rawOptions as EvidenceDomainHostServiceOptions
  const services = new Map<string, ReturnType<typeof createEvidenceProductionService>>()
  const resolveService = (packageName: string, version: string, generation: number) => {
    if (packageName !== 'sciforge-evidence-dag') return undefined
    const executable = options.environment.SCIFORGE_EVIDENCE_PYTHON?.trim()
    const wheelPath = options.environment.SCIFORGE_EVIDENCE_WHEEL_PATH?.trim()
    const wheelSha256 = options.environment.SCIFORGE_EVIDENCE_WHEEL_SHA256?.trim()
    const clientModule = options.environment.SCIFORGE_EVIDENCE_CLIENT_MODULE?.trim()
    if (!executable || !wheelPath || !wheelSha256 || !clientModule) {
      options.logUnavailable()
      return undefined
    }
    const key = `${packageName}@${version}#${generation}`
    const existing = services.get(key)
    if (existing) return existing
    const storageRoot = evidenceDagStorageRoot(options.userDataDir, options.environment)
    const service = createEvidenceProductionService({
      identity: { pluginId: packageName, version, profileId: options.userDataDir },
      storageRoot,
      storageInterpreter: executable,
      clientModule,
      worker: {
        executable,
        wheelPath,
        wheelSha256,
        storageRoot,
        home: join(options.userDataDir, 'evidence-dag', 'home'),
        tmpDir: join(options.userDataDir, 'evidence-dag', 'tmp'),
        reasoner: options.reasoner
      },
      threads: options.threads,
      artifacts: {
        async invoke(operation, _scope, input, context) {
          const contract = {
            'artifacts.commit': ARTIFACT_VERSION_COMMIT_CONTRACT,
            'artifacts.read': ARTIFACT_VERSION_READ_CONTRACT,
            'artifacts.listEvents': ARTIFACT_VERSION_EVENT_LIST_CONTRACT
          }[operation]
          context.assertCurrent()
          context.signal.throwIfAborted()
          const validated = contract.inputSchema.parse(input)
          const idempotencyKey = operation === 'artifacts.commit' && input &&
            typeof input === 'object' && !Array.isArray(input)
            ? input.idempotencyKey : undefined
          const invocationId = typeof idempotencyKey === 'string'
            ? `evidence-artifacts:${createHash('sha256').update(idempotencyKey).digest('hex')}`
            : undefined
          const result = await options.capabilities.invoke({
            actionId: contract.actionId,
            input: validated,
            ...(invocationId ? { invocationId } : {})
          }, context)
          context.assertCurrent()
          context.signal.throwIfAborted()
          return contract.outputSchema.parse(result)
        }
      }
    })
    services.set(key, service)
    return service
  }
  return Object.freeze({
    resolve: (packageName, version, generation) => resolveService(packageName, version, generation)?.providers,
    resolveClients: (packageName, version, generation) => resolveService(packageName, version, generation)?.clients ?? [],
    serviceIds: Object.freeze(['evidenceDagPorts'])
  })
}
