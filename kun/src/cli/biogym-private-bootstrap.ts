import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import type { BioGymPrivateBridgeConfig } from '../adapters/tool/biogym-design-tool.js'

export const BIOGYM_PRIVATE_BOOTSTRAP_FD = 3
export const BIOGYM_PRIVATE_BOOTSTRAP_VERSION = 1 as const
const BIOGYM_PRIVATE_BOOTSTRAP_MAX_BYTES = 16_384
const BIOGYM_PRIVATE_BOOTSTRAP_TIMEOUT_MS = 2_000

type BootstrapConsumerOptions = {
  openStream?: () => Readable
  timeoutMs?: number
  maxBytes?: number
}

/**
 * Create a one-shot reader for Electron's inherited private bootstrap pipe.
 * Missing, malformed, oversized, or stalled input fails closed by returning no
 * bridge. The pipe is destroyed/closed before runtime composition begins.
 */
export function createBioGymPrivateBootstrapConsumer(
  options: BootstrapConsumerOptions = {}
): () => Promise<BioGymPrivateBridgeConfig | undefined> {
  let consumed = false
  return async () => {
    if (consumed) return undefined
    consumed = true

    let stream: Readable
    try {
      stream = options.openStream?.() ?? createReadStream('/dev/null', {
        fd: BIOGYM_PRIVATE_BOOTSTRAP_FD,
        autoClose: true
      })
    } catch {
      return undefined
    }

    const payload = await readBoundedStream(
      stream,
      options.maxBytes ?? BIOGYM_PRIVATE_BOOTSTRAP_MAX_BYTES,
      options.timeoutMs ?? BIOGYM_PRIVATE_BOOTSTRAP_TIMEOUT_MS
    )
    return parseBioGymPrivateBootstrap(payload)
  }
}

export const consumeBioGymPrivateBootstrap = createBioGymPrivateBootstrapConsumer()

export function parseBioGymPrivateBootstrap(
  text: string | undefined
): BioGymPrivateBridgeConfig | undefined {
  if (!text?.trim()) return undefined
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'bioGymBridge'])) return undefined
  if (value.version !== BIOGYM_PRIVATE_BOOTSTRAP_VERSION) return undefined
  const bridge = value.bioGymBridge
  if (!isRecord(bridge) || !hasOnlyKeys(bridge, ['baseUrl', 'token'])) return undefined
  if (typeof bridge.baseUrl !== 'string' || typeof bridge.token !== 'string') return undefined
  const baseUrl = bridge.baseUrl.trim()
  const token = bridge.token.trim()
  if (!baseUrl || !token || baseUrl.length > 2_048 || token.length > 8_192) return undefined
  return { baseUrl, token }
}

function readBoundedStream(
  stream: Readable,
  maxBytes: number,
  timeoutMs: number
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const settle = (value: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.removeAllListeners()
      stream.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => settle(undefined), Math.max(1, timeoutMs))
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBytes) {
        settle(undefined)
        return
      }
      chunks.push(buffer)
    })
    stream.once('end', () => settle(Buffer.concat(chunks).toString('utf8')))
    stream.once('error', () => settle(undefined))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}
