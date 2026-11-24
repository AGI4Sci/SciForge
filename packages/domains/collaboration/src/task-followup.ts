import { z } from 'zod'
import { cloudResourceRefSchema } from '@sciforge/collaboration-contracts'

export const workerFollowupRequestSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
  at: z.iso.datetime({ offset: true }),
  about: z.string().trim().min(1).max(2_000)
}).strict()

export const workerFollowupSchema = workerFollowupRequestSchema.extend({
  id: z.string().min(1),
  sourceInvocationId: z.string().min(1),
  sourceTurnId: z.string().min(1),
  runtimeId: z.string().min(1),
  threadId: z.string().min(1),
  contractDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  inputResources: z.array(cloudResourceRefSchema).max(101),
  createdAt: z.iso.datetime({ offset: true }),
  state: z.enum(['waiting', 'dispatching', 'completed', 'cancelled', 'unknown']),
  reason: z.string().max(2_000).nullable()
}).strict()

export type WorkerFollowup = z.infer<typeof workerFollowupSchema>

export const workerFollowupViewSchema = workerFollowupSchema.pick({
  key: true, at: true, about: true, state: true, reason: true
})

export function workerFollowupView(record: WorkerFollowup | undefined, latest?: { logicalInvocationId: string; followupId?: string }): z.infer<typeof workerFollowupViewSchema> | undefined {
  if (!record) return undefined
  if (latest && latest.logicalInvocationId !== record.sourceInvocationId && latest.followupId !== record.id) return undefined
  const { key, at, about, state, reason } = record
  return { key, at, about, state, reason }
}

/** One bounded revisit, not a perpetual polling loop or authority to start a job. */
export function validateWorkerFollowupTime(at: string, now: Date): void {
  const delay = Date.parse(at) - now.getTime()
  if (!Number.isFinite(delay) || delay < 60_000 || delay > 7 * 24 * 60 * 60_000) {
    throw new Error('复查时间须在一分钟至七天内；需要本人恢复的阻塞请改为提问。')
  }
}
