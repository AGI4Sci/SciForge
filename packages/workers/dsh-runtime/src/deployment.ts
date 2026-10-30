/// <reference path="./yaml.d.ts" />
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep, win32 } from 'node:path'
import { createHash } from 'node:crypto'
import { DshRuntimeError, resolveDshLaunchInvocation } from './transport.js'
import yaml from 'js-yaml'
import type { DshDeployment, DshRuntimeOptions } from './types.js'
import { DSH_MODEL_ROUTER_PATCH, modelRouterEnvironment } from './model-router.js'

/** Audited against dsh-v0.2.0-rc.2 / 639ed015397290b3745d163aafe02ffee4aa3f84.
 * The invariants below (disabled entry set, approval: ask, ACP, telemetry,
 * dsh-tool plugin closure) are enforced version-agnostically from the boot-free
 * composed-config dump; re-audit this set whenever a new upstream release is
 * adopted or pinned. */
export const DSH_DISABLED_ENTRY_IDS = [
  'tool-plugin-manager', 'plugin-manager', 'config-editor', 'settings',
  'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'skill', 'skill-filesystem', 'tool-skill', 'plan-mode', 'subagent',
  'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork',
  'tool-workflow', 'timeout-policy', 'tool-todo', 'tool-goal', 'tool-ralph', 'tool-web',
  'mcp-resources', 'otel', 'session-telemetry-otel'
] as const
/** The only entries the Host's command-execution switch may re-enable. They are
 * the model-facing shell tools; the DSH sandbox, permission presets and the
 * approval policy that own their execution stay enabled and reviewed in every
 * deployment, so an enabled shell still runs sandboxed and still asks. */
export const DSH_COMMAND_EXECUTION_ENTRY_IDS: readonly string[] = ['tool-bash', 'tool-pwsh']
/** Plugin names belonging to those entries, excluded from the disabled families
 * below when (and only when) the switch is on. Every other `dsh-tool-*` plugin
 * stays disabled unconditionally. */
export const DSH_COMMAND_EXECUTION_PLUGIN_NAMES: readonly RegExp[] = [
  /^@deepseek-ai\/dsh-tool-bash$/,
  /^@deepseek-ai\/dsh-tool-pwsh$/
]
/** Reviewed version-agnostic policy: these plugin families are never enabled in
 * a Host-launched deployment, regardless of which entry ids a given release
 * registers. Covers every native tool, web, subagent, skill, plan-mode,
 * mcp-resources, plugin-manager, config-editor/settings and telemetry plugin.
 * The model-facing shell plugins are excluded only by
 * DSH_COMMAND_EXECUTION_PLUGIN_NAMES when the command-execution switch is on. */
export const DSH_DISABLED_PLUGIN_NAME_PATTERNS: readonly RegExp[] = [
  /^@deepseek-ai\/dsh-tool-/,
  /^@deepseek-ai\/dsh-web/,
  /^@deepseek-ai\/dsh-subagent/,
  /^@deepseek-ai\/dsh-skill/,
  /^@deepseek-ai\/dsh-plan-mode/,
  /^@deepseek-ai\/dsh-mcp-resources/,
  /^@deepseek-ai\/dsh-plugin-manager/,
  /^@deepseek-ai\/dsh-config-editor$/,
  /^@deepseek-ai\/dsh-settings$/,
  /^@deepseek-ai\/dsh-otel/,
  /^@deepseek-ai\/dsh-session-telemetry/
]
/** The reviewed decision input for one deployment attempt. `false` (the default
 * everywhere) reproduces the audited composition byte for byte; `true` only
 * lifts the two shell tools out of the disabled closure. */
export type DshCommandExecutionMode = boolean

function commandExecutionDisabled(entryIdOrPluginName: string, commandExecution: DshCommandExecutionMode, patterns: readonly RegExp[]): boolean {
  if (patterns.some(pattern => pattern.test(entryIdOrPluginName))) return !commandExecution
  return DSH_DISABLED_PLUGIN_NAME_PATTERNS.some(pattern => pattern.test(entryIdOrPluginName))
}

/** Entry ids the safety patch must disable for this mode. */
export function dshDisabledEntryIds(commandExecution: DshCommandExecutionMode): readonly string[] {
  return commandExecution
    ? DSH_DISABLED_ENTRY_IDS.filter(id => !DSH_COMMAND_EXECUTION_ENTRY_IDS.includes(id))
    : DSH_DISABLED_ENTRY_IDS
}
/** Release-audited default route, part of the packaged pin identity. */
export const DSH_DEFAULT_ACP_ROUTE = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } as const
export const DSH_SAFETY_PATCH = JSON.stringify([
  ...DSH_DISABLED_ENTRY_IDS.map(id => ({ id, disabled: true })),
  { id: 'approval', config: { policy: 'ask' } },
  { id: 'acp', config: { provider: DSH_DEFAULT_ACP_ROUTE.provider, model: DSH_DEFAULT_ACP_ROUTE.model } }
], null, 2) + '\n'
/** The safety patch bytes are a release input for the packaged pin: the default
 * (undefined) must stay byte-identical to DSH_SAFETY_PATCH. null drops the acp
 * config row entirely so a discovered install keeps its own default route;
 * the composed-config validator still requires the acp entry to be enabled. */
export function createDshSafetyPatch(
  defaultAcpRoute?: { provider: string; model: string } | null,
  commandExecution: DshCommandExecutionMode = false
): string {
  // The audited bytes are the packaged pin's config identity: the default mode
  // must keep returning DSH_SAFETY_PATCH itself, never a rebuilt equal string.
  if (defaultAcpRoute === undefined && !commandExecution) return DSH_SAFETY_PATCH
  return JSON.stringify([
    ...dshDisabledEntryIds(commandExecution).map(id => ({ id, disabled: true })),
    { id: 'approval', config: { policy: 'ask' } },
    ...defaultAcpRoute === null ? [] : [{ id: 'acp', config: { provider: (defaultAcpRoute ?? DSH_DEFAULT_ACP_ROUTE).provider, model: (defaultAcpRoute ?? DSH_DEFAULT_ACP_ROUTE).model } }]
  ], null, 2) + '\n'
}
const exec = promisify(execFile)
/** Parse !!js as inert text, never evaluate deployment expressions in the Host. */
export function canonicalizeDshComposedConfig(text: string): string {
  // DSH annotates each patched row with the absolute patch-file path. The path is
  // intentionally per-launch, so it must not enter the release identity.
  return text.replace(/patched by [^\r\n]+/g, 'patched by <host-safety-patch>')
}
const composedConfigSchema = () => yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: string) => ({ __jsExpr: value }) })])
function parseComposedConfigEntries(text: string): Record<string, any>[] {
  const entries = yaml.load(text, { schema: composedConfigSchema() })
  if (!Array.isArray(entries)) throw new Error()
  return entries
}
export function validateDshComposedConfig(
  text: string,
  commandExecution: DshCommandExecutionMode = false
) {
  try {
    const entries = parseComposedConfigEntries(text)
    let acp = false; let approval = false; let telemetry = false
    const walk = (value: any, ancestors: Set<object>) => {
      if (!value || typeof value !== 'object') return
      if (ancestors.has(value)) throw new Error()
      const path = new Set(ancestors); path.add(value)
      if (typeof value.id === 'string') {
        if (dshDisabledEntryIds(commandExecution).includes(value.id) && value.disabled !== true) throw new Error()
        if (value.id === 'acp') { if (value.disabled === true) throw new Error(); acp = true }
        if (value.id === 'approval') { if (value.disabled === true || value.config?.policy !== 'ask') throw new Error(); approval = true }
        if (value.id === 'session-telemetry-otel') { if (value.disabled !== true) throw new Error(); telemetry = true }
      }
      if (typeof value.name === 'string' && /^@deepseek-ai\/dsh-tool-/.test(value.name)
        && commandExecutionDisabled(value.name, commandExecution, DSH_COMMAND_EXECUTION_PLUGIN_NAMES)
        && value.disabled !== true) throw new Error()
      for (const child of Object.values(value)) walk(child, path)
    }
    walk(entries, new Set())
    if (!acp || !approval || !telemetry) throw new Error()
  } catch { throw new DshRuntimeError('runtime_config_unsafe') }
}
/** Version-agnostic invariant check for derived (discovered) deployments:
 * acp enabled, approval ask, telemetry entries (when present) disabled, every
 * statically listed entry still disabled, and NO enabled entry from any
 * reviewed dangerous plugin family — including ones a newer release adds. */
export function validateDshDerivedComposedConfig(
  text: string,
  commandExecution: DshCommandExecutionMode = false
) {
  try {
    const entries = parseComposedConfigEntries(text)
    let acp = false; let approval = false
    const walk = (value: any, ancestors: Set<object>) => {
      if (!value || typeof value !== 'object') return
      if (ancestors.has(value)) throw new Error()
      const path = new Set(ancestors); path.add(value)
      if (typeof value.id === 'string') {
        if (dshDisabledEntryIds(commandExecution).includes(value.id) && value.disabled !== true) throw new Error()
        if (value.id === 'acp') { if (value.disabled === true) throw new Error(); acp = true }
        if (value.id === 'approval') { if (value.disabled === true || value.config?.policy !== 'ask') throw new Error(); approval = true }
      }
      if (typeof value.name === 'string' && commandExecutionDisabled(value.name, commandExecution, DSH_COMMAND_EXECUTION_PLUGIN_NAMES) && value.disabled !== true) throw new Error()
      for (const child of Object.values(value)) walk(child, path)
    }
    walk(entries, new Set())
    if (!acp || !approval) throw new Error()
  } catch { throw new DshRuntimeError('runtime_config_unsafe') }
}
/** Build the safety patch from the install's own unpatched dump: disable only
 * entries that actually exist (statically listed ids or a reviewed dangerous
 * plugin family), so removed entries never trigger "entry not found" and newly
 * introduced ones are still shut off. approval/acp rows follow the same
 * semantics as the static patch. */
export function createDshDerivedSafetyPatch(
  unpatchedDump: string,
  defaultAcpRoute?: { provider: string; model: string } | null,
  commandExecution: DshCommandExecutionMode = false
): string {
  let entries: Record<string, any>[]
  try { entries = parseComposedConfigEntries(unpatchedDump) } catch { throw new DshRuntimeError('runtime_deployment_unapproved') }
  const rows: Record<string, unknown>[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (dshDisabledEntryIds(commandExecution).includes(entry.id) || commandExecutionDisabled(name, commandExecution, DSH_COMMAND_EXECUTION_PLUGIN_NAMES)) {
      rows.push({ id: entry.id, disabled: true })
    }
  }
  rows.push({ id: 'approval', config: { policy: 'ask' } })
  const acpRoute = defaultAcpRoute === undefined ? DSH_DEFAULT_ACP_ROUTE : defaultAcpRoute
  if (acpRoute) rows.push({ id: 'acp', config: { provider: acpRoute.provider, model: acpRoute.model } })
  return JSON.stringify(rows, null, 2) + '\n'
}
/** Reviewed discovery policy for a user-installed executable: no artifact byte
 * pin exists, so approval is a parseable non-empty --version, the ACP agentInfo
 * handshake, and the version-agnostic derived composed-config safety
 * validation; only the packaged artifact is version-pinned. */
export function createDiscoveredDshDeployment(
  commandExecution: DshCommandExecutionMode = false
): { verifyDeployment(deployment: DshDeployment): Promise<void> } {
  return {
    verifyDeployment: async deployment => {
      // The switch is part of the boundary: an enabled shell is approved only
      // for the deployment mode that was actually requested.
      validateDshDerivedComposedConfig(deployment.composedConfig, commandExecution)
    }
  }
}
const allowed = new Set(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'])
export function createDshEnvironment(options: DshRuntimeOptions, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  // Minimal platform-native PATH; the child env never inherits ambient values.
  // The composed-config digest (pin identity) covers config bytes only, never
  // process env, so platform-specific launch environments cannot weaken a pin.
  // A script interpreter CLI (e.g. a `#!/usr/bin/env node` entry point) can only
  // resolve its interpreter through PATH, so the executable's own directory is
  // included — version managers and npm/Homebrew co-locate node with the shim.
  const pathApi = platform === 'win32' ? win32 : posix
  const executableDir = options.executable && pathApi.isAbsolute(options.executable) ? pathApi.dirname(options.executable) : undefined
  const systemPath = platform === 'win32' ? windowsSystemPath() : '/usr/bin:/bin:/usr/sbin:/sbin'
  const env: NodeJS.ProcessEnv = {
    PATH: executableDir ? executableDir + (platform === 'win32' ? ';' : ':') + systemPath : systemPath,
    HOME: options.stateDirectory,
    TMPDIR: join(options.stateDirectory, 'tmp'), TEMP: join(options.stateDirectory, 'tmp'), TMP: join(options.stateDirectory, 'tmp'),
    DSH_HOME: join(options.stateDirectory, 'dsh'), DSH_TELEMETRY_MODE: 'DISABLED',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8'
  }
  if (platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot || 'C:\\Windows'
    env.COMSPEC = process.env.ComSpec || join(env.SystemRoot, 'System32', 'cmd.exe')
  }
  for (const [key, value] of Object.entries(options.providerEnv ?? {})) {
    if (!allowed.has(key)) throw new DshRuntimeError('runtime_env_not_allowed')
    env[key] = value
  }
  if (options.modelRouter) Object.assign(env, modelRouterEnvironment(options.modelRouter))
  return env
}
function windowsSystemPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return [join(systemRoot, 'System32'), systemRoot, join(systemRoot, 'System32', 'Wbem')].join(';')
}
export async function prepareDeployment(options: DshRuntimeOptions & { commandExecution?: DshCommandExecutionMode }) {
  if (!options.executable || !isAbsolute(options.executable) || !isAbsolute(options.stateDirectory) || (options.artifactRoot !== undefined && (!isAbsolute(options.artifactRoot) || (() => { const r = relative(options.artifactRoot!, options.executable!); return r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r) })())) || typeof options.verifyDeployment !== 'function') throw new DshRuntimeError('runtime_deployment_unapproved')
  // Host-owned, per-attempt decision; anything but an explicit true keeps the
  // audited closure (fail-closed default).
  const commandExecution = options.commandExecution === true
  await options.verifyExecutable?.()
  const env = createDshEnvironment(options)
  await mkdir(env.TMPDIR!, { recursive: true, mode: 0o700 })
  await mkdir(env.DSH_HOME!, { recursive: true, mode: 0o700 })
  const scratch = await mkdtemp(join(options.stateDirectory, 'launch-'))
  const patch = join(scratch, 'host-safety.patch.json')
  const prefix = [...(options.executableArgs ?? [])]
  const args = [...prefix, 'acp', '--patch', patch]
  try {
    const execution = { cwd: options.stateDirectory, env, timeout: options.requestTimeoutMs ?? 15_000, maxBuffer: 4 * 1024 * 1024 }
    const versionInvocation = resolveDshLaunchInvocation(options.executable, [...prefix, '--version'])
    const rawVersion = (await exec(versionInvocation.command, [...versionInvocation.args], execution)).stdout.trim()
    const version = rawVersion.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? ''
    // Discovered installs are not version-pinned; an explicit expectedVersion
    // (the packaged pinned artifact) still demands an exact match.
    if (!version || (options.expectedVersion !== undefined && version !== options.expectedVersion)) throw new DshRuntimeError('runtime_version_unsupported')
    // A derived patch is built from the install's own unpatched dump, so it
    // only ever references entries that release actually registers.
    const derived = options.safetyPatch === 'derived'
    let safetyPatch: string
    if (derived) {
      const baseInvocation = resolveDshLaunchInvocation(options.executable, [...prefix, 'acp', '--dump-config'])
      const unpatchedDump = (await exec(baseInvocation.command, [...baseInvocation.args], execution)).stdout
      safetyPatch = createDshDerivedSafetyPatch(unpatchedDump, options.defaultAcpRoute, commandExecution)
    } else {
      safetyPatch = createDshSafetyPatch(options.defaultAcpRoute, commandExecution)
    }
    await writeFile(patch, options.modelRouter ? yaml.dump(JSON.parse(safetyPatch)) + DSH_MODEL_ROUTER_PATCH : safetyPatch, { mode: 0o600 })
    const dumpInvocation = resolveDshLaunchInvocation(options.executable, [...args, '--dump-config'])
    const composedConfig = (await exec(dumpInvocation.command, [...dumpInvocation.args], execution)).stdout
    if (derived) validateDshDerivedComposedConfig(composedConfig, commandExecution)
    else validateDshComposedConfig(composedConfig, commandExecution)
    const configDigest = createHash('sha256').update(canonicalizeDshComposedConfig(composedConfig)).digest('hex')
    // Boot-free dump precedes ACP startup. The trusted Host must pin the entire composition,
    // reject unknown executable plugins, and confirm all safety rows were actually applied.
    await options.verifyDeployment({ version, composedConfig, configDigest, executable: options.executable })
    return { args, env, version, cleanup: () => rm(scratch, { recursive: true, force: true }) }
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    if (error instanceof DshRuntimeError) throw error
    throw new DshRuntimeError('runtime_deployment_unapproved')
  }
}
