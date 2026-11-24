import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WORKSPACE_ATTACHMENT_ACCEPT, workspaceAttachmentKind, workspaceAttachmentMediaType, validateWorkspaceAttachmentBytes } from './attachment-policy.js'

for (const extension of ['py', 'r', 'jl', 'sh', 'bash', 'zsh', 'ps1']) {
  test(`script ${extension} has one inert text policy independent of browser MIME`, () => {
    assert.ok(WORKSPACE_ATTACHMENT_ACCEPT.split(',').includes(`.${extension}`))
    for (const type of ['', 'text/x-python', 'application/octet-stream', 'application/pdf', 'image/png']) {
      const file = { name: `C:\\research\\analysis.${extension.toUpperCase()}`, type }
      assert.equal(workspaceAttachmentKind(file), 'scientific')
      assert.equal(workspaceAttachmentMediaType(file), 'text/plain')
      validateWorkspaceAttachmentBytes(file, new TextEncoder().encode('# 科研\r\nprint(1)\n'))
      for (const bytes of [new Uint8Array([0x7f, 69, 76, 70]), new Uint8Array([77, 90, 0]), new Uint8Array([255])]) {
        assert.throws(() => validateWorkspaceAttachmentBytes(file, bytes), /text|UTF-8/u)
      }
    }
  })
}
test('unknown extensions do not become scientific attachments through text MIME', () => {
  for (const name of ['tool.exe', 'data.bin', 'script.unknown']) {
    assert.equal(workspaceAttachmentKind({ name, type: 'text/plain' }), 'unsupported')
  }
  validateWorkspaceAttachmentBytes({ name: 'data.parquet' }, new Uint8Array([0, 255]))
})
