import { createHash } from 'node:crypto'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { createDomainMainEntry } from './main.js'

export const receipt = {
  artifactVersion: 'artifact-version:reviewed-v7',
  actorHash: 'sha256:' + 'a'.repeat(64),
  openedAt: '2026-01-01T00:00:00Z',
  submittedAt: '2026-01-01T00:01:00Z',
  verdict: 'accepted' as const
}

export const context = { caller: { workspaceId: '/synthetic-workspace' } }

type Definition = {
  id: string
  effect: string
  approval: string
  scope: string
  audiences: string[]
  handler(input: unknown, context: {
    caller: { workspaceId?: string }
    signal?: AbortSignal
    assertPrincipalCurrent?: () => void | Promise<void>
  }): Promise<{ output: unknown }>
}

export function definitions(capabilities?: DomainMainHost['capabilities']): Definition[] {
  const host = {
    getUserDataDir: () => '',
    defineCapability: (definition: unknown) => definition,
    capabilities
  } as unknown as DomainMainHost
  const factory = createDomainMainEntry(host).contributions[0]!.value as {
    createDefinitions(): Definition[]
  }
  return factory.createDefinitions()
}

export function recordingInvoker() {
  const calls: Array<{ actionId: string; effect: string; input: Record<string, unknown>; options: unknown }> = []
  const invoker = {
    invoke: async (contract: { actionId: string; effect: string }, input: Record<string, unknown>, options: unknown) => {
      calls.push({ actionId: contract.actionId, effect: contract.effect, input, options })
      const candidates = input.candidates as Array<{ content: { dataBase64: string } }>
      const bytes = Buffer.from(candidates[0]!.content.dataBase64, 'base64')
      return { ok: true, value: { versions: [{
        artifact: { artifactId: 'artifact:synthetic-receipt' },
        version: { versionId: 'artifact-version:synthetic-receipt', storage: {
          mode: 'snapshot', contentDigest: createHash('sha256').update(bytes).digest('hex')
        } }
      }] } }
    }
  } as unknown as NonNullable<DomainMainHost['capabilities']>
  return { calls, invoker }
}
