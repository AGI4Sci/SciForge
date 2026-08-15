import { createHash } from 'node:crypto'

export const RESEARCH_CHECKPOINT_PATCH_LIMITS = Object.freeze({
  maxPatchBytes: 4 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxReceiptsPerPath: 1_024,
  maxHunksPerPatch: 10_000,
  maxLinesPerPatch: 200_000
})

export type StrictFilePatchReceipt = Readonly<{
  callId: string
  executorSequence: number
  path: string
  operation: 'add' | 'update' | 'delete'
  patchFormat: 'full-content' | 'unified-hunks'
  patchText: string
  patchDigest: string
}>

export type ReplayedFilePatch = Readonly<{
  path: string
  bytes: Uint8Array | null
  lastOperation: StrictFilePatchReceipt['operation']
}>

type ContentLine = Readonly<{
  text: string
  newline: boolean
}>

type PatchLine = Readonly<{
  kind: 'context' | 'remove' | 'add'
  text: string
  oldNewline: boolean
  newNewline: boolean
}>

type PatchHunk = Readonly<{
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: readonly PatchLine[]
}>

/**
 * Replays one path's authenticated executor patches without consulting the
 * live workspace. The caller supplies exact prior Artifact bytes, or null when
 * the workspace-level output identity has no current Version.
 */
export function replayUnifiedFilePatchChain(input: Readonly<{
  path: string
  initialBytes: Uint8Array | null
  receipts: readonly StrictFilePatchReceipt[]
}>): ReplayedFilePatch {
  if (!portableRelativePath(input.path)) throw patchError('Patch path is not a portable workspace-relative path.')
  if (input.receipts.length === 0 || input.receipts.length > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxReceiptsPerPath) {
    throw patchError('Patch receipt chain length is outside the supported bound.')
  }
  let bytes = input.initialBytes ? boundedBytes(input.initialBytes, 'Prior Artifact') : null
  let previous: StrictFilePatchReceipt | undefined
  for (const receipt of input.receipts) {
    validateReceipt(receipt, input.path, previous)
    if (receipt.operation === 'add' && bytes !== null) {
      throw patchError('An add patch requires the output path to have no prior Artifact current.')
    }
    if ((receipt.operation === 'update' || receipt.operation === 'delete') && bytes === null) {
      throw patchError(`${receipt.operation} patch requires an exact prior Artifact Version.`)
    }
    const source = bytes ?? new Uint8Array()
    const applied = receipt.patchFormat === 'full-content'
      ? decodeUtf8(Buffer.from(receipt.patchText, 'utf8'), 'Complete added file')
      : applyHunks(decodeUtf8(source, 'Prior Artifact'), parseUnifiedHunks(receipt.patchText))
    const next = Buffer.from(applied, 'utf8')
    if (next.byteLength > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxOutputBytes) {
      throw patchError('Patched output exceeds the supported snapshot bound.')
    }
    if (receipt.operation === 'delete') {
      if (next.byteLength !== 0) throw patchError('A delete patch must remove the complete prior file.')
      bytes = null
    } else {
      bytes = new Uint8Array(next)
    }
    previous = receipt
  }
  return Object.freeze({
    path: input.path,
    bytes,
    lastOperation: input.receipts[input.receipts.length - 1]!.operation
  })
}

function validateReceipt(
  receipt: StrictFilePatchReceipt,
  path: string,
  previous?: StrictFilePatchReceipt
): void {
  if (receipt.path !== path) throw patchError('Patch receipt path changed within one output chain.')
  if (
    (receipt.operation === 'add' && receipt.patchFormat !== 'full-content') ||
    (receipt.operation !== 'add' && receipt.patchFormat !== 'unified-hunks')
  ) throw patchError('Patch format does not match its executor operation.')
  if (!receipt.callId.trim() || receipt.callId.length > 512) throw patchError('Patch receipt call identity is invalid.')
  if (!Number.isSafeInteger(receipt.executorSequence) || receipt.executorSequence <= 0) {
    throw patchError('Patch executor sequence is invalid.')
  }
  if (previous && (
    receipt.executorSequence < previous.executorSequence ||
    (
      receipt.executorSequence === previous.executorSequence &&
      receipt.callId.localeCompare(previous.callId) <= 0
    )
  )) throw patchError('Patch receipts are duplicated or not in authoritative executor order.')
  const patchBytes = Buffer.from(receipt.patchText, 'utf8')
  if (
    (receipt.operation !== 'add' && patchBytes.byteLength === 0) ||
    patchBytes.byteLength > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxPatchBytes
  ) {
    throw patchError('Patch text is empty for a hunk operation or exceeds the supported bound.')
  }
  if (receipt.patchText.includes('\0')) throw patchError('Patch text contains a NUL byte.')
  if (!/^[a-f0-9]{64}$/u.test(receipt.patchDigest) || sha256(patchBytes) !== receipt.patchDigest) {
    throw patchError('Patch text does not match its Host-authenticated digest.')
  }
}

function parseUnifiedHunks(text: string): readonly PatchHunk[] {
  const rawLines = splitPatchText(text)
  if (rawLines.length > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxLinesPerPatch) {
    throw patchError('Patch line count exceeds the supported bound.')
  }
  let cursor = 0
  const hunks: PatchHunk[] = []
  while (cursor < rawLines.length) {
    if (rawLines[cursor] === '') {
      cursor += 1
      continue
    }
    const header = parseHunkHeader(rawLines[cursor]!)
    cursor += 1
    const lines: Array<{
      kind: PatchLine['kind']
      text: string
      oldNewline: boolean
      newNewline: boolean
    }> = []
    while (cursor < rawLines.length && !rawLines[cursor]!.startsWith('@@ ')) {
      const raw = rawLines[cursor]!
      if (raw === '\\ No newline at end of file') {
        const prior = lines[lines.length - 1]
        if (!prior) throw patchError('No-newline marker is misplaced or duplicated.')
        if (prior.kind !== 'add') {
          if (!prior.oldNewline) throw patchError('No-newline marker is misplaced or duplicated.')
          prior.oldNewline = false
        }
        if (prior.kind !== 'remove') {
          if (!prior.newNewline) throw patchError('No-newline marker is misplaced or duplicated.')
          prior.newNewline = false
        }
        cursor += 1
        continue
      }
      const prefix = raw[0]
      if (prefix !== ' ' && prefix !== '-' && prefix !== '+') {
        throw patchError('Patch hunk contains an unsupported line.')
      }
      lines.push({
        kind: prefix === ' ' ? 'context' : prefix === '-' ? 'remove' : 'add',
        text: raw.slice(1),
        oldNewline: true,
        newNewline: true
      })
      cursor += 1
    }
    const oldCount = lines.filter((line) => line.kind !== 'add').length
    const newCount = lines.filter((line) => line.kind !== 'remove').length
    if (oldCount !== header.oldCount || newCount !== header.newCount) {
      throw patchError('Patch hunk line counts do not match its header.')
    }
    hunks.push({ ...header, lines })
    if (hunks.length > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxHunksPerPatch) {
      throw patchError('Patch hunk count exceeds the supported bound.')
    }
  }
  if (hunks.length === 0) throw patchError('Patch contains no hunks.')
  return hunks
}

function applyHunks(source: string, hunks: readonly PatchHunk[]): string {
  const original = splitContent(source)
  const output: ContentLine[] = []
  let sourceCursor = 0
  for (const hunk of hunks) {
    const hunkIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (hunkIndex < sourceCursor || hunkIndex < 0 || hunkIndex > original.length) {
      throw patchError('Patch hunks overlap or address a line outside the exact prior Version.')
    }
    output.push(...original.slice(sourceCursor, hunkIndex))
    const expectedNewStart = hunk.newCount === 0 ? output.length : output.length + 1
    if (hunk.newStart !== expectedNewStart) {
      throw patchError('Patch new-file coordinates are inconsistent with preceding hunks.')
    }
    sourceCursor = hunkIndex
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        output.push({ text: line.text, newline: line.newNewline })
        continue
      }
      const actual = original[sourceCursor]
      if (!actual || actual.text !== line.text || actual.newline !== line.oldNewline) {
        throw patchError('Patch context does not exactly match the prior Artifact Version.')
      }
      sourceCursor += 1
      if (line.kind === 'context') output.push({ text: actual.text, newline: line.newNewline })
    }
  }
  output.push(...original.slice(sourceCursor))
  if (output.slice(0, -1).some((line) => !line.newline)) {
    throw patchError('No-newline marker may only identify the final output line.')
  }
  return output.map((line) => `${line.text}${line.newline ? '\n' : ''}`).join('')
}

function parseHunkHeader(value: string): Omit<PatchHunk, 'lines'> {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(value)
  if (!match) throw patchError('Patch hunk header is malformed.')
  const oldStart = Number(match[1])
  const oldCount = match[2] === undefined ? 1 : Number(match[2])
  const newStart = Number(match[3])
  const newCount = match[4] === undefined ? 1 : Number(match[4])
  if (![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger)) {
    throw patchError('Patch hunk coordinates exceed the supported integer range.')
  }
  if ((oldCount > 0 && oldStart < 1) || (oldCount === 0 && oldStart < 0)) {
    throw patchError('Patch old-file coordinates are invalid.')
  }
  if ((newCount > 0 && newStart < 1) || (newCount === 0 && newStart < 0)) {
    throw patchError('Patch new-file coordinates are invalid.')
  }
  return { oldStart, oldCount, newStart, newCount }
}

function splitPatchText(value: string): string[] {
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function splitContent(value: string): ContentLine[] {
  if (!value) return []
  const values = value.split('\n')
  const hasFinalNewline = values.at(-1) === ''
  if (hasFinalNewline) values.pop()
  return values.map((text, index) => ({
    text,
    newline: index < values.length - 1 || hasFinalNewline
  }))
}

function portableRelativePath(value: string): boolean {
  return Boolean(value) &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.includes('\0') &&
    !value.split(/[\\/]/u).some((part) => !part || part === '.' || part === '..')
}

function decodeUtf8(value: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw patchError(`${label} is not strict UTF-8 text and cannot accept a unified diff.`)
  }
}

function boundedBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength > RESEARCH_CHECKPOINT_PATCH_LIMITS.maxOutputBytes) {
    throw patchError(`${label} exceeds the supported patch base bound.`)
  }
  return new Uint8Array(value)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function patchError(message: string): Error {
  const error = new Error(message)
  error.name = 'StrictUnifiedPatchError'
  return error
}
