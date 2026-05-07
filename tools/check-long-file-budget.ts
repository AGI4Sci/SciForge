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
]);

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

const generatedOrExternalLikeFiles = new Map<string, string>([
  ['packages/skills/catalog.ts', 'generated skill catalog; maintained by tools/generate-skill-catalog.ts'],
]);

async function main() {
  const project = await readFile(join(root, 'PROJECT.md'), 'utf8');
  const files = await collectSourceFiles(root);
  const longFiles = files
    .filter((file) => file.lines >= taskLineThreshold)
    .sort((left, right) => right.lines - left.lines);
  const missing = longFiles.filter((file) => {
    if (generatedOrExternalLikeFiles.has(file.path)) return false;
    return !project.includes(file.path);
  });

  if (missing.length) {
    console.error('[long-file-budget] 以下长文件超过阈值但 PROJECT.md 没有对应拆分任务：');
    for (const file of missing) {
      console.error(`- ${file.path}: ${file.lines} lines`);
    }
    process.exitCode = 1;
    return;
  }

  const warnings = files
    .filter((file) => file.lines >= warningLineThreshold)
    .sort((left, right) => right.lines - left.lines);
  console.log(`[ok] long-file budget checked: ${longFiles.length} files >= ${taskLineThreshold} lines have PROJECT.md coverage or generated-file exemption.`);
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

async function collectSourceFiles(dir: string): Promise<Array<{ path: string; lines: number }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: Array<{ path: string; lines: number }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.sciforge') {
      if (ignoredDirs.has(entry.name)) continue;
    }
    if (ignoredDirs.has(entry.name)) continue;
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
