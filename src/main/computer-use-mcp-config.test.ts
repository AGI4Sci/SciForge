import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedComputerUseMcpJson,
  COMPUTER_USE_MCP_TOOL_NAME,
  computerUseMcpEnv,
  configuredComputerUseCapability,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES,
  syncComputerUseMcpConfig
} from './computer-use-mcp-config'

describe('computer use MCP config', () => {
  it('passes invocation-proof configuration only through the managed process environment', () => {
    expect(computerUseMcpEnv({
      SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
      SCIFORGE_CUA_INVOCATION_SECRET: 'proof-secret',
      SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS: '30000',
      CUA_INVOCATION_PROOF_MODE: 'required',
      UNRELATED_SECRET: 'must-not-cross'
    })).toMatchObject({
      SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
      SCIFORGE_CUA_INVOCATION_SECRET: 'proof-secret',
      SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS: '30000',
      CUA_INVOCATION_PROOF_MODE: 'required'
    })
    expect(computerUseMcpEnv({ UNRELATED_SECRET: 'must-not-cross' })).not.toHaveProperty('UNRELATED_SECRET')
  })

  it('removes retired GUI-managed computer-use servers from external local runtime mcp.json', () => {
    const synced = buildSyncedComputerUseMcpJson({
      timeouts: { connect_timeout: 1 },
      servers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
          env: {},
          url: null
        },
        [GUI_COMPUTER_USE_MCP_SERVER_NAME]: {
          command: 'old-gui-managed'
        },
        [RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[0]]: {
          command: 'retired-gui-managed'
        },
        [RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[1]]: {
          command: 'retired-primitive-computer-use'
        }
      }
    })

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      }
    })
    expect((synced.servers as Record<string, unknown>)[GUI_COMPUTER_USE_MCP_SERVER_NAME]).toBeUndefined()
    expect((synced.servers as Record<string, unknown>)[RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[0]]).toBeUndefined()
    expect((synced.servers as Record<string, unknown>)[RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[1]]).toBeUndefined()
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('exposes GUI-Owl service capability metadata', () => {
    expect(configuredComputerUseCapability()).toEqual({
      available: true,
      server: 'mcp',
      toolName: COMPUTER_USE_MCP_TOOL_NAME,
      backend: 'legacy-pyautogui',
      inputIsolation: 'host-approved',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true
    })
  })

  it('syncs retired computer-use cleanup to mcp.json on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-mcp-'))
    const runtimeDir = join(root, '.sciforge')
    const mcpJsonPath = join(runtimeDir, 'mcp.json')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        servers: {
          existing: {
            command: '/bin/echo',
            args: ['ok'],
            env: {},
            url: null
          },
          [GUI_COMPUTER_USE_MCP_SERVER_NAME]: {
            command: 'old-gui-managed'
          },
          [RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[0]]: {
            command: 'retired-gui-managed'
          },
          [RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[1]]: {
            command: 'retired-primitive-computer-use'
          }
        }
      }),
      'utf8'
    )

    await syncComputerUseMcpConfig({ mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        }
      }
    })
    expect((json.servers as Record<string, unknown>)[GUI_COMPUTER_USE_MCP_SERVER_NAME]).toBeUndefined()
    expect((json.servers as Record<string, unknown>)[RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[0]]).toBeUndefined()
    expect((json.servers as Record<string, unknown>)[RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES[1]]).toBeUndefined()
  })
})
