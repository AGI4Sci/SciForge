import { constants, openSync, closeSync, fstatSync, realpathSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { resolve, dirname, isAbsolute } from 'node:path'
import { EvidenceDeltaChain, evidenceDagCanonicalStatusSchema, evidenceDagCommittedSnapshotSchema } from './core.js'
import type { Scope } from './ports.js'
import type { PythonWorkerOptions } from './python-worker.js'

// The finite child is owned until close, including cancellation and timeout.
// Never settle an abort before the actual producer and its pipes have exited.
function ownedReader(executable: string, args: string[], directory: number | undefined, input: unknown, signal?: AbortSignal): Promise<{ stdout: string; pid: number }> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const stdio = directory === undefined ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', directory]
    const child = spawn(executable, args, { stdio: stdio as any, env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, windowsHide: true }) as ChildProcessWithoutNullStreams
    const chunks: Buffer[] = []
    let bytes = 0, failed = false
    const stop = () => { failed = true; child.kill('SIGKILL') }
    const timer = setTimeout(stop, 10_000)
    signal?.addEventListener('abort', stop, { once: true })
    child.on('error', () => { failed = true })
    child.stdin!.on('error', stop)
    child.stdout!.on('data', chunk => { bytes += chunk.length; if (bytes > 70 * 1024 * 1024) stop(); else chunks.push(chunk) })
    child.stderr!.on('data', chunk => { bytes += chunk.length; if (bytes > 70 * 1024 * 1024) stop() })
    child.on('close', (code, killed) => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop)
      if (failed || signal?.aborted || code !== 0 || killed || !child.pid) reject(new Error('Evidence descriptor reader failed: trusted committed snapshot read failed'))
      else resolve({ stdout: Buffer.concat(chunks).toString('utf8'), pid: child.pid })
    })
    child.stdin!.end(JSON.stringify(input))
    if (signal?.aborted) stop()
  })
}

export async function readCommittedSnapshot(options: PythonWorkerOptions, interpreter: string | undefined, threadId: string, digest: string, signal?: AbortSignal) {
  if (!interpreter || !isAbsolute(interpreter)) throw new Error('trusted storageInterpreter is required')
  if (createHash('sha256').update(readFileSync(options.wheelPath)).digest('hex') !== options.wheelSha256) throw new Error('Evidence worker wheel integrity mismatch')
  const requestId = randomUUID()
  const windows = process.platform === 'win32'
  const directory = windows ? undefined : openDirectory(options.storageRoot)
  try {
    const result = await ownedReader(interpreter, ['-I', '-B', '-c', 'import sys; sys.path.insert(0,sys.argv[1]); from evidence_dag.committed_reader import main; main()', options.wheelPath], directory, { requestId, parent: process.pid, threadId, digest, ...(windows ? { storageRoot: resolve(options.storageRoot) } : {}) }, signal)
    // Child failures contain graph/parser details; never echo them across the capability boundary.

    const response = JSON.parse(result.stdout)
    if (response.requestId !== requestId || response.parent !== process.pid ||
        (process.platform !== 'win32' && response.pid !== result.pid) ||
        !Number.isInteger(response.pid) || !response.snapshot || !response.graph) throw new Error('invalid committed snapshot response')
    return response
  } finally { if (directory !== undefined) closeSync(directory) }
}

// Finite stdlib child: fd 3 is the captured directory, never a reopened pathname.
// No Engine, DeltaStore, mkdir, chmod or mutable snapshot load is involved.
function openDirectory(path: string): number {
  const root = resolve(path)
  if (realpathSync(root) !== root || realpathSync(dirname(root)) !== dirname(root)) throw new Error('Evidence storage ancestor must not be a symlink.')
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | (process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW))
  const info = fstatSync(fd)
  if (!info.isDirectory() || info.uid !== process.getuid?.()) { closeSync(fd); throw new Error('Evidence storage directory is not owned.') }
  return fd
}
const readDescriptor = `import os,sys,json,stat
request=json.load(sys.stdin)
assert request['parent']==os.getppid()
assert stat.S_ISDIR(os.fstat(3).st_mode)
def read():
 # Walk from a captured filesystem root, retaining each parent until the next
 # openat completes. Missing components mean empty; symlinks (even dangling),
 # nondirectories and permission failures never do. No pathname is reopened.
 directory=os.dup(3)
 try:
  for part in request['parts']:
   assert part not in ('','.', '..') and '/' not in part
   try:
    child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
   except FileNotFoundError:
    return None
   os.close(directory)
   directory=child
  d=os.fstat(directory)
  assert stat.S_ISDIR(d.st_mode) and d.st_uid==os.getuid()
  try:
   f=os.open('deltas.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
  except FileNotFoundError:
   return None
  try:
   s=os.fstat(f)
   assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.getuid()
   assert s.st_size<=67108864
   with os.fdopen(f,'r',encoding='utf-8',closefd=False) as stream: text=stream.read(67108865)
   assert len(text.encode('utf-8'))<=67108864
   return text
  finally: os.close(f)
 finally: os.close(directory)
text=read()
json.dump({'id':request['id'],'parent':request['parent'],'pid':os.getpid(),'text':text},sys.stdout)
`

export async function readCommittedChain(storageRoot: string, interpreter: string, scope: Scope, signal?: AbortSignal, wheelPath?: string): Promise<EvidenceDeltaChain> {
  if (!interpreter || !isAbsolute(interpreter)) throw new Error('Trusted Evidence storage interpreter is required.')
  signal?.throwIfAborted()
  const windows = process.platform === 'win32'
  if (windows && (!wheelPath || !isAbsolute(wheelPath))) throw new Error('Trusted Evidence worker wheel is required for Windows committed reads.')
  // Only the filesystem root is opened by pathname. All storage components
  // are opened no-follow relative to retained descriptors in the finite child.
  const fd = windows ? undefined : openSync('/', constants.O_RDONLY | constants.O_DIRECTORY)
  let text: string | null
  try {
    const id = randomUUID()
    const child = windows
      ? await ownedReader(interpreter, ['-I', '-B', '-c', 'import sys; sys.path.insert(0,sys.argv[1]); from evidence_dag.committed_reader import read_chain; read_chain()', resolve(wheelPath ?? '')], undefined, { id, parent: process.pid, storageRoot: resolve(storageRoot) }, signal)
      : await ownedReader(interpreter, ['-I', '-B', '-c', readDescriptor], fd, { id, parent: process.pid, parts: resolve(storageRoot).split('/').filter(Boolean) }, signal)
    const response = JSON.parse(child.stdout)
    if (response.id !== id || response.parent !== process.pid ||
        (process.platform !== 'win32' && response.pid !== child.pid) ||
        !Number.isInteger(response.pid) || (response.text !== null && typeof response.text !== 'string')) throw new Error('Evidence descriptor reader identity mismatch.')
    text = response.text
  } finally { if (fd !== undefined) closeSync(fd) }
  const threadId = `${scope.runtimeId}:${scope.threadId}`
  if (text === null) return new EvidenceDeltaChain(threadId)
  const value = JSON.parse(text)
  if (value?.version !== 1 || !Array.isArray(value.chains)) throw new Error('Unsupported Evidence delta format.')
  const entries = value.chains.filter((entry: any) => entry?.threadId === threadId)
  if (entries.length > 1) throw new Error('Duplicate Evidence chain.')
  if (!entries.length) return new EvidenceDeltaChain(threadId)
  const entry = entries[0]
  if (!Array.isArray(entry.records)) throw new Error('Invalid Evidence records.')
  for (const record of entry.records) {
    if (record.scope?.runtimeId !== scope.runtimeId || record.scope?.workspaceRoot !== scope.workspaceRoot || record.scope?.threadId !== threadId) throw new Error('Evidence persisted scope mismatch.')
  }
  // Canonical constructor validates all immutable digests and complete closure bindings.
  return new EvidenceDeltaChain(threadId, entry.records, entry)
}

// Provisional claims are a mixed derived read: no partial projection may be
// paired with canonical head/fingerprint identities. Check every raw payload,
// including disconnected registry components, as well as the cached lastGood.
// Accept only explicit known public/workspace policies; unknown policy shapes
// fail closed (these reads do not carry an ACL evaluator).
function assertUnrestricted(value: unknown): void {
  const publicLevels = new Set(['public', 'open', 'unrestricted', 'workspace'])
  const publicPolicy = (policy: unknown): boolean => {
    if (policy === null || policy === undefined || policy === '') return true
    if (typeof policy === 'string') return publicLevels.has(policy.trim().toLowerCase())
    if (Array.isArray(policy)) return policy.length === 0
    if (typeof policy !== 'object') return false
    const entries = Object.entries(policy)
    if (!entries.length) return true
    // Shared Artifact Versions policy: principals are not an ACL for a public
    // or workspace visibility; allowExport is independent from read authority.
    if (entries.length === 3 && ['visibility', 'principals', 'allowExport'].every(key => Object.hasOwn(policy, key))) {
      const p = policy as Record<string, unknown>
      return (p.visibility === 'workspace' || p.visibility === 'public') && Array.isArray(p.principals) && p.principals.every(item => typeof item === 'string' && item.trim()) && typeof p.allowExport === 'boolean'
    }
    const normalized = entries.map(([key, item]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), item] as const)
    if (new Set(normalized.map(([key]) => key)).size !== entries.length) return false
    let explicit = false
    for (const [key, item] of normalized) {
      if (['level', 'visibility', 'classification', 'sensitivity', 'accesslevel'].includes(key)) {
        if (typeof item !== 'string' || !publicLevels.has(item.trim().toLowerCase())) return false
        explicit = true
      } else if (['public', 'authorized'].includes(key)) {
        if (item !== true) return false
        explicit = true
      } else if (['restricted', 'redacted', 'denied'].includes(key)) {
        if (item !== false) return false
      } else if (key === 'read') {
        if (item === true) explicit = true
        else if (item && typeof item === 'object' && !Array.isArray(item)) {
          const read = Object.entries(item).map(([name, allowed]) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), allowed] as const)
          if (!read.length || new Set(read.map(([name]) => name)).size !== read.length || read.some(([name, allowed]) => !['allowed', 'granted', 'authorized', 'public'].includes(name) || allowed !== true)) return false
          explicit = true
        } else return false
      } else return false
    }
    return explicit
  }
  const visit = (item: unknown, path: string[] = []): void => {
    if (Array.isArray(item)) { item.forEach((child, index) => visit(child, [...path, String(index)])); return }
    if (!item || typeof item !== 'object') return
    const rootKey = path.find(key => !/^\d+$/u.test(key))
    for (const [key, child] of Object.entries(item)) {
      // `inputShape` is a DTO/schema field only in the persisted trace input.
      // Canonical claims/graph records remain fully traversed: otherwise a
      // private policy nested under a forged canonical claim could be hidden.
      if (key === 'inputShape' && rootKey === 'trace') continue
      // `scope` is an Evidence graph field only under graph metadata. Tool
      // result text and input schemas also use that word, but are not an ACL
      // source. Keep malformed graph metadata fail-closed without classifying
      // an unrelated DTO/schema projection as restricted Evidence.
      if ((key === 'scope' && path.at(-1) === 'meta' && child !== null && (typeof child !== 'object' || Array.isArray(child))) ||
          ((key === 'accessPolicy' || key === 'access_policy') && !publicPolicy(child)) ||
          (key === 'availability' && !['available', 'moved', 'remote', 'missing'].includes(child as string)) ||
          (key === 'accessRestricted' && child !== false)) throw new Error('Canonical Evidence status is unavailable for restricted evidence.')
      visit(child, [...path, key])
    }
  }
  visit(value)
}

export async function committedStatus(chain: EvidenceDeltaChain, scope: Scope, readSnapshot: (digest: string) => Promise<any>) {
  const committed = chain.committedEvidenceSnapshot
  if (committed) {
    if (!/^sha256:[0-9a-f]{64}$/.test(committed.digest)) throw new Error('Invalid exact Snapshot digest.')
    const result = await readSnapshot(committed.digest)
    const raw = result?.snapshot
    if (!raw || raw.digest !== committed.digest) throw new Error('Evidence exact Snapshot digest mismatch.')
    if (result.graph?.meta?.scope?.workspaceRoot !== scope.workspaceRoot) throw new Error('Evidence immutable Snapshot workspace mismatch.')
    const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).map(key => [key, raw[key]])))
    for (const key of Object.keys(evidenceDagCommittedSnapshotSchema.shape)) {
      if (JSON.stringify(snapshot[key as keyof typeof snapshot]) !== JSON.stringify(committed[key as keyof typeof committed])) throw new Error('Evidence committed Snapshot metadata mismatch.')
    }
    if (snapshot.threadId !== `${scope.runtimeId}:${scope.threadId}`) throw new Error('Evidence Snapshot thread mismatch.')
  }
  const head = chain.head, provisional = chain.provisionalView, summary = provisional?.summary
  if (provisional) {
    assertUnrestricted(chain.list().map(record => record.payload))
    assertUnrestricted(provisional)
  }
  return evidenceDagCanonicalStatusSchema.parse({ committed, pending: null, updatedAt: [head.updatedAt, provisional?.updatedAt, committed?.createdAt].filter(Boolean).sort().at(-1) ?? new Date(0).toISOString(), authoritativeHead: head, provisional,
    desiredHeadDigest: summary?.desiredHeadDigest ?? head.headDigest, appliedHeadDigest: summary?.appliedHeadDigest ?? null, freshness: summary?.freshness ?? 'unknown', coverage: summary?.coverage ?? { complete: false, gapCount: 0 }, materialRiskCount: summary?.materialRiskCount ?? 0, lastSuccessAt: summary?.lastSuccessAt ?? null, failure: null })
}
