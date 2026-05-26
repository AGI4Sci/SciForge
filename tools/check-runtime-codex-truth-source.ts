import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CURRENT_PROJECT_WEB_E2E_COVERAGE } from '../tests/smoke/web-e2e/case-tags.js';

type PackageJson = {
  scripts?: Record<string, string>;
};

type Finding = {
  file: string;
  rule: string;
  message: string;
  value?: string;
};

const root = process.cwd();
const packageJsonPath = join(root, 'package.json');
const projectPath = join(root, 'PROJECT.md');
const usagePath = join(root, 'docs', 'Usage.md');
const migrationPath = join(root, 'packages', 'backend', 'CodexRuntimeMigration.md');
const realTaskMatrixPath = join(root, 'tests', 'smoke', 'smoke-real-task-matrix.ts');
const currentWebE2eCaseFileByTag: Record<string, string> = {
  'SA-WEB-13': 'tests/smoke/web-e2e/cases/direct-context-gate.ts',
  'SA-WEB-19': 'tests/smoke/web-e2e/cases/large-file-diagnostics.ts',
  'SA-WEB-20': 'tests/smoke/web-e2e/cases/longitudinal-messy-csv.ts',
  'SA-WEB-21': 'tests/smoke/web-e2e/cases/schema-drift-confounder.ts',
  'SA-WEB-22': 'tests/smoke/web-e2e/cases/two-table-lineage.ts',
  'SA-WEB-23': 'tests/smoke/web-e2e/cases/gui-resource-probing.ts',
  'SA-WEB-24': 'tests/smoke/web-e2e/cases/gui-ask-user-clarification.ts',
  'SA-WEB-28': 'tests/smoke/web-e2e/cases/gui-action-command-trace.ts',
  'SA-WEB-29': 'tests/smoke/web-e2e/cases/native-session-artifact-followup.ts',
  'SA-WEB-30': 'tests/smoke/web-e2e/cases/long-context-constraint-stability.ts',
  'SA-WEB-31': 'tests/smoke/web-e2e/cases/literature-current-and-selected-report.ts',
  'SA-WEB-32': 'tests/smoke/web-e2e/cases/literature-evidence-conflict.ts',
  'SA-WEB-33': 'tests/smoke/web-e2e/cases/code-repair-collaboration.ts',
  'SA-WEB-34': 'tests/smoke/web-e2e/cases/code-repair-collaboration.ts',
  'SA-WEB-35': 'tests/smoke/web-e2e/cases/scientific-reviewer-verifier-loop.ts',
  'SA-WEB-36': 'tests/smoke/web-e2e/cases/capability-skill-computer-use-boundaries.ts',
  'SA-WEB-37': 'tests/smoke/web-e2e/cases/run-resume-lifecycle-recovery.ts',
  'SA-WEB-38': 'tests/smoke/web-e2e/cases/provider-security-budget-audit-fixture.ts',
  'SA-WEB-39': 'tests/smoke/web-e2e/case-tags.ts',
  'SA-WEB-40': 'tests/smoke/web-e2e/case-tags.ts',
  'SA-WEB-41': 'tests/smoke/web-e2e/case-tags.ts',
};
const additionalRuntimeSemanticTags = ['SA-WEB-13'];

const strictBrowserScript = 'smoke:runtime-codex-browser-acceptance:strict';
const browserScript = 'smoke:runtime-codex-browser-acceptance';
const truthSourceScript = 'smoke:runtime-codex-truth-source';
const packageRuntimeBoundaryScript = 'smoke:package-runtime-boundary';
const realTaskMatrixScript = 'smoke:real-task-matrix';
const realTaskOfflineGatesScript = 'smoke:real-task-offline-gates';
const cuNextReadinessScript = 'smoke:cu-next-readiness';
const cuNextRunnerScript = 'smoke:cu-next-runner';
const cuNextUserAcceptanceContractScript = 'smoke:cu-next-user-acceptance-contract';
const legacyCompatScript = 'smoke:legacy-agentserver-compat';
const legacyVerifyScript = 'verify:legacy-agentserver-compat';
const finalVerifyScript = 'verify:single-agent-final';
const releaseVerifyScript = 'verify:single-agent-release';
const realTaskMatrixCommand = [
  'tsx tests/smoke/smoke-real-task-matrix.ts',
  `npm run ${cuNextReadinessScript}`,
  `npm run ${cuNextRunnerScript}`,
  `npm run ${cuNextUserAcceptanceContractScript}`,
  `npm run ${realTaskOfflineGatesScript}`,
].join(' && ');

const findings: Finding[] = [];

const pkgText = await readFile(packageJsonPath, 'utf8');
const pkg = JSON.parse(pkgText) as PackageJson;
const scripts = pkg.scripts ?? {};

assertScriptEquals(
  browserScript,
  'tsx tests/smoke/smoke-runtime-codex-browser-acceptance.ts',
  'Runtime Codex browser acceptance must stay the shared evidence writer.',
);
assertScriptEquals(
  strictBrowserScript,
  `SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run ${browserScript}`,
  'Strict release browser acceptance must reject blocked/partial/failed evidence.',
);
assertScriptEquals(
  truthSourceScript,
  'tsx tools/check-runtime-codex-truth-source.ts',
  'Package/docs truth-source drift must stay gateable.',
);
assertScriptEquals(
  realTaskMatrixScript,
  realTaskMatrixCommand,
  'Computer Use task matrix must execute the active CU-* project-board gate plus CU-NEXT readiness, runner, acceptance-contract, and protocol gates.',
);
assertScriptEquals(
  legacyVerifyScript,
  `npm run ${legacyCompatScript}`,
  'AgentServer compatibility checks must be explicit opt-in quarantine coverage.',
);

const smokeAllSteps = packageScriptSteps(scripts['smoke:all']);
const directAgentServerInSmokeAll = smokeAllSteps.filter((step) => /\bagentserver\b/i.test(step));
if (directAgentServerInSmokeAll.length > 0) {
  findings.push({
    file: 'package.json',
    rule: 'smoke-all-agentserver-truth-source',
    message: 'smoke:all must not run AgentServer-first scripts directly or through the legacy compatibility bucket.',
    value: directAgentServerInSmokeAll.join(', '),
  });
}
assertNoNestedAgentServerDefaultPath('smoke:all');

const legacyCompatSteps = packageScriptSteps(scripts[legacyCompatScript]);
if (legacyCompatSteps.length === 0 || !legacyCompatSteps.every((step) => /\bagentserver\b/i.test(step))) {
  findings.push({
    file: 'package.json',
    rule: 'legacy-agentserver-compat-quarantine',
    message: 'smoke:legacy-agentserver-compat must be the explicit bucket for old AgentServer smoke scripts.',
    value: scripts[legacyCompatScript],
  });
}
const realTaskOfflineGateSteps = packageScriptSteps(scripts[realTaskOfflineGatesScript]);
const requiredRealTaskOfflineGates = [
  'smoke:real-task-protocol-gates',
];
for (const requiredGate of requiredRealTaskOfflineGates) {
  if (realTaskOfflineGateSteps.includes(requiredGate)) continue;
  findings.push({
    file: 'package.json',
    rule: 'real-task-offline-gates',
    message: `smoke:real-task-offline-gates must run ${requiredGate}.`,
    value: scripts[realTaskOfflineGatesScript],
  });
}
const directLegacyInRealTaskOfflineGates = realTaskOfflineGateSteps.filter((step) => /\bagentserver\b/i.test(step));
if (directLegacyInRealTaskOfflineGates.length > 0) {
  findings.push({
    file: 'package.json',
    rule: 'real-task-offline-gates-agentserver-truth-source',
    message: 'smoke:real-task-offline-gates must not promote AgentServer-first smoke scripts directly.',
    value: directLegacyInRealTaskOfflineGates.join(', '),
  });
}
assertNoNestedAgentServerDefaultPath(realTaskOfflineGatesScript);

assertOrderedSubsequence(
  finalVerifyScript,
  [truthSourceScript, packageRuntimeBoundaryScript, browserScript, 'smoke:real-task-matrix'],
);
assertOrderedSubsequence(
  releaseVerifyScript,
  [truthSourceScript, packageRuntimeBoundaryScript, strictBrowserScript, 'smoke:real-task-matrix'],
);

const docs = [
  ['PROJECT.md', await readFile(projectPath, 'utf8')] as const,
  ['docs/Usage.md', await readFile(usagePath, 'utf8')] as const,
  ['packages/backend/CodexRuntimeMigration.md', await readFile(migrationPath, 'utf8')] as const,
];
const realTaskMatrixText = await readFile(realTaskMatrixPath, 'utf8');

if (/['"]smoke:agentserver-/i.test(realTaskMatrixText)) {
  findings.push({
    file: 'tests/smoke/smoke-real-task-matrix.ts',
    rule: 'real-task-matrix-agentserver-truth-source',
    message: 'PROJECT.md CU-* task gates must not depend on direct AgentServer-first smoke scripts; keep legacy checks in verify:legacy-agentserver-compat only.',
  });
}

for (const [file, text] of docs) {
  if (!/SCIFORGE_RUNTIME_API_KEY/.test(text) || !/SCIFORGE_PROXY_UPSTREAM_BASE_URL|upstream base URL|upstreamBaseUrl/.test(text)) {
    findings.push({
      file,
      rule: 'runtime-codex-config-docs',
      message: 'Runtime Codex docs must mention both the API key and provider proxy upstream requirement.',
    });
  }
  if (/LEGACY-CLEANUP-20260519/.test(text)) {
    findings.push({
      file,
      rule: 'stale-legacy-cleanup-label',
      message: 'Docs must not point to the removed LEGACY-CLEANUP-20260519 task label.',
    });
  }
}

const usageText = docs.find(([file]) => file === 'docs/Usage.md')?.[1] ?? '';
const migrationText = docs.find(([file]) => file === 'packages/backend/CodexRuntimeMigration.md')?.[1] ?? '';
for (const [file, text] of [
  ['docs/Usage.md', usageText],
  ['packages/backend/CodexRuntimeMigration.md', migrationText],
] as const) {
  if (!new RegExp(strictBrowserScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text)
    && !/SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance/.test(text)) {
    findings.push({
      file,
      rule: 'strict-browser-release-docs',
      message: 'Release docs must show the strict Runtime Codex browser acceptance gate.',
    });
  }
}

await assertCurrentWebE2eRuntimeSemantics();

if (findings.length) {
  console.error('[runtime-codex-truth-source] drift found');
  for (const finding of findings) {
    console.error(`- ${finding.file}`);
    console.error(`  ${finding.rule}: ${finding.message}`);
    if (finding.value) console.error(`  value: ${finding.value}`);
  }
  process.exitCode = 1;
} else {
  console.log('[ok] Runtime Codex truth-source gate checked package scripts and docs; AgentServer compatibility is explicit opt-in only.');
}

async function assertCurrentWebE2eRuntimeSemantics(): Promise<void> {
  const currentTags = uniqueStrings([
    ...CURRENT_PROJECT_WEB_E2E_COVERAGE.flatMap((mapping) => mapping.saWebTags),
    ...additionalRuntimeSemanticTags,
  ]);
  for (const tag of currentTags) {
    const file = currentWebE2eCaseFileByTag[tag];
    if (!file) {
      findings.push({
        file: 'tools/check-runtime-codex-truth-source.ts',
        rule: 'current-web-e2e-case-file-map',
        message: `${tag} is current PROJECT.md coverage and must be included in the Runtime Codex semantic source guard.`,
      });
      continue;
    }
    const text = await readFile(join(root, file), 'utf8');
    if (/\bsource\s*:\s*['"]agentserver['"]/i.test(text)) {
      findings.push({
        file,
        rule: 'current-web-e2e-agentserver-display-source',
        message: `${tag} is current PROJECT.md coverage; projection/display payload source must use Runtime Codex/runtime-dispatch semantics, not AgentServer.`,
      });
    }
    if (/\bactor\s*:\s*['"]AgentServer/i.test(text)) {
      findings.push({
        file,
        rule: 'current-web-e2e-agentserver-actor',
        message: `${tag} is current PROJECT.md coverage; timeline actors must use Runtime Codex/runtime-dispatch semantics, not AgentServer.`,
      });
    }
    if (/raw AgentServer requests/i.test(text)) {
      findings.push({
        file,
        rule: 'current-web-e2e-agentserver-assertion-text',
        message: `${tag} is current PROJECT.md coverage; assertion text must describe runtime-dispatch requests instead of AgentServer requests.`,
      });
    }
    if (/route-to-agentserver|agentserver:\/\/|agentserver\./i.test(text)) {
      findings.push({
        file,
        rule: 'current-web-e2e-agentserver-visible-route',
        message: `${tag} is current PROJECT.md coverage; fixture-visible routes and refs must use runtime-dispatch or offline fixture semantics, not AgentServer routing.`,
      });
    }
    if (additionalRuntimeSemanticTags.includes(tag) && /ScriptableAgentServer|startScriptableAgentServerMock|\/api\/agent-server\/|agent-server/i.test(text)) {
      findings.push({
        file,
        rule: 'current-web-e2e-agentserver-internal-dispatch',
        message: `${tag} has a Runtime Codex/runtime-dispatch migration contract; current source must not keep AgentServer mock names or agent-server dispatch endpoints.`,
      });
    }
  }
}

function assertScriptEquals(name: string, expected: string, message: string): void {
  if (scripts[name] === expected) return;
  findings.push({
    file: 'package.json',
    rule: `script-${name}`,
    message,
    value: scripts[name],
  });
}

function assertOrderedSubsequence(scriptName: string, expected: string[]): void {
  const actual = packageScriptSteps(scripts[scriptName]);
  let cursor = 0;
  const matched: string[] = [];
  for (const step of expected) {
    const foundAt = actual.indexOf(step, cursor);
    if (foundAt === -1) {
      findings.push({
        file: 'package.json',
        rule: `script-order-${scriptName}`,
        message: `${scriptName} must include "npm run ${step}" after ${matched.join(', ') || 'start'}.`,
        value: scripts[scriptName],
      });
      return;
    }
    matched.push(step);
    cursor = foundAt + 1;
  }
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

function assertNoNestedAgentServerDefaultPath(scriptName: string): void {
  for (const expanded of expandPackageScript(scriptName)) {
    if (expanded.scriptName === legacyCompatScript) continue;
    if (!/\bagentserver\b/i.test(expanded.command)) continue;
    findings.push({
      file: 'package.json',
      rule: `nested-agentserver-default-path-${scriptName}`,
      message: `${scriptName} must not reach AgentServer-first commands through nested package scripts; use ${legacyVerifyScript} for compatibility checks.`,
      value: `${expanded.scriptName}: ${expanded.command}`,
    });
  }
}

function expandPackageScript(scriptName: string, seen = new Set<string>()): Array<{ scriptName: string; command: string }> {
  if (seen.has(scriptName)) return [];
  seen.add(scriptName);
  const command = scripts[scriptName];
  if (!command) return [];
  const expanded = [{ scriptName, command }];
  for (const nested of packageScriptSteps(command)) {
    expanded.push(...expandPackageScript(nested, seen));
  }
  return expanded;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
