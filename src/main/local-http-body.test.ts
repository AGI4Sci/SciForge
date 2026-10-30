import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import {
  LocalHttpBodyTooLargeError,
  readIncomingMessageBody
} from './local-http-body'

describe('local HTTP body reader', () => {
  it('rejects declared bodies over the limit', async () => {
    const request = Readable.from([Buffer.from('{}')]) as IncomingMessage
    request.headers = { 'content-length': '12' }

    await expect(readIncomingMessageBody(request, 4)).rejects.toBeInstanceOf(LocalHttpBodyTooLargeError)
  })

  it('rejects streamed bodies over the limit', async () => {
    const request = Readable.from([Buffer.from('abc'), Buffer.from('def')]) as IncomingMessage
    request.headers = {}

    await expect(readIncomingMessageBody(request, 4)).rejects.toBeInstanceOf(LocalHttpBodyTooLargeError)
  })

  it('returns text for bodies within the limit', async () => {
    const request = Readable.from([Buffer.from('{"ok":true}')]) as IncomingMessage
    request.headers = {}

    await expect(readIncomingMessageBody(request, 32)).resolves.toBe('{"ok":true}')
  })
})
