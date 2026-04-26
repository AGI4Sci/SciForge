import { readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const artifactsDir = resolve('docs', 'test-artifacts');
const outputPath = join(artifactsDir, 'index.html');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const entries = await readdir(artifactsDir).catch(() => []);
const images = (await Promise.all(entries
  .filter((entry) => imageExtensions.has(extname(entry).toLowerCase()))
  .map(async (entry) => {
    const fullPath = join(artifactsDir, entry);
    const info = await stat(fullPath);
    return { entry, size: info.size, updatedAt: info.mtime.toISOString() };
  })))
  .sort((left, right) => left.entry.localeCompare(right.entry));

const generatedAt = new Date().toISOString();
const cards = images.map((image) => `
    <article class="card">
      <a href="./${escapeHtml(image.entry)}"><img src="./${escapeHtml(image.entry)}" alt="${escapeHtml(basename(image.entry, extname(image.entry)))}" loading="lazy" /></a>
      <div>
        <strong>${escapeHtml(image.entry)}</strong>
        <span>${formatBytes(image.size)} · ${escapeHtml(image.updatedAt)}</span>
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
  <main class="grid">
${cards || '    <p>No screenshots found. Run npm run smoke:browser first.</p>'}
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
