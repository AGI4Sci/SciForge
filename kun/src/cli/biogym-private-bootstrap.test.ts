import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  createBioGymPrivateBootstrapConsumer,
  parseBioGymPrivateBootstrap
} from './biogym-private-bootstrap.js'

const VALID_PAYLOAD = JSON.stringify({
  version: 1,
  bioGymBridge: {
    baseUrl: 'http://127.0.0.1:43210',
    token: 'private-token'
  }
})

describe('BioGym private bootstrap pipe', () => {
  it('consumes the pipe exactly once and returns a private bridge config', async () => {
    let opens = 0
    const consume = createBioGymPrivateBootstrapConsumer({
      openStream: () => {
        opens += 1
        return Readable.from([VALID_PAYLOAD])
      }
    })

    await expect(consume()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:43210',
      token: 'private-token'
    })
    await expect(consume()).resolves.toBeUndefined()
    expect(opens).toBe(1)
  })

  it.each([
    '',
    '{not-json',
    JSON.stringify({ version: 2, bioGymBridge: { baseUrl: 'http://127.0.0.1:1', token: 'x' } }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({
      version: 1,
      bioGymBridge: { baseUrl: 'http://127.0.0.1:1', token: 'x', injected: true }
    }),
    JSON.stringify({
      version: 1,
      bioGymBridge: { baseUrl: 'http://127.0.0.1:1', token: '' }
    })
  ])('fails closed for missing or malformed payload %#', (payload) => {
    expect(parseBioGymPrivateBootstrap(payload)).toBeUndefined()
  })

  it('fails closed for an oversized pipe payload', async () => {
    const consume = createBioGymPrivateBootstrapConsumer({
      openStream: () => Readable.from(['x'.repeat(128)]),
      maxBytes: 32
    })
    await expect(consume()).resolves.toBeUndefined()
  })

  it('fails closed when the inherited descriptor is missing', async () => {
    const missing = new Readable({ read() {} })
    const consume = createBioGymPrivateBootstrapConsumer({
      openStream: () => {
        queueMicrotask(() => missing.destroy(new Error('EBADF')))
        return missing
      }
    })
    await expect(consume()).resolves.toBeUndefined()
  })
})
