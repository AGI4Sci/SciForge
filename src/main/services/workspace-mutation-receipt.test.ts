import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { authenticateWorkspaceMutation, workspaceMutationReceipt, copyWorkspaceMutationReceipt, bindWorkspaceMutationIdentity, assertWorkspaceMutationIdentity } from './workspace-mutation-receipt'

describe('Host workspace mutation evidence', () => {
  it('authenticates exact bytes, newline state, and identity without serializing its authority', () => {
    const result = authenticateWorkspaceMutation({ ok: true }, '/work/a.txt', Buffer.from('before\n'), Buffer.from('after'))
    const receipt = workspaceMutationReceipt(result)!
    expect(receipt.patchText).toBe('--- /work/a.txt\n+++ /work/a.txt\n@@ -1,1 +1,1 @@\n-before\n+after\n\\ No newline at end of file\n')
    expect(receipt.beforeSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(workspaceMutationReceipt(JSON.parse(JSON.stringify(result)))).toBeUndefined()
    expect(workspaceMutationReceipt({ ...result, receipt })).toBeUndefined()
    const copied = copyWorkspaceMutationReceipt(result, {})
    bindWorkspaceMutationIdentity(copied, { runtimeId: 'dsh', threadId: 'one', turnId: 'turn' })
    expect(() => assertWorkspaceMutationIdentity(receipt, { runtimeId: 'dsh', threadId: 'two', turnId: 'turn' })).toThrow('identity mismatch')
    expect(() => assertWorkspaceMutationIdentity(receipt, { runtimeId: 'dsh', threadId: 'one', turnId: 'turn' })).not.toThrow()
  })
  it.each([
    ['LF', 'a\nfile.txt', '"/work/a\\nfile.txt"'],
    ['CRLF', 'a\r\nfile.txt', '"/work/a\\r\\nfile.txt"'],
    ['tab', 'a\tfile.txt', '"/work/a\\tfile.txt"'],
    ['quote', 'a"file.txt', '"/work/a\\"file.txt"'],
    ['backslash', 'a\\file.txt', '"/work/a\\\\file.txt"'],
    ['space', 'a file.txt', '"/work/a file.txt"'],
    ['Unicode', '正文😀.txt', '/work/正文😀.txt'],
    ['mixed Unicode', '正文😀\n file.txt', '"/work/正文😀\\n file.txt"'],
    ...Array.from({ length: 32 }, (_, byte) => byte).filter(byte => byte !== 0).concat(127).map(byte => {
      const escapes: Record<number, string> = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' }
      return [`control ${byte}`, `a${String.fromCharCode(byte)}file.txt`, `"/work/a${escapes[byte] ?? `\\${byte.toString(8).padStart(3, '0')}`}file.txt"`]
    })
  ])('encodes %s paths in Git-compatible headers that Git reparses losslessly', (_label, name, header) => {
    const path = `/work/${name}`
    const receipt = workspaceMutationReceipt(authenticateWorkspaceMutation({}, path, Buffer.from('before\r\n'), Buffer.from('after\r\n')))!
    expect(receipt.path).toBe(path)
    expect(receipt.patchText.split('\n').slice(0, 2)).toEqual([`--- ${header}`, `+++ ${header}`])
    // -z avoids Git re-quoting the parsed name; compare the original UTF-8 bytes.
    const parsed = execFileSync('git', ['apply', '--numstat', '-z', '-p0', '--unsafe-paths', '-'], { input: receipt.patchText })
    expect(parsed).toEqual(Buffer.from(`1\t1\t${path}\0`))
  })
  it.each([[Buffer.from('same'), Buffer.from('same')], [Buffer.from([255]), Buffer.from('text')], [Buffer.from('a'), Buffer.from('b\0')], [Buffer.alloc(2 * 1024 * 1024, 97), Buffer.from('b')]])('does not invent a patch for unchanged, binary, invalid or oversized source', (before, after) => {
    expect(workspaceMutationReceipt(authenticateWorkspaceMutation({}, '/work/a', before, after))).toBeUndefined()
  })
})
