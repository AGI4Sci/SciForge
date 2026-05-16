import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

const root = process.cwd();
const verifyScript = 'verify:single-agent-final';
const finalGateGuardScript = 'smoke:single-agent-final-gate';
const webMultiturnFinalScript = 'smoke:web-multiturn-final';
const webMultiturnFinalCommand = 'tsx tests/smoke/smoke-web-multiturn-final.ts';
const requiredFinalGateOrder = [
  'typecheck',
  'test',
  'smoke:single-agent-runtime-contract',
  'smoke:no-legacy-paths',
  webMultiturnFinalScript,
];

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson;
const scripts = pkg.scripts ?? {};
const errors: string[] = [];

if (scripts[webMultiturnFinalScript] !== webMultiturnFinalCommand) {
  errors.push(`${webMultiturnFinalScript} must run "${webMultiturnFinalCommand}"`);
}

if (scripts[finalGateGuardScript] !== 'tsx tests/smoke/smoke-single-agent-final-gate.ts') {
  errors.push(`${finalGateGuardScript} must run this package-script contract guard`);
}

const finalGateSteps = packageScriptSteps(scripts[verifyScript]);
if (finalGateSteps.length === 0) {
  errors.push(`${verifyScript} must be declared as the final single-agent completion gate`);
} else {
  assertOrderedSubsequence(finalGateSteps, requiredFinalGateOrder, verifyScript, errors);
}

if (errors.length) {
  console.error('[single-agent-final-gate] package script guard failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`[ok] ${verifyScript} wires typecheck, core tests, C01-C18, no-legacy guard, and browser web-multiturn-final`);
}

function packageScriptSteps(script: string | undefined): string[] {
  return (script ?? '')
    .split('&&')
    .map((step) => step.trim())
    .map((step) => {
      const match = /^npm\s+run\s+([^\s]+)(?:\s|$)/.exec(step);
      return match?.[1] ?? '';
    })
    .filter(Boolean);
}

function assertOrderedSubsequence(actual: string[], expected: string[], label: string, errors: string[]): void {
  let cursor = 0;
  const matched: string[] = [];
  for (const requiredStep of expected) {
    const foundAt = actual.indexOf(requiredStep, cursor);
    if (foundAt === -1) {
      errors.push(`${label} must include "npm run ${requiredStep}" after ${matched.join(', ') || 'start'}`);
      return;
    }
    matched.push(requiredStep);
    cursor = foundAt + 1;
  }
}
