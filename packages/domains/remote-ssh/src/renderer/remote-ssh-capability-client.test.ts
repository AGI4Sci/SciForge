import { describe, expect, it } from 'vitest'
import type {
  DomainRendererCapabilityContract,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  REMOTE_SSH_CAPABILITY_IDS,
  type RemoteSshTargetHandle
} from '../contract'
import {
  createRemoteSshCapabilityClient,
  remoteSshCapabilityContracts
} from './remote-ssh-capability-client'

describe('Remote SSH renderer capability client', () => {
  it('uses public action IDs with governed effects', () => {
    expect(Object.fromEntries(Object.entries(remoteSshCapabilityContracts).map(
      ([key, contract]) => [key, { actionId: contract.actionId, effect: contract.effect }]
    ))).toEqual({
      listLabs: { actionId: REMOTE_SSH_CAPABILITY_IDS.listLabs, effect: 'read' },
      saveLab: { actionId: REMOTE_SSH_CAPABILITY_IDS.saveLab, effect: 'external-write' },
      deleteLab: { actionId: REMOTE_SSH_CAPABILITY_IDS.deleteLab, effect: 'external-write' },
      getLabEnvironment: { actionId: REMOTE_SSH_CAPABILITY_IDS.getLabEnvironment, effect: 'read' },
      ensureLabEnvironment: { actionId: REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment, effect: 'external-write' },
      openLabEnvironmentConsole: { actionId: REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole, effect: 'external-write' },
      stopLabEnvironment: { actionId: REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment, effect: 'external-write' },
      getBinding: { actionId: REMOTE_SSH_CAPABILITY_IDS.getBinding, effect: 'read' },
      saveBinding: { actionId: REMOTE_SSH_CAPABILITY_IDS.saveBinding, effect: 'external-write' },
      listTargetCatalog: { actionId: REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog, effect: 'read' },
      listTargets: { actionId: REMOTE_SSH_CAPABILITY_IDS.listTargets, effect: 'read' },
      probeTarget: { actionId: REMOTE_SSH_CAPABILITY_IDS.probeTarget, effect: 'read' },
      saveTarget: { actionId: REMOTE_SSH_CAPABILITY_IDS.saveTarget, effect: 'external-write' },
      deleteTarget: { actionId: REMOTE_SSH_CAPABILITY_IDS.deleteTarget, effect: 'external-write' },
      executeCommand: { actionId: REMOTE_SSH_CAPABILITY_IDS.executeCommand, effect: 'destructive' },
      cancelCommand: { actionId: REMOTE_SSH_CAPABILITY_IDS.cancelCommand, effect: 'external-write' },
      uploadFile: { actionId: REMOTE_SSH_CAPABILITY_IDS.uploadFile, effect: 'external-write' },
      downloadFile: { actionId: REMOTE_SSH_CAPABILITY_IDS.downloadFile, effect: 'workspace-write' }
    })
  })

  it('passes workspace context, resource handles, and confirmation through the generic invoker', async () => {
    const calls: Array<{ actionId: string; input: unknown; options?: unknown }> = []
    const observations: Array<{ resource: unknown; options?: unknown }> = []
    const invoker: DomainRendererCapabilityInvoker = {
      observe: async (contract, observedResource, options) => {
        observations.push({ resource: observedResource, ...(options ? { options } : {}) })
        const state = contract.stateSchema.parse({
          target: {
            id: 'gpu-a',
            labId: 'lab-a',
            displayName: 'GPU A',
            labels: {},
            capabilities: ['shell'],
            maxConcurrentExecutions: 2
          },
          activeExecutions: 0,
          observedAt: '2026-07-22T00:00:00.000Z'
        })
        return {
          resource: observedResource,
          resourceRef: 'res_1234567890abcdefghij',
          resourceKind: 'remote-ssh-target',
          semanticRevision: 'target-r1',
          observedAt: '2026-07-22T00:00:00.000Z',
          state
        }
      },
      invoke: async <TInput, TOutput>(
        contract: DomainRendererCapabilityContract<TInput, TOutput>,
        input: TInput,
        options?: Parameters<DomainRendererCapabilityInvoker['invoke']>[2]
      ): Promise<TOutput> => {
        calls.push({ actionId: contract.actionId, input, ...(options ? { options } : {}) })
        if (contract.actionId === REMOTE_SSH_CAPABILITY_IDS.getBinding) {
          return { binding: { workspaceId: '/workspace', allowedTargetIds: [] } } as TOutput
        }
        return { targetId: 'gpu-a', target: { status: 'reachable' }, ready: true } as TOutput
      }
    }
    const resource: RemoteSshTargetHandle = {
      token: 'cap_1234567890abcdefghij',
      semanticRevision: 'target-r1',
      expiresAt: '2026-07-23T00:00:00.000Z'
    }
    const client = createRemoteSshCapabilityClient(invoker)
    const confirmation = { approval: { mode: 'confirmation' as const } }

    await client.ensureLabEnvironment('lab-a', 'lab-r1', confirmation)
    await client.openLabEnvironmentConsole('lab-a', 'lab-r1', confirmation)
    await client.stopLabEnvironment('lab-a', 'lab-r1', confirmation)
    await client.listTargetCatalog()
    await client.listTargets('/workspace')
    await client.getBinding('/workspace')
    await client.probeTarget(resource, '/workspace')
    await client.executeCommand(resource, {
      executionId: 'ssh_exec_1234567890abcdef',
      script: 'true'
    }, '/workspace', confirmation)
    await client.uploadFile(resource, {
      transferId: 'ssh_xfer_1234567890abcdef',
      localPath: 'input.txt',
      remotePath: '/remote/input.txt'
    }, '/workspace', confirmation)
    await client.downloadFile(resource, {
      transferId: 'ssh_xfer_fedcba0987654321',
      localPath: 'output.txt',
      remotePath: '/remote/output.txt'
    }, '/workspace', confirmation)
    const observation = await client.observeTarget(resource, '/workspace')
    expect(observation.state.target.id).toBe('gpu-a')
    expect(observation.resource).toBe(resource)

    expect(calls).toEqual([
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment,
        input: { labId: 'lab-a', expectedRevision: 'lab-r1' },
        options: { approval: { mode: 'confirmation' } }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole,
        input: { labId: 'lab-a', expectedRevision: 'lab-r1' },
        options: { approval: { mode: 'confirmation' } }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment,
        input: { labId: 'lab-a', expectedRevision: 'lab-r1' },
        options: { approval: { mode: 'confirmation' } }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog,
        input: {}
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.listTargets,
        input: {},
        options: { workspaceId: '/workspace' }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.getBinding,
        input: {},
        options: { workspaceId: '/workspace' }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.probeTarget,
        input: {},
        options: { resource, workspaceId: '/workspace' }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.executeCommand,
        input: { executionId: 'ssh_exec_1234567890abcdef', script: 'true' },
        options: {
          approval: { mode: 'confirmation' },
          expectedRevision: resource.semanticRevision,
          resource,
          workspaceId: '/workspace'
        }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.uploadFile,
        input: {
          transferId: 'ssh_xfer_1234567890abcdef',
          localPath: 'input.txt',
          remotePath: '/remote/input.txt'
        },
        options: {
          approval: { mode: 'confirmation' },
          expectedRevision: resource.semanticRevision,
          resource,
          workspaceId: '/workspace'
        }
      },
      {
        actionId: REMOTE_SSH_CAPABILITY_IDS.downloadFile,
        input: {
          transferId: 'ssh_xfer_fedcba0987654321',
          localPath: 'output.txt',
          remotePath: '/remote/output.txt'
        },
        options: {
          approval: { mode: 'confirmation' },
          expectedRevision: resource.semanticRevision,
          resource,
          workspaceId: '/workspace'
        }
      }
    ])
    expect(observations).toEqual([{
      resource,
      options: { workspaceId: '/workspace' }
    }])
  })

  it('keeps aliases in the UI-only catalog schema and rejects them from workspace summaries', () => {
    const fullTarget = {
      schemaVersion: 2,
      id: 'gpu-a',
      labId: 'lab-a',
      displayName: 'GPU A',
      sshAlias: 'lab-a-gpu',
      labels: {},
      capabilities: ['shell'],
      maxConcurrentExecutions: 2,
      revision: 'target-r1',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z'
    }
    const resource = {
      token: 'cap_1234567890abcdefghij',
      semanticRevision: 'target-r1',
      expiresAt: '2026-07-23T00:00:00.000Z'
    }

    expect(remoteSshCapabilityContracts.listTargetCatalog.outputSchema.safeParse({
      targets: [fullTarget]
    }).success).toBe(true)
    expect(remoteSshCapabilityContracts.listTargets.outputSchema.safeParse({
      targets: [{ target: fullTarget, resource }]
    }).success).toBe(false)
  })
})
