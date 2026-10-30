import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedResearchSearchMcpJson,
  GUI_RESEARCH_MCP_SERVER_NAME,
  researchSearchMcpEnv,
  syncResearchSearchMcpConfig,
  type ResearchSearchMcpLaunchConfig
} from './research-search-mcp-config'

const launch: ResearchSearchMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('research search MCP config', () => {
  it('removes GUI-managed research servers from external local runtime mcp.json without dropping other servers', () => {
    const synced = buildSyncedResearchSearchMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          },
          [GUI_RESEARCH_MCP_SERVER_NAME]: {
            command: 'old-gui-managed'
          }
        }
      },
      launch
    )

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      }
    })
    expect((synced.servers as Record<string, unknown>)[GUI_RESEARCH_MCP_SERVER_NAME]).toBeUndefined()
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('preserves non-secret research env while forcing Electron node mode', () => {
    expect(researchSearchMcpEnv({
      SCIFORGE_RESEARCH_MAX_RESULTS: '5',
      SCIFORGE_RESEARCH_TAVILY_ENABLED: '1',
      TAVILY_API_KEY: 'from-process'
    }, {
      TAVILY_API_KEY: 'from-config',
      CUSTOM_RESEARCH_ENV: 'keep'
    })).toEqual({
      SCIFORGE_RESEARCH_MAX_RESULTS: '5',
      SCIFORGE_RESEARCH_TAVILY_ENABLED: '1',
      CUSTOM_RESEARCH_ENV: 'keep',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('syncs mcp.json on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-research-mcp-'))
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
        [GUI_RESEARCH_MCP_SERVER_NAME]: {
          command: 'old-gui-managed'
        }
      }
    }),
      'utf8'
    )

    await syncResearchSearchMcpConfig(launch, { mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        }
      }
    })
    expect((json.servers as Record<string, unknown>)[GUI_RESEARCH_MCP_SERVER_NAME]).toBeUndefined()
  })
})
