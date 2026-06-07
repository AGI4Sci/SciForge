import { runRuntimeCodexBrowserOrdinaryChatLocalDogfood } from '../src/runtime/runtime-codex-browser-ordinary-chat-local-dogfood.js';

const manifest = await runRuntimeCodexBrowserOrdinaryChatLocalDogfood({
  workspacePath: process.env.SCIFORGE_WORKSPACE_PATH || process.cwd(),
  configPath: process.env.SCIFORGE_CONFIG_PATH,
  outputDir: process.env.SCIFORGE_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_EVIDENCE_DIR,
  commandText: process.env.SCIFORGE_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_PROMPT,
});

process.stdout.write(`[${manifest.status}] Runtime Codex browser ordinary-chat local dogfood wrote ${
  process.env.SCIFORGE_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_EVIDENCE_DIR
    || 'docs/evolve/runs/runtime-codex-browser-ordinary-chat-local-dogfood'
}/manifest.json\n`);
if (manifest.status !== 'passed') process.exitCode = 1;
