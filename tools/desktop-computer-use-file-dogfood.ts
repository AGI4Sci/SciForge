import { resolve } from 'node:path';

import { runDesktopComputerUseFileDogfood } from '../src/runtime/desktop-computer-use-file-dogfood.js';

const outputDir = process.env.SCIFORGE_DESKTOP_COMPUTER_USE_FILE_DOGFOOD_OUTPUT
  ? resolve(process.cwd(), process.env.SCIFORGE_DESKTOP_COMPUTER_USE_FILE_DOGFOOD_OUTPUT)
  : resolve(process.cwd(), 'docs', 'evolve', 'runs', 'desktop-computer-use-file-dogfood');

const manifest = await runDesktopComputerUseFileDogfood({
  outputDir,
});

process.stdout.write(`[${manifest.status}] Desktop Computer Use file dogfood wrote ${outputDir}/manifest.json\n`);
if (manifest.status !== 'passed') process.exitCode = 1;

