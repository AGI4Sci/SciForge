import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createArtifactVersionCommitPortV1 } from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { domainPackageDefinition } from './definition.js'
import { REVIEW_CONTROL_CAPABILITY_IDS, reviewReceiptCommitInputSchema, reviewReceiptCommitResultSchema } from './contract.js'

type Context = {
  caller: { workspaceId?: string }
  signal?: AbortSignal
  assertPrincipalCurrent?: () => void | Promise<void>
}

function requireWorkspace(context: Context): string {
  const workspace = context.caller.workspaceId?.trim()
  if (!workspace) throw new Error('Review control requires a workspace-scoped caller.')
  return workspace
}

async function assertCurrent(context: Context): Promise<void> {
  context.signal?.throwIfAborted()
  await context.assertPrincipalCurrent?.()
  context.signal?.throwIfAborted()
}

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  return {
    definition: domainPackageDefinition,
    contributions: [{
      kind: 'main.capability-factory', id: 'review-control.capabilities', value: {
        moduleId: domainPackageDefinition.module.id,
        policy: { id: 'review-control', title: 'Review Control', directTransportPrefixes: [], allowedDirectTransports: [] },
        createDefinitions: () => [
          host.defineCapability({
            id: REVIEW_CONTROL_CAPABILITY_IDS.receiptCommit, version: '0.0.0',
            title: 'Seal a review receipt', description: 'Staging content-free receipt commit through Artifact Versions; chain verification pending.',
            audiences: ['system'], scope: 'workspace', effect: 'workspace-write', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'required' }, tags: ['review-control'],
            inputSchema: reviewReceiptCommitInputSchema, outputSchema: reviewReceiptCommitResultSchema,
            handler: async (input: unknown, context: Context) => {
              const workspace = requireWorkspace(context)
              if (!host.capabilities) throw new Error('Review control requires the Artifact Versions capability host.')
              await assertCurrent(context)
              const parsed = reviewReceiptCommitInputSchema.safeParse(input)
              if (!parsed.success) throw new Error('Invalid review receipt submission.')
              const bytes = Buffer.from(JSON.stringify(parsed.data.receipt), 'utf8')
              const committed = await createArtifactVersionCommitPortV1(host.capabilities, workspace).commit({
                idempotencyKey: `review/receipt:${parsed.data.operationId}`,
                candidates: [{
                  candidateId: 'receipt', kind: 'review.receipt', expectedCurrentVersionId: null,
                  label: 'Review receipt', intent: 'save',
                  content: { mode: 'snapshot', dataBase64: bytes.toString('base64'), mediaType: 'application/json' }
                }]
              }).catch(() => { throw new Error('Artifact Versions review receipt commit failed.') })
              if (!committed.ok) throw new Error('Artifact Versions did not commit the review receipt.')
              const item = committed.value.versions[0]
              const digest = createHash('sha256').update(bytes).digest('hex')
              if (committed.value.versions.length !== 1 || !item || item.version.storage.mode !== 'snapshot' || item.version.storage.contentDigest !== digest) {
                throw new Error('Artifact Versions returned an invalid review snapshot.')
              }
              await assertCurrent(context)
              return { output: reviewReceiptCommitResultSchema.parse({
                artifactId: item.artifact.artifactId, versionId: item.version.versionId, contentDigest: digest
              }) }
            }
          }),
          ...[REVIEW_CONTROL_CAPABILITY_IDS.suggest, REVIEW_CONTROL_CAPABILITY_IDS.coverage].map((id) => host.defineCapability({
            id, version: '0.0.0', title: id, description: 'Unavailable staging capability: public read contract pending.',
            audiences: ['system'], scope: 'workspace', effect: 'read', approval: 'none',
            concurrency: { revision: 'none', idempotency: 'none' }, tags: ['review-control'],
            inputSchema: z.never(), outputSchema: z.never(),
            handler: async (_input: unknown, context: Context) => {
              requireWorkspace(context)
              throw new Error('Review control read contract is not defined.')
            }
          }))
        ]
      }
    }]
  }
}
