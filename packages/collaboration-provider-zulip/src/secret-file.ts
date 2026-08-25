import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { ZulipProviderError } from './errors.js'
import type { ZulipCredentialResolver } from './http-client.js'

const MAX_SECRET_FILE_BYTES = 64 * 1024
const SAFE_SECRET_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

class ZulipSecretFileRuntime {
  private constructor(private readonly root: string) {}

  static async create(directory: string): Promise<ZulipSecretFileRuntime> {
    let root: string
    try {
      root = await realpath(directory)
      const info = await stat(root)
      if (!info.isDirectory()) throw new TypeError('not a directory')
    } catch (error) {
      throw new ZulipProviderError(
        'authentication_failed',
        'The Zulip secret-file directory is unavailable.',
        { cause: error }
      )
    }
    return new ZulipSecretFileRuntime(root)
  }

  credentialResolver(secretReference: string): ZulipCredentialResolver {
    if (
      !SAFE_SECRET_REFERENCE.test(secretReference) ||
      secretReference === '.' ||
      secretReference === '..'
    ) {
      throw new ZulipProviderError(
        'invalid_payload',
        'The Zulip credential reference must be a safe file basename.'
      )
    }
    return async () => ({ apiKey: await this.readSecretFile(secretReference) })
  }

  private async readSecretFile(secretReference: string): Promise<string> {
    let candidate: string
    try {
      candidate = await realpath(resolve(this.root, secretReference))
    } catch (error) {
      throw new ZulipProviderError(
        'authentication_failed',
        'The Zulip credential file is unavailable.',
        { cause: error }
      )
    }
    const pathFromRoot = relative(this.root, candidate)
    if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new ZulipProviderError(
        'permission_denied',
        'The Zulip credential reference escapes its private directory.'
      )
    }
    let file
    try {
      file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      throw new ZulipProviderError(
        'authentication_failed',
        'The Zulip credential file is unavailable.',
        { cause: error }
      )
    }
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size === 0 || info.size > MAX_SECRET_FILE_BYTES) {
        throw new ZulipProviderError(
          'authentication_failed',
          'The Zulip credential must be a bounded non-empty regular file.'
        )
      }
      if ((info.mode & 0o077) !== 0) {
        throw new ZulipProviderError(
          'permission_denied',
          'The Zulip credential file must be private to its owner.'
        )
      }
      const value = (await file.readFile('utf8')).trim()
      if (!value) {
        throw new ZulipProviderError('authentication_failed', 'The Zulip credential file is empty.')
      }
      return value
    } catch (error) {
      if (error instanceof ZulipProviderError) throw error
      throw new ZulipProviderError(
        'authentication_failed',
        'The Zulip credential file could not be read.',
        { cause: error }
      )
    } finally {
      await file.close()
    }
  }
}

export async function createZulipCredentialResolver(
  directory: string,
  secretReference: string
): Promise<ZulipCredentialResolver> {
  return (await ZulipSecretFileRuntime.create(directory)).credentialResolver(secretReference)
}
