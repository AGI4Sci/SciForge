import type { TaskChatAssociation } from '../../../chat-association-contract.js'

export type TaskChatSegment = Readonly<{ first: TaskChatAssociation; last: TaskChatAssociation; messageCount: number }>

/** Group each private chat independently; explicit end/switch closes its segment. */
export function taskChatSegments(rows: readonly TaskChatAssociation[]): TaskChatSegment[] {
  const segments: TaskChatSegment[] = []
  const latestBySession = new Map<string, number>()
  for (const row of rows) {
    const key = JSON.stringify([row.runtimeId, row.threadId])
    const index = latestBySession.get(key)
    const previous = index === undefined ? undefined : segments[index]
    if (previous && previous.last.taskId === row.taskId && !previous.last.endedAt) {
      segments[index!] = { first: previous.first, last: row, messageCount: previous.messageCount + 1 }
    } else {
      latestBySession.set(key, segments.length)
      segments.push({ first: row, last: row, messageCount: 1 })
    }
  }
  return segments.sort((a, b) => b.last.occurredAt.localeCompare(a.last.occurredAt))
}
