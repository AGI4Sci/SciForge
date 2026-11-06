/** Content-free diagnostics for the existing trace path. Counts use UTF-16 code units. */
type RecordValue = Record<string, unknown>
type Protocol = 'chat-completions' | 'responses' | 'unknown'
const MAX_FRAME_CHARS = 262_144
const FINISH_REASONS = new Set(['stop', 'length', 'tool_calls', 'function_call', 'content_filter', 'error'])

export function requestMetrics(body: unknown) {
  const metrics = {
    characterUnit: 'utf16-code-units',
    serializedChars: 0, instructionsChars: 0, messagesChars: 0, inputChars: 0,
    toolsChars: 0, otherFieldsChars: 0, messageCount: 0, toolCount: 0,
    embeddedToolCatalogChars: 0, embeddedToolCount: 0,
    messageCharsByRole: { system: 0, developer: 0, user: 0, assistant: 0, tool: 0, other: 0 },
    compositionAvailable: false,
    countersMayBePartial: false,
    // Zero in one of these fields means unavailable, not an observed empty value.
    unavailableFields: [] as string[],
    measurementFailure: undefined as 'serialization_failed' | 'inspection_failed' | undefined
  }
  const unavailable = new Set<string>()
  const size = (value: unknown, field: string): number => {
    try { return value === undefined ? 0 : JSON.stringify(value)?.length ?? 0 }
    catch {
      unavailable.add(field)
      metrics.measurementFailure = 'serialization_failed'
      return 0
    }
  }
  try {
    const record = object(body)
    metrics.serializedChars = size(body, 'serializedChars')
    metrics.compositionAvailable = record !== undefined
    const { instructions, messages: chat, input, tools, ...other } = record ?? {}
    metrics.instructionsChars = size(instructions, 'instructionsChars')
    metrics.messagesChars = size(chat, 'messagesChars')
    metrics.inputChars = size(input, 'inputChars')
    metrics.toolsChars = size(tools, 'toolsChars')
    metrics.otherFieldsChars = size(other, 'otherFieldsChars')
    const roles = metrics.messageCharsByRole
    const messages = Array.isArray(chat) ? chat : Array.isArray(input) ? input : []
    metrics.messageCount = messages.length
    metrics.toolCount = Array.isArray(tools) ? tools.length : 0
    for (const message of messages) {
      const item = object(message)
      const role = typeof item?.role === 'string' && Object.hasOwn(roles, item.role)
        ? item.role as keyof typeof roles : 'other'
      roles[role] += size(message, `messageCharsByRole.${role}`)
    }
    for (const entry of Array.isArray(input) ? input : []) {
      const item = object(entry)
      if (item?.type !== 'additional_tools' || !Array.isArray(item.tools)) continue
      // This is a subset of inputChars/messageCharsByRole, not an additive category.
      metrics.embeddedToolCatalogChars += size(item.tools, 'embeddedToolCatalogChars')
      const pending: unknown[] = [...item.tools]
      const seen = new WeakSet<object>()
      while (pending.length) {
        const tool = object(pending.pop())
        if (!tool) continue
        if (seen.has(tool)) { unavailable.add('embeddedToolCount'); continue }
        seen.add(tool)
        if (tool.type === 'namespace') {
          if (Array.isArray(tool.tools)) for (const child of tool.tools) pending.push(child)
        } else metrics.embeddedToolCount += 1
      }
    }
  } catch {
    // Diagnostics must not escape a response finish callback or poison capture
    // admission. Never store arbitrary exception text from inspected input.
    unavailable.add('composition')
    metrics.measurementFailure = 'inspection_failed'
  }
  metrics.unavailableFields = [...unavailable]
  metrics.compositionAvailable = metrics.compositionAvailable && unavailable.size === 0
  metrics.countersMayBePartial = !metrics.compositionAvailable
  return metrics
}

export function traceProtocol(value: string): Protocol {
  if (value === 'responses' || /\/responses(?:[/?]|$)/.test(value)) return 'responses'
  if (value === 'chat-completions' || /\/chat\/completions(?:[/?]|$)/.test(value)) return 'chat-completions'
  return 'unknown'
}

export class WireResponseMetrics {
  private readonly decoder = new TextDecoder('utf-8')
  private streaming = false
  private line = ''
  private data = ''
  private eventName = ''
  private skipLf = false
  private droppingLine = false
  private droppingFrame = false
  private json = ''
  private jsonOverflow = false
  private finalized = false
  private bytes = 0
  private chars = 0
  private chunks = 0
  private firstByteAt?: string
  private lastByteAt?: string
  private firstTextAt?: string
  private firstReasoningAt?: string
  private lastOutputAt?: string
  private textChars = 0
  private reasoningChars = 0
  private toolArgumentChars = 0
  private doneSeen = false
  private terminal?: 'completed' | 'failed' | 'incomplete'
  private protocolError = false
  private transportError = false
  private aborted = false
  private status?: number
  private malformedFrames = 0
  private oversizedFrames = 0
  private readonly finishReasons = new Set<string>()

  constructor(readonly protocol: Protocol, streaming = false) {
    this.streaming = streaming
  }

  request(body: unknown): void {
    this.streaming = object(body)?.stream === true
  }

  headers(status: number, headers: Record<string, unknown>): void {
    this.status = status
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    if (typeof contentType === 'string') this.streaming = contentType.includes('text/event-stream')
  }

  chunk(chunk: Uint8Array, at: string): void {
    if (this.finalized || chunk.byteLength === 0) return
    this.firstByteAt ??= at
    this.lastByteAt = at
    this.bytes += chunk.byteLength
    this.chunks += 1
    this.consume(this.decoder.decode(chunk, { stream: true }), at)
  }

  error(error: unknown): void {
    this.transportError = true
    const value = object(error)
    if (value?.name === 'AbortError' || value?.code === 'ABORT_ERR' || value?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      this.aborted = true
    }
  }

  abort(): void {
    this.aborted = true
  }

  finish(at: string) {
    if (!this.finalized) {
      this.consume(this.decoder.decode(), this.lastByteAt ?? at)
      if (!this.streaming && !this.jsonOverflow && this.json.trim()) {
        this.parse(this.json, '', this.lastByteAt ?? at, true)
      }
      // An unterminated SSE frame is not dispatched: EOF is not a protocol terminator.
      this.finalized = true
      this.json = ''
    }
    const completionObserved = this.doneSeen || [...this.finishReasons].some((reason) => reason !== 'other' && reason !== 'error') || this.terminal === 'completed'
    const outcome = this.aborted ? 'aborted'
      : this.transportError || this.protocolError || (this.status !== undefined && this.status >= 400)
        || this.terminal === 'failed' || this.terminal === 'incomplete' ? 'error'
        : this.protocol !== 'unknown' && completionObserved ? 'complete' : 'unknown'
    return {
      version: 1,
      protocol: this.protocol,
      parsing: this.protocol === 'unknown' ? 'unsupported' : 'supported',
      characterUnit: 'utf16-code-units',
      outputMeasurement: this.streaming ? 'stream-deltas' : 'json-snapshot',
      transportBytes: this.bytes,
      decodedChars: this.chars,
      chunkCount: this.chunks,
      ...(this.firstByteAt ? { firstByteAt: this.firstByteAt } : {}),
      ...(this.lastByteAt ? { lastByteAt: this.lastByteAt } : {}),
      ...(this.firstTextAt ? { firstTextAt: this.firstTextAt } : {}),
      ...(this.firstReasoningAt ? { firstReasoningAt: this.firstReasoningAt } : {}),
      ...(this.lastOutputAt ? { lastOutputAt: this.lastOutputAt } : {}),
      textChars: this.textChars,
      reasoningChars: this.reasoningChars,
      toolArgumentChars: this.toolArgumentChars,
      finishReasons: [...this.finishReasons],
      doneSeen: this.doneSeen,
      ...(this.terminal ? { responseTerminal: this.terminal } : {}),
      completionObserved,
      outcome,
      transportErrorObserved: this.transportError,
      abortObserved: this.aborted,
      protocolErrorObserved: this.protocolError,
      malformedFrames: this.malformedFrames,
      oversizedFrames: this.oversizedFrames,
      incompleteFrame: this.streaming && (this.line.length > 0 || this.data.length > 0 || this.droppingFrame),
      countersMayBePartial: this.protocol === 'unknown' || this.malformedFrames > 0 || this.oversizedFrames > 0
        || (this.streaming && (this.line.length > 0 || this.data.length > 0 || this.droppingFrame))
    }
  }

  private consume(text: string, at: string): void {
    this.chars += text.length
    if (this.protocol === 'unknown') return
    if (!this.streaming) {
      if (!this.jsonOverflow && this.json.length + text.length <= MAX_FRAME_CHARS) this.json += text
      else if (!this.jsonOverflow) {
        this.json = ''
        this.jsonOverflow = true
        this.oversizedFrames += 1
      }
      return
    }
    for (const char of text) {
      if (this.skipLf) {
        this.skipLf = false
        if (char === '\n') continue
      }
      if (char === '\r' || char === '\n') {
        this.skipLf = char === '\r'
        this.consumeLine(at)
        this.line = ''
        this.droppingLine = false
      } else if (!this.droppingLine) {
        if (this.line.length < MAX_FRAME_CHARS) this.line += char
        else {
          this.line = ''
          this.droppingLine = true
          if (!this.droppingFrame) this.oversizedFrames += 1
          this.droppingFrame = true
          this.data = ''
        }
      }
    }
  }

  private consumeLine(at: string): void {
    if (this.droppingLine) return
    if (!this.line) {
      if (!this.droppingFrame && this.data) this.parse(this.data.slice(0, -1), this.eventName, at, false)
      this.data = ''
      this.eventName = ''
      this.droppingFrame = false
      return
    }
    if (this.droppingFrame || this.line.startsWith(':')) return
    const colon = this.line.indexOf(':')
    const field = colon < 0 ? this.line : this.line.slice(0, colon)
    let value = colon < 0 ? '' : this.line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') {
      if (this.data.length + value.length + 1 <= MAX_FRAME_CHARS) this.data += `${value}\n`
      else {
        this.data = ''
        this.droppingFrame = true
        this.oversizedFrames += 1
      }
    } else if (field === 'event') {
      // Only retain known protocol tags; arbitrary server text never becomes metadata.
      this.eventName = ['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(value) ? value : ''
    }
  }

  private parse(text: string, eventName: string, at: string, snapshot: boolean): void {
    if (text.trim() === '[DONE]') {
      this.doneSeen = true
      return
    }
    let value: RecordValue | undefined
    try { value = object(JSON.parse(text)) } catch { this.malformedFrames += 1; return }
    if (!value) { this.malformedFrames += 1; return }
    if (value.error || value.type === 'error' || eventName === 'error') this.protocolError = true
    if (this.protocol === 'chat-completions') {
      for (const choice of Array.isArray(value.choices) ? value.choices : []) {
        const item = object(choice)
        if (typeof item?.finish_reason === 'string') this.finishReasons.add(FINISH_REASONS.has(item.finish_reason) ? item.finish_reason : 'other')
        if (item?.finish_reason === 'error') this.protocolError = true
        const delta = object(item?.delta) ?? object(item?.message)
        this.output('text', delta?.content, at)
        this.output('reasoning', delta?.reasoning_content ?? delta?.reasoning, at)
        for (const tool of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
          this.output('tool', object(object(tool)?.function)?.arguments, at)
        }
        this.output('tool', object(delta?.function_call)?.arguments, at)
      }
      return
    }
    const type = typeof value.type === 'string' ? value.type : eventName
    if (['response.completed', 'response.failed', 'response.incomplete'].includes(type)) {
      this.terminal = type.slice('response.'.length) as 'completed' | 'failed' | 'incomplete'
    }
    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') this.output('text', value.delta, at)
    if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') this.output('reasoning', value.delta, at)
    if (type === 'response.function_call_arguments.delta') this.output('tool', value.delta, at)
    if (!snapshot) return // Do not count terminal snapshots again after streamed deltas.
    const response = object(value.response) ?? value
    if (response.status === 'completed' || response.status === 'failed' || response.status === 'incomplete') this.terminal = response.status
    for (const output of Array.isArray(response.output) ? response.output : []) {
      const item = object(output)
      if (item?.type === 'function_call') this.output('tool', item.arguments, at)
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        const content = object(part)
        if (content?.type === 'output_text' || content?.type === 'text') this.output('text', content.text, at)
        if (content?.type === 'refusal') this.output('text', content.refusal, at)
      }
      if (item?.type === 'reasoning') for (const part of Array.isArray(item.summary) ? item.summary : []) this.output('reasoning', object(part)?.text, at)
    }
  }

  private output(kind: 'text' | 'reasoning' | 'tool', value: unknown, at: string): void {
    if (typeof value !== 'string' || value.length === 0) return
    if (kind === 'text') { this.textChars += value.length; this.firstTextAt ??= at }
    else if (kind === 'reasoning') { this.reasoningChars += value.length; this.firstReasoningAt ??= at }
    else this.toolArgumentChars += value.length
    this.lastOutputAt = at
  }
}

function object(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined
}
