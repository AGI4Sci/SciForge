import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  DEFAULT_PLAN_CONTEXT_BYTES,
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_SEARCH_TOP_K,
  MAX_PLAN_CONTEXT_BYTES,
  MAX_READ_MAX_BYTES,
  MAX_SEARCH_TOP_K,
  SCIENTIFIC_SKILLS_ENV_ROOT,
  buildScientificSkillsStatusSummary,
  buildScientificSkillsIndex,
  planScientificSkills,
  readScientificSkill,
  searchScientificSkills
} from './scientific-skills-index'
import { SCIENTIFIC_SKILLS_MCP_FLAG } from './contract'

type McpLaunchOptions = {
  workspaceRoot?: string
  skillsRoot?: string
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function parseLaunchOptions(argv: string[]): McpLaunchOptions | null {
  if (!argv.includes(SCIENTIFIC_SKILLS_MCP_FLAG)) return null
  const workspaceRoot = parseArgValue(argv, '--workspace-root')?.trim()
  const skillsRoot = parseArgValue(argv, '--skills-root')?.trim()
  return {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(skillsRoot ? { skillsRoot } : {})
  }
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}

function jsonSummary(title: string, value: unknown): string {
  return `${title}\n\n${JSON.stringify(value, null, 2)}`
}

export async function runScientificSkillsMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false

  const server = new McpServer(
    { name: 'sciforge-scientific-skills', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  const loadIndex = () => buildScientificSkillsIndex({
    workspaceRoot: options.workspaceRoot,
    env: {
      ...process.env,
      ...(options.skillsRoot ? { [SCIENTIFIC_SKILLS_ENV_ROOT]: options.skillsRoot } : {})
    }
  })

  server.registerTool('scientific_skills_status', {
    title: 'K-Dense Scientific Skills Status',
    description: 'Report local K-Dense Scientific Agent Skills discovery status. Read-only; does not install or update anything.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try {
      const index = await loadIndex()
      const status = buildScientificSkillsStatusSummary(index)
      return textResult(
        index.installed
          ? `Indexed ${index.skillCount} scientific skill(s).`
          : index.installHint,
        { status }
      )
    } catch (error) {
      return errorResult(`Failed to index scientific skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_skills_search', {
    title: 'Search K-Dense Scientific Skills',
    description: 'Search locally installed K-Dense Scientific Agent Skills with lightweight token/BM25 matching.',
    inputSchema: {
      query: z.string().trim().min(1).describe('Chinese or English task/query text.'),
      topK: z.number().int().min(1).max(MAX_SEARCH_TOP_K).optional().describe(`Default ${DEFAULT_SEARCH_TOP_K}, max ${MAX_SEARCH_TOP_K}.`),
      domain: z.string().trim().max(200).optional().describe('Optional domain hint, such as plotting, microscopy, molecule, or topology.')
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ query, topK, domain }) => {
    try {
      const index = await loadIndex()
      if (!index.installed) {
        return textResult(index.installHint, {
          installed: false,
          results: [],
          installHint: index.installHint
        })
      }
      const results = searchScientificSkills(index, query, topK ?? DEFAULT_SEARCH_TOP_K, domain)
      return textResult(
        jsonSummary(`Found ${results.length} matching scientific skill(s).`, results),
        { installed: true, results }
      )
    } catch (error) {
      return errorResult(`Failed to search scientific skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_skills_read', {
    title: 'Read K-Dense Scientific Skill',
    description: 'Read frontmatter, overview, resources, scripts, references, or byte-limited full SKILL.md content for one local skill.',
    inputSchema: {
      skillId: z.string().trim().min(1).describe('Skill folder id or frontmatter name.'),
      include: z.array(z.enum(['frontmatter', 'overview', 'resources', 'scripts', 'references', 'full'])).optional()
        .describe('Defaults to frontmatter, overview, and resources. Include full to request byte-limited SKILL.md text.'),
      maxBytes: z.number().int().min(1_000).max(MAX_READ_MAX_BYTES).optional()
        .describe(`Maximum bytes returned for text fields. Default ${DEFAULT_READ_MAX_BYTES}, max ${MAX_READ_MAX_BYTES}.`)
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ skillId, include, maxBytes }) => {
    try {
      const index = await loadIndex()
      if (!index.installed) return errorResult(index.installHint)
      const skill = readScientificSkill(index, skillId, include, maxBytes ?? DEFAULT_READ_MAX_BYTES)
      if (!skill) return errorResult(`Unknown scientific skill: ${skillId}`)
      return textResult(
        jsonSummary(`Read scientific skill "${skill.skillId}".`, skill),
        { skill }
      )
    } catch (error) {
      return errorResult(`Failed to read scientific skill: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_skills_plan', {
    title: 'Plan With K-Dense Scientific Skills',
    description: 'Recommend relevant scientific skills and safe SciForge next steps. Does not emit executable shell or Python commands.',
    inputSchema: {
      task: z.string().trim().min(1).describe('The user task to plan for.'),
      selectedSkillIds: z.array(z.string().trim().min(1)).optional()
        .describe('Optional skill ids to force into the plan.'),
      maxContextBytes: z.number().int().min(1_000).max(MAX_PLAN_CONTEXT_BYTES).optional()
        .describe(`Planning context budget. Default ${DEFAULT_PLAN_CONTEXT_BYTES}, max ${MAX_PLAN_CONTEXT_BYTES}.`)
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ task, selectedSkillIds, maxContextBytes }) => {
    try {
      const index = await loadIndex()
      const plan = planScientificSkills(
        index,
        task,
        selectedSkillIds,
        maxContextBytes ?? DEFAULT_PLAN_CONTEXT_BYTES
      )
      return textResult(
        jsonSummary('Scientific skills plan.', plan),
        { plan }
      )
    } catch (error) {
      return errorResult(`Failed to plan with scientific skills: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
