import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  authenticatedCloudResponseSchema,
  type AuthenticatedCloudTransport
} from '../authenticated-cloud-transport.js'
import {
  AUTHENTICATED_CLOUD_CAPABILITY_IDS,
  cloudHostStatusInputSchema,
  cloudHostReadInputSchema,
  cloudHostWriteInputSchema,
  cloudHostStatusSchema,
  cloudHostResponseSchema
} from '../cloud-host-contract.js'

type Context = Readonly<{
  caller: Readonly<{ principal?: PrincipalSnapshot }>
  signal: AbortSignal
  assertPrincipalCurrent(): void
}>

export function createCloudHostCapabilityDefinitions<T>(options: Readonly<{
  defineCapability: (options: any) => T
  transport: AuthenticatedCloudTransport
  status: () => unknown
}>): readonly T[] {
  const fence = (context: Context) => {
    if (!context.signal || !context.assertPrincipalCurrent) throw new Error('Cloud Host capability requires a live principal lease and signal.')
    context.signal.throwIfAborted()
    context.assertPrincipalCurrent()
    const principal = context.caller.principal
    const status = cloudHostStatusSchema.parse(options.status())
    if (!principal || principal.authority !== 'sciforge-cloud' || principal.assurance !== 'cloud-authenticated' ||
      status.state !== 'ready' || principal.subject !== status.userId || principal.deviceId !== status.deviceId) {
      throw new Error('Cloud Host service requires the current Cloud principal and enrolled device.')
    }
    return status
  }
  return [
    { id: AUTHENTICATED_CLOUD_CAPABILITY_IDS.status, effect: 'read', inputSchema: cloudHostStatusInputSchema, outputSchema: cloudHostStatusSchema,
      handler: (_input: unknown, context: Context) => ({ output: fence(context) }) },
    ...([
      { id: AUTHENTICATED_CLOUD_CAPABILITY_IDS.read, effect: 'read', inputSchema: cloudHostReadInputSchema },
      { id: AUTHENTICATED_CLOUD_CAPABILITY_IDS.write, effect: 'external-write', inputSchema: cloudHostWriteInputSchema }
    ] as const).map((lane) => ({ ...lane, outputSchema: cloudHostResponseSchema,
      handler: async (rawInput: unknown, context: Context) => {
        const input = lane.inputSchema.parse(rawInput)
        const before = fence(context)
        const { expectedBinding, ...request } = input
        const { state: _state, ...binding } = before
        if (JSON.stringify(binding) !== JSON.stringify(expectedBinding)) throw new Error('Cloud Host expected identity binding changed.')
        const output = authenticatedCloudResponseSchema.parse(await options.transport.execute(request, { signal: context.signal, expectedBinding }))
        const after = fence(context)
        if (before.baseUrl !== after.baseUrl || before.deviceRevision !== after.deviceRevision || before.sessionGeneration !== after.sessionGeneration) throw new Error('Cloud transport binding changed during execution.')
        return { output }
      } }))
  ].map((lane) => options.defineCapability({
    ...lane, version: '1.0.0', title: lane.id,
    description: 'Executes an admitted authenticated Cloud Host operation under the captured principal.',
    audiences: ['ui', 'agent', 'system'], scope: 'global', approval: lane.effect === 'external-write' ? 'confirmation' : 'none',
    concurrency: { revision: 'none', idempotency: lane.effect === 'external-write' ? 'required' : 'none' }, tags: ['identity-access', 'cloud']
  }))
}
