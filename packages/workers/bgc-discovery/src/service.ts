import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { parseAntismashOutput } from './antismash-parser.js'
import { normalizeBgcId, importBigscapeAssignments } from './bigscape-importer.js'
import { loadMibigRecords } from './mibig-loader.js'
import {
  downloadResource,
  loadResourceRegistry,
  registeredResourcePath,
  registerResource,
  resolveDataPath,
  resourceStatus as resourceStatusImpl
} from './resource-manager.js'
import type {
  AntismashRegionRecord,
  BgcDownloadResourceRequest,
  BgcDownloadResourceResult,
  BgcPipelineRequest,
  BgcPipelineResult,
  BgcRegisteredResource,
  BgcRegisterResourceRequest,
  BgcResourceStatusRequest,
  BgcResourceStatusResult,
  BgcStatusResult,
  BigscapeAssignment,
  CandidateBgcCard,
  MibigRecord
} from './types.js'
import { ensureDir, relativeToWorkspace, resolveWorkspacePath } from './workspace-paths.js'

export type BgcDiscoveryServiceOptions = {
  workspaceRoot?: string
}

export type BgcPlanRequest = {
  workspaceRoot?: string
  genomePath?: string
  antismashOutput?: string
  mibigPath?: string
  bigscapePath?: string
  goal?: string
}

export type BgcDiscoveryService = {
  status(input?: Partial<BgcPipelineRequest>): Promise<BgcStatusResult>
  plan(input?: BgcPlanRequest): Promise<{ ok: true; plan: string[]; warnings: string[] }>
  resourceStatus(input?: BgcResourceStatusRequest): Promise<BgcResourceStatusResult>
  registerResource(input: BgcRegisterResourceRequest): Promise<{
    ok: true
    registryPath: string
    resource: BgcRegisteredResource
  }>
  downloadResource(input: BgcDownloadResourceRequest): Promise<BgcDownloadResourceResult>
  runPipeline(input: Partial<BgcPipelineRequest>): Promise<BgcPipelineResult>
}

export function createBgcDiscoveryService(options: BgcDiscoveryServiceOptions = {}): BgcDiscoveryService {
  return {
    status: (input = {}) => status({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot }),
    plan: (input = {}) => plan({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot }),
    resourceStatus: (input = {}) => resourceStatusImpl({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot }),
    registerResource: (input) => registerResource({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot }),
    downloadResource: (input) => downloadResource({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot }),
    runPipeline: (input) => runPipeline({ ...input, workspaceRoot: options.workspaceRoot ?? input.workspaceRoot })
  }
}

export async function status(input: Partial<BgcPipelineRequest> = {}): Promise<BgcStatusResult> {
  const workspaceRoot = requiredWorkspace(input.workspaceRoot)
  const registry = await loadResourceRegistry(workspaceRoot)
  const registeredMibigPath = registeredResourcePath(registry, 'mibig_json')
  const antismashInput = input.antismashBin ?? registeredResourcePath(registry, 'antismash')
  const bigscapeInput = input.bigscapeBin ?? registeredResourcePath(registry, 'bigscape')
  const outputRoot = input.outputDir
    ? resolveWorkspacePath(workspaceRoot, input.outputDir)
    : join(workspaceRoot, 'outputs', 'bgc-discovery')
  const antismash = await toolStatus(antismashInput, ['antismash'])
  const bigscape = await toolStatus(bigscapeInput, ['bigscape'])
  return {
    ok: true,
    workspaceRoot,
    tools: {
      antismash: {
        status: antismash.found ? 'available' : antismashInput ? 'missing' : 'not_configured',
        ...(antismash.path ? { path: antismash.path } : {}),
        note: antismash.found ? 'antiSMASH can be used when runAntismash=true.' : 'Use existing antiSMASH output or configure antismashBin.'
      },
      bigscape: {
        status: bigscape.found ? 'available' : bigscapeInput ? 'missing' : 'not_configured',
        ...(bigscape.path ? { path: bigscape.path } : {}),
        note: bigscape.found ? 'BiG-SCAPE execution can be added in a later run step.' : 'Existing BiG-SCAPE output can still be imported.'
      }
    },
    databaseHints: {
      ...(input.mibigPath ? { mibigPath: resolveDataPath(workspaceRoot, input.mibigPath) } : {}),
      ...(!input.mibigPath && registeredMibigPath ? { mibigPath: registeredMibigPath } : {}),
      ...(input.bigscapePath ? { pfamPath: resolveDataPath(workspaceRoot, input.bigscapePath) } : {})
    },
    outputRoot
  }
}

export async function plan(input: BgcPlanRequest = {}): Promise<{ ok: true; plan: string[]; warnings: string[] }> {
  const warnings: string[] = []
  const hasGenome = Boolean(input.genomePath?.trim())
  const hasAntismash = Boolean(input.antismashOutput?.trim())
  if (!hasGenome && !hasAntismash) warnings.push('Provide either genomePath or antismashOutput.')
  if (hasGenome && !hasAntismash) warnings.push('Genome-first mode needs antiSMASH installed and runAntismash=true; existing antiSMASH output is safer for the first pass.')
  if (!input.mibigPath) warnings.push('MIBiG enrichment will be skipped unless mibigPath is provided.')
  if (!input.bigscapePath) warnings.push('BiG-SCAPE family enrichment will be skipped unless bigscapePath is provided.')
  return {
    ok: true,
    warnings,
    plan: [
      'Inspect workspace paths and choose existing antiSMASH output when available.',
      'Parse antiSMASH region GBK/JSON records into conservative BGC region records.',
      'Enrich candidate regions with local MIBiG records when nearest BGC ids are present.',
      'Import BiG-SCAPE assignment/network files when available and attach GCF evidence.',
      'Build Candidate BGC Cards with evidence, novelty hints, feasibility, and activation strategies.',
      'Write cards, ranking JSON/CSV, manifest, and a Markdown report under outputs/bgc-discovery.',
      'Let SciForge Agent use the structured cards for LLM interpretation, literature follow-up, and experiment planning.'
    ]
  }
}

export async function runPipeline(input: Partial<BgcPipelineRequest>): Promise<BgcPipelineResult> {
  const workspaceRoot = requiredWorkspace(input.workspaceRoot)
  const warnings: string[] = []
  const registry = await loadResourceRegistry(workspaceRoot)
  const resolvedMibigInput = input.mibigPath ?? registeredResourcePath(registry, 'mibig_json')
  const resolvedAntismashBin = input.antismashBin ?? registeredResourcePath(registry, 'antismash')
  if (!input.mibigPath && resolvedMibigInput) warnings.push(`MIBiG enrichment uses registered resource: ${resolvedMibigInput}`)
  const runId = safeRunId(input.accession ?? basename(input.antismashOutput ?? input.genomePath ?? 'bgc-run'))
  const outputDir = input.outputDir
    ? resolveWorkspacePath(workspaceRoot, input.outputDir)
    : join(workspaceRoot, 'outputs', 'bgc-discovery', runId)
  await ensureDir(outputDir)
  const antismashOutput = await resolveAntismashInput(workspaceRoot, outputDir, {
    ...input,
    antismashBin: resolvedAntismashBin
  }, warnings)
  const regions = await parseAntismashOutput(antismashOutput, input.maxRegions ?? 10_000)
  const neededMibigIds = unique(regions.flatMap((region) => [
    ...(region.nearestMibigHit ? [region.nearestMibigHit] : []),
    ...region.knownClusterHits
  ]))
  const mibig = resolvedMibigInput && neededMibigIds.length > 0
    ? await loadMibigRecords(resolveDataPath(workspaceRoot, resolvedMibigInput), neededMibigIds)
    : new Map<string, MibigRecord>()
  if (!resolvedMibigInput) warnings.push('MIBiG enrichment skipped: mibigPath was not provided and no MIBiG resource is registered.')
  else if (neededMibigIds.length === 0) warnings.push('MIBiG resource is registered, but no antiSMASH MIBiG hit ids were detected in this input.')
  const bigscape = input.bigscapePath
    ? await importBigscapeAssignments(resolveDataPath(workspaceRoot, input.bigscapePath))
    : new Map<string, BigscapeAssignment>()
  if (!input.bigscapePath) warnings.push('BiG-SCAPE enrichment skipped: bigscapePath was not provided.')
  const cards = regions.map((region) => buildCandidateCard(region, mibig, bigscape, input.accession))
  const sorted = [...cards].sort((a, b) => b.ruleScore - a.ruleScore || a.bgcId.localeCompare(b.bgcId))
  const cardsDir = join(outputDir, 'cards')
  await ensureDir(cardsDir)
  for (const card of sorted) {
    await writeFile(join(cardsDir, `${safeFileName(card.bgcId)}.json`), `${JSON.stringify(card, null, 2)}\n`, 'utf8')
  }
  const rankingJson = join(outputDir, 'ranking.json')
  const rankingCsv = join(outputDir, 'ranking.csv')
  const summaryMarkdown = join(outputDir, 'summary.md')
  const manifest = join(outputDir, 'manifest.json')
  await writeFile(rankingJson, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  await writeFile(rankingCsv, rankingCsvText(sorted), 'utf8')
  await writeFile(summaryMarkdown, summaryMarkdownText(sorted, warnings), 'utf8')
  const result: BgcPipelineResult = {
    ok: true,
    runId,
    outputDir: relativeToWorkspace(workspaceRoot, outputDir),
    counts: {
      antismashRegions: regions.length,
      mibigRecordsUsed: mibig.size,
      bigscapeAssignments: bigscape.size,
      cards: cards.length
    },
    files: {
      manifest: relativeToWorkspace(workspaceRoot, manifest),
      cardsDir: relativeToWorkspace(workspaceRoot, cardsDir),
      rankingJson: relativeToWorkspace(workspaceRoot, rankingJson),
      rankingCsv: relativeToWorkspace(workspaceRoot, rankingCsv),
      summaryMarkdown: relativeToWorkspace(workspaceRoot, summaryMarkdown)
    },
    topCandidates: sorted.slice(0, 10),
    warnings
  }
  await writeFile(manifest, `${JSON.stringify({
    ...result,
    createdAt: new Date().toISOString(),
    inputs: {
      genomePath: input.genomePath,
      antismashOutput: input.antismashOutput,
      mibigPath: resolvedMibigInput,
      bigscapePath: input.bigscapePath
    }
  }, null, 2)}\n`, 'utf8')
  return result
}

async function resolveAntismashInput(
  workspaceRoot: string,
  outputDir: string,
  input: Partial<BgcPipelineRequest>,
  warnings: string[]
): Promise<string> {
  if (input.antismashOutput) return resolveDataPath(workspaceRoot, input.antismashOutput)
  if (!input.genomePath) throw new Error('Either antismashOutput or genomePath is required.')
  if (!input.runAntismash) {
    throw new Error('genomePath was provided but runAntismash is false. Provide antismashOutput or set runAntismash=true.')
  }
  const genomePath = resolveDataPath(workspaceRoot, input.genomePath)
  const antismashBin = input.antismashBin?.trim() || 'antismash'
  const antismashOut = join(outputDir, 'antismash')
  await ensureDir(antismashOut)
  const args = [
    genomePath,
    '--output-dir',
    antismashOut,
    '--cpus',
    String(Math.max(1, Math.min(input.cpus ?? 2, 8)))
  ]
  if (input.taxon && input.taxon !== 'auto') args.push('--taxon', input.taxon)
  warnings.push('antiSMASH execution was requested; large genomes may take significant time and disk space.')
  await runCommand(antismashBin, args, outputDir)
  return antismashOut
}

function buildCandidateCard(
  region: AntismashRegionRecord,
  mibig: Map<string, MibigRecord>,
  bigscape: Map<string, BigscapeAssignment>,
  genomeAccession?: string
): CandidateBgcCard {
  const mibigRecord = region.nearestMibigHit ? mibig.get(region.nearestMibigHit.toUpperCase()) : undefined
  const bigscapeRecord = bigscape.get(normalizeBgcId(region.bgcId)) ?? bigscape.get(normalizeBgcId(region.sourceFile))
  const preliminary: Omit<CandidateBgcCard, 'ruleScore' | 'priorityTier' | 'activationStrategy'> = {
    cardType: 'candidate_bgc_card',
    cardVersion: 'sciforge-bgc-v1',
    bgcId: region.bgcId,
    regionId: region.regionId,
    ...(region.contigId ? { contigId: region.contigId } : {}),
    ...(region.organism ? { organism: region.organism } : {}),
    ...(genomeAccession ? { genomeAccession } : {}),
    ...(region.start ? { start: region.start } : {}),
    ...(region.end ? { end: region.end } : {}),
    bgcType: region.bgcType,
    ...(region.product ? { product: region.product } : {}),
    ...(region.predictedProductClass ? { predictedProductClass: region.predictedProductClass } : {}),
    coreGenes: region.coreGenes,
    tailoringEnzymes: region.tailoringEnzymes,
    regulators: region.regulators,
    knownClusterHits: region.knownClusterHits,
    ...(region.nearestMibigHit ? { nearestMibigHit: region.nearestMibigHit } : {}),
    ...(mibigRecord?.product ? { knownProduct: mibigRecord.product } : {}),
    ...(mibigRecord?.productClass ? { knownProductClass: mibigRecord.productClass } : {}),
    ...(mibigRecord?.bioactivity ? { knownActivity: mibigRecord.bioactivity } : {}),
    ...(bigscapeRecord?.geneClusterFamily ? { geneClusterFamily: bigscapeRecord.geneClusterFamily } : {}),
    ...(bigscapeRecord?.familySize ? { familySize: bigscapeRecord.familySize } : {}),
    mibigMembersInFamily: bigscapeRecord?.mibigMembersInFamily ?? [],
    networkNeighbors: bigscapeRecord?.networkNeighbors ?? [],
    novelty: noveltyFor(region, mibigRecord, bigscapeRecord),
    experimentalFeasibility: feasibilityFor(region),
    evidence: evidenceFor(region, mibigRecord, bigscapeRecord),
    sourceFile: region.sourceFile,
    toolSource: region.toolSource
  }
  const ruleScore = scoreCard(preliminary)
  return {
    ...preliminary,
    ruleScore,
    priorityTier: tierFor(ruleScore),
    activationStrategy: activationStrategyFor(preliminary)
  }
}

function noveltyFor(
  region: AntismashRegionRecord,
  mibigRecord: MibigRecord | undefined,
  bigscape: BigscapeAssignment | undefined
): CandidateBgcCard['novelty'] {
  if (mibigRecord || region.knownClusterHits.length > 0) return 'known_like'
  if (bigscape && bigscape.mibigMembersInFamily.length === 0) return 'potential_high'
  return 'uncertain'
}

function feasibilityFor(region: AntismashRegionRecord): CandidateBgcCard['experimentalFeasibility'] {
  let score = 0
  if (region.coreGenes.length > 0) score += 1
  if (region.tailoringEnzymes.length > 0) score += 1
  if (region.regulators.length > 0) score += 1
  if (region.start && region.end && region.end > region.start) score += 1
  if (score >= 3) return 'high'
  if (score >= 2) return 'medium'
  if (score >= 1) return 'low'
  return 'unknown'
}

function scoreCard(card: Omit<CandidateBgcCard, 'ruleScore' | 'priorityTier' | 'activationStrategy'>): number {
  let score = 0
  if (['PKS', 'NRPS', 'siderophore'].includes(card.bgcType)) score += 0.2
  else if (['terpene', 'RiPP'].includes(card.bgcType)) score += 0.12
  else score += 0.03
  if (card.predictedProductClass) score += 0.08
  if (card.novelty === 'potential_high') score += 0.25
  if (card.nearestMibigHit) score += 0.08
  if (card.coreGenes.length > 0) score += 0.15
  if (card.tailoringEnzymes.length > 0) score += 0.1
  if (card.regulators.length > 0) score += 0.15
  if (card.geneClusterFamily || card.networkNeighbors.length > 0) score += 0.08
  if (card.knownClusterHits.length > 0) score += 0.04
  return Math.min(1, Number(score.toFixed(3)))
}

function tierFor(score: number): CandidateBgcCard['priorityTier'] {
  if (score >= 0.75) return 'high'
  if (score >= 0.55) return 'medium'
  if (score >= 0.35) return 'low'
  return 'retain_for_audit'
}

function activationStrategyFor(card: Omit<CandidateBgcCard, 'ruleScore' | 'priorityTier' | 'activationStrategy'>): string[] {
  const strategies = ['Validate region boundaries and gene annotations before wet-lab prioritization.']
  if (card.regulators.length > 0) strategies.push('Inspect cluster-local regulators for overexpression or CRISPRa activation.')
  if (card.tailoringEnzymes.length > 0) strategies.push('Use tailoring enzymes as LC-MS/MS molecular-networking anchors.')
  if (card.novelty === 'potential_high') strategies.push('Prioritize comparative cultivation and OSMAC conditions because no close MIBiG hit was detected.')
  if (card.nearestMibigHit) strategies.push(`Compare against MIBiG hit ${card.nearestMibigHit} to avoid rediscovery.`)
  return strategies
}

function evidenceFor(
  region: AntismashRegionRecord,
  mibigRecord: MibigRecord | undefined,
  bigscape: BigscapeAssignment | undefined
): CandidateBgcCard['evidence'] {
  const evidence: CandidateBgcCard['evidence'] = [{
    source: 'antiSMASH',
    label: region.bgcType,
    detail: `Parsed ${region.bgcId} from ${region.sourceFile}.`
  }]
  if (mibigRecord) {
    evidence.push({
      source: 'MIBiG',
      label: mibigRecord.id,
      detail: [mibigRecord.product, mibigRecord.productClass, mibigRecord.bioactivity].filter(Boolean).join(' | ') || 'Known cluster hit found.'
    })
  }
  if (bigscape) {
    evidence.push({
      source: 'BiG-SCAPE',
      label: bigscape.geneClusterFamily ?? 'family_context',
      detail: `Family size ${bigscape.familySize ?? 'unknown'}, MIBiG members ${bigscape.mibigMembersInFamily.length}.`
    })
  }
  return evidence
}

function rankingCsvText(cards: CandidateBgcCard[]): string {
  const header = ['rank', 'bgc_id', 'tier', 'score', 'type', 'novelty', 'nearest_mibig', 'known_product', 'activation_strategy']
  const lines = cards.map((card, index) => [
    index + 1,
    card.bgcId,
    card.priorityTier,
    card.ruleScore,
    card.bgcType,
    card.novelty,
    card.nearestMibigHit ?? '',
    card.knownProduct ?? '',
    card.activationStrategy.join(' | ')
  ].map(csvCell).join(','))
  return `${header.join(',')}\n${lines.join('\n')}\n`
}

function summaryMarkdownText(cards: CandidateBgcCard[], warnings: string[]): string {
  const topRows = cards.slice(0, 12).map((card, index) =>
    `| ${index + 1} | ${card.bgcId} | ${card.bgcType} | ${card.priorityTier} | ${card.ruleScore.toFixed(3)} | ${card.novelty} | ${card.nearestMibigHit ?? ''} |`
  )
  return [
    '# BGC Discovery Summary',
    '',
    `Generated ${cards.length} Candidate BGC Cards.`,
    '',
    '## Top Candidates',
    '',
    '| Rank | BGC | Type | Tier | Score | Novelty | MIBiG |',
    '| --- | --- | --- | --- | ---: | --- | --- |',
    ...topRows,
    '',
    '## Warnings',
    '',
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ['- None']),
    ''
  ].join('\n')
}

async function toolStatus(configuredPath: string | undefined, commands: string[]): Promise<{ found: boolean; path?: string }> {
  if (configuredPath) {
    try {
      await access(configuredPath, constants.X_OK)
      return { found: true, path: configuredPath }
    } catch {
      return { found: false, path: configuredPath }
    }
  }
  for (const command of commands) {
    const found = await commandExists(command)
    if (found) return { found: true, path: command }
  }
  return { found: false }
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolveExists) => {
    const child = spawn(process.platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore' })
    child.on('exit', (code) => resolveExists(code === 0))
    child.on('error', () => resolveExists(false))
  })
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
    })
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code}: ${stderr}`))
    })
    child.on('error', reject)
  })
}

function requiredWorkspace(value: string | undefined): string {
  const workspaceRoot = value?.trim()
  if (!workspaceRoot) throw new Error('workspaceRoot is required.')
  return resolve(workspaceRoot)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function safeRunId(value: string): string {
  const base = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'bgc-run'
  return `${base}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180) || 'candidate'
}

function csvCell(value: unknown): string {
  const text = String(value).replace(/"/g, '""')
  return /[",\n]/.test(text) ? `"${text}"` : text
}
