import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root = '.cache/visual-acceptance'
const evidence = JSON.parse(await readFile(`${root}/agent-turn-evidence.json`, 'utf8'))
const results = evidence.page.payload.turns.flatMap(t => t.items).filter(i => i.kind === 'tool' && i.summary === 'mcp__sciforge_runtime_tools__sciforge_invoke').flatMap(i => { try { return [JSON.parse(i.detail)] } catch { return [] } })
const documentId = process.env.SCIFORGE_VERIFY_DOCUMENT_ID ?? 'scientific-visual-final-80991aad'
const read = results.findLast(r => r.capabilityId === 'visual-review.read-document' && r.output?.document?.documentId === documentId)
assert.equal(read?.output.ok, true)
const storedDoc = JSON.parse(await readFile(`${root}/workspace/.sciforge/visual-documents/${documentId}/document.json`, 'utf8'))
assert.equal(storedDoc.artifact.sourceHash, read.output.document.artifact.sourceHash)
const doc = storedDoc
const ref = doc.artifact.versionRef
assert.ok(ref?.versionId.startsWith('artifact-version:'))
const bytes = await readFile(doc.artifact.sourcePath)
const digest = createHash('sha256').update(bytes).digest('hex')
assert.equal(digest, ref.contentDigest)
assert.equal(digest, doc.artifact.sourceHash)
assert.equal(bytes.length, ref.byteLength)
assert.equal(createHash('sha256').update(await readFile(doc.artifact.workingCopyPath)).digest('hex'), digest)
assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10])
assert.equal(doc.acceptedRevisionId, null)
if (process.env.SCIFORGE_VERIFY_ANNOTATION) assert.ok(JSON.stringify(doc.annotations).includes(process.env.SCIFORGE_VERIFY_ANNOTATION), 'review annotation must persist in read-document')
const manifest = JSON.parse(await readFile(doc.artifact.manifestPath, 'utf8'))
assert.ok(JSON.stringify(manifest).includes(ref.versionId), 'render manifest must contain the same formal version')
const summary = { runtimeId: 'dsh', threadId: evidence.thread.id, turns: evidence.page.payload.turns.map(t => t.id), documentId: doc.documentId, png: doc.artifact.sourcePath, bytes: bytes.length, sha256: digest, versionRef: ref, manifestPath: doc.artifact.manifestPath, accepted: false, verified: true }
await writeFile(`${root}/verified-result.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
