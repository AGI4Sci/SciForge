/**
 * Parent-side runtime host for a sandboxed domain package (plugin/extension).
 *
 * Launches `plugin-host-entry.ts` in a separate process, with filesystem access
 * restricted to the paths the package's `requestedPermissions` declare (via
 * Node's `--permission` model, `security/build-permission-flags.ts`) and network
 * access restricted to a domain allow-list enforced host-side inside that child
 * (`security/plugin-fetch-gate.ts`). Permission declarations come straight from
 * the existing `SandboxedDomainPackageDefinition` contract
 * (`@sciforge/domain-sdk/contract`) — no separate plugin manifest format.
 *
 * Isolation guarantee (this is the answer to "核心代码受保护，程序永远不会死"):
 * the plugin runs in its own OS process. If it throws, hangs, or the process
 * dies outright, `onCrash` fires and every in-flight `dispatch()` call rejects
 * with a structured error — the host process calling `PluginRuntimeHost` never
 * throws an unhandled exception because of something a plugin did.
 *
 * Hot reload (the answer to "插件代码可热更新、修改，不需要重启程序"): the child
 * watches its own plugin file and reloads on change with a staged-commit
 * registration (`plugin-host-entry.ts`), so a bad edit leaves the previous,
 * working version running instead of taking the plugin down.
 *
 * Process launcher is injectable. The default (`createChildProcessLauncher`)
 * uses `node:child_process.fork` and is what this file's own tests exercise for
 * real. `createUtilityProcessLauncher` uses Electron's `utilityProcess.fork` —
 * the primitive `eval-cases/spike-plugin-hotreload/electron-host/main.mjs`
 * verified by code review (E1-E5) but could not execute in this development
 * environment (no macOS Electron binary here); swapping it in is a one-line
 * change at the call site, not a rewrite.
 */

import { fork, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SandboxedDomainPackageDefinition } from '@sciforge/domain-sdk/contract'
import { buildPermissionFlags } from './security/build-permission-flags'
import { resolvePluginFsPermissions, resolvePluginNetDomains } from './security/permission-mapping'

const PLUGIN_HOST_ENTRY_PATH = resolve(fileURLToPath(import.meta.url), '../plugin-host-entry.ts')
// plugin-host-entry.ts imports this module; Node's `--permission` fs gate applies to the
// child's OWN module loads too, so every local module it imports must also be in the
// read allow-list, not just its own entry file (the same lesson build-permission-flags.ts
// documents for the entry script itself).
const PLUGIN_FETCH_GATE_PATH = resolve(fileURLToPath(import.meta.url), '../security/plugin-fetch-gate.ts')

export type LaunchedPluginProcess = Readonly<{
  send: (message: Record<string, unknown>) => void
  onMessage: (handler: (message: Record<string, unknown>) => void) => void
  onExit: (handler: (code: number | null) => void) => void
  kill: () => void
}>

export type PluginProcessLauncher = (options: Readonly<{
  execArgv: readonly string[]
  args: readonly string[]
}>) => LaunchedPluginProcess

/** Default launcher: a plain Node child process. This is what gets tested here. */
export function createChildProcessLauncher(): PluginProcessLauncher {
  return ({ execArgv, args }) => {
    const child: ChildProcess = fork(PLUGIN_HOST_ENTRY_PATH, [...args], {
      execArgv: [...execArgv, '--experimental-strip-types'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    return {
      send: (message) => child.send(message),
      onMessage: (handler) => child.on('message', (message) => handler(message as Record<string, unknown>)),
      onExit: (handler) => child.on('exit', (code) => handler(code)),
      kill: () => child.kill()
    }
  }
}

/**
 * Production launcher using Electron's `utilityProcess.fork`. Requires
 * `electron` and can only run inside an Electron main process — not exercised
 * by this repo's test suite in this development environment. See the module
 * doc comment above for why, and `汇报_插件隔离与热更新.md` for the code-review
 * verification this design is based on.
 */
export async function createUtilityProcessLauncher(): Promise<PluginProcessLauncher> {
  const { utilityProcess } = await import('electron')
  return ({ execArgv, args }) => {
    const child = utilityProcess.fork(PLUGIN_HOST_ENTRY_PATH, [...args], {
      execArgv: [...execArgv, '--experimental-strip-types'],
      serviceName: 'sciforge-plugin-host'
    })
    return {
      send: (message) => child.postMessage(message),
      onMessage: (handler) => child.on('message', (message) => handler(message as Record<string, unknown>)),
      onExit: (handler) => child.on('exit', (code) => handler(code)),
      kill: () => child.kill()
    }
  }
}

export type DispatchOutcome = Readonly<{ ok: true; result: unknown }> | Readonly<{ ok: false; error: string }>

export type PluginRuntimeHostOptions = Readonly<{
  definition: SandboxedDomainPackageDefinition
  installPath: string
  stateFilePath?: string
  launcher?: PluginProcessLauncher
  onCrash?: (code: number | null) => void
}>

export class PluginRuntimeHost {
  readonly #launcher: PluginProcessLauncher
  readonly #execArgv: readonly string[]
  readonly #args: readonly string[]
  #process: LaunchedPluginProcess | undefined
  #nextCallId = 0
  readonly #pending = new Map<string, { resolve: (outcome: DispatchOutcome) => void }>()
  readonly #onCrash: ((code: number | null) => void) | undefined

  constructor(options: PluginRuntimeHostOptions) {
    const mainEntrypoint = options.definition.entrypoints.find((entry) => entry.process === 'main')
    if (!mainEntrypoint) {
      throw new Error(
        `Sandboxed domain package ${options.definition.packageName} declares no 'main' entrypoint.`
      )
    }
    const pluginFile = resolve(options.installPath, mainEntrypoint.entry)
    const fsPermissions = resolvePluginFsPermissions(options.definition.requestedPermissions)
    const netDomains = resolvePluginNetDomains(options.definition.requestedPermissions)

    // The state file is the HOST's own mechanism for "state ownership lives in
    // the host, not the plugin" (design.md §2) — it is not something a plugin
    // declares via `requestedPermissions`, so it is granted independently of
    // the plugin's own fs.read/fs.write declarations.
    const stateFilePaths = options.stateFilePath ? [options.stateFilePath] : []
    this.#execArgv = buildPermissionFlags({
      read: [
        PLUGIN_HOST_ENTRY_PATH,
        PLUGIN_FETCH_GATE_PATH,
        pluginFile,
        ...stateFilePaths,
        ...fsPermissions.read.map((path) => resolve(options.installPath, path))
      ],
      write: [
        ...stateFilePaths,
        ...fsPermissions.write.map((path) => resolve(options.installPath, path))
      ]
    })
    this.#args = [
      pluginFile,
      options.stateFilePath ?? '',
      JSON.stringify([...netDomains])
    ]
    this.#launcher = options.launcher ?? createChildProcessLauncher()
    this.#onCrash = options.onCrash
  }

  start(): void {
    const child = this.#launcher({ execArgv: this.#execArgv, args: this.#args })
    child.onMessage((message) => {
      if (message.type === 'result') {
        const { id, ...outcome } = message as { id: string } & DispatchOutcome
        this.#pending.get(id)?.resolve(outcome as DispatchOutcome)
        this.#pending.delete(id)
      }
    })
    child.onExit((code) => {
      // Isolation, not escalation: a dead plugin process rejects whatever is
      // still waiting on it instead of leaving callers hanging, and notifies
      // whoever owns this host so they can decide whether to respawn — but
      // this method itself never throws.
      for (const [id, entry] of this.#pending) {
        entry.resolve({ ok: false, error: `plugin process exited (code ${code})` })
        this.#pending.delete(id)
      }
      this.#process = undefined
      this.#onCrash?.(code)
    })
    this.#process = child
  }

  async dispatch(name: string, payload: unknown): Promise<DispatchOutcome> {
    if (!this.#process) {
      return { ok: false, error: 'plugin process is not running' }
    }
    const id = String(this.#nextCallId++)
    return new Promise<DispatchOutcome>((resolvePromise) => {
      this.#pending.set(id, { resolve: resolvePromise })
      this.#process!.send({ type: 'call', id, name, payload })
    })
  }

  stop(): void {
    this.#process?.kill()
    this.#process = undefined
  }
}
