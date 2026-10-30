import { describe, expect, it } from 'vitest'
import { DOMAIN_RUNTIME_MCP_SELECTOR_FLAG } from '@sciforge/domain-sdk/node/runtime-mcp-launcher'
import { COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION } from '../definition'
import {
  COMPUTER_USE_MCP_LAUNCH_FLAG,
  buildComputerUseMcpArgs,
  resolveComputerUseMcpNodeEntryPath
} from './mcp-config'

describe('Computer Use managed MCP launch', () => {
  it('uses the shared generated domain launcher in source builds', () => {
    const launch = {
      appPath: '/workspace/SciForge',
      execPath: '/workspace/SciForge/node_modules/.bin/electron',
      isPackaged: false
    }

    expect(buildComputerUseMcpArgs(launch)).toEqual([
      '/workspace/SciForge/out/main/domain-runtime-mcp-node-entry.js',
      DOMAIN_RUNTIME_MCP_SELECTOR_FLAG,
      COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION.id,
      COMPUTER_USE_MCP_LAUNCH_FLAG
    ])
  })

  it('resolves the shared generated launcher from an unpacked packaged app', () => {
    expect(resolveComputerUseMcpNodeEntryPath({
      appPath: '/Applications/SciForge.app/Contents/Resources/app.asar',
      execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
      isPackaged: true
    })).toBe(
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/domain-runtime-mcp-node-entry.js'
    )
  })
})
