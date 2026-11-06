import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withBoundedToolResults, modelVisibleToolResultContent } from './model-visible-tool-result'
import { createHash } from 'node:crypto'
import { createHistoryTool } from './history-tool'
import { withDurableAgentRuntimeHistory } from './durable-runtime-history'
import { encodeToolArtifactRef } from './jsonl-thread-page'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'

function imagePayload() {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII='
  const bytes = Buffer.from(data, 'base64')
  return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${data}`, digest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 2, height: 2, integrityVerified: true }
}

describe('runtime-neutral bounded result delivery', () => {
  it('awaits mutation persistence for small results before model delivery and forwards cancellation', async () => {
    const result = { tool: 'edit', value: { ok: true } }
    const signal = new AbortController().signal
    const persist = vi.fn(async () => 'unused')
    const mutation = vi.fn(async () => undefined)
    const surface = withBoundedToolResults({ tools: () => [], call: async () => result }, persist, mutation)
    const request = { name: 'edit', context: { runtimeId: 'dsh', requestId: 1 } }
    expect((await surface.call(request, { signal })).modelContent).toBe('{"ok":true}')
    expect(mutation).toHaveBeenCalledWith(request, result, signal)
    expect(persist).not.toHaveBeenCalled()
    mutation.mockRejectedValueOnce(new Error('journal unavailable'))
    await expect(surface.call(request)).rejects.toThrow('journal unavailable')
  })
  it('delivers generic verified PNG blocks, removes base64 text and preserves full durable artifact', async () => {
    const image = imagePayload()
    const value = { output: image, notes: 'long '.repeat(3000) }
    const persist = vi.fn(async () => 'artifact-image')
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'arbitrary-tool', value }) }, persist)
    const result = await surface.call({ name: 'arbitrary-tool', context: { requestId: 1, runtimeId: 'dsh' } })
    expect(persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ value }))
    expect(result.value).toBe(value)
    const content = modelVisibleToolResultContent(result)
    expect(content[1]).toEqual({ type: 'image', data: image.dataUrl.split(',')[1], mimeType: 'image/png' })
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(content[0])).not.toContain(image.dataUrl.split(',')[1])
    expect(Buffer.byteLength((content[0] as { text: string }).text)).toBeLessThanOrEqual(4096)
  })

  it.each(['digest', 'byteLength', 'width', 'dataUrl', 'mimeType'] as const)('rejects invalid image %s despite a verified claim and strips raw bytes', field => {
    const image = { ...imagePayload(), [field]: field === 'byteLength' || field === 'width' ? 99 : field === 'mimeType' ? 'image/jpeg' : 'forged' }
    if (field === 'dataUrl') image.dataUrl = imagePayload().dataUrl.replace('AAAAC0lE', 'AAAAD0lE')
    const content = modelVisibleToolResultContent({ tool: 'arbitrary', value: image })
    expect(content).toHaveLength(1)
    expect((content[0] as { text: string }).text).toContain('rejected')
    expect((content[0] as { text: string }).text).not.toContain('data:image')
  })

  it('bounds image batches and rejects oversized declared metadata without delivering raw text', () => {
    const image = imagePayload()
    const content = modelVisibleToolResultContent({ tool: 'any', value: { images: Array.from({ length: 5 }, () => image) } })
    expect(content.filter(block => block.type === 'image')).toHaveLength(4)
    expect(JSON.stringify(content[0])).toContain('rejected')
    expect(JSON.stringify(content[0])).not.toContain(image.dataUrl)
    expect(modelVisibleToolResultContent({ tool: 'any', value: { ...image, byteLength: 26 * 1024 * 1024 } })).toHaveLength(1)
  })

  it('rejects empty-IDAT chunk floods while accepting bounded empty chunks', () => {
    const image = imagePayload()
    const original = Buffer.from(image.dataUrl.split(',')[1], 'base64')
    // Empty IDAT with its correct CRC. The valid compressed pixels remain after it.
    const emptyIdat = Buffer.from('000000004944415435af061e', 'hex')
    const payload = (count: number) => {
      const bytes = Buffer.concat([original.subarray(0, 33), ...Array.from({ length: count }, () => emptyIdat), original.subarray(33)])
      return { ...image, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, byteLength: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') }
    }
    expect(modelVisibleToolResultContent({ tool: 'any', value: payload(4093) })[1].type).toBe('image')
    const refused = modelVisibleToolResultContent({ tool: 'any', value: payload(4094) })
    expect(refused).toHaveLength(1)
    expect(JSON.stringify(refused)).toContain('rejected')
  })

  it('preserves canonical text-only modelContent when image input is denied', () => {
    for (const value of [undefined, { structured: 'secondary value' }]) {
      expect(modelVisibleToolResultContent({ tool: 'echo', value, modelContent: 'ECHO:ping' }, false))
        .toEqual([{ type: 'text', text: 'ECHO:ping' }])
    }
  })

  it('rejects unsupported image input even after a bounded projection cached attached blocks', async () => {
    const image = imagePayload()
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'image', value: { ...image, nested: image } }) }, async () => 'artifact')
    const result = await surface.call({ name: 'image', context: { requestId: 1, runtimeId: 'dsh' } })
    expect(modelVisibleToolResultContent(result, true)).toHaveLength(3)
    const refused = modelVisibleToolResultContent(result, false)
    expect(refused).toHaveLength(1)
    expect(JSON.stringify(refused)).toContain('unsupported_model_image_input')
    expect(JSON.stringify(refused)).not.toContain('attached')
    expect(JSON.stringify(refused)).not.toContain(image.dataUrl)
  })

  it('preserves outer and nested duplicate image content indices before recursion', () => {
    const image = imagePayload()
    const content = modelVisibleToolResultContent({ tool: 'any', value: { ...image, nested: image } })
    expect(content).toHaveLength(3)
    const metadata = JSON.parse((content[0] as { text: string }).text)
    expect(metadata.imageDelivery).toMatchObject({ status: 'attached', scope: 'mcp-content-only', modelConsumption: 'unverified', contentIndex: 1 })
    expect(metadata.nested.imageDelivery.contentIndex).toBe(2)
  })

  it('rejects CRC-correct non-ASCII chunk bytes before lossy ASCII decoding', () => {
    const image = imagePayload()
    const bytes = Buffer.from(image.dataUrl.split(',')[1], 'base64')
    // IDAT -> C9DAT used to decode back to IDAT. Recompute CRC so this tests
    // raw chunk-name validation, rather than the existing CRC rejection.
    bytes[37] = 0xc9
    const length = bytes.readUInt32BE(33)
    let crc = 0xffffffff
    for (const byte of bytes.subarray(37, 41 + length)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 41 + length)
    const invalid = { ...image, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, digest: createHash('sha256').update(bytes).digest('hex') }
    expect(modelVisibleToolResultContent({ tool: 'any', value: invalid })).toHaveLength(1)
    expect(JSON.stringify(modelVisibleToolResultContent({ tool: 'any', value: invalid }))).toContain('rejected')
  })

  it('checks PNG CRC and decoded dimensions independently from supplied hashes and flags', () => {
    const image = imagePayload()
    const bytes = Buffer.from(image.dataUrl.split(',')[1], 'base64')
    bytes[40] ^= 1
    const tampered = { ...image, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, digest: createHash('sha256').update(bytes).digest('hex') }
    expect(JSON.stringify(modelVisibleToolResultContent({ tool: 'any', value: tampered }))).toContain('rejected')
    expect(modelVisibleToolResultContent({ tool: 'any', value: { ...image, integrityVerified: false } })[1].type).toBe('image')
  })

  it.each(['codex', 'claude', 'dsh'] as const)('%s restores a large schema and escaped text from the durable journal without re-execution', async runtimeId => {
    const root = await mkdtemp(join(tmpdir(), 'bounded-tool-result-'))
    let close!: () => void
    const wait = new Promise<void>(resolve => { close = resolve })
    const context = {} as AgentRuntimeAdapterContext
    const source = {
      id: runtimeId, transport: 'jsonrpc_stdio',
      startThread: async () => ({ runtimeId, id: 'thread', title: 'test', updatedAt: new Date().toISOString() }),
      subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- provider is idle; Host persists tool results
        await wait
      } }),
      close: async () => { close() }
    } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
    const adapter = withDurableAgentRuntimeHistory(source, root)
    const shape = { type: 'object', properties: { text: { type: 'string', pattern: '"\\\n🧬'.repeat(1600) } } }
    const value = { state: { text: 'large '.repeat(4000) }, operations: [{ operationRef: `op_${'o'.repeat(24)}`, inputShape: shape }] }
    const execute = vi.fn(async () => ({ tool: 'inspect', value }))
    const surface = withBoundedToolResults({ tools: () => [], call: execute }, async (request, result) => {
      await adapter.publishSyntheticEvent!(context, { runtimeId, threadId: 'thread', turnId: 'turn', kind: 'item_snapshot',
        item: { id: 'result', kind: 'tool', status: 'success', meta: { structuredContent: result.value, callId: request.context.callId } } })
      return encodeToolArtifactRef('result')
    })
    try {
      await adapter.startThread(context, { runtimeId })
      const result = await surface.call({ name: 'inspect', context: { runtimeId, threadId: 'thread', turnId: 'turn', requestId: 'r', callId: 'call' } })
      expect(Buffer.byteLength(result.modelContent!)).toBeLessThanOrEqual(4096)
      const visible = JSON.parse(result.modelContent!)
      expect(visible.operations[0].operationRef).toBe(value.operations[0].operationRef)
      expect(visible.operations[0]).not.toHaveProperty('inputShape')
      expect(visible._delivery.status).toBe('partial')
      await adapter.close()
      // Reopen: continuation is not an in-memory cache or another execution.
      const reopened = withDurableAgentRuntimeHistory(source, root)
      const history = createHistoryTool({
        assertLease: () => undefined,
        readPage: input => reopened.readThreadPage(context, input),
        readArtifact: input => reopened.readToolArtifact(context, { ...input, size: 0 })
      })
      let offset = 0, collected = ''
      for (let pages = 0; pages < 100; pages++) {
        const page = await history.call({ name: 'sciforge_read_history', context: { runtimeId, threadId: 'thread', turnId: 'turn', requestId: pages },
          arguments: { ...visible._delivery.nextRead.arguments, jsonPointer: visible.operations[0].schemaPointer, offset } })
        expect(Buffer.byteLength(page.modelContent!)).toBeLessThanOrEqual(16384)
        const data = JSON.parse(page.modelContent!)
        collected += data.content
        if (data.nextOffset === null) break
        expect(data.nextOffset).toBeGreaterThan(offset)
        offset = data.nextOffset
      }
      expect(JSON.parse(collected)).toEqual(shape)
      expect(execute).toHaveBeenCalledOnce()
      await reopened.close()
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it.each(['array', 'object', 'nested'] as const)('delivers the full operation index and exact source schema pointers (%s)', async layout => {
    const operations = Array.from({ length: 11 }, (_, index) => ({
      operationRef: `op_${String(index).padStart(24, 'x')}`,
      schemaRef: `schema_${String(index).padStart(24, 'x')}`,
      title: `Operation ${index} with descriptive title`, effect: 'workspace-write', approval: 'none',
      description: 'long documentation '.repeat(100),
      inputShape: { type: 'object', properties: { content: { type: 'string', description: 'detail '.repeat(900) } } }
    }))
    const value = layout === 'array' ? operations : layout === 'object' ? { operations } : { 'a/b~c': { operations } }
    const call = vi.fn(async () => ({ tool: 'inspect', value }))
    const surface = withBoundedToolResults({ tools: () => [], call }, async () => 'stored')
    const context = { runtimeId: 'codex', threadId: 'thread', requestId: 1 }
    const result = await surface.call({ name: 'inspect', context })
    const visible = JSON.parse(result.modelContent!)
    const descriptors = layout === 'array' ? visible.items : layout === 'object' ? visible.operations : visible['a/b~c'].operations
    expect(descriptors.map((item: { operationRef: string }) => item.operationRef)).toEqual(operations.map(item => item.operationRef))
    const history = createHistoryTool({ assertLease: () => undefined, readPage: vi.fn(),
      readArtifact: async () => ({ content: JSON.stringify(value) }) })
    let offset = 0, content = ''
    do {
      const page = await history.call({ name: 'sciforge_read_history', context,
        arguments: { ...visible._delivery.nextRead.arguments, jsonPointer: descriptors[9].schemaPointer, offset } })
      const delivered = JSON.parse(page.modelContent!)
      content += delivered.content
      offset = delivered.nextOffset
    } while (offset !== null)
    expect(JSON.parse(content)).toEqual(operations[9].inputShape)
    expect(call).toHaveBeenCalledOnce()
  })

  it.each([false, true])('delivers a single requested schema atomically within the bounded larger budget (array=%s)', async array => {
    const descriptor = { operationRef: 'op_one', inputShape: { type: 'string', description: 'schema documentation '.repeat(400) } }
    const value = array ? [descriptor] : descriptor
    const persist = vi.fn()
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'inspect', value }) }, persist)
    const result = await surface.call({ name: 'inspect', context: { runtimeId: 'codex', requestId: 1 } })
    expect(JSON.parse(result.modelContent!)).toEqual(value)
    expect(persist).not.toHaveBeenCalled()
    expect(Buffer.byteLength(result.modelContent!)).toBeLessThanOrEqual(16384)
  })

  it('gives an oversized standalone descriptor a root schema pointer', async () => {
    const value = { operationRef: 'op_one', inputShape: { type: 'string', description: 'x'.repeat(20000) } }
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'inspect', value }) }, async () => 'stored')
    const result = await surface.call({ name: 'inspect', context: { runtimeId: 'codex', requestId: 1 } })
    expect(JSON.parse(result.modelContent!).schemaPointer).toBe('/inputShape')
  })

  it('marks a catalog that cannot fit with its source count and continuation index', async () => {
    const value = Array.from({ length: 100 }, (_, index) => ({ operationRef: `op_${index}`, title: 'Operation '.repeat(15), inputShape: { type: 'object' } }))
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'inspect', value }) }, async () => 'stored')
    const result = await surface.call({ name: 'inspect', context: { runtimeId: 'codex', requestId: 1 } })
    const visible = JSON.parse(result.modelContent!)
    expect(visible.items.at(-1)).toEqual({ _truncated: true, totalItems: 100, nextIndex: visible.items.length - 1, jsonPointer: '' })
    expect(Buffer.byteLength(result.modelContent!)).toBeLessThanOrEqual(4096)
  })

  it('does not make persistence failures retryable or broaden a restricted tool scope', async () => {
    const execute = vi.fn(async () => ({ tool: 'write', value: { status: 'saved', content: 'x'.repeat(9000) } }))
    const request = { name: 'write', context: { runtimeId: 'codex', requestId: 1, allowedToolNames: ['write'] } }
    const failing = withBoundedToolResults({ tools: () => [], call: execute }, async () => { throw new Error('disk unavailable') })
    await expect(failing.call(request)).rejects.toMatchObject({ code: 'tool_result_history_unavailable', retryable: false })
    expect(execute).toHaveBeenCalledOnce()
    const scoped = withBoundedToolResults({ tools: () => [], call: execute }, async () => 'saved')
    const response = JSON.parse((await scoped.call(request)).modelContent!)
    expect(response._delivery.historyAvailable).toBe(false)
    expect(response._delivery).not.toHaveProperty('nextRead')
  })

  it('passes small structured receipts through exactly without creating a result artifact', async () => {
    const persist = vi.fn()
    const value = { nextCursor: 'opaque-token', status: 'ok', text: '🧬' }
    const surface = withBoundedToolResults({ tools: () => [], call: async () => ({ tool: 'read', value }) }, persist)
    const result = await surface.call({ name: 'read', context: { requestId: 1, runtimeId: 'future-runtime' } })
    expect(result.modelContent).toBe(JSON.stringify(value))
    expect(persist).not.toHaveBeenCalled()
  })
})
