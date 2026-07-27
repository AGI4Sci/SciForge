import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SOCKS5_PROXY_HELPER_SOURCE,
  Socks5ProxyHelper
} from './socks5-proxy-helper.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('Socks5ProxyHelper', () => {
  it('installs one content-addressed helper and quotes packaged executable paths', async () => {
    const root = await temporaryRoot()
    const helper = new Socks5ProxyHelper({
      storageDirectory: root,
      executablePath: "/Applications/SciForge User's App/SciForge",
      platform: 'darwin'
    })

    await expect(helper.ensureInstalled()).resolves.toBe(helper.helperPath)
    await expect(helper.ensureInstalled()).resolves.toBe(helper.helperPath)
    await expect(readFile(helper.helperPath, 'utf8')).resolves.toBe(SOCKS5_PROXY_HELPER_SOURCE)
    expect(helper.command(
      { host: '127.0.0.1', port: 41_337 },
      { host: 'cluster.internal', port: 2222 }
    )).toBe(
      `'/Applications/SciForge User'"'"'s App/SciForge' '${helper.helperPath}' ` +
      `'127.0.0.1' '41337' '${Buffer.from('cluster.internal').toString('base64url')}' '2222'`
    )
  })

  it('uses Windows argument quoting and rejects non-loopback or invalid endpoints', async () => {
    const helper = new Socks5ProxyHelper({
      storageDirectory: 'C:\\Users\\Researcher\\AppData\\Roaming\\SciForge\\remote-ssh',
      executablePath: 'C:\\Program Files\\SciForge\\SciForge.exe',
      platform: 'win32'
    })

    expect(helper.command(
      { host: '::1', port: 1080 },
      { host: '10.20.30.40', port: 22 }
    )).toBe(
      `"C:\\Program Files\\SciForge\\SciForge.exe" "${helper.helperPath}" "::1" "1080" ` +
      `"${Buffer.from('10.20.30.40').toString('base64url')}" "22"`
    )
    expect(() => helper.command({
      host: '192.0.2.10',
      port: 1080
    } as unknown as Parameters<typeof helper.command>[0], {
      host: 'cluster.internal',
      port: 22
    })).toThrow(/loopback/u)
    expect(() => helper.command({
      host: '127.0.0.1',
      port: 65_536
    }, {
      host: 'cluster.internal',
      port: 22
    })).toThrow(/65535/u)
    expect(() => helper.command({
      host: '127.0.0.1',
      port: 1080
    }, {
      host: `cluster.internal\n; touch /tmp/pwned`,
      port: 22
    })).toThrow(/target host/u)
  })

  it('fails closed when an installed helper no longer matches its content hash', async () => {
    const root = await temporaryRoot()
    const helper = new Socks5ProxyHelper({ storageDirectory: root })
    await helper.ensureInstalled()
    await writeFile(helper.helperPath, 'tampered', 'utf8')

    const restarted = new Socks5ProxyHelper({ storageDirectory: root })
    await expect(restarted.ensureInstalled()).rejects.toThrow(/integrity/u)
  })
})

describe('SOCKS5 proxy helper runtime', () => {
  it('negotiates a no-auth domain CONNECT and transports raw SSH bytes in both directions', async () => {
    const root = await temporaryRoot()
    const helperPath = join(root, 'socks5-proxy.cjs')
    await writeFile(helperPath, SOCKS5_PROXY_HELPER_SOURCE, 'utf8')
    const clientBytes = Buffer.from([0x53, 0x53, 0x48, 0x2d, 0x00, 0xff, 0x0a])
    const serverBytes = Buffer.from([0x53, 0x53, 0x48, 0x2d, 0x80, 0x00, 0x0a])
    const proxy = await createSuccessfulProxy(clientBytes, serverBytes)

    try {
      const child = spawn(process.execPath, [
        helperPath,
        '127.0.0.1',
        String(proxy.port),
        Buffer.from('cluster.internal').toString('base64url'),
        '2222'
      ], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.stdin.end(clientBytes)

      const [exitCode] = await once(child, 'close')

      expect(exitCode).toBe(0)
      await expect(proxy.request).resolves.toEqual({
        targetHost: 'cluster.internal',
        targetPort: 2222
      })
      await expect(proxy.received).resolves.toEqual(clientBytes)
      expect(Buffer.concat(stdout)).toEqual(serverBytes)
      expect(Buffer.concat(stderr).toString('utf8')).toBe('')
    } finally {
      await closeServer(proxy.server)
    }
  })

  it('reports SOCKS negotiation failures only on stderr', async () => {
    const root = await temporaryRoot()
    const helperPath = join(root, 'socks5-proxy.cjs')
    await writeFile(helperPath, SOCKS5_PROXY_HELPER_SOURCE, 'utf8')
    const server = createServer((socket) => {
      socket.once('data', () => socket.end(Buffer.from([5, 2])))
    })
    const port = await listen(server)

    try {
      const child = spawn(process.execPath, [
        helperPath,
        '127.0.0.1',
        String(port),
        Buffer.from('cluster.internal').toString('base64url'),
        '22'
      ], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

      const [exitCode] = await once(child, 'close')

      expect(exitCode).toBe(1)
      expect(Buffer.concat(stdout)).toEqual(Buffer.alloc(0))
      expect(Buffer.concat(stderr).toString('utf8')).toMatch(/does not permit/u)
    } finally {
      await closeServer(server)
    }
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-socks5-helper-'))
  temporaryRoots.push(root)
  return root
}

async function createSuccessfulProxy(
  expectedClientBytes: Buffer,
  serverBytes: Buffer
): Promise<Readonly<{
  server: Server
  port: number
  request: Promise<Readonly<{ targetHost: string; targetPort: number }>>
  received: Promise<Buffer>
}>> {
  let resolveRequest!: (request: Readonly<{ targetHost: string; targetPort: number }>) => void
  const request = new Promise<Readonly<{ targetHost: string; targetPort: number }>>((resolve) => {
    resolveRequest = resolve
  })
  let resolveReceived!: (bytes: Buffer) => void
  const received = new Promise<Buffer>((resolve) => {
    resolveReceived = resolve
  })
  const server = createServer((socket) => {
    handleSuccessfulConnection(
      socket,
      expectedClientBytes,
      serverBytes,
      resolveRequest,
      resolveReceived
    )
  })
  return { server, port: await listen(server), request, received }
}

function handleSuccessfulConnection(
  socket: Socket,
  expectedClientBytes: Buffer,
  serverBytes: Buffer,
  resolveRequest: (request: Readonly<{ targetHost: string; targetPort: number }>) => void,
  resolveReceived: (bytes: Buffer) => void
): void {
  let buffered = Buffer.alloc(0)
  let stage: 'greeting' | 'connect' | 'tunnel' = 'greeting'
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    while (true) {
      if (stage === 'greeting') {
        if (buffered.length < 3) return
        expect(buffered.subarray(0, 3)).toEqual(Buffer.from([5, 1, 0]))
        buffered = buffered.subarray(3)
        stage = 'connect'
        socket.write(Buffer.from([5, 0]))
        continue
      }
      if (stage === 'connect') {
        if (buffered.length < 5) return
        expect(buffered.subarray(0, 4)).toEqual(Buffer.from([5, 1, 0, 3]))
        const hostLength = buffered[4]
        const requestLength = 5 + hostLength + 2
        if (buffered.length < requestLength) return
        const targetHost = buffered.subarray(5, 5 + hostLength).toString('utf8')
        const targetPort = buffered.readUInt16BE(5 + hostLength)
        buffered = buffered.subarray(requestLength)
        resolveRequest({ targetHost, targetPort })
        stage = 'tunnel'
        socket.write(Buffer.concat([
          Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0x20, 0x00]),
          serverBytes
        ]))
        continue
      }
      if (buffered.length < expectedClientBytes.length) return
      const receivedBytes = buffered.subarray(0, expectedClientBytes.length)
      expect(receivedBytes).toEqual(expectedClientBytes)
      resolveReceived(Buffer.from(receivedBytes))
      socket.end()
      return
    }
  })
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test proxy did not bind TCP.')
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  server.close()
  await once(server, 'close')
}
