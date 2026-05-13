import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

const root = process.cwd();
const requiredSmokeScript = 'smoke:conversation-kernel-final-shape';
const guardScript = 'smoke:final-shape-verify-guard';
const requiredSmokeCommand = 'tsx tests/smoke/smoke-conversation-kernel-final-shape.ts';

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson;
const scripts = pkg.scripts ?? {};
const errors: string[] = [];

if (scripts[requiredSmokeScript] !== requiredSmokeCommand) {
  errors.push(`${requiredSmokeScript} must run "${requiredSmokeCommand}"`);
}

if (!scriptRuns(scripts['smoke:all'], requiredSmokeScript)) {
  errors.push(`smoke:all must include "npm run ${requiredSmokeScript}"`);
}

if (!scriptRuns(scripts['verify:fast'], guardScript)) {
  errors.push(`verify:fast must include "npm run ${guardScript}"`);
}

if (!scriptRuns(scripts.verify, 'verify:fast')) {
  errors.push('verify must continue to run verify:fast');
}

if (errors.length) {
  console.error('[final-shape-smoke-verify] package script guard failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('[ok] final-shape smoke is wired into package verify chain');
}

function scriptRuns(script: string | undefined, target: string): boolean {
  return new RegExp(`(?:^|&&)\\s*npm\\s+run\\s+${escapeRegExp(target)}(?:\\s|&&|$)`).test(script ?? '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
