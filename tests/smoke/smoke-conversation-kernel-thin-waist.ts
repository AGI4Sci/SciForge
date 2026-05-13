import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  text: string;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx']);

const coreFiles = [
  'packages/agent-harness/src/contracts.ts',
  'packages/agent-harness/src/runtime.ts',
  'packages/agent-harness/src/contract-fns.ts',
  'packages/agent-harness/src/hook-fns.ts',
  'packages/agent-harness/src/merge-policy.ts',
  'packages/agent-harness/src/trace.ts',
];

const kernelDir = 'src/runtime/conversation-kernel';

const domainLiteralWords = [
  'paper',
  'literature',
  'omics',
  'protein',
  'molecule',
  'openalex',
  'arxiv',
  'pubmed',
  'biomedical',
  'blast',
  'alignment',
  'genome',
  'cell',
  'prdm9',
  'setd1b',
];

const largeInlineFieldPattern = /\b(?:stdout|stderr|generatedCode|pdfText|reportBody|rawStream|taskFiles|fullText|fileText|largeJson|rawPayload|payloadBody|body|markdown|html|csv)\??\s*:\s*(?:string|unknown|Record<|Array<|readonly\s+|any\b)/i;
const refLikeFieldPattern = /\b(?:Ref|Refs|Digest|Digests|Pointer|Pointers|Size|Mime|Preview|Summary|Summaries)\b/;

const findings: Finding[] = [];
const files = await existingCoreFiles();

for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');
  const lines = source.split(/\r?\n/);
  scanDomainLiteralTypes(rel, source, lines);
  scanLargeInlinePayloadFields(rel, lines);
}

if (findings.length) {
  console.error('[conversation-kernel-thin-waist] boundary findings found');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.rule}`);
    console.error(`  ${finding.text}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[ok] conversation kernel/harness thin waist scan passed across ${files.length} file(s).`);
  if (!files.some((file) => relative(root, file).replaceAll('\\', '/').startsWith(`${kernelDir}/`))) {
    console.log(`[info] ${kernelDir}/ is not present yet; future kernel files will be scanned automatically.`);
  }
}

async function existingCoreFiles() {
  const out: string[] = [];
  for (const rel of coreFiles) {
    const full = join(root, rel);
    if (await exists(full)) out.push(full);
  }
  const kernelRoot = join(root, kernelDir);
  if (await exists(kernelRoot)) out.push(...await collectSourceFiles(kernelRoot));
  return [...new Set(out)].sort();
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectSourceFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) out.push(full);
  }
  return out;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function scanDomainLiteralTypes(file: string, source: string, lines: string[]) {
  const stripped = stripComments(source);
  const typePattern = /(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=\s*([\s\S]*?);/g;
  for (const match of stripped.matchAll(typePattern)) {
    const typeName = match[1] ?? '';
    const body = match[2] ?? '';
    if (typeName === 'HarnessProfileId') continue;
    const domainWord = domainLiteralWords.find((word) => new RegExp(`['"][^'"]*\\b${escapeRegex(word)}\\b[^'"]*['"]`, 'i').test(body));
    if (!domainWord) continue;
    const index = match.index ?? 0;
    const line = lineNumberAt(stripped, index);
    findings.push({
      file,
      line,
      rule: `domain literal "${domainWord}" appears in a thin-waist exported type`,
      text: compact(lines[line - 1] ?? ''),
    });
  }
}

function scanLargeInlinePayloadFields(file: string, lines: string[]) {
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (!largeInlineFieldPattern.test(trimmed)) continue;
    const fieldName = trimmed.split(':')[0] ?? '';
    if (refLikeFieldPattern.test(fieldName)) continue;
    findings.push({
      file,
      line: index + 1,
      rule: 'large payload-shaped field must be carried by ref/digest/checkpoint, not inline contract/event data',
      text: compact(trimmed),
    });
  }
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function compact(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

assert.ok(files.length > 0, 'thin-waist smoke should scan at least one harness/kernel file');
