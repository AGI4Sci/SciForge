import { open } from 'node:fs/promises'
import {
  workspacePreviewTextReadRangeSchema,
  type WorkspacePreviewTextReadRange,
  type WorkspacePreviewTextReadResult
} from '@sciforge/domain-sdk/workspace-preview'

/** Bounded UTF-8 source read shared by local and placed preview sessions. */
export async function readWorkspacePreviewTextRange(
  path: string,
  sessionId: string,
  input: WorkspacePreviewTextReadRange
): Promise<WorkspacePreviewTextReadResult> {
  const range = workspacePreviewTextReadRangeSchema.parse(input)
  const handle = await open(path, 'r')
  const before = await handle.stat()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let line = 1
  let column = 1
  let found = false
  let truncated = false
  let text = ''
  let scannedBytes = 0
  const consume = (chunk: string): boolean => {
    if (chunk.includes('\0')) throw new Error('The preview asset is not UTF-8 source text.')
    for (const character of chunk) {
      if (line === range.start.line && column === range.start.column) found = true
      if (!found && (line > range.start.line || (line === range.start.line && column > range.start.column))) {
        throw new Error('Text start is outside the source or splits a Unicode character.')
      }
      if (found) {
        if (text.length + character.length > range.maxCharacters) {
          truncated = true
          return false
        }
        text += character
      }
      if (character === '\n') { line += 1; column = 1 }
      else column += character.length
    }
    return true
  }
  try {
    // Keep memory bounded even when seeking a late line or reading a huge line.
    const buffer = Buffer.alloc(16_384)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, scannedBytes)
      if (!bytesRead) { consume(decoder.decode()); break }
      scannedBytes += bytesRead
      if (scannedBytes > 32 * 1024 * 1024) throw new Error('Text range exceeds the 32 MiB source scan limit.')
      if (!consume(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }))) break
    }
    if (!found && (line !== range.start.line || column !== range.start.column)) {
      throw new Error('Text start is outside the source.')
    }
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Preview source changed while reading; observe it again before editing.')
    }
    const end = { line, column }
    return { ok: true, sessionId, text, start: range.start, end, truncated,
      ...(truncated ? { nextStart: end } : {}) }
  } finally {
    await handle.close()
  }
}
