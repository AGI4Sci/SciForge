import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const warningLineThreshold = 1000;
const taskLineThreshold = 1500;

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ui',
  'build',
  'coverage',
  '.codex-runtime',
  '.sciforge',
  '.tmp',
  'workspace',
]);

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const trackingDocs = [
  'PROJECT.md',
  'docs/RuntimeLegacyCleanup-20260519.md',
];

const generatedOrExternalLikeFiles = new Map<string, string>([
  ['packages/skills/catalog.ts', 'generated skill catalog; maintained by tools/generate-skill-catalog.ts'],
]);

async function main() {
  const trackingText = await readTrackingDocs();
  const files = await collectSourceFiles(root);
  const longFiles = files
    .filter((file) => file.lines >= taskLineThreshold)
    .sort((left, right) => right.lines - left.lines);
  const missing = longFiles.filter((file) => {
    if (generatedOrExternalLikeFiles.has(file.path)) return false;
    return !trackingText.includes(file.path);
  });

  if (missing.length) {
    console.error(`[long-file-budget] 以下长文件超过阈值但 ${trackingDocs.join(' or ')} 没有对应拆分任务：`);
    for (const file of missing) {
      console.error(`- ${file.path}: ${file.lines} lines`);
    }
    process.exitCode = 1;
    return;
  }

  const warnings = files
    .filter((file) => file.lines >= warningLineThreshold)
    .sort((left, right) => right.lines - left.lines);
  console.log(`[ok] long-file budget checked: ${longFiles.length} files >= ${taskLineThreshold} lines have tracked split-task coverage or generated-file exemption.`);
  console.log(`[info] files >= ${warningLineThreshold} lines:`);
  for (const file of warnings) {
    const exemption = generatedOrExternalLikeFiles.get(file.path);
    const status = file.lines >= taskLineThreshold
      ? exemption
        ? `generated: ${exemption}`
        : 'tracked'
      : 'watch';
    console.log(`- ${file.path}: ${file.lines} lines (${status})`);
  }
}

async function readTrackingDocs() {
  const chunks = await Promise.all(trackingDocs.map(async (docPath) => readFile(join(root, docPath), 'utf8').catch(() => '')));
  return chunks.join('\n');
}

async function collectSourceFiles(dir: string): Promise<Array<{ path: string; lines: number }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: Array<{ path: string; lines: number }> = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectSourceFiles(full));
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(extension(entry.name))) continue;
    const stats = await stat(full);
    if (!stats.size) continue;
    const text = await readFile(full, 'utf8');
    out.push({
      path: relative(root, full).replaceAll('\\', '/'),
      lines: text.split('\n').length,
    });
  }
  return out;
}

function extension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

await main();
