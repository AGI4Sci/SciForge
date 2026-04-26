import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const artifactsDir = resolve('docs', 'test-artifacts');
const outputPath = join(artifactsDir, 'index.html');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const entries = await readdir(artifactsDir).catch(() => []);
const deepDir = join(artifactsDir, 'deep-scenarios');
const images = (await Promise.all(entries
  .filter((entry) => imageExtensions.has(extname(entry).toLowerCase()))
  .map(async (entry) => {
    const fullPath = join(artifactsDir, entry);
    const info = await stat(fullPath);
    return { entry, size: info.size, updatedAt: info.mtime.toISOString() };
  })))
  .sort((left, right) => left.entry.localeCompare(right.entry));
const deepScenarios = await readDeepScenarioEntries(deepDir);

const generatedAt = new Date().toISOString();
const cards = images.map((image) => `
    <article class="card">
      <a href="./${escapeHtml(image.entry)}"><img src="./${escapeHtml(image.entry)}" alt="${escapeHtml(basename(image.entry, extname(image.entry)))}" loading="lazy" /></a>
      <div>
        <strong>${escapeHtml(image.entry)}</strong>
        <span>${formatBytes(image.size)} · ${escapeHtml(image.updatedAt)}</span>
      </div>
    </article>`).join('\n');
const deepCards = deepScenarios.map((scenario) => `
    <article class="card deep-card">
      <div>
        <strong>${escapeHtml(scenario.title)}</strong>
        <span>${escapeHtml(scenario.id)} · ${escapeHtml(scenario.status)} · ${escapeHtml(scenario.coverageStage)}</span>
        ${scenario.hasManifest ? `<a href="./deep-scenarios/${escapeHtml(scenario.id)}/${escapeHtml(scenario.manifestFile)}">manifest</a>` : '<span>manifest needed</span>'}
      </div>
    </article>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BioAgent Test Artifacts</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070b12; color: #dbe7f5; }
    body { margin: 0; padding: 28px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 6px 0 0; color: #8ea4bf; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid rgba(111, 132, 160, 0.28); border-radius: 8px; overflow: hidden; background: #101826; }
    .card img { display: block; width: 100%; height: 220px; object-fit: cover; object-position: top left; background: #050812; }
    .card div { display: grid; gap: 4px; padding: 12px; }
    .card strong { font-size: 13px; }
    .card span, time { color: #8ea4bf; font-size: 12px; }
    a { color: #7fc7ff; }
    section { margin-top: 30px; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .deep-card div { min-height: 90px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>BioAgent Test Artifacts</h1>
      <p>Generated screenshot index for browser smoke and visual QA.</p>
    </div>
    <time datetime="${generatedAt}">${generatedAt}</time>
  </header>
  <main>
    <section>
      <h2>Deep Scenario Runs</h2>
      <p><a href="./deep-scenarios/index.html">Open deep artifacts index</a> · <a href="./deep-scenarios/deep-test-report.md">Deep test report</a></p>
      <div class="grid">
${deepCards || '        <p>No deep manifests found. Run npm run verify:deep after adding deep scenario manifests.</p>'}
      </div>
    </section>
    <section>
      <h2>Screenshots</h2>
      <div class="grid">
${cards || '    <p>No screenshots found. Run npm run smoke:browser first.</p>'}
      </div>
    </section>
  </main>
</body>
</html>
`;

await writeFile(outputPath, html);
console.log(`[ok] wrote ${outputPath} with ${images.length} screenshot entries`);

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function readDeepScenarioEntries(rootDir: string) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const scenarios: Array<{ id: string; title: string; status: string; coverageStage: string; hasManifest: boolean; manifestFile: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const manifestRef = await firstExistingPath([
      { path: join(rootDir, entry.name, 'manifest.json'), file: 'manifest.json' },
      { path: join(rootDir, entry.name, 'artifact-manifest.json'), file: 'artifact-manifest.json' },
    ]);
    const text = await readFile(manifestRef.path, 'utf8').catch(() => '');
    if (!text) {
      scenarios.push({
        id: entry.name,
        title: entry.name,
        status: 'missing-manifest',
        coverageStage: 'not-run',
        hasManifest: false,
        manifestFile: 'manifest.json',
      });
      continue;
    }
    try {
      const parsedManifest = JSON.parse(text.replace(/^\uFEFF/, '')) as {
        scenarioId?: string;
        scenario?: string;
        title?: string;
        status?: string;
        coverageStage?: string;
        checks?: Record<string, unknown>;
      };
      scenarios.push({
        id: parsedManifest.scenarioId ?? entry.name,
        title: parsedManifest.title ?? parsedManifest.scenario ?? entry.name,
        status: parsedManifest.status ?? 'unknown',
        coverageStage: parsedManifest.coverageStage ?? inferCoverageStage(parsedManifest),
        hasManifest: true,
        manifestFile: manifestRef.file,
      });
    } catch {
      scenarios.push({
        id: entry.name,
        title: entry.name,
        status: 'invalid-manifest',
        coverageStage: 'unknown',
        hasManifest: true,
        manifestFile: manifestRef.file,
      });
    }
  }
  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}

async function firstExistingPath(paths: Array<{ path: string; file: string }>) {
  for (const path of paths) {
    if (await stat(path.path).then(() => true).catch(() => false)) return path;
  }
  return paths[0];
}

function inferCoverageStage(manifest: { status?: string; checks?: Record<string, unknown> }) {
  if (manifest.status === 'repair-needed-user-model-config') return 'blocked-user-model-config';
  if (manifest.status?.includes('invalidated')) return 'invalidated';
  if (manifest.checks?.validGraphProduced === false) return 'blocked';
  return 'unknown';
}
