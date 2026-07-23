import { isIP } from 'node:net'
import type { Socks5TargetEndpoint } from './socks5-proxy-helper.js'
import type {
  ProcessResult,
  RemoteSshProcessRunner
} from './process-runner.js'
import { requireSshAlias } from './validation.js'

const CONFIG_RESOLUTION_TIMEOUT_MS = 10_000
const CONFIG_OUTPUT_LIMIT_BYTES = 64 * 1_024

export interface RemoteSshTargetResolver {
  resolve(alias: string, signal?: AbortSignal): Promise<Socks5TargetEndpoint>
}

export class SystemOpenSshTargetResolver implements RemoteSshTargetResolver {
  constructor(private readonly processRunner: RemoteSshProcessRunner) {}

  async resolve(alias: string, signal?: AbortSignal): Promise<Socks5TargetEndpoint> {
    let result: ProcessResult
    try {
      result = await this.processRunner.run({
        executable: 'ssh',
        args: ['-G', '--', requireSshAlias(alias)],
        timeoutMs: CONFIG_RESOLUTION_TIMEOUT_MS,
        maxOutputBytes: CONFIG_OUTPUT_LIMIT_BYTES,
        ...(signal ? { signal } : {})
      })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new OpenSshTargetResolutionError('missing-executable')
      }
      throw error
    }
    if (result.exitCode !== 0 || result.timedOut || result.truncated) {
      throw new OpenSshTargetResolutionError('invalid-config')
    }
    return parseOpenSshTarget(result.stdout)
  }
}

export class OpenSshTargetResolutionError extends Error {
  constructor(readonly reason: 'missing-executable' | 'invalid-config') {
    super(reason === 'missing-executable'
      ? 'The required system OpenSSH executable was not found.'
      : 'OpenSSH configuration could not resolve the target endpoint.')
    this.name = 'OpenSshTargetResolutionError'
  }
}

export function parseOpenSshTarget(output: string): Socks5TargetEndpoint {
  let host: string | undefined
  let port: number | undefined
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf(' ')
    if (separator < 1) continue
    const key = line.slice(0, separator).toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key === 'hostname' && host === undefined) host = value
    if (key === 'port' && port === undefined && /^[0-9]{1,5}$/u.test(value)) {
      port = Number.parseInt(value, 10)
    }
  }
  if (
    !host ||
    hasHostControlOrWhitespace(host) ||
    Buffer.byteLength(host, 'utf8') > 255 ||
    (isIP(host) === 0 && !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(host)) ||
    !Number.isSafeInteger(port) ||
    port === undefined ||
    port < 1 ||
    port > 65_535
  ) {
    throw new OpenSshTargetResolutionError('invalid-config')
  }
  return { host, port }
}

function hasHostControlOrWhitespace(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) return true
  }
  return false
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}
