import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'

export const SCIENTIFIC_SKILLS_ENV_ROOT = 'SCIFORGE_KDENSE_SKILLS_ROOT'
export const DEFAULT_SEARCH_TOP_K = 8
export const MAX_SEARCH_TOP_K = 20
export const DEFAULT_READ_MAX_BYTES = 16_000
export const MAX_READ_MAX_BYTES = 80_000
export const DEFAULT_PLAN_CONTEXT_BYTES = 24_000
export const MAX_PLAN_CONTEXT_BYTES = 60_000
export const SCIENTIFIC_PLOTTING_SKILL_IDS = [
  'scientific-visualization',
  'matplotlib',
  'seaborn',
  'plotly',
  'scientific-schematics',
  'markdown-mermaid-writing'
] as const

type JsonRecord = Record<string, unknown>

export type ScientificSkillFrontmatter = {
  name?: string
  description?: string
  license?: string
  compatibility?: string | string[]
  metadata?: JsonRecord
  allowedTools: string[]
  raw: JsonRecord
}

export type ScientificSkillRecord = {
  id: string
  name: string
  description: string
  root: string
  skillDir: string
  entryPath: string
  fingerprint: string
  title?: string
  overview: string
  frontmatter: ScientificSkillFrontmatter
  resources: string[]
  scripts: string[]
  references: string[]
  validationErrors: string[]
  content: string
  contentBytes: number
  indexedAt: string
}

export type ScientificSkillsRootStatus = {
  path: string
  source: 'env' | 'workspace-agents' | 'workspace-skills' | 'global-agents' | 'global-kun'
  exists: boolean
  skillCount: number
  error?: string
}

export type ScientificSkillsIndex = {
  installed: boolean
  skillCount: number
  roots: ScientificSkillsRootStatus[]
  skills: ScientificSkillRecord[]
  validationErrors: Array<{ path: string; message: string }>
  fingerprint: string
  indexedAt: string
  installHint: string
}

export type ScientificSkillSearchResult = {
  skillId: string
  name: string
  description: string
  root: string
  entryPath: string
  score: number
  matchedTerms: string[]
  highlights: string[]
}

export type ScientificSkillReadResult = {
  skillId: string
  name: string
  description: string
  root: string
  entryPath: string
  fingerprint: string
  frontmatter: ScientificSkillFrontmatter
  overview: string
  resources: string[]
  scripts?: string[]
  references?: string[]
  fullContent?: string
  truncated: boolean
  validationErrors: string[]
}

export type ScientificSkillPlanResult = {
  installed: boolean
  task: string
  recommendedSkills: Array<{
    skillId: string
    name: string
    reason: string
    dependencyRisk: string
    suggestedNextStep: string
  }>
  guardrails: string[]
  nextSciForgeActions: string[]
  installHint?: string
  installRecommendation?: {
    recommended: boolean
    reason: string
    targetScope: 'workspace'
    backend: 'git'
    source: 'K-Dense-AI/scientific-agent-skills'
    missingSkills: string[]
    requiresUserApproval: true
  }
  plottingWorkflow?: {
    detected: boolean
    availableSkills: string[]
    missingSkills: string[]
    recommendedLibraries: string[]
    dataFigureHints: string[]
    nextControlledTool: string
    styleReference?: {
      detected: boolean
      extractionTool: 'figure-style:extract'
      outputArtifact: 'FigureStyleSpec v1'
      acceptedSourceTypes: Array<'image' | 'pdf'>
      nextControlledTool: string
      guardrails: string[]
    }
  }
}

export type ScientificPlottingPackItem = {
  skillId: string
  label: string
  installed: boolean
  name?: string
  description?: string
  entryPath?: string
  dependencyRisk?: string
  validationErrors: string[]
}

export type ScientificSkillsStatusSummary = {
  installed: boolean
  skillCount: number
  fingerprint: string
  indexedAt: string
  roots: ScientificSkillsRootStatus[]
  validationErrors: Array<{ path: string; message: string }>
  plottingPack: {
    total: number
    installed: number
    missing: number
    items: ScientificPlottingPackItem[]
  }
  installHint?: string
  onDemandPolicy: {
    mode: 'manual-approval'
    summary: string
  }
}

export type ScientificSkillsDiscoveryOptions = {
  workspaceRoot?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

type CandidateRoot = {
  path: string
  source: ScientificSkillsRootStatus['source']
}

type ParsedFrontmatter = {
  frontmatter: ScientificSkillFrontmatter
  errors: string[]
}

export function scientificSkillsInstallHint(): string {
  return [
    'K-Dense Scientific Agent Skills is not installed in the configured local paths.',
    'Install it outside SciForge, for example: npx skills add K-Dense-AI/scientific-agent-skills',
    `Or set ${SCIENTIFIC_SKILLS_ENV_ROOT} to the local skills directory.`
  ].join(' ')
}

export function resolveScientificSkillsCandidateRoots(
  options: ScientificSkillsDiscoveryOptions = {}
): CandidateRoot[] {
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()
  const candidates: CandidateRoot[] = []
  const add = (path: string, source: CandidateRoot['source']): void => {
    const expanded = expandHomePath(path, home)
    for (const candidatePath of expandPossibleSkillCollectionPaths(expanded)) {
      candidates.push({ path: candidatePath, source })
    }
  }

  for (const rawPath of splitEnvPaths(env[SCIENTIFIC_SKILLS_ENV_ROOT])) {
    add(rawPath, 'env')
  }
  if (options.workspaceRoot?.trim()) {
    const workspaceRoot = options.workspaceRoot.trim()
    add(join(workspaceRoot, '.agents', 'skills', 'scientific-agent-skills', 'skills'), 'workspace-agents')
    add(join(workspaceRoot, 'skills', 'scientific-agent-skills', 'skills'), 'workspace-skills')
  }
  add(join(home, '.agents', 'skills', 'scientific-agent-skills', 'skills'), 'global-agents')
  add(join(home, '.kun', 'skills', 'scientific-agent-skills', 'skills'), 'global-kun')

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = resolve(candidate.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function buildScientificSkillsIndex(
  options: ScientificSkillsDiscoveryOptions = {}
): Promise<ScientificSkillsIndex> {
  const indexedAt = new Date().toISOString()
  const roots: ScientificSkillsRootStatus[] = []
  const skills: ScientificSkillRecord[] = []
  const validationErrors: Array<{ path: string; message: string }> = []
  const seenSkillIds = new Set<string>()

  for (const candidate of resolveScientificSkillsCandidateRoots(options)) {
    const rootStatus: ScientificSkillsRootStatus = {
      path: candidate.path,
      source: candidate.source,
      exists: existsSync(candidate.path),
      skillCount: 0
    }
    if (!rootStatus.exists) {
      roots.push(rootStatus)
      continue
    }

    try {
      const skillDirs = await discoverSkillDirectories(candidate.path)
      for (const skillDir of skillDirs) {
        try {
          const skill = await readScientificSkillDirectory(candidate.path, skillDir, indexedAt)
          if (seenSkillIds.has(skill.id)) {
            validationErrors.push({
              path: skill.entryPath,
              message: `Duplicate skill id "${skill.id}" ignored.`
            })
            continue
          }
          seenSkillIds.add(skill.id)
          skills.push(skill)
          rootStatus.skillCount += 1
          for (const message of skill.validationErrors) {
            validationErrors.push({ path: skill.entryPath, message })
          }
        } catch (error) {
          validationErrors.push({
            path: join(skillDir, 'SKILL.md'),
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      rootStatus.error = error instanceof Error ? error.message : String(error)
      validationErrors.push({ path: candidate.path, message: rootStatus.error })
    }
    roots.push(rootStatus)
  }

  skills.sort((left, right) => left.id.localeCompare(right.id))
  const fingerprint = createHash('sha256')
    .update(skills.map((skill) => `${skill.id}:${skill.fingerprint}`).join('\n'))
    .digest('hex')
    .slice(0, 16)

  return {
    installed: skills.length > 0,
    skillCount: skills.length,
    roots,
    skills,
    validationErrors,
    fingerprint,
    indexedAt,
    installHint: scientificSkillsInstallHint()
  }
}

export function searchScientificSkills(
  index: ScientificSkillsIndex,
  query: string,
  inputTopK = DEFAULT_SEARCH_TOP_K,
  domain?: string
): ScientificSkillSearchResult[] {
  const topK = clampInteger(inputTopK, 1, MAX_SEARCH_TOP_K)
  const normalizedQuery = [query, domain].filter(Boolean).join(' ')
  const queryTokens = [...new Set(tokenize(normalizedQuery))]
  const docs = index.skills.map((skill) => {
    const tokens = tokenize(skillSearchDocument(skill))
    return {
      skill,
      tokens,
      termFrequency: termFrequency(tokens)
    }
  })
  const averageLength = docs.length
    ? docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length
    : 1
  const documentFrequency = new Map<string, number>()
  for (const token of queryTokens) {
    documentFrequency.set(
      token,
      docs.reduce((count, doc) => count + (doc.termFrequency.has(token) ? 1 : 0), 0)
    )
  }

  return docs
    .map((doc) => {
      const matchedTerms = queryTokens.filter((token) => doc.termFrequency.has(token))
      const score = queryTokens.length === 0
        ? 0
        : bm25Score(doc.termFrequency, doc.tokens.length, averageLength, queryTokens, documentFrequency, docs.length)
      return {
        skillId: doc.skill.id,
        name: doc.skill.name,
        description: doc.skill.description,
        root: doc.skill.root,
        entryPath: doc.skill.entryPath,
        score: Number(score.toFixed(4)),
        matchedTerms,
        highlights: highlightsForSkill(doc.skill, matchedTerms)
      }
    })
    .filter((result) => queryTokens.length === 0 || result.score > 0)
    .sort((left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId))
    .slice(0, topK)
}

export function buildScientificSkillsStatusSummary(index: ScientificSkillsIndex): ScientificSkillsStatusSummary {
  const plottingItems = buildScientificPlottingPack(index)
  return {
    installed: index.installed,
    skillCount: index.skillCount,
    fingerprint: index.fingerprint,
    indexedAt: index.indexedAt,
    roots: index.roots,
    validationErrors: index.validationErrors.slice(0, 30),
    plottingPack: {
      total: plottingItems.length,
      installed: plottingItems.filter((item) => item.installed).length,
      missing: plottingItems.filter((item) => !item.installed).length,
      items: plottingItems
    },
    ...(index.installed ? {} : { installHint: index.installHint }),
    onDemandPolicy: {
      mode: 'manual-approval',
      summary: 'SciForge should keep K-Dense skills out of the always-on roots and only enable or install them after an explicit user-approved plotting workflow.'
    }
  }
}

export function buildScientificPlottingPack(index: ScientificSkillsIndex): ScientificPlottingPackItem[] {
  return SCIENTIFIC_PLOTTING_SKILL_IDS.map((skillId) => {
    const skill = findSkill(index, skillId)
    return {
      skillId,
      label: plottingSkillLabel(skillId),
      installed: Boolean(skill),
      ...(skill
        ? {
            name: skill.name,
            description: skill.description,
            entryPath: skill.entryPath,
            dependencyRisk: dependencyRiskForSkill(skill),
            validationErrors: skill.validationErrors
          }
        : {
            validationErrors: []
          })
    }
  })
}

export function readScientificSkill(
  index: ScientificSkillsIndex,
  skillId: string,
  include: string[] = ['frontmatter', 'overview', 'resources'],
  inputMaxBytes = DEFAULT_READ_MAX_BYTES
): ScientificSkillReadResult | null {
  const skill = findSkill(index, skillId)
  if (!skill) return null
  const maxBytes = clampInteger(inputMaxBytes, 1_000, MAX_READ_MAX_BYTES)
  const includeSet = new Set(include.map((item) => item.trim().toLowerCase()).filter(Boolean))
  const wantsFull = includeSet.has('full')
  const result: ScientificSkillReadResult = {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    root: skill.root,
    entryPath: skill.entryPath,
    fingerprint: skill.fingerprint,
    frontmatter: skill.frontmatter,
    overview: truncateUtf8(skill.overview, maxBytes).text,
    resources: skill.resources,
    truncated: false,
    validationErrors: skill.validationErrors
  }

  if (includeSet.has('scripts') || wantsFull) result.scripts = skill.scripts
  if (includeSet.has('references') || wantsFull) result.references = skill.references
  if (wantsFull) {
    const full = skill.content
    const truncated = truncateUtf8(full, maxBytes)
    result.fullContent = truncated.text
    result.truncated = truncated.truncated
  }
  return result
}

export async function readScientificSkillFullContent(entryPath: string): Promise<string> {
  return readFile(entryPath, 'utf8')
}

export function planScientificSkills(
  index: ScientificSkillsIndex,
  task: string,
  selectedSkillIds: string[] = [],
  inputMaxContextBytes = DEFAULT_PLAN_CONTEXT_BYTES
): ScientificSkillPlanResult {
  const plottingTask = isScientificPlottingTask(task)
  const styleReferenceTask = plottingTask && isFigureStyleReferenceTask(task)
  if (!index.installed) {
    const planningInstallHint = [
      'K-Dense Scientific Agent Skills is not installed in the configured local paths.',
      'Ask the user to install it outside SciForge using the documented K-Dense workflow, or set',
      `${SCIENTIFIC_SKILLS_ENV_ROOT} to the local skills directory.`
    ].join(' ')
    return {
      installed: false,
      task,
      recommendedSkills: [],
      guardrails: readonlyGuardrails(),
      nextSciForgeActions: [
        'Ask the user to install K-Dense Scientific Agent Skills outside SciForge, then re-run scientific_skills_status.',
        'Keep SciForge skill roots unchanged; consume K-Dense only through this MCP index.'
      ],
      installHint: planningInstallHint,
      ...(plottingTask
        ? {
            installRecommendation: buildScientificSkillsInstallRecommendation(SCIENTIFIC_PLOTTING_SKILL_IDS),
            plottingWorkflow: buildPlottingWorkflow([], SCIENTIFIC_PLOTTING_SKILL_IDS, styleReferenceTask)
          }
        : {})
    }
  }

  const maxContextBytes = clampInteger(inputMaxContextBytes, 1_000, MAX_PLAN_CONTEXT_BYTES)
  const selected = selectedSkillIds
    .map((id) => findSkill(index, id))
    .filter((skill): skill is ScientificSkillRecord => Boolean(skill))
  const plottingPack = buildScientificPlottingPack(index)
  const availablePlottingSkillIds = plottingPack.filter((item) => item.installed).map((item) => item.skillId)
  const missingPlottingSkillIds = plottingPack.filter((item) => !item.installed).map((item) => item.skillId)
  const plottingCandidates = plottingTask
    ? buildScientificPlottingPack(index)
      .map((item) => findSkill(index, item.skillId))
      .filter((skill): skill is ScientificSkillRecord => Boolean(skill))
    : []
  const searchedCandidates = searchScientificSkills(index, task, 5).map((result) => findSkill(index, result.skillId))
    .filter((skill): skill is ScientificSkillRecord => Boolean(skill))
  const candidates = selected.length > 0
    ? selected
    : uniqueSkills([...plottingCandidates, ...searchedCandidates])

  let consumedBytes = 0
  const recommendedSkills = candidates.slice(0, 5).map((skill) => {
    consumedBytes += Buffer.byteLength(skill.overview, 'utf8')
    const reason = reasonForSkill(skill, task)
    const dependencyRisk = dependencyRiskForSkill(skill)
    return {
      skillId: skill.id,
      name: skill.name,
      reason: consumedBytes > maxContextBytes ? truncateUtf8(reason, 500).text : reason,
      dependencyRisk,
      suggestedNextStep: 'Use scientific_skills_read for details, then route execution to a SciForge-controlled tool.'
    }
  })

  return {
    installed: true,
    task,
    recommendedSkills,
    guardrails: readonlyGuardrails(),
    nextSciForgeActions: buildNextSciForgeActions(styleReferenceTask),
    ...(plottingTask
      ? {
          ...(missingPlottingSkillIds.length > 0
            ? { installRecommendation: buildScientificSkillsInstallRecommendation(missingPlottingSkillIds) }
            : {}),
          plottingWorkflow: buildPlottingWorkflow(
            availablePlottingSkillIds,
            missingPlottingSkillIds,
            styleReferenceTask
          )
        }
      : {})
  }
}

function isScientificPlottingTask(task: string): boolean {
  const text = task.toLowerCase()
  return /plot|chart|figure|visuali[sz]ation|matplotlib|seaborn|plotly|diagram|schematic|mermaid|绘图|图表|作图|可视化|示意图|论文图/.test(text)
}

function isFigureStyleReferenceTask(task: string): boolean {
  const text = task.toLowerCase()
  return /style|aesthetic|look like|same effect|same style|reference figure|paper style|figure style|visual style|美学|风格|同样效果|同款|仿照|参考图|参考文献|文献风格|论文风格|图风格/.test(text)
}

function buildNextSciForgeActions(styleReferenceTask: boolean): string[] {
  const actions = [
    'Read the selected skill overview and resource lists before deciding whether to expose any execution path.',
    'Map the skill guidance into SciForge DataFigure Engine or another first-party controlled tool.',
    'Keep third-party scripts and allowed-tools as planning context only in v1.'
  ]
  if (!styleReferenceTask) return actions
  return [
    'If the user provided a reference paper or figure image, call the controlled figure-style:extract IPC/tool first to produce FigureStyleSpec v1.',
    ...actions
  ]
}

function buildScientificSkillsInstallRecommendation(
  missingSkills: readonly string[]
): NonNullable<ScientificSkillPlanResult['installRecommendation']> {
  return {
    recommended: true,
    reason: 'The task looks like a scientific plotting workflow and one or more curated K-Dense plotting skills are not available in the local read-only index.',
    targetScope: 'workspace',
    backend: 'git',
    source: 'K-Dense-AI/scientific-agent-skills',
    missingSkills: [...missingSkills],
    requiresUserApproval: true
  }
}

function buildPlottingWorkflow(
  availableSkills: readonly string[],
  missingSkills: readonly string[],
  styleReferenceTask = false
): NonNullable<ScientificSkillPlanResult['plottingWorkflow']> {
  const dataFigureHints = [
    'Use K-Dense skill content as planning guidance only; do not grant third-party allowed-tools in v1.',
    'Extract chart type, data shape, styling constraints, and export format before invoking a SciForge-controlled plotting tool.',
    'Prefer DataFigure Engine for executable plotting once the plan is mapped into structured figure requirements.'
  ]
  if (styleReferenceTask) {
    dataFigureHints.unshift(
      'For paper-style matching, extract a FigureStyleSpec from a user-provided reference figure image before generating the new plot.'
    )
  }
  return {
    detected: true,
    availableSkills: [...availableSkills],
    missingSkills: [...missingSkills],
    recommendedLibraries: recommendedPlottingLibraries(availableSkills, missingSkills),
    dataFigureHints,
    nextControlledTool: 'SciForge DataFigure Engine',
    ...(styleReferenceTask
      ? {
          styleReference: {
            detected: true,
            extractionTool: 'figure-style:extract' as const,
            outputArtifact: 'FigureStyleSpec v1' as const,
            acceptedSourceTypes: ['image' as const, 'pdf' as const],
            nextControlledTool: 'SciForge DataFigure Engine',
            guardrails: [
              'Use the reference only for style guidance; do not copy original data, labels, or protected figure content.',
              'Prefer a cropped figure panel image for v1.3; PDF extraction should degrade to an image-crop request.',
              'Store the FigureStyleSpec next to generated artifacts for audit and reproducibility.'
            ]
          }
        }
      : {})
  }
}

function recommendedPlottingLibraries(
  availableSkills: readonly string[],
  missingSkills: readonly string[]
): string[] {
  const skillIds = new Set([...availableSkills, ...missingSkills])
  const libraries: string[] = []
  if (skillIds.has('matplotlib') || skillIds.has('scientific-visualization')) libraries.push('Matplotlib')
  if (skillIds.has('seaborn')) libraries.push('Seaborn')
  if (skillIds.has('plotly')) libraries.push('Plotly')
  if (skillIds.has('markdown-mermaid-writing')) libraries.push('Mermaid')
  if (skillIds.has('scientific-schematics')) libraries.push('Scientific schematic generation')
  return uniqueStrings(libraries)
}

async function discoverSkillDirectories(root: string): Promise<string[]> {
  if (existsSync(join(root, 'SKILL.md'))) return [root]
  const entries = await readdir(root, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = join(root, entry.name)
    if (existsSync(join(skillDir, 'SKILL.md'))) dirs.push(skillDir)
  }
  return dirs.sort((left, right) => basename(left).localeCompare(basename(right)))
}

async function readScientificSkillDirectory(
  root: string,
  skillDir: string,
  indexedAt: string
): Promise<ScientificSkillRecord> {
  const entryPath = join(skillDir, 'SKILL.md')
  const content = await readFile(entryPath, 'utf8')
  const contentBytes = Buffer.byteLength(content, 'utf8')
  const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 16)
  const id = basename(skillDir)
  const { frontmatterText, bodyText, hasFrontmatter } = splitFrontmatter(content)
  const parsed = parseFrontmatter(frontmatterText)
  const title = firstMarkdownTitle(bodyText)
  const overview = firstOverview(bodyText)
  const validationErrors = [...parsed.errors]
  if (!hasFrontmatter) validationErrors.push('Missing frontmatter block.')
  if (!parsed.frontmatter.name) validationErrors.push('Missing frontmatter name; using directory name.')
  if (!parsed.frontmatter.description) validationErrors.push('Missing frontmatter description; using document overview.')

  const sectionResources = extractSectionItems(bodyText, ['resource', 'resources', 'asset', 'assets', 'template', 'templates'])
  const sectionScripts = extractSectionItems(bodyText, ['script', 'scripts'])
  const sectionReferences = extractSectionItems(bodyText, ['reference', 'references', 'refs'])
  const localResources = await listLocalFiles(skillDir, ['resources', 'assets', 'templates'])
  const localScripts = await listLocalFiles(skillDir, ['scripts'])
  const localReferences = await listLocalFiles(skillDir, ['references', 'reference', 'refs'])

  return {
    id,
    name: parsed.frontmatter.name || title || id,
    description: parsed.frontmatter.description || overview || '',
    root,
    skillDir,
    entryPath,
    fingerprint,
    ...(title ? { title } : {}),
    overview,
    frontmatter: parsed.frontmatter,
    resources: uniqueStrings([...sectionResources, ...localResources]).slice(0, 100),
    scripts: uniqueStrings([...sectionScripts, ...localScripts]).slice(0, 100),
    references: uniqueStrings([...sectionReferences, ...localReferences]).slice(0, 100),
    validationErrors,
    content,
    contentBytes,
    indexedAt
  }
}

function splitEnvPaths(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(delimiter).map((item) => item.trim()).filter(Boolean)
}

function expandHomePath(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

function expandPossibleSkillCollectionPaths(path: string): string[] {
  const absolute = resolve(path)
  if (basename(absolute) === 'skills') return [absolute]
  return [join(absolute, 'skills'), absolute]
}

function splitFrontmatter(content: string): {
  frontmatterText: string
  bodyText: string
  hasFrontmatter: boolean
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) {
    return { frontmatterText: '', bodyText: content, hasFrontmatter: false }
  }
  const frontmatterText = match[1] ?? ''
  return {
    frontmatterText,
    bodyText: content.slice(match[0].length),
    hasFrontmatter: true
  }
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const fields: JsonRecord = {}
  const errors: string[] = []
  let currentKey: string | null = null

  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (keyMatch) {
      const key = keyMatch[1] ?? ''
      const value = keyMatch[2] ?? ''
      currentKey = key
      fields[key] = value.trim() ? parseScalar(value.trim()) : []
      continue
    }

    if (/^\s+/.test(line) && currentKey) {
      const continuation = trimmed
      if (continuation.startsWith('- ')) {
        const existing = fields[currentKey]
        const current: unknown[] = Array.isArray(existing) ? [...existing] : []
        current.push(parseScalar(continuation.slice(2).trim()))
        fields[currentKey] = current
        continue
      }
      const propertyMatch = continuation.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
      if (propertyMatch) {
        const current = isJsonRecord(fields[currentKey]) ? fields[currentKey] as JsonRecord : {}
        current[propertyMatch[1] ?? ''] = parseScalar((propertyMatch[2] ?? '').trim())
        fields[currentKey] = current
        continue
      }
      const current = fields[currentKey]
      fields[currentKey] = Array.isArray(current)
        ? [...current, continuation]
        : [String(current ?? ''), continuation].filter(Boolean)
      continue
    }

    errors.push(`Unparsed frontmatter line: ${trimmed}`)
  }

  const metadata = parseMetadata(fields.metadata, errors)
  return {
    frontmatter: {
      ...(stringValue(fields.name) ? { name: stringValue(fields.name) } : {}),
      ...(stringValue(fields.description) ? { description: stringValue(fields.description) } : {}),
      ...(stringValue(fields.license) ? { license: stringValue(fields.license) } : {}),
      ...(compatibilityValue(fields.compatibility) !== undefined
        ? { compatibility: compatibilityValue(fields.compatibility) }
        : {}),
      ...(metadata ? { metadata } : {}),
      allowedTools: stringArrayValue(fields['allowed-tools'] ?? fields.allowed_tools),
      raw: fields
    },
    errors
  }
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed = JSON.parse(value.replace(/'/g, '"')) as unknown
      if (Array.isArray(parsed)) return parsed
    } catch {
      return value
    }
  }
  return value
}

function parseMetadata(value: unknown, errors: string[]): JsonRecord | undefined {
  if (isJsonRecord(value)) return value
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!trimmed.startsWith('{')) {
    errors.push('metadata frontmatter should be a JSON object or YAML mapping.')
    return { raw: trimmed }
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isJsonRecord(parsed)) return parsed
    errors.push('metadata JSON must parse to an object.')
  } catch (error) {
    errors.push(`metadata JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { raw: trimmed }
}

function firstMarkdownTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+?)\s*#*\s*$/m)
  return match?.[1]?.trim()
}

function firstOverview(body: string): string {
  const lines = body.replace(/^#\s+.+$/m, '').split(/\r?\n/)
  const paragraph: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length > 0) break
      continue
    }
    if (trimmed.startsWith('#')) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
  }
  return paragraph.join(' ').trim()
}

function extractSectionItems(body: string, keywords: string[]): string[] {
  const lines = body.split(/\r?\n/)
  const items: string[] = []
  let captureLevel = 0
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1]?.length ?? 0
      const title = (heading[2] ?? '').toLowerCase()
      if (captureLevel > 0 && level <= captureLevel) {
        captureLevel = 0
      }
      if (keywords.some((keyword) => title.includes(keyword))) {
        captureLevel = level
      }
      continue
    }
    if (captureLevel === 0) continue
    const bullet = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/)
    if (bullet?.[1]) {
      items.push(cleanMarkdownListItem(bullet[1]))
    }
  }
  return items.filter(Boolean)
}

async function listLocalFiles(skillDir: string, subdirs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const subdir of subdirs) {
    const dir = join(skillDir, subdir)
    if (!existsSync(dir)) continue
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        out.push(`${subdir}/${entry.name}${entry.isDirectory() ? '/' : ''}`)
      }
    } catch {
      /* Keep indexing resilient if a resource directory cannot be listed. */
    }
  }
  return out
}

function cleanMarkdownListItem(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function compatibilityValue(value: unknown): string | string[] | undefined {
  const items = stringArrayValue(value)
  if (items.length > 1) return items
  return items[0] ?? stringValue(value)
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
  }
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed.replace(/'/g, '"')) as unknown
      if (Array.isArray(parsed)) return stringArrayValue(parsed)
    } catch {
      /* Fall back to comma splitting. */
    }
  }
  if (trimmed.includes(',')) {
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return [trimmed]
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function tokenize(input: string): string[] {
  const lower = input.toLowerCase()
  const ascii = lower.match(/[a-z0-9][a-z0-9_+.-]*/g) ?? []
  const cjkSequences = lower.match(/\p{Script=Han}+/gu) ?? []
  const cjkTokens: string[] = []
  for (const sequence of cjkSequences) {
    const chars = Array.from(sequence)
    cjkTokens.push(...chars)
    for (let index = 0; index < chars.length - 1; index += 1) {
      cjkTokens.push(`${chars[index]}${chars[index + 1]}`)
    }
  }
  return [...ascii, ...cjkTokens].filter((token) => token.length > 0)
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1)
  }
  return map
}

function bm25Score(
  termFrequencyMap: Map<string, number>,
  documentLength: number,
  averageDocumentLength: number,
  queryTokens: string[],
  documentFrequency: Map<string, number>,
  totalDocuments: number
): number {
  const k1 = 1.5
  const b = 0.75
  let score = 0
  for (const token of queryTokens) {
    const tf = termFrequencyMap.get(token) ?? 0
    if (tf === 0) continue
    const df = documentFrequency.get(token) ?? 0
    const idf = Math.log(1 + (totalDocuments - df + 0.5) / (df + 0.5))
    const denominator = tf + k1 * (1 - b + b * (documentLength / Math.max(averageDocumentLength, 1)))
    score += idf * ((tf * (k1 + 1)) / denominator)
  }
  return score
}

function skillSearchDocument(skill: ScientificSkillRecord): string {
  return [
    skill.id,
    skill.name,
    skill.name,
    skill.description,
    skill.description,
    skill.title ?? '',
    skill.overview,
    skill.frontmatter.allowedTools.join(' '),
    JSON.stringify(skill.frontmatter.metadata ?? {}),
    skill.resources.join(' '),
    skill.scripts.join(' '),
    skill.references.join(' ')
  ].join('\n')
}

function highlightsForSkill(skill: ScientificSkillRecord, matchedTerms: string[]): string[] {
  const source = [skill.description, skill.overview].filter(Boolean)
  if (matchedTerms.length === 0) return source.slice(0, 1)
  return source.filter((text) => {
    const lower = text.toLowerCase()
    return matchedTerms.some((term) => lower.includes(term))
  }).slice(0, 2)
}

function findSkill(index: ScientificSkillsIndex, skillId: string): ScientificSkillRecord | undefined {
  const normalized = skillId.trim().toLowerCase()
  return index.skills.find((skill) =>
    skill.id.toLowerCase() === normalized ||
    skill.name.toLowerCase() === normalized
  )
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { text, truncated: false }
  const marker = '\n\n[truncated]'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  let budget = Math.max(0, maxBytes - markerBytes)
  let out = ''
  for (const char of text) {
    const nextBudget = budget - Buffer.byteLength(char, 'utf8')
    if (nextBudget < 0) break
    out += char
    budget = nextBudget
  }
  return { text: `${out}${marker}`, truncated: true }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function dependencyRiskForSkill(skill: ScientificSkillRecord): string {
  const allowedTools = skill.frontmatter.allowedTools.join(' ').toLowerCase()
  const hasExecutionTool = /\b(bash|python|node|pip|uv|npm|shell)\b/.test(allowedTools)
  if (hasExecutionTool || skill.scripts.length > 0) {
    return 'May expect code execution or bundled scripts; v1 exposes this as planning context only.'
  }
  if (skill.resources.length > 0 || skill.references.length > 0) {
    return 'Depends on local resources or references; read them before mapping to a controlled SciForge tool.'
  }
  return 'Low: no obvious execution dependency was detected from frontmatter or local resource lists.'
}

function plottingSkillLabel(skillId: string): string {
  switch (skillId) {
    case 'scientific-visualization':
      return 'Scientific visualization'
    case 'matplotlib':
      return 'Matplotlib'
    case 'seaborn':
      return 'Seaborn'
    case 'plotly':
      return 'Plotly'
    case 'scientific-schematics':
      return 'Scientific schematics'
    case 'markdown-mermaid-writing':
      return 'Markdown Mermaid writing'
    default:
      return skillId
  }
}

function uniqueSkills(skills: ScientificSkillRecord[]): ScientificSkillRecord[] {
  const seen = new Set<string>()
  const out: ScientificSkillRecord[] = []
  for (const skill of skills) {
    if (seen.has(skill.id)) continue
    seen.add(skill.id)
    out.push(skill)
  }
  return out
}

function reasonForSkill(skill: ScientificSkillRecord, task: string): string {
  const matched = searchTermsInText(task, skillSearchDocument(skill))
  const base = skill.description || skill.overview || `Skill ${skill.id} matched the task.`
  if (matched.length === 0) return base
  return `${base} Matched task terms: ${matched.slice(0, 8).join(', ')}.`
}

function searchTermsInText(query: string, text: string): string[] {
  const haystack = new Set(tokenize(text))
  return [...new Set(tokenize(query))].filter((token) => haystack.has(token))
}

function readonlyGuardrails(): string[] {
  return [
    'v1 is read-only: no installation, updates, networking, code execution, or file mutation.',
    'Do not add K-Dense skill roots to capabilities.skills.roots in v1.',
    'Treat allowed-tools and scripts as dependency hints, not as executable permissions.',
    'Use SciForge first-party controlled tools for any downstream plotting or artifact creation.'
  ]
}
