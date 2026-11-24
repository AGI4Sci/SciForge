import { createArtifactVersionCommitPortV1, createArtifactVersionReadPortV1 } from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { definitionBytes, MAX_SEALED_BYTES, sha256, type KnowledgeState } from './derive.js'
import { searchResources } from './core/resource-index.js'
import { KNOWLEDGE_RESOURCE_CAPABILITY_IDS, KNOWLEDGE_RESOURCE_KIND, knowledgeResourceSchema,
  resourceCommitInputSchema, resourceCommitResultSchema, resourceSearchInputSchema, resourceSearchResultSchema,
  validateResourceUpdate, type ResourceCommitInput, type ResourceSearchInput } from './resource-contract.js'

type Context = Readonly<{ caller: Readonly<{ workspaceId?: string }>; signal?: AbortSignal; assertPrincipalCurrent?: () => void | Promise<void> }>
type Options = {
  host: DomainMainHost
  requireWorkspace(context: Context, action: string): string
  deriveState(workspace: string, signal?: AbortSignal): Promise<KnowledgeState>
}

export function createResourceCapabilities({ host, requireWorkspace, deriveState }: Options) {
  const assertCurrent = async (context: Context) => {
    if (context.signal?.aborted) throw new Error('Knowledge resource operation cancelled.')
    await context.assertPrincipalCurrent?.()
  }
  return [
    host.defineCapability({
      id: KNOWLEDGE_RESOURCE_CAPABILITY_IDS.commit, version: '1.0.0', title: 'Record a data resource',
      description: 'Seals an independent data resource with source evidence and append-only observations. Updates require an explicit version baseline; Artifact Versions provides atomic compare-and-swap and durable idempotent replay. Saving performs no network retrieval.',
      audiences: ['ui', 'agent', 'system'], scope: 'workspace', effect: 'workspace-write', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['knowledge-net', 'resource', 'data', 'artifact'],
      inputSchema: resourceCommitInputSchema, outputSchema: resourceCommitResultSchema,
      handler: async (raw: ResourceCommitInput, context: Context) => {
        const workspace = requireWorkspace(context, 'resource commit')
        await assertCurrent(context)
        const parsed = resourceCommitInputSchema.safeParse(raw)
        if (!parsed.success) throw new Error(`invalid_input: ${parsed.error.message}`)
        const input = parsed.data
        const bytes = definitionBytes(input.resource)
        if (bytes.length > MAX_SEALED_BYTES) throw new Error('invalid_input: resource exceeds the sealed size limit.')
        if (input.resourceId && input.expectedVersionId) {
          const read = await createArtifactVersionReadPortV1(host.capabilities!, workspace).read({ versionId: input.expectedVersionId, maxBytes: MAX_SEALED_BYTES })
          if (!read.ok) throw new Error(`${read.issue.code.replaceAll('-', '_')}: ${read.issue.message}`)
          const { artifact, version } = read.value
          const baselineBytes = Buffer.from(read.value.dataBase64, 'base64')
          if (artifact.artifactId !== input.resourceId || artifact.kind !== KNOWLEDGE_RESOURCE_KIND ||
            version.versionId !== input.expectedVersionId || version.storage.mode !== 'snapshot' || version.storage.contentDigest !== sha256(baselineBytes)) {
            throw new Error('invalid_input: baseline identity, kind or digest does not match the resource.')
          }
          let baseline: unknown
          try { baseline = JSON.parse(baselineBytes.toString('utf8')) } catch { throw new Error('invalid_input: baseline is invalid JSON.') }
          const previous = knowledgeResourceSchema.safeParse(baseline)
          if (!previous.success) throw new Error('invalid_input: baseline fails the resource schema.')
          const violation = validateResourceUpdate(previous.data, input.resource)
          if (violation) throw new Error(`invalid_input: ${violation}`)
        }
        await assertCurrent(context)
        const committed = await createArtifactVersionCommitPortV1(host.capabilities!, workspace).commit({
          idempotencyKey: `knowledge-net/resource:${input.operationId}`,
          candidates: [{ candidateId: 'resource', ...(input.resourceId ? { artifactId: input.resourceId } : {}),
            expectedCurrentVersionId: input.expectedVersionId, kind: KNOWLEDGE_RESOURCE_KIND, label: input.resource.name, intent: 'save',
            content: { mode: 'snapshot', dataBase64: bytes.toString('base64'), mediaType: 'application/json' } }]
        })
        if (!committed.ok) throw new Error(`${committed.issue.code.replaceAll('-', '_')}: ${committed.issue.message}`)
        const item = committed.value.versions[0]
        if (!item || item.version.storage.mode !== 'snapshot' || item.version.storage.contentDigest !== sha256(bytes)) {
          throw new Error('content_mismatch: resource commit returned no matching sealed snapshot.')
        }
        await assertCurrent(context)
        return { output: resourceCommitResultSchema.parse({ resourceId: item.artifact.artifactId,
          versionId: item.version.versionId, contentDigest: item.version.storage.contentDigest }) }
      }
    }),
    host.defineCapability({
      id: KNOWLEDGE_RESOURCE_CAPABILITY_IDS.search, version: '1.0.0', title: 'Search recorded data resources',
      description: 'Searches caller-visible sealed resource snapshots by text, paper, type and access conditions. Returns evidence, separate latest checks, duplicate candidates, relationship diagnostics and explicit coverage. Empty results describe this workspace only.',
      audiences: ['ui', 'agent', 'system'], scope: 'workspace', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, tags: ['knowledge-net', 'resource', 'data', 'search'],
      inputSchema: resourceSearchInputSchema, outputSchema: resourceSearchResultSchema,
      handler: async (input: ResourceSearchInput, context: Context) => {
        const workspace = requireWorkspace(context, 'resource search')
        await assertCurrent(context)
        const state = await deriveState(workspace, context.signal)
        const output = searchResources(state.resources, resourceSearchInputSchema.parse(input), state.provenance)
        await assertCurrent(context)
        return { output }
      }
    })
  ]
}
