import { describe, expect, it } from 'vitest'
import { trustedLoopbackEndpoint, trustedLoopbackOrigin } from './trusted-loopback-url'

describe('trusted Computer Use loopback URLs', () => {
  it.each([
    'http://127.0.0.1:3900',
    'http://localhost:3900/',
    'http://[::1]:3900'
  ])('accepts a credential-free loopback HTTP origin: %s', (value) => {
    expect(trustedLoopbackOrigin(value).protocol).toBe('http:')
  })

  it.each([
    'https://127.0.0.1:3900',
    'http://example.com:3900',
    'http://user:secret@127.0.0.1:3900',
    'http://127.0.0.1:3900/prefix',
    'http://127.0.0.1:3900/?next=http://example.com',
    'http://127.0.0.1:3900/#fragment'
  ])('rejects an untrusted or ambiguous origin: %s', (value) => {
    expect(() => trustedLoopbackOrigin(value)).toThrow(/loopback HTTP origin/)
  })

  it('joins only fixed local paths without changing authority', () => {
    expect(
      trustedLoopbackEndpoint('http://[::1]:3900', '/computer-use/status')
    ).toBe('http://[::1]:3900/computer-use/status')
    expect(() => trustedLoopbackEndpoint('http://127.0.0.1:3900', '//evil.test/x'))
      .toThrow(/path is invalid/)
  })
})
