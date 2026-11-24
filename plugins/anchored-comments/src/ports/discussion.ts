import { z } from 'zod'

const resultSchema = z.object({
  state: z.enum(['completed', 'failed', 'cancelled']), text: z.string(), runtimeId: z.string(),
  failure: z.object({ message: z.string() }).passthrough().optional()
}).strict()

export type DiscussionPort = Readonly<{
  run(prompt: string, signal: AbortSignal): Promise<z.infer<typeof resultSchema>>
}>
export type DiscussionClient = Readonly<{
  request(operation: string, input: unknown): {
    result: Promise<unknown>
    cancel(): Promise<unknown>
  }
}>

export function createHostDiscussionPort(client: DiscussionClient): DiscussionPort {
  return { async run(prompt, signal) {
    signal.throwIfAborted()
    const handle = client.request('run', { prompt })
    const cancel = () => { void handle.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (signal.aborted) cancel()
      return resultSchema.parse(await handle.result)
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } }
}
