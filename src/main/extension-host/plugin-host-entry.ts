/**
 * Child-process entry point for a sandboxed plugin/extension.
 *
 * This is launched by `runtime-host.ts` (parent side) inside a separate OS
 * process — either a plain `node:child_process` fork (used by tests and by
 * `createChildProcessLauncher`) or an Electron `utilityProcess` (used by
 * `createUtilityProcessLauncher` in production). Both give the same isolation
 * guarantee this file relies on: if the plugin module throws, or this file's
 * own top-level code throws, only THIS process dies — the SciForge main
 * process that forked it keeps running.
 *
 * Design ported from `eval-cases/spike-plugin-hotreload/plugin-host/plugin-host.mjs`
 * (staged-commit registration, fault-isolated dispatch) and
 * `eval-cases/spike-plugin-permissions/plugins/demo-perm/demo-perm-plugin.mjs`
 * (host-mediated `api.fetch`). Both were verified end-to-end before this file
 * was written (`汇报_插件隔离与热更新.md` CLAIM 0-3b/9-9, `汇报_权限治理spike.md`
 * P0-P7/8-8).
 *
 * Protocol (JSON messages over whichever transport the launcher provides):
 *   parent -> child: { type: 'call', id, name, payload }
 *   child  -> parent: { type: 'result', id, ok, result? , error? }
 *   child  -> parent: { type: 'ready' }              (once, after first load)
 *   child  -> parent: { type: 'reloaded', ok, error? } (after every (re)load)
 */

import { existsSync, readFileSync, writeFileSync, watch } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createPluginFetchGate } from './security/plugin-fetch-gate'

export type PluginHostApi = Readonly<{
  registerCapability: (name: string, fn: (payload: unknown) => unknown) => void
  hostState: Record<string, unknown>
  fetch: (url: string) => Promise<{ status: number; body: string }>
}>

export type PluginModule = Readonly<{
  register: (api: PluginHostApi) => void
  dispose?: () => void
}>

type Transport = Readonly<{
  send: (message: Record<string, unknown>) => void
  onMessage: (handler: (message: Record<string, unknown>) => void) => void
}>

/**
 * Picks the right IPC surface depending on how this file was launched. An
 * Electron utility process exposes `process.parentPort`; a plain
 * `child_process.fork()`'d process exposes `process.send`/`process.on('message')`.
 */
function createTransport(): Transport {
  const parentPort = (process as unknown as {
    parentPort?: {
      postMessage: (message: unknown) => void
      on: (event: 'message', handler: (event: { data: unknown }) => void) => void
    }
  }).parentPort
  if (parentPort) {
    return {
      send: (message) => parentPort.postMessage(message),
      onMessage: (handler) => parentPort.on('message', (event) => handler(event.data as Record<string, unknown>))
    }
  }
  return {
    send: (message) => {
      process.send?.(message)
    },
    onMessage: (handler) => {
      process.on('message', (message) => handler(message as Record<string, unknown>))
    }
  }
}

export function runPluginHostEntry(argv: readonly string[] = process.argv.slice(2)): void {
  const pluginFile = argv[0]
  const stateFile = argv[1]
  const netDomains: readonly string[] = argv[2] ? JSON.parse(argv[2]) : []
  if (!pluginFile) throw new Error('plugin-host-entry: missing plugin entry path argument')

  const transport = createTransport()
  const fetchGate = createPluginFetchGate(netDomains)
  const capabilities = new Map<string, (payload: unknown) => unknown>()
  let currentPlugin: PluginModule | undefined
  const hostState: Record<string, unknown> = stateFile && existsSync(stateFile)
    ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>)
    : {}

  function persistState(): void {
    if (!stateFile) return
    writeFileSync(stateFile, JSON.stringify(hostState), 'utf8')
  }

  async function loadPlugin(): Promise<{ ok: boolean; error?: string }> {
    try {
      const mod = (await import(`${pathToFileURL(pluginFile).href}?t=${Date.now()}`)) as { plugin: PluginModule }
      const candidate = mod.plugin
      const staged = new Map<string, (payload: unknown) => unknown>()
      const api: PluginHostApi = {
        registerCapability: (name, fn) => staged.set(name, fn),
        hostState,
        fetch: fetchGate
      }
      // Staged commit: if register() throws, `staged` is discarded and the
      // previously loaded plugin (if any) is left completely untouched.
      candidate.register(api)
      if (currentPlugin) {
        try {
          currentPlugin.dispose?.()
        } catch {
          // A plugin's own dispose() throwing must not block the new version
          // from taking over, and must not crash the host.
        }
      }
      capabilities.clear()
      for (const [name, fn] of staged) capabilities.set(name, fn)
      currentPlugin = candidate
      persistState()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.stack ?? error) }
    }
  }

  async function dispatch(name: string, payload: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const fn = capabilities.get(name)
    if (!fn) return { ok: false, error: `unknown capability: ${name}` }
    try {
      const result = await fn(payload)
      persistState()
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.stack ?? error) }
    }
  }

  transport.onMessage((message) => {
    if (message.type === 'call') {
      const { id, name, payload } = message as { id: string; name: string; payload: unknown }
      void dispatch(name, payload).then((outcome) => transport.send({ type: 'result', id, ...outcome }))
    }
  })

  // Hot reload trigger: watching the plugin's own file is what makes "edit the
  // file, no restart needed" true, rather than requiring the parent to know a
  // reload happened.
  watch(pluginFile, { persistent: true }, () => {
    void loadPlugin().then((outcome) => transport.send({ type: 'reloaded', ...outcome }))
  })

  void loadPlugin().then((outcome) => transport.send({ type: 'ready', ...outcome }))
}

// This file IS the child process's entry module (forked directly by
// runtime-host.ts's launcher) — so it runs itself on load, rather than
// requiring a separate bootstrap file.
runPluginHostEntry()
