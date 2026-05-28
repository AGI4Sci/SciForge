import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

const root = process.cwd();
const verifyScript = 'verify:single-agent-final';
const finalGateGuardScript = 'smoke:single-agent-final-gate';
const webMultiturnFinalScript = 'smoke:web-multiturn-final';
const webFinalConformanceScript = 'smoke:web-final-conformance';
const finalEvidenceScript = 'smoke:single-agent-final-evidence';
const runtimeCodexFinalAcceptanceScript = 'smoke:runtime-codex-final-acceptance';
const runtimeProviderPreflightScript = 'smoke:runtime-provider-preflight';
const runtimeCodexBrowserAcceptanceScript = 'smoke:runtime-codex-browser-acceptance';
const runtimeCodexStrictBrowserAcceptanceScript = 'smoke:runtime-codex-browser-acceptance:strict';
const realTaskMatrixScript = 'smoke:real-task-matrix';
const noHardcodedSuccessScript = 'smoke:no-hardcoded-success';
const runtimeCodexTruthSourceScript = 'smoke:runtime-codex-truth-source';
const packageRuntimeBoundaryScript = 'smoke:package-runtime-boundary';
const fixedPlatformBoundaryScript = 'smoke:fixed-platform-boundary';
const realTaskOfflineGatesScript = 'smoke:real-task-offline-gates';
const cuNextReadinessScript = 'smoke:cu-next-readiness';
const cuNextRunnerScript = 'smoke:cu-next-runner';
const cuNextUserAcceptanceContractScript = 'smoke:cu-next-user-acceptance-contract';
const cuNextLiveAcceptanceScript = 'smoke:cu-next-live-acceptance';
const cuNextEvidenceClassificationScript = 'smoke:cu-next-evidence-classification';
const desktopPackageDirScript = 'desktop:package:dir';
const smokeAllScript = 'smoke:all';
const legacyAgentServerCompatScript = 'smoke:legacy-agentserver-compat';
const legacyAgentServerVerifyScript = 'verify:legacy-agentserver-compat';
const releaseVerifyScript = 'verify:single-agent-release';
const webMultiturnFinalCommand = 'tsx tests/smoke/smoke-web-multiturn-final.ts';
const realTaskMatrixCommand = [
  'tsx tests/smoke/smoke-real-task-matrix.ts',
  `npm run ${cuNextReadinessScript}`,
  `npm run ${cuNextRunnerScript}`,
  `npm run ${cuNextUserAcceptanceContractScript}`,
  `npm run ${cuNextLiveAcceptanceScript}`,
  `npm run ${cuNextEvidenceClassificationScript}`,
  `npm run ${realTaskOfflineGatesScript}`,
].join(' && ');
const requiredFinalGateOrder = [
  'typecheck',
  'test',
  'smoke:single-agent-runtime-contract',
  'smoke:no-legacy-paths',
  runtimeCodexTruthSourceScript,
  noHardcodedSuccessScript,
  packageRuntimeBoundaryScript,
  fixedPlatformBoundaryScript,
  runtimeCodexFinalAcceptanceScript,
  runtimeProviderPreflightScript,
  runtimeCodexBrowserAcceptanceScript,
  realTaskMatrixScript,
  finalGateGuardScript,
  webFinalConformanceScript,
  webMultiturnFinalScript,
  finalEvidenceScript,
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

if (scripts[finalEvidenceScript] !== 'tsx tests/smoke/smoke-single-agent-final-evidence.ts') {
  errors.push(`${finalEvidenceScript} must run the final evidence manifest validator`);
}

if (scripts[webFinalConformanceScript] !== 'tsx tests/smoke/smoke-web-final-conformance.ts') {
  errors.push(`${webFinalConformanceScript} must run the Web final conformance smoke`);
}

if (scripts[runtimeCodexFinalAcceptanceScript] !== 'tsx tests/smoke/smoke-runtime-codex-final-acceptance.ts') {
  errors.push(`${runtimeCodexFinalAcceptanceScript} must run the Runtime Codex final acceptance contract smoke`);
}

if (scripts[runtimeProviderPreflightScript] !== 'tsx tests/smoke/smoke-runtime-provider-preflight.ts') {
  errors.push(`${runtimeProviderPreflightScript} must run the provider upstream preflight before browser acceptance`);
}

if (scripts[runtimeCodexBrowserAcceptanceScript] !== 'tsx tests/smoke/smoke-runtime-codex-browser-acceptance.ts') {
  errors.push(`${runtimeCodexBrowserAcceptanceScript} must run the Runtime Codex browser acceptance evidence gate`);
}

if (scripts[runtimeCodexStrictBrowserAcceptanceScript] !== `SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run ${runtimeCodexBrowserAcceptanceScript}`) {
  errors.push(`${runtimeCodexStrictBrowserAcceptanceScript} must enforce SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1`);
}

if (scripts[realTaskMatrixScript] !== realTaskMatrixCommand) {
  errors.push(`${realTaskMatrixScript} must validate PROJECT.md CU-* Computer Use task coverage and run the Computer Use protocol gate`);
}

const realTaskOfflineGateSteps = packageScriptSteps(scripts[realTaskOfflineGatesScript]);
const requiredRealTaskOfflineGates = ['smoke:real-task-protocol-gates'];
assertOrderedSubsequence(realTaskOfflineGateSteps, requiredRealTaskOfflineGates, realTaskOfflineGatesScript, errors);
const directLegacyInRealTaskOfflineGates = realTaskOfflineGateSteps.filter((step) => /\bagentserver\b/i.test(step));
if (directLegacyInRealTaskOfflineGates.length > 0) {
  errors.push(`${realTaskOfflineGatesScript} must not promote AgentServer-first smoke scripts directly: ${directLegacyInRealTaskOfflineGates.join(', ')}`);
}

if (scripts[noHardcodedSuccessScript] !== 'tsx tests/smoke/smoke-no-hardcoded-success.ts') {
  errors.push(`${noHardcodedSuccessScript} must run the release-path hardcoded-success guard`);
}

if (scripts[runtimeCodexTruthSourceScript] !== 'tsx tools/check-runtime-codex-truth-source.ts') {
  errors.push(`${runtimeCodexTruthSourceScript} must guard package/docs truth-source drift`);
}

if (scripts[packageRuntimeBoundaryScript] !== 'tsx tools/check-package-runtime-boundary.ts && npm run smoke:native-extension-ownership') {
  errors.push(`${packageRuntimeBoundaryScript} must enforce package/native-extension ownership in the final gate`);
}

if (scripts[fixedPlatformBoundaryScript] !== 'tsx tools/check-fixed-platform-boundary.ts') {
  errors.push(`${fixedPlatformBoundaryScript} must enforce desktop/platform ownership in the final gate`);
}

const smokeAllSteps = packageScriptSteps(scripts[smokeAllScript]);
if (smokeAllSteps.includes(legacyAgentServerCompatScript)) {
  errors.push(`${smokeAllScript} must not run ${legacyAgentServerCompatScript}; legacy AgentServer checks are explicit opt-in compatibility coverage`);
}
const directLegacyAgentServerSteps = smokeAllSteps.filter(
  (step) => step !== legacyAgentServerCompatScript && /\bagentserver\b/i.test(step),
);
if (directLegacyAgentServerSteps.length > 0) {
  errors.push(`${smokeAllScript} must not promote AgentServer-first smoke scripts directly: ${directLegacyAgentServerSteps.join(', ')}`);
}
if (!scripts[legacyAgentServerCompatScript]?.includes('smoke:agentserver-')) {
  errors.push(`${legacyAgentServerCompatScript} must preserve old AgentServer compatibility coverage while Runtime Codex becomes the release truth source`);
}
if (scripts[legacyAgentServerVerifyScript] !== `npm run ${legacyAgentServerCompatScript}`) {
  errors.push(`${legacyAgentServerVerifyScript} must be the explicit opt-in AgentServer compatibility verifier`);
}

const finalGateSteps = packageScriptSteps(scripts[verifyScript]);
if (finalGateSteps.length === 0) {
  errors.push(`${verifyScript} must be declared as the final single-agent completion gate`);
} else {
  assertOrderedSubsequence(finalGateSteps, requiredFinalGateOrder, verifyScript, errors);
}

const releaseGateSteps = packageScriptSteps(scripts[releaseVerifyScript]);
if (releaseGateSteps.length === 0) {
  errors.push(`${releaseVerifyScript} must be declared as the strict live release gate`);
} else {
  assertOrderedSubsequence(
    releaseGateSteps,
    requiredFinalGateOrder
      .map((step) => step === runtimeCodexBrowserAcceptanceScript ? runtimeCodexStrictBrowserAcceptanceScript : step)
      .flatMap((step) => step === runtimeCodexStrictBrowserAcceptanceScript ? [step, desktopPackageDirScript] : [step]),
    releaseVerifyScript,
    errors,
  );
}

if (errors.length) {
  console.error('[single-agent-final-gate] package script guard failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`[ok] ${verifyScript} wires typecheck, core tests, C01-C18, no-legacy/no-hardcoded source hygiene guards, Runtime Codex truth-source/package/platform ownership gates, Runtime Codex final acceptance, provider upstream preflight, browser acceptance evidence, active CU-* Computer Use task matrix coverage, Web final conformance, browser web-multiturn-final, final evidence validation, strict release fail-fast gating, desktop package release gating, and explicit legacy AgentServer compatibility isolation`);
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
