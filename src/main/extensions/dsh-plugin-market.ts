/**
 * In-app market over the published index.
 *
 * Flow for an install: read the catalog entry → acquire the artifact (digest is
 * checked against the catalog AND re-checked inside the installer) → verify the
 * publisher signature against the host keyring → stage and swap atomically →
 * activate. The catalog is a convenience, never an authority: everything it says
 * is re-checked, and a catalog that disagrees with the artifact is a refusal.
 *
 * Progress is reported as real phases and real byte counts. There is no invented
 * percentage: when a download has no known length, the phase is all we claim.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  installDshPluginArtifact,
  uninstallDshPlugin,
  type DshPluginInstallDeps
} from './dsh-plugin-install'
import { readDshPluginPolicy } from './dsh-plugin-policy'
import { sha256Hex } from './dsh-plugin-artifact'
import type {
  DshMarketInstallInput,
  DshMarketInstallResult,
  DshMarketPackageInput,
  DshMarketPlugin as DshMarketPluginView,
  DshMarketProgress as DshMarketProgressView,
  DshMarketSetEnabledInput,
  DshMarketView
} from '../../shared/dsh-market'

const identifier = /^[a-z0-9][a-z0-9._-]*$/
const sha256Pattern = /^[0-9a-f]{64}$/

const dshMarketPluginSchema = z.object({
  name: z.string().trim().min(1).max(214),
  title: z.string().trim().min(1).max(128).optional(),
  version: z.string().trim().min(1).max(64),
  form: z.literal('dsh-runtime'),
  categories: z.array(z.string().trim().min(1).max(64)).max(16).default([]),
  entry: z.string().trim().min(1).max(1_024),
  tools: z.array(z.object({
    name: z.string().trim().min(1).max(128),
    /** Capability id the grant authorizes, as declared by the artifact. */
    id: z.string().trim().min(1).max(192),
    effect: z.enum(['read', 'compute', 'workspace-write', 'external-write', 'destructive'])
  }).strict()).max(64),
  hostDependencies: z.array(z.string().trim().min(1).max(214)).max(64),
  publisher: z.string().trim().min(1).max(128).regex(identifier).nullable(),
  artifact: z.object({
    file: z.string().trim().min(1).max(1_024),
    sizeBytes: z.number().int().positive().max(512 * 1024 * 1024),
    sha256: z.string().regex(sha256Pattern)
  }).strict(),
  /** Why this plugin cannot be called for real yet, when that is known. */
  runtimeNote: z.string().trim().min(1).max(1_024).nullable().default(null),
  /** Where this plugin lives in the source tree, for traceability. */
  source: z.string().trim().min(1).max(512)
}).strict()

const dshMarketBlockedSchema = z.object({
  name: z.string().trim().min(1).max(214),
  plugin: z.string().trim().min(1).max(214),
  version: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(2_048),
  detail: z.string().trim().min(1).max(2_048).nullable().default(null),
  runtimeGap: z.string().trim().min(1).max(2_048).nullable().default(null)
}).strict()

export const dshMarketIndexSchema = z.object({
  format: z.literal(1),
  generatedAt: z.string().trim().min(1).max(64),
  dshRuntimeVersion: z.string().trim().min(1).max(64),
  plugins: z.array(dshMarketPluginSchema).max(512),
  blocked: z.array(dshMarketBlockedSchema).max(512).default([])
}).strict()

export type DshMarketPlugin = z.infer<typeof dshMarketPluginSchema>
export type DshMarketBlocked = z.infer<typeof dshMarketBlockedSchema>
export type DshMarketIndex = z.infer<typeof dshMarketIndexSchema>

export type DshMarketSource = Readonly<{ kind: 'file'; path: string } | { kind: 'url'; url: string }>

/** Where the catalog comes from: an explicit host setting, else the bundled copy. */
export function resolveDshMarketSource(
  options: Readonly<{ configured?: string; bundledIndexPath?: string; env: Readonly<Record<string, string | undefined>> }>
): DshMarketSource | undefined {
  const configured = options.configured?.trim() || options.env.SCIFORGE_MARKET_INDEX?.trim()
  if (configured) {
    return /^https?:\/\//.test(configured) ? { kind: 'url', url: configured } : { kind: 'file', path: resolve(configured) }
  }
  return options.bundledIndexPath ? { kind: 'file', path: resolve(options.bundledIndexPath) } : undefined
}

export async function readDshMarketIndex(source: DshMarketSource): Promise<DshMarketIndex> {
  const text = source.kind === 'file'
    ? await readFile(source.path, 'utf8')
    : await fetchIndexText(source.url)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`The plugin market index is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = dshMarketIndexSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `The plugin market index is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
    )
  }
  const names = new Set<string>()
  for (const plugin of result.data.plugins) {
    if (names.has(plugin.name)) throw new Error(`The plugin market index lists ${plugin.name} twice.`)
    names.add(plugin.name)
  }
  return result.data
}

async function fetchIndexText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`The plugin market index at ${url} returned HTTP ${response.status}.`)
  return response.text()
}

export type DshMarketInstallPhase = 'downloading' | 'verifying' | 'installing' | 'activating' | 'done' | 'failed'

export type DshMarketProgress = Readonly<{
  packageName: string
  phase: DshMarketInstallPhase
  bytesReceived?: number
  bytesTotal?: number
  message?: string
}>

export type DshMarketInstallOutcome = Readonly<{
  packageName: string
  version: string
  installedDirectory: string
  sha256: string
  tools: readonly string[]
}>

export type DshMarketDeps = Readonly<{
  source: DshMarketSource
  installDeps: Omit<DshPluginInstallDeps, 'policyPath'> & Readonly<{ policyPath: string }>
  /** Fetches bytes for a URL artifact; the default uses fetch with a size guard. */
  fetchBytes?: (url: string, onProgress: (received: number) => void) => Promise<Uint8Array>
  onProgress?: (progress: DshMarketProgress) => void
}>

/**
 * Resolves an artifact reference against the catalog location. Relative paths are
 * resolved next to the index, so one published catalog works both from a file
 * checkout and from a static host.
 */
export function resolveArtifactLocation(source: DshMarketSource, file: string): DshMarketSource {
  if (/^https?:\/\//.test(file)) return { kind: 'url', url: file }
  if (source.kind === 'file') return { kind: 'file', path: join(dirname(source.path), 'artifacts', file) }
  return { kind: 'url', url: new URL(`artifacts/${file}`, source.url).toString() }
}

export async function installDshMarketPlugin(
  deps: DshMarketDeps,
  request: Readonly<{ packageName: string; approvedToolNames: readonly string[] }>
): Promise<DshMarketInstallOutcome> {
  const report = (progress: DshMarketProgress) => deps.onProgress?.(progress)
  const index = await readDshMarketIndex(deps.source)
  const entry = index.plugins.find((plugin) => plugin.name === request.packageName)
  if (!entry) {
    const blocked = index.blocked.find((plugin) => plugin.name === request.packageName)
    throw new Error(blocked
      ? `Plugin ${request.packageName} is not installable: ${blocked.reason}`
      : `Plugin ${request.packageName} is not in the market index.`)
  }

  // The catalog cannot widen what the user approved: the plugin's own declared
  // tools must be exactly what the user agreed to.
  const declared = entry.tools.map((tool) => tool.name).sort()
  const approved = [...new Set(request.approvedToolNames)].sort()
  if (declared.length !== approved.length || declared.some((tool, position) => tool !== approved[position])) {
    throw new Error(
      `Approving ${approved.join(', ') || 'nothing'} does not match what ${entry.name} declares (${declared.join(', ')}).`
    )
  }

  report({ packageName: entry.name, phase: 'downloading' })
  const location = resolveArtifactLocation(deps.source, entry.artifact.file)
  const bytes = location.kind === 'file'
    ? await readFile(location.path)
    : await (deps.fetchBytes ?? defaultFetchBytes)(location.url, (received) => {
        report({
          packageName: entry.name,
          phase: 'downloading',
          bytesReceived: received,
          bytesTotal: entry.artifact.sizeBytes
        })
      })

  report({ packageName: entry.name, phase: 'verifying' })
  if (bytes.byteLength !== entry.artifact.sizeBytes) {
    throw new Error(
      `The downloaded artifact is ${bytes.byteLength} bytes but the market index published ${entry.artifact.sizeBytes}.`
    )
  }
  const digest = sha256Hex(bytes)
  if (digest !== entry.artifact.sha256) {
    throw new Error(`The downloaded artifact digest ${digest} does not match the published digest ${entry.artifact.sha256}.`)
  }

  report({ packageName: entry.name, phase: 'installing' })
  const policy = await readDshPluginPolicy(deps.installDeps.policyPath)
  const installed = await installDshPluginArtifact(deps.installDeps, {
    artifactBytes: bytes,
    expectedSha256: entry.artifact.sha256,
    approvedToolNames: approved,
    source: deps.source.kind === 'file' ? deps.source.path : deps.source.url
  }, policy)

  report({ packageName: entry.name, phase: 'activating' })
  await deps.installDeps.service.refreshDiscoveredPlugins()
  report({ packageName: entry.name, phase: 'done' })
  return {
    packageName: installed.packageName,
    version: installed.version,
    installedDirectory: installed.installedDirectory,
    sha256: installed.artifactSha256,
    tools: installed.tools
  }
}

/** A stalled download must fail closed instead of hanging the install forever. */
export const MARKET_DOWNLOAD_TIMEOUT_MS = 120_000

/** Real download with a hard size guard and a bounded wait; reports bytes as they arrive. */
export async function defaultFetchBytes(
  url: string,
  onProgress: (received: number) => void,
  timeoutMs: number = MARKET_DOWNLOAD_TIMEOUT_MS
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const timedOut = () => new Error(`Downloading ${url} did not finish within ${timeoutMs} ms.`)
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal })
    if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`)
    const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declaredLength) && declaredLength > 512 * 1024 * 1024) {
      throw new Error(`The artifact at ${url} declares ${declaredLength} bytes, above the market limit.`)
    }
    const chunks: Uint8Array[] = []
    let received = 0
    for await (const chunk of response.body ?? []) {
      if (controller.signal.aborted) throw timedOut()
      received += chunk.byteLength
      if (received > 512 * 1024 * 1024) throw new Error(`The artifact at ${url} exceeds the market size limit.`)
      chunks.push(chunk as Uint8Array)
      onProgress(received)
    }
    if (controller.signal.aborted) throw timedOut()
    const joined = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      joined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return joined
  } catch (error) {
    // A late abort surfaces as a stream/abort error; report the real reason.
    if (controller.signal.aborted) throw timedOut()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Uninstall through the market: the approval record must exist first. */
export async function uninstallDshMarketPlugin(
  deps: DshMarketDeps,
  packageName: string
): Promise<void> {
  const policy = await readDshPluginPolicy(deps.installDeps.policyPath)
  if (!policy.approved.some((entry) => entry.packageName === packageName)) {
    throw new Error(`Plugin ${packageName} has no recorded approval, so it was not installed by the market.`)
  }
  await uninstallDshPlugin(deps.installDeps, packageName, policy)
}

/** What the installed-state lookup the surface needs looks like. */
export type DshMarketInstalledPlugin = Readonly<{
  packageName: string
  version: string
  enabled: boolean
}>

export type DshMarketSurface = Readonly<{
  list: () => Promise<DshMarketView>
  install: (input: DshMarketInstallInput) => Promise<DshMarketInstallResult>
  uninstall: (input: DshMarketPackageInput) => Promise<void>
  setEnabled: (input: DshMarketSetEnabledInput) => Promise<DshMarketPluginView>
  progress: (input?: DshMarketPackageInput) => Promise<DshMarketProgressView | null>
}>

/**
 * The surface the IPC layer exposes. It adds two things to the install path: it
 * merges the catalog with the host's own installed state, and it remembers the
 * last reported phase so the UI can poll real progress.
 */
export function createDshMarketSurface(deps: Readonly<{
  source: DshMarketSource | undefined
  installDeps: DshMarketDeps['installDeps']
  listInstalled: () => Promise<readonly DshMarketInstalledPlugin[]>
  setEnabled: (packageName: string, enabled: boolean) => Promise<unknown>
  /**
   * Whether the Host currently exposes a capability id. Lets the market tell a
   * user which capabilities are live, instead of leaving them to guess where a
   * freshly installed plugin shows up.
   */
  isCapabilityRegistered?: (id: string) => boolean
}>): DshMarketSurface {
  const progressByPackage = new Map<string, DshMarketProgressView>()
  /**
   * One install per package at a time. A double click or a retry that overlaps the
   * first attempt joins the original work instead of downloading and swapping the
   * same directory twice.
   */
  const inFlightInstalls = new Map<string, Promise<{ packageName: string; version: string; sha256: string; tools: readonly string[] }>>()
  const toView = (progress: DshMarketProgress): DshMarketProgressView => ({
    packageName: progress.packageName,
    phase: progress.phase,
    bytesReceived: progress.bytesReceived ?? null,
    bytesTotal: progress.bytesTotal ?? null,
    message: progress.message ?? null
  })
  const marketDeps: DshMarketDeps = {
    source: deps.source ?? { kind: 'file', path: '' },
    installDeps: deps.installDeps,
    onProgress: (progress) => progressByPackage.set(progress.packageName, toView(progress))
  }

  const emptyView = (error: string | null): DshMarketView => ({
    source: deps.source === undefined
      ? null
      : { kind: deps.source.kind, location: deps.source.kind === 'file' ? deps.source.path : deps.source.url },
    generatedAt: null,
    dshRuntimeVersion: null,
    plugins: [],
    notInstallable: [],
    error
  })

  const decorate = (
    entry: DshMarketPlugin,
    installed: ReadonlyMap<string, DshMarketInstalledPlugin>
  ): DshMarketPluginView => ({
    name: entry.name,
    title: entry.title ?? entry.name,
    version: entry.version,
    categories: entry.categories,
    tools: entry.tools,
    capabilities: entry.tools.map((tool) => ({
      name: tool.name,
      id: tool.id,
      effect: tool.effect,
      registered: deps.isCapabilityRegistered?.(tool.id) === true
    })),
    hostDependencies: entry.hostDependencies,
    publisher: entry.publisher,
    sizeBytes: entry.artifact.sizeBytes,
    sha256: entry.artifact.sha256,
    runtimeNote: entry.runtimeNote,
    installed: installed.has(entry.name),
    enabled: installed.get(entry.name)?.enabled ?? false,
    installedVersion: installed.get(entry.name)?.version ?? null
  })

  const surface: DshMarketSurface = {
    list: async () => {
      if (deps.source === undefined) {
        return emptyView('No plugin market index is configured for this Host.')
      }
      let index: DshMarketIndex
      try {
        index = await readDshMarketIndex(deps.source)
      } catch (error) {
        return emptyView(error instanceof Error ? error.message : String(error))
      }
      const installed = new Map((await deps.listInstalled()).map((entry) => [entry.packageName, entry]))
      return {
        source: { kind: deps.source.kind, location: deps.source.kind === 'file' ? deps.source.path : deps.source.url },
        generatedAt: index.generatedAt,
        dshRuntimeVersion: index.dshRuntimeVersion,
        plugins: index.plugins.map((entry) => decorate(entry, installed)),
        notInstallable: index.blocked,
        error: null
      }
    },
    install: async (input) => {
      const joined = inFlightInstalls.get(input.packageName)
      if (joined) return joined
      const attempt = (async () => {
      progressByPackage.delete(input.packageName)
      try {
        const outcome = await installDshMarketPlugin(marketDeps, input)
        progressByPackage.set(input.packageName, {
          packageName: input.packageName,
          phase: 'done',
          bytesReceived: null,
          bytesTotal: null,
          message: null
        })
        return {
          packageName: outcome.packageName,
          version: outcome.version,
          sha256: outcome.sha256,
          tools: outcome.tools
        }
      } catch (error) {
        progressByPackage.set(input.packageName, {
          packageName: input.packageName,
          phase: 'failed',
          bytesReceived: null,
          bytesTotal: null,
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
      })()
      inFlightInstalls.set(input.packageName, attempt)
      try {
        return await attempt
      } finally {
        inFlightInstalls.delete(input.packageName)
      }
    },
    uninstall: async (input) => {
      await uninstallDshMarketPlugin(marketDeps, input.packageName)
      progressByPackage.delete(input.packageName)
    },
    setEnabled: async (input) => {
      const installed = new Map((await deps.listInstalled()).map((entry) => [entry.packageName, entry]))
      const state = installed.get(input.packageName)
      if (!state) throw new Error(`Plugin ${input.packageName} is not installed through the market.`)
      await deps.setEnabled(input.packageName, input.enabled)
      const index = deps.source === undefined ? undefined : await readDshMarketIndex(deps.source)
      const entry = index?.plugins.find((candidate) => candidate.name === input.packageName)
      if (!entry) throw new Error(`Plugin ${input.packageName} is installed but no longer listed in the market index.`)
      return decorate(entry, new Map([[input.packageName, { ...state, enabled: input.enabled }]]))
    },
    progress: async (input) => {
      const latest = input?.packageName
        ? progressByPackage.get(input.packageName)
        : [...progressByPackage.values()].at(-1)
      return latest ?? null
    }
  }
  return Object.freeze(surface)
}