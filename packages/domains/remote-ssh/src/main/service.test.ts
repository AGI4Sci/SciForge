import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS,
  type RemoteSshLab,
  type RemoteSshLabEnvironmentConfig,
  type RemoteSshLabEnvironmentLocatorConfig
} from '../contract.js'
import {
  RemoteSshService,
  type RemoteSshServiceOptions
} from './service.js'
import type {
  ProcessRequest,
  ProcessResult,
  RemoteSshProcessRunner,
  RemoteSshStreamingProcess,
  RemoteSshStreamingProcessRunner,
  StreamingProcessRequest
} from './process-runner.js'
import {
  workspaceHostHandshakeRequestSchema,
  workspaceHostSensitiveControlSchema,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import type {
  RemoteSshLabEnvironmentManager,
  RemoteSshProxyEndpointOptions
} from './lab-environment.js'
import type { RemoteSshTargetResolver } from './ssh-target-resolver.js'

const temporaryDirectories: string[] = []
const EXECUTION_ID_1 = 'ssh_exec_1234567890abcdef'
const EXECUTION_ID_2 = 'ssh_exec_fedcba0987654321'
const TRANSFER_ID_1 = 'ssh_xfer_1234567890abcdef'
const TRANSFER_ID_2 = 'ssh_xfer_fedcba0987654321'

class FakeProcessRunner implements RemoteSshProcessRunner {
  readonly requests: ProcessRequest[] = []

  constructor(
    private readonly handler: (request: ProcessRequest) => Promise<ProcessResult> = async () => okResult()
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request)
    return this.handler(request)
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('RemoteSshService registry and workspace authorization', () => {
  it('creates a missing local OpenSSH config and opens the canonical path', async () => {
    const userDataDir = await temporaryDirectory('sciforge-remote-ssh-data-')
    const homeDirectory = await temporaryDirectory('sciforge-remote-ssh-home-')
    const openPath = vi.fn(async () => undefined)
    const service = new RemoteSshService({
      userDataDir,
      homeDirectory,
      openPath,
      processRunner: new FakeProcessRunner(),
      environmentManager: createFakeEnvironmentManager()
    })

    await expect(service.openOpenSshConfig()).resolves.toEqual({ opened: true })
    const configPath = join(homeDirectory, '.ssh', 'config')
    await expect(readFile(configPath, 'utf8')).resolves.toBe('')
    expect(openPath).toHaveBeenCalledWith(configPath)
    service.close()
  })

  it('persists labs, targets, and bindings without credentials', async () => {
    const userDataDir = await temporaryDirectory('sciforge-remote-ssh-data-')
    const workspace = await temporaryDirectory('sciforge-remote-ssh-workspace-')
    const runner = new FakeProcessRunner()
    const service = new RemoteSshService({
      userDataDir,
      processRunner: runner,
      environmentManager: createFakeEnvironmentManager()
    })

    expect((await service.getBinding(workspace)).binding).toMatchObject({
      workspaceId: workspace,
      allowedTargetIds: [],
      revision: '0'
    })
    const lab = (await service.saveLab({
      id: 'lab-a',
      displayName: 'Lab A',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'lab-a-vpn',
        gatewaySshAlias: 'lab-a-gateway'
      },
      maxConcurrentExecutions: 4
    })).lab
    expect(lab.environment).toEqual({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: testVirtualBoxUuid('lab-a-vpn'),
      gatewaySshAlias: 'lab-a-gateway'
    })
    const target = (await service.saveTarget({
      id: 'gpu-01',
      labId: lab.id,
      displayName: 'GPU 01',
      sshAlias: 'lab-a-gpu01',
      labels: { gpu: 'a100' },
      capabilities: ['shell', 'file-transfer'],
      maxConcurrentExecutions: 2
    })).target

    expect(await service.listTargets(workspace)).toEqual([])
    expect(await service.listTargetCatalog()).toEqual([target])
    const binding = (await service.saveBinding(workspace, {
      allowedTargetIds: [target.id],
      expectedRevision: '0'
    })).binding
    expect(binding.allowedTargetIds).toEqual([target.id])
    await expect(service.saveBinding(workspace, {
      allowedTargetIds: [],
      expectedRevision: 'stale'
    })).rejects.toThrow(/revision conflict/i)
    service.close()

    const restored = new RemoteSshService({ userDataDir, processRunner: runner })
    expect((await restored.listLabs()).labs).toEqual([lab])
    expect(await restored.listTargets(workspace)).toEqual([target])
    const persisted = await readFile(join(userDataDir, 'remote-ssh', 'registry.json'), 'utf8')
    expect(persisted).not.toMatch(/password|private.?key|credential/i)
  })

  it('rejects aliases that could alter OpenSSH argv and enforces workspace bindings', async () => {
    const { service, workspace, targetId } = await configuredService()
    const otherWorkspace = await temporaryDirectory('sciforge-remote-ssh-other-')

    await expect(service.saveTarget({
      id: 'injected',
      labId: 'lab-a',
      displayName: 'Injected',
      sshAlias: '-oProxyCommand=evil',
      labels: {},
      capabilities: ['shell'],
      maxConcurrentExecutions: 1
    })).rejects.toThrow()
    await expect(service.observeTarget(otherWorkspace, targetId)).rejects.toThrow(/not authorized/i)
    await expect(service.observeTarget(workspace, targetId)).resolves.toMatchObject({
      target: { id: targetId },
      activeExecutions: 0
    })
  })

  it('routes VM environment lifecycle calls and keeps provider cleanup outside the registry lock', async () => {
    const userDataDir = await temporaryDirectory('sciforge-remote-ssh-data-')
    const workspace = await temporaryDirectory('sciforge-remote-ssh-workspace-')
    let notifyRemoveStarted!: () => void
    const removeStarted = new Promise<void>((resolve) => {
      notifyRemoveStarted = resolve
    })
    let releaseRemove!: () => void
    const removeReleased = new Promise<void>((resolve) => {
      releaseRemove = resolve
    })
    let managerClosed = false
    const manager = createFakeEnvironmentManager({
      remove: async () => {
        notifyRemoveStarted()
        await removeReleased
      },
      close: () => {
        managerClosed = true
      }
    })
    const service = new RemoteSshService({
      userDataDir,
      environmentManager: manager,
      processRunner: new FakeProcessRunner()
    })
    const lab = (await service.saveLab({
      id: 'lab-a',
      displayName: 'Lab A',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'lab-a-vpn',
        gatewaySshAlias: 'lab-a-gateway'
      },
      maxConcurrentExecutions: 4
    })).lab

    await expect(service.ensureLabEnvironment(lab.id, lab.revision)).resolves.toMatchObject({
      provider: 'vm',
      state: 'ready'
    })
    await expect(
      service.openLabEnvironmentConsole(lab.id, lab.revision)
    ).resolves.toMatchObject({
      labId: lab.id,
      presentation: { kind: 'opened' }
    })

    const deletion = service.deleteLab({ labId: lab.id, expectedRevision: lab.revision })
    await removeStarted
    await expect(service.saveBinding(workspace, {
      allowedTargetIds: [],
      expectedRevision: '0'
    })).resolves.toMatchObject({ binding: { allowedTargetIds: [] } })
    releaseRemove()
    await expect(deletion).resolves.toEqual({ deletedLabId: lab.id })
    service.close()
    expect(managerClosed).toBe(true)
  })

  it('cleans the previous provider configuration for every material environment change', async () => {
    const cases: Array<Readonly<{
      initial: RemoteSshLabEnvironmentLocatorConfig
      updated: RemoteSshLabEnvironmentLocatorConfig
    }>> = [
      {
        initial: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: 'Research VPN',
          gatewaySshAlias: 'vpn-gateway'
        },
        updated: {
          provider: 'docker',
          image: 'hagb/docker-atrust:latest'
        }
      },
      {
        initial: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: 'Research VPN',
          gatewaySshAlias: 'vpn-gateway'
        },
        updated: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: 'Research VPN 2',
          gatewaySshAlias: 'vpn-gateway'
        }
      },
      {
        initial: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: 'Research VPN',
          gatewaySshAlias: 'vpn-gateway'
        },
        updated: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: 'Research VPN',
          gatewaySshAlias: 'vpn-gateway-new'
        }
      },
      {
        initial: {
          provider: 'docker',
          image: 'hagb/docker-atrust:latest'
        },
        updated: {
          provider: 'docker',
          image: 'registry.example.test/atrust:v2'
        }
      }
    ]

    for (const [index, change] of cases.entries()) {
      const removed: RemoteSshLab[] = []
      const service = new RemoteSshService({
        userDataDir: await temporaryDirectory(`sciforge-remote-ssh-reconfigure-${index}-`),
        processRunner: new FakeProcessRunner(),
        environmentManager: createFakeEnvironmentManager({
          remove: async (lab) => {
            removed.push(lab)
          }
        })
      })
      const initial = (await service.saveLab({
        id: 'lab-a',
        displayName: 'Lab A',
        environment: change.initial,
        maxConcurrentExecutions: 4
      })).lab
      const updated = (await service.saveLab({
        id: initial.id,
        displayName: initial.displayName,
        environment: change.updated,
        maxConcurrentExecutions: initial.maxConcurrentExecutions,
        expectedRevision: initial.revision
      })).lab

      expect(removed).toHaveLength(1)
      expect(removed[0]?.environment).toEqual(canonicalTestEnvironment(change.initial))
      expect(updated.environment).toEqual(canonicalTestEnvironment(change.updated))
      service.close()
    }
  })

  it('does not clean an environment when only lab metadata changes', async () => {
    const removed: RemoteSshLab[] = []
    const service = new RemoteSshService({
      userDataDir: await temporaryDirectory('sciforge-remote-ssh-metadata-update-'),
      processRunner: new FakeProcessRunner(),
      environmentManager: createFakeEnvironmentManager({
        remove: async (lab) => {
          removed.push(lab)
        }
      })
    })
    const initial = (await service.saveLab({
      id: 'lab-a',
      displayName: 'Lab A',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'Research VPN',
        gatewaySshAlias: 'vpn-gateway'
      },
      maxConcurrentExecutions: 4
    })).lab

    await service.saveLab({
      id: initial.id,
      displayName: 'Renamed Lab',
      environment: initial.environment,
      maxConcurrentExecutions: 8,
      expectedRevision: initial.revision
    })

    expect(removed).toEqual([])
  })

  it('rejects one VirtualBox VM selected by name and canonical UUID before cleaning either lab', async () => {
    const removed: RemoteSshLab[] = []
    const service = new RemoteSshService({
      userDataDir: await temporaryDirectory('sciforge-remote-ssh-duplicate-vm-'),
      processRunner: new FakeProcessRunner(),
      environmentManager: createFakeEnvironmentManager({
        remove: async (lab) => {
          removed.push(lab)
        }
      })
    })
    await service.saveLab({
      id: 'lab-a',
      displayName: 'Lab A',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'Shared Research VPN',
        gatewaySshAlias: 'lab-a-gateway'
      },
      maxConcurrentExecutions: 4
    })
    const sharedVmUuid = testVirtualBoxUuid('Shared Research VPN')

    await expect(service.saveLab({
      id: 'lab-b',
      displayName: 'Lab B',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: sharedVmUuid,
        gatewaySshAlias: 'lab-b-gateway'
      },
      maxConcurrentExecutions: 4
    })).rejects.toThrow(
      `VirtualBox VM "${sharedVmUuid}" is already assigned to Remote SSH lab "Lab A" (lab-a).`
    )

    const labB = (await service.saveLab({
      id: 'lab-b',
      displayName: 'Lab B',
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'Independent VPN',
        gatewaySshAlias: 'lab-b-gateway'
      },
      maxConcurrentExecutions: 4
    })).lab
    await expect(service.saveLab({
      id: labB.id,
      displayName: labB.displayName,
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'Shared Research VPN',
        gatewaySshAlias: 'lab-b-gateway'
      },
      maxConcurrentExecutions: labB.maxConcurrentExecutions,
      expectedRevision: labB.revision
    })).rejects.toThrow(/already assigned.*Lab A/u)

    expect(removed).toEqual([])
    expect((await service.listLabs()).labs.map((lab) => lab.id)).toEqual(['lab-a', 'lab-b'])
  })

  it('rejects a persisted registry that assigns one VirtualBox VM to multiple labs', async () => {
    const userDataDir = await temporaryDirectory('sciforge-remote-ssh-invalid-registry-')
    const registryDirectory = join(userDataDir, 'remote-ssh')
    await mkdir(registryDirectory, { recursive: true })
    const timestamp = '2026-07-23T00:00:00.000Z'
    await writeFile(join(registryDirectory, 'registry.json'), `${JSON.stringify({
      schemaVersion: 2,
      labs: ['lab-a', 'lab-b'].map((id) => ({
        schemaVersion: 2,
        id,
        displayName: id === 'lab-a' ? 'Lab A' : 'Lab B',
        environment: {
          provider: 'vm',
          driver: 'virtualbox',
          vmId: '11111111-2222-4333-8444-555555555555',
          gatewaySshAlias: `${id}-gateway`
        },
        maxConcurrentExecutions: 4,
        revision: `${id}-revision`,
        createdAt: timestamp,
        updatedAt: timestamp
      })),
      targets: [],
      bindings: []
    }, null, 2)}\n`, 'utf8')
    const service = new RemoteSshService({
      userDataDir,
      processRunner: new FakeProcessRunner(),
      environmentManager: createFakeEnvironmentManager()
    })

    let failure: unknown
    try {
      await service.listLabs()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Remote SSH registry could not be loaded.')
    expect(String((failure as Error & { cause?: unknown }).cause)).toContain(
      'VirtualBox VM is already assigned'
    )
  })

  it('reports an unsupported registry version without exposing validation internals or rewriting it', async () => {
    const userDataDir = await temporaryDirectory('sciforge-remote-ssh-old-registry-')
    const registryDirectory = join(userDataDir, 'remote-ssh')
    const registryPath = join(registryDirectory, 'registry.json')
    await mkdir(registryDirectory, { recursive: true })
    const original = `${JSON.stringify({
      schemaVersion: 1,
      labs: [],
      targets: [],
      bindings: []
    }, null, 2)}\n`
    await writeFile(registryPath, original, 'utf8')
    const service = new RemoteSshService({
      userDataDir,
      processRunner: new FakeProcessRunner(),
      environmentManager: createFakeEnvironmentManager()
    })

    await expect(service.listLabs()).rejects.toThrow(
      /configuration version 1 is unsupported.*expected 2.*left the existing file unchanged/is
    )
    expect(await readFile(registryPath, 'utf8')).toBe(original)
  })

  it('blocks stale runtime requests across reconfiguration without holding the registry lock', async () => {
    let notifyRemoveStarted!: () => void
    const removeStarted = new Promise<void>((resolve) => {
      notifyRemoveStarted = resolve
    })
    let releaseRemove!: () => void
    const removeReleased = new Promise<void>((resolve) => {
      releaseRemove = resolve
    })
    const removed: RemoteSshLab[] = []
    const endpointProviders: Array<'vm' | 'docker'> = []
    const manager = createFakeEnvironmentManager({
      remove: async (lab) => {
        removed.push(lab)
        notifyRemoveStarted()
        await removeReleased
      },
      proxyEndpoint: async (lab) => {
        endpointProviders.push(lab.environment.provider)
        return { host: '127.0.0.1', port: 41_337 }
      }
    })
    const runner = new FakeProcessRunner()
    const configured = await configuredService({
      processRunner: runner,
      environmentManager: manager
    })
    const initial = (await configured.service.listLabs()).labs[0]!

    const update = configured.service.saveLab({
      id: initial.id,
      displayName: initial.displayName,
      environment: {
        provider: 'docker',
        image: 'hagb/docker-atrust:latest'
      },
      maxConcurrentExecutions: initial.maxConcurrentExecutions,
      expectedRevision: initial.revision
    })
    await removeStarted

    // This normal registry mutation must not wait for provider cleanup.
    const binding = (await configured.service.getBinding(configured.workspace)).binding
    await expect(configured.service.saveBinding(configured.workspace, {
      allowedTargetIds: binding.allowedTargetIds,
      expectedRevision: binding.revision
    })).resolves.toMatchObject({
      binding: { allowedTargetIds: [configured.targetId] }
    })

    // This request has captured the old lab revision and queues behind cleanup.
    // It must be rejected after commit rather than recreating the old VM path.
    const staleExecution = configured.service.executeCommand(
      configured.workspace,
      configured.targetId,
      configured.targetRevision,
      { executionId: EXECUTION_ID_1, script: 'true' }
    )
    await tick()
    releaseRemove()
    const updated = (await update).lab
    await expect(staleExecution).resolves.toMatchObject({ ok: false })
    expect(removed).toHaveLength(1)
    expect(removed[0]?.environment).toEqual(initial.environment)
    expect(endpointProviders).toEqual([])
    expect(runner.requests).toEqual([])

    await expect(configured.service.executeCommand(
      configured.workspace,
      configured.targetId,
      configured.targetRevision,
      { executionId: EXECUTION_ID_2, script: 'true' }
    )).resolves.toMatchObject({ ok: true })
    expect(updated.environment.provider).toBe('docker')
    expect(endpointProviders).toEqual(['docker'])
    expect(runner.requests).toHaveLength(1)
  })
})

describe('RemoteSshService command execution and diagnostics', () => {
  it('runs the only command path through hardened system SSH argv and redacts output', async () => {
    const runner = new FakeProcessRunner(async () => okResult({
      stdout: 'TOKEN=secret-value\n-----BEGIN PRIVATE KEY-----\nabc\n',
      stderr: 'Authorization: Bearer bearer-value'
    }))
    const { service, workspace, targetId, targetRevision } = await configuredService({ processRunner: runner })

    const result = await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'nvidia-smi\n'
    })

    expect(result).toMatchObject({ ok: true, executionId: EXECUTION_ID_1, targetId, exitCode: 0 })
    if (!result.ok) throw new Error('Expected successful SSH command.')
    expect(result.stdout).toContain('TOKEN=[REDACTED]')
    expect(result.stdout).toContain('[REDACTED PRIVATE KEY]')
    expect(result.stdout).not.toContain('secret-value')
    expect(result.stderr).toContain('Bearer [REDACTED]')

    const request = runner.requests[0]!
    expect(request.executable).toBe('ssh')
    expect(request.stdin).toBe('nvidia-smi\n')
    expect(request.args).toContain('BatchMode=yes')
    expect(request.args).toContain('ForwardAgent=no')
    expect(request.args).toContain('ControlMaster=no')
    expect(request.args).toContain('StrictHostKeyChecking=yes')
    const proxyCommand = request.args.find((argument) => argument.startsWith('ProxyCommand='))
    expect(proxyCommand).toContain(Buffer.from('cluster.internal').toString('base64url'))
    expect(proxyCommand).not.toMatch(/%h|%p|docker exec|\bnc\b/u)
    expect(request.args.slice(-4)).toEqual(['--', 'lab-a-gpu01', 'sh', '-s'])
    await expect(service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'true'
    })).rejects.toThrow(/already been used/i)

    await service.saveTarget({
      id: targetId,
      labId: 'lab-a',
      displayName: 'GPU 01 moved',
      sshAlias: 'lab-a-gpu01-new',
      labels: {},
      capabilities: ['shell', 'file-transfer'],
      maxConcurrentExecutions: 2,
      expectedRevision: targetRevision
    })
    await expect(service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_2,
      script: 'true'
    })).rejects.toThrow(/revision conflict/i)
    expect(runner.requests).toHaveLength(1)
  })

  it('uses one provider-neutral ProxyCommand path and applies automatic-start policy per operation', async () => {
    const endpointCalls: Array<Readonly<{
      provider: 'vm' | 'docker'
      startIfStopped: boolean | undefined
    }>> = []
    const environmentManager = createFakeEnvironmentManager({
      proxyEndpoint: async (lab, options) => {
        endpointCalls.push({
          provider: lab.environment.provider,
          startIfStopped: options?.startIfStopped
        })
        return { host: '127.0.0.1', port: 41_337 }
      }
    })
    const runner = new FakeProcessRunner(async (request) => {
      if (request.executable === 'sftp' && request.stdin?.startsWith('get ')) {
        await writeFile(quotedBatchPaths(request.stdin).at(-1)!, 'downloaded', 'utf8')
      }
      return okResult()
    })
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      environmentManager
    })
    await writeFile(join(workspace, 'upload.txt'), 'upload', 'utf8')

    await service.probeTarget(workspace, targetId)
    await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'true'
    })
    await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'upload.txt',
      remotePath: '/remote/upload.txt'
    })
    await service.downloadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_2,
      localPath: 'download.txt',
      remotePath: '/remote/download.txt'
    })

    expect(endpointCalls.map((call) => call.startIfStopped)).toEqual([
      false,
      true,
      true,
      true
    ])
    expect(endpointCalls.every((call) => call.provider === 'vm')).toBe(true)
    const proxyCommands = runner.requests.map((request) =>
      request.args.find((argument) => argument.startsWith('ProxyCommand=')))
    expect(proxyCommands).toHaveLength(4)
    expect(new Set(proxyCommands).size).toBe(1)
  })

  it('keeps VM and Docker behind the same ProxyCommand construction', async () => {
    const providers: Array<'vm' | 'docker'> = []
    const environmentManager = createFakeEnvironmentManager({
      proxyEndpoint: async (lab) => {
        providers.push(lab.environment.provider)
        return { host: '127.0.0.1', port: 41_337 }
      }
    })
    const runner = new FakeProcessRunner()
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      environmentManager
    })

    await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'true'
    })
    const vmLab = (await service.listLabs()).labs[0]!
    await service.saveLab({
      id: vmLab.id,
      displayName: vmLab.displayName,
      environment: {
        provider: 'docker',
        image: 'hagb/docker-atrust:latest'
      },
      maxConcurrentExecutions: vmLab.maxConcurrentExecutions,
      expectedRevision: vmLab.revision
    })
    await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_2,
      script: 'true'
    })

    expect(providers).toEqual(['vm', 'docker'])
    const commands = runner.requests.map((request) =>
      request.args.find((argument) => argument.startsWith('ProxyCommand=')))
    expect(commands[0]).toBe(commands[1])
  })

  it('does not mistake a missing VM gateway tunnel for definitive VPN login state', async () => {
    const runner = new FakeProcessRunner()
    const loginRequired = createFakeEnvironmentManager({
      state: 'login-required',
      proxyEndpoint: async () => {
        throw new Error('VM gateway is waiting for VPN login.')
      }
    })
    const configured = await configuredService({
      processRunner: runner,
      environmentManager: loginRequired
    })

    const command = await configured.service.executeCommand(
      configured.workspace,
      configured.targetId,
      configured.targetRevision,
      { executionId: EXECUTION_ID_1, script: 'true' }
    )
    expect(command).toMatchObject({
      ok: false,
      failure: { code: 'environment_unavailable' }
    })
    const probe = await configured.service.probeTarget(
      configured.workspace,
      configured.targetId
    )
    expect(probe).toMatchObject({
      ready: false,
      target: { status: 'not-tested' }
    })
    await expect(
      configured.service.observeTarget(configured.workspace, configured.targetId)
    ).resolves.toMatchObject({
      recentFailure: { code: 'environment_unavailable' }
    })
    expect(runner.requests).toHaveLength(0)

    const unavailable = await configuredService({
      processRunner: runner,
      environmentManager: createFakeEnvironmentManager({
        state: 'provider-unavailable',
        proxyEndpoint: async () => {
          throw new Error('VirtualBox is unavailable.')
        }
      })
    })
    const result = await unavailable.service.executeCommand(
      unavailable.workspace,
      unavailable.targetId,
      unavailable.targetRevision,
      { executionId: EXECUTION_ID_2, script: 'true' }
    )
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'environment_unavailable' }
    })
    expect(runner.requests).toHaveLength(0)
  })

  it('bounds concurrency per target and cancels queued or running executions by workspace-scoped ID', async () => {
    const starts = new EventEmitter()
    const releases: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const runner = new FakeProcessRunner((request) => new Promise((resolve, reject) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      starts.emit('start')
      const finish = () => {
        active -= 1
        resolve(okResult())
      }
      releases.push(finish)
      request.signal?.addEventListener('abort', () => {
        active -= 1
        reject(abortError())
      }, { once: true })
    }))
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      targetConcurrency: 1
    })

    const first = service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'first'
    })
    await once(starts, 'start')
    const second = service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_2,
      script: 'second'
    })
    await tick()
    expect(runner.requests).toHaveLength(1)
    expect((await service.observeTarget(workspace, targetId)).activeExecutions).toBe(2)

    expect(await service.cancelCommand(workspace, { executionId: EXECUTION_ID_2 })).toEqual({
      executionId: EXECUTION_ID_2,
      cancelled: true
    })
    const secondResult = await second
    expect(secondResult).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
    expect(maxActive).toBe(1)

    releases.shift()?.()
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(await service.cancelCommand(workspace, { executionId: EXECUTION_ID_1 })).toMatchObject({
      cancelled: false
    })
  })

  it('bounds output again after alias redaction expands captured text', async () => {
    const runner = new FakeProcessRunner(async () => okResult({
      stdout: 'a'.repeat(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS)
    }))
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      targetAlias: 'a'
    })

    const result = await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'true'
    })
    expect(result).toMatchObject({ ok: true, outputTruncated: true })
    if (!result.ok) throw new Error('Expected successful SSH command.')
    expect(result.stdout).toHaveLength(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS)
  })

  it('rechecks target revision after leaving the execution queue', async () => {
    const starts = new EventEmitter()
    let releaseFirst: (() => void) | undefined
    const runner = new FakeProcessRunner(() => new Promise((resolve) => {
      starts.emit('start')
      releaseFirst = () => resolve(okResult())
    }))
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      targetConcurrency: 1
    })

    const first = service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'first'
    })
    await once(starts, 'start')
    const queued = service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_2,
      script: 'queued'
    })
    await tick()
    await service.saveTarget({
      id: targetId,
      labId: 'lab-a',
      displayName: 'GPU 01 moved',
      sshAlias: 'lab-a-gpu01-new',
      labels: {},
      capabilities: ['shell', 'file-transfer'],
      maxConcurrentExecutions: 1,
      expectedRevision: targetRevision
    })

    releaseFirst?.()
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(queued).resolves.toMatchObject({ ok: false })
    expect(runner.requests).toHaveLength(1)
  })

  it('probes only the final OpenSSH alias and classifies authentication failures', async () => {
    const runner = new FakeProcessRunner(async () => failedResult('Permission denied (publickey).'))
    const { service, workspace, targetId } = await configuredService({ processRunner: runner })

    const result = await service.probeTarget(workspace, targetId)
    expect(result).toMatchObject({
      target: { status: 'auth-failed' },
      ready: false
    })
    expect(JSON.stringify(result)).not.toContain('lab-a')
    expect(runner.requests).toHaveLength(1)
    expect((await service.observeTarget(workspace, targetId)).recentFailure).toMatchObject({
      code: 'target_auth_failed'
    })
  })

  it('does not expose configured aliases or raw transport diagnostics in command failures', async () => {
    const runner = new FakeProcessRunner(async () => failedResult(
      'ssh: Could not resolve hostname lab-a-gpu01: Name or service not known'
    ))
    const { service, workspace, targetId, targetRevision } = await configuredService({ processRunner: runner })

    const result = await service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'true'
    })
    expect(result).toMatchObject({
      ok: false,
      stdout: '',
      stderr: '',
      failure: { code: 'target_unreachable', message: 'SSH endpoint is unreachable.' }
    })
    expect(JSON.stringify(result)).not.toContain('lab-a-gpu01')
  })
})

describe('RemoteSshService workspace-scoped file transfer', () => {
  it('uploads only regular files resolved inside the workspace through SFTP batch mode', async () => {
    let stagedSource = ''
    let stagedContent = ''
    const runner = new FakeProcessRunner(async (request) => {
      stagedSource = quotedBatchPaths(request.stdin ?? '')[0] ?? ''
      stagedContent = await readFile(stagedSource, 'utf8')
      return okResult()
    })
    const { service, workspace, targetId, targetRevision, userDataDir } = await configuredService({ processRunner: runner })
    await writeFile(join(workspace, 'input data.txt'), 'science', 'utf8')

    const result = await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'input data.txt',
      remotePath: '/project/jobs/input data.txt'
    })
    expect(result).toMatchObject({
      ok: true,
      direction: 'upload',
      localPath: 'input data.txt',
      remotePath: '/project/jobs/input data.txt',
      sizeBytes: 7
    })
    expect(runner.requests[0]).toMatchObject({ executable: 'sftp' })
    expect(runner.requests[0]?.args.slice(-2)).toEqual(['--', 'lab-a-gpu01'])
    expect(stagedSource).toMatch(new RegExp(`^${escapeRegExp(join(userDataDir, 'remote-ssh', 'upload-'))}`))
    expect(stagedContent).toBe('science')

    const outside = await temporaryDirectory('sciforge-remote-ssh-outside-')
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape.txt'))
    const escaped = await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_2,
      localPath: 'escape.txt',
      remotePath: '/project/escape.txt'
    })
    expect(escaped).toMatchObject({ ok: false, failure: { code: 'local_file_unavailable' } })
    expect(runner.requests).toHaveLength(1)
  })

  it('uploads a private staging snapshot even if the workspace path is swapped before SFTP reads it', async () => {
    let workspaceSource = ''
    let outsideSecret = ''
    let stagedContent = ''
    const runner = new FakeProcessRunner(async (request) => {
      await rm(workspaceSource)
      await symlink(outsideSecret, workspaceSource)
      stagedContent = await readFile(quotedBatchPaths(request.stdin ?? '')[0]!, 'utf8')
      return okResult()
    })
    const { service, workspace, targetId, targetRevision } = await configuredService({ processRunner: runner })
    workspaceSource = join(workspace, 'input.txt')
    await writeFile(workspaceSource, 'workspace-data', 'utf8')
    const outside = await temporaryDirectory('sciforge-remote-ssh-outside-')
    outsideSecret = join(outside, 'secret.txt')
    await writeFile(outsideSecret, 'outside-secret', 'utf8')

    const result = await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'input.txt',
      remotePath: '/project/input.txt'
    })

    expect(result).toMatchObject({ ok: true, sizeBytes: 14 })
    expect(stagedContent).toBe('workspace-data')
  })

  it('bounds uploads before SFTP', async () => {
    const runner = new FakeProcessRunner()
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      maxUploadBytes: 4
    })
    await writeFile(join(workspace, 'large.txt'), 'too-large', 'utf8')

    const result = await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'large.txt',
      remotePath: '/project/large.txt'
    })

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: 'transfer_limit_exceeded',
        message: 'Uploaded artifact exceeds the 4-byte limit.'
      }
    })
    expect(runner.requests).toHaveLength(0)
  })

  it('does not misreport a missing local upload as a missing OpenSSH executable', async () => {
    const runner = new FakeProcessRunner()
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner
    })

    const result = await service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'missing.txt',
      remotePath: '/project/missing.txt'
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'local_file_unavailable' }
    })
    expect(runner.requests).toHaveLength(0)
  })

  it('keeps upload staging behind the target gate and reauthorizes queued transfers', async () => {
    const starts = new EventEmitter()
    let releaseExecution: (() => void) | undefined
    const runner = new FakeProcessRunner((request) => {
      if (request.executable === 'sftp') return Promise.resolve(okResult())
      return new Promise((resolve) => {
        starts.emit('start')
        releaseExecution = () => resolve(okResult())
      })
    })
    const { service, workspace, targetId, targetRevision, userDataDir } = await configuredService({
      processRunner: runner,
      targetConcurrency: 1
    })
    await writeFile(join(workspace, 'queued.txt'), 'queued-data', 'utf8')

    const execution = service.executeCommand(workspace, targetId, targetRevision, {
      executionId: EXECUTION_ID_1,
      script: 'hold'
    })
    await once(starts, 'start')
    const upload = service.uploadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'queued.txt',
      remotePath: '/project/queued.txt'
    })
    await tick()
    const entriesWhileQueued = await readdir(join(userDataDir, 'remote-ssh'))
    expect(entriesWhileQueued.some((entry) => entry.startsWith('upload-'))).toBe(false)

    const binding = (await service.getBinding(workspace)).binding
    await service.saveBinding(workspace, {
      allowedTargetIds: [],
      expectedRevision: binding.revision
    })
    releaseExecution?.()

    await expect(execution).resolves.toMatchObject({ ok: true })
    await expect(upload).resolves.toMatchObject({ ok: false })
    expect(runner.requests).toHaveLength(1)
  })

  it('stages bounded downloads outside the workspace and installs with the safe workspace writer', async () => {
    const runner = new FakeProcessRunner(async (request) => {
      const paths = quotedBatchPaths(request.stdin ?? '')
      await writeFile(paths.at(-1)!, 'remote-result', 'utf8')
      return okResult()
    })
    const { service, workspace, targetId, targetRevision, userDataDir } = await configuredService({
      processRunner: runner,
      maxDownloadBytes: 1024
    })

    const result = await service.downloadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'results/output.txt',
      remotePath: '/project/results/output.txt'
    })
    expect(result).toMatchObject({
      ok: true,
      direction: 'download',
      sizeBytes: 13,
      localPath: 'results/output.txt'
    })
    expect(await readFile(join(workspace, 'results', 'output.txt'), 'utf8')).toBe('remote-result')
    expect(quotedBatchPaths(runner.requests[0]?.stdin ?? '').at(-1)).toMatch(
      new RegExp(`^${escapeRegExp(join(userDataDir, 'remote-ssh'))}`)
    )
  })

  it('does not install a download that exceeds the configured bound', async () => {
    const runner = new FakeProcessRunner(async (request) => {
      await writeFile(quotedBatchPaths(request.stdin ?? '').at(-1)!, 'too-large', 'utf8')
      return new Promise((_resolve, reject) => {
        if (request.signal?.aborted) {
          reject(abortError())
          return
        }
        request.signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    })
    const { service, workspace, targetId, targetRevision } = await configuredService({
      processRunner: runner,
      maxDownloadBytes: 4
    })

    const result = await service.downloadFile(workspace, targetId, targetRevision, {
      transferId: TRANSFER_ID_1,
      localPath: 'result.txt',
      remotePath: '/remote/result.txt'
    })
    expect(result).toMatchObject({
      ok: false,
      failure: { message: 'Downloaded artifact exceeds the 4-byte limit.' }
    })
    await expect(readFile(join(workspace, 'result.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('RemoteSshService Workspace Host attachment', () => {
  it('leases local egress, creates a loopback reverse forward, and sends access only in handshake stdin', async () => {
    vi.useFakeTimers()
    const artifactDirectory = await temporaryDirectory('sciforge-workspace-host-artifact-')
    const server = Buffer.from('#!/bin/sh\nexec runtime/node server.mjs "$@"\n')
    await writeFile(join(artifactDirectory, 'workspace-host'), server)
    await chmod(join(artifactDirectory, 'workspace-host'), 0o700)
    const manifest = {
      schemaVersion: 1 as const,
      protocolVersion: 1 as const,
      serverVersion: '1.0.0',
      platform: 'linux' as const,
      arch: 'x64' as const,
      runtime: 'bundled-node@22.18.0' as const,
      entrypoint: 'workspace-host',
      files: [{
        path: 'workspace-host',
        sha256: createHash('sha256').update(server).digest('hex'),
        sizeBytes: server.byteLength,
        executable: true
      }],
      readinessProbes: [],
      contributions: []
    }
    await writeFile(
      join(artifactDirectory, 'manifest.json'),
      `${JSON.stringify(manifest)}\n`,
      'utf8'
    )
    const runner = new FakeProcessRunner(async (request) => {
      if (request.stdin === 'uname -s\nuname -m\n') {
        return okResult({ stdout: 'Linux\nx86_64\n' })
      }
      if (request.stdin?.includes('printf \'%s\\n\' "$HOME"')) {
        return okResult({ stdout: '/home/researcher\n' })
      }
      if (request.stdin?.includes("'probe-daemon'")) {
        return okResult({
          stdout: '{"supported":false,"reason":"daemon unavailable in test"}\n'
        })
      }
      return okResult()
    })
    let attachRequest: StreamingProcessRequest | undefined
    let attachProcess:
      (RemoteSshStreamingProcess & Readonly<{ closed: boolean }>) | undefined
    let handshake: ReturnType<typeof workspaceHostHandshakeRequestSchema.parse> | undefined
    const sensitiveControls: Array<
      ReturnType<typeof workspaceHostSensitiveControlSchema.parse>
    > = []
    const streaming: RemoteSshStreamingProcessRunner = {
      open(request) {
        attachRequest = request
        attachProcess = fakeWorkspaceHostStreamingProcess((line, send) => {
          const decoded: unknown = JSON.parse(line)
          const control = workspaceHostSensitiveControlSchema.safeParse(decoded)
          if (control.success) {
            sensitiveControls.push(control.data)
            return
          }
          handshake = workspaceHostHandshakeRequestSchema.parse(decoded)
          send({
            protocolVersion: 1,
            ok: true,
            session: workspaceHostSession('workspace-session', {
              mode: 'local',
              status: 'ready',
              leaseExpiresAt: handshake.egressAccess?.mode === 'local'
                ? handshake.egressAccess.expiresAt
                : undefined
            })
          })
        })
        return attachProcess
      }
    }
    const configured = await configuredService({
      processRunner: runner,
      streamingProcessRunner: streaming,
      workspaceServerArtifact: async () => ({
        directory: artifactDirectory,
        manifest
      })
    })
    let modelWorkspaceId = ''
    let modelRouteAvailable = true
    const modelHeartbeat = vi.fn(async () => {
      if (!modelRouteAvailable) throw new Error('Model Router route was lost.')
      return {
        workspaceId: modelWorkspaceId,
        leaseId: 'model-lease-1234567890',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    })
    const modelRevoke = vi.fn()
    const workspaceModelAccess = {
      acquire: vi.fn(async (input: Readonly<{ workspaceId: string }>) => {
        modelWorkspaceId = input.workspaceId
        return {
          leaseId: 'model-lease-1234567890',
          workspaceId: input.workspaceId,
          endpoint: {
            protocol: 'http' as const,
            host: '127.0.0.1' as const,
            port: 38_765,
            basePath: '/v1' as const
          },
          authorization: {
            scheme: 'bearer' as const,
            token: 'scoped-model-router-token-1234567890'
          },
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      }),
      heartbeat: modelHeartbeat,
      revoke: modelRevoke
    }
    const authorization = await configured.service.authorizeWorkspaceHostSession(
      configured.workspace,
      configured.targetId,
      configured.targetRevision,
      {
        workspaceRoot: '/cluster/project',
        egress: {
          mode: 'local',
          allowlist: {
            rules: [{ host: 'api.openai.com', ports: [443] }]
          }
        }
      }
    )
    const client = await configured.service.attachWorkspaceHost({
      authorizedSessionId: authorization.authorizedSessionId
    }, {
      owner: { moduleId: 'sciforge.remote-ssh', moduleVersion: '1.0.0' },
      signal: new AbortController().signal,
      workspaceModelAccess,
      log: () => undefined
    })

    const reverseForwards = attachRequest?.args.flatMap((argument, index, args) =>
      argument === '-R' ? [args[index + 1]!] : []
    ) ?? []
    expect(reverseForwards).toHaveLength(2)
    expect(reverseForwards).toEqual(expect.arrayContaining([
      expect.stringMatching(/^127\.0\.0\.1:\d+:127\.0\.0\.1:\d+$/),
      expect.stringMatching(/^127\.0\.0\.1:\d+:127\.0\.0\.1:38765$/)
    ]))
    expect(new Set(reverseForwards.map((forward) => forward.split(':')[1])).size).toBe(2)
    expect(handshake?.egressAccess).toMatchObject({
      mode: 'local',
      proxyEndpoint: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
      authorization: {
        scheme: 'bearer',
        token: expect.stringMatching(/^[A-Za-z0-9._~-]{24,}$/)
      }
    })
    const argv = JSON.stringify(attachRequest?.args)
    expect(argv).not.toContain('exec node')
    expect(argv).toContain('exec \\"$HOME/')
    expect(argv).toContain("--lifecycle-mode 'connection-session'")
    expect(argv).not.toContain(authorization.authorizedSessionId)
    if (handshake?.egressAccess?.mode === 'local') {
      expect(argv).not.toContain(handshake.egressAccess.authorization.token)
    }
    expect(handshake?.modelAccess).toMatchObject({
      baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/),
      authorization: {
        scheme: 'bearer',
        token: 'scoped-model-router-token-1234567890'
      }
    })
    expect(modelWorkspaceId).toBe(authorization.authorizedSessionId)
    expect(argv).not.toContain('scoped-model-router-token-1234567890')
    expect(client.getSession().egress.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(WORKSPACE_EGRESS_HEARTBEAT_TEST_MS)
    expect(attachProcess?.closed).toBe(false)
    expect(sensitiveControls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'workspace-session',
        control: 'egress-renew',
        expiresAt: expect.any(String)
      }),
      expect.objectContaining({
        sessionId: 'workspace-session',
        control: 'model-access-renew',
        expiresAt: expect.any(String)
      })
    ]))
    expect(modelHeartbeat).toHaveBeenCalledTimes(1)

    modelRouteAvailable = false
    await vi.advanceTimersByTimeAsync(WORKSPACE_EGRESS_HEARTBEAT_TEST_MS)
    expect(attachProcess?.closed).toBe(true)
    expect(sensitiveControls).toEqual(expect.arrayContaining([
      {
        protocolVersion: 1,
        sessionId: 'workspace-session',
        control: 'egress-revoke'
      },
      {
        protocolVersion: 1,
        sessionId: 'workspace-session',
        control: 'model-access-revoke'
      }
    ]))
    expect(modelRevoke).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: authorization.authorizedSessionId,
      leaseId: 'model-lease-1234567890',
      token: 'scoped-model-router-token-1234567890'
    }))
    await client.close('test complete')
    configured.service.close()
  })

  it('keeps no-egress sessions offline without minting a Model Router lease', async () => {
    const artifactDirectory = await temporaryDirectory('sciforge-workspace-host-offline-')
    const wrapper = Buffer.from('#!/bin/sh\nexec runtime/node server.mjs "$@"\n')
    await writeFile(join(artifactDirectory, 'workspace-host'), wrapper)
    await chmod(join(artifactDirectory, 'workspace-host'), 0o700)
    const manifest = {
      schemaVersion: 1 as const,
      protocolVersion: 1 as const,
      serverVersion: '1.0.0',
      platform: 'linux' as const,
      arch: 'x64' as const,
      runtime: 'bundled-node@22.18.0' as const,
      entrypoint: 'workspace-host',
      files: [{
        path: 'workspace-host',
        sha256: createHash('sha256').update(wrapper).digest('hex'),
        sizeBytes: wrapper.byteLength,
        executable: true
      }],
      readinessProbes: [],
      contributions: []
    }
    await writeFile(
      join(artifactDirectory, 'manifest.json'),
      `${JSON.stringify(manifest)}\n`,
      'utf8'
    )
    const runner = new FakeProcessRunner(async (request) => {
      if (request.stdin === 'uname -s\nuname -m\n') {
        return okResult({ stdout: 'Linux\nx86_64\n' })
      }
      if (request.stdin?.includes('printf \'%s\\n\' "$HOME"')) {
        return okResult({ stdout: '/home/researcher\n' })
      }
      if (request.stdin?.includes("'probe-daemon'")) {
        return okResult({
          stdout: '{"supported":false,"reason":"daemon unavailable in test"}\n'
        })
      }
      return okResult()
    })
    let attachRequest: StreamingProcessRequest | undefined
    let handshake: ReturnType<typeof workspaceHostHandshakeRequestSchema.parse> | undefined
    const streaming: RemoteSshStreamingProcessRunner = {
      open(request) {
        attachRequest = request
        return fakeWorkspaceHostStreamingProcess((line, send) => {
          handshake = workspaceHostHandshakeRequestSchema.parse(JSON.parse(line))
          send({
            protocolVersion: 1,
            ok: true,
            session: workspaceHostSession('offline-session', {
              mode: 'none',
              status: 'disabled'
            })
          })
        })
      }
    }
    const configured = await configuredService({
      processRunner: runner,
      streamingProcessRunner: streaming,
      workspaceServerArtifact: async () => ({
        directory: artifactDirectory,
        manifest
      })
    })
    const authorization = await configured.service.authorizeWorkspaceHostSession(
      configured.workspace,
      configured.targetId,
      configured.targetRevision,
      {
        workspaceRoot: '/cluster/project',
        egress: { mode: 'none' }
      }
    )
    const acquire = vi.fn(async () => {
      throw new Error('No-egress mode must not acquire model access.')
    })
    const client = await configured.service.attachWorkspaceHost({
      authorizedSessionId: authorization.authorizedSessionId
    }, {
      owner: { moduleId: 'sciforge.remote-ssh', moduleVersion: '1.0.0' },
      signal: new AbortController().signal,
      workspaceModelAccess: {
        acquire,
        heartbeat: async () => {
          throw new Error('No model-access lease was acquired.')
        },
        revoke: () => undefined
      },
      log: () => undefined
    })

    expect(acquire).not.toHaveBeenCalled()
    expect(handshake?.egressAccess).toEqual({ mode: 'none' })
    expect(handshake?.modelAccess).toBeUndefined()
    expect(attachRequest?.args).not.toContain('-R')
    await client.close()
    configured.service.close()
  })
})

async function configuredService(options: Partial<RemoteSshServiceOptions & {
  targetConcurrency: number
  targetAlias: string
}> = {}): Promise<{
  service: RemoteSshService
  workspace: string
  userDataDir: string
  targetId: string
  targetRevision: string
}> {
  const userDataDir = options.userDataDir ?? await temporaryDirectory('sciforge-remote-ssh-data-')
  const workspace = await temporaryDirectory('sciforge-remote-ssh-workspace-')
  const service = new RemoteSshService({
    userDataDir,
    processRunner: options.processRunner ?? new FakeProcessRunner(),
    environmentManager: options.environmentManager ?? fakeEnvironmentManager,
    targetResolver: options.targetResolver ?? fakeTargetResolver,
    ...(options.maxDownloadBytes ? { maxDownloadBytes: options.maxDownloadBytes } : {}),
    ...(options.maxUploadBytes ? { maxUploadBytes: options.maxUploadBytes } : {}),
    ...(options.globalConcurrency ? { globalConcurrency: options.globalConcurrency } : {}),
    ...(options.streamingProcessRunner
      ? { streamingProcessRunner: options.streamingProcessRunner }
      : {}),
    ...(options.workspaceServerArtifact
      ? { workspaceServerArtifact: options.workspaceServerArtifact }
      : {})
  })
  await service.saveLab({
    id: 'lab-a',
    displayName: 'Lab A',
    environment: {
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'lab-a-vpn',
      gatewaySshAlias: 'lab-a-gateway'
    },
    maxConcurrentExecutions: 4
  })
  const target = (await service.saveTarget({
    id: 'gpu-01',
    labId: 'lab-a',
    displayName: 'GPU 01',
    sshAlias: options.targetAlias ?? 'lab-a-gpu01',
    labels: {},
    capabilities: ['shell', 'file-transfer'],
    maxConcurrentExecutions: options.targetConcurrency ?? 2
  })).target
  await service.saveBinding(workspace, { allowedTargetIds: [target.id] })
  return {
    service,
    workspace,
    userDataDir,
    targetId: target.id,
    targetRevision: target.revision
  }
}

function workspaceHostSession(
  sessionId: string,
  egress: WorkspaceHostSession['egress']
): WorkspaceHostSession {
  return {
    protocolVersion: 1,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-instance',
    sessionId,
    lifecycleMode: 'connection-session',
    locator: {
      contractVersion: 1,
      hostSessionId: sessionId,
      path: '/cluster/project'
    },
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: [],
    contributions: [],
    eventSequence: 0,
    replay: { earliestSequence: 0, latestSequence: 0 },
    egress
  }
}

function fakeWorkspaceHostStreamingProcess(
  onLine: (line: string, send: (value: unknown) => void) => void
): RemoteSshStreamingProcess & Readonly<{ closed: boolean }> {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let resolveExit!: (exit: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve
  })
  let closed = false
  const process: RemoteSshStreamingProcess & Readonly<{ closed: boolean }> = {
    stdout,
    stderr,
    exit,
    get closed() {
      return closed
    },
    write: async (data) => {
      for (const line of Buffer.from(data).toString('utf8').split('\n').filter(Boolean)) {
        onLine(line, (value) => stdout.write(`${JSON.stringify(value)}\n`))
      }
    },
    end: () => undefined,
    dispose: async () => {
      if (closed) return
      closed = true
      resolveExit({ exitCode: null, signal: 'SIGTERM' })
      stdout.end()
      stderr.end()
    }
  }
  return process
}

const WORKSPACE_EGRESS_HEARTBEAT_TEST_MS = 30_001

const fakeEnvironmentManager = createFakeEnvironmentManager()

function createFakeEnvironmentManager(options: Readonly<{
  state?: 'provider-unavailable' | 'configuration-required' | 'stopped' |
    'starting' | 'login-required' | 'ready' | 'failed'
  proxyEndpoint?: (
    lab: RemoteSshLab,
    options?: RemoteSshProxyEndpointOptions
  ) => Promise<Readonly<{ host: '127.0.0.1'; port: number }>>
  remove?: (lab: RemoteSshLab) => Promise<void>
  canonicalize?: (
    environment: RemoteSshLabEnvironmentLocatorConfig
  ) => Promise<RemoteSshLabEnvironmentConfig>
  close?: () => void
}> = {}): RemoteSshLabEnvironmentManager {
  const result = (lab: RemoteSshLab, state = options.state ?? 'ready') => ({
    labId: lab.id,
    provider: lab.environment.provider,
    state,
    consoleAvailable: true,
    checkedAt: '2026-07-23T00:00:00.000Z'
  })
  return {
    close: options.close ?? (() => undefined),
    canonicalize: options.canonicalize ?? (async (environment) =>
      environment.provider === 'vm'
        ? { ...environment, vmId: testVirtualBoxUuid(environment.vmId) }
        : environment),
    get: async (lab) => result(lab),
    ensure: async (lab) => result(lab),
    openConsole: async (lab) => ({
      labId: lab.id,
      presentation: { kind: 'opened' }
    }),
    stop: async (lab) => result(lab, 'stopped'),
    remove: options.remove ?? (async () => undefined),
    proxyEndpoint: options.proxyEndpoint ??
      (async () => ({ host: '127.0.0.1', port: 41_337 }))
  }
}

function testVirtualBoxUuid(locator: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(locator)) {
    return locator.toLowerCase()
  }
  const hex = createHash('sha256').update(locator).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

function canonicalTestEnvironment(
  environment: RemoteSshLabEnvironmentLocatorConfig
): RemoteSshLabEnvironmentConfig {
  return environment.provider === 'vm'
    ? { ...environment, vmId: testVirtualBoxUuid(environment.vmId) }
    : environment
}

const fakeTargetResolver: RemoteSshTargetResolver = {
  resolve: async () => ({ host: 'cluster.internal', port: 22 })
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    timedOut: false,
    ...overrides
  }
}

function failedResult(stderr: string): ProcessResult {
  return { ...okResult(), exitCode: 255, stderr }
}

function abortError(): Error {
  const error = new Error('cancelled')
  error.name = 'AbortError'
  return error
}

function once(emitter: EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => emitter.once(event, resolve))
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function quotedBatchPaths(batch: string): string[] {
  return [...batch.matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((match) => match[1]!.replace(/\\([\\"])/g, '$1'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
