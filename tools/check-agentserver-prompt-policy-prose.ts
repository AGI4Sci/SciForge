import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

type PromptBuilderName = 'buildAgentServerGenerationPrompt' | 'buildAgentServerRepairPrompt';

type PolicyProseFinding = {
  line: number;
  text: string;
};

const sourcePath = 'src/runtime/gateway/agentserver-prompts.ts';

const frozenHardcodedPolicyProse: Record<PromptBuilderName, {
  count: number;
  digest: string;
}> = {
  buildAgentServerGenerationPrompt: {
    count: 0,
    digest: 'da39a3ee5e6b',
  },
  buildAgentServerRepairPrompt: {
    count: 0,
    digest: 'da39a3ee5e6b',
  },
};

const trustedPolicySpreadPattern = /\.\.\.agentServer[A-Za-z]*(?:PromptPolicyLines|ContractLines)\(/g;
const trustedPolicyImportPattern = /from ['"](?:@sciforge-ui\/runtime-contract\/[^'"]+|\.\.\/\.\.\/\.\.\/packages\/skills\/runtime-policy)['"]/;
const promptRenderSummarySchema = 'sciforge.agentserver.prompt-render-plan-summary.v1';
const promptProviderSpreadCallPattern = /\.\.\.([A-Za-z_$][\w$]*(?:PromptPolicyLines|ContractLines))\(/g;

const allowedHarnessPromptRenderSources = [
  'contextEnvelope.sessionFacts.agentHarnessHandoff',
  'contextEnvelope.sessionFacts.promptRenderPlan',
  'contextEnvelope.scenarioFacts.agentHarnessHandoff',
  'contextEnvelope.scenarioFacts.promptRenderPlan',
  'contextEnvelope.agentHarnessHandoff',
  'contextEnvelope.promptRenderPlan',
  'request.metadata.agentHarnessHandoff',
  'request.metadata.promptRenderPlan',
];

const policyProsePattern = /\b(?:agent backend|artifact|background|budget|capability|Computer Use|contract|continuation|continuity|current turn|do not|Do not|failed-with-reason|failureReason|first result|fresh|generated task|Hard contract|JSON|latency|latencyTier|must|MUST|Never|objectReferences|PDFs?|policy|prefer|preserve|prior|refs?|repair|rerun|should|taskFiles|tool-use|tool use|ToolPayload|valid|workspace)\b/;

const source = await readFile(sourcePath, 'utf8');
const lines = source.split(/\r?\n/);
const importLines = lines.filter((line) => line.startsWith('import '));
const trustedImportCount = importLines.filter((line) => trustedPolicyImportPattern.test(line)).length;
if (trustedImportCount < 2) {
  fail([
    `expected runtime-contract and package runtime-policy prompt provider imports in ${sourcePath}`,
    `found trusted provider imports: ${trustedImportCount}`,
  ]);
}
const trustedPolicyProviderNames = collectTrustedPolicyProviderNames(importLines);

const errors: string[] = [];
const summaries: string[] = [];

for (const builderName of Object.keys(frozenHardcodedPolicyProse) as PromptBuilderName[]) {
  const body = extractFunctionBody(builderName);
  const prose = collectHardcodedPolicyProse(body);
  const digest = digestPolicyProse(prose);
  const frozen = frozenHardcodedPolicyProse[builderName];
  summaries.push(`${builderName}: hardcodedPolicyProse=${prose.length}, digest=${digest}`);
  if (frozen.digest === 'pending') {
    errors.push(`${builderName} guard baseline is not pinned yet: count=${prose.length}, digest=${digest}`);
    continue;
  }
  if (prose.length !== frozen.count || digest !== frozen.digest) {
    errors.push([
      `${builderName} hardcoded policy prose changed.`,
      `Expected count=${frozen.count}, digest=${frozen.digest}; got count=${prose.length}, digest=${digest}.`,
      'Move new governance prose into @sciforge-ui/runtime-contract policy lines, packages/skills/runtime-policy, or harness promptRenderPlanSummary renderedEntries.',
      'Fresh/continuity/tool-use/repair/latency strategy must stay in HarnessContract/Profile/Module policy and only reach this prompt through bounded render plan summaries.',
      ...prose.map((finding) => `  ${finding.line}: ${finding.text}`),
    ].join('\n'));
  }
}

const generationBody = extractFunctionBody('buildAgentServerGenerationPrompt').text;
const repairBody = extractFunctionBody('buildAgentServerRepairPrompt').text;
const compactRepairContextBody = extractFunctionBody('buildCompactRepairContext').text;
const trustedGenerationSpreads = generationBody.match(trustedPolicySpreadPattern) ?? [];
const trustedRepairSpreads = repairBody.match(trustedPolicySpreadPattern) ?? [];
const untrustedGenerationProviderSpreads = collectUntrustedPolicyProviderSpreads(generationBody, trustedPolicyProviderNames);
const untrustedRepairProviderSpreads = collectUntrustedPolicyProviderSpreads(repairBody, trustedPolicyProviderNames);

if (trustedGenerationSpreads.length < 8) {
  errors.push(`buildAgentServerGenerationPrompt should continue to source strategy policy from trusted provider spreads; found ${trustedGenerationSpreads.length}`);
}
if (trustedRepairSpreads.length < 2) {
  errors.push(`buildAgentServerRepairPrompt should continue to source repair policy from trusted provider spreads; found ${trustedRepairSpreads.length}`);
}
if (untrustedGenerationProviderSpreads.length) {
  errors.push(`buildAgentServerGenerationPrompt has untrusted prompt policy/contract providers: ${untrustedGenerationProviderSpreads.join(', ')}`);
}
if (untrustedRepairProviderSpreads.length) {
  errors.push(`buildAgentServerRepairPrompt has untrusted prompt policy/contract providers: ${untrustedRepairProviderSpreads.join(', ')}`);
}

if (!source.includes(promptRenderSummarySchema)) {
  errors.push(`missing ${promptRenderSummarySchema}; harness prompt render policy must remain structured, not copied as raw prompt prose`);
}
if (!/promptRenderPlanSummary,\n\s*currentReferences/.test(generationBody)) {
  errors.push('buildAgentServerGenerationPrompt must keep promptRenderPlanSummary in CURRENT TURN SNAPSHOT.');
}
if (!/\.\.\.compactGenerationRequestForAgentServer\(request,\s*\w+,\s*promptRenderPlanSummary\)/.test(generationBody)) {
  errors.push('buildAgentServerGenerationPrompt must pass promptRenderPlanSummary into compactGenerationRequestForAgentServer.');
}
if (/readTextIfExists\(join\(params\.workspace,\s*params\.run\.(?:stdoutRef|stderrRef)\)\)/.test(compactRepairContextBody)) {
  errors.push('buildCompactRepairContext must not read stdout/stderr bodies; repair prompts stay ref-first and carry only diagnostic summaries.');
}
const forbiddenRepairStuffing = [
  'headForAgentServer',
  'tailForAgentServer',
  'excerptAroundFailureLine',
  'stdoutTail',
  'stderrTail',
  'outputHead',
  'fullText',
];
const leakedRepairStuffing = forbiddenRepairStuffing.filter((token) => compactRepairContextBody.includes(token));
if (leakedRepairStuffing.length) {
  errors.push(`buildCompactRepairContext must not stuff raw/code/log bodies into repair prompts: ${leakedRepairStuffing.join(', ')}`);
}

const promptRenderCandidateBody = extractFunctionBody('promptRenderPlanSummaryForAgentServer').text;
const promptRenderSummaryBody = extractFunctionBody('promptRenderPlanSummaryFromPlan').text;
const promptRenderEntryBody = extractFunctionBody('promptRenderPlanEntrySummary').text;
const harnessPromptRenderSources = Array.from(promptRenderCandidateBody.matchAll(/source:\s*'([^']+)'/g)).map((match) => match[1] ?? '');
const unexpectedHarnessPromptRenderSources = harnessPromptRenderSources.filter((sourceName) => !allowedHarnessPromptRenderSources.includes(sourceName));
const missingHarnessPromptRenderSources = allowedHarnessPromptRenderSources.filter((sourceName) => !harnessPromptRenderSources.includes(sourceName));
if (unexpectedHarnessPromptRenderSources.length || missingHarnessPromptRenderSources.length) {
  errors.push([
    'promptRenderPlanSummaryForAgentServer must only accept harness prompt render plans from allowed handoff providers.',
    unexpectedHarnessPromptRenderSources.length ? `Unexpected sources: ${unexpectedHarnessPromptRenderSources.join(', ')}` : undefined,
    missingHarnessPromptRenderSources.length ? `Missing sources: ${missingHarnessPromptRenderSources.join(', ')}` : undefined,
  ].filter(Boolean).join('\n'));
}
const forbiddenHarnessRawFields = ['renderedText', 'promptDirectives', 'directiveRefs', 'strategyRefs', 'selectedContextRefs'];
const leakedHarnessRawFields = forbiddenHarnessRawFields.filter((field) => new RegExp(`\\b${field}\\b`).test(promptRenderSummaryBody));
if (leakedHarnessRawFields.length) {
  errors.push(`promptRenderPlanSummaryFromPlan must not copy raw harness prompt fields into AgentServer prompts: ${leakedHarnessRawFields.join(', ')}`);
}
if (!/renderedEntries\s*=\s*Array\.isArray\(plan\.renderedEntries\)[\s\S]*?\.map\(promptRenderPlanEntrySummary\)/.test(promptRenderSummaryBody)) {
  errors.push('promptRenderPlanSummaryFromPlan must project harness policy prose only through renderedEntries -> promptRenderPlanEntrySummary.');
}
if (!/if \(!id \|\| !sourceCallbackId\) return undefined;/.test(promptRenderEntryBody)) {
  errors.push('promptRenderPlanEntrySummary must require id and sourceCallbackId for every rendered entry.');
}
if (!/out\.text = clipForAgentServerPrompt\(text, 800\);/.test(promptRenderEntryBody)) {
  errors.push('promptRenderPlanEntrySummary must keep rendered entry text clipped before adding it to the prompt.');
}

if (errors.length) fail(errors);

console.log([
  '[ok] agentserver prompt policy prose guard passed',
  ...summaries.map((summary) => `- ${summary}`),
  `- trustedGenerationPolicyProviderSpreads=${trustedGenerationSpreads.length}`,
  `- trustedRepairPolicyProviderSpreads=${trustedRepairSpreads.length}`,
  `- harnessPromptRenderSources=${harnessPromptRenderSources.length}`,
  '- allowed new strategy prose sources: @sciforge-ui/runtime-contract policy lines, packages/skills/runtime-policy, harness promptRenderPlanSummary.renderedEntries',
  '- forbidden local strategy prose: fresh/continuity/tool-use/repair/latency policy in AgentServer prompt strings',
].join('\n'));

function extractFunctionBody(name: string) {
  const start = lines.findIndex((line) => line.includes(`function ${name}`));
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let seenOpen = false;
  const bodyLines: Array<{ line: number; text: string }> = [];
  for (let index = start; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    for (const char of text) {
      if (char === '{') {
        depth += 1;
        seenOpen = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    bodyLines.push({ line: index + 1, text });
    if (seenOpen && depth === 0) break;
  }
  return {
    lines: bodyLines,
    text: bodyLines.map((entry) => entry.text).join('\n'),
  };
}

function collectHardcodedPolicyProse(body: ReturnType<typeof extractFunctionBody>) {
  const findings: PolicyProseFinding[] = [];
  for (const entry of body.lines) {
    const text = extractInlineString(entry.text);
    if (!text) continue;
    if (text.length < 24 || !/\s/.test(text)) continue;
    if (!policyProsePattern.test(text)) continue;
    findings.push({ line: entry.line, text });
  }
  return findings;
}

function extractInlineString(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return undefined;
  const stringMatch = trimmed.match(/(?:^|[?:,{[]\s*)(['"`])((?:\\.|(?!\1).)+)\1/);
  if (!stringMatch) return undefined;
  const text = stringMatch[2]?.trim();
  if (!text || text.startsWith('sciforge.')) return undefined;
  return text;
}

function digestPolicyProse(findings: PolicyProseFinding[]) {
  const stable = findings.map((finding) => finding.text).join('\n');
  return createHash('sha1').update(stable).digest('hex').slice(0, 12);
}

function collectTrustedPolicyProviderNames(linesToScan: string[]) {
  const providers = new Set<string>();
  for (const line of linesToScan) {
    if (!trustedPolicyImportPattern.test(line)) continue;
    const namedImports = line.match(/import\s+\{([^}]+)\}\s+from/);
    if (!namedImports?.[1]) continue;
    for (const specifier of namedImports[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      const localName = (parts[1] ?? parts[0])?.trim();
      if (localName && /(?:PromptPolicyLines|ContractLines)$/.test(localName)) {
        providers.add(localName);
      }
    }
  }
  return providers;
}

function collectUntrustedPolicyProviderSpreads(body: string, trustedProviders: Set<string>) {
  const untrusted: string[] = [];
  for (const match of body.matchAll(promptProviderSpreadCallPattern)) {
    const providerName = match[1];
    if (!providerName || trustedProviders.has(providerName)) continue;
    untrusted.push(providerName);
  }
  return [...new Set(untrusted)].sort();
}

function fail(messages: string[]): never {
  console.error('[agentserver-prompt-policy-prose] guard failed');
  for (const message of messages) console.error(message);
  process.exit(1);
}
