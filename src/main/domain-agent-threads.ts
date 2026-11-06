import type { DomainAgentThread, DomainAgentThreadTurn, DomainMainAgentThreadsHost } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeId, AgentRuntimeThread, AgentRuntimeTurn } from '../shared/agent-runtime-contract'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import { canonicalWorkspacePath } from './extensions/workspace-authority'
import { domainAgentExecutionFailure } from './domain-agent-execution'
import { projectDomainAgentTurnMessages, subscribeDomainAgentTranscriptMessages } from './domain-agent-transcript'

type Runtime = Pick<AgentRuntimeHost, 'listThreads' | 'readThreadMetadata' | 'readThreadSnapshot' | 'readThreadPage' | 'subscribeEvents' | 'hasActiveTurns'>

function identity(input: { runtimeId: string; threadId: string }) {
  for (const value of [input.runtimeId, input.threadId]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Invalid runtime history identity.')
  }
  return { runtimeId: input.runtimeId as AgentRuntimeId, threadId: input.threadId }
}

function metadata(thread: AgentRuntimeThread): DomainAgentThread {
  return Object.freeze({ id: thread.id, runtimeId: thread.runtimeId,
    ...(thread.workspace?.trim() ? { workspaceRoot: thread.workspace.trim() } : {}),
    ...(thread.archived === undefined ? {} : { archived: thread.archived }) })
}

function projectTurn(turn: AgentRuntimeTurn): DomainAgentThreadTurn {
  // These are public transcript projections. Context boundaries carry no opaque
  // provider compaction payload or hidden reasoning into domain consumers.
  const items = (turn.items ?? []).filter(item => item.kind !== 'reasoning').map(item => item.kind === 'compaction'
    ? { id: item.id, kind: item.kind, ...(item.turnId ? { turnId: item.turnId } : {}),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}), ...(item.status ? { status: item.status } : {}) }
    : item)
  return Object.freeze({ id: turn.id, status: turn.status,
    ...(turn.status === 'failed' || turn.status === 'cancelled'
      ? { failure: domainAgentExecutionFailure(turn.status, turn.items ?? []) ?? undefined } : {}),
    ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
    messages: projectDomainAgentTurnMessages(turn), artifacts: Object.freeze(items) })
}

function assertScope(thread: DomainAgentThread, input: { runtimeId: string; threadId: string; workspaceRoot: string }) {
  const expected = canonicalWorkspacePath(input.workspaceRoot)
  const actual = thread.workspaceRoot && canonicalWorkspacePath(thread.workspaceRoot)
  if (!expected || !actual || expected !== actual || thread.id !== input.threadId || thread.runtimeId !== input.runtimeId) {
    throw new Error('Runtime history does not belong to the requested workspace and session.')
  }
}

/** The same generic adapter serves installed domains and plugin Host readers. */
export function createDomainAgentThreadsHost(host: Runtime): DomainMainAgentThreadsHost {
  const readMetadata: NonNullable<DomainMainAgentThreadsHost['readMetadata']> = async input => {
    const scope = identity(input), thread = metadata(await host.readThreadMetadata(scope))
    if (thread.id !== scope.threadId || thread.runtimeId !== scope.runtimeId) throw new Error('Runtime returned a different thread identity.')
    return thread
  }
  return Object.freeze({
    list: async (input = {}) => Object.freeze((await host.listThreads(input as Parameters<Runtime['listThreads']>[0])).map(metadata)),
    readMetadata,
    read: async input => {
      const detail = await host.readThreadSnapshot(identity(input))
      if (detail.id !== input.threadId || detail.runtimeId !== input.runtimeId) throw new Error('Runtime returned a different thread identity.')
      const turns = Object.freeze(detail.turns.map(projectTurn))
      return Object.freeze({ ...metadata(detail), watermark: String(detail.latestSeq), turns, artifacts: Object.freeze(turns.flatMap(turn => turn.artifacts)) })
    },
    readPage: async input => {
      const scope = identity(input), limit = input.limit ?? 100
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('History page limit must be an integer from 1 to 100.')
      if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 4096)) throw new Error('Invalid history cursor.')
      assertScope(await readMetadata(scope), input)
      const page = await host.readThreadPage({ ...scope, ...(input.cursor ? { cursor: input.cursor } : {}), limit })
      if (page.runtimeId !== scope.runtimeId || page.threadId !== scope.threadId) throw new Error('Runtime returned a different history identity.')
      if (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 4096 || page.nextCursor === input.cursor)) throw new Error('Invalid or repeated runtime history cursor.')
      const current = await readMetadata(scope)
      assertScope(current, input)
      const turns = Object.freeze(page.turns.map(projectTurn))
      return Object.freeze({ ...current, watermark: String(page.latestSeq), nextCursor: page.nextCursor, turns, artifacts: Object.freeze(turns.flatMap(turn => turn.artifacts)) })
    },
    subscribeMessages: input => subscribeDomainAgentTranscriptMessages(host, input),
    hasActiveTurns: () => host.hasActiveTurns()
  })
}
