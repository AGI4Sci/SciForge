import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildExternalLocalRuntimeMcpJson,
  buildManagedGuiLocalRuntimeMcpServerConfig,
  resolveLocalRuntimeMcpJsonPath,
  resolveManagedGuiMcpCommand,
  syncExternalLocalRuntimeMcpJson,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

const mockHomeDir = vi.hoisted(() => ({ value: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => mockHomeDir.value
  }
})

const descriptor: ManagedGuiMcpDescriptor = {
  serverName: 'gui_test',
  legacyServerNames: ['gui_test_legacy'],
  nodeEntry: 'out/main/test-mcp-node-entry.js',
  launchFlag: '--gui-test-mcp-server',
  timeoutMs: 12_345,
  enabledTools: () => ['test_tool']
}

const launch: ManagedGuiMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('managed GUI MCP config helpers', () => {
  beforeEach(async () => {
    mockHomeDir.value = await mkdtemp(join(tmpdir(), 'sciforge-managed-mcp-home-'))
  })

  it('resolves the local runtime MCP JSON path under the existing SciForge data dir', () => {
    expect(resolveLocalRuntimeMcpJsonPath()).toBe(join(homedir(), '.sciforge', 'mcp.json'))
  })

  it('uses the SDK Electron-as-Node executable resolver', () => {
    expect(resolveManagedGuiMcpCommand(launch, 'darwin')).toBe(
      '/Applications/SciForge.app/Contents/Frameworks/SciForge Helper.app/Contents/MacOS/SciForge Helper'
    )
    expect(resolveManagedGuiMcpCommand({
      ...launch,
      execPath: String.raw`C:\Program Files\SciForge\SciForge.exe`
    }, 'win32')).toBe(String.raw`C:\Program Files\SciForge\SciForge.exe`)
    expect(resolveManagedGuiMcpCommand({
      ...launch,
      execPath: '/opt/SciForge/sciforge'
    }, 'linux')).toBe('/opt/SciForge/sciforge')
  })

  it('uses current ~/.sciforge/mcp.json by default without reading legacy ~/.kun/mcp.json', async () => {
    const currentDir = join(homedir(), '.sciforge')
    const legacyDir = join(homedir(), '.kun')
    const currentPath = join(currentDir, 'mcp.json')
    const legacyPath = join(legacyDir, 'mcp.json')
    const legacyText = '{ "servers": { "legacy_user": '
    await mkdir(currentDir, { recursive: true })
    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      currentPath,
      JSON.stringify({
        servers: {
          current_user: { command: 'node', args: ['current.js'] },
          gui_test: { command: 'old-managed' }
        }
      }),
      'utf8'
    )
    await writeFile(legacyPath, legacyText, 'utf8')

    await syncExternalLocalRuntimeMcpJson(resolveLocalRuntimeMcpJsonPath(), ['gui_test'])

    const synced = JSON.parse(await readFile(currentPath, 'utf8')) as Record<string, unknown>
    expect(synced).toMatchObject({
      servers: {
        current_user: { command: 'node', args: ['current.js'] }
      }
    })
    expect((synced.servers as Record<string, unknown>).gui_test).toBeUndefined()
    expect(await readFile(legacyPath, 'utf8')).toBe(legacyText)
  })

  it('reads an explicitly supplied custom MCP config path', async () => {
    const defaultDir = join(homedir(), '.sciforge')
    const customDir = join(homedir(), 'custom-config')
    const defaultPath = resolveLocalRuntimeMcpJsonPath()
    const customPath = join(customDir, 'mcp.json')
    await mkdir(defaultDir, { recursive: true })
    await mkdir(customDir, { recursive: true })
    await writeFile(
      defaultPath,
      JSON.stringify({
        servers: {
          default_user: { command: 'node', args: ['default.js'] },
          gui_test: { command: 'default-managed' }
        }
      }),
      'utf8'
    )
    await writeFile(
      customPath,
      JSON.stringify({
        servers: {
          custom_user: { command: 'node', args: ['custom.js'] },
          gui_test: { command: 'custom-managed' }
        }
      }),
      'utf8'
    )

    await syncExternalLocalRuntimeMcpJson(customPath, ['gui_test'])

    const syncedCustom = JSON.parse(await readFile(customPath, 'utf8')) as Record<string, unknown>
    const defaultConfig = JSON.parse(await readFile(defaultPath, 'utf8')) as Record<string, unknown>
    expect(syncedCustom).toMatchObject({
      servers: {
        custom_user: { command: 'node', args: ['custom.js'] }
      }
    })
    expect((syncedCustom.servers as Record<string, unknown>).gui_test).toBeUndefined()
    expect((defaultConfig.servers as Record<string, unknown>).gui_test).toEqual({
      command: 'default-managed'
    })
  })

  it('builds local runtime MCP server configs with the runtime transport contract', () => {
    expect(buildManagedGuiLocalRuntimeMcpServerConfig({
      descriptor,
      launch,
      args: ['/entry.js', '--gui-test-mcp-server'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      existing: {
        env: { OLD: 'drop' },
        metadata: 'keep'
      },
      enabled: false
    })).toMatchObject({
      enabled: false,
      transport: 'stdio',
      command: expect.stringContaining('SciForge'),
      args: ['/entry.js', '--gui-test-mcp-server'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      trustScope: 'user',
      timeoutMs: 12_345,
      metadata: 'keep'
    })
  })

  it('strips GUI-managed servers from external local runtime mcp.json without dropping user servers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-managed-mcp-'))
    const runtimeDir = join(root, '.sciforge')
    const mcpJsonPath = join(runtimeDir, 'mcp.json')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        timeouts: { connect_timeout: 1 },
        servers: {
          keep_user_server: { command: 'node', args: ['server.js'] },
          gui_test: { command: 'old-managed' },
          gui_test_legacy: { command: 'old-legacy-managed' }
        }
      }),
      'utf8'
    )

    expect(buildExternalLocalRuntimeMcpJson({
      servers: {
        keep_user_server: { command: 'node' },
        gui_test: { command: 'old-managed' }
      }
    }, ['gui_test'])).toEqual({
      servers: {
        keep_user_server: { command: 'node' }
      }
    })

    await syncExternalLocalRuntimeMcpJson(mcpJsonPath, ['gui_test', 'gui_test_legacy'])

    const synced = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(synced).toMatchObject({
      timeouts: { connect_timeout: 1 },
      servers: {
        keep_user_server: { command: 'node', args: ['server.js'] }
      }
    })
    expect((synced.servers as Record<string, unknown>).gui_test).toBeUndefined()
    expect((synced.servers as Record<string, unknown>).gui_test_legacy).toBeUndefined()
  })
})
