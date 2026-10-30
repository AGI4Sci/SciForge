#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_CHANGE = '5472bed3b878854d296851820834145f5fe1a353'
const DEFAULT_MAX_DETAILS = Number.POSITIVE_INFINITY

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    referenceRepo: process.env.REFERENCE_REPO || '',
    change: DEFAULT_CHANGE,
    format: 'text',
    maxDetails: DEFAULT_MAX_DETAILS,
    strict: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--repo') args.repo = readValue(argv, ++index, arg, args.repo)
    else if (arg === '--reference' || arg === '--reference-repo') args.referenceRepo = readValue(argv, ++index, arg, args.referenceRepo)
    else if (arg === '--change' || arg === '--license-change-ref') args.change = readValue(argv, ++index, arg, args.change)
    else if (arg === '--pre-change' || arg === '--mit-ref') args.preChange = readValue(argv, ++index, arg, args.preChange)
    else if (arg === '--json') args.format = 'json'
    else if (arg === '--format') args.format = normalizeFormat(readValue(argv, ++index, arg, args.format))
    else if (arg === '--max-details') args.maxDetails = normalizeMaxDetails(readValue(argv, ++index, arg, String(args.maxDetails)))
    else if (arg === '--strict') args.strict = true
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  args.repo = resolve(args.repo)
  if (!args.referenceRepo.trim()) {
    throw new Error('Reference repository is required. Set REFERENCE_REPO or pass --reference-repo.')
  }
  args.referenceRepo = resolve(args.referenceRepo)
  return args
}

function readValue(argv, index, flag, fallback) {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value || fallback
}

function normalizeFormat(value) {
  if (value === 'text' || value === 'json') return value
  throw new Error(`Unsupported format: ${value}`)
}

function normalizeMaxDetails(value) {
  if (value === 'all' || value === 'Infinity') return Number.POSITIVE_INFINITY
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --max-details value: ${value}`)
  return parsed
}

function printHelp() {
  console.log(`Usage: node scripts/license-risk-scan.mjs [options]

Options:
  --repo <path>                 Repository to scan (default: current working directory)
  --reference-repo <path>       Local reference repository (or set REFERENCE_REPO)
  --reference <path>            Alias for --reference-repo
  --license-change-ref <commit> Reference license-change commit (default: ${DEFAULT_CHANGE})
  --change <commit>             Alias for --license-change-ref
  --mit-ref, --pre-change <ref> Pre-change MIT ref (default: <license-change-ref>^)
  --format <text|json>          Output format (default: text)
  --json                        Alias for --format json
  --max-details <n|all>         Limit text rows per hit section (default: all)
  --strict                      Exit 2 when current HEAD or worktree still has hits
`)
}

function git(repo, args, options = {}) {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1' }
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: options.encoding ?? 'utf8',
    env,
    maxBuffer: 1024 * 1024 * 128,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
}

function revParse(repo, ref) {
  return git(repo, ['rev-parse', ref]).trim()
}

function objectPathsFromRevList(repo, revArgs) {
  const lines = git(repo, ['rev-list', '--objects', '--missing=allow-any', ...revArgs]).split(/\r?\n/)
  const pathsByObject = new Map()
  let missing = 0
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('?')) {
      missing += 1
      continue
    }
    const firstSpace = line.indexOf(' ')
    if (firstSpace === -1) continue
    const objectId = line.slice(0, firstSpace)
    const path = line.slice(firstSpace + 1)
    if (!path) continue
    addPath(pathsByObject, objectId, path)
  }
  return { pathsByObject, missing }
}

function treeBlobPaths(repo, rev) {
  const output = git(repo, ['ls-tree', '-r', '-z', rev], { encoding: 'buffer' })
  const pathsByObject = new Map()
  for (const entry of output.toString('utf8').split('\0')) {
    if (!entry) continue
    const [metadata, path] = entry.split('\t')
    if (!metadata || !path) continue
    const parts = metadata.split(/\s+/)
    if (parts[1] !== 'blob') continue
    addPath(pathsByObject, parts[2], path)
  }
  return pathsByObject
}

function trackedAndUntrackedFiles(repo) {
  const output = git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  return output.split('\0').filter(Boolean)
}

function worktreeBlobPaths(repo) {
  const pathsByObject = new Map()
  for (const path of trackedAndUntrackedFiles(repo)) {
    if (isIgnoredScanPath(path)) continue
    const absolute = resolve(repo, path)
    if (!existsSync(absolute)) continue
    const stat = statSync(absolute, { throwIfNoEntry: false })
    if (!stat?.isFile()) continue
    const objectId = git(repo, ['hash-object', '--', path]).trim()
    addPath(pathsByObject, objectId, path)
  }
  return pathsByObject
}

function isIgnoredScanPath(path) {
  return path === '.git' ||
    path.startsWith('.git/') ||
    path === '.codex-runtime' ||
    path.startsWith('.codex-runtime/') ||
    path === 'node_modules' ||
    path.includes('/node_modules/') ||
    path === 'dist' ||
    path.startsWith('dist/') ||
    path === 'out' ||
    path.startsWith('out/')
}

function addPath(map, objectId, path) {
  const paths = map.get(objectId) ?? new Set()
  paths.add(path)
  map.set(objectId, paths)
}

function objectTypes(repo, objectIds) {
  const ids = [...objectIds]
  if (ids.length === 0) return new Map()
  const child = spawnSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: `${ids.join('\n')}\n`,
    encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    maxBuffer: 1024 * 1024 * 128
  })
  if (child.status !== 0) throw new Error(child.stderr.trim() || 'git cat-file failed')
  const result = new Map()
  for (const line of child.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [objectId, type] = line.split(/\s+/)
    result.set(objectId, type)
  }
  return result
}

function blobHits({ candidatePaths, referencePaths, safeObjects, typeRepo }) {
  const candidates = [...candidatePaths.keys()].filter((objectId) => referencePaths.has(objectId) && !safeObjects.has(objectId))
  const types = typeRepo ? objectTypes(typeRepo, candidates) : new Map(candidates.map((objectId) => [objectId, 'blob']))
  return candidates
    .filter((objectId) => types.get(objectId) === 'blob')
    .map((objectId) => ({
      objectId,
      paths: [...candidatePaths.get(objectId)].sort(),
      referencePaths: [...referencePaths.get(objectId)].sort()
    }))
    .sort((left, right) => (left.paths[0] ?? '').localeCompare(right.paths[0] ?? ''))
}

function formatHits(title, hits, maxDetails) {
  const limit = Number.isFinite(maxDetails) ? maxDetails : hits.length
  const lines = [`${title}: ${hits.length}`]
  for (const hit of hits.slice(0, limit)) {
    lines.push(`  ${hit.objectId}  ${hit.paths.join(', ')}  <= reference: ${hit.referencePaths.slice(0, 5).join(', ')}`)
  }
  const hidden = hits.length - limit
  if (hidden > 0) lines.push(`  ... ${hidden} more hit(s) hidden by --max-details`)
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const preChange = args.preChange ? revParse(args.referenceRepo, args.preChange) : revParse(args.referenceRepo, `${args.change}^`)
  const head = revParse(args.repo, 'HEAD')
  const referenceHead = revParse(args.referenceRepo, 'HEAD')

  const preChangeObjects = objectPathsFromRevList(args.referenceRepo, [preChange])
  const referenceObjects = objectPathsFromRevList(args.referenceRepo, ['HEAD'])
  const currentHead = treeBlobPaths(args.repo, 'HEAD')
  const worktree = worktreeBlobPaths(args.repo)
  const allRefs = objectPathsFromRevList(args.repo, ['--all'])

  const safeObjects = new Set(preChangeObjects.pathsByObject.keys())
  const currentHeadHits = blobHits({
    candidatePaths: currentHead,
    referencePaths: referenceObjects.pathsByObject,
    safeObjects,
    typeRepo: args.repo
  })
  const worktreeHits = blobHits({
    candidatePaths: worktree,
    referencePaths: referenceObjects.pathsByObject,
    safeObjects,
    typeRepo: null
  })
  const allRefHits = blobHits({
    candidatePaths: allRefs.pathsByObject,
    referencePaths: referenceObjects.pathsByObject,
    safeObjects,
    typeRepo: args.repo
  })
  const currentObjectIds = new Set(currentHeadHits.map((hit) => hit.objectId))
  const historicOnlyHits = allRefHits.filter((hit) => !currentObjectIds.has(hit.objectId))

  const result = {
    repo: args.repo,
    repoHead: head,
    referenceRepo: args.referenceRepo,
    referenceHead,
    licenseChange: args.change,
    preChange,
    missingObjects: {
      referencePreChange: preChangeObjects.missing,
      referenceHead: referenceObjects.missing,
      repoAllRefs: allRefs.missing
    },
    currentHeadHits,
    worktreeHits,
    allRefHits,
    historicOnlyHits
  }

  if (args.format === 'json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`repo: ${result.repo}`)
    console.log(`repo HEAD: ${result.repoHead}`)
    console.log(`reference repo: ${result.referenceRepo}`)
    console.log(`reference HEAD: ${result.referenceHead}`)
    console.log(`license change: ${result.licenseChange}`)
    console.log(`pre-change MIT ref: ${result.preChange}`)
    console.log(`missing objects: reference pre-change=${result.missingObjects.referencePreChange}, reference HEAD=${result.missingObjects.referenceHead}, repo all refs=${result.missingObjects.repoAllRefs}`)
    console.log('')
    console.log(formatHits('current HEAD exact hits', currentHeadHits, args.maxDetails))
    console.log('')
    console.log(formatHits('worktree exact hits', worktreeHits, args.maxDetails))
    console.log('')
    console.log(formatHits('all refs exact hits', allRefHits, args.maxDetails))
    console.log('')
    console.log(formatHits('historic-only exact hits', historicOnlyHits, args.maxDetails))
  }

  if (args.strict && (currentHeadHits.length > 0 || worktreeHits.length > 0)) {
    process.exitCode = 2
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
