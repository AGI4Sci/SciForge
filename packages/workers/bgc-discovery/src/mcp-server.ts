import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  BGC_DISCOVERY_MCP_FLAG,
  BGC_DISCOVERY_MCP_SERVER_NAME,
  BGC_DISCOVERY_MCP_SERVER_VERSION,
  bgcPlanInputSchema,
  bgcDownloadResourceInputSchema,
  bgcRegisterResourceInputSchema,
  bgcResourceStatusInputSchema,
  bgcRunPipelineInputSchema,
  bgcStatusInputSchema
} from './contract.js'
import {
  createBgcDiscoveryService,
  type BgcDiscoveryService
} from './service.js'

type McpLaunchOptions = {
  workspaceRoot?: string
}

type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartBgcDiscoveryMcpServerOptions = {
  transport?: Transport
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const CONTROLLED_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const

const NETWORK_WRITE_ANNOTATIONS = {
  ...CONTROLLED_WRITE_ANNOTATIONS,
  openWorldHint: true
} as const

export function createBgcDiscoveryMcpServer(
  service: BgcDiscoveryService = createBgcDiscoveryService()
): McpServer {
  const server = new McpServer(
    { name: BGC_DISCOVERY_MCP_SERVER_NAME, version: BGC_DISCOVERY_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('bgc_status', {
    title: 'BGC Discovery Status',
    description: 'Inspect BGC discovery workspace readiness, configured antiSMASH/BiG-SCAPE executables, and database path hints.',
    inputSchema: bgcStatusInputSchema,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcStatusInputSchema.parse(args)
      const result = await service.status(input)
      return textResult(
        `BGC discovery worker is available. antiSMASH=${result.tools.antismash.status}, BiG-SCAPE=${result.tools.bigscape.status}.`,
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to inspect BGC discovery status: ${message(error)}`)
    }
  })

  server.registerTool('bgc_plan', {
    title: 'Plan BGC Discovery Run',
    description: 'Plan a BGC-side genome mining run from genome, antiSMASH, MIBiG, and BiG-SCAPE inputs without writing files.',
    inputSchema: bgcPlanInputSchema,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcPlanInputSchema.parse(args)
      const result = await service.plan(input)
      return textResult(
        renderPlan(result.plan, result.warnings),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to plan BGC discovery run: ${message(error)}`)
    }
  })

  server.registerTool('bgc_resource_status', {
    title: 'BGC Resource Status',
    description: 'Inspect registered BGC resources, local cache paths, executable availability, and install/download plans.',
    inputSchema: bgcResourceStatusInputSchema,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcResourceStatusInputSchema.parse(args)
      const result = await service.resourceStatus(input)
      return textResult(
        renderResourceStatus(result),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to inspect BGC resources: ${message(error)}`)
    }
  })

  server.registerTool('bgc_register_resource', {
    title: 'Register BGC Resource',
    description: 'Register a local executable, database, result folder, or source URL for BGC discovery without bundling it into SciForge.',
    inputSchema: bgcRegisterResourceInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcRegisterResourceInputSchema.parse(args)
      const result = await service.registerResource(input)
      return textResult(
        `Registered ${result.resource.kind}: ${result.resource.path ?? result.resource.url}. Registry: ${result.registryPath}`,
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to register BGC resource: ${message(error)}`)
    }
  })

  server.registerTool('bgc_download_resource', {
    title: 'Download BGC Resource',
    description: [
      'Download a BGC resource over HTTPS into the configured cache, optionally extract archives, and register the resulting path.',
      'This downloads files only; it does not execute arbitrary installers.'
    ].join(' '),
    inputSchema: bgcDownloadResourceInputSchema,
    annotations: NETWORK_WRITE_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcDownloadResourceInputSchema.parse(args)
      const result = await service.downloadResource(input)
      return textResult(
        [
          `Downloaded ${result.kind}: ${result.downloadedPath}`,
          ...(result.extractedPath ? [`Extracted to: ${result.extractedPath}`] : []),
          `Resource path: ${result.resourcePath}`,
          result.registered ? `Registered in: ${result.registryPath}` : 'Not registered.'
        ].join('\n'),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to download BGC resource: ${message(error)}`)
    }
  })

  server.registerTool('bgc_run_pipeline', {
    title: 'Run BGC Discovery Pipeline',
    description: [
      'Run a controlled BGC-side pipeline. Prefer existing antiSMASH output for first pass.',
      'When runAntismash=true, executes the configured antiSMASH binary on genomePath.',
      'Writes Candidate BGC Cards, ranking, manifest, and summary under outputs/bgc-discovery.'
    ].join(' '),
    inputSchema: bgcRunPipelineInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => {
    try {
      const input = bgcRunPipelineInputSchema.parse(args)
      const result = await service.runPipeline(input)
      return textResult(
        renderRun(result),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to run BGC discovery pipeline: ${message(error)}`)
    }
  })

  return server
}

export async function startBgcDiscoveryMcpServer(
  service: BgcDiscoveryService = createBgcDiscoveryService(),
  options: StartBgcDiscoveryMcpServerOptions = {}
): Promise<void> {
  const server = createBgcDiscoveryMcpServer(service)
  await server.connect(options.transport ?? new StdioServerTransport())
}

export async function runBgcDiscoveryMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false
  await startBgcDiscoveryMcpServer(createBgcDiscoveryService({ workspaceRoot: options.workspaceRoot }))
  return true
}

function parseLaunchOptions(argv: string[]): McpLaunchOptions | null {
  if (!argv.includes(BGC_DISCOVERY_MCP_FLAG)) return null
  const workspaceRoot = argValue(argv, '--workspace-root')?.trim()
  return {
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function textResult(text: string, structuredContent?: Record<string, unknown>): McpTextResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(text: string): McpTextResult {
  return {
    content: [{ type: 'text', text }],
    isError: true
  }
}

function renderPlan(plan: string[], warnings: string[]): string {
  return [
    'BGC discovery run plan:',
    '',
    ...plan.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Warnings:',
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ['- None'])
  ].join('\n')
}

function renderRun(result: { counts: { cards: number }; files: { summaryMarkdown: string; rankingCsv: string }; topCandidates: Array<{ bgcId: string; priorityTier: string; ruleScore: number }> }): string {
  const top = result.topCandidates.slice(0, 5)
  return [
    `BGC discovery pipeline completed with ${result.counts.cards} Candidate BGC Cards.`,
    `Summary: ${result.files.summaryMarkdown}`,
    `Ranking CSV: ${result.files.rankingCsv}`,
    '',
    'Top candidates:',
    ...(top.length > 0
      ? top.map((card, index) => `${index + 1}. ${card.bgcId} (${card.priorityTier}, ${card.ruleScore})`)
      : ['- None'])
  ].join('\n')
}

function renderResourceStatus(result: {
  registryPath: string
  cacheRoot: string
  resources: Record<string, { status: { state: string; path?: string; note?: string } }>
}): string {
  const rows = Object.entries(result.resources).map(([name, resource]) => {
    const suffix = resource.status.path ? ` (${resource.status.path})` : resource.status.note ? ` - ${resource.status.note}` : ''
    return `- ${name}: ${resource.status.state}${suffix}`
  })
  return [
    'BGC resource status:',
    `Registry: ${result.registryPath}`,
    `Cache root: ${result.cacheRoot}`,
    '',
    ...rows
  ].join('\n')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
