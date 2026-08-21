import type {
  DomainAgentTranscriptMessage,
  DomainAgentTranscriptMessageEvent
} from '@sciforge/domain-sdk/host'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import type { AgentRuntimeEventSubscribeInput } from './runtime/agent-runtime/adapter'
import type { AgentRuntimeId, AgentRuntimeTurn } from '../shared/agent-runtime-contract'

export function projectDomainAgentTurnMessages(
  turn: AgentRuntimeTurn
): readonly DomainAgentTranscriptMessage[] {
  const messages: DomainAgentTranscriptMessage[] = []
  const seenUserItems = new Set<string>()
  for (const item of turn.items ?? []) {
    if (item.kind !== 'user_message' || seenUserItems.has(item.id)) continue
    const text = item.text?.trim()
    if (!text) continue
    seenUserItems.add(item.id)
    messages.push(Object.freeze({
      itemId: item.id,
      turnId: turn.id,
      kind: 'user-message',
      text,
      ...(item.createdAt ? { occurredAt: item.createdAt } : {})
    }))
  }
  if (turn.status === 'completed' || turn.status === 'success') {
    const assistantItems = (turn.items ?? []).filter((item) =>
      item.kind === 'assistant_message' && Boolean(item.text?.trim() || item.summary?.trim())
    )
    const finalIndex = assistantItems.length - 1
    for (const [index, item] of assistantItems.entries()) {
      messages.push(Object.freeze({
        itemId: item.id,
        turnId: turn.id,
        kind: index === finalIndex ? 'assistant-final' : 'assistant-progress',
        text: item.text?.trim() || item.summary?.trim() || '',
        ...(item.createdAt ? { occurredAt: item.createdAt } : {})
      }))
    }
  }
  return Object.freeze(messages)
}

export async function* subscribeDomainAgentTranscriptMessages(
  host: Pick<AgentRuntimeHost, 'subscribeEvents' | 'readThreadSnapshot'>,
  input: Readonly<{
    runtimeId: string
    threadId: string
    afterSequence?: number
    signal?: AbortSignal
  }>
): AsyncIterable<DomainAgentTranscriptMessageEvent> {
  const seenItemIds = new Set<string>()
  const runtimeId = requireSupportedRuntimeId(input.runtimeId)
  const sourceInput: AgentRuntimeEventSubscribeInput = {
    runtimeId,
    threadId: input.threadId,
    ...(input.afterSequence === undefined ? {} : { sinceSeq: input.afterSequence }),
    ...(input.signal ? { signal: input.signal } : {})
  }
  for await (const event of host.subscribeEvents(sourceInput)) {
    const sequence = event.seq
    if (!Number.isSafeInteger(sequence) || (sequence ?? -1) < 0) continue
    if (event.kind === 'user_message') {
      const text = event.text.trim()
      if (!text || seenItemIds.has(event.itemId)) continue
      seenItemIds.add(event.itemId)
      yield Object.freeze({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        sequence: sequence!,
        itemId: event.itemId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        kind: 'user-message',
        text,
        ...(event.createdAt ? { occurredAt: event.createdAt } : {})
      })
      continue
    }
    if (
      event.kind !== 'turn_lifecycle' ||
      event.state !== 'completed' ||
      !event.turnId
    ) continue
    const detail = await host.readThreadSnapshot({
      runtimeId,
      threadId: input.threadId
    })
    const turn = detail.turns.find((candidate) => candidate.id === event.turnId)
    const assistantMessages = turn
      ? projectDomainAgentTurnMessages(turn).filter((message) => message.kind !== 'user-message')
      : []
    for (const message of assistantMessages) {
      if (seenItemIds.has(message.itemId)) continue
      seenItemIds.add(message.itemId)
      yield Object.freeze({
        ...message,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        sequence: sequence!
      })
    }
  }
}

function requireSupportedRuntimeId(value: string): AgentRuntimeId {
  if (value !== 'codex' && value !== 'claude') {
    throw new Error(`Unsupported agent runtime: ${value}`)
  }
  return value
}
