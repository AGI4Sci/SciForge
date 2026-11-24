import { z } from 'zod'

const id = z.string().trim().min(1).max(512)
export const TASK_CHAT_READ = 'collaboration.task.chat.read'
export const taskChatReadInputSchema = z.object({
  runtimeId: id.optional(), threadId: id.optional(), taskId: id.optional()
}).strict()
export const taskChatAssociationSchema = z.object({
  userId: id, projectId: id, taskId: id, runtimeId: id, threadId: id,
  turnId: id.optional(), clientDirectiveId: id.optional(), messageId: id, occurredAt: z.string(),
  endedAt: z.string().optional(), endMessageId: id.optional(),
}).strict()
export const taskChatReadResultSchema = z.object({
  associations: z.array(taskChatAssociationSchema),
  activeTaskId: id.nullable(), detached: z.boolean().optional()
}).strict()
export type TaskChatReadInput = z.infer<typeof taskChatReadInputSchema>
export type TaskChatAssociation = z.infer<typeof taskChatAssociationSchema>
export const TASK_CHAT_END = '[结束任务关联]'
export function referencedTaskIds(text: string): string[] {
  return [...new Set(text.match(/\btsk_[A-Za-z0-9]{12,64}\b/gu) ?? [])]
}
