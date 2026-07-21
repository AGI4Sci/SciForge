import { chmod, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect as connectTcp, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { atomicWriteFile } from './atomic-write-file'
import type {
  AppSettingsV1,
  RemoteChannelAgentProfileV1,
  RemoteChannelV1,
  RemoteChannelDiscordPlatformCredentialV1,
  RemoteChannelModel
} from '../shared/app-settings'
import { buildRemoteChannelInboundMessagePrompt } from '../shared/app-settings'
import type {
  DiscordBindChannelResult,
  DiscordBotInfo,
  DiscordBotChannelStatus,
  DiscordConfigureClientResult,
  DiscordBotStatus,
  DiscordChannel,
  DiscordChannelListResult,
  DiscordConfigureProxyResult,
  DiscordConfigureTokenResult,
  DiscordGuardConflictStatus,
  DiscordGuardResult,
  DiscordGuild,
  DiscordGuildListResult,
  DiscordTestSendResult
} from '../shared/sciforge-api'
import type { JsonSettingsStore } from './settings-store'
import type {
  RemoteChannelIncomingImMessageInput,
  RemoteChannelIncomingImMessageResult
} from './remote-channel-runtime'
import { redactSecrets } from '../shared/secret-redaction'

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'
const DEFAULT_DISCORD_BOT_PERMISSIONS = '68608'
const DISCORD_INTENTS =
  1 | // GUILDS
  512 | // GUILD_MESSAGES
  32_768 // MESSAGE_CONTENT
const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5])
const MAX_DISCORD_MESSAGE_LENGTH = 2_000
const MESSAGE_CONTENT_WARNING_INTERVAL_MS = 10 * 60_000
const MAX_DISCORD_GATEWAY_PAYLOAD_BYTES = 4 * 1024 * 1024
const INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT = '/.sciforge/remote-channel'
const DISCORD_MESSAGE_FAILURE_REPLY = 'Sorry, I could not process that message.'
const DISCORD_COMMAND_FAILURE_REPLY = 'Sorry, I could not process that command.'
const require = createRequire(import.meta.url)

type RuntimeWebSocketEvent = { data?: unknown }
type RuntimeWebSocket = {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  onopen: (() => void) | null
  onmessage: ((event: RuntimeWebSocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
}
type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocket
type NodeWebSocketLike = {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  on: (event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void) => void
}
type NodeWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: {
    createConnection?: (
      options: Record<string, unknown>,
      callback: (error: Error | null, socket?: Socket | TLSSocket) => void
    ) => undefined
    handshakeTimeout?: number
    maxPayload?: number
    perMessageDeflate?: boolean
  }
) => NodeWebSocketLike
type DiscordFetch = (input: string, init?: RequestInit) => Promise<Response>
type DiscordProxyFetch = (input: string, proxyUrl: string, init?: RequestInit) => Promise<Response>

type DiscordSecretFile = {
  botToken?: string
  clientId?: string
  proxyUrl?: string
  bot?: DiscordBotInfo
  updatedAt: string
}

type DiscordTokenSecretFile = DiscordSecretFile & {
  botToken: string
  bot: DiscordBotInfo
}

type DiscordUserResponse = {
  id?: string
  username?: string
  global_name?: string | null
  bot?: boolean
}

type DiscordApplicationResponse = {
  id?: string
}

type DiscordGuildResponse = {
  id?: string
  name?: string
}

type DiscordChannelResponse = {
  id?: string
  name?: string
  type?: number
}

type DiscordGatewayPacket = {
  op: number
  s?: number | null
  t?: string | null
  d?: unknown
}

type DiscordReadyPayload = {
  session_id?: string
  user?: DiscordUserResponse
  guilds?: DiscordGuildResponse[]
}

type DiscordMessagePayload = {
  id?: string
  channel_id?: string
  guild_id?: string
  content?: string
  author?: DiscordUserResponse & { discriminator?: string }
  mention_everyone?: boolean
  mentions?: DiscordUserResponse[]
  attachments?: Array<{ url?: string; filename?: string }>
}

type DiscordInteractionPayload = {
  id?: string
  application_id?: string
  token?: string
  type?: number
  guild_id?: string
  channel_id?: string
  data?: {
    name?: string
    type?: number
  }
  member?: {
    user?: DiscordUserResponse
  }
  user?: DiscordUserResponse
}

type DiscordRuntimeDeps = {
  store: JsonSettingsStore
  userDataPath: string
  handleIncomingMessage: (
    input: RemoteChannelIncomingImMessageInput
  ) => Promise<RemoteChannelIncomingImMessageResult>
  onSettingsChanged?: (settings: AppSettingsV1) => void
  logError: (category: string, message: string, detail?: unknown) => void
  fetch?: DiscordFetch
  proxyFetch?: DiscordProxyFetch
  createWebSocket?: (url: string, proxyUrl?: string) => RuntimeWebSocket
}

function normalizeBotToken(raw: string): string {
  return raw.trim().replace(/^Bot\s+/i, '')
}

function normalizeDiscordClientId(raw: string): string {
  return raw.trim()
}

function normalizeDiscordProxyUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid Discord HTTP proxy URL, for example http://127.0.0.1:7890.')
  }
  if (url.protocol !== 'http:') {
    throw new Error('Discord proxy currently supports HTTP proxy URLs such as http://127.0.0.1:7890.')
  }
  if (!url.hostname) {
    throw new Error('Enter a valid Discord HTTP proxy URL, for example http://127.0.0.1:7890.')
  }
  return url.href
}

function createDiscordBotInviteUrl(clientId: string): string {
  const normalizedClientId = clientId.trim()
  if (!normalizedClientId) return ''
  return [
    'https://discord.com/oauth2/authorize',
    `?client_id=${encodeURIComponent(normalizedClientId)}`,
    `&permissions=${encodeURIComponent(DEFAULT_DISCORD_BOT_PERMISSIONS)}`,
    '&scope=bot%20applications.commands'
  ].join('')
}

function loadNodeWebSocketConstructor(): NodeWebSocketConstructor {
  const loaded = require('ws') as
    | NodeWebSocketConstructor
    | { default?: NodeWebSocketConstructor; WebSocket?: NodeWebSocketConstructor }
  if (typeof loaded === 'function') return loaded
  const ctor = loaded.WebSocket ?? loaded.default
  if (typeof ctor !== 'function') {
    throw new Error('Node WebSocket implementation is not available.')
  }
  return ctor
}

function websocketDataToString(data: unknown): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((item) =>
      Buffer.isBuffer(item)
        ? item
        : item instanceof ArrayBuffer
          ? Buffer.from(item)
          : Buffer.from(String(item))
    )).toString('utf8')
  }
  return String(data)
}

function createProxyWebSocketConnection(proxyUrl: string): NonNullable<ConstructorParameters<NodeWebSocketConstructor>[2]>['createConnection'] {
  const proxy = new URL(proxyUrl)
  return (options, callback) => {
    const host = String(options.hostname || options.host || '')
    const port = String(options.port || 443)
    const target = new URL(`https://${host}`)
    if (port !== '443') target.port = port
    connectViaHttpProxy(target, proxy)
      .then((socket) => callback(null, socket))
      .catch((error) => callback(error instanceof Error ? error : new Error(String(error))))
    return undefined
  }
}

function createNodeRuntimeWebSocket(url: string, proxyUrl?: string): RuntimeWebSocket {
  const ctor = loadNodeWebSocketConstructor()
  const socket = new ctor(url, [], {
    handshakeTimeout: 15_000,
    maxPayload: MAX_DISCORD_GATEWAY_PAYLOAD_BYTES,
    perMessageDeflate: false,
    ...(proxyUrl ? { createConnection: createProxyWebSocketConnection(proxyUrl) } : {})
  })
  const runtimeSocket: RuntimeWebSocket = {
    get readyState() {
      return socket.readyState
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null
  }
  socket.on('open', () => runtimeSocket.onopen?.())
  socket.on('message', (data) => runtimeSocket.onmessage?.({ data: websocketDataToString(data) }))
  socket.on('error', (event) => runtimeSocket.onerror?.(event))
  socket.on('close', () => runtimeSocket.onclose?.())
  return runtimeSocket
}

function createRuntimeWebSocket(url: string, proxyUrl?: string): RuntimeWebSocket {
  if (proxyUrl) return createNodeRuntimeWebSocket(url, proxyUrl)
  const ctor = (globalThis as unknown as { WebSocket?: RuntimeWebSocketConstructor }).WebSocket
  return ctor ? new ctor(url) : createNodeRuntimeWebSocket(url)
}

function compactMessage(text: string, fallback: string): string {
  const trimmed = text.trim()
  return trimmed || fallback
}

function safeDiscordFailureReply(
  result: Extract<RemoteChannelIncomingImMessageResult, { ok: false }>,
  fallback: string
): string {
  const failureKind = (result as { failureKind?: unknown }).failureKind
  if (failureKind === 'local_thread_deleted') {
    return compactMessage(result.message, fallback)
  }
  return fallback
}

function splitDiscordMessage(text: string): string[] {
  const normalized = compactMessage(text, 'Completed.')
  const chunks: string[] = []
  let remaining = normalized
  while (remaining.length > MAX_DISCORD_MESSAGE_LENGTH) {
    chunks.push(remaining.slice(0, MAX_DISCORD_MESSAGE_LENGTH))
    remaining = remaining.slice(MAX_DISCORD_MESSAGE_LENGTH)
  }
  chunks.push(remaining)
  return chunks
}

function discordChannelLabel(name: string): string {
  const trimmed = name.trim().replace(/^#/, '')
  return trimmed ? `#${trimmed}` : 'Discord channel'
}

function discordInteractionCommandText(name: string): string {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'new') return '/new'
  if (normalized === 'where' || normalized === 'pwd') return '/where'
  if (normalized === 'status') return '/status'
  if (normalized === 'summary' || normalized === 'summarize') return '/summary'
  if (normalized === 'help') return '/help'
  if (normalized === 'detach') return '/detach'
  if (normalized === 'attach') return '/attach current'
  return ''
}

function isChineseLocale(settings: AppSettingsV1): boolean {
  return settings.locale.toLowerCase().startsWith('zh')
}

function normalizeWorkspaceRoot(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function isInternalRemoteChannelWorkspaceRoot(workspaceRoot: string): boolean {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return (
    normalized === '~/.sciforge/remote-channel'
    || normalized.startsWith('~/.sciforge/remote-channel/')
    || normalized.endsWith(INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT)
    || normalized.includes(`${INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT}/`)
  )
}

function resolveDiscordChannelWorkspaceRoot(
  requestedWorkspaceRoot: string | null | undefined,
  existingWorkspaceRoot: string | null | undefined,
  defaultWorkspaceRoot: string | null | undefined
): string {
  const requested = normalizeWorkspaceRoot(requestedWorkspaceRoot)
  if (requested && !isInternalRemoteChannelWorkspaceRoot(requested)) return requested
  const existing = normalizeWorkspaceRoot(existingWorkspaceRoot)
  if (existing && !isInternalRemoteChannelWorkspaceRoot(existing)) return existing
  const fallback = normalizeWorkspaceRoot(defaultWorkspaceRoot)
  return fallback || requested || existing
}

function discordChannelConfigId(botId: string, guildId: string, channelId: string): string {
  return `discord-${botId.trim()}-${guildId.trim()}-${channelId.trim()}`
}

function defaultDiscordAgentProfile(name: string): RemoteChannelV1['agentProfile'] {
  return {
    name: name.trim() || 'discord bot',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

function mergeDiscordAgentProfile(
  current: RemoteChannelAgentProfileV1 | undefined,
  patch: Partial<RemoteChannelAgentProfileV1> | undefined,
  fallbackName: string
): RemoteChannelAgentProfileV1 {
  const base = current ?? defaultDiscordAgentProfile(fallbackName)
  return {
    name: typeof patch?.name === 'string' ? patch.name.trim() : base.name,
    description: typeof patch?.description === 'string' ? patch.description : base.description,
    identity: typeof patch?.identity === 'string' ? patch.identity : base.identity,
    personality: typeof patch?.personality === 'string' ? patch.personality : base.personality,
    userContext: typeof patch?.userContext === 'string' ? patch.userContext : base.userContext,
    replyRules: typeof patch?.replyRules === 'string' ? patch.replyRules : base.replyRules
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readDiscordError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '')
  if (!raw) return `${res.status} ${res.statusText}`.trim()
  try {
    const parsed = JSON.parse(raw) as { message?: string; code?: number | string }
    return parsed.message || raw
  } catch {
    return raw
  }
}

function discordHttpErrorMessage(status: number, statusText: string, detail: string): string {
  const suffix = detail.trim() ? ` (${detail.trim()})` : ''
  if (status === 401 || status === 403) {
    return [
      'Discord rejected this Bot Token.',
      'Reset and copy a fresh token from Developer Portal > Bot, not the Client Secret or public key.'
    ].join(' ') + suffix
  }
  if (status === 429) {
    return 'Discord rate-limited this request. Wait a moment, then try again.' + suffix
  }
  if (status >= 500) {
    return `Discord API is temporarily unavailable (${status} ${statusText}). Try again later.`
  }
  return `Discord API request failed (${status} ${statusText}).${suffix}`.trim()
}

function discordNetworkErrorMessage(error: unknown): string {
  const message = errorMessage(error)
  const lower = message.toLowerCase()
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      lower.includes('aborted') ||
      lower.includes('timeout'))
  ) {
    return 'Timed out connecting to Discord API. Check your network or proxy/VPN, then try again.'
  }
  if (lower.includes('fetch failed') || lower.includes('network')) {
    return 'Cannot reach Discord API. Check your network or proxy/VPN, then try again.'
  }
  return `Cannot reach Discord API: ${message}`
}

function requestBodyToBuffer(body: RequestInit['body']): Buffer {
  if (body == null) return Buffer.alloc(0)
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  throw new Error('Discord proxy does not support streaming request bodies yet.')
}

function decodeChunkedBody(body: Buffer): Buffer {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset, 'latin1')
    if (lineEnd < 0) break
    const line = body.subarray(offset, lineEnd).toString('latin1')
    const size = Number.parseInt(line.split(';', 1)[0] ?? '', 16)
    if (!Number.isFinite(size) || size < 0) break
    offset = lineEnd + 2
    if (size === 0) break
    chunks.push(body.subarray(offset, offset + size))
    offset += size + 2
  }
  return Buffer.concat(chunks)
}

function parseProxyFetchResponse(raw: Buffer): Response {
  const headerEnd = raw.indexOf('\r\n\r\n', 0, 'latin1')
  if (headerEnd < 0) throw new Error('Discord proxy returned an invalid response.')
  const head = raw.subarray(0, headerEnd).toString('latin1')
  const [statusLine = '', ...headerLines] = head.split('\r\n')
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(statusLine)
  if (!statusMatch) throw new Error('Discord proxy returned an invalid HTTP status.')
  const headers = new Headers()
  for (const line of headerLines) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }
  let body = raw.subarray(headerEnd + 4)
  if (headers.get('transfer-encoding')?.toLowerCase().includes('chunked')) {
    body = decodeChunkedBody(body)
  }
  return new Response(new Uint8Array(body), {
    status: Number(statusMatch[1]),
    statusText: statusMatch[2]?.trim() ?? '',
    headers
  })
}

function serializeHeaders(headers: Headers): string {
  let serialized = ''
  headers.forEach((value, key) => {
    serialized += `${key}: ${value}\r\n`
  })
  return serialized
}

async function connectViaHttpProxy(
  target: URL,
  proxy: URL,
  signal?: AbortSignal | null
): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const proxyPort = proxy.port ? Number(proxy.port) : 80
    const tcp = connectTcp({ host: proxy.hostname, port: proxyPort })
    let tlsSocket: TLSSocket | null = null
    let settled = false
    let response = Buffer.alloc(0)
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      tcp.removeListener('timeout', onTimeout)
      tcp.removeListener('error', fail)
      tlsSocket?.removeListener('timeout', onTimeout)
      tlsSocket?.removeListener('error', fail)
      fn()
    }
    const fail = (error: unknown): void => {
      finish(() => {
        tcp.destroy()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    }
    const abort = (): void => fail(new DOMException('The operation was aborted.', 'AbortError'))
    const onTimeout = (): void => fail(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    signal?.addEventListener('abort', abort, { once: true })
    tcp.setTimeout(15_000)
    tcp.once('timeout', onTimeout)
    tcp.once('error', fail)
    tcp.once('connect', () => {
      const targetPort = target.port || '443'
      const authHeader = proxy.username || proxy.password
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
        : ''
      tcp.write(
        `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${target.hostname}:${targetPort}\r\n` +
        authHeader +
        '\r\n'
      )
    })
    tcp.on('data', (chunk) => {
      response = Buffer.concat([response, chunk])
      const headerEnd = response.indexOf('\r\n\r\n', 0, 'latin1')
      if (headerEnd < 0) return
      const header = response.subarray(0, headerEnd).toString('latin1')
      const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(header)
      if (!statusMatch || statusMatch[1] !== '200') {
        fail(new Error(`Discord proxy CONNECT failed (${statusMatch?.[1] ?? 'unknown'}).`))
        return
      }
      tcp.removeAllListeners('data')
      tcp.removeListener('error', fail)
      const secureSocket = connectTls({
        socket: tcp as Socket,
        servername: target.hostname
      })
      tlsSocket = secureSocket
      secureSocket.setTimeout(15_000)
      secureSocket.once('timeout', onTimeout)
      secureSocket.once('error', fail)
      secureSocket.once('secureConnect', () => {
        finish(() => resolve(secureSocket))
      })
    })
  })
}

async function fetchViaHttpProxy(input: string, proxyUrl: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(input)
  const proxy = new URL(proxyUrl)
  if (target.protocol !== 'https:') {
    throw new Error('Discord proxy only supports HTTPS Discord API requests.')
  }
  if (proxy.protocol !== 'http:') {
    throw new Error('Discord proxy currently supports HTTP proxy URLs such as http://127.0.0.1:7890.')
  }
  const method = (init.method ?? 'GET').toUpperCase()
  const body = requestBodyToBuffer(init.body)
  const headers = new Headers(init.headers)
  headers.set('Host', target.host)
  headers.set('Accept-Encoding', 'identity')
  headers.set('Connection', 'close')
  if (body.length > 0) headers.set('Content-Length', String(body.length))
  return await new Promise(async (resolve, reject) => {
    let socket: TLSSocket | null = null
    const chunks: Buffer[] = []
    const signal = init.signal
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort)
      socket?.removeAllListeners()
    }
    const settle = (fn: () => void): void => {
      cleanup()
      fn()
    }
    const fail = (error: unknown): void => {
      const message = error instanceof Error ? error : new Error(String(error))
      socket?.destroy()
      settle(() => reject(message))
    }
    const abort = (): void => fail(new DOMException('The operation was aborted.', 'AbortError'))
    try {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      signal?.addEventListener('abort', abort, { once: true })
      socket = await connectViaHttpProxy(target, proxy, signal)
      socket.on('data', (chunk) => chunks.push(chunk))
      socket.once('error', fail)
      socket.once('timeout', () => fail(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
      socket.once('end', () => {
        try {
          const response = parseProxyFetchResponse(Buffer.concat(chunks))
          settle(() => resolve(response))
        } catch (error) {
          fail(error)
        }
      })
      const path = `${target.pathname}${target.search}`
      socket.write(`${method} ${path} HTTP/1.1\r\n${serializeHeaders(headers)}\r\n`)
      if (body.length > 0) socket.write(body)
    } catch (error) {
      fail(error)
    }
  })
}

export class DiscordBotRuntime {
  private readonly deps: DiscordRuntimeDeps
  private readonly secretPath: string
  private socket: RuntimeWebSocket | null = null
  private socketKey = ''
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnecting = false
  private sequence: number | null = null
  private connected = false
  private connectAttempt = 0
  private lastMessageContentWarningAt = 0

  constructor(deps: DiscordRuntimeDeps) {
    this.deps = deps
    this.secretPath = join(deps.userDataPath, 'discord-bot.json')
  }

  async configureClientId(rawClientId: string): Promise<DiscordConfigureClientResult> {
    const clientId = normalizeDiscordClientId(rawClientId)
    try {
      if (!clientId) throw new Error('Enter a Discord Client ID first.')
      const existing = await this.loadSecret()
      await this.saveSecret({
        ...(existing ?? {}),
        clientId,
        bot: existing?.bot
          ? {
              ...existing.bot,
              inviteUrl: createDiscordBotInviteUrl(existing.bot.applicationId || clientId)
            }
          : undefined,
        updatedAt: new Date().toISOString()
      })
      const settings = await this.deps.store.load()
      return { ok: true, status: await this.status(settings) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async configureProxy(rawProxyUrl: string): Promise<DiscordConfigureProxyResult> {
    try {
      const proxyUrl = normalizeDiscordProxyUrl(rawProxyUrl)
      const existing = await this.loadSecret()
      const next: DiscordSecretFile = {
        ...(existing ?? {}),
        updatedAt: new Date().toISOString()
      }
      if (proxyUrl) {
        next.proxyUrl = proxyUrl
      } else {
        delete next.proxyUrl
      }
      if (!next.clientId && next.bot?.applicationId) {
        next.clientId = next.bot.applicationId
      }
      await this.saveSecret(next)
      const settings = await this.deps.store.load()
      return { ok: true, status: await this.status(settings) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async configureToken(rawToken: string, rawClientId?: string): Promise<DiscordConfigureTokenResult> {
    const botToken = normalizeBotToken(rawToken)
    const clientId = normalizeDiscordClientId(rawClientId ?? '')
    try {
      const existing = await this.loadSecret()
      const bot = await this.fetchBotInfo(botToken)
      if (clientId && clientId !== bot.applicationId) {
        throw new Error('Discord Client ID does not match this Bot Token.')
      }
      await this.saveSecret({
        ...(existing ?? {}),
        botToken,
        clientId: bot.applicationId,
        bot,
        updatedAt: new Date().toISOString()
      })
      const settings = await this.deps.store.load()
      this.sync(settings)
      return { ok: true, status: await this.status(settings) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async status(settingsArg?: AppSettingsV1): Promise<DiscordBotStatus> {
    const [settings, secret] = await Promise.all([
      settingsArg ? Promise.resolve(settingsArg) : this.deps.store.load(),
      this.loadSecret()
    ])
    const channels = this.resolveDiscordChannels(settings)
    const channelStatuses = await Promise.all(
      channels.map((channel) => this.discordChannelStatus(settings, channel, secret))
    )
    const primaryStatus =
      channelStatuses.find((channel) => channel.enabled && !channel.conflict) ??
      channelStatuses[0]
    const clientId = secret?.bot?.applicationId || secret?.clientId || ''
    const inviteUrl = secret?.bot?.inviteUrl || createDiscordBotInviteUrl(clientId)
    const tokenConfigured = Boolean(secret?.botToken && secret.bot)
    const conflict = channelStatuses.find((channel) => channel.conflict)?.conflict
    return {
      installationId: settings.installationId ?? '',
      clientId,
      inviteUrl,
      tokenConfigured,
      proxyUrl: secret?.proxyUrl ?? '',
      configured: tokenConfigured,
      connected: this.connected,
      enabled: Boolean(
        settings.remoteChannel.enabled &&
        settings.remoteChannel.im.enabled &&
        channelStatuses.some((channel) => channel.enabled && !channel.conflict && !channel.accessError)
      ),
      ...(secret?.bot ? { bot: secret.bot } : {}),
      channels: channelStatuses,
      ...(conflict ? { conflict } : {}),
      ...(primaryStatus?.guildId ? { guildId: primaryStatus.guildId } : {}),
      ...(primaryStatus?.guildName ? { guildName: primaryStatus.guildName } : {}),
      ...(primaryStatus?.channelId ? { channelId: primaryStatus.channelId } : {}),
      ...(primaryStatus?.channelName ? { channelName: primaryStatus.channelName } : {})
    }
  }

  async listGuilds(): Promise<DiscordGuildListResult> {
    const secret = await this.requireSecret()
    try {
      const guilds = await this.fetchBotGuilds(secret.botToken)
      return { ok: true, guilds }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async listChannels(guildId: string): Promise<DiscordChannelListResult> {
    const secret = await this.requireSecret()
    try {
      const rawChannels = await this.discordFetch<DiscordChannelResponse[]>(
        `/guilds/${encodeURIComponent(guildId)}/channels`,
        secret.botToken
      )
      const channels = rawChannels
        .map((channel) => ({
          id: channel.id?.trim() ?? '',
          name: channel.name?.trim() ?? '',
          type: typeof channel.type === 'number' ? channel.type : -1
        }))
        .filter((channel): channel is DiscordChannel =>
          Boolean(channel.id && channel.name && DISCORD_TEXT_CHANNEL_TYPES.has(channel.type))
        )
        .sort((a, b) => a.name.localeCompare(b.name))
      return { ok: true, channels }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async bindChannel(input: {
    channelConfigId?: string
    guildId: string
    guildName?: string
    channelId: string
    channelName?: string
    enabled?: boolean
    workspaceRoot?: string
    model?: string
    runtimeId?: AppSettingsV1['activeAgentRuntime']
    agentProfile?: Partial<RemoteChannelAgentProfileV1>
  }): Promise<DiscordBindChannelResult> {
    try {
      const secret = await this.requireSecret()
      const settings = await this.deps.store.load()
      const now = new Date().toISOString()
      const installationId = settings.installationId ?? ''
      const guildName = input.guildName?.trim() || input.guildId
      const channelName = input.channelName?.trim() || input.channelId
      const label = discordChannelLabel(channelName)
      const channelConfigId = input.channelConfigId?.trim() ||
        discordChannelConfigId(secret.bot!.botId, input.guildId, input.channelId)
      const existing = this.resolveDiscordChannel(settings, channelConfigId) ??
        this.resolveDiscordChannelByRemote(settings, {
          botId: secret.bot!.botId,
          guildId: input.guildId,
          channelId: input.channelId
        })
      const existingCredential = existing?.platformCredential?.kind === 'discord'
        ? existing.platformCredential
        : undefined
      const ownerPatch = input.enabled === false
        ? {
            guardOwnerInstallationId: existingCredential?.guardOwnerInstallationId ?? '',
            guardOwnerUpdatedAt: existingCredential?.guardOwnerUpdatedAt ?? ''
          }
        : {
            guardOwnerInstallationId: installationId,
            guardOwnerUpdatedAt: now
          }
      const credential: RemoteChannelDiscordPlatformCredentialV1 = {
        kind: 'discord',
        applicationId: secret.bot!.applicationId,
        botId: secret.bot!.botId,
        botUsername: secret.bot!.botUsername,
        guildId: input.guildId.trim(),
        guildName,
        channelId: input.channelId.trim(),
        channelName,
        installationId,
        ...ownerPatch,
        createdAt: existingCredential?.createdAt || now
      }
      const agentProfile = mergeDiscordAgentProfile(
        existing?.agentProfile,
        input.agentProfile,
        existing?.agentProfile.name || 'discord bot'
      )
      const workspaceRoot = resolveDiscordChannelWorkspaceRoot(
        input.workspaceRoot,
        existing?.workspaceRoot,
        settings.workspaceRoot
      )
      const channel: RemoteChannelV1 = existing
        ? {
            ...existing,
            id: existing.id || channelConfigId,
            provider: 'discord',
            label,
            enabled: input.enabled ?? true,
            guardMode: 'all_messages',
            model: (input.model?.trim() || existing.model || settings.remoteChannel.im.model || 'auto') as RemoteChannelModel,
            runtimeId: input.runtimeId ?? existing.runtimeId ?? settings.activeAgentRuntime,
            workspaceRoot,
            agentProfile: {
              ...agentProfile,
              name: agentProfile.name.trim() || existing.agentProfile.name || label
            },
            platformCredential: credential,
            updatedAt: now
          }
        : {
            id: channelConfigId,
            provider: 'discord',
            label,
            enabled: input.enabled ?? true,
            guardMode: 'all_messages',
            model: (input.model?.trim() || settings.remoteChannel.im.model || 'auto') as RemoteChannelModel,
            runtimeId: input.runtimeId ?? settings.activeAgentRuntime,
            agentThreadIds: {},
            workspaceRoot,
            agentProfile: {
              ...agentProfile,
              name: agentProfile.name.trim() || label
            },
            platformCredential: credential,
            conversations: [],
            recentMessages: [],
            createdAt: now,
            updatedAt: now
          }
      const saved = await this.deps.store.patch({
        remoteChannel: {
          enabled: true,
          im: {
            enabled: true,
            provider: 'discord'
          },
          channels: [
            ...settings.remoteChannel.channels.filter((item) => item.id !== (existing?.id || channel.id)),
            channel
          ]
        }
      })
      this.deps.onSettingsChanged?.(saved)
      this.sync(saved)
      return { ok: true, status: await this.status(saved), channelConfigId: channel.id }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async testSend(channelId: string, text?: string, _channelConfigId?: string): Promise<DiscordTestSendResult> {
    try {
      const result = await this.sendChannelMessage({
        channelId,
        text: text?.trim() || 'SciForge Discord bot is connected.'
      })
      return result
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async setGuard(
    enabled: boolean,
    options: { channelConfigId?: string; forceTakeover?: boolean } = {}
  ): Promise<DiscordGuardResult> {
    try {
      const settings = await this.deps.store.load()
      const channel = this.resolveDiscordChannel(settings, options.channelConfigId)
      if (!channel) return { ok: false, message: 'Bind a Discord channel first.' }
      if (enabled) await this.requireSecret()
      const conflict = enabled ? this.discordChannelConflict(settings, channel) : undefined
      if (conflict && !options.forceTakeover) {
        return {
          ok: false,
          message: conflict.message,
          status: await this.status(settings),
          conflict
        }
      }
      const now = new Date().toISOString()
      const installationId = settings.installationId ?? ''
      const saved = await this.deps.store.patch({
        remoteChannel: {
          enabled: enabled ? true : settings.remoteChannel.enabled,
          im: {
            enabled: enabled ? true : settings.remoteChannel.im.enabled,
            provider: 'discord'
          },
          channels: settings.remoteChannel.channels.map((item) =>
            item.id === channel.id
              ? {
                  ...item,
                  enabled,
                  guardMode: enabled ? 'all_messages' : item.guardMode,
                  platformCredential: item.platformCredential?.kind === 'discord'
                    ? {
                        ...item.platformCredential,
                        installationId: item.platformCredential.installationId || installationId,
                        ...(enabled
                          ? {
                              guardOwnerInstallationId: installationId,
                              guardOwnerUpdatedAt: now
                            }
                          : {})
                      }
                    : item.platformCredential,
                  updatedAt: now
                }
              : item
          )
        }
      })
      this.deps.onSettingsChanged?.(saved)
      this.sync(saved)
      return { ok: true, status: await this.status(saved) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async sendChannelMessage(options: {
    channelId: string
    text: string
    replyToMessageId?: string
  }): Promise<DiscordTestSendResult> {
    const secret = await this.requireSecret()
    let firstMessageId = ''
    for (const [index, chunk] of splitDiscordMessage(options.text).entries()) {
      const body: Record<string, unknown> = {
        content: chunk,
        allowed_mentions: { parse: [] }
      }
      if (index === 0 && options.replyToMessageId) {
        body.message_reference = {
          message_id: options.replyToMessageId,
          channel_id: options.channelId,
          fail_if_not_exists: false
        }
      }
      const sent = await this.discordFetch<{ id?: string }>(
        `/channels/${encodeURIComponent(options.channelId)}/messages`,
        secret.botToken,
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      )
      firstMessageId ||= sent.id?.trim() ?? ''
    }
    return { ok: true, messageId: firstMessageId }
  }

  private async sendInteractionReply(options: {
    interactionId: string
    interactionToken: string
    text: string
  }): Promise<void> {
    const secret = await this.requireSecret()
    const content = compactMessage(options.text, 'Completed.').slice(0, MAX_DISCORD_MESSAGE_LENGTH)
    await this.discordFetch<void>(
      `/interactions/${encodeURIComponent(options.interactionId)}/${encodeURIComponent(options.interactionToken)}/callback`,
      secret.botToken,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 4,
          data: {
            content,
            allowed_mentions: { parse: [] }
          }
        })
      }
    )
  }

  sync(settings: AppSettingsV1): void {
    const channels = this.resolveRunnableDiscordChannels(settings)
    if (!settings.remoteChannel.enabled || !settings.remoteChannel.im.enabled || channels.length === 0) {
      this.disconnect()
      return
    }
    void this.syncGatewayForChannels(channels).catch((error) => {
      this.deps.logError('remote-channel-discord', 'Failed to sync Discord bot runtime.', {
        message: errorMessage(error),
        channelIds: channels.map((channel) => channel.id)
      })
    })
  }

  stop(): void {
    this.disconnect()
  }

  private async syncGatewayForChannels(channels: RemoteChannelV1[]): Promise<void> {
    const secret = await this.loadSecret()
    if (!secret?.botToken || !secret.bot) {
      this.disconnect()
      return
    }
    const channelKey = channels
      .map((channel) => {
        const credential = channel.platformCredential?.kind === 'discord'
          ? channel.platformCredential
          : undefined
        return `${channel.id}|${credential?.guildId ?? ''}|${credential?.channelId ?? ''}`
      })
      .sort()
      .join(';')
    const key = `${secret.bot.botId}|${channelKey}`
    if (this.socket && this.socketKey === key) return
    this.disconnect()
    this.socketKey = key
    this.connectAttempt += 1
    this.openGateway(secret.botToken, this.connectAttempt, secret.proxyUrl)
  }

  private openGateway(botToken: string, attempt: number, proxyUrl?: string): void {
    const socket = this.deps.createWebSocket?.(DISCORD_GATEWAY_URL, proxyUrl) ??
      createRuntimeWebSocket(DISCORD_GATEWAY_URL, proxyUrl)
    this.socket = socket
    this.connected = false
    this.sequence = null
    socket.onmessage = (event) => this.handleGatewayPacket(botToken, event.data, attempt)
    socket.onerror = (event) => {
      this.deps.logError('remote-channel-discord', 'Discord Gateway socket error.', { event: String(event) })
    }
    socket.onclose = () => {
      this.clearHeartbeat()
      this.connected = false
      if (this.socket !== socket || this.reconnecting) return
      this.scheduleReconnect()
    }
  }

  private handleGatewayPacket(botToken: string, raw: unknown, attempt: number): void {
    let packet: DiscordGatewayPacket
    try {
      packet = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as DiscordGatewayPacket
    } catch (error) {
      this.deps.logError('remote-channel-discord', 'Failed to parse Discord Gateway packet.', {
        message: errorMessage(error)
      })
      return
    }
    if (typeof packet.s === 'number') this.sequence = packet.s
    if (packet.op === 10) {
      const interval = isObject(packet.d) && typeof packet.d.heartbeat_interval === 'number'
        ? packet.d.heartbeat_interval
        : 45_000
      this.identifyGateway(botToken)
      this.startHeartbeat(interval)
      return
    }
    if (packet.op === 7 || packet.op === 9) {
      this.scheduleReconnect()
      return
    }
    if (packet.op !== 0) return
    if (packet.t === 'READY') {
      const ready = packet.d as DiscordReadyPayload
      this.connected = true
      if (ready.session_id) {
        this.deps.logError('remote-channel-discord', 'Discord Gateway connected.', {
          sessionId: ready.session_id,
          userId: ready.user?.id,
          guildCount: ready.guilds?.length ?? 0
        })
      }
      return
    }
    if (packet.t === 'MESSAGE_CREATE' && attempt === this.connectAttempt) {
      this.enqueueDiscordMessage(packet.d as DiscordMessagePayload)
      return
    }
    if (packet.t === 'INTERACTION_CREATE' && attempt === this.connectAttempt) {
      this.enqueueDiscordInteraction(packet.d as DiscordInteractionPayload)
    }
  }

  private identifyGateway(botToken: string): void {
    this.socket?.send(JSON.stringify({
      op: 2,
      d: {
        token: botToken,
        intents: DISCORD_INTENTS,
        properties: {
          os: process.platform,
          browser: 'sciforge',
          device: 'sciforge'
        }
      }
    }))
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.socket?.send(JSON.stringify({ op: 1, d: this.sequence }))
    }, interval)
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnecting = true
    this.disconnect()
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      this.reconnecting = false
      this.sync(await this.deps.store.load())
    }, 2_500)
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearHeartbeat()
    const socket = this.socket
    this.socket = null
    this.socketKey = ''
    this.connected = false
    if (socket) {
      socket.onclose = null
      socket.close(1000, 'SciForge Discord runtime stopped')
    }
  }

  private enqueueDiscordMessage(message: DiscordMessagePayload): void {
    void this.handleDiscordMessage(message).catch((error) => {
      this.deps.logError('remote-channel-discord', 'Failed to handle Discord message.', {
        message: errorMessage(error),
        messageId: message.id,
        channelId: message.channel_id
      })
    })
  }

  private enqueueDiscordInteraction(interaction: DiscordInteractionPayload): void {
    void this.handleDiscordInteraction(interaction).catch((error) => {
      this.deps.logError('remote-channel-discord', 'Failed to handle Discord interaction.', {
        message: errorMessage(error),
        interactionId: interaction.id,
        channelId: interaction.channel_id
      })
    })
  }

  private async handleDiscordMessage(message: DiscordMessagePayload): Promise<void> {
    const settings = await this.deps.store.load()
    const channel = this.resolveDiscordChannelForMessage(settings, message)
    const credential = channel?.platformCredential?.kind === 'discord'
      ? channel.platformCredential
      : undefined
    if (!channel?.enabled || !credential) return
    const messageId = message.id?.trim() ?? ''
    const channelId = message.channel_id?.trim() ?? ''
    if (!messageId || channelId !== credential.channelId) return
    const author = message.author
    const authorId = author?.id?.trim() ?? ''
    if (!authorId || author?.bot || authorId === credential.botId) return
    const text = message.content?.trim() ?? ''
    if (!text) {
      await this.maybeSendMessageContentIntentWarning(credential.channelId, messageId)
      return
    }

    await this.sendTyping(credential.channelId)
    const sender = author?.global_name?.trim() || author?.username?.trim() || authorId
    const attachments = (message.attachments ?? [])
      .map((attachment) => attachment.url?.trim() || attachment.filename?.trim() || '')
      .filter(Boolean)
    const runtimePrompt = buildRemoteChannelInboundMessagePrompt({
      provider: 'discord',
      metadata: [
        ['Guild', credential.guildName || credential.guildId],
        ['Channel', discordChannelLabel(credential.channelName || credential.channelId)],
        ['Sender', sender],
        ['Attachments', attachments.length > 0 ? attachments.join(', ') : undefined]
      ],
      text
    })
    const mentionedBot = (message.mentions ?? []).some((user) => user.id?.trim() === credential.botId) ||
      new RegExp(`<@!?${credential.botId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`).test(text)

    let result: RemoteChannelIncomingImMessageResult
    try {
      result = await this.deps.handleIncomingMessage({
        provider: 'discord',
        channelId: channel.id,
        text,
        runtimePrompt,
        sender,
        chatType: 'group',
        mentionedBot,
        mentionAll: message.mention_everyone === true,
        remoteSession: {
          chatId: credential.channelId,
          messageId,
          threadId: '',
          senderId: authorId,
          senderName: sender
        }
      })
    } catch (error) {
      this.deps.logError('remote-channel-discord', 'Failed to process Discord message through remote-channel runtime.', redactSecrets({
        message: errorMessage(error),
        messageId,
        channelId: credential.channelId,
        channelConfigId: channel.id,
        senderId: authorId
      }))
      await this.sendChannelMessage({
        channelId: credential.channelId,
        text: DISCORD_MESSAGE_FAILURE_REPLY,
        replyToMessageId: messageId
      })
      return
    }
    if (result.ok && 'ignored' in result && result.ignored) return
    if (!result.ok) {
      this.deps.logError('remote-channel-discord', 'Remote-channel runtime returned a failure for Discord message.', redactSecrets({
        message: result.message,
        result,
        messageId,
        channelId: credential.channelId,
        channelConfigId: channel.id,
        senderId: authorId
      }))
    }
    const reply = result.ok
      ? compactMessage(result.reply ?? result.message ?? '', 'Completed.')
      : safeDiscordFailureReply(result, DISCORD_MESSAGE_FAILURE_REPLY)
    await this.sendChannelMessage({
      channelId: credential.channelId,
      text: reply,
      replyToMessageId: messageId
    })
  }

  private async handleDiscordInteraction(interaction: DiscordInteractionPayload): Promise<void> {
    if (interaction.type !== 2) return
    const interactionId = interaction.id?.trim() ?? ''
    const interactionToken = interaction.token?.trim() ?? ''
    const commandName = interaction.data?.name?.trim().toLowerCase() ?? ''
    const channelId = interaction.channel_id?.trim() ?? ''
    if (!interactionId || !interactionToken || !commandName || !channelId) return
    const commandText = discordInteractionCommandText(commandName)
    const secret = await this.requireSecret()
    const settings = await this.deps.store.load()
    const channel = this.resolveDiscordChannelForInteraction(settings, interaction, secret.bot.botId)
    const credential = channel?.platformCredential?.kind === 'discord'
      ? channel.platformCredential
      : undefined
    if (!channel?.enabled || !credential) {
      await this.sendInteractionReply({
        interactionId,
        interactionToken,
        text: 'This Discord channel is not bound to an enabled SciForge guard.'
      })
      return
    }
    if (!commandText) {
      await this.sendInteractionReply({
        interactionId,
        interactionToken,
        text: 'Unknown command. Try /help, /where, /new, /summary, or /status.'
      })
      return
    }
    const user = interaction.member?.user ?? interaction.user
    const authorId = user?.id?.trim() ?? ''
    const sender = user?.global_name?.trim() || user?.username?.trim() || authorId || 'Discord user'
    let result: RemoteChannelIncomingImMessageResult
    try {
      result = await this.deps.handleIncomingMessage({
        provider: 'discord',
        channelId: channel.id,
        text: commandText,
        runtimePrompt: commandText,
        sender,
        chatType: 'group',
        mentionedBot: true,
        mentionAll: false,
        remoteSession: {
          chatId: credential.channelId,
          messageId: interactionId,
          threadId: '',
          senderId: authorId || interactionId,
          senderName: sender
        }
      })
    } catch (error) {
      this.deps.logError('remote-channel-discord', 'Failed to process Discord interaction through remote-channel runtime.', redactSecrets({
        message: errorMessage(error),
        interactionId,
        channelId: credential.channelId,
        channelConfigId: channel.id,
        senderId: authorId
      }))
      await this.sendInteractionReply({
        interactionId,
        interactionToken,
        text: DISCORD_COMMAND_FAILURE_REPLY
      })
      return
    }
    if (!result.ok) {
      this.deps.logError('remote-channel-discord', 'Remote-channel runtime returned a failure for Discord interaction.', redactSecrets({
        message: result.message,
        result,
        interactionId,
        channelId: credential.channelId,
        channelConfigId: channel.id,
        senderId: authorId
      }))
    }
    const reply = result.ok
      ? compactMessage(result.reply ?? result.message ?? '', 'Completed.')
      : safeDiscordFailureReply(result, DISCORD_COMMAND_FAILURE_REPLY)
    await this.sendInteractionReply({
      interactionId,
      interactionToken,
      text: reply
    })
  }

  private async maybeSendMessageContentIntentWarning(channelId: string, messageId: string): Promise<void> {
    const now = Date.now()
    if (now - this.lastMessageContentWarningAt < MESSAGE_CONTENT_WARNING_INTERVAL_MS) return
    this.lastMessageContentWarningAt = now
    await this.sendChannelMessage({
      channelId,
      replyToMessageId: messageId,
      text: 'I received the Discord event but not the message text. Enable Message Content Intent for this bot in the Discord Developer Portal, then try again.'
    }).catch((error) => {
      this.deps.logError('remote-channel-discord', 'Failed to send Message Content Intent warning.', {
        message: errorMessage(error),
        channelId,
        messageId
      })
    })
  }

  private async sendTyping(channelId: string): Promise<void> {
    const secret = await this.requireSecret()
    await this.discordFetch<void>(
      `/channels/${encodeURIComponent(channelId)}/typing`,
      secret.botToken,
      { method: 'POST' }
    ).catch(() => undefined)
  }

  private resolveDiscordChannels(settings: AppSettingsV1): RemoteChannelV1[] {
    return settings.remoteChannel.channels.filter((channel) =>
      channel.provider === 'discord' && channel.platformCredential?.kind === 'discord'
    )
  }

  private resolveDiscordChannel(
    settings: AppSettingsV1,
    channelConfigId?: string
  ): RemoteChannelV1 | undefined {
    const channels = this.resolveDiscordChannels(settings)
    const id = channelConfigId?.trim()
    if (id) return channels.find((channel) => channel.id === id)
    return channels.find((channel) => channel.enabled) ?? channels[0]
  }

  private resolveDiscordChannelByRemote(
    settings: AppSettingsV1,
    target: { botId: string; guildId: string; channelId: string }
  ): RemoteChannelV1 | undefined {
    return this.resolveDiscordChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'discord'
        ? channel.platformCredential
        : undefined
      return (
        credential?.botId === target.botId.trim() &&
        credential.guildId === target.guildId.trim() &&
        credential.channelId === target.channelId.trim()
      )
    })
  }

  private resolveDiscordChannelForMessage(
    settings: AppSettingsV1,
    message: DiscordMessagePayload
  ): RemoteChannelV1 | undefined {
    const channelId = message.channel_id?.trim() ?? ''
    const guildId = message.guild_id?.trim() ?? ''
    if (!channelId) return undefined
    return this.resolveRunnableDiscordChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'discord'
        ? channel.platformCredential
        : undefined
      return (
        credential?.channelId === channelId &&
        (!guildId || credential.guildId === guildId)
      )
    })
  }

  private resolveDiscordChannelForInteraction(
    settings: AppSettingsV1,
    interaction: DiscordInteractionPayload,
    botId: string
  ): RemoteChannelV1 | undefined {
    const channelId = interaction.channel_id?.trim() ?? ''
    const guildId = interaction.guild_id?.trim() ?? ''
    if (!channelId) return undefined
    return this.resolveRunnableDiscordChannels(settings).find((channel) => {
      const credential = channel.platformCredential?.kind === 'discord'
        ? channel.platformCredential
        : undefined
      return (
        credential?.botId === botId.trim() &&
        credential.channelId === channelId &&
        (!guildId || credential.guildId === guildId)
      )
    })
  }

  private resolveRunnableDiscordChannels(settings: AppSettingsV1): RemoteChannelV1[] {
    return this.resolveDiscordChannels(settings).filter((channel) =>
      channel.enabled && !this.discordChannelConflict(settings, channel)
    )
  }

  private async discordChannelStatus(
    settings: AppSettingsV1,
    channel: RemoteChannelV1,
    secret?: DiscordSecretFile | null
  ): Promise<DiscordBotChannelStatus> {
    const credential = channel.platformCredential?.kind === 'discord'
      ? channel.platformCredential
      : undefined
    const conflict = this.discordChannelConflict(settings, channel)
    const accessError = await this.discordChannelAccessError(settings, channel, credential, conflict, secret)
    return {
      channelConfigId: channel.id,
      guildId: credential?.guildId ?? '',
      guildName: credential?.guildName ?? '',
      channelId: credential?.channelId ?? '',
      channelName: credential?.channelName ?? '',
      label: channel.label,
      enabled: channel.enabled,
      connected: Boolean(channel.enabled && !conflict && !accessError && this.connected),
      ...(conflict ? { conflict } : {}),
      ...(accessError ? { accessError } : {}),
      ...(credential?.guardOwnerInstallationId ? { guardOwnerInstallationId: credential.guardOwnerInstallationId } : {}),
      ...(credential?.guardOwnerUpdatedAt ? { guardOwnerUpdatedAt: credential.guardOwnerUpdatedAt } : {}),
      workspaceRoot: channel.workspaceRoot,
      model: channel.model,
      runtimeId: channel.runtimeId,
      agentName: channel.agentProfile.name.trim() || channel.label
    }
  }

  private async discordChannelAccessError(
    settings: AppSettingsV1,
    channel: RemoteChannelV1,
    credential: RemoteChannelDiscordPlatformCredentialV1 | undefined,
    conflict: DiscordGuardConflictStatus | undefined,
    secret?: DiscordSecretFile | null
  ): Promise<string> {
    if (!this.connected || !channel.enabled || conflict || !credential || !secret?.botToken) return ''
    try {
      await this.discordFetch<DiscordChannelResponse>(
        `/channels/${encodeURIComponent(credential.channelId)}`,
        secret.botToken
      )
      return ''
    } catch (error) {
      const message = errorMessage(error)
      if (message.includes('Unknown Channel') || message.includes('404')) {
        return isChineseLocale(settings)
          ? 'Bot 看不到这个 Discord 频道。请重新绑定一个可见频道，或给 Bot 授予 View Channel 权限。'
          : 'The bot cannot see this Discord channel. Rebind a visible channel or grant View Channel permission.'
      }
      if (message.includes('Missing Access') || message.includes('Forbidden') || message.includes('403')) {
        return isChineseLocale(settings)
          ? 'Bot 没有访问这个 Discord 频道的权限。请授予 View Channel / Send Messages 后重试。'
          : 'The bot does not have access to this Discord channel. Grant View Channel / Send Messages and try again.'
      }
      return isChineseLocale(settings)
        ? `无法验证 Discord 频道权限：${message}`
        : `Could not verify Discord channel access: ${message}`
    }
  }

  private discordChannelConflict(
    settings: AppSettingsV1,
    channel: RemoteChannelV1
  ): DiscordGuardConflictStatus | undefined {
    if (!channel.enabled) return undefined
    const credential = channel.platformCredential?.kind === 'discord'
      ? channel.platformCredential
      : undefined
    if (!credential) return undefined
    const ownerInstallationId = (
      credential.guardOwnerInstallationId ||
      credential.installationId ||
      ''
    ).trim()
    const currentInstallationId = (settings.installationId ?? '').trim()
    if (!ownerInstallationId || !currentInstallationId || ownerInstallationId === currentInstallationId) {
      return undefined
    }
    return {
      channelConfigId: channel.id,
      guildId: credential.guildId,
      guildName: credential.guildName,
      channelId: credential.channelId,
      channelName: credential.channelName,
      ownerInstallationId,
      currentInstallationId,
      takeoverAvailable: true,
      message: 'This bot/channel is being guarded by another SciForge installation.'
    }
  }

  private async fetchBotInfo(botToken: string): Promise<DiscordBotInfo> {
    const [user, application] = await Promise.all([
      this.discordFetch<DiscordUserResponse>('/users/@me', botToken),
      this.discordFetch<DiscordApplicationResponse>('/oauth2/applications/@me', botToken)
    ])
    const botId = user.id?.trim() ?? ''
    const applicationId = application.id?.trim() || botId
    if (!botId || !applicationId) {
      throw new Error('Discord Bot Token did not return a valid bot identity.')
    }
    if (user.bot === false) {
      throw new Error('This token belongs to a Discord user, not a bot.')
    }
    const botUsername = user.global_name?.trim() || user.username?.trim() || 'Discord Bot'
    return {
      applicationId,
      botId,
      botUsername,
      inviteUrl: createDiscordBotInviteUrl(applicationId)
    }
  }

  private async fetchBotGuilds(botToken: string): Promise<DiscordGuild[]> {
    try {
      const rawGuilds = await this.discordFetch<DiscordGuildResponse[]>('/users/@me/guilds', botToken)
      const guilds = this.normalizeGuilds(rawGuilds)
      if (guilds.length > 0) return guilds
    } catch {
      // Bot tokens are not consistently useful on the user-guilds endpoint;
      // fall back to Gateway READY guilds below.
    }
    return this.fetchBotGuildsFromGateway(botToken, (await this.loadSecret())?.proxyUrl)
  }

  private normalizeGuilds(rawGuilds: readonly DiscordGuildResponse[]): DiscordGuild[] {
    return rawGuilds
      .map((guild) => ({
        id: guild.id?.trim() ?? '',
        name: guild.name?.trim() ?? ''
      }))
      .filter((guild): guild is DiscordGuild => Boolean(guild.id && guild.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private fetchBotGuildsFromGateway(botToken: string, proxyUrl?: string): Promise<DiscordGuild[]> {
    return new Promise((resolve, reject) => {
      let socket: RuntimeWebSocket | null = null
      let settled = false
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      const cleanup = (): void => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        if (socket) {
          socket.onclose = null
          socket.close(1000, 'SciForge Discord guild probe finished')
          socket = null
        }
      }
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }
      const timeout = setTimeout(() => {
        settle(() => reject(new Error('Timed out reading Discord servers from Gateway.')))
      }, 12_000)
      try {
        socket = createRuntimeWebSocket(DISCORD_GATEWAY_URL, proxyUrl)
        socket.onmessage = (event) => {
          let packet: DiscordGatewayPacket
          try {
            packet = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as DiscordGatewayPacket
          } catch {
            return
          }
          if (packet.op === 10) {
            const interval = isObject(packet.d) && typeof packet.d.heartbeat_interval === 'number'
              ? packet.d.heartbeat_interval
              : 45_000
            socket?.send(JSON.stringify({
              op: 2,
              d: {
                token: botToken,
                intents: 1,
                properties: {
                  os: process.platform,
                  browser: 'sciforge',
                  device: 'sciforge'
                }
              }
            }))
            heartbeatTimer = setInterval(() => {
              socket?.send(JSON.stringify({ op: 1, d: null }))
            }, interval)
            return
          }
          if (packet.op === 0 && packet.t === 'READY') {
            clearTimeout(timeout)
            const ready = packet.d as DiscordReadyPayload
            settle(() => resolve(this.normalizeGuilds(ready.guilds ?? [])))
          }
          if (packet.op === 9) {
            clearTimeout(timeout)
            settle(() => reject(new Error('Discord Gateway rejected the Bot Token.')))
          }
        }
        socket.onerror = (event) => {
          clearTimeout(timeout)
          settle(() => reject(new Error(`Discord Gateway error while reading servers: ${String(event)}`)))
        }
        socket.onclose = () => {
          clearTimeout(timeout)
          settle(() => reject(new Error('Discord Gateway closed before returning servers.')))
        }
      } catch (error) {
        clearTimeout(timeout)
        settle(() => reject(error instanceof Error ? error : new Error(String(error))))
      }
    })
  }

  private async discordFetch<T>(
    path: string,
    botToken: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bot ${botToken}`)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    let res: Response
    try {
      const url = `${DISCORD_API_BASE}${path}`
      const proxyUrl = (await this.loadSecret())?.proxyUrl ?? ''
      const initWithTimeout: RequestInit = {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(15_000)
      }
      res = proxyUrl
        ? await (this.deps.proxyFetch ?? fetchViaHttpProxy)(url, proxyUrl, initWithTimeout)
        : await (this.deps.fetch ?? fetch)(url, initWithTimeout)
    } catch (error) {
      throw new Error(discordNetworkErrorMessage(error))
    }
    if (!res.ok) {
      throw new Error(discordHttpErrorMessage(res.status, res.statusText, await readDiscordError(res)))
    }
    if (res.status === 204) return undefined as T
    return await res.json() as T
  }

  private async requireSecret(): Promise<DiscordTokenSecretFile> {
    const secret = await this.loadSecret()
    if (!secret?.botToken || !secret.bot) {
      throw new Error('Configure a Discord Bot Token first.')
    }
    return secret as DiscordTokenSecretFile
  }

  private async loadSecret(): Promise<DiscordSecretFile | null> {
    try {
      const raw = await readFile(this.secretPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DiscordSecretFile>
      const botToken = typeof parsed.botToken === 'string' ? parsed.botToken.trim() : ''
      const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : ''
      const proxyUrl = typeof parsed.proxyUrl === 'string' ? parsed.proxyUrl.trim() : ''
      const bot = parsed.bot && typeof parsed.bot === 'object'
        ? {
            applicationId: typeof parsed.bot.applicationId === 'string' ? parsed.bot.applicationId.trim() : '',
            botId: typeof parsed.bot.botId === 'string' ? parsed.bot.botId.trim() : '',
            botUsername: typeof parsed.bot.botUsername === 'string' ? parsed.bot.botUsername.trim() : '',
            inviteUrl: typeof parsed.bot.inviteUrl === 'string' ? parsed.bot.inviteUrl.trim() : ''
        }
        : undefined
      if (!botToken && !clientId && !proxyUrl && !bot?.applicationId) return null
      return {
        ...(botToken ? { botToken } : {}),
        ...(clientId || bot?.applicationId ? { clientId: clientId || bot?.applicationId } : {}),
        ...(proxyUrl ? { proxyUrl } : {}),
        ...(bot?.applicationId && bot.botId ? { bot } : {}),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.deps.logError('remote-channel-discord', 'Failed to read Discord bot secret file.', {
        message: errorMessage(error),
        path: this.secretPath
      })
      return null
    }
  }

  private async saveSecret(secret: DiscordSecretFile): Promise<void> {
    await mkdir(dirname(this.secretPath), { recursive: true })
    await atomicWriteFile(this.secretPath, JSON.stringify(secret, null, 2))
    await chmod(this.secretPath, 0o600).catch(() => undefined)
  }
}

export function createDiscordBotRuntime(deps: DiscordRuntimeDeps): DiscordBotRuntime {
  return new DiscordBotRuntime(deps)
}
