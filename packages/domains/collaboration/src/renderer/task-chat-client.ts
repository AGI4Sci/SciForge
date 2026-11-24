import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { TASK_CHAT_READ, taskChatReadInputSchema, taskChatReadResultSchema, type TaskChatReadInput } from '../chat-association-contract.js'
export function createTaskChatClient(invoker: DomainRendererCapabilityInvoker) {
  return (input: TaskChatReadInput) => invoker.invoke({ actionId: TASK_CHAT_READ, effect: 'read', inputSchema: taskChatReadInputSchema, outputSchema: taskChatReadResultSchema }, input)
}
