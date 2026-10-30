import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  isWorkspaceHostProvider,
  parseWorkspaceHostOperationInput,
  parseWorkspaceHostOperationOutput,
  workspaceHostArtifactManifestSchema,
  workspaceHostEventSchema,
  workspaceHostEgressRenewSchema,
  workspaceHostFileReadOutputSchema,
  workspaceHostHandshakeRequestSchema,
  workspaceHostModelAccessAcquireInputSchema,
  workspaceHostModelAccessHeartbeatInputSchema,
  workspaceHostModelAccessLeaseSchema,
  workspaceHostModelAccessRevokeInputSchema,
  workspaceHostModelAccessRenewSchema,
  workspaceHostModelAccessSchema,
  workspaceNetworkEgressStateSchema,
  workspaceHostOpenRemoteSessionInputSchema,
  workspaceHostPayloadSchema,
  workspaceHostProcessCreateInputSchema,
  workspaceHostProviderAttachInputSchema,
  workspaceHostRuntimeEventPayloadSchema,
  workspaceHostRuntimeInvokeInputSchema,
  workspaceHostRuntimeReplayEventsInputSchema,
  workspaceHostSessionSchema,
  workspaceNetworkEgressSelectionSchema
} from './workspace-host.js'

describe('Workspace Host contracts', () => {
  it('normalizes a placement-neutral session with bounded capability and cohort metadata', () => {
    const session = workspaceHostSessionSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      serverVersion: '1.0.0',
      serverInstanceId: 'server-instance',
      sessionId: 'workspace-session',
      lifecycleMode: 'persistent-daemon',
      locator: {
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        hostSessionId: 'workspace-session',
        path: '/cluster/project'
      },
      platform: {
        os: 'linux',
        architecture: 'x64'
      },
      capabilities: [{
        operation: WORKSPACE_HOST_OPERATIONS.directoryList,
        version: '1.0.0',
        maxRequestBytes: 10_000,
        maxResponseBytes: 100_000
      }],
      contributions: [{
        packageName: '@sciforge/domain-life-science-preview',
        moduleId: 'sciforge.life-science-preview',
        moduleVersion: '1.0.0'
      }],
      eventSequence: 4,
      replay: {
        earliestSequence: 0,
        latestSequence: 4
      },
      egress: {
        mode: 'local',
        status: 'ready'
      }
    })

    assert.equal(session.locator.path, '/cluster/project')
    assert.equal(session.lifecycleMode, 'persistent-daemon')
    assert.equal(session.egress.mode, 'local')
  })

  it('rejects mismatched session ownership and duplicate advertised operations', () => {
    const base = {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      serverVersion: '1.0.0',
      serverInstanceId: 'server-instance',
      sessionId: 'workspace-session',
      lifecycleMode: 'connection-session',
      locator: {
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        hostSessionId: 'different-session',
        path: '/cluster/project'
      },
      platform: { os: 'linux', architecture: 'x64' },
      capabilities: [
        {
          operation: WORKSPACE_HOST_OPERATIONS.fileStat,
          version: '1.0.0',
          maxRequestBytes: 1_000,
          maxResponseBytes: 1_000
        },
        {
          operation: WORKSPACE_HOST_OPERATIONS.fileStat,
          version: '1.0.0',
          maxRequestBytes: 1_000,
          maxResponseBytes: 1_000
        }
      ],
      contributions: [],
      eventSequence: 0,
      replay: { earliestSequence: 0, latestSequence: 0 },
      egress: { mode: 'none', status: 'disabled' }
    }

    assert.throws(() => workspaceHostSessionSchema.parse(base), z.ZodError)
  })

  it('parses built-in inputs and outputs through one canonical strict operation map', () => {
    assert.deepEqual(
      parseWorkspaceHostOperationInput(WORKSPACE_HOST_OPERATIONS.fileStat, {
        path: 'src/index.ts'
      }),
      { path: 'src/index.ts' }
    )
    assert.deepEqual(
      parseWorkspaceHostOperationOutput(WORKSPACE_HOST_OPERATIONS.fileStat, {
        entry: {
          name: 'index.ts',
          path: 'src/index.ts',
          kind: 'file',
          size: 42,
          mtimeMs: 100,
          revision: 'sha256:fixture'
        }
      }),
      {
        entry: {
          name: 'index.ts',
          path: 'src/index.ts',
          kind: 'file',
          size: 42,
          mtimeMs: 100,
          revision: 'sha256:fixture'
        }
      }
    )
    assert.throws(
      () => parseWorkspaceHostOperationInput(WORKSPACE_HOST_OPERATIONS.fileStat, {
        path: 'src/index.ts',
        unsafeHostPath: '/etc/passwd'
      }),
      z.ZodError
    )
  })

  it('does not expose arbitrary argv or environment through controlled process creation', () => {
    assert.deepEqual(workspaceHostProcessCreateInputSchema.parse({
      profile: 'system-shell',
      cwd: '/cluster/project',
      terminal: { columns: 120, rows: 40 }
    }), {
      profile: 'system-shell',
      cwd: '/cluster/project',
      terminal: { columns: 120, rows: 40 }
    })
    assert.throws(
      () => workspaceHostProcessCreateInputSchema.parse({
        profile: 'system-shell',
        executable: '/bin/sh',
        args: ['-c', 'unsafe'],
        environment: { TOKEN: 'secret' }
      }),
      z.ZodError
    )
  })

  it('validates near-limit base64 payloads in linear time without regex recursion', () => {
    const bytes = WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes - 1
    const contentBase64 = Buffer.alloc(bytes, 0x5a).toString('base64')
    const parsed = workspaceHostFileReadOutputSchema.parse({
      contentBase64,
      bytesRead: bytes,
      truncated: false,
      revision: 'sha256:near-limit'
    })

    assert.equal(parsed.contentBase64.length, contentBase64.length)
    assert.throws(
      () => workspaceHostFileReadOutputSchema.parse({
        contentBase64: `${contentBase64.slice(0, -1)}!`,
        bytesRead: bytes,
        truncated: false,
        revision: 'sha256:invalid'
      }),
      z.ZodError
    )
  })

  it('bounds recursive payloads and validates runtime event envelopes', () => {
    let nested: unknown = null
    for (let index = 0; index < 40; index += 1) nested = { nested }
    assert.throws(() => workspaceHostPayloadSchema.parse(nested), z.ZodError)

    assert.deepEqual(workspaceHostRuntimeEventPayloadSchema.parse({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      threadId: 'thread-1',
      streamId: 'stream-1',
      event: { type: 'turn-completed', sequence: 9 }
    }), {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      threadId: 'thread-1',
      streamId: 'stream-1',
      event: { type: 'turn-completed', sequence: 9 }
    })
    assert.equal(
      workspaceHostEventSchema.parse({
        protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        sessionId: 'workspace-session',
        eventId: 'event-1',
        sequence: 9,
        kind: WORKSPACE_HOST_EVENT_KINDS.runtimeEvent,
        occurredAt: '2026-07-30T10:00:00.000Z',
        payload: {
          contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
          runtimeId: 'codex',
          threadId: 'thread-1',
          streamId: 'stream-1',
          event: {}
        }
      }).kind,
      WORKSPACE_HOST_EVENT_KINDS.runtimeEvent
    )
  })

  it('keeps broker authorization opaque at the provider boundary', () => {
    const input = workspaceHostProviderAttachInputSchema.parse({
      authorizedSessionId: 'remote-ssh-package-session',
      resume: {
        sessionId: 'prior-workspace-session',
        lastAcknowledgedSequence: 42
      }
    })

    assert.equal(input.authorizedSessionId, 'remote-ssh-package-session')
    assert.equal(Object.hasOwn(input, 'resource'), false)
    assert.equal(Object.hasOwn(input, 'workspaceRoot'), false)
    assert.equal(Object.hasOwn(input, 'egress'), false)
    assert.throws(
      () => workspaceHostProviderAttachInputSchema.parse({
        authorizedSessionId: 'remote-ssh-package-session',
        workspaceRoot: '/drifted/root',
        egress: { mode: 'none' }
      }),
      z.ZodError
    )
    assert.equal(isWorkspaceHostProvider({ attach: async () => ({}) }), true)
    assert.equal(isWorkspaceHostProvider({ open: async () => ({}) }), false)
  })

  it('hands renderer authorization to the host without duplicating workspace policy', () => {
    assert.deepEqual(workspaceHostOpenRemoteSessionInputSchema.parse({
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'remote-ssh-package-session'
    }), {
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'remote-ssh-package-session'
    })
    assert.throws(
      () => workspaceHostOpenRemoteSessionInputSchema.parse({
        providerId: 'remote-ssh.workspace-host-provider',
        authorizedSessionId: 'remote-ssh-package-session',
        workspaceRoot: '/drifted/root',
        egress: { mode: 'none' }
      }),
      z.ZodError
    )
  })

  it('accepts egress secrets only in a bounded SSH first-frame access field', () => {
    const token = 'a'.repeat(32)
    const handshake = workspaceHostHandshakeRequestSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      clientVersion: '1.0.0',
      workspaceRoot: '/cluster/project',
      contributions: [],
      egressMode: 'local',
      egressAccess: {
        mode: 'local',
        proxyEndpoint: 'http://127.0.0.1:43129/',
        authorization: {
          scheme: 'bearer',
          token
        },
        expiresAt: '2026-07-30T12:00:00.000Z'
      }
    })

    assert.equal(handshake.egressAccess?.mode, 'local')
    assert.throws(
      () => workspaceHostHandshakeRequestSchema.parse({
        ...handshake,
        egressAccess: {
          mode: 'local',
          proxyEndpoint: 'http://10.0.0.5:43129/',
          authorization: { scheme: 'bearer', token },
          expiresAt: '2026-07-30T12:00:00.000Z'
        }
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceHostHandshakeRequestSchema.parse({
        ...handshake,
        egressAccess: {
          ...handshake.egressAccess,
          proxyEndpoint: 'http://localhost:43129/'
        }
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceHostHandshakeRequestSchema.parse({
        ...handshake,
        egressMode: 'remote-target'
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceHostHandshakeRequestSchema.parse({
        ...handshake,
        egressMode: 'none',
        egressAccess: {
          mode: 'none',
          authorization: { scheme: 'bearer', token }
        }
      }),
      z.ZodError
    )
  })

  it('keeps scoped model access separate and renews sensitive leases without tokens', () => {
    const token = 'm'.repeat(32)
    const modelAccess = workspaceHostModelAccessSchema.parse({
      baseUrl: 'http://127.0.0.1:44219/v1',
      authorization: { scheme: 'bearer', token },
      expiresAt: '2026-07-30T12:00:00.000Z'
    })
    const handshake = workspaceHostHandshakeRequestSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      clientVersion: '1.0.0',
      workspaceRoot: '/cluster/project',
      contributions: [],
      egressMode: 'local',
      modelAccess
    })
    assert.equal(handshake.modelAccess?.baseUrl, 'http://127.0.0.1:44219/v1')
    assert.deepEqual(workspaceHostEgressRenewSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: 'session',
      control: 'egress-renew',
      expiresAt: '2026-07-30T12:01:00.000Z'
    }), {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: 'session',
      control: 'egress-renew',
      expiresAt: '2026-07-30T12:01:00.000Z'
    })
    assert.deepEqual(workspaceHostModelAccessRenewSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: 'session',
      control: 'model-access-renew',
      expiresAt: '2026-07-30T12:01:00.000Z'
    }), {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: 'session',
      control: 'model-access-renew',
      expiresAt: '2026-07-30T12:01:00.000Z'
    })
    assert.throws(
      () => workspaceHostModelAccessSchema.parse({
        ...modelAccess,
        baseUrl: 'https://models.example/v1'
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceHostModelAccessSchema.parse({
        ...modelAccess,
        baseUrl: 'http://127.0.0.1:44219/not-v1'
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceHostHandshakeRequestSchema.parse({
        ...handshake,
        egressMode: 'none'
      }),
      z.ZodError
    )
  })

  it('keeps static Model Router keys outside the provider lease boundary', () => {
    const token = 'm'.repeat(32)
    const lease = workspaceHostModelAccessLeaseSchema.parse({
      leaseId: 'model-lease-1',
      workspaceId: 'workspace-1',
      endpoint: {
        protocol: 'http',
        host: '127.0.0.1',
        port: 44_219,
        basePath: '/v1'
      },
      authorization: { scheme: 'bearer', token },
      issuedAt: '2026-07-30T12:00:00.000Z',
      expiresAt: '2026-07-30T12:01:00.000Z'
    })
    assert.equal(Object.hasOwn(lease, 'runtimeKey'), false)
    assert.deepEqual(workspaceHostModelAccessAcquireInputSchema.parse({
      workspaceId: 'workspace-1',
      ttlMs: 60_000
    }), {
      workspaceId: 'workspace-1',
      ttlMs: 60_000
    })
    assert.deepEqual(workspaceHostModelAccessHeartbeatInputSchema.parse({
      workspaceId: 'workspace-1',
      leaseId: lease.leaseId,
      token,
      ttlMs: 60_000
    }), {
      workspaceId: 'workspace-1',
      leaseId: lease.leaseId,
      token,
      ttlMs: 60_000
    })
    assert.deepEqual(workspaceHostModelAccessRevokeInputSchema.parse({
      workspaceId: 'workspace-1',
      leaseId: lease.leaseId,
      token
    }), {
      workspaceId: 'workspace-1',
      leaseId: lease.leaseId,
      token
    })
    assert.throws(
      () => workspaceHostModelAccessLeaseSchema.parse({
        ...lease,
        runtimeKey: 'desktop-static-secret'
      }),
      z.ZodError
    )
  })

  it('binds egress authorization to an exact bounded host and port allowlist', () => {
    const selection = workspaceNetworkEgressSelectionSchema.parse({
      mode: 'remote-target',
      authorizedSessionId: 'cpu-egress-package-session',
      allowlist: {
        rules: [
          { host: 'api.openai.com', ports: [443] },
          { host: 'model-router.internal', ports: [443, 8443] }
        ]
      }
    })

    assert.equal(selection.mode, 'remote-target')
    assert.throws(
      () => workspaceNetworkEgressSelectionSchema.parse({
        mode: 'local',
        allowlist: {
          rules: [{ host: '*.openai.com', ports: [443] }]
        }
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceNetworkEgressSelectionSchema.parse({
        mode: 'local',
        allowlist: {
          rules: [
            { host: 'api.openai.com', ports: [443] },
            { host: 'api.openai.com', ports: [8443] }
          ]
        }
      }),
      z.ZodError
    )
    assert.throws(
      () => workspaceNetworkEgressSelectionSchema.parse({
        mode: 'local',
        allowlist: {
          rules: [{ host: 'api.openai.com', ports: [0, 65_536] }]
        }
      }),
      z.ZodError
    )
  })

  it('keeps secret-bearing egress access out of public session state', () => {
    assert.deepEqual(workspaceNetworkEgressStateSchema.parse({
      mode: 'remote-target',
      status: 'ready',
      leaseExpiresAt: '2026-07-30T12:00:00.000Z'
    }), {
      mode: 'remote-target',
      status: 'ready',
      leaseExpiresAt: '2026-07-30T12:00:00.000Z'
    })
    assert.throws(
      () => workspaceNetworkEgressStateSchema.parse({
        mode: 'remote-target',
        status: 'ready',
        proxyEndpoint: 'http://127.0.0.1:43129/',
        authorization: { scheme: 'bearer', token: 'a'.repeat(32) }
      }),
      z.ZodError
    )
  })

  it('validates one integrity-bound Linux x64 server artifact without worker types', () => {
    const digest = 'a'.repeat(64)
    const manifest = workspaceHostArtifactManifestSchema.parse({
      schemaVersion: 1,
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      serverVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      runtime: 'bundled-node@22.18.0',
      entrypoint: 'server.mjs',
      files: [{
        path: 'server.mjs',
        sha256: digest,
        sizeBytes: 42,
        executable: true
      }],
      readinessProbes: []
    })

    assert.deepEqual(manifest.contributions, [])
    assert.throws(
      () => workspaceHostArtifactManifestSchema.parse({
        ...manifest,
        entrypoint: '../server.mjs'
      }),
      z.ZodError
    )
  })

  it('requires the runtime invoke contract version and known adapter method', () => {
    assert.equal(workspaceHostRuntimeInvokeInputSchema.parse({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      method: 'startTurn',
      input: { threadId: 'thread-1' }
    }).method, 'startTurn')
    for (const method of [
      'readThreadStatus',
      'readThreadPage',
      'readToolArtifact'
    ] as const) {
      assert.equal(workspaceHostRuntimeInvokeInputSchema.parse({
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        runtimeId: 'codex',
        method,
        input: { threadId: 'thread-1' }
      }).method, method)
    }
    assert.throws(
      () => workspaceHostRuntimeInvokeInputSchema.parse({
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        runtimeId: 'codex',
        method: 'readThread',
        input: { threadId: 'thread-1' }
      }),
      z.ZodError
    )
    assert.equal(workspaceHostRuntimeReplayEventsInputSchema.parse({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      threadId: 'thread-1',
      sinceSeq: 42
    }).sinceSeq, 42)
    assert.throws(
      () => workspaceHostRuntimeInvokeInputSchema.parse({
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        runtimeId: 'codex',
        method: 'runArbitraryShell'
      }),
      z.ZodError
    )
  })
})
