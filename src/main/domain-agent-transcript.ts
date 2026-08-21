import type {
  DomainAgentTranscriptMessage,
  DomainAgentTranscriptMessageEvent
} from '@sciforge/domain-sdk/host'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import type { AgentRuntimeEventSubscribeInput } from './runtime/agent-runtime/adapter'
import {
  isAgentRuntimeTerminalTurnState,
  type AgentRuntimeId,
  type AgentRuntimeTurn
} from '../shared/agent-runtime-contract'

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
  const bufferedAssistantByTurn = new Map<string, Readonly<{
    itemId: string
    text: string
    sequence: number
    occurredAt?: string
  }>>()
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
    if (event.kind === 'item_snapshot' && event.item.kind === 'assistant_message') {
      const turnId = event.turnId?.trim() || event.item.turnId?.trim()
      const text = event.item.text?.trim() || event.item.summary?.trim()
      if (!turnId || !text || seenItemIds.has(event.item.id)) continue
      const buffered = bufferedAssistantByTurn.get(turnId)
      if (buffered && buffered.itemId !== event.item.id) {
        seenItemIds.add(buffered.itemId)
        yield Object.freeze({
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          turnId,
          sequence: buffered.sequence,
          itemId: buffered.itemId,
          kind: 'assistant-progress',
          text: buffered.text,
          ...(buffered.occurredAt ? { occurredAt: buffered.occurredAt } : {})
        })
      }
      bufferedAssistantByTurn.set(turnId, Object.freeze({
        itemId: event.item.id,
        text,
        sequence: sequence!,
        ...(event.item.createdAt ? { occurredAt: event.item.createdAt } : {})
      }))
      continue
    }
    if (
      event.kind !== 'turn_lifecycle' ||
      !event.turnId
    ) continue
    if (event.state !== 'completed' && event.state !== 'success') {
      if (isAgentRuntimeTerminalTurnState(event.state)) {
        bufferedAssistantByTurn.delete(event.turnId)
      }
      continue
    }
    const detail = await host.readThreadSnapshot({
      runtimeId,
      threadId: input.threadId
    })
    const turn = detail.turns.find((candidate) => candidate.id === event.turnId)
    const assistantMessages = turn
      ? projectDomainAgentTurnMessages(turn).filter((message) => message.kind !== 'user-message')
      : []
    const buffered = bufferedAssistantByTurn.get(event.turnId)
    bufferedAssistantByTurn.delete(event.turnId)
    for (const message of assistantMessages) {
      if (seenItemIds.has(message.itemId)) continue
      seenItemIds.add(message.itemId)
      yield Object.freeze({
        ...message,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        sequence: buffered?.itemId === message.itemId ? buffered.sequence : sequence!
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
