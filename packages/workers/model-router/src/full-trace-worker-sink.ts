import { Worker } from 'node:worker_threads'

import type { TraceEventInput } from '@sciforge/full-trace'

import type { ModelRouterTraceSink } from './full-trace-recorder.js'

export type ModelRouterTraceWriterStatus = {
  state: 'starting' | 'ready' | 'closing' | 'failed' | 'closed'
  failure?: string
}

export type ModelRouterFullTraceWorkerSinkOptions = {
  userDataDirectory: string
  sensitiveValues?: readonly string[]
  moduleUrl?: string
  closeTimeoutMs?: number
}

type PendingOperation = {
  resolve: () => void
  reject: (error: Error) => void
}

type TraceWriterMessage =
  | { type: 'ready' }
  | { type: 'initialization-failed'; error: string }
  | { type: 'append-complete'; id: number }
  | { type: 'append-failed'; id: number; error: string }
  | { type: 'closed'; id: number }

const TRACE_WRITER_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads'

if (!parentPort) throw new Error('Full Trace writer requires a parent port.')

const errorMessage = (error) => error instanceof Error ? error.message : String(error)
let store
try {
  const trace = await import(workerData.moduleUrl)
  store = new trace.LocalTraceStore({
    userDataDirectory: workerData.userDataDirectory,
    sensitiveValues: workerData.sensitiveValues
  })
  await store.initialize()
  parentPort.postMessage({ type: 'ready' })
} catch (error) {
  parentPort.postMessage({ type: 'initialization-failed', error: errorMessage(error) })
  parentPort.close()
}

let queue = Promise.resolve()
parentPort.on('message', (message) => {
  if (!store || !message || typeof message !== 'object') return
  if (message.type === 'append') {
    const append = async () => {
      try {
        await store.appendMany(message.events)
        parentPort.postMessage({ type: 'append-complete', id: message.id })
      } catch (error) {
        parentPort.postMessage({ type: 'append-failed', id: message.id, error: errorMessage(error) })
      }
    }
    queue = queue.then(append, append)
    return
  }
  if (message.type === 'close') {
    const close = async () => {
      parentPort.postMessage({ type: 'closed', id: message.id })
      parentPort.close()
    }
    queue = queue.then(close, close)
  }
})
`

/**
 * Runs LocalTraceStore in an isolated worker so filesystem sync, capacity scans,
 * normalization, and serialization cannot block the Model Router event loop.
 */
export class ModelRouterFullTraceWorkerSink implements ModelRouterTraceSink {
  private worker?: Worker
  private initializeTask?: Promise<void>
  private initializeResolve?: () => void
  private initializeReject?: (error: Error) => void
  private nextOperationId = 1
  private readonly pending = new Map<number, PendingOperation>()
  private state: ModelRouterTraceWriterStatus['state'] = 'starting'
  private failure?: string
  private closeTask?: Promise<void>

  constructor(private readonly options: ModelRouterFullTraceWorkerSinkOptions) {}

  status(): ModelRouterTraceWriterStatus {
    return {
      state: this.state,
      ...(this.failure ? { failure: this.failure } : {})
    }
  }

  initialize(): Promise<void> {
    if (this.initializeTask) return this.initializeTask
    if (this.closeTask || this.state === 'closing' || this.state === 'closed') {
      return Promise.reject(new Error('Full Trace writer is closed.'))
    }
    this.initializeTask = new Promise<void>((resolve, reject) => {
      this.initializeResolve = resolve
      this.initializeReject = reject
      try {
        const worker = new Worker(
          new URL(`data:text/javascript,${encodeURIComponent(TRACE_WRITER_SOURCE)}`),
          {
            workerData: {
              moduleUrl: this.options.moduleUrl ?? import.meta.resolve('@sciforge/full-trace'),
              userDataDirectory: this.options.userDataDirectory,
              sensitiveValues: [...this.options.sensitiveValues ?? []]
            }
          }
        )
        this.worker = worker
        worker.on('message', (message: TraceWriterMessage) => this.onMessage(message))
        worker.on('error', (error) => this.fail(error))
        worker.on('exit', (code) => {
          if (this.state !== 'closed') {
            this.fail(new Error(`Full Trace writer exited with code ${code}.`))
          }
        })
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return this.initializeTask
  }

  async appendMany(inputs: readonly TraceEventInput[]): Promise<void> {
    if (this.closeTask) throw new Error('Full Trace writer is closing.')
    await this.initialize()
    if (this.state !== 'ready' || !this.worker) {
      throw new Error(this.failure ?? `Full Trace writer is ${this.state}.`)
    }
    const id = this.nextOperationId++
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker?.postMessage({ type: 'append', id, events: inputs })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask
    this.closeTask = this.closeNow()
    return this.closeTask
  }

  private async closeNow(): Promise<void> {
    if (this.state === 'closed') return
    const previousState = this.state
    this.state = 'closing'
    const worker = this.worker
    if (!worker) {
      this.state = 'closed'
      return
    }
    if (previousState === 'starting') {
      const error = new Error('Full Trace writer closed during initialization.')
      this.initializeReject?.(error)
      this.clearInitializeCallbacks()
      this.rejectPending(error)
      await worker.terminate()
      this.state = 'closed'
      return
    }
    if (previousState === 'failed') {
      await worker.terminate()
      this.state = 'closed'
      return
    }
    const id = this.nextOperationId++
    const closeTimeoutMs = this.options.closeTimeoutMs ?? 10_000
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          this.pending.set(id, { resolve, reject })
          try {
            worker.postMessage({ type: 'close', id })
          } catch (error) {
            this.pending.delete(id)
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Full Trace writer close timed out.')), closeTimeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
      this.pending.delete(id)
      await worker.terminate()
      this.state = 'closed'
      this.rejectPending(new Error('Full Trace writer closed.'))
    }
  }

  private onMessage(message: TraceWriterMessage): void {
    if (message.type === 'ready') {
      if (this.state === 'starting') this.state = 'ready'
      this.initializeResolve?.()
      this.clearInitializeCallbacks()
      return
    }
    if (message.type === 'initialization-failed') {
      this.fail(new Error(message.error))
      return
    }
    const operation = this.pending.get(message.id)
    if (!operation) return
    this.pending.delete(message.id)
    if (message.type === 'append-failed') {
      const error = new Error(message.error)
      operation.reject(error)
      this.fail(error)
      return
    }
    if (message.type === 'closed') this.state = 'closed'
    operation.resolve()
  }

  private fail(error: Error): void {
    if (this.state === 'closed') return
    this.state = 'failed'
    this.failure = error.message
    this.initializeReject?.(error)
    this.clearInitializeCallbacks()
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const operation of this.pending.values()) operation.reject(error)
    this.pending.clear()
  }

  private clearInitializeCallbacks(): void {
    this.initializeResolve = undefined
    this.initializeReject = undefined
  }
}
