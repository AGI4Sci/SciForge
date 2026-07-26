import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  createProjectDagCapabilityClient,
  projectDagCapabilityContracts
} from './project-dag-capability-client'

test('invokes only the package-owned Project DAG capability contracts', async () => {
  const calls: Array<{
    actionId: string
    input: unknown
    options?: Readonly<{ workspaceId?: string }>
  }> = []
  const invoke: DomainRendererCapabilityInvoker['invoke'] =
    async <TInput, TOutput>(
      contract: { actionId: string },
      input: TInput,
      options?: Readonly<{ workspaceId?: string }>
    ): Promise<TOutput> => {
      calls.push({ actionId: contract.actionId, input, options })
      return {
        ok: false,
        error: {
          code: 'project_not_found',
          message: 'missing',
          retryable: false
        }
      } as TOutput
    }
  const client = createProjectDagCapabilityClient({
    invoke,
    observe: async () => {
      throw new Error('not observed')
    }
  })

  await client.view({ workspaceRoot: '/workspace/view', view: 'home' })
  await client.update({ projectRoot: '/workspace/update', scope: 'all' })
  await client.saveGoal({
    workspaceRoot: '/workspace/goal',
    projectRoot: '/workspace/goal/project',
    title: 'Ship the result'
  })
  await client.resolveEvidencePreview({
    workspaceRoot: '/workspace/preview',
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
    claimId: 'claim-1',
    artifactVersionId: 'artifact-v1',
    sourceAnchorId: 'anchor-1'
  })
  await client.view({ view: 'home' })

  assert.deepEqual(calls.map((call) => call.actionId), [
    'project-dag.view',
    'project-dag.update',
    'project-dag.goal.save',
    'project-dag.evidence-preview.resolve',
    'project-dag.view'
  ])
  assert.deepEqual(calls.map((call) => call.options), [
    { workspaceId: '/workspace/view' },
    { workspaceId: '/workspace/update' },
    { workspaceId: '/workspace/goal' },
    { workspaceId: '/workspace/preview' },
    undefined
  ])
  assert.equal(projectDagCapabilityContracts.view.effect, 'read')
  assert.equal(projectDagCapabilityContracts.update.effect, 'compute')
  assert.equal(projectDagCapabilityContracts.saveGoal.effect, 'compute')
  assert.equal(projectDagCapabilityContracts.resolveEvidencePreview.effect, 'read')
})
