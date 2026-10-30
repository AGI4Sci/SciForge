import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  redactExactSensitiveValues,
  redactSecrets,
  redactSecretText
} from '../shared/secret-redaction'

export type LogLevel = 'error' | 'warn' | 'info'
export type ManagedLogFilePrefix = 'sciforge' | 'sciforge-runtime' | 'kun'

type LoggerConfig = {
  /** Directory where log files are stored. */
  dir: string
  /** Whether logging is enabled. */
  enabled: boolean
  /** Delete log files older than this many days. */
  retentionDays: number
  sensitiveValues: () => readonly string[]
}

let cfg: LoggerConfig = {
  dir: '',
  enabled: true,
  retentionDays: 2,
  sensitiveValues: () => []
}
let logDirectoryPath = ''
let logDirectoryReady: Promise<void> | undefined
let logWriteQueue: Promise<void> = Promise.resolve()
const MANAGED_LOG_FILE_PREFIXES = ['sciforge', 'sciforge-runtime', 'kun'] as const

export function configureLogger(config: Partial<LoggerConfig>): void {
  const next = { ...cfg, ...config }
  if (next.dir !== cfg.dir) {
    logDirectoryPath = ''
    logDirectoryReady = undefined
  }
  cfg = next
}

function logFileName(prefix: ManagedLogFilePrefix, timestamp: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix}-${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}.log`
}

function isManagedLogFile(entry: string): boolean {
  return MANAGED_LOG_FILE_PREFIXES.some(
    (prefix) => entry.startsWith(`${prefix}-`) && entry.endsWith('.log')
  )
}

/** Interval between background log prunes; the write path stays append-only. */
const LOG_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
let logPruneTimer: NodeJS.Timeout | undefined

/**
 * Best-effort prune of old log files. Runs once on startup and then on a
 * low-frequency timer; never on the per-line write path.
 */
async function pruneOldLogs(directory = cfg.dir): Promise<void> {
  try {
    const entries = await readdir(directory)
    const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      if (!isManagedLogFile(entry)) continue
      try {
        const info = await stat(join(directory, entry))
        if (info.mtimeMs < cutoff) {
          await unlink(join(directory, entry))
        }
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* directory may not exist yet — that's fine */
  }
}

export async function appendManagedLogLine(
  prefix: ManagedLogFilePrefix,
  line: string
): Promise<void> {
  if (!cfg.enabled || !cfg.dir) return

  const directory = cfg.dir
  const redactedLine = redactExactSensitiveValues(
    redactSecretText(line),
    safeSensitiveValues()
  )
  const text = redactedLine.endsWith('\n') ? redactedLine : `${redactedLine}\n`

  // Electron's Node runtime can abort while completing many concurrent
  // recursive mkdir callbacks. Serialize the whole managed-log write and
  // initialize each configured directory once instead of mkdir'ing per line.
  const write = logWriteQueue.then(
    () => writeManagedLogLine(directory, prefix, text),
    () => writeManagedLogLine(directory, prefix, text)
  )
  logWriteQueue = write.then(() => undefined, () => undefined)
  await write
}

async function writeManagedLogLine(
  directory: string,
  prefix: ManagedLogFilePrefix,
  text: string
): Promise<void> {
  try {
    await ensureLogDirectory(directory)
    await appendFile(join(directory, logFileName(prefix, new Date())), text, 'utf8')
  } catch {
    /* never crash the app because of logging */
  }
}

async function ensureLogDirectory(directory: string): Promise<void> {
  if (logDirectoryPath !== directory) {
    logDirectoryPath = directory
    logDirectoryReady = mkdir(directory, { recursive: true }).then(() => undefined)
  }
  await logDirectoryReady
}

function safeSensitiveValues(): readonly string[] {
  try {
    return cfg.sensitiveValues()
  } catch {
    return []
  }
}

async function writeLogLine(level: LogLevel, category: string, message: string): Promise<void> {
  const stamp = new Date().toISOString()
  const line = `[${stamp}] [${level.toUpperCase()}] [${category}] ${message}\n`
  await appendManagedLogLine('sciforge', line)
}

export function logError(category: string, message: string, detail?: unknown): void {
  const full = detail !== undefined
    ? `${message} — detail: ${safeStringify(detail)}`
    : message
  void writeLogLine('error', category, full)
}

export function logWarn(category: string, message: string, detail?: unknown): void {
  const full = detail !== undefined
    ? `${message} — detail: ${safeStringify(detail)}`
    : message
  void writeLogLine('warn', category, full)
}

export function logInfo(category: string, message: string): void {
  void writeLogLine('info', category, message)
}

/**
 * On startup, prune old logs immediately, schedule low-frequency background
 * pruning, and log the action.
 */
export async function pruneOnStartup(): Promise<void> {
  await pruneOldLogs()
  scheduleLogPruning()
  logInfo('logger', `Pruned logs older than ${cfg.retentionDays} day(s) on startup`)
}

function scheduleLogPruning(): void {
  if (logPruneTimer) return
  logPruneTimer = setInterval(() => {
    void pruneOldLogs()
  }, LOG_PRUNE_INTERVAL_MS)
  logPruneTimer.unref()
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return redactSecretText(value).slice(0, 2000)
    return JSON.stringify(redactSecrets(value), null, 2).slice(0, 2000)
  } catch {
    return redactSecretText(String(value)).slice(0, 2000)
  }
}
