#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

const DEFAULT_TARGET = 'dist'
const MODEL_WEIGHT_EXTENSIONS = new Set([
  '.bin',
  '.ckpt',
  '.gguf',
  '.h5',
  '.mlmodel',
  '.onnx',
  '.pkl',
  '.pt',
  '.pth',
  '.safetensors',
  '.tflite'
])
const NATIVE_BINARY_EXTENSIONS = new Set(['.dylib', '.dll', '.exe', '.node', '.so'])
const MEDIA_EXTENSIONS = new Set(['.gif', '.icns', '.ico', '.jpg', '.jpeg', '.mov', '.mp4', '.png', '.svg', '.webp'])
const ARCHIVE_EXTENSIONS = new Set(['.7z', '.appimage', '.asar', '.dmg', '.pkg', '.zip'])
const FORBIDDEN_MEDIA_NAMES = [
  'code.mp4',
  'deepseek.png',
  'deepseek.svg',
  'deepseek_gui_tray.png',
  'feishu.mp4',
  'sdd.mp4',
  'web.mp4',
  'write.mp4'
]
const REQUIRED_NOTICE_NAMES = new Set(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'ASSET_PROVENANCE.md'])

function parseArgs(argv) {
  const args = { target: DEFAULT_TARGET, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--target') args.target = argv[++index] ?? args.target
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  args.target = resolve(args.target)
  return args
}

function printHelp() {
  console.log(`Usage: node scripts/package-release-audit.mjs [--target <dir>] [--json]

Scans a built release/install output directory for release-boundary evidence:
required notices, media assets, native binaries, archives, and bundled model
weight-like files. The command exits 2 when required notices are missing,
legacy risky media names are present, or model-weight-like files are bundled.`)
}

function walk(root) {
  const files = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile()) {
        const stat = statSync(path)
        files.push({ path, rel: relative(root, path), size: stat.size })
      }
    }
  }
  return files.sort((left, right) => left.rel.localeCompare(right.rel))
}

function classify(files) {
  const noticeFiles = files.filter((file) => REQUIRED_NOTICE_NAMES.has(basename(file.rel)))
  const missingNoticeNames = [...REQUIRED_NOTICE_NAMES]
    .filter((name) => !noticeFiles.some((file) => basename(file.rel) === name))
  const modelWeights = files.filter((file) => isModelWeightCandidate(file.rel))
  const nativeBinaries = files.filter((file) => NATIVE_BINARY_EXTENSIONS.has(extname(file.rel).toLowerCase()))
  const mediaAssets = files.filter((file) => MEDIA_EXTENSIONS.has(extname(file.rel).toLowerCase()))
  const archives = files.filter((file) => ARCHIVE_EXTENSIONS.has(extname(file.rel).toLowerCase()))
  const forbiddenMedia = files.filter((file) => FORBIDDEN_MEDIA_NAMES.includes(basename(file.rel).toLowerCase()))
  const packages = files.filter((file) => basename(file.rel) === 'package.json')
  const packageLicenses = packages.map((file) => {
    try {
      const parsed = JSON.parse(readFileSync(file.path, 'utf8'))
      return {
        path: file.rel,
        name: parsed.name ?? '',
        private: Boolean(parsed.private),
        license: parsed.license ?? null
      }
    } catch (error) {
      return { path: file.rel, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const findings = []
  if (missingNoticeNames.length) findings.push(`missing required notice file(s): ${missingNoticeNames.join(', ')}`)
  if (modelWeights.length) findings.push(`bundled model-weight-like file(s): ${modelWeights.map((file) => file.rel).join(', ')}`)
  if (forbiddenMedia.length) findings.push(`legacy risky media file(s): ${forbiddenMedia.map((file) => file.rel).join(', ')}`)

  return {
    targetFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    noticeFiles: noticeFiles.map(toEntry),
    missingNoticeNames,
    modelWeights: modelWeights.map(toEntry),
    nativeBinaries: nativeBinaries.map(toEntry),
    mediaAssets: mediaAssets.map(toEntry),
    archives: archives.map(toEntry),
    forbiddenMedia: forbiddenMedia.map(toEntry),
    packageLicenses,
    findings
  }
}

function isModelWeightCandidate(path) {
  const extension = extname(path).toLowerCase()
  if (!MODEL_WEIGHT_EXTENSIONS.has(extension)) return false
  const normalized = path.replace(/\\/g, '/')
  if (/Electron Framework\.framework\/Versions\/[^/]+\/Resources\/v8_context_snapshot\.[^.]+\.bin$/.test(normalized)) {
    return false
  }
  return true
}

function toEntry(file) {
  return { path: file.rel, bytes: file.size }
}

function formatSection(title, entries, max = 40) {
  const lines = [`${title}: ${entries.length}`]
  for (const entry of entries.slice(0, max)) {
    const suffix = entry.bytes === undefined ? '' : ` (${entry.bytes} bytes)`
    lines.push(`  ${entry.path}${suffix}`)
  }
  if (entries.length > max) lines.push(`  ... ${entries.length - max} more`)
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.target)) throw new Error(`Target does not exist: ${args.target}`)
  const files = walk(args.target)
  const result = {
    target: args.target,
    ...classify(files)
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`target: ${result.target}`)
    console.log(`files: ${result.targetFiles}`)
    console.log(`bytes: ${result.totalBytes}`)
    console.log('')
    console.log(formatSection('required notice files', result.noticeFiles))
    console.log('')
    console.log(formatSection('archives/installers', result.archives))
    console.log('')
    console.log(formatSection('native binaries', result.nativeBinaries))
    console.log('')
    console.log(formatSection('media assets', result.mediaAssets))
    console.log('')
    console.log(formatSection('model-weight-like files', result.modelWeights))
    console.log('')
    console.log(formatSection('legacy risky media names', result.forbiddenMedia))
    console.log('')
    console.log(`package metadata files: ${result.packageLicenses.length}`)
    for (const pkg of result.packageLicenses.slice(0, 40)) {
      const detail = pkg.error
        ? `ERROR ${pkg.error}`
        : `${pkg.name || '(unnamed)'} private=${pkg.private} license=${pkg.license ?? '(missing)'}`
      console.log(`  ${pkg.path}: ${detail}`)
    }
    if (result.packageLicenses.length > 40) console.log(`  ... ${result.packageLicenses.length - 40} more`)
    console.log('')
    if (result.findings.length) {
      console.log('findings:')
      for (const finding of result.findings) console.log(`  - ${finding}`)
    } else {
      console.log('findings: none')
    }
  }

  if (result.findings.length) process.exitCode = 2
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
