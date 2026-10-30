import type { Readable, Writable } from 'node:stream'

import { WORKSPACE_HOST_LIMITS } from '@sciforge/domain-sdk/workspace-host'

const MAX_FRAME_BYTES = WORKSPACE_HOST_LIMITS.maxPayloadBytes + 64 * 1024

export class WorkspaceHostProtocolError extends Error {
  readonly code: 'invalid-frame' | 'frame-too-large' | 'transport-closed'

  constructor(
    code: WorkspaceHostProtocolError['code'],
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceHostProtocolError'
    this.code = code
  }
}

export async function* readWorkspaceHostJsonLines(
  input: Readable
): AsyncGenerator<unknown> {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(String(rawChunk), 'utf8')
    buffered = buffered.length === 0
      ? chunk
      : Buffer.concat([buffered, chunk], buffered.length + chunk.length)
    if (buffered.byteLength > MAX_FRAME_BYTES && !buffered.includes(0x0a)) {
      throw new WorkspaceHostProtocolError(
        'frame-too-large',
        `Workspace Host frame exceeds ${MAX_FRAME_BYTES} bytes.`
      )
    }
    let newline = buffered.indexOf(0x0a)
    while (newline >= 0) {
      const line = buffered.subarray(0, newline)
      buffered = buffered.subarray(newline + 1)
      if (line.byteLength > MAX_FRAME_BYTES) {
        throw new WorkspaceHostProtocolError(
          'frame-too-large',
          `Workspace Host frame exceeds ${MAX_FRAME_BYTES} bytes.`
        )
      }
      if (line.byteLength > 0) yield parseJsonLine(line)
      newline = buffered.indexOf(0x0a)
    }
  }
  if (buffered.byteLength > 0) yield parseJsonLine(buffered)
}

export class WorkspaceHostJsonLineWriter {
  readonly #output: Writable
  #pending: Promise<void> = Promise.resolve()
  #closed = false

  constructor(output: Writable) {
    this.#output = output
  }

  write(value: unknown): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new WorkspaceHostProtocolError(
        'transport-closed',
        'Workspace Host transport is closed.'
      ))
    }
    let frame: Buffer
    try {
      frame = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    } catch (error) {
      return Promise.reject(new WorkspaceHostProtocolError(
        'invalid-frame',
        `Workspace Host frame is not JSON serializable: ${errorMessage(error)}`
      ))
    }
    if (frame.byteLength > MAX_FRAME_BYTES + 1) {
      return Promise.reject(new WorkspaceHostProtocolError(
        'frame-too-large',
        `Workspace Host frame exceeds ${MAX_FRAME_BYTES} bytes.`
      ))
    }
    const write = this.#pending.then(() => writeBuffer(this.#output, frame))
    this.#pending = write.catch(() => undefined)
    return write
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#pending
    if (this.#output.destroyed || this.#output.writableEnded) return
    await new Promise<void>((resolveClose, rejectClose) => {
      this.#output.end((error?: Error | null) => error ? rejectClose(error) : resolveClose())
    })
  }
}

function parseJsonLine(line: Buffer): unknown {
  try {
    return JSON.parse(line.toString('utf8')) as unknown
  } catch {
    throw new WorkspaceHostProtocolError(
      'invalid-frame',
      'Workspace Host transport received malformed JSON.'
    )
  }
}

async function writeBuffer(output: Writable, frame: Buffer): Promise<void> {
  if (output.destroyed || output.writableEnded) {
    throw new WorkspaceHostProtocolError(
      'transport-closed',
      'Workspace Host transport is closed.'
    )
  }
  await new Promise<void>((resolveWrite, rejectWrite) => {
    output.write(frame, (error?: Error | null) => error ? rejectWrite(error) : resolveWrite())
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
