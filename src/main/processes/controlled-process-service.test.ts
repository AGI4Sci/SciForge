import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS,
  ControlledProcessService,
  buildControlledProcessEnvironment
} from './controlled-process-service'

type FakePty = {
  kill: () => void
  resize: (columns: number, rows: number) => void
  write: (data: string | Buffer) => void
  onData: (listener: (data: string) => void) => { dispose: () => void }
  onExit: (
    listener: (event: { exitCode: number; signal: number }) => void
  ) => { dispose: () => void }
  emitData: (data: string) => void
  emitExit: (exitCode: number, signal?: number) => void
}

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-controlled-process-'))
  roots.push(root)
  return root
}

function fakePty(): FakePty {
  let dataListener = (_data: string): void => undefined
  let exitListener = (_event: { exitCode: number; signal: number }): void => undefined
  return {
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    onData(listener) {
      dataListener = listener
      return { dispose: () => undefined }
    },
    onExit(listener) {
      exitListener = listener
      return { dispose: () => undefined }
    },
    emitData(data) {
      dataListener(data)
    },
    emitExit(exitCode, signal = 0) {
      exitListener({ exitCode, signal })
    }
  }
}

describe('ControlledProcessService', () => {
  it('streams bounded output by opaque cursor and scopes all operations to the owner', async () => {
    const root = await workspace()
    const pty = fakePty()
    const service = new ControlledProcessService({ spawnPty: () => pty })
    const created = await service.create({
      ownerId: 'window:1',
      workspaceRoot: root,
      columns: 100,
      rows: 30
    })

    pty.emitData('hello')
    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: created.cursor,
      maxCharacters: 3,
      waitMilliseconds: 0
    })).resolves.toMatchObject({
      cursor: '3',
      chunks: [{ stream: 'stdout', data: 'hel' }],
      truncated: false
    })
    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '3',
      maxCharacters: 10,
      waitMilliseconds: 0
    })).resolves.toMatchObject({
      cursor: '5',
      chunks: [{ stream: 'stdout', data: 'lo' }]
    })
    await expect(service.read({
      ownerId: 'window:2',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: 10,
      waitMilliseconds: 0
    })).rejects.toThrow('unavailable to this caller')

    expect(service.write('window:1', created.resourceId, 'pwd\n')).toBe(4)
    service.resize('window:1', created.resourceId, 120, 40)
    expect(pty.write).toHaveBeenCalledWith('pwd\n')
    expect(pty.resize).toHaveBeenCalledWith(120, 40)
  })

  it('wakes a long read for output and reports process exit', async () => {
    const root = await workspace()
    const pty = fakePty()
    const service = new ControlledProcessService({ spawnPty: () => pty })
    const created = await service.create({ ownerId: 'window:1', workspaceRoot: root })
    const pending = service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 30_000
    })
    pty.emitData('ready')
    await expect(pending).resolves.toMatchObject({
      cursor: '5',
      chunks: [{ stream: 'stdout', data: 'ready' }]
    })

    pty.emitExit(7, 9)
    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '5',
      maxCharacters: 100,
      waitMilliseconds: 30_000
    })).resolves.toMatchObject({
      chunks: [],
      exit: { code: 7, signal: '9' }
    })
  })

  it('honors timeout and abort, rejects future cursors, and wakes readers on dispose', async () => {
    const root = await workspace()
    const pty = fakePty()
    const service = new ControlledProcessService({ spawnPty: () => pty })
    const created = await service.create({ ownerId: 'window:1', workspaceRoot: root })

    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 1
    })).resolves.toMatchObject({ cursor: '0', chunks: [] })
    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '1',
      maxCharacters: 100,
      waitMilliseconds: 0
    })).rejects.toThrow('ahead of available output')

    const abort = new AbortController()
    const abortedRead = service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 30_000,
      signal: abort.signal
    })
    abort.abort()
    await expect(abortedRead).resolves.toMatchObject({ cursor: '0', chunks: [] })

    const disposedRead = service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: 100,
      waitMilliseconds: 30_000
    })
    service.disposeOwner('window:1')
    await expect(disposedRead).rejects.toThrow('unavailable to this caller')
    pty.emitData('late')
    expect(service.has('window:1', created.resourceId)).toBe(false)
  })

  it('bounds replay, validates cwd realpaths, and rejects symlink escapes', async () => {
    const root = await workspace()
    const inside = join(root, 'inside')
    await mkdir(inside)
    const outside = await workspace()
    const escape = join(root, 'escape')
    await symlink(outside, escape)
    const pty = fakePty()
    const service = new ControlledProcessService({ spawnPty: () => pty })
    const created = await service.create({
      ownerId: 'window:1',
      workspaceRoot: root,
      cwd: inside
    })
    pty.emitData('x'.repeat(CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS + 10))
    await expect(service.read({
      ownerId: 'window:1',
      resourceId: created.resourceId,
      cursor: '0',
      maxCharacters: CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS,
      waitMilliseconds: 0
    })).resolves.toMatchObject({
      truncated: true,
      cursor: String(CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS + 10)
    })
    await expect(service.create({
      ownerId: 'window:1',
      workspaceRoot: root,
      cwd: escape
    })).rejects.toThrow('outside the active workspace')
  })

  it('filters inherited environment and enforces owner lifecycle and the session limit', async () => {
    const root = await workspace()
    const ptys = [fakePty(), fakePty()]
    const service = new ControlledProcessService({
      maxSessions: 1,
      environment: {
        HOME: '/safe/home',
        PATH: '/safe/bin',
        LANG: 'zh_CN.UTF-8',
        NODE_OPTIONS: '--require malicious',
        DYLD_INSERT_LIBRARIES: '/tmp/inject.dylib',
        AWS_SECRET_ACCESS_KEY: 'secret'
      },
      spawnPty: () => ptys.shift()!
    })
    const created = await service.create({ ownerId: 'window:1', workspaceRoot: root })
    await expect(service.create({
      ownerId: 'window:2',
      workspaceRoot: root
    })).rejects.toThrow('session limit')
    service.disposeOwner('window:1')
    expect(service.has('window:1', created.resourceId)).toBe(false)
    expect(ptys.length).toBe(1)

    expect(buildControlledProcessEnvironment({
      HOME: '/safe/home',
      PATH: '/safe/bin',
      LANG: 'zh_CN.UTF-8',
      NODE_OPTIONS: '--require malicious',
      DYLD_INSERT_LIBRARIES: '/tmp/inject.dylib',
      AWS_SECRET_ACCESS_KEY: 'secret'
    })).toEqual({
      HOME: '/safe/home',
      PATH: '/safe/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8'
    })
  })
})
