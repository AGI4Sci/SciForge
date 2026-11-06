import { createHash, randomUUID } from 'node:crypto'
import { isSensitiveWorkspacePath } from './turn-file-effect-capture'

/** Process-local executor evidence. JSON, model outputs and plugin DTOs cannot mint attachments. */
export type WorkspaceMutationReceipt = Readonly<{
  receiptId: string
  path: string
  beforeSha256: string
  afterSha256: string
  patchText: string
}>
const receipts = new WeakMap<object, WorkspaceMutationReceipt>()
const identities = new WeakMap<WorkspaceMutationReceipt, string>()
export function bindWorkspaceMutationIdentity(value: object, identity: { runtimeId: string; threadId?: string; turnId?: string }): void {
  const receipt = receipts.get(value)
  if (receipt && !identities.has(receipt)) identities.set(receipt, JSON.stringify([identity.runtimeId, identity.threadId, identity.turnId]))
}
export function assertWorkspaceMutationIdentity(receipt: WorkspaceMutationReceipt, identity: { runtimeId: string; threadId?: string; turnId?: string }): void {
  if (identities.get(receipt) !== JSON.stringify([identity.runtimeId, identity.threadId, identity.turnId])) throw new Error('Workspace mutation Session identity mismatch.')
}
export function workspaceMutationReceipt(value: object): WorkspaceMutationReceipt | undefined {
  return receipts.get(value)
}
export function copyWorkspaceMutationReceipt<T extends object>(source: object, target: T): T {
  const receipt = receipts.get(source)
  if (receipt) receipts.set(target, receipt)
  return target
}

/** Git C-style path quoting: keep UTF-8 literal, escape ASCII controls as C/octal (never JSON Unicode escapes). */
function quoteDiffPath(path: string): string {
  const escapes: Record<string, string> = { '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' }
  let quoted = false
  const encoded = Array.from(path, character => {
    const code = character.charCodeAt(0)
    if (code <= 32 || code === 127 || character === '"' || character === '\\') quoted = true
    return escapes[character] ?? (code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, '0')}` : character)
  }).join('')
  return quoted ? `"${encoded}"` : path
}

/** Called only around the canonical Host provider execution, using actual file bytes. */
export function authenticateWorkspaceMutation<T extends object>(target: T, path: string, before: Buffer, after: Buffer): T {
  if (isSensitiveWorkspacePath(path) || before.equals(after) || before.length + after.length > 2 * 1024 * 1024) return target
  const previous = before.toString('utf8')
  const next = after.toString('utf8')
  if (previous.includes('\0') || next.includes('\0') || !Buffer.from(previous).equals(before) || !Buffer.from(next).equals(after)) return target
  const lines = (text: string, prefix: string): string => {
    if (!text) return ''
    const parts = text.split('\n')
    const terminated = parts.pop() === ''
    if (!terminated) parts.push(text.slice(text.lastIndexOf('\n') + 1))
    return parts.map(line => `${prefix}${line}\n`).join('') + (terminated ? '' : '\\ No newline at end of file\n')
  }
  const count = (text: string): number => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
  const oldCount = count(previous)
  const newCount = count(next)
  const quotedPath = quoteDiffPath(path)
  const patchText = `--- ${quotedPath}\n+++ ${quotedPath}\n@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@\n${lines(previous, '-')}${lines(next, '+')}`
  receipts.set(target, Object.freeze({ receiptId: randomUUID(), path,
    beforeSha256: createHash('sha256').update(before).digest('hex'),
    afterSha256: createHash('sha256').update(after).digest('hex'), patchText }))
  return target
}
