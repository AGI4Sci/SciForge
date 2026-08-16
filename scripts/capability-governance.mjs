#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPLICATION_COMPOSITION_PATH = path.join(ROOT, 'src/main/modules/index.ts')
const AGENT_TOOLS_PATH = path.join(ROOT, 'src/main/capabilities/agent-tools.ts')
const GENERATED_REFERENCE_PATH = path.join(ROOT, 'docs/generated/capabilities.md')

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const EXCLUDED_SOURCE_SEGMENTS = new Set(['node_modules', 'dist', 'out', 'coverage', 'generated'])

const DIRECT_TRANSPORT_ROOTS = ['src', 'packages']
const REQUIRED_AGENT_TOOL_NAMES = [
  'sciforge_capture',
  'sciforge_discover',
  'sciforge_events',
  'sciforge_invoke',
  'sciforge_look',
  'sciforge_observe'
]
const REQUIRED_LOOK_INPUT_FIELDS = [
  'capture',
  'frame',
  'intent',
  'sourceRef',
  'targetRef',
  'task'
]
const REMOVED_AGENT_PATHS = [
  'annotation.sidecar.read',
  'artifact.inspect',
  'gui_pdf_render_image',
  'gui_visible_context',
  'gui_visual_capture',
  'gui_workspace_image_inspect',
  'surface.inspect'
]

class GovernanceError extends Error {
  constructor(message, details = []) {
    super(message)
    this.name = 'GovernanceError'
    this.details = details
  }
}

function parseCommand(argv) {
  if (argv.length === 0 || argv.includes('--check')) return 'check'
  if (argv.includes('--write') || argv.includes('--generate')) return 'write'
  if (argv.includes('--architecture')) return 'architecture'
  if (argv.includes('--help') || argv.includes('-h')) return 'help'
  throw new GovernanceError(`Unknown argument: ${argv.join(' ')}`)
}

function printHelp() {
  console.log(`SciForge capability governance

Usage:
  node scripts/capability-governance.mjs --write         regenerate capability reference
  node scripts/capability-governance.mjs --check         verify reference and architecture boundaries
  node scripts/capability-governance.mjs --architecture  scan architecture boundaries only

The command fails closed if the domain catalog composition is missing, cannot
be constructed, is empty, contains duplicate actions, or advertises an
incomplete descriptor.`)
}

function createUnavailableDependency(label) {
  let dependency
  const target = () => {
    throw new GovernanceError(
      `Capability reference generation tried to execute dependency "${label}". ` +
        'Registry construction must only bind handlers; move side effects into the handler body.'
    )
  }
  dependency = new Proxy(target, {
    apply: target,
    construct: target,
    get(_target, property) {
      if (property === 'then') return undefined
      if (property === 'bind') return () => dependency
      if (property === Symbol.toPrimitive) return () => `[unavailable:${label}]`
      if (property === 'toString') return () => `[unavailable:${label}]`
      return createUnavailableDependency(`${label}.${String(property)}`)
    }
  })
  return dependency
}

function createReferenceDependencies() {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      return createUnavailableDependency(String(property))
    }
  })
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry, seen)).filter((entry) => entry !== undefined)
  }
  if (!isPlainObject(value)) {
    throw new GovernanceError(
      'CapabilityRegistry.list() returned a non-serializable descriptor value. ' +
        'Expose JSON-compatible schemas and metadata; never expose handlers or service instances.'
    )
  }
  if (seen.has(value)) {
    throw new GovernanceError('CapabilityRegistry.list() returned a cyclic descriptor.')
  }
  seen.add(value)
  const normalized = Object.create(null)
  for (const key of Object.keys(value).sort()) {
    const entry = normalizeJson(value[key], seen)
    if (entry !== undefined) normalized[key] = entry
  }
  seen.delete(value)
  return normalized
}

function validateDescriptors(rawDescriptors) {
  if (!Array.isArray(rawDescriptors) || rawDescriptors.length === 0) {
    throw new GovernanceError(
      'The application capability registry is empty. Product actions remain unavailable until a provider is registered.'
    )
  }

  const descriptors = []
  const ids = new Set()
  for (const rawDescriptor of rawDescriptors) {
    const descriptor = normalizeJson(rawDescriptor)
    const id = typeof descriptor?.id === 'string' ? descriptor.id.trim() : ''
    if (!id) throw new GovernanceError('A registered capability is missing a non-empty id.')
    if (ids.has(id)) throw new GovernanceError(`Duplicate registered capability id: ${id}`)
    ids.add(id)

    const requiredFields = ['version', 'audiences', 'scope', 'effect', 'approval', 'inputSchema', 'outputSchema']
    const missingFields = requiredFields.filter((field) => descriptor[field] === undefined)
    if (missingFields.length > 0) {
      throw new GovernanceError(
        `Capability "${id}" is incomplete; missing ${missingFields.join(', ')}. ` +
          'Definitions must fail closed before UI or agent exposure.'
      )
    }
    descriptors.push(descriptor)
  }
  return descriptors.sort((left, right) => left.id.localeCompare(right.id))
}

function validateMigratedDomainPolicies(rawPolicies) {
  if (rawPolicies === undefined) return []
  if (!Array.isArray(rawPolicies)) {
    throw new GovernanceError('Catalog capability domain policies must be an array.')
  }
  const ids = new Set()
  const prefixes = new Set()
  const allowedTransports = new Set()
  return rawPolicies.map((rawPolicy, index) => {
    if (!isPlainObject(rawPolicy)) {
      throw new GovernanceError(`Catalog capability domain policy at index ${index} must be an object.`)
    }
    const id = typeof rawPolicy.id === 'string' ? rawPolicy.id.trim() : ''
    const title = typeof rawPolicy.title === 'string' ? rawPolicy.title.trim() : ''
    if (!Array.isArray(rawPolicy.directTransportPrefixes)) {
      throw new GovernanceError(`Migrated domain "${id || index}" must declare directTransportPrefixes (use [] for broker-native domains).`)
    }
    const directTransportPrefixes = rawPolicy.directTransportPrefixes
      .map((value) => typeof value === 'string' ? value.trim() : '')
    const allowedDirectTransports = rawPolicy.allowedDirectTransports === undefined
      ? []
      : Array.isArray(rawPolicy.allowedDirectTransports)
        ? rawPolicy.allowedDirectTransports.map((value) => typeof value === 'string' ? value.trim() : '')
        : null
    if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new GovernanceError(`Migrated domain at index ${index} has an invalid id.`)
    }
    if (!title) throw new GovernanceError(`Migrated domain "${id}" is missing a title.`)
    if (directTransportPrefixes.some((prefix) => !prefix)) {
      throw new GovernanceError(`Migrated domain "${id}" contains an empty direct transport prefix.`)
    }
    if (!allowedDirectTransports || allowedDirectTransports.some((channel) => !channel)) {
      throw new GovernanceError(`Migrated domain "${id}" has invalid allowedDirectTransports.`)
    }
    if (ids.has(id)) throw new GovernanceError(`Duplicate migrated domain id: ${id}`)
    ids.add(id)
    for (const prefix of directTransportPrefixes) {
      if (prefixes.has(prefix)) throw new GovernanceError(`Duplicate migrated transport prefix: ${prefix}`)
      prefixes.add(prefix)
    }
    for (const channel of allowedDirectTransports) {
      if (!directTransportPrefixes.some((prefix) => channel.startsWith(prefix))) {
        throw new GovernanceError(
          `Allowed direct transport "${channel}" is not covered by domain "${id}" transport prefixes.`
        )
      }
      if (allowedTransports.has(channel)) throw new GovernanceError(`Duplicate allowed direct transport: ${channel}`)
      allowedTransports.add(channel)
    }
    return {
      id,
      title,
      directTransportPrefixes: [...directTransportPrefixes].sort(),
      allowedDirectTransports: [...allowedDirectTransports].sort()
    }
  }).sort((left, right) => left.id.localeCompare(right.id))
}

function validateDomainPolicyCoverage(descriptors, migratedDomains) {
  const registeredDomainIds = new Set(descriptors.map((descriptor) => descriptor.id.split('.')[0]))
  const policyDomainIds = new Set(migratedDomains.map((domain) => domain.id))
  const uncoveredDomains = [...registeredDomainIds].filter((id) => !policyDomainIds.has(id)).sort()
  if (uncoveredDomains.length > 0) {
    throw new GovernanceError(
      `Registered capability domains are missing atomic-cutover policy: ${uncoveredDomains.join(', ')}. ` +
        'Contribute each domain policy through the DomainModuleCatalog before exposing its actions.'
    )
  }
  const emptyPolicies = [...policyDomainIds].filter((id) => !registeredDomainIds.has(id)).sort()
  if (emptyPolicies.length > 0) {
    throw new GovernanceError(
      `Migrated domain policies have no registered capabilities: ${emptyPolicies.join(', ')}.`
    )
  }
}

async function loadApplicationCapabilityModel() {
  try {
    await stat(APPLICATION_COMPOSITION_PATH)
  } catch {
    throw new GovernanceError(
      `Missing authoritative domain composition: ${relativePath(APPLICATION_COMPOSITION_PATH)}.`
    )
  }

  let module
  try {
    module = await import(pathToFileURL(APPLICATION_COMPOSITION_PATH).href)
  } catch (error) {
    throw new GovernanceError(
      `Unable to import ${relativePath(APPLICATION_COMPOSITION_PATH)}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (
    typeof module.createApplicationDomainCatalog !== 'function' ||
    typeof module.createApplicationCapabilityRegistry !== 'function' ||
    typeof module.listMainCapabilityDomainPolicies !== 'function'
  ) {
    throw new GovernanceError(
      `${relativePath(APPLICATION_COMPOSITION_PATH)} must export the catalog-based application composition API.`
    )
  }

  let registry
  let catalog
  try {
    catalog = await module.createApplicationDomainCatalog({
      getUserDataDir: () => {
        throw new GovernanceError('Governance must not instantiate a domain service.')
      },
      capabilityInvokerFor: () => Object.freeze({
        invoke: async () => {
          throw new GovernanceError('Governance must not invoke a package system capability.')
        }
      }),
      packageStorageFor: () => Object.freeze({
        settings: Object.freeze({
          read: async () => Object.freeze({ revision: 0, value: null }),
          write: async () => {
            throw new GovernanceError('Governance must not write package settings.')
          },
          clear: async () => {
            throw new GovernanceError('Governance must not clear package settings.')
          }
        }),
        secrets: Object.freeze({
          has: async () => false,
          read: async () => null,
          write: async () => {
            throw new GovernanceError('Governance must not write package secrets.')
          },
          remove: async () => {
            throw new GovernanceError('Governance must not remove package secrets.')
          }
        })
      })
    })
    registry = await module.createApplicationCapabilityRegistry(
      catalog,
      createReferenceDependencies()
    )
  } catch (error) {
    if (error instanceof GovernanceError) throw error
    throw new GovernanceError(
      `Application registry construction failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!registry || typeof registry.list !== 'function') {
    throw new GovernanceError('Catalog capability composition must return a registry with list().')
  }
  const descriptors = validateDescriptors(await registry.list())
  const ambiguousPreviewAction = descriptors.find((descriptor) =>
    descriptor.id === 'workspace-preview.invoke-action' && descriptor.audiences.includes('agent')
  )
  if (ambiguousPreviewAction) {
    throw new GovernanceError(
      'workspace-preview.invoke-action must be UI-only. Agent callers use registered domain operations, never a two-level action dispatcher.'
    )
  }
  const migratedDomains = validateMigratedDomainPolicies(
    module.listMainCapabilityDomainPolicies(catalog)
  )
  validateDomainPolicyCoverage(descriptors, migratedDomains)
  let agentToolsModule
  try {
    agentToolsModule = await import(pathToFileURL(AGENT_TOOLS_PATH).href)
  } catch (error) {
    throw new GovernanceError(
      `Unable to import ${relativePath(AGENT_TOOLS_PATH)}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const agentToolNames = Object.values(agentToolsModule.CAPABILITY_AGENT_TOOL_NAMES ?? {}).sort()
  if (stableStringify(agentToolNames) !== stableStringify(REQUIRED_AGENT_TOOL_NAMES)) {
    throw new GovernanceError(
      `The owned agent tool surface must contain only ${REQUIRED_AGENT_TOOL_NAMES.join(', ')}; ` +
        `received ${agentToolNames.join(', ') || '(none)'}. Product capabilities remain behind the broker; ` +
        'only the two Host Core visual primitives may extend the four broker meta-tools.'
    )
  }
  const agentToolSurface = agentToolsModule.createCapabilityAgentToolSurface({
    broker: {},
    resolveCaller: () => ({ audience: 'agent', callerId: 'governance' })
  })
  const lookTool = agentToolSurface.tools().find((tool) => tool.name === 'sciforge_look')
  const lookSchema = lookTool?.inputSchema
  const lookInputFields = Object.keys(lookSchema?.properties ?? {}).sort()
  if (
    stableStringify(lookInputFields) !== stableStringify(REQUIRED_LOOK_INPUT_FIELDS) ||
    stableStringify(lookSchema?.required ?? []) !== stableStringify(['task']) ||
    lookSchema?.additionalProperties !== false
  ) {
    throw new GovernanceError(
      'sciforge_look must expose only sourceRef, targetRef, frame, task, intent, and the typed capture plan with strict additional-property rejection. Workspace files enter through the canonical preview resourceRef pipeline.'
    )
  }
  return { descriptors, migratedDomains }
}

function asInlineList(value) {
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (isPlainObject(value)) return Object.entries(value).map(([key, entry]) => `${key}=${String(entry)}`).join(', ')
  return String(value ?? '')
}

function escapeTableCell(value) {
  return asInlineList(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2)
}

function renderCapabilityReference(descriptors, migratedDomains) {
  const lines = [
    '# SciForge capability reference',
    '',
    '<!-- GENERATED FILE. DO NOT EDIT. Run `npm run capability:generate`. -->',
    '',
    `Authoritative source: \`${relativePath(APPLICATION_COMPOSITION_PATH)}\``,
    '',
    `Registered actions: **${descriptors.length}**`,
    '',
    '| Action ID | Version | Audiences | Effect | Approval | Scope |',
    '| --- | --- | --- | --- | --- | --- |'
  ]

  for (const descriptor of descriptors) {
    lines.push(
      `| \`${escapeTableCell(descriptor.id)}\` | ${escapeTableCell(descriptor.version)} | ` +
        `${escapeTableCell(descriptor.audiences)} | ${escapeTableCell(descriptor.effect)} | ` +
        `${escapeTableCell(descriptor.approval)} | ${escapeTableCell(descriptor.scope)} |`
    )
  }

  for (const descriptor of descriptors) {
    lines.push('', `## \`${descriptor.id}\``, '')
    if (descriptor.description) lines.push(String(descriptor.description), '')
    lines.push(
      `- Version: \`${escapeTableCell(descriptor.version)}\``,
      `- Audiences: ${escapeTableCell(descriptor.audiences)}`,
      `- Effect: \`${escapeTableCell(descriptor.effect)}\``,
      `- Approval: ${escapeTableCell(descriptor.approval)}`,
      `- Scope: ${escapeTableCell(descriptor.scope)}`
    )

    const summarizedKeys = new Set(['id', 'version', 'description', 'audiences', 'effect', 'approval', 'scope'])
    const detail = Object.fromEntries(Object.entries(descriptor).filter(([key]) => !summarizedKeys.has(key)))
    lines.push('', '### Contract', '', '```json', stableStringify(detail), '```')
  }

  lines.push('', '## Migrated domain boundaries', '')
  if (migratedDomains.length === 0) {
    lines.push('No domain has declared an atomic broker cutover yet.')
  } else {
    lines.push(
      '| Domain | Forbidden direct transport prefixes | Explicit UI-only transports |',
      '| --- | --- | --- |'
    )
    for (const domain of migratedDomains) {
      lines.push(
        `| ${escapeTableCell(domain.title)} | ${escapeTableCell(domain.directTransportPrefixes)} | ` +
          `${escapeTableCell(domain.allowedDirectTransports)} |`
      )
    }
  }

  lines.push('')
  return lines.join('\n')
}

async function walkSourceFiles(entryPath) {
  let metadata
  try {
    metadata = await stat(entryPath)
  } catch {
    return []
  }
  if (metadata.isFile()) return SOURCE_EXTENSIONS.has(path.extname(entryPath)) ? [entryPath] : []

  const files = []
  for (const entry of await readdir(entryPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || EXCLUDED_SOURCE_SEGMENTS.has(entry.name)) continue
    const childPath = path.join(entryPath, entry.name)
    if (entry.isDirectory()) files.push(...(await walkSourceFiles(childPath)))
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(childPath)
  }
  return files
}

function positionAt(source, index) {
  const before = source.slice(0, index)
  const lines = before.split('\n')
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function addRegexViolations(violations, filePath, source, rule, pattern, message) {
  pattern.lastIndex = 0
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const position = positionAt(source, match.index)
    violations.push({ rule, filePath, ...position, message })
    if (match[0].length === 0) pattern.lastIndex += 1
  }
}

function isTestFile(filePath) {
  return /(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath)
}

function isVisibleContextProducer(filePath) {
  return /visible-context|VisibleContext|PanelBridge/.test(filePath)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function scanArchitecture(registeredIds = new Set(), migratedDomains = []) {
  const violations = []
  const sourceFiles = [
    ...(await walkSourceFiles(path.join(ROOT, 'src'))),
    ...(await walkSourceFiles(path.join(ROOT, 'packages')))
  ].filter((filePath) => !isTestFile(filePath))

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, 'utf8')
    for (const removedPath of REMOVED_AGENT_PATHS) {
      addRegexViolations(
        violations,
        filePath,
        source,
        'removed-agent-path',
        new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(removedPath)}(?![A-Za-z0-9_.-])`, 'g'),
        `Removed agent path "${removedPath}" must not remain in production source. Use the canonical native or registered operation.`
      )
    }
    addRegexViolations(
      violations,
      filePath,
      source,
      'literal-agent-access-hint',
      /\baccessHint\s*:\s*(['"`])/g,
      'Hand-written accessHint values are forbidden. Publish registry-derived action descriptors and resource handles.'
    )
    addRegexViolations(
      violations,
      filePath,
      source,
      'free-standing-agent-access',
      /\b(?:agentAccess|agentAccessible|agentEnabled|allowAgent|availableToAgent)\s*:\s*(?:true|false)\b|\bagent\s*:\s*(?:true|false|\{|z\.object\b|[A-Z][A-Z0-9_]*AGENT_ACCESS\b)|\b[A-Z][A-Z0-9_]*_AGENT_ACCESS\b/g,
      'Free-standing agent access flags are forbidden. Declare the agent audience on an executable registered action.'
    )

    if (isVisibleContextProducer(filePath)) {
      const literalActionPattern = /\b(?:actionId|capabilityId|operationId)\s*:\s*(['"])([^'"]+)\1/g
      for (let match = literalActionPattern.exec(source); match; match = literalActionPattern.exec(source)) {
        if (registeredIds.has(match[2])) continue
        const position = positionAt(source, match.index)
        violations.push({
          rule: 'unregistered-visible-action',
          filePath,
          ...position,
          message: `Visible action "${match[2]}" is not in the application capability registry.`
        })
      }
    }
  }

  for (const policy of migratedDomains) {
    for (const transportPrefix of policy.directTransportPrefixes) {
      for (const relativeEntry of DIRECT_TRANSPORT_ROOTS) {
        const entryFiles = await walkSourceFiles(path.join(ROOT, relativeEntry))
        for (const filePath of entryFiles.filter((candidate) =>
          !isTestFile(candidate)
        )) {
          const source = await readFile(filePath, 'utf8')
          const channelPattern = new RegExp(`(['"\`])(${escapeRegExp(transportPrefix)}[^'"\`\\s]*)\\1`, 'g')
          const matches = [...source.matchAll(channelPattern)]
            .filter((match) => !policy.allowedDirectTransports.includes(match[2]))
            .filter((match) => {
              const lineStart = source.lastIndexOf('\n', match.index) + 1
              const lineEnd = source.indexOf('\n', match.index)
              const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
              return !line.includes('directTransportPrefixes')
            })
          if (matches.length > 0) {
            const position = positionAt(source, matches[0].index)
            const channels = [...new Set(matches.map((match) => match[2]))].sort()
            violations.push({
              rule: 'migrated-domain-direct-transport',
              filePath,
              ...position,
              message:
                `${policy.title} is marked broker-migrated but still uses direct transport prefix ` +
                `"${transportPrefix}" (${matches.length} occurrence(s): ${channels.join(', ')}). ` +
                'Route UI, agent, and system calls through the generic capability transport.'
            })
          }
        }
      }
    }
  }

  return violations.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) || left.line - right.line || left.column - right.column
  )
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/')
}

function printViolations(violations) {
  const byRule = new Map()
  for (const violation of violations) {
    const entries = byRule.get(violation.rule) ?? []
    entries.push(violation)
    byRule.set(violation.rule, entries)
  }
  for (const [rule, entries] of byRule) {
    console.error(`\n[${rule}] ${entries.length} violation(s)`)
    for (const entry of entries) {
      console.error(`  ${relativePath(entry.filePath)}:${entry.line}:${entry.column} ${entry.message}`)
    }
  }
}

async function writeReference() {
  const model = await loadApplicationCapabilityModel()
  const rendered = renderCapabilityReference(model.descriptors, model.migratedDomains)
  await mkdir(path.dirname(GENERATED_REFERENCE_PATH), { recursive: true })
  await writeFile(GENERATED_REFERENCE_PATH, rendered, 'utf8')
  console.log(
    `Generated ${relativePath(GENERATED_REFERENCE_PATH)} from ${model.descriptors.length} registered actions ` +
      `and ${model.migratedDomains.length} migrated domain policies.`
  )
}

async function checkGovernance({ architectureOnly = false } = {}) {
  const failures = []
  let descriptors = []
  let migratedDomains = []
  try {
    const model = await loadApplicationCapabilityModel()
    descriptors = model.descriptors
    migratedDomains = model.migratedDomains
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }

  if (!architectureOnly && descriptors.length > 0) {
    const expected = renderCapabilityReference(descriptors, migratedDomains)
    let actual = ''
    try {
      actual = await readFile(GENERATED_REFERENCE_PATH, 'utf8')
    } catch {
      failures.push(
        `Missing ${relativePath(GENERATED_REFERENCE_PATH)}. Run \`npm run capability:generate\` and commit the result.`
      )
    }
    // Git may check out the generated Markdown with CRLF on Windows. Compare
    // the semantic text across platforms while preserving the repository's
    // canonical LF output when the reference is regenerated.
    if (actual && actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
      failures.push(
        `${relativePath(GENERATED_REFERENCE_PATH)} differs from the authoritative registry. ` +
          'Run `npm run capability:generate` and commit the result.'
      )
    }
  }

  const registeredIds = new Set(descriptors.map((descriptor) => descriptor.id))
  const violations = await scanArchitecture(registeredIds, migratedDomains)
  if (violations.length > 0) printViolations(violations)

  if (failures.length > 0 || violations.length > 0) {
    for (const failure of failures) console.error(`\n[registry/reference] ${failure}`)
    console.error(
      `\nCapability governance failed: ${failures.length} registry/reference error(s), ` +
        `${violations.length} architecture violation(s).`
    )
    process.exitCode = 1
    return
  }
  console.log(
    `Capability governance passed: ${descriptors.length} registered actions, generated reference is current, ` +
      'and no architecture bypass was found.'
  )
}

async function main() {
  const command = parseCommand(process.argv.slice(2))
  if (command === 'help') return printHelp()
  if (command === 'write') return writeReference()
  if (command === 'architecture') return checkGovernance({ architectureOnly: true })
  return checkGovernance()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
