import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildConversationReferenceDigests } from '../../src/runtime/gateway/conversation-reference-digest.js';

const fixture = JSON.parse(await readFile('tests/fixtures/reference-digest/pdf-extraction-failure-diagnostic.json', 'utf8')) as {
  extractor: string;
  stage: string;
  requiredDiagnosticFields: string[];
  forbiddenDigestTextPatterns: string[];
};
const workspace = await mkdtemp(join(tmpdir(), 'sciforge-pdf-digest-'));
const validPdfPath = join(workspace, 'bounded-source.pdf');
const brokenPdfPath = join(workspace, 'broken-source.pdf');
const repoStyleWorkspaceDir = join(workspace, 'workspace');

await mkdir(repoStyleWorkspaceDir, { recursive: true });
await writeFile(validPdfPath, minimalTextPdf('SciForge bounded PDF fallback extraction works.'), 'latin1');
await writeFile(brokenPdfPath, '%PDF-1.4\n% truncated fixture that should produce diagnostics\n', 'utf8');
await writeFile(join(repoStyleWorkspaceDir, 'prefixed-source.pdf'), minimalTextPdf('Workspace prefix PDF refs resolve from repository roots.'), 'latin1');

const digests = buildConversationReferenceDigests({
  references: ['bounded-source.pdf', 'broken-source.pdf', 'workspace/prefixed-source.pdf'],
  workspaceRoot: workspace,
  options: {
    workspaceRoot: workspace,
    digestCharBudget: 600,
    excerptCharBudget: 160,
    maxReferences: 4,
  },
});

const byPath = Object.fromEntries(digests.map((digest) => [digest.path, digest]));
const valid = byPath['bounded-source.pdf'];
const broken = byPath['broken-source.pdf'];
const prefixed = byPath['workspace/prefixed-source.pdf'];

assert.ok(valid, 'valid PDF digest should be emitted');
assert.ok(broken, 'broken PDF digest should be emitted');
assert.ok(prefixed, 'workspace/ prefixed PDF digest should resolve when the root contains a workspace directory');

if (valid.status === 'ok') {
  assert.equal(valid.sourceType, 'pdf');
  assert.match(valid.digestText, /PDF digest: extracted bounded text/);
  assert.equal(valid.metrics.extractor, fixture.extractor);
  assert.equal(valid.metrics.stage, fixture.stage);
  assert.equal(valid.omitted.rawContent, 'pdf-text-extracted-bounded');
  assert.ok(valid.excerpts.some((excerpt: Record<string, unknown>) => String(excerpt.text || '').includes('SciForge bounded PDF fallback extraction works')));
} else {
  const diagnostic = valid.omitted.diagnostic as Record<string, unknown> | undefined;
  assert.equal(diagnostic?.extractor, 'pdftotext');
  assert.equal(diagnostic?.stage, 'reference-digest.pdf-text-extraction');
  assert.ok(diagnostic?.errorType, 'valid PDF fallback failure must still be classified');
}

assert.equal(broken.status, 'failed');
assert.equal(broken.sourceType, 'pdf');
assert.match(broken.digestText, /PDF digest: text extraction failed/);
for (const pattern of fixture.forbiddenDigestTextPatterns) {
  assert.doesNotMatch(broken.digestText, new RegExp(pattern, 'i'));
}
assert.equal(broken.omitted.rawContent, 'pdf-extraction-failed');

const diagnostic = broken.omitted.diagnostic as Record<string, unknown>;
assert.equal(diagnostic.extractor, fixture.extractor);
assert.equal(diagnostic.stage, fixture.stage);
assert.equal(diagnostic.fileRef, 'file:broken-source.pdf');
for (const field of fixture.requiredDiagnosticFields) {
  assert.ok(diagnostic[field], `PDF extraction diagnostic should include ${field}`);
}
assert.ok(Array.isArray(diagnostic.nextSteps));
assert.ok((diagnostic.nextSteps as unknown[]).length >= 1);
assert.notEqual(prefixed.status, 'unresolved');

console.log('[ok] PDF reference digests preserve bounded extraction fallback and structured failure diagnostics');

function minimalTextPdf(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return body;
}
