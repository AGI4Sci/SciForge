import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
  text: string;
  migration?: string;
};

type Rule = {
  id: string;
  message: string;
  match: (line: string) => boolean;
};

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage', '__pycache__']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

const rules: Rule[] = [
  {
    id: 'component-id-hardcode',
    message: 'src file hardcodes package-owned UI component ids.',
    match: (line) => /[`'"][a-z0-9]+(?:-[a-z0-9]+)+[`'"]/.test(line)
      && /\b(componentId|COMPONENT|component|module|viewer|table|matrix|graph|inspector|timeline|editor)\b/.test(line),
  },
  {
    id: 'artifact-id-hardcode',
    message: 'src file hardcodes package-owned artifact ids or artifact type routing.',
    match: (line) => !isPlatformContractLine(line)
      && !isCapabilityEvolutionFailureCodeLine(line)
      && !/\bartifact-schema\b/.test(line)
      && /[`'"][a-z0-9]+(?:-[a-z0-9]+)+[`'"]/.test(line)
      && /\b(artifact|Artifact|type|targetType|requiredArtifactTypes|producer)\b/.test(line),
  },
  {
    id: 'domain-prompt-regex',
    message: 'src file contains prompt/domain regex semantics that should move into package-owned capability policy.',
    match: (line) => isCodeLine(line)
      && (/\/[^/\n]+\/[a-z]*|new RegExp|\.match\(|\.test\(/.test(line))
      && /(prompt|skillDomain|domain|report|paper|literature|structure|omics|knowledge|blast|alignment|protein|molecule|markdown|summary|报告|文献|结构|组学|知识)/i.test(line),
  },
  {
    id: 'scenario-provider-id-hardcode',
    message: 'src file hardcodes scenario/provider/tool ids that should come from capability manifests.',
    match: (line) => !isPlatformContractLine(line)
      && !isBackendToolNameLine(line)
      && /\b(scenario|provider|tool)\b/i.test(line)
      && /[`'"][a-z0-9]+(?:[._-][a-z0-9]+){2,}[`'"]/.test(line),
  },
  {
    id: 'domain-default-routing',
    message: 'src file carries domain default/ranking policy that belongs in package-owned scenario or view capability policy.',
    match: (line) => /\b(literature|structure|omics|knowledge)\b/.test(line)
      && /[`'"]|DOMAIN_DEFAULT|skillDomain|score|rank|Priority/.test(line),
  },
];

// Current T122 migration baseline. This intentionally scans all src/**, not only
// seed files. New files or increased counts fail unless the legacy line is first
// migrated into a package-owned policy or this baseline is deliberately updated.
const trackedBaselineCounts: Record<string, number> = {
  'src/runtime/computer-use/capture.ts#scenario-provider-id-hardcode': 8,
  'src/runtime/computer-use/executor.ts#artifact-id-hardcode': 1,
  'src/runtime/computer-use/types.ts#artifact-id-hardcode': 1,
  'src/runtime/computer-use/window-target.ts#artifact-id-hardcode': 1,
  'src/runtime/conversation-policy/apply.ts#artifact-id-hardcode': 2,
  'src/runtime/conversation-policy/contracts.ts#component-id-hardcode': 1,
  'src/runtime/gateway/agentserver-context-window.ts#artifact-id-hardcode': 1,
  'src/runtime/gateway/agentserver-prompts.ts#artifact-id-hardcode': 2,
  'src/runtime/gateway/agentserver-prompts.ts#component-id-hardcode': 2,
  'src/runtime/gateway/agentserver-prompts.ts#domain-default-routing': 3,
  'src/runtime/gateway/agentserver-prompts.ts#domain-prompt-regex': 12,
  'src/runtime/gateway/agentserver-prompts.ts#scenario-provider-id-hardcode': 2,
  'src/runtime/gateway/artifact-materializer.ts#artifact-id-hardcode': 2,
  'src/runtime/gateway/artifact-materializer.ts#domain-default-routing': 1,
  'src/runtime/gateway/artifact-materializer.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/artifact-reference-context.ts#domain-default-routing': 4,
  'src/runtime/gateway/artifact-reference-context.ts#domain-prompt-regex': 6,
  'src/runtime/gateway/backend-failure-diagnostics.ts#artifact-id-hardcode': 4,
  'src/runtime/gateway/backend-failure-diagnostics.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/context-envelope.ts#artifact-id-hardcode': 5,
  'src/runtime/gateway/context-envelope.ts#component-id-hardcode': 1,
  'src/runtime/gateway/context-envelope.ts#domain-default-routing': 4,
  'src/runtime/gateway/context-envelope.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/direct-answer-payload.ts#artifact-id-hardcode': 16,
  'src/runtime/gateway/direct-answer-payload.ts#component-id-hardcode': 13,
  'src/runtime/gateway/direct-answer-payload.ts#domain-default-routing': 2,
  'src/runtime/gateway/direct-answer-payload.ts#domain-prompt-regex': 3,
  'src/runtime/gateway/direct-answer-payload.ts#scenario-provider-id-hardcode': 3,
  'src/runtime/gateway/direct-context-fast-path.ts#artifact-id-hardcode': 1,
  'src/runtime/gateway/direct-context-fast-path.ts#component-id-hardcode': 2,
  'src/runtime/gateway/direct-context-fast-path.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/direct-context-fast-path.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/gateway/generated-task-runner.ts#artifact-id-hardcode': 7,
  'src/runtime/gateway/generated-task-runner.ts#component-id-hardcode': 2,
  'src/runtime/gateway/generated-task-runner.ts#domain-prompt-regex': 5,
  'src/runtime/gateway/generated-task-runner.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/gateway/latency-telemetry.ts#artifact-id-hardcode': 4,
  'src/runtime/gateway/payload-validation.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/payload-validation.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/gateway/repair-policy.ts#component-id-hardcode': 1,
  'src/runtime/gateway/repair-policy.ts#domain-prompt-regex': 1,
  'src/runtime/gateway/repair-policy.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/gateway/runtime-routing.ts#artifact-id-hardcode': 6,
  'src/runtime/gateway/verification-policy.ts#artifact-id-hardcode': 1,
  'src/runtime/gateway/work-evidence-guard.ts#artifact-id-hardcode': 2,
  'src/runtime/gateway/work-evidence-guard.ts#domain-prompt-regex': 5,
  'src/runtime/gateway/workspace-event-normalizer.ts#artifact-id-hardcode': 1,
  'src/runtime/generation-gateway.ts#artifact-id-hardcode': 13,
  'src/runtime/generation-gateway.ts#domain-prompt-regex': 1,
  'src/runtime/observe/orchestration.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/runtime-types.ts#artifact-id-hardcode': 3,
  'src/runtime/runtime-types.ts#component-id-hardcode': 1,
  'src/runtime/runtime-types.ts#domain-default-routing': 1,
  'src/runtime/runtime-ui-manifest.ts#artifact-id-hardcode': 8,
  'src/runtime/runtime-ui-manifest.ts#component-id-hardcode': 102,
  'src/runtime/runtime-ui-manifest.ts#domain-default-routing': 18,
  'src/runtime/runtime-ui-manifest.ts#domain-prompt-regex': 15,
  'src/runtime/server/file-preview.ts#component-id-hardcode': 2,
  'src/runtime/server/file-preview.ts#domain-default-routing': 9,
  'src/runtime/server/file-preview.ts#domain-prompt-regex': 1,
  'src/runtime/server/scenario-library-routes.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/server/workspace-open.ts#artifact-id-hardcode': 1,
  'src/runtime/skill-markdown-catalog.ts#artifact-id-hardcode': 5,
  'src/runtime/skill-markdown-catalog.ts#component-id-hardcode': 4,
  'src/runtime/skill-markdown-catalog.ts#domain-default-routing': 10,
  'src/runtime/skill-markdown-catalog.ts#domain-prompt-regex': 11,
  'src/runtime/skill-promotion.ts#artifact-id-hardcode': 4,
  'src/runtime/skill-registry/availability-validation.ts#artifact-id-hardcode': 2,
  'src/runtime/skill-registry/fallback.ts#artifact-id-hardcode': 2,
  'src/runtime/skill-registry/runtime-matching.ts#artifact-id-hardcode': 5,
  'src/runtime/skill-registry/runtime-matching.ts#domain-default-routing': 5,
  'src/runtime/skill-registry/runtime-matching.ts#domain-prompt-regex': 12,
  'src/runtime/task-project-contracts.ts#artifact-id-hardcode': 2,
  'src/runtime/task-projects.ts#artifact-id-hardcode': 2,
  'src/runtime/task-projects.ts#domain-default-routing': 2,
  'src/runtime/vision-sense-runtime.ts#artifact-id-hardcode': 1,
  'src/runtime/vision-sense/computer-use-action-loop.ts#artifact-id-hardcode': 2,
  'src/runtime/vision-sense/computer-use-grounding.ts#scenario-provider-id-hardcode': 8,
  'src/runtime/vision-sense/computer-use-plan.ts#domain-default-routing': 1,
  'src/runtime/vision-sense/computer-use-plan.ts#domain-prompt-regex': 8,
  'src/runtime/vision-sense/computer-use-plan.ts#scenario-provider-id-hardcode': 1,
  'src/runtime/vision-sense/computer-use-trace-output.ts#artifact-id-hardcode': 2,
  'src/runtime/vision-sense/computer-use-trace-output.ts#component-id-hardcode': 3,
  'src/runtime/vision-sense/sense-provider.ts#domain-prompt-regex': 1,
  'src/runtime/workspace-server.ts#artifact-id-hardcode': 2,
  'src/runtime/workspace-task-input.ts#artifact-id-hardcode': 3,
  'src/runtime/workspace-task-input.ts#domain-prompt-regex': 1,
  'src/runtime/workspace-task-runner.ts#domain-default-routing': 1,
  'src/ui/src/api/agentClient/responseNormalization.ts#artifact-id-hardcode': 11,
  'src/ui/src/api/agentClient/responseNormalization.ts#component-id-hardcode': 7,
  'src/ui/src/api/agentClient/responseNormalization.ts#domain-default-routing': 3,
  'src/ui/src/api/agentClient/responseNormalization.ts#domain-prompt-regex': 6,
  'src/ui/src/api/agentClient/runtimeConfig.ts#component-id-hardcode': 2,
  'src/ui/src/api/agentClient/runtimeConfig.ts#domain-default-routing': 9,
  'src/ui/src/api/sciforgeToolsClient.ts#component-id-hardcode': 2,
  'src/ui/src/api/sciforgeToolsClient.ts#domain-default-routing': 9,
  'src/ui/src/api/sciforgeToolsClient.ts#scenario-provider-id-hardcode': 2,
  'src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts#artifact-id-hardcode': 7,
  'src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts#domain-prompt-regex': 1,
  'src/ui/src/api/scopeCheck.ts#component-id-hardcode': 1,
  'src/ui/src/api/scopeCheck.ts#domain-default-routing': 4,
  'src/ui/src/api/scopeCheck.ts#domain-prompt-regex': 5,
  'src/ui/src/app/AlignmentPages.tsx#component-id-hardcode': 4,
  'src/ui/src/app/AlignmentPages.tsx#domain-default-routing': 3,
  'src/ui/src/app/AlignmentPages.tsx#domain-prompt-regex': 3,
  'src/ui/src/app/AlignmentPages.tsx#scenario-provider-id-hardcode': 1,
  'src/ui/src/app/ChatPanel.tsx#artifact-id-hardcode': 3,
  'src/ui/src/app/ChatPanel.tsx#component-id-hardcode': 2,
  'src/ui/src/app/ChatPanel.tsx#domain-default-routing': 5,
  'src/ui/src/app/ComponentWorkbenchPage.tsx#artifact-id-hardcode': 1,
  'src/ui/src/app/ComponentWorkbenchPage.tsx#component-id-hardcode': 32,
  'src/ui/src/app/ComponentWorkbenchPage.tsx#domain-default-routing': 1,
  'src/ui/src/app/Dashboard.tsx#component-id-hardcode': 5,
  'src/ui/src/app/Dashboard.tsx#domain-default-routing': 5,
  'src/ui/src/app/Dashboard.tsx#domain-prompt-regex': 1,
  'src/ui/src/app/Dashboard.tsx#scenario-provider-id-hardcode': 10,
  'src/ui/src/app/ResultsRenderer.tsx#artifact-id-hardcode': 18,
  'src/ui/src/app/ResultsRenderer.tsx#component-id-hardcode': 39,
  'src/ui/src/app/ResultsRenderer.tsx#domain-default-routing': 1,
  'src/ui/src/app/ResultsRenderer.tsx#domain-prompt-regex': 2,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#artifact-id-hardcode': 4,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#component-id-hardcode': 3,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#domain-prompt-regex': 2,
  'src/ui/src/app/ScenarioBuilderPanel.tsx#scenario-provider-id-hardcode': 16,
  'src/ui/src/app/SciForgeApp.tsx#component-id-hardcode': 3,
  'src/ui/src/app/SciForgeApp.tsx#domain-default-routing': 14,
  'src/ui/src/app/SciForgeApp.tsx#domain-prompt-regex': 1,
  'src/ui/src/app/appShell/ShellPanels.tsx#artifact-id-hardcode': 9,
  'src/ui/src/app/appShell/ShellPanels.tsx#scenario-provider-id-hardcode': 1,
  'src/ui/src/app/appShell/dashboardModels.ts#artifact-id-hardcode': 1,
  'src/ui/src/app/appShell/explorerModels.ts#artifact-id-hardcode': 1,
  'src/ui/src/app/appShell/explorerModels.ts#domain-prompt-regex': 1,
  'src/ui/src/app/appShell/workspaceState.ts#domain-prompt-regex': 1,
  'src/ui/src/app/chat/AcceptancePanel.tsx#domain-prompt-regex': 1,
  'src/ui/src/app/chat/ChatPanelHeader.tsx#scenario-provider-id-hardcode': 1,
  'src/ui/src/app/chat/MessageContent.tsx#artifact-id-hardcode': 1,
  'src/ui/src/app/chat/MessageContent.tsx#component-id-hardcode': 1,
  'src/ui/src/app/chat/MessageContent.tsx#domain-prompt-regex': 2,
  'src/ui/src/app/chat/runOrchestrator.ts#artifact-id-hardcode': 9,
  'src/ui/src/app/chat/runOrchestrator.ts#component-id-hardcode': 2,
  'src/ui/src/app/chat/runOrchestrator.ts#domain-prompt-regex': 4,
  'src/ui/src/app/chat/runOrchestrator.ts#scenario-provider-id-hardcode': 2,
  'src/ui/src/app/chat/sessionTransforms.ts#domain-prompt-regex': 2,
  'src/ui/src/app/chat/sessionTransforms.ts#scenario-provider-id-hardcode': 2,
  'src/ui/src/app/results/ArtifactCardControls.tsx#artifact-id-hardcode': 1,
  'src/ui/src/app/results/ExecutionNotebookPanels.tsx#artifact-id-hardcode': 1,
  'src/ui/src/app/results/ExecutionNotebookPanels.tsx#component-id-hardcode': 5,
  'src/ui/src/app/results/ExecutionNotebookPanels.tsx#domain-default-routing': 1,
  'src/ui/src/app/results/WorkspaceObjectPreview.tsx#artifact-id-hardcode': 2,
  'src/ui/src/app/results/WorkspaceObjectPreview.tsx#component-id-hardcode': 1,
  'src/ui/src/app/results/autoRunPrompts.ts#component-id-hardcode': 1,
  'src/ui/src/app/results/autoRunPrompts.ts#domain-default-routing': 5,
  'src/ui/src/app/results/previewDescriptor.ts#component-id-hardcode': 1,
  'src/ui/src/app/results/previewDescriptor.ts#domain-default-routing': 2,
  'src/ui/src/app/results/previewDescriptor.ts#domain-prompt-regex': 3,
  'src/ui/src/app/results/reportContent.tsx#artifact-id-hardcode': 1,
  'src/ui/src/app/results/reportContent.tsx#component-id-hardcode': 2,
  'src/ui/src/app/results/reportContent.tsx#domain-default-routing': 1,
  'src/ui/src/app/results/reportContent.tsx#domain-prompt-regex': 9,
  'src/ui/src/app/results/resultArtifactHelpers.ts#artifact-id-hardcode': 2,
  'src/ui/src/app/results/resultArtifactHelpers.ts#domain-default-routing': 1,
  'src/ui/src/app/results/resultArtifactHelpers.ts#domain-prompt-regex': 1,
  'src/ui/src/app/results/viewPlanResolver.ts#artifact-id-hardcode': 25,
  'src/ui/src/app/results/viewPlanResolver.ts#component-id-hardcode': 62,
  'src/ui/src/app/results/viewPlanResolver.ts#domain-default-routing': 3,
  'src/ui/src/app/uiPrimitives.tsx#artifact-id-hardcode': 3,
  'src/ui/src/app/uiPrimitives.tsx#component-id-hardcode': 1,
  'src/ui/src/app/uiPrimitives.tsx#scenario-provider-id-hardcode': 3,
  'src/ui/src/artifactIntent.ts#artifact-id-hardcode': 3,
  'src/ui/src/artifactIntent.ts#component-id-hardcode': 26,
  'src/ui/src/artifactIntent.ts#domain-default-routing': 16,
  'src/ui/src/artifactIntent.ts#domain-prompt-regex': 19,
  'src/ui/src/componentWorkbenchDemo.ts#artifact-id-hardcode': 4,
  'src/ui/src/componentWorkbenchDemo.ts#component-id-hardcode': 24,
  'src/ui/src/componentWorkbenchDemo.ts#domain-default-routing': 5,
  'src/ui/src/data.ts#artifact-id-hardcode': 1,
  'src/ui/src/data.ts#component-id-hardcode': 5,
  'src/ui/src/data.ts#domain-default-routing': 10,
  'src/ui/src/demoData.ts#artifact-id-hardcode': 1,
  'src/ui/src/demoData.ts#component-id-hardcode': 2,
  'src/ui/src/demoData.ts#domain-default-routing': 14,
  'src/ui/src/demoData.ts#domain-prompt-regex': 2,
  'src/ui/src/demoData.ts#scenario-provider-id-hardcode': 3,
  'src/ui/src/domain.ts#artifact-id-hardcode': 7,
  'src/ui/src/domain.ts#domain-default-routing': 1,
  'src/ui/src/feedback/FeedbackCaptureLayer.tsx#artifact-id-hardcode': 1,
  'src/ui/src/processProgress.ts#artifact-id-hardcode': 7,
  'src/ui/src/processProgress.ts#domain-prompt-regex': 1,
  'src/ui/src/runtimeContracts.ts#artifact-id-hardcode': 2,
  'src/ui/src/runtimeContracts.ts#domain-default-routing': 3,
  'src/ui/src/runtimeHealth.ts#artifact-id-hardcode': 1,
  'src/ui/src/sessionStore.ts#artifact-id-hardcode': 1,
  'src/ui/src/streamEventPresentation.ts#artifact-id-hardcode': 24,
  'src/ui/src/streamEventPresentation.ts#domain-prompt-regex': 1,
  'src/ui/src/uiModuleRegistry.ts#artifact-id-hardcode': 1,
  'src/ui/src/uiModuleRegistry.ts#component-id-hardcode': 2,
  'src/ui/src/visualizations.tsx#artifact-id-hardcode': 3,
  'src/ui/src/visualizations.tsx#component-id-hardcode': 4,
  'src/ui/src/visualizations.tsx#domain-default-routing': 2,
  'src/ui/src/workEventAtoms.ts#artifact-id-hardcode': 2,
  'src/ui/src/workEventAtoms.ts#domain-prompt-regex': 3,
};

const migrationByFile: Array<{ file: RegExp; migration: string }> = [
  { file: /^src\/runtime\/runtime-ui-manifest\.ts$/, migration: 'T122 P1: move renderer aliases, domain defaults, artifact routing, title/layout/encoding inference into package-owned view policy.' },
  { file: /^src\/runtime\/gateway\/artifact-reference-context\.ts$/, migration: 'T122 seed: move paper-list/research-report and skillDomain regex matching out of gateway runtime.' },
  { file: /^src\/ui\/src\/app\/chat\/runOrchestrator\.ts$/, migration: 'T122/T119 seed: remove UI follow-up intent regex and research-report view special cases.' },
  { file: /^src\/ui\/src\/app\/results\/viewPlanResolver\.ts$/, migration: 'T122 P1/T119 seed: move artifact/component/domain ranking into scenario/view capability policy.' },
  { file: /^src\/runtime\/computer-use\//, migration: 'T122 P0: migrate computer-use action provider semantics into packages/actions/computer-use.' },
  { file: /^src\/runtime\/vision-sense(\/|-runtime\.ts$)/, migration: 'T122 P0: migrate vision planner/grounding/verifier semantics into packages/observe/vision.' },
  { file: /^src\/runtime\/skill-(markdown-catalog|registry)\//, migration: 'T122 P1: migrate skill catalog and matching semantics into packages/skills or broker package.' },
  { file: /^src\/runtime\/skill-markdown-catalog\.ts$/, migration: 'T122 P1: migrate SKILL.md catalog and domain/provider scoring into packages/skills or broker package.' },
  { file: /^src\/ui\/src\//, migration: 'T119/T122: thin UI shell migration removes package-owned semantics from UI code.' },
];

async function main() {
  const findings: Finding[] = [];
  const files = await collectSourceFilesIfExists(join(root, 'src'));

  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        if (!rule.match(line)) continue;
        findings.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          text: line.trim(),
          migration: trackedMigration(rel, rule.id),
        });
      }
    });
  }

  const counts = countByFileRule(findings);
  const overflowKeys = new Set([...counts.entries()]
    .filter(([key, count]) => count > (trackedBaselineCounts[key] ?? 0))
    .map(([key]) => key));
  const errors = findings.filter((finding) => overflowKeys.has(findingKey(finding)));
  const warnings = findings.filter((finding) => !overflowKeys.has(findingKey(finding)) && finding.migration);

  if (warnings.length) {
    console.warn('[no-src-capability-semantics] warnings: tracked T122 src capability semantics remain');
    printGrouped(warnings, false);
  }

  if (errors.length) {
    console.error('[no-src-capability-semantics] untracked or increased src capability semantics found');
    for (const [key, grouped] of groupBy(errors, findingKey)) {
      console.error(`- ${key}: ${grouped[0].message} (${grouped.length}; baseline ${trackedBaselineCounts[key] ?? 0}, current ${counts.get(key) ?? 0})`);
      for (const finding of grouped) console.error(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    console.error('Move package-owned artifact/component/provider/scenario ids and prompt/domain regex into package manifests or package-owned policy. Only update this baseline when a T122 migration item explicitly tracks the exception.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] no increased src capability semantics found: ${files.length} source files, ${warnings.length} tracked findings.`);
}

function trackedMigration(file: string, rule: string) {
  const key = `${file}#${rule}`;
  if (trackedBaselineCounts[key] === undefined) return undefined;
  return migrationByFile.find((entry) => entry.file.test(file))?.migration
    ?? 'T122 tracked baseline: existing src capability semantics must migrate to packages before this baseline is reduced.';
}

function countByFileRule(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(findingKey(finding), (counts.get(findingKey(finding)) ?? 0) + 1);
  return counts;
}

function findingKey(finding: Pick<Finding, 'file' | 'rule'>) {
  return `${finding.file}#${finding.rule}`;
}

function printGrouped(findings: Finding[], includeEveryFinding: boolean) {
  for (const grouped of groupBy(findings, (finding) => `${finding.rule}:${finding.migration ?? 'untracked'}`).values()) {
    const first = grouped[0];
    console.warn(`- ${first.rule}: ${first.message} (${grouped.length})`);
    if (first.migration) console.warn(`  ${first.migration}`);
    for (const finding of grouped.slice(0, includeEveryFinding ? grouped.length : 8)) {
      console.warn(`  ${finding.file}:${finding.line} ${finding.text}`);
    }
    if (!includeEveryFinding && grouped.length > 8) console.warn(`  ... ${grouped.length - 8} more`);
  }
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyFor(item), [...(groups.get(keyFor(item)) ?? []), item]);
  return groups;
}

function isCodeLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 0
    && !trimmed.startsWith('import ')
    && !trimmed.startsWith('export ')
    && !trimmed.startsWith('} from ')
    && !trimmed.startsWith('//')
    && !trimmed.startsWith('*');
}

function isPlatformContractLine(line: string) {
  return /\bcontractId\s*:/.test(line);
}

function isCapabilityEvolutionFailureCodeLine(line: string) {
  return /\bmissing-artifact\b/.test(line)
    && (/\b(failureCode|CapabilityFallbackTrigger|return|allowed)\b/.test(line) || /^\s*['"]missing-artifact['"],?\s*$/.test(line));
}

function isBackendToolNameLine(line: string) {
  return /\btool\s*:\s*['"](?:list_session_artifacts|resolve_object_reference|read_artifact|render_artifact|resume_run)['"]/.test(line);
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectFiles(dir);
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name)) && !isTestFile(full)) out.push(full);
  }
  return out.sort();
}

function isTestFile(file: string) {
  const rel = relative(root, file).replaceAll('\\', '/');
  return /(^|\/)(tests?|__tests__)\//.test(rel) || /\.(test|spec)\.[^.]+$/.test(rel);
}

await main();
