#!/usr/bin/env node
// Read-only verifier for the collaboration acceptance evidence protocol
// (openspec/changes/align-conversational-collaboration-mvp/evidence-protocol.md).
// It checks checklist checkboxes against evidence records, the repository and,
// over SSH, the cloud-v1 image labels and operation receipts. It never writes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_CHECKLISTS = Object.freeze([
  'openspec/changes/align-conversational-collaboration-mvp/tasks.md',
  '.trellis/tasks/10-11-collaboration-wegent-minio-refactor/prd.md'
])
export const DEFAULT_EVIDENCE_DIR = '.trellis/tasks/10-11-collaboration-wegent-minio-refactor/evidence'
export const DEFAULT_PG_CONTAINER = 'sciforge-collaboration-private-postgres-1'
export const DEFAULT_DB_SCHEMA = 'sciforge_collaboration'

const EVIDENCE_ID = /^EV-\d{8}-\d{2,}$/u
const EVIDENCE_REF = /EV-\d{8}-\d{2,}/gu
const CHECKED_LINE = /^\s*- \[[xX]\]\s+(.*)$/u
// Phrases that say the work itself is unfinished. Domain words such as
// "partial upload" or "pending Offer" describe behaviour and are not matched.
const UNFINISHED_WORDING =
  /\b(?:remains?|is|still) (?:explicitly )?(?:open|unchecked|partial|pending|incomplete)\b|\bnot (?:yet )?(?:run|verified|implemented|exercised)\b|\bpartially (?:done|complete|implemented|verified)\b|\bTODO\b|未完成|待验收|待实现/iu
const REAL_CLOUD_CLAIM = /real[-_ ]cloud|cloud-v1|two-user|dual-user|\bpackaged\b|\bE2E\b|真实|双用户/iu
const UI_CLAIM = /\bUI\b|\bDashboard\b|\bpanel\b|\bscreen\b|界面|看板|面板/iu
const ENVIRONMENTS = new Set(['local', 'simulated_cloud', 'real_cloud'])
const KINDS = new Set(['cloud', 'ui', 'desktop-build', 'test'])
const SHA40 = /^[0-9a-f]{40}$/u
const SHA_PREFIX = /^[0-9a-f]{7,40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u
const RECEIPT_ID = /^rcp_[0-9a-f]{24}$/u
const OPERATION = /^[a-z][a-z0-9_.]*$/u
const ACTOR_KEY = /^(?:oidc|agent):[A-Za-z0-9_]+$/u
const SQL_NAME = /^[a-z_][a-z0-9_]*$/u
const DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u
const SECRET_PATTERNS = [
  /"(?:password|passwd|secret|apiKey|api_key|accessToken|refreshToken|idToken|token)"\s*:/iu,
  /Bearer\s+[A-Za-z0-9._~+/-]{10,}/u,
  /\bsk-[A-Za-z0-9]{16,}/u
]

/** Parse checked lines and their cited evidence IDs from one checklist. */
export function parseChecklist(file, text) {
  const items = []
  text.split('\n').forEach((line, index) => {
    const match = CHECKED_LINE.exec(line)
    if (!match) return
    items.push({
      file,
      line: index + 1,
      text: match[1],
      refs: [...new Set(match[1].match(EVIDENCE_REF) ?? [])]
    })
  })
  return items
}

/** Validate one record's own fields; returns a list of error strings. */
export function validateRecord(record, fileName, rawText = JSON.stringify(record)) {
  const errors = []
  const fail = (message) => errors.push(message)
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record is not a JSON object']
  if (record.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (typeof record.id !== 'string' || !EVIDENCE_ID.test(record.id)) fail('id must match EV-YYYYMMDD-NN')
  else if (fileName !== `${record.id}.json`) fail(`file name ${fileName} does not match id ${record.id}`)
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(record.date)) fail('date must be YYYY-MM-DD')
  if (!ENVIRONMENTS.has(record.environment)) fail('environment must be local, simulated_cloud or real_cloud')
  const kinds = Array.isArray(record.kinds) ? record.kinds : []
  if (kinds.length === 0 || kinds.some((kind) => !KINDS.has(kind))) fail('kinds must be a non-empty subset of cloud, ui, desktop-build, test')
  if (typeof record.claim !== 'string' || record.claim.trim().length < 10) fail('claim must state what the evidence proves')
  if (!Array.isArray(record.supports) || record.supports.length === 0) fail('supports must name the checklist items it backs')
  if (typeof record.sourceCommit !== 'string' || !SHA40.test(record.sourceCommit)) fail('sourceCommit must be a full 40-character SHA')
  if (typeof record.recordedBy !== 'string' || !record.recordedBy.trim()) fail('recordedBy is required')
  if (record.acceptedBy !== null && record.acceptedBy !== undefined) {
    if (typeof record.acceptedBy !== 'string' || !record.acceptedBy.trim()) fail('acceptedBy must be null or a non-empty string')
    else if (record.acceptedBy.trim() === String(record.recordedBy ?? '').trim()) fail('acceptedBy must differ from recordedBy')
    if (typeof record.acceptedAt !== 'string' || !record.acceptedAt.trim()) fail('acceptedAt is required once accepted')
  }
  if (record.environment === 'real_cloud') {
    const server = record.server ?? {}
    if (!IMAGE_DIGEST.test(String(server.imageDigest ?? ''))) fail('real_cloud server.imageDigest must be sha256:<64 hex>')
    if (!SHA_PREFIX.test(String(server.contractCommit ?? ''))) fail('real_cloud server.contractCommit must be a commit SHA')
    if (!SQL_NAME.test(String(server.database ?? ''))) fail('real_cloud server.database must be a plain database name')
    if (!Array.isArray(record.receipts) || record.receipts.length === 0) fail('real_cloud records need at least one receipt')
  }
  for (const [index, receipt] of (Array.isArray(record.receipts) ? record.receipts : []).entries()) {
    if (!RECEIPT_ID.test(String(receipt?.receiptId ?? ''))) fail(`receipts[${index}].receiptId must be rcp_<24 hex>`)
    if (!OPERATION.test(String(receipt?.operation ?? ''))) fail(`receipts[${index}].operation is invalid`)
    if (typeof receipt?.resourceId !== 'string' || !receipt.resourceId) fail(`receipts[${index}].resourceId is required`)
    if (receipt?.actorKey !== undefined && !ACTOR_KEY.test(String(receipt.actorKey))) fail(`receipts[${index}].actorKey is invalid`)
  }
  if (kinds.includes('ui') && (!Array.isArray(record.visual) || record.visual.length === 0)) fail('ui records need at least one visual entry')
  for (const [index, visual] of (Array.isArray(record.visual) ? record.visual : []).entries()) {
    if (typeof visual?.path !== 'string' || !visual.path) fail(`visual[${index}].path is required`)
    if (!SHA256.test(String(visual?.sha256 ?? ''))) fail(`visual[${index}].sha256 must be 64 hex`)
  }
  if (kinds.includes('desktop-build')) {
    if (typeof record.desktop?.artifactPath !== 'string' || !record.desktop.artifactPath) fail('desktop-build records need desktop.artifactPath (an archived artifact)')
    if (!SHA256.test(String(record.desktop?.artifactSha256 ?? ''))) fail('desktop-build records need desktop.artifactSha256')
  }
  if ((record.environment === 'local' || record.environment === 'simulated_cloud') &&
      (!Array.isArray(record.commands) || record.commands.length === 0)) {
    fail('local and simulated_cloud records need at least one commands entry')
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(rawText))) fail('record appears to contain a credential or token')
  return errors
}

function isAccepted(record) {
  return typeof record.acceptedBy === 'string' && record.acceptedBy.trim() !== '' &&
    record.acceptedBy.trim() !== String(record.recordedBy ?? '').trim()
}

/**
 * Run every check. Adapters: git {commitExists, isAncestor, commitTime, head},
 * files {sha256(path) -> hex|null}, cloud {imageContractCommit(digest),
 * receipts({database, schema, ids})} or null when offline.
 */
export async function verifyEvidence({ root, checklists, evidenceDir, git, files, cloud }) {
  const errors = []
  const warnings = []
  const head = git.head()

  // Records
  const records = new Map()
  const dir = resolve(root, evidenceDir)
  const fileNames = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : []
  for (const fileName of fileNames) {
    const rawText = readFileSync(join(dir, fileName), 'utf8')
    let record
    try {
      record = JSON.parse(rawText)
    } catch {
      errors.push(`${evidenceDir}/${fileName}: not valid JSON`)
      continue
    }
    const recordErrors = validateRecord(record, fileName, rawText)
    const entry = { record, fileName, errors: recordErrors, cloudVerified: false }
    if (recordErrors.length === 0) await checkRecordAgainstWorld(entry, { root, git, files, cloud, head })
    for (const error of entry.errors) errors.push(`${record?.id ?? fileName}: ${error}`)
    if (entry.errors.length === 0 && !isAccepted(record)) warnings.push(`${record.id}: waiting for acceptance (recordedBy ${record.recordedBy})`)
    if (record?.environment === 'real_cloud' && entry.errors.length === 0 && !cloud) {
      warnings.push(`${record.id}: Cloud checks skipped (offline)`)
    }
    if (typeof record?.id === 'string') records.set(record.id, entry)
  }

  // Checklists
  let checked = 0
  for (const checklist of checklists) {
    const path = resolve(root, checklist)
    if (!existsSync(path)) {
      errors.push(`${checklist}: checklist not found`)
      continue
    }
    for (const item of parseChecklist(checklist, readFileSync(path, 'utf8'))) {
      checked += 1
      const where = `${item.file}:${item.line}`
      const label = item.text.slice(0, 80)
      if (UNFINISHED_WORDING.test(item.text)) errors.push(`${where}: checked item says it is unfinished — "${label}"`)
      if (item.refs.length === 0) {
        errors.push(`${where}: checked item cites no evidence — "${label}"`)
        continue
      }
      const cited = []
      for (const ref of item.refs) {
        const entry = records.get(ref)
        if (!entry) errors.push(`${where}: cites ${ref}, which does not exist`)
        else if (entry.errors.length > 0) errors.push(`${where}: cites ${ref}, which fails verification`)
        else if (!isAccepted(entry.record)) errors.push(`${where}: cites ${ref}, which is not accepted yet`)
        else cited.push(entry)
      }
      if (REAL_CLOUD_CLAIM.test(item.text) &&
          !cited.some((entry) => entry.record.environment === 'real_cloud' && entry.cloudVerified)) {
        errors.push(`${where}: real-cloud claim needs accepted real_cloud evidence verified against the Cloud${cloud ? '' : ' (offline run cannot verify it)'}`)
      }
      if (UI_CLAIM.test(item.text) && !cited.some((entry) => entry.record.kinds.includes('ui'))) {
        errors.push(`${where}: UI claim needs accepted evidence of kind ui (packaged screenshots or recordings)`)
      }
    }
  }

  return { errors, warnings, checked, records: records.size }
}

async function checkRecordAgainstWorld(entry, { root, git, files, cloud, head }) {
  const { record } = entry
  const fail = (message) => entry.errors.push(message)
  if (!git.commitExists(record.sourceCommit)) fail(`sourceCommit ${record.sourceCommit} is not in this repository`)
  else if (!git.isAncestor(record.sourceCommit, head)) fail(`sourceCommit ${record.sourceCommit} is not an ancestor of HEAD`)
  if (record.server?.contractCommit && !git.commitExists(record.server.contractCommit)) {
    fail(`server.contractCommit ${record.server.contractCommit} is not in this repository`)
  }
  for (const visual of record.visual ?? []) {
    const actual = files.sha256(resolvePath(root, visual.path))
    if (actual === null) fail(`visual ${visual.path} is missing`)
    else if (actual !== visual.sha256) fail(`visual ${visual.path} does not match its sha256`)
  }
  if (record.kinds.includes('desktop-build')) {
    const actual = files.sha256(resolvePath(root, record.desktop.artifactPath))
    if (actual === null) fail(`desktop artifact ${record.desktop.artifactPath} is missing`)
    else if (actual !== record.desktop.artifactSha256) fail(`desktop artifact ${record.desktop.artifactPath} does not match its sha256`)
  }
  if (record.environment !== 'real_cloud' || !cloud || entry.errors.length > 0) return

  const label = await cloud.imageContractCommit(record.server.imageDigest)
  if (!label) fail(`image ${record.server.imageDigest} is not present on the Cloud host`)
  else if (!(label.startsWith(record.server.contractCommit) || record.server.contractCommit.startsWith(label))) {
    fail(`image contract-commit label ${label} does not match ${record.server.contractCommit}`)
  }
  const committedAt = git.commitTime(record.sourceCommit)
  const found = new Map((await cloud.receipts({
    database: record.server.database,
    ids: record.receipts.map(({ receiptId }) => receiptId)
  })).map((row) => [row.receiptId, row]))
  for (const receipt of record.receipts) {
    const row = found.get(receipt.receiptId)
    if (!row) {
      fail(`receipt ${receipt.receiptId} does not exist in ${record.server.database}`)
      continue
    }
    if (row.operation !== receipt.operation) fail(`receipt ${receipt.receiptId} operation is ${row.operation}, not ${receipt.operation}`)
    if (row.resourceId !== receipt.resourceId) fail(`receipt ${receipt.receiptId} resource is ${row.resourceId}, not ${receipt.resourceId}`)
    if (receipt.actorKey && row.actorKey !== receipt.actorKey) fail(`receipt ${receipt.receiptId} actor is ${row.actorKey}, not ${receipt.actorKey}`)
    if (committedAt && Date.parse(row.createdAt) < committedAt.getTime()) {
      fail(`receipt ${receipt.receiptId} (${row.createdAt}) predates sourceCommit ${record.sourceCommit.slice(0, 8)}`)
    }
  }
  if (entry.errors.length === 0) entry.cloudVerified = true
}

function resolvePath(root, path) {
  const expanded = path.startsWith('~/') ? join(process.env.HOME ?? '', path.slice(2)) : path
  return isAbsolute(expanded) ? expanded : resolve(root, expanded)
}

export function createGitAdapter(root) {
  const run = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const ok = (args) => {
    try {
      run(args)
      return true
    } catch {
      return false
    }
  }
  return {
    head: () => run(['rev-parse', 'HEAD']),
    commitExists: (sha) => SHA_PREFIX.test(sha) && ok(['cat-file', '-e', `${sha}^{commit}`]),
    isAncestor: (sha, head) => ok(['merge-base', '--is-ancestor', sha, head]),
    commitTime: (sha) => {
      try {
        return new Date(run(['show', '-s', '--format=%cI', sha]))
      } catch {
        return null
      }
    }
  }
}

export const fileAdapter = Object.freeze({
  sha256: (path) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
})

/** Read-only Cloud access over SSH: docker image labels and the receipts table. */
export function createSshCloudAdapter({ sshHost, sshKey, pgContainer = DEFAULT_PG_CONTAINER, schema = DEFAULT_DB_SCHEMA }) {
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/u.test(sshHost)) throw new Error('--ssh-host must look like user@host')
  if (!DOCKER_NAME.test(pgContainer)) throw new Error('--pg-container is not a valid container name')
  if (!SQL_NAME.test(schema)) throw new Error('--db-schema is not a valid schema name')
  const ssh = (remoteCommand, input) => execFileSync('ssh', [
    ...(sshKey ? ['-i', resolvePath(process.cwd(), sshKey)] : []),
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshHost, remoteCommand
  ], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 })
  return {
    imageContractCommit: async (digest) => {
      if (!IMAGE_DIGEST.test(digest)) return null
      try {
        const label = ssh(`docker image inspect --format '{{index .Config.Labels "org.sciforge.release.contract-commit"}}' ${digest}`).trim()
        return label && label !== '<no value>' ? label : null
      } catch {
        return null
      }
    },
    receipts: async ({ database, ids }) => {
      if (!SQL_NAME.test(database)) throw new Error('database name is invalid')
      const safeIds = ids.filter((id) => RECEIPT_ID.test(id))
      if (safeIds.length === 0) return []
      const sql = [
        'SET default_transaction_read_only = on;',
        'BEGIN READ ONLY;',
        `SELECT receipt_id, operation, resource_id, actor_key, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM ${schema}.receipts WHERE receipt_id IN (${safeIds.map((id) => `'${id}'`).join(', ')});`,
        'COMMIT;'
      ].join('\n')
      const output = ssh(`docker exec -i ${pgContainer} sh -c 'psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${database}'`, sql)
      return output.split('\n').map((line) => line.split('|')).filter((fields) => fields.length === 5)
        .map(([receiptId, operation, resourceId, actorKey, createdAt]) => ({ receiptId, operation, resourceId, actorKey, createdAt }))
    }
  }
}

function parseArgs(argv) {
  const options = { checklists: [], offline: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      index += 1
      return next
    }
    if (arg === '--offline') options.offline = true
    else if (arg === '--ssh-host') options.sshHost = value()
    else if (arg === '--ssh-key') options.sshKey = value()
    else if (arg === '--pg-container') options.pgContainer = value()
    else if (arg === '--db-schema') options.schema = value()
    else if (arg === '--checklist') options.checklists.push(value())
    else if (arg === '--evidence-dir') options.evidenceDir = value()
    else if (arg === '--root') options.root = value()
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown option ${arg}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: node scripts/collaboration-evidence-verify.mjs (--ssh-host user@host [--ssh-key path] | --offline)\n' +
      '  [--checklist path]... [--evidence-dir path] [--pg-container name] [--db-schema name] [--root path]\n')
    return 0
  }
  const sshHost = options.sshHost ?? process.env.SCIFORGE_EVIDENCE_SSH_HOST
  if (!options.offline && !sshHost) throw new Error('pass --ssh-host user@host (or SCIFORGE_EVIDENCE_SSH_HOST), or --offline')
  const root = resolve(options.root ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
  const result = await verifyEvidence({
    root,
    checklists: options.checklists.length > 0 ? options.checklists : DEFAULT_CHECKLISTS,
    evidenceDir: options.evidenceDir ?? DEFAULT_EVIDENCE_DIR,
    git: createGitAdapter(root),
    files: fileAdapter,
    cloud: options.offline ? null : createSshCloudAdapter({
      sshHost,
      sshKey: options.sshKey ?? process.env.SCIFORGE_EVIDENCE_SSH_KEY,
      pgContainer: options.pgContainer,
      schema: options.schema
    })
  })
  for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`)
  for (const error of result.errors) process.stdout.write(`error: ${error}\n`)
  process.stdout.write(`${result.checked} checked item(s), ${result.records} evidence record(s), ${result.errors.length} error(s)${options.offline ? ', offline' : ''}\n`)
  return result.errors.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code }, (error) => {
    process.stderr.write(`collaboration-evidence-verify: ${error.message}\n`)
    process.exitCode = 2
  })
}
