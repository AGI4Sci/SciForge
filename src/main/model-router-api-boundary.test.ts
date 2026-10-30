import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type DirectCallMarker = {
  label: string
  pattern: RegExp
}

type DirectCallHit = {
  file: string
  line: number
  column: number
  marker: string
  text: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoots = ['src', 'packages/workers', 'packages/domains', 'scripts']
const guiRuntimeSourceRoots = ['src']
const runtimeImageDirectEnvSourceRoots = ['src/main', 'src/renderer']
const sourceExtensions = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.ps1',
  '.py',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
])
const excludedSegments = new Set(['dist', 'docs', 'node_modules', 'out', 'tests'])
// Audited data-only inputs; provenance/configDigest are enforced by dsh-runtime tests.
// Do not exclude the containing `test` tree: unknown neighboring files stay scanned.
const auditedTestDataPaths = new Set([
  'packages/workers/dsh-runtime/test/fixtures/official-acp/default-acp.yml',
  'packages/workers/dsh-runtime/test/fixtures/official-acp/safe-acp.yml'
])
const excludedFileNames = new Set(['package-lock.json'])
const excludedPrefixes = ['packages/workers/model-router/']
const testFilePattern = /(?:^|[/.-])(?:test|spec)\.[cm]?[jt]sx?$/
const allowedLegacyImageDirectWorkerEnvFiles = new Set<string>()

const directCallMarkers: DirectCallMarker[] = [
  { label: 'DeepSeek API host', pattern: /api\.deepseek\.com/i },
  { label: 'OpenAI API host', pattern: /api\.openai\.com/i },
  { label: 'DashScope marker', pattern: /dashscope/i },
  { label: 'beta completions endpoint', pattern: /\/beta\/completions/i },
  { label: 'chat completions endpoint', pattern: /\/chat\/completions/i },
  { label: 'messages endpoint', pattern: /\/v1\/messages/i },
  { label: 'DeepSeek API key env', pattern: /\bDEEPSEEK_API_KEY\b/ },
  { label: 'OpenAI API key env', pattern: /\bOPENAI_API_KEY\b/ },
  { label: 'Anthropic API key env', pattern: /\bANTHROPIC_API_KEY\b/ },
  { label: 'Anthropic auth token env', pattern: /\bANTHROPIC_AUTH_TOKEN\b/ },
  { label: 'DashScope API key env', pattern: /\bDASHSCOPE_API_KEY\b/ },
  { label: 'Qwen API key env', pattern: /\bQWEN_API_KEY\b/ },
  { label: 'Gemini API key env', pattern: /\bGEMINI_API_KEY\b/ },
  { label: 'Google API key env', pattern: /\bGOOGLE_API_KEY\b/ },
  { label: 'Groq API key env', pattern: /\bGROQ_API_KEY\b/ },
  { label: 'Mistral API key env', pattern: /\bMISTRAL_API_KEY\b/ },
  { label: 'Cohere API key env', pattern: /\bCOHERE_API_KEY\b/ },
  { label: 'OpenRouter API key env', pattern: /\bOPENROUTER_API_KEY\b/ },
  { label: 'Azure OpenAI API key env', pattern: /\bAZURE_OPENAI_API_KEY\b/ },
  { label: 'Together API key env', pattern: /\bTOGETHER_API_KEY\b/ },
  { label: 'Fireworks API key env', pattern: /\bFIREWORKS_API_KEY\b/ },
  { label: 'xAI API key env', pattern: /\bXAI_API_KEY\b/ },
  { label: 'Perplexity API key env', pattern: /\bPERPLEXITY_API_KEY\b/ },
  { label: 'Moonshot API key env', pattern: /\bMOONSHOT_API_KEY\b/ },
  { label: 'Zhipu API key env', pattern: /\bZHIPU_API_KEY\b/ },
  { label: 'SiliconFlow API key env', pattern: /\bSILICONFLOW_API_KEY\b/ },
  { label: 'ARK API key env', pattern: /\bARK_API_KEY\b/ }
]
const directCallMarkerInventoryPattern = new RegExp(
  directCallMarkers.map(({ pattern }) => `(?:${pattern.source})`).join('|'),
  'i'
)

function toRepoPath(path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function isExcludedProductionPath(path: string): boolean {
  const repoPath = toRepoPath(path)
  const fileName = repoPath.split('/').at(-1) ?? ''
  if (auditedTestDataPaths.has(repoPath)) return true
  if (excludedFileNames.has(fileName)) return true
  if (excludedPrefixes.some((prefix) => repoPath.startsWith(prefix))) return true
  if (repoPath.split('/').some((segment) => excludedSegments.has(segment))) return true
  return testFilePattern.test(repoPath)
}

function isSourceLikeFile(path: string): boolean {
  return sourceExtensions.has(extname(path))
}

function collectProductionFiles(root: string): string[] {
  if (!existsSync(root)) return []
  if (isExcludedProductionPath(root)) return []

  const stats = statSync(root)
  if (stats.isDirectory()) {
    return readdirSync(root)
      .flatMap((entry) => collectProductionFiles(join(root, entry)))
      .sort()
  }

  if (!stats.isFile()) return []
  return isSourceLikeFile(root) ? [root] : []
}

function scanProductionFiles(sourceRootsToScan: string[] = sourceRoots): string[] {
  return sourceRootsToScan
    .flatMap((sourceRoot) => collectProductionFiles(join(repoRoot, sourceRoot)))
    .filter((path) => !isExcludedProductionPath(path))
    .map(toRepoPath)
    .sort()
}

function scanProductionDirectCallMarkers(
  sourceRootsToScan: string[] = sourceRoots
): { files: string[]; hits: DirectCallHit[] } {
  const files = scanProductionFiles(sourceRootsToScan)

  const hits = files.flatMap((file) =>
    scanDirectCallMarkersInSource(file, readFileSync(join(repoRoot, file), 'utf8'))
  )

  return { files, hits }
}

function maskInertEnvironmentDeclarations(file: string, source: string): string {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return source
  if (!directCallMarkers.some((marker) => marker.label.endsWith(' env') && marker.pattern.test(source))) {
    return source
  }
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let readsAmbientEnvironment = false
  const inspect = (node: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(node) && node.expression.getText(parsed) === 'process'
      && node.name.text === 'env') || (ts.isElementAccessExpression(node)
      && node.expression.getText(parsed) === 'process'
      && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'env')) {
      readsAmbientEnvironment = true
    }
    ts.forEachChild(node, inspect)
  }
  inspect(parsed)
  // A name inventory cannot excuse an ambient credential read, including computed access.
  if (readsAmbientEnvironment) return source

  const literals: ts.StringLiteral[] = []
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
    const declarations = statement.declarationList.declarations
    const declarationLiterals: ts.StringLiteral[] = []
    if (!declarations.every((declaration) => {
      const initializer = declaration.initializer
      const values = initializer && ts.isArrayLiteralExpression(initializer) ? initializer
        : initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)
          && initializer.expression.text === 'Set' && initializer.arguments?.length === 1
          && ts.isArrayLiteralExpression(initializer.arguments[0]) ? initializer.arguments[0] : undefined
      if (!values || !values.elements.every(ts.isStringLiteral)) return false
      declarationLiterals.push(...values.elements)
      return true
    })) continue
    literals.push(...declarationLiterals)
  }
  // Mask only each inert literal, preserving other accesses on the same source line.
  let masked = source
  for (const literal of literals.reverse()) {
    const start = literal.getStart(parsed)
    masked = masked.slice(0, start) + masked.slice(start, literal.end).replace(/[^\r\n]/g, ' ')
      + masked.slice(literal.end)
  }
  return masked
}

function isInertFileDigest(text: string): boolean {
  // A complete relative filename → SHA-256 property is release data, not an endpoint.
  const entry = text.match(/^\s*["']([^"']+)["']:\s*["'][a-f0-9]{64}["'],?\s*$/)
  if (!entry) return false
  const path = entry[1]
  return !/[:\\]/.test(path) && path.split('/').every((part) => part && part !== '.' && part !== '..')
    && /\.[a-z0-9]+$/i.test(path)
}

function scanDirectCallMarkersInSource(file: string, source: string): DirectCallHit[] {
  if (!directCallMarkerInventoryPattern.test(source)) return []
  const environmentLines = maskInertEnvironmentDeclarations(file, source).split(/\r?\n/)
  return source.split(/\r?\n/).flatMap((text, index) => {
    if (!directCallMarkerInventoryPattern.test(text) || isInertFileDigest(text)) return []
    const lineHits: DirectCallHit[] = []
    for (const marker of directCallMarkers) {
      const column = (marker.label.endsWith(' env') ? environmentLines[index] : text).search(marker.pattern)
      if (column >= 0) {
        lineHits.push({
          file,
          line: index + 1,
          column: column + 1,
          marker: marker.label,
          text: text.trim().replace(/\s+/g, ' ')
        })
      }
    }
    return lineHits
  })
}

function scanProductionText(pattern: RegExp): DirectCallHit[] {
  return scanProductionTextInRoots(sourceRoots, pattern)
}

function scanProductionTextInRoots(sourceRootsToScan: string[], pattern: RegExp): DirectCallHit[] {
  const files = scanProductionFiles(sourceRootsToScan)
  return files.flatMap((file) => {
    const absolutePath = join(repoRoot, file)
    return readFileSync(absolutePath, 'utf8').split(/\r?\n/).flatMap((text, index) => {
      const column = text.search(pattern)
      if (column < 0) return []
      return [{
        file,
        line: index + 1,
        column: column + 1,
        marker: pattern.source,
        text: text.trim().replace(/\s+/g, ' ')
      }]
    })
  })
}

function isAllowedBoundaryMarker(hit: DirectCallHit): boolean {
  if (hit.file === 'packages/workers/workspace-egress/src/model-router-bridge.ts') {
    return (
      hit.marker === 'chat completions endpoint' ||
      hit.marker === 'messages endpoint'
    )
  }
  if (hit.file === 'src/main/upstream-provider-env.ts') {
    return true
  }
  if (
    hit.file === 'src/main/runtime/claude-code/claude-code-config.ts' &&
    (hit.text.includes('runtime.apiKey') || hit.text.includes('runtime.baseUrl'))
  ) {
    return true
  }
  if (
    hit.file === 'src/main/runtime/codex/codex-config.ts' ||
    hit.file === 'src/main/runtime/claude-code/claude-code-config.ts'
  ) {
    return /^'[A-Z0-9_]+(?:_API_KEY)?',?$/.test(hit.text)
  }
  // The DSH child environment is built from an explicit allowlist that is
  // forwarded under an existing `runtime_env_not_allowed` guard; the file only
  // names variables for the sandboxed child and never calls a provider API. It
  // also reads unrelated platform variables (SystemRoot/ComSpec), which disables
  // inert-declaration masking for the whole file, so declare the inventory here.
  if (
    hit.file === 'packages/workers/dsh-runtime/src/deployment.ts' &&
    (hit.marker === 'DeepSeek API key env' || hit.marker === 'OpenAI API key env')
  ) {
    return /^const allowed = new Set\(\[(?:'[A-Z0-9_]+',? ?)+\]\)$/.test(hit.text)
  }
  if (
    hit.marker === 'chat completions endpoint' &&
    (
      hit.file === 'packages/workers/sci-modality-router/src/experts.ts' ||
      hit.file === 'packages/workers/sci-modality-router/provider/server.py'
    )
  ) {
    return true
  }
  // Loopback contract probes under scripts/ talk to an in-process mock only:
  // they necessarily name the wire endpoint and a dummy key environment
  // variable to drive the real runtime against it.
  if (
    hit.file.startsWith('scripts/') &&
    hit.file.endsWith('-reasoning-contract.mjs') &&
    (hit.marker === 'messages endpoint' || hit.marker === 'Anthropic API key env')
  ) {
    return true
  }
  return false
}

function formatHits(hits: DirectCallHit[]): string {
  return hits
    .map((hit) => `${hit.file}:${hit.line}:${hit.column} [${hit.marker}] ${hit.text}`)
    .join('\n')
}

function isAllowedLegacyImageDirectWorkerEnvMarker(hit: DirectCallHit): boolean {
  return allowedLegacyImageDirectWorkerEnvFiles.has(hit.file)
}

function isAllowedSciModalityBoundaryMarker(hit: DirectCallHit): boolean {
  if (
    hit.file === 'src/main/model-router-sidecar.ts' &&
    (hit.text.includes('LEGACY_SCI_MODALITY_SERVICE_') || hit.text.includes('SCIENTIFIC_TRANSLATOR_TOKEN_ENV'))
  ) {
    return true
  }
  return false
}

describe('model router API boundary static audit inventory', () => {
  it.each(['default-acp.yml', 'safe-acp.yml'])('classifies only audited official ACP data: %s', (name) => {
    const file = `packages/workers/dsh-runtime/test/fixtures/official-acp/${name}`
    expect(existsSync(join(repoRoot, file))).toBe(true)
    expect(isExcludedProductionPath(join(repoRoot, file))).toBe(true)
    expect(scanProductionFiles()).not.toContain(file)
    // Classification, not a provider-marker exemption: the original bytes still hit.
    expect(scanDirectCallMarkersInSource(file, readFileSync(join(repoRoot, file), 'utf8'))
      .some((hit) => hit.marker === 'DeepSeek API key env')).toBe(true)
  })

  it.each([
    'src/main/provider.yml',
    'src/main/provider.ts',
    'packages/workers/dsh-runtime/src/deployment.ts',
    'packages/workers/dsh-runtime/test/fixtures/official-acp/unknown.yml',
    'packages/workers/dsh-runtime/test/fixtures/official-acp/default-acp.yaml',
    'packages/workers/dsh-runtime/test/other.yml'
  ])('keeps unaudited paths subject to provider rejection: %s', (file) => {
    expect(isExcludedProductionPath(join(repoRoot, file))).toBe(false)
    const source = file.endsWith('.ts') ? 'const key = process.env.DEEPSEEK_API_KEY' : 'apiKeyEnv: DEEPSEEK_API_KEY'
    const hits = scanDirectCallMarkersInSource(file, source).filter((hit) => !isAllowedBoundaryMarker(hit))
    expect(hits.some((hit) => hit.marker === 'DeepSeek API key env')).toBe(true)
  })

  it('recognizes inert filename digests and explicit environment-name declarations', () => {
    expect(scanDirectCallMarkersInSource('runtime.ts', [
      'const approved = new Set(["OPENAI_API_KEY", "DEEPSEEK_API_KEY"])',
      `const files = {`,
      `  "node_modules/client/chat/completions.js": "${'a'.repeat(64)}"`,
      '}'
    ].join('\n'))).toEqual([])
  })

  it.each([
    'const key = process.env.OPENAI_API_KEY',
    'const names = ["OPENAI_API_KEY"]; const key = process.env[names[0]]',
    'const names = new Set(["OPENAI_API_KEY"]); for (const name of names) send(process.env[name])',
    'const names = ["OPENAI_API_KEY"]; const env = process["env"]; send(env[names[0]])',
    'const names = ["OPENAI_API_KEY"]; send(env.OPENAI_API_KEY)',
    'fetch("https://api.openai.com/v1/chat/completions")',
    'fetch(baseUrl + "/chat/completions")',
    `"https://api.openai.com/v1/chat/completions.js": "${'a'.repeat(64)}"`,
    `"client/chat/completions.js": computeDigest()`
  ])('continues to reject executable provider access: %s', (source) => {
    expect(scanDirectCallMarkersInSource('runtime.ts', source).length).toBeGreaterThan(0)
  })

  it('keeps the static scan scoped to production code outside the Model Router package', () => {
    const { files, hits } = scanProductionDirectCallMarkers()

    expect(files).toContain('src/main/index.ts')
    expect(files).toContain('src/shared/app-settings-types.ts')
    expect(files).toContain('packages/workers/sci-modality-router/src/experts.ts')
    expect(files).toContain('packages/workers/dsh-runtime/src/deployment.ts')
    expect(files).toContain('packages/workers/dsh-runtime/src/release-darwin-arm64.ts')
    expect(files.some((file) => file.startsWith('packages/workers/model-router/'))).toBe(false)
    expect(files.some((file) => testFilePattern.test(file))).toBe(false)
    expect(hits.every((hit) => !hit.file.startsWith('packages/workers/model-router/'))).toBe(true)
  })
})

describe('P7/P8 model router API boundary enforcement', () => {
  it('blocks direct LLM provider markers in production code outside Model Router', () => {
    const { hits } = scanProductionDirectCallMarkers()
    const disallowedHits = hits.filter((hit) => !isAllowedBoundaryMarker(hit))

    expect(formatHits(disallowedHits)).toBe('')
  })

  it('keeps ModelRouterModelClient construction out of GUI production code', () => {
    const directConstructors = scanProductionText(/\bnew\s+ModelRouterModelClient\b/)

    expect(directConstructors).toEqual([])
  })

  it('blocks GUI/runtime direct calls to the sci-modality service endpoint', () => {
    const directSciModalityHits = [
      ...scanProductionTextInRoots(guiRuntimeSourceRoots, /\bSCIFORGE_SCIMODALITY_SERVICE_[A-Z0-9_]+\b/),
      ...scanProductionTextInRoots(guiRuntimeSourceRoots, /\bSCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN\b/),
      ...scanProductionTextInRoots(guiRuntimeSourceRoots, /\/modality\/translate/)
    ].filter((hit) => !isAllowedSciModalityBoundaryMarker(hit))

    expect(formatHits(directSciModalityHits)).toBe('')
  })

  it('blocks GUI/runtime direct image provider env outside the scrub inventory', () => {
    const legacyImageEnvHits = scanProductionTextInRoots(
      runtimeImageDirectEnvSourceRoots,
      /\bSCIFORGE_IMAGE_[A-Z0-9_]+\b/
    ).filter((hit) => !isAllowedLegacyImageDirectWorkerEnvMarker(hit))

    expect(formatHits(legacyImageEnvHits)).toBe('')
  })
})
