import { z } from 'zod'

export const AUTHENTICATED_CLOUD_HOST_SERVICE = 'identity-access.authenticated-cloud'
export type CloudHostClient = Readonly<{ invoke(operation: string, input: unknown): Promise<unknown> }>
export const cloudIdentityBindingSchema = z.object({ baseUrl: z.url(), userId: z.string().min(1),
  deviceId: z.string().min(1), deviceRevision: z.number().int().positive(), sessionGeneration: z.string().min(1) }).strict()
export type CloudIdentityBinding = z.infer<typeof cloudIdentityBindingSchema>
const statusSchema = z.object({ ...cloudIdentityBindingSchema.shape, state: z.literal('ready') }).strict()
export type HostCloudTransport = Readonly<{
  status(): Promise<z.infer<typeof statusSchema>>
  execute(input: Readonly<{ contractVersion: 1; operationId: 'sciforge.cloud.command'; payload: unknown; expectedBinding: CloudIdentityBinding }>): Promise<z.infer<typeof responseSchema>>
}>
const responseSchema = z.object({ contractVersion: z.literal(1), status: z.number().int(), body: z.unknown() }).strict()

export function createHostCloudPort(client: CloudHostClient): HostCloudTransport {
  return {
    status: async () => statusSchema.parse(await client.invoke('status', {})),
    execute: async input => {
      const expectedBinding = cloudIdentityBindingSchema.parse(input.expectedBinding)
      return responseSchema.parse(await client.invoke('execute', { ...input, expectedBinding }))
    }
  }
}
