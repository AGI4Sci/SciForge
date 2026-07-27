import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

function toRepoPath(path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function isExcludedProductionPath(path: string): boolean {
  const repoPath = toRepoPath(path)
  const fileName = repoPath.split('/').at(-1) ?? ''
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

  const hits = files.flatMap((file) => {
    const absolutePath = join(repoRoot, file)
    return readFileSync(absolutePath, 'utf8').split(/\r?\n/).flatMap((text, index) => {
      const lineHits: DirectCallHit[] = []
      for (const marker of directCallMarkers) {
        const column = text.search(marker.pattern)
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
  })

  return { files, hits }
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
  if (hit.file === 'src/main/zulip-bot-runtime.ts') {
    return hit.marker === 'messages endpoint' && hit.text.includes("'/api/v1/messages'")
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
  if (
    hit.marker === 'chat completions endpoint' &&
    (
      hit.file === 'packages/workers/sci-modality-router/src/experts.ts' ||
      hit.file === 'packages/workers/sci-modality-router/provider/server.py'
    )
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
  it('keeps the static scan scoped to production code outside the Model Router package', () => {
    const { files, hits } = scanProductionDirectCallMarkers()

    expect(files).toContain('src/main/index.ts')
    expect(files).toContain('src/shared/app-settings-types.ts')
    expect(files).toContain('packages/workers/sci-modality-router/src/experts.ts')
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
