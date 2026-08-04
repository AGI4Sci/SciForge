import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION
} from '@sciforge/domain-sdk/workspace-host'

import { WorkspaceHostJsonlClient } from './client.js'
import { createWorkspaceHostDomainComposition } from './composition.js'
import {
  createWorkspaceHostDaemon,
  probeWorkspaceHostDaemon,
  resolveWorkspaceHostDaemonPaths,
  startWorkspaceHostDaemon
} from './daemon.js'

describe('Workspace Host persistent user daemon', () => {
  it('truthfully rejects root and non-Linux daemon cohorts', async () => {
    assert.deepEqual(
      await probeWorkspaceHostDaemon('/tmp/sciforge-probe', {
        platform: 'linux',
        architecture: 'x64',
        uid: 0
      }),
      {
        supported: false,
        reason: 'Persistent Workspace Host daemon must not run as root.'
      }
    )
    const unsupported = await probeWorkspaceHostDaemon('/tmp/sciforge-probe', {
      platform: 'darwin',
      architecture: 'arm64',
      uid: 501
    })
    assert.equal(unsupported.supported, false)
  })

  it('uses one stable session key for a canonical workspace/domain cohort', async () => {
    const root = await mkdtemp('/tmp/sciforge-daemon-key-')
    const runtime = join(root, 'runtime')
    const left = await resolveWorkspaceHostDaemonPaths(root, runtime, [
      { packageName: 'b', moduleId: 'preview', moduleVersion: '1.0.0' },
      { packageName: 'a', moduleId: 'runtime', moduleVersion: '1.0.0' }
    ])
    const right = await resolveWorkspaceHostDaemonPaths(root, runtime, [
      { packageName: 'a', moduleId: 'runtime', moduleVersion: '1.0.0' },
      { packageName: 'b', moduleId: 'preview', moduleVersion: '1.0.0' }
    ])
    try {
      assert.equal(left.daemonKey, right.daemonKey)
      assert.equal(left.socketPath, right.socketPath)
      assert.notEqual(
        left.daemonKey,
        (await resolveWorkspaceHostDaemonPaths(root, runtime, [
          { packageName: 'a', moduleId: 'runtime', moduleVersion: '2.0.0' }
        ])).daemonKey
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the service session alive across Unix socket relay reconnects', async () => {
    const root = await mkdtemp('/tmp/sciforge-daemon-root-')
    const runtime = await mkdtemp('/tmp/sciforge-daemon-run-')
    const previousOverride =
      process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM
    process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM = '1'
    const egressReadiness: boolean[] = []
    const modelReadiness: boolean[] = []
    const daemon = await createWorkspaceHostDaemon({
      workspaceRoot: root,
      runtimeDirectory: runtime,
      codexRuntimeFactory: async () => ({
        operationHandlers: [{
          operation: WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
          onProcessEnvironmentChanged(
            _environment: NodeJS.ProcessEnv,
            _generation: number,
            ready: boolean
          ) {
            egressReadiness.push(ready)
          },
          onModelAccessChanged(
            _access: unknown,
            _generation: number,
            ready: boolean
          ) {
            modelReadiness.push(ready)
          },
          handler(payload: Record<string, unknown>) {
            return {
              contractVersion: 1,
              runtimeId: payload.runtimeId,
              method: payload.method,
              result: {}
            }
          }
        }],
        dispose: async () => undefined
      }) as never
    })
    const composition = createWorkspaceHostDomainComposition({ log: () => undefined })
    const sockets: Socket[] = []
    try {
      assert.equal((await stat(runtime)).mode & 0o777, 0o700)
      assert.equal((await stat(daemon.metadata.socketPath)).mode & 0o777, 0o600)
      const client = await WorkspaceHostJsonlClient.connect({
        handshake: {
          protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
          clientVersion: '0.1.0',
          workspaceRoot: root,
          contributions: composition.cohorts,
          egressMode: 'local',
          egressAccess: {
            mode: 'local',
            proxyEndpoint: 'http://127.0.0.1:43123/',
            authorization: {
              scheme: 'bearer',
              token: 'a'.repeat(48)
            },
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          },
          modelAccess: {
            baseUrl: 'http://127.0.0.1:44219/v1',
            authorization: {
              scheme: 'bearer',
              token: 'm'.repeat(48)
            },
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          }
        },
        createTransport: async () => {
          const socket = await connectSocket(daemon.metadata.socketPath)
          sockets.push(socket)
          return { input: socket, output: socket }
        }
      })
      const firstSession = client.getSession()
      assert.equal(firstSession.egress.status, 'ready')
      assert.equal(egressReadiness.at(-1), true)
      assert.equal(modelReadiness.at(-1), true)
      const health = await client.request(WORKSPACE_HOST_OPERATIONS.health, {})
      assert.equal(health.sessionId, firstSession.sessionId)
      sockets.at(-1)?.destroy()
      await client.reconnect({ lastAcknowledgedSequence: 0 })
      assert.equal(egressReadiness.includes(false), true)
      assert.equal(modelReadiness.includes(false), true)
      assert.equal(egressReadiness.at(-1), true)
      assert.equal(modelReadiness.at(-1), true)
      assert.equal(client.getSession().sessionId, firstSession.sessionId)
      assert.equal(
        (await client.request(WORKSPACE_HOST_OPERATIONS.health, {})).sessionId,
        firstSession.sessionId
      )
      await client.close()
      await waitFor(() =>
        egressReadiness.at(-1) === false
        && modelReadiness.at(-1) === false
      )
    } finally {
      for (const socket of sockets) socket.destroy()
      composition.dispose()
      await daemon.close()
      if (previousOverride === undefined) {
        delete process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM
      } else {
        process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM =
          previousOverride
      }
      await rm(root, { recursive: true, force: true })
      await rm(runtime, { recursive: true, force: true })
    }
  })

  it('starts one detached daemon and reuses its workspace/cohort session', async () => {
    const root = await mkdtemp('/tmp/sciforge-daemon-start-root-')
    const runtime = await mkdtemp('/tmp/sciforge-daemon-start-run-')
    const composition = createWorkspaceHostDomainComposition({ log: () => undefined })
    const paths = await resolveWorkspaceHostDaemonPaths(
      root,
      runtime,
      composition.cohorts
    )
    const fixtureEntrypoint = join(root, 'daemon-fixture.mjs')
    await writeFile(fixtureEntrypoint, detachedDaemonFixtureSource(), 'utf8')
    let daemonPid: number | undefined
    const previousOverride =
      process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM
    process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM = '1'
    try {
      const options = {
        workspaceRoot: root,
        runtimeDirectory: runtime,
        entrypointPath: fixtureEntrypoint,
        nodeArguments: ['--import', 'tsx'],
        environment: {
          ...process.env,
          SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM: '1'
        }
      }
      const started = await startWorkspaceHostDaemon(options)
      assert.equal(started.lifecycle, 'persistent-daemon')
      assert.equal(started.reused, false)
      const metadata = JSON.parse(
        await readFile(paths.metadataPath, 'utf8')
      ) as { pid: number; sessionId: string }
      daemonPid = metadata.pid
      assert.equal(started.sessionId, metadata.sessionId)

      const reused = await startWorkspaceHostDaemon(options)
      assert.equal(reused.reused, true)
      assert.equal(reused.sessionId, started.sessionId)
    } finally {
      if (daemonPid !== undefined) {
        try {
          process.kill(daemonPid, 'SIGTERM')
        } catch {
          // The child may already have stopped after a failed assertion.
        }
        await waitUntilUnavailable(paths.metadataPath)
      }
      if (previousOverride === undefined) {
        delete process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM
      } else {
        process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM =
          previousOverride
      }
      composition.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(runtime, { recursive: true, force: true })
    }
  })
})

function detachedDaemonFixtureSource(): string {
  const daemonModule = pathToFileURL(
    resolve(import.meta.dirname, 'daemon.ts')
  ).href
  return `
import { runWorkspaceHostDaemon } from ${JSON.stringify(daemonModule)}

const value = (flag) => {
  const index = process.argv.indexOf(flag)
  if (index < 0 || !process.argv[index + 1]) throw new Error(\`Missing \${flag}.\`)
  return Buffer.from(process.argv[index + 1], 'base64url').toString('utf8')
}

await runWorkspaceHostDaemon({
  workspaceRoot: value('--workspace-root-base64'),
  runtimeDirectory: value('--runtime-dir-base64'),
  codexRuntimeFactory: async () => ({
    operationHandlers: [],
    dispose: async () => undefined
  })
})
`
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(path)
    socket.once('connect', () => resolveConnect(socket))
    socket.once('error', rejectConnect)
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  assert.fail('Workspace Host daemon state did not settle before the deadline.')
}

async function waitUntilUnavailable(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await stat(path)
    } catch {
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('Detached Workspace Host daemon did not clean up before the deadline.')
}
