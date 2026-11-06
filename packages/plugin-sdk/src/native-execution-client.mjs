import { createHostServiceClient } from './host-service-client.mjs'

const registries = new WeakMap()
const observe = (promise) => { promise.catch(() => undefined); return promise }
const aborted = (signal) => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')

/** Trusted runner factory; all authority remains in the live Host service channel. */
export function createNativeExecutionClients(bridge, _config = {}) {
  const service = createHostServiceClient(bridge, { serviceId: 'nativeExecution' })
  // The runner releases its token when an invocation closes; completed calls
  // therefore retain no session cache, even when their signals never abort.
  const contexts = new WeakMap()
  const commands = new Map()

  // An abort waits for the service's cancellation acknowledgement. It never
  // replaces the invocation signal with a fresh source of authority.
  function call(operation, input, signal) {
    signal?.throwIfAborted()
    const handle = service.request(operation, input)
    let listener
    const result = new Promise((resolve, reject) => {
      let cancelling = false
      listener = () => {
        if (cancelling) return
        cancelling = true
        Promise.resolve().then(() => handle.cancel()).then((completion) => {
          if (!completion.quiescent) throw new Error('Native execution cancellation did not establish quiescence.')
          reject(aborted(signal))
        }, reject).catch(reject)
      }
      signal?.addEventListener('abort', listener, { once: true })
      if (signal?.aborted) listener()
      Promise.resolve(handle.result).then((value) => { if (!cancelling) resolve(value) }, (error) => { if (!cancelling) reject(error) })
    }).finally(() => signal?.removeEventListener('abort', listener))
    return observe(result)
  }

  const registry = Object.freeze({
    register(definition) {
      if (!definition || typeof definition.name !== 'string' || !definition.name.trim() || typeof definition.handler !== 'function') throw new TypeError('Invalid native command.')
      if (commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`)
      const command = Object.freeze({ ...definition })
      commands.set(command.name, command)
      return () => { if (commands.get(command.name) === command) commands.delete(command.name) }
    },
    async invoke(name, invocation) {
      invocation.signal.throwIfAborted()
      const command = commands.get(name)
      if (!command) throw new Error(`Unknown command: ${name}`)
      return await command.handler(invocation)
    },
  })
  const clients = Object.freeze({
    workingDirectory: Object.freeze({
      async ensure(agent, signal) {
        signal.throwIfAborted()
        const session = agent?.session?.id
        if (typeof session !== 'string' || !session) throw new Error('Native execution requires a calling session ID.')
        // Resolve each ensure against the Host, including rechecks after approval.
        const invocationId = bridge.invocationId
        const token = bridge.invocationToken
        if (!invocationId || !token || typeof token !== 'object') throw new Error('Native execution requires a live invocation token.')
        let sessions = contexts.get(token)
        if (!sessions) { sessions = new Map(); contexts.set(token, sessions) }
        const previous = sessions.get(session)
        previous?.signal.removeEventListener('abort', previous.onAbort)
        sessions.delete(session)
        const context = await call('context.resolve', {}, signal)
        const policy = context?.policy
        signal.throwIfAborted()
        if (bridge.invocationId !== invocationId || bridge.invocationToken !== token) throw new Error('Native execution invocation is stale.')
        if (!policy || typeof context.workspaceRoot !== 'string' || !context.workspaceRoot || policy.workspaceRoot !== context.workspaceRoot || !['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode) || (policy.sessionId !== undefined && typeof policy.sessionId !== 'string')) throw new Error('Invalid Host native execution context.')
        const entry = { policy: Object.freeze({ workspaceRoot: policy.workspaceRoot, mode: policy.mode, ...(policy.sessionId === undefined ? {} : { sessionId: policy.sessionId }) }), invocationId, signal, onAbort: () => { if (sessions.get(session) === entry) sessions.delete(session) } }
        sessions.set(session, entry)
        signal.addEventListener('abort', entry.onAbort, { once: true })
        return policy.workspaceRoot
      },
    }),
    sandboxPolicy: Object.freeze({
      resolve({ session }) {
        const token = bridge.invocationToken
        const entry = token && contexts.get(token)?.get(session?.id)
        if (!entry || entry.signal.aborted || !bridge.invocationId || entry.invocationId !== bridge.invocationId) throw new Error('Call workingDirectory.ensure in the live invocation before resolving sandbox policy.')
        return entry.policy
      },
    }),
    sandbox: Object.freeze({ confine(argv, policy, signal) { return call('process.confine', { argv: [...argv], policy }, signal) } }),
    approval: Object.freeze({ request({ reason, signal }) { return call('approval.request', { reason }, signal) } }),
    subprocess: Object.freeze({
      spawn(request) {
        const { signal, argv, cwd, env, stdio, graceMs } = request
        // Send synchronously, while the invocation is current. The native API
        // returns a facade even though its Host process identifier is async.
        const started = call('process.spawn', { argv: [...argv], cwd, env, stdio, graceMs }, signal)
        let output = { stdout: { text: '', lossy: false }, stderr: { text: '', lossy: false } }
        let stopped
        let stopping = false
        const store = (value) => { output = value; return { exitCode: value.exitCode, signal: value.signal ?? null } }
        const collected = Object.freeze(Object.fromEntries(['stdout', 'stderr'].map((stream) => [stream, Object.freeze({
          readFrom(offset) {
            if (offset !== 0) throw new RangeError('Native collected output supports offset 0 only.')
            return Object.freeze({ text: output[stream].text, lossy: output[stream].lossy })
          },
        })])))
        const done = observe(started.then(async ({ processId }) => {
          signal.throwIfAborted()
          const result = await call('process.wait', { processId }, signal)
          // Stop is authoritative if it races with root-process completion.
          if (!stopping) return store(result)
          return { exitCode: result.exitCode, signal: result.signal ?? null }
        }))
        return Object.freeze({
          done, collected,
          terminate() {
            if (!stopped) {
              stopping = true
              stopped = observe(started.then(async ({ processId }) => {
                if (signal.aborted) { await done; throw aborted(signal) }
                store(await call('process.stop', { processId }, signal))
              }))
            }
            return stopped
          },
          async waitForExit() { if (stopped) await stopped; else await done },
        })
      },
    }),
    commands: registry,
  })
  registries.set(clients, registry)
  return clients
}

/** Runner-local registry accessor; it never dispatches a Host request. */
export function getNativeExecutionCommandRegistry(clients) {
  const registry = registries.get(clients)
  if (!registry) throw new TypeError('Unknown native execution clients.')
  return registry
}
