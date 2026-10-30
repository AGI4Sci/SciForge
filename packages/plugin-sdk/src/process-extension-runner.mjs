import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { registerHooks } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'

import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveDshStorageRoot } from './dsh-storage-root.mjs'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'

// Resolve the approved runtime family at the SDK-owned deployment, never a
// plugin's private copy. This preserves Service/Context identity in staged dirs.
const runtimePackages = new Set(['cordis', 'cosmokit', 'schemastery',
  'dsh-tools', 'dsh-brand', 'dsh-util-values', 'dsh-agent', 'dsh-ptc-runtime',
  'dsh-invariants', 'dsh-llm', 'dsh-scope', 'dsh-session', 'dsh-system-prompt',
  'dsh-user-approval', 'dsh-sandbox', 'dsh-sandbox-policy', 'dsh-timeout',
  'dsh-util-crypto', 'dsh-typert-protocol', 'dsh-session-projection',
  'dsh-storage', 'dsh-storage-domain', 'dsh-storage-json', 'dsh-session-projection-cache'])
// Host-provided plugin runtime dependencies: bare specifiers the host vendors
// for installed plugins (native addons and similar), plus the deployment base
// their copies resolve from. Parsed before any plugin import so the resolution
// hook below can serve them; absent means exactly the previous behaviour.
const hostProvidedDependencies = (() => {
  const raw = process.argv[4]
  if (!raw) return { packages: new Set(), baseUrl: undefined }
  try {
    const parsed = JSON.parse(raw)
    const packages = new Set(Array.isArray(parsed?.packages)
      ? parsed.packages.filter((name) => typeof name === 'string' && name.length > 0)
      : [])
    const baseUrl = typeof parsed?.baseUrl === 'string' && parsed.baseUrl.length > 0 ? parsed.baseUrl : undefined
    return { packages, baseUrl }
  } catch {
    return { packages: new Set(), baseUrl: undefined }
  }
})()

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) {
    const name = specifier.split('/')[1]
    if (!runtimePackages.has(name)) throw new Error(`Unapproved DSH runtime package: ${specifier}`)
    return nextResolve(specifier, { ...context, parentURL: import.meta.url })
  }
  if (specifier === 'zod' || specifier.startsWith('zod/')) return nextResolve(specifier, { ...context, parentURL: import.meta.url })
  if (hostProvidedDependencies.baseUrl) {
    const bare = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]
    if (hostProvidedDependencies.packages.has(bare)) {
      return nextResolve(specifier, { ...context, parentURL: hostProvidedDependencies.baseUrl })
    }
  }
  return nextResolve(specifier, context)
} })
let cordisRoot
let dshTools
let consumerFiber
let projectionFiber
let sessionsFiber
let domainFiber
let jsonFiber
const syntheticSessionDisposers = new Map()
const ordinaryAgents = new Map()
let childAgentResolver
async function disposeCordis() {
  for (const [id, owner] of ordinaryAgents) {
    // Rejected validation can still own a resource whose cleanup failed.
    await owner.promise.catch(() => undefined)
    await owner.local?.dispose?.()
    ordinaryAgents.delete(id)
  }
  childAgentResolver = undefined
  // Detach runner-owned sessions while the cache can still observe disposal
  // and queue its final writes. SessionStore.enter() is not a Cordis effect.
  for (const [id, detach] of syntheticSessionDisposers) {
    try { detach() } finally { syntheticSessionDisposers.delete(id) }
  }
  // Cordis siblings dispose concurrently. Close the consumer first so its
  // final queued writes drain while the domain facility/backend remain live.
  await consumerFiber?.dispose()
  consumerFiber = undefined
  await projectionFiber?.dispose()
  projectionFiber = undefined
  await sessionsFiber?.dispose()
  sessionsFiber = undefined
  await domainFiber?.dispose()
  domainFiber = undefined
  await jsonFiber?.dispose()
  jsonFiber = undefined
  await cordisRoot?.fiber.dispose()
  cordisRoot = undefined
}

const entryPath = process.argv[2]
const generation = Number(process.argv[3])
let extensionModule
let capabilityDefinitions = []
// Host-initiated workspace-preview slots cached at activate from the plugin
// entry's getWorkspacePreviewProviders() named export (gap-1b channel; see
// workspace-preview-channel.ts for the wire contract and governance model).
let workspacePreviewSlots = []
let toolRevision = 0
let toolDiagnostics = []
let snapshotRevision = 0
const invocations = new Map()
const admittedInvocations = new Set()
let deactivating = false
let deactivation

function deactivate(module) {
  if (!deactivation) {
    const attempt = (async () => {
      await Promise.all([...admittedInvocations])
      await disposeCordis()
      await module.deactivate?.()
    })()
    deactivation = attempt
    // A failed cleanup retains the admission fence and can be retried.
    attempt.catch(() => { if (deactivation === attempt) deactivation = undefined })
  }
  return deactivation
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    // Structured channel codes (e.g. workspace preview governance denials)
    // travel with the error instead of being flattened into the message.
    ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? { code: error.code }
      : {})
  }
}

function reply(requestId, result, ok = true, error) {
  if (!process.send) return
  return new Promise((resolve) => {
    process.send(ok
      ? { type: 'response', requestId, ok: true, result }
      : { type: 'response', requestId, ok: false, error: serializeError(error) }, () => resolve())
  })
}

// Host ports bridge: the only sanctioned way for plugin code in this child to
// reach Host-owned capabilities. Installed before the plugin entry is imported
// so both named-runner hooks and native Cordis entrypoints observe one global.
// The Host binds identity, checks the contract allowlist, and validates the
// workspace scope before any effect; every error crossing back is structured.
const HOST_PORTS_PROTOCOL = 'sciforge-host-ports.v1'
const HOST_PORTS_TIMEOUT_MS = 30_000

// Host-initiated workspace-preview channel (reverse direction of the ports
// bridge above). Mirrors workspace-preview-channel.ts, which is the reference
// contract; keep the protocol id, method set, and wire byte cap in sync.
const WORKSPACE_PREVIEW_PROTOCOL = 'sciforge-preview.v1'
const WORKSPACE_PREVIEW_METHODS = ['observe', 'invokeAction', 'prepareArtifact', 'applyEdit', 'exportPreview']
const WORKSPACE_PREVIEW_MAX_WIRE_BYTES = 8 * 1024 * 1024

function previewError(code, message) {
  return Object.assign(new Error(message), { code })
}
const hostPortsPending = new Map()
let invokeTail = Promise.resolve()

function serializeInvoke(job) {
  const run = invokeTail.then(job)
  invokeTail = run.then(() => undefined, () => undefined)
  return run
}

function hostPortsError(code, message) {
  return Object.assign(new Error(message), { code })
}

function settleHostPortsCancel(pending, outcome) {
  const settle = pending.onCancelSettled
  pending.onCancelSettled = undefined
  settle?.(outcome)
}

const hostPorts = Object.freeze({
  request(request) {
    if (!process.send) throw hostPortsError('ports_unavailable', 'Host ports bridge requires an IPC channel.')
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.getPrototypeOf(request) !== Object.prototype) {
      throw hostPortsError('invalid_request', 'Host ports request must be a plain object envelope.')
    }
    const { operation, input } = request
    if (typeof operation !== 'string' || operation.length === 0 || operation !== operation.trim()) {
      throw hostPortsError('invalid_request', 'Host ports request requires a canonical operation string.')
    }
    const requestId = randomUUID()
    const envelope = {
      protocol: HOST_PORTS_PROTOCOL, requestId, operation, input: input === undefined ? null : input,
      ...(request.caller !== undefined ? { caller: request.caller } : {}),
      ...(request.scope !== undefined ? { scope: request.scope } : {})
    }
    if (!isLosslessJsonValue(envelope)) {
      throw hostPortsError('invalid_request', 'Host ports request must be lossless JSON.')
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = hostPortsPending.get(requestId)
        if (!pending) return
        hostPortsPending.delete(requestId)
        settleHostPortsCancel(pending, { cancelled: false, quiescent: false })
        reject(hostPortsError('ports_timeout', `Host ports request ${operation} timed out.`))
      }, HOST_PORTS_TIMEOUT_MS)
      hostPortsPending.set(requestId, { resolve, reject, timer, cancelRequested: false, onCancelSettled: undefined })
      process.send({
        type: 'ports-request', requestId, request: envelope,
        ...(serviceInvocation.getStore()?.workspace ? { boundWorkspace: serviceInvocation.getStore().workspace } : {})
      })
    })
  },
  // Cancellation is truthful: the promise resolves only when the Host settles
  // the underlying request (cancelled/quiescent), never from a local timeout.
  cancel(requestId) {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return Promise.resolve({ cancelled: false, quiescent: true })
    }
    const pending = hostPortsPending.get(requestId)
    if (!pending) return Promise.resolve({ cancelled: false, quiescent: true })
    pending.cancelRequested = true
    process.send?.({ type: 'ports-cancel', requestId })
    return new Promise((resolve) => {
      const backstop = setTimeout(() => resolve({ cancelled: false, quiescent: false }), HOST_PORTS_TIMEOUT_MS)
      pending.onCancelSettled = (outcome) => {
        clearTimeout(backstop)
        resolve(outcome)
      }
    })
  }
})
globalThis.__sciforgeHostPorts = hostPorts

// The trusted runner stamps only correlation. Authority stays in the Host.
const serviceInvocation = new AsyncLocalStorage()
const servicePending = new Map()
globalThis.__sciforgeHostServices = Object.freeze({
  request(serviceId, operation, input) {
    const invocationId = serviceInvocation.getStore()?.invocationId
    if (!invocationId || !invocations.has(invocationId)) throw hostPortsError('service_denied', 'No live invocation.')
    if (typeof serviceId !== 'string' || !serviceId || serviceId !== serviceId.trim()
      || typeof operation !== 'string' || !operation || operation !== operation.trim()
      || !isLosslessJsonValue(input)) throw hostPortsError('invalid_request', 'Expected service id, operation and lossless JSON.')
    const requestId = randomUUID()
    let resolveResult, rejectResult, resolveCompletion
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    // Register a rejection observer even when a caller awaits cancellation first.
    result.catch(() => undefined)
    const completion = new Promise((resolve) => { resolveCompletion = resolve })
    const pending = { resolveResult, rejectResult, resolveCompletion }
    servicePending.set(requestId, pending)
    process.send?.({ type: 'service-request', requestId, invocationId, serviceId, operation, input })
    return Object.freeze({ requestId, result, cancel() {
      if (servicePending.has(requestId)) process.send?.({ type: 'service-cancel', requestId })
      // No timer/abort/IPC-send ACK is evidence that provider work stopped.
      return completion
    } })
  }
})
process.on('disconnect', () => {
  for (const pending of servicePending.values()) {
    pending.rejectResult(hostPortsError('service_disconnected', 'Host disconnected; effects are uncertain.'))
    pending.resolveCompletion({ cancelled: false, quiescent: false })
  }
  servicePending.clear()
})

async function load() {
  if (!extensionModule) {
    extensionModule = await import(`${pathToFileURL(entryPath).href}?generation=${generation}`)
  }
  return extensionModule
}

function ordinaryAgentKey(identity) {
  return JSON.stringify([identity.runtimeId, identity.threadId, identity.sessionId])
}

function isLosslessJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) return false
    }
  }
  seen.add(value)
  try {
    // Array indices are not the whole payload: advanced IPC retains own extras
    // and __proto__. Inspect data descriptors without evaluating accessors.
    return Reflect.ownKeys(descriptors).every((key) => {
      if (array && key === 'length') return true
      if (typeof key !== 'string') return false
      const descriptor = descriptors[key]
      return descriptor.enumerable && Object.hasOwn(descriptor, 'value')
        && isLosslessJsonValue(descriptor.value, seen)
    })
  } finally {
    seen.delete(value)
  }
}

function validateWorkspacePreviewSlots(value) {
  if (!Array.isArray(value)) {
    throw new Error('getWorkspacePreviewProviders() must return an array of slot contributions.')
  }
  const seen = new Set()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.getPrototypeOf(item) !== Object.prototype) {
      throw new Error('Workspace preview slot contributions must be plain objects.')
    }
    if (typeof item.slotId !== 'string' || !item.slotId.trim() || item.slotId.length > 128) {
      throw new Error('Workspace preview slot contributions require a canonical slotId string.')
    }
    if (seen.has(item.slotId)) throw new Error(`Duplicate workspace preview slot: ${item.slotId}.`)
    seen.add(item.slotId)
    if (!item.manifest || typeof item.manifest !== 'object' || Array.isArray(item.manifest)) {
      throw new Error(`Workspace preview slot ${item.slotId} requires a manifest object.`)
    }
    const handler = item.provider
    if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
      throw new Error(`Workspace preview slot ${item.slotId} requires a provider object.`)
    }
    for (const method of WORKSPACE_PREVIEW_METHODS) {
      if (handler[method] !== undefined && typeof handler[method] !== 'function') {
        throw new Error(`Workspace preview provider ${item.slotId}.${method} must be a function.`)
      }
    }
  }
}

/**
 * Layer-3 governance for host-initiated preview calls, enforced child-side:
 * the declared workspaceRoot must be present and must equal the request's own
 * file.workspaceRoot. Layers 1 (contract slot allowlist) and 2 (identity) are
 * Host-side, mirroring the ports bridge's split.
 */
function validateWorkspacePreviewRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.getPrototypeOf(payload) !== Object.prototype ||
      payload.protocol !== WORKSPACE_PREVIEW_PROTOCOL) {
    throw previewError('invalid_request', 'Workspace preview request must be a sciforge-preview.v1 envelope.')
  }
  const { requestId, slotId, method, workspaceRoot, input } = payload
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) {
    throw previewError('invalid_request', 'Workspace preview request requires a canonical requestId.')
  }
  if (typeof slotId !== 'string' || !slotId.trim() || slotId.length > 128) {
    throw previewError('invalid_request', 'Workspace preview request requires a canonical slotId.')
  }
  if (!WORKSPACE_PREVIEW_METHODS.includes(method)) {
    throw previewError('unsupported_method', `Workspace preview method ${String(method)} is not supported.`)
  }
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw previewError('workspace_required', 'Workspace preview requests require an explicit render-target workspaceRoot.')
  }
  if (!isLosslessJsonValue(input)) {
    throw previewError('invalid_request', 'Workspace preview request input must be lossless JSON.')
  }
  const inputWorkspace = input && typeof input === 'object' && !Array.isArray(input)
    ? input.file?.workspaceRoot
    : undefined
  if (inputWorkspace !== workspaceRoot) {
    throw previewError('workspace_mismatch', 'Workspace preview workspaceRoot does not match the request file workspace.')
  }
  return { requestId, slotId, method, input }
}

async function dispatchWorkspacePreviewRequest(payload) {
  const { slotId, method, input } = validateWorkspacePreviewRequest(payload)
  const slot = workspacePreviewSlots.find((candidate) => candidate.slotId === slotId)
  if (!slot) throw previewError('unsupported_slot', `Workspace preview slot ${slotId} is not provided by this plugin.`)
  const handler = slot.provider?.[method]
  if (typeof handler !== 'function') {
    throw previewError('unsupported_method', `Workspace preview provider ${slotId} does not implement ${method}.`)
  }
  const result = await handler(input)
  // Byte-bearing artifact results cross the wire as base64, capped before
  // encoding so a misbehaving provider cannot force a giant IPC payload.
  if (method === 'prepareArtifact' && result && typeof result === 'object' &&
      result.ok === true && typeof result.kind === 'string' && result.bytes instanceof Uint8Array) {
    if (result.bytes.byteLength > WORKSPACE_PREVIEW_MAX_WIRE_BYTES) {
      throw previewError('artifact_too_large', `Workspace preview artifact is ${result.bytes.byteLength} bytes, which exceeds the ${WORKSPACE_PREVIEW_MAX_WIRE_BYTES} byte wire limit.`)
    }
    const { bytes, ...rest } = result
    const wire = { ...rest, bytesBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }
    if (!isLosslessJsonValue(wire)) throw previewError('invalid_result', 'Workspace preview artifact result is not lossless JSON.')
    return wire
  }
  if (!isLosslessJsonValue(result)) {
    throw previewError('invalid_result', 'Workspace preview result is not lossless JSON.')
  }
  return result ?? null
}

function validateInvocationEnvelope(invocation) {
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)
    || Object.getPrototypeOf(invocation) !== Object.prototype
    || !isLosslessJsonValue(invocation)
    || Object.keys(invocation).some((key) => !['caller', 'ordinarySession', 'context'].includes(key))
    || !Object.hasOwn(invocation, 'caller') || !Object.hasOwn(invocation, 'ordinarySession') || !Object.hasOwn(invocation, 'context')
    || typeof invocation.caller !== 'object' || typeof invocation.context !== 'object'
    || Array.isArray(invocation.caller) || invocation.caller === null
    || Array.isArray(invocation.context) || invocation.context === null) {
    throw new Error('DSH invocation requires a complete lossless JSON envelope with caller, context, and ordinary Session identity objects.')
  }
  const identity = invocation.ordinarySession
  if (!isLosslessJsonValue(identity) || !identity || typeof identity !== 'object' || Array.isArray(identity)
    || Object.getPrototypeOf(identity) !== Object.prototype
    || Object.keys(identity).length !== 3
    || !['runtimeId', 'threadId', 'sessionId'].every((key) => typeof identity[key] === 'string'
      && identity[key].length > 0 && identity[key].length <= 1024 && identity[key] === identity[key].trim())) {
    throw new Error('DSH invocation context requires a valid ordinary Session identity.')
  }
}

async function localAgentFor(invocation) {
  if (invocation === undefined) return undefined
  // Every explicit envelope is validated once at the invoke boundary, before
  // any handler or cached Agent lookup can bypass the checks.
  const identity = invocation.ordinarySession
  const key = ordinaryAgentKey(identity)
  let owner = ordinaryAgents.get(key)
  if (!owner) {
    if (childAgentResolver === undefined) throw new Error('Host did not provide a child-local ordinary Agent resolver.')
    owner = {}
    // Register ownership before calling user code or reaching the first await.
    ordinaryAgents.set(key, owner)
    owner.promise = Promise.resolve().then(async () => {
      const resolved = await childAgentResolver({ identity, invocation, rootContext: cordisRoot })
      owner.local = resolved
      const agent = resolved?.agent
      if (!agent || agent.id !== identity.sessionId || !agent.session || agent.session.id !== identity.sessionId || !agent.ctx) {
        await resolved?.dispose?.()
        owner.local = undefined
        throw new Error('Child-local ordinary Agent resolver returned an invalid identity binding.')
      }
      return { agent, dispose: resolved.dispose }
    }).catch((error) => {
      if (!owner.local && ordinaryAgents.get(key) === owner) ordinaryAgents.delete(key)
      throw error
    })
  }
  return (await owner.promise).agent
}

process.on('message', async (message) => {
  if (message?.type === 'service-response') {
    const pending = servicePending.get(message.requestId)
    if (!pending) return
    servicePending.delete(message.requestId)
    if (message.ok) pending.resolveResult(message.value)
    else pending.rejectResult(hostPortsError(message.error?.code ?? 'service_failed', message.error?.message ?? 'Host service failed.'))
    pending.resolveCompletion({ cancelled: !message.ok && message.error?.code === 'cancelled', quiescent: true })
    return
  }
  if (message?.type === 'cancel') {
    invocations.get(message.requestId)?.abort(new Error('Host explicitly cancelled invocation.'))
    return
  }
  if (message?.type === 'ports-response') {
    const pending = hostPortsPending.get(message.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    hostPortsPending.delete(message.requestId)
    if (message.ok) {
      pending.resolve(message.value)
      settleHostPortsCancel(pending, { cancelled: false, quiescent: true })
    } else {
      const error = hostPortsError(
        typeof message.error?.code === 'string' && message.error.code ? message.error.code : 'execution_failed',
        typeof message.error?.message === 'string' && message.error.message ? message.error.message : 'Host ports request failed.'
      )
      pending.reject(error)
      settleHostPortsCancel(pending, pending.cancelRequested && error.code === 'cancelled'
        ? { cancelled: true, quiescent: true }
        : { cancelled: false, quiescent: true })
    }
    return
  }
  if (!message || message.type !== 'request') return
  const { requestId, command, payload } = message
  // 'preview' is host-initiated (the reverse direction of plugin-side ports
  // requests), but it crosses the same admission fence and deactivation drain
  // as invokes so a render call cannot outlive its generation's teardown.
  const invokes = ['invoke', 'managed-invoke', 'workflow-invoke', 'preview'].includes(command)
  // Admission and close are synchronous, before even the module-load await.
  if (invokes && deactivating) {
    reply(requestId, undefined, false, new Error('Extension is deactivating or disabled.'))
    return
  }
  if (command === 'deactivate') deactivating = true
  let settle
  const admitted = invokes ? new Promise((resolve) => { settle = resolve }) : undefined
  if (admitted) admittedInvocations.add(admitted)
  try {
    const module = await load()
    if (command === 'activate') {
      // Named runner hooks retain their own contract; native entrypoints are
      // loaded through the actual pinned Cordis runtime below.
      const hasRunnerContract = typeof module.activate === 'function' || typeof module.getCapabilityDefinitions === 'function' ||
        typeof module.getWorkspacePreviewProviders === 'function'
      if (payload?.dshStorage && hasRunnerContract) throw new Error('Private storage requires a native Cordis entrypoint, not named runner hooks.')
      if (!hasRunnerContract && (typeof module.apply === 'function' || typeof module.default === 'function' || typeof module.default?.apply === 'function')) {
        cordisRoot = new Context()
        try {
          await cordisRoot.plugin(SystemPrompt)
          await cordisRoot.plugin(ToolRuntime, { mode: 'native' })
          dshTools = cordisRoot.tools
          for (const factory of payload?.serviceClients ?? []) {
            if (!isAbsolute(factory.modulePath) || typeof factory.serviceId !== 'string') throw new Error('Invalid trusted service client factory.')
            const create = (await import(pathToFileURL(factory.modulePath).href))[factory.exportName]
            if (typeof create !== 'function') throw new Error('Trusted service client factory export is unavailable.')
            cordisRoot.provide(factory.serviceId, await create(globalThis.__sciforgeHostServices, factory.config))
          }
          const resolverPath = payload?.dshAgentResolver?.path
          if (typeof resolverPath === 'string') {
            if (!isAbsolute(resolverPath)) throw new Error('Child-local ordinary Agent resolver path must be absolute.')
            childAgentResolver = (await import(`${pathToFileURL(resolverPath).href}?generation=${generation}`)).resolveAgent
            if (typeof childAgentResolver !== 'function') throw new Error('Child-local ordinary Agent resolver must export resolveAgent.')
          }
          if (payload?.dshStorage) {
            if (Object.values(payload?.dshToolGrants ?? {}).some((grant) => grant?.effect === 'compute')) {
              throw new Error('Private storage cannot be combined with compute tool grants; storage tool effects require separate approval.')
            }
            const storageRoot = await resolveDshStorageRoot(payload.dshStorage, payload.packageName)
            await cordisRoot.plugin(Storage)
            jsonFiber = await cordisRoot.plugin(StorageJson, { root: storageRoot })
            domainFiber = await cordisRoot.plugin(StorageDomain, { backend: 'json' })
          }
          // The cache consumer requires the real official session services. They
          // are host-owned and installed before the consumer so Cordis resolves
          // static inject=['storageDomain','sessionProjections','sessions'].
          sessionsFiber = await cordisRoot.plugin(SessionStore)
          projectionFiber = await cordisRoot.plugin(SessionProjectionRegistry)
          const grants = payload?.dshToolGrants ?? {}
          const refreshTools = (dynamic = false) => {
          snapshotRevision++
          toolDiagnostics = dshTools.layers.scoped.size
            ? ['DSH scoped tools are unsupported; scoped views never replace the global tool view.'] : []
          capabilityDefinitions = [...dshTools.view().visible.values()].map((tool) => {
            try {
            const schema = dshTools.schemaOf(tool, true)
            const grant = Object.hasOwn(grants, schema.name) ? grants[schema.name] : undefined
            if (!grant || !['read', 'compute', 'workspace-write', 'external-write', 'destructive'].includes(grant.effect) || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(grant.id)) {
              if (dynamic) { toolDiagnostics.push(`DSH tool ${schema.name} requires an explicit host effect grant.`); return undefined }
              throw new Error(`DSH tool ${schema.name} requires an explicit host compute grant or approved effect grant; unsupported effects fail closed.`)
            }
            if (grant.readResource !== undefined && (grant.readResource !== 'workspace' || grant.effect !== 'read')) throw new Error('Invalid Host read resource grant.')
            const workspaceRead = grant.readResource === 'workspace'
            const previous = capabilityDefinitions.find((definition) => definition.tool === tool)
            const fingerprint = JSON.stringify([schema, tool.output.schema, grant])
            if (previous?.fingerprint === fingerprint) return previous
            return { tool, fingerprint, descriptor: { runtimeRevision: ++toolRevision,
              contractVersion: 3, id: grant.id, version: '1', title: schema.name,
              description: schema.description.slice(0, 2000), audiences: workspaceRead ? ['agent', 'ui', 'system'] : ['agent', 'ui'],
              scope: grant.effect === 'read' ? 'resource' : 'global',
              resourceKinds: grant.effect === 'read' ? [workspaceRead ? 'dsh-workspace' : 'dsh-session'] : [], effect: grant.effect,
              approval: grant.effect === 'external-write' || grant.effect === 'destructive' ? 'confirmation' : 'none',
              concurrency: { revision: 'none', idempotency: grant.effect === 'read' ? 'none' : 'required' },
              inputSchema: schema.parameters, outputSchema: tool.output.schema, tags: workspaceRead ? ['dsh-tool', 'dsh-workspace-read'] : ['dsh-tool']
            }, handler: async (input, execution) => {
              const agent = await localAgentFor(execution.invocation)
              const result = await dshTools.execute({ name: schema.name, arguments: input,
                callId: randomUUID(), signal: execution.signal, ...(agent ? { agent } : {}) })
              if (result.isError) throw new Error(result.error?.message ?? 'DSH tool execution failed.')
              return { output: result.value }
            } }
            } catch (error) {
              if (!dynamic) throw error
              toolDiagnostics.push(error.message)
              return undefined
            }
          }).filter(Boolean)
          }
          let toolsReady = false
          cordisRoot.on('tools/change', () => {
            if (!toolsReady) return
            refreshTools(true)
            process.send?.({ type: 'capabilities', generation, revision: snapshotRevision, diagnostics: toolDiagnostics, descriptors: capabilityDefinitions.map(({ descriptor }) => descriptor) })
          })
          const plugin = typeof module.apply === 'function' ? module : module.default
          const fiber = consumerFiber = await cordisRoot.plugin(plugin, payload?.dshConfig ?? {})
          // Missing injections yield a pending fiber, not an active empty plugin.
          if (fiber.state !== 2) throw new Error(`Plugin dependencies are not ready (${fiber.state}).`)
          toolsReady = true
          refreshTools()
        } catch (error) {
          await disposeCordis()
          throw new Error(`DSH Cordis entrypoint requires a supported Context runtime: ${error.message}`, { cause: error })
        }
      }
      await module.activate?.()
      if (hasRunnerContract) capabilityDefinitions = module.getCapabilityDefinitions?.() ?? []
      if (typeof module.getWorkspacePreviewProviders === 'function') {
        const slots = module.getWorkspacePreviewProviders()
        validateWorkspacePreviewSlots(slots)
        workspacePreviewSlots = slots
      }
      const descriptors = capabilityDefinitions.map(({ descriptor }) => descriptor)
      reply(requestId, dshTools ? { descriptors, revision: snapshotRevision, diagnostics: toolDiagnostics } : descriptors)
      return
    }
    if (command === 'invoke') {
      const definition = capabilityDefinitions.find(({ descriptor }) => descriptor.id === payload.id)
      if (!definition) throw new Error(`Capability ${payload.id} is not registered in generation ${generation}.`)
      if (payload.invocation !== undefined) validateInvocationEnvelope(payload.invocation)
      if (definition.tool && (payload.revision !== definition.descriptor.runtimeRevision || dshTools.get(definition.tool.name) !== definition.tool)) {
        throw new Error('DSH tool descriptor revision is stale.')
      }
      if (definition.tool && (definition.descriptor.effect !== 'compute' || definition.descriptor.scope !== 'global') && payload.invocation === undefined && !payload.hostServices) {
        throw new Error('DSH ordinary Session invocation envelope is required.')
      }
      // Keep the existing legacy ports invocation lane. Host-service invocations
      // have their own ALS correlation and Host-owned authority, and may overlap.
      if (!definition.tool && !payload.hostServices) {
        await serializeInvoke(async () => {
          const workspace = typeof payload?.input?.workspaceRoot === 'string' ? payload.input.workspaceRoot : undefined
          const controller = new AbortController()
          invocations.set(requestId, controller)
          try {
            const result = await serviceInvocation.run({ invocationId: requestId, workspace }, () => definition.handler(payload.input, { signal: controller.signal, invocation: payload.invocation }))
            if (!controller.signal.aborted) await reply(requestId, result)
          } finally {
            invocations.delete(requestId)
          }
        })
        return
      }
      const controller = new AbortController()
      invocations.set(requestId, controller)
      try {
        const result = await serviceInvocation.run({ invocationId: requestId }, () => definition.handler(payload.input, { signal: controller.signal, invocation: payload.invocation }))
        if (!controller.signal.aborted) await reply(requestId, result)
      } finally {
        invocations.delete(requestId)
      }
      return
    }
    if (command === 'synthetic-session') {
      const input = payload ?? {}
      const session = cordisRoot.sessions.prepare(input.id, { meta: { createdAt: input.createdAt, cwd: '/synthetic', isSeeded: false } })
      const detach = cordisRoot.sessions.enter(session)
      syntheticSessionDisposers.set(session.id, detach)
      let keepLive = false
      try {
        cordisRoot.sessions.announce(session)
        for (let index = 0; index < (input.events ?? 0); index++) session.append('goal/change', { goal: `synthetic-${index}` })
        await cordisRoot.sessionProjectionCache.write(session)
        if (input.dispose === true) {
          try { detach() } finally { syntheticSessionDisposers.delete(session.id) }
          await cordisRoot.sessionProjectionCache.write(session)
        } else {
          keepLive = true
        }
        reply(requestId, { id: session.id, eventCount: session.log.length, persisted: true, disposed: input.dispose === true })
      } finally {
        // Only a successful live-session request transfers ownership to teardown.
        // A failed checkpoint must not reserve its ID or retain its detach handle.
        if (!keepLive && syntheticSessionDisposers.get(session.id) === detach) {
          try { detach() } finally { syntheticSessionDisposers.delete(session.id) }
        }
      }
      return
    }
    if (command === 'managed-discover') {
      reply(requestId, await module.discover?.())
      return
    }
    if (command === 'managed-invoke') {
      const operation = payload?.operation
      if (typeof module.invoke !== 'function') throw new Error('Managed runtime does not expose invoke.')
      await reply(requestId, await module.invoke(operation, payload?.input))
      return
    }
    if (command === 'workflow-invoke') {
      const operation = payload?.operation
      const handler = module[operation]
      if (typeof handler !== 'function') throw new Error(`Workflow runtime does not expose ${operation}.`)
      await reply(requestId, await handler(payload?.input))
      return
    }
    if (command === 'renderer-contributions') {
      reply(requestId, await module.getRendererContributions?.() ?? [])
      return
    }
    if (command === 'preview-slots') {
      reply(requestId, workspacePreviewSlots.map(({ slotId, artifactKinds, manifest }) => ({
        slotId,
        artifactKinds: [...(artifactKinds ?? [])],
        manifest
      })))
      return
    }
    if (command === 'preview') {
      reply(requestId, await dispatchWorkspacePreviewRequest(payload))
      return
    }
    if (command === 'deactivate') {
      // Lifecycle teardown may call package-owned Host services (for example,
      // Evidence sidecar.close). Give it the same live invocation correlation
      // as an ordinary capability call; correlation alone is not authority.
      const controller = new AbortController()
      invocations.set(requestId, controller)
      try {
        await serviceInvocation.run({ invocationId: requestId }, () => deactivate(module))
        reply(requestId, null)
      } finally {
        invocations.delete(requestId)
      }
      return
    }
    if (command === 'unregister') {
      capabilityDefinitions = []
      workspacePreviewSlots = []
      await module.unregister?.()
      reply(requestId, null)
      return
    }
    if (command === 'dispose') {
      capabilityDefinitions = []
      workspacePreviewSlots = []
      await module.dispose?.()
      reply(requestId, null)
      setImmediate(() => process.exit(0))
      return
    }
    throw new Error(`Unknown extension-host command: ${command}`)
  } catch (error) {
    await reply(requestId, undefined, false, error)
  } finally {
    if (admitted) {
      admittedInvocations.delete(admitted)
      settle()
    }
  }
})

process.on('uncaughtException', (error) => {
  process.send?.({ type: 'crash', error: serializeError(error) })
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  process.send?.({ type: 'crash', error: serializeError(error) })
  process.exit(1)
})

process.send?.({ type: 'ready', generation })
