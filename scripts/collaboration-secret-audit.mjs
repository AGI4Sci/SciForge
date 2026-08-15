import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const scanAll = process.argv.includes('--all')
const maxFileBytes = 2 * 1024 * 1024
const collaborationPath = /collaboration|zulip|remote-channel|unify-user-device/i

const fragments = {
  begin: ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  aws: ['(?:AK', 'IA|AS', 'IA)'].join(''),
  github: ['gh', '[pousr]_'].join(''),
  slack: ['xo', 'x[baprs]-'].join(''),
  model: ['s', 'k-'].join('')
}

const detectors = [
  ['private-key-material', new RegExp(`${fragments.begin.replace('PRIVATE', '(?:[A-Z ]+ )?PRIVATE')}`)],
  ['aws-credential-shaped-value', new RegExp(`${fragments.aws}[0-9A-Z]{16}`)],
  ['github-credential-shaped-value', new RegExp(`${fragments.github}[A-Za-z0-9]{20,}`)],
  ['slack-credential-shaped-value', new RegExp(`${fragments.slack}[A-Za-z0-9-]{10,}`)],
  ['model-credential-shaped-value', new RegExp(`${fragments.model}[A-Za-z0-9_-]{20,}`)],
  [
    'literal-sensitive-assignment',
    /(?:password|authorization|api.?key|access.?key|client.?secret|device.?credential|private.?key)\s*[:=]\s*['"][^'"\n]{8,}['"]/i
  ],
  ['environment-log-leak', /(?:console\.(?:log|error|warn)|logger\.\w+)\s*\([^\n]*(?:process\.env|Deno\.env)/]
]

function listedFiles() {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => file !== 'package-lock.json' && !file.startsWith('vendor/'))
    .filter((file) => scanAll || collaborationPath.test(file))
}

const findings = []
for (const file of listedFiles()) {
  let metadata
  try {
    metadata = statSync(file)
  } catch {
    continue
  }
  if (!metadata.isFile() || metadata.size > maxFileBytes) continue
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (source.includes('\0')) continue
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    for (const [kind, detector] of detectors) {
      if (detector.test(lines[index])) findings.push({ file, line: index + 1, kind })
    }
  }
  if (/(^|\/)\.env$|\.(?:pem|p12|pfx)$|(^|\/)(?:id_rsa|id_ed25519)$/.test(file)) {
    findings.push({ file, line: 0, kind: 'sensitive-file-name' })
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(`${finding.file}:${finding.line}:${finding.kind}\n`)
  }
  process.stderr.write(`collaboration-secret-audit: ${findings.length} redacted finding(s)\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`collaboration-secret-audit: pass (${scanAll ? 'repository' : 'collaboration scope'})\n`)
}
