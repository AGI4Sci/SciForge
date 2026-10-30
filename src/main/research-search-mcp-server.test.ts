import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GUI_RESEARCH_ENV_FILE_ENV,
  parseResearchSearchEnvFile,
  researchSearchEnvForGuiMcp,
  resolveResearchSearchEnvFile
} from './research-search-mcp-server'

let tempRoot: string | null = null

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

async function tempEnvFile(text: string): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-research-env-'))
  const envFile = join(tempRoot, '.env')
  await writeFile(envFile, text, 'utf8')
  return envFile
}

describe('research search MCP server env loading', () => {
  it('parses dotenv-style MCP env files', () => {
    expect(parseResearchSearchEnvFile([
      '# comment',
      'SCIFORGE_RESEARCH_TAVILY_API_KEY=tvly-test',
      'export SCIFORGE_RESEARCH_CNS_ENABLED=true',
      'SCIFORGE_RESEARCH_CNS_DOMAINS="nature.com,science.org,cell.com"',
      ''
    ].join('\n'))).toEqual({
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'tvly-test',
      SCIFORGE_RESEARCH_CNS_ENABLED: 'true',
      SCIFORGE_RESEARCH_CNS_DOMAINS: 'nature.com,science.org,cell.com'
    })
  })

  it('merges an explicit MCP env file over the process environment', async () => {
    const envFile = await tempEnvFile([
      'SCIFORGE_RESEARCH_TAVILY_API_KEY=from-env-file',
      'SCIFORGE_RESEARCH_CNS_ENABLED=true'
    ].join('\n'))

    expect(resolveResearchSearchEnvFile({ [GUI_RESEARCH_ENV_FILE_ENV]: envFile }, [])).toBe(envFile)
    expect(researchSearchEnvForGuiMcp({
      [GUI_RESEARCH_ENV_FILE_ENV]: envFile,
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'from-process'
    }, [])).toMatchObject({
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'from-env-file',
      SCIFORGE_RESEARCH_CNS_ENABLED: 'true'
    })
  })
})
