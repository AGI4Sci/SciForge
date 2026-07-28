import {
  CONTROLLED_PROCESS_CREATE_CONTRACT,
  CONTROLLED_PROCESS_DISPOSE_CONTRACT,
  CONTROLLED_PROCESS_READ_CONTRACT,
  CONTROLLED_PROCESS_RESIZE_CONTRACT,
  CONTROLLED_PROCESS_RESOURCE_KIND,
  CONTROLLED_PROCESS_WRITE_CONTRACT,
  type ControlledProcessReadOutput
} from '@sciforge/domain-sdk/controlled-process'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import { z } from 'zod'

export { TERMINAL_DEFAULT_COLUMNS, TERMINAL_DEFAULT_ROWS } from '../contract'

const controlledProcessObservationContract = Object.freeze({
  resourceKind: CONTROLLED_PROCESS_RESOURCE_KIND,
  stateSchema: z.object({ profile: z.literal('system-shell') }).strict()
})

type TerminalProcessSession = {
  workspaceRoot: string
  resource: DomainCapabilityResourceHandle
  cursor: string
}

export type TerminalProcessAttachment = Readonly<{
  cursor: string
}>

export type TerminalCapabilityClient = Readonly<{
  open(
    sessionId: string,
    workspaceRoot: string,
    dimensions: Readonly<{ columns: number; rows: number }>
  ): Promise<TerminalProcessAttachment>
  read(
    sessionId: string,
    cursor: string,
    options?: Readonly<{ maxCharacters?: number; waitMilliseconds?: number }>
  ): Promise<ControlledProcessReadOutput>
  commitCursor(sessionId: string, previousCursor: string, nextCursor: string): void
  write(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, columns: number, rows: number): Promise<void>
  dispose(sessionId: string, reason?: string): Promise<void>
  disposeAll(reason?: string): Promise<void>
}>

export function createTerminalCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): TerminalCapabilityClient {
  const sessions = new Map<string, TerminalProcessSession>()

  const requireSession = (sessionId: string): TerminalProcessSession => {
    const session = sessions.get(sessionId)
    if (!session) throw new Error('Terminal process session is not open.')
    return session
  }

  const refreshHandleIfNeeded = async (
    session: TerminalProcessSession
  ): Promise<DomainCapabilityResourceHandle> => {
    const expiresAt = Date.parse(session.resource.expiresAt)
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
      return session.resource
    }
    const observed = await invoker.observe(
      controlledProcessObservationContract,
      session.resource,
      { workspaceId: session.workspaceRoot }
    )
    session.resource = observed.resource
    return session.resource
  }

  const dispose = async (sessionId: string, reason?: string): Promise<void> => {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    await invoker.invoke(
      CONTROLLED_PROCESS_DISPOSE_CONTRACT,
      reason ? { reason } : {},
      { workspaceId: session.workspaceRoot, resource: session.resource }
    )
  }

  const client: TerminalCapabilityClient = {
    async open(sessionId, workspaceRoot, dimensions) {
      const normalizedId = sessionId.trim()
      const normalizedRoot = workspaceRoot.trim()
      if (!normalizedId) throw new Error('Terminal session ID is required.')
      if (!normalizedRoot) throw new Error('Terminal requires an active workspace.')
      const existing = sessions.get(normalizedId)
      if (existing) return { cursor: existing.cursor }
      const created = await invoker.invoke(
        CONTROLLED_PROCESS_CREATE_CONTRACT,
        {
          profile: 'system-shell',
          cwd: normalizedRoot,
          terminal: {
            columns: dimensions.columns,
            rows: dimensions.rows
          }
        },
        { workspaceId: normalizedRoot }
      )
      sessions.set(normalizedId, {
        workspaceRoot: normalizedRoot,
        resource: created.resource,
        cursor: created.cursor
      })
      return { cursor: created.cursor }
    },

    async read(sessionId, cursor, options = {}) {
      const session = requireSession(sessionId)
      const resource = await refreshHandleIfNeeded(session)
      return await invoker.invoke(
        CONTROLLED_PROCESS_READ_CONTRACT,
        {
          cursor,
          maxCharacters: options.maxCharacters ?? 64 * 1024,
          waitMilliseconds: options.waitMilliseconds ?? 25_000
        },
        { workspaceId: session.workspaceRoot, resource }
      )
    },

    commitCursor(sessionId, previousCursor, nextCursor) {
      const session = requireSession(sessionId)
      if (session.cursor === previousCursor) session.cursor = nextCursor
    },

    async write(sessionId, data) {
      const session = requireSession(sessionId)
      await invoker.invoke(
        CONTROLLED_PROCESS_WRITE_CONTRACT,
        { data },
        {
          workspaceId: session.workspaceRoot,
          resource: await refreshHandleIfNeeded(session)
        }
      )
    },

    async resize(sessionId, columns, rows) {
      const session = requireSession(sessionId)
      await invoker.invoke(
        CONTROLLED_PROCESS_RESIZE_CONTRACT,
        { columns, rows },
        {
          workspaceId: session.workspaceRoot,
          resource: await refreshHandleIfNeeded(session)
        }
      )
    },

    dispose,

    async disposeAll(reason) {
      await Promise.allSettled(
        [...sessions.keys()].map((sessionId) => dispose(sessionId, reason))
      )
    }
  }
  return Object.freeze(client)
}
