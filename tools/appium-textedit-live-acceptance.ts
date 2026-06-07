import { resolve } from 'node:path';

import { runAppiumTextEditLiveAcceptance } from '../src/runtime/codex/appium-textedit-live-acceptance.js';

const outputDir = process.env.SCIFORGE_T1_APPIUM_TEXTEDIT_OUTPUT
  ? resolve(process.cwd(), process.env.SCIFORGE_T1_APPIUM_TEXTEDIT_OUTPUT)
  : resolve(process.cwd(), 'docs', 'test-artifacts', 'appium-textedit-live-acceptance');

const manifest = await runAppiumTextEditLiveAcceptance({ outputDir });
process.stdout.write(`[${manifest.status}] Appium/TextEdit live acceptance manifest: ${outputDir}/manifest.json\n`);
if (manifest.status !== 'passed') process.exitCode = 1;
