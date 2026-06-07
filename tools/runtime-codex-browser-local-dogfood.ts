import { runRuntimeCodexBrowserLocalDogfood } from '../src/runtime/runtime-codex-browser-local-dogfood.js';

const manifest = await runRuntimeCodexBrowserLocalDogfood({
  workspacePath: process.env.SCIFORGE_WORKSPACE_PATH || process.cwd(),
  configPath: process.env.SCIFORGE_CONFIG_PATH,
  outputDir: process.env.SCIFORGE_BROWSER_LOCAL_DOGFOOD_EVIDENCE_DIR,
});

console.log(`[${manifest.status}] Runtime Codex browser local dogfood wrote ${process.env.SCIFORGE_BROWSER_LOCAL_DOGFOOD_EVIDENCE_DIR || 'docs/evolve/runs/runtime-codex-browser-local-dogfood'}/manifest.json`);
if (manifest.status !== 'passed') {
  process.exitCode = 1;
}
