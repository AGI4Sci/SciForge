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
    count: 31,
    digest: 'd6e39a60e48b',
  },
  buildAgentServerRepairPrompt: {
    count: 6,
    digest: '9b8a6e822883',
  },
};

const trustedPolicySpreadPattern = /\.\.\.agentServer[A-Za-z]*(?:PromptPolicyLines|ContractLines)\(/g;
const trustedPolicyImportPattern = /from ['"](?:@sciforge-ui\/runtime-contract\/[^'"]+|\.\.\/\.\.\/\.\.\/packages\/skills\/runtime-policy)['"]/;
const promptRenderSummarySchema = 'sciforge.agentserver.prompt-render-plan-summary.v1';

const policyProsePattern = /\b(?:agent backend|artifact|capability|Computer Use|contract|continuation|current turn|do not|Do not|failed-with-reason|failureReason|fresh|generated task|Hard contract|JSON|must|MUST|Never|objectReferences|PDFs?|policy|prefer|preserve|prior|refs?|repair|rerun|should|taskFiles|ToolPayload|valid|workspace)\b/;

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
      ...prose.map((finding) => `  ${finding.line}: ${finding.text}`),
    ].join('\n'));
  }
}

const generationBody = extractFunctionBody('buildAgentServerGenerationPrompt').text;
const repairBody = extractFunctionBody('buildAgentServerRepairPrompt').text;
const trustedGenerationSpreads = generationBody.match(trustedPolicySpreadPattern) ?? [];
const trustedRepairSpreads = repairBody.match(trustedPolicySpreadPattern) ?? [];

if (trustedGenerationSpreads.length < 8) {
  errors.push(`buildAgentServerGenerationPrompt should continue to source strategy policy from trusted provider spreads; found ${trustedGenerationSpreads.length}`);
}
if (trustedRepairSpreads.length < 2) {
  errors.push(`buildAgentServerRepairPrompt should continue to source repair policy from trusted provider spreads; found ${trustedRepairSpreads.length}`);
}

if (!source.includes(promptRenderSummarySchema)) {
  errors.push(`missing ${promptRenderSummarySchema}; harness prompt render policy must remain structured, not copied as raw prompt prose`);
}
if (!/promptRenderPlanSummary,\n\s*currentReferences/.test(generationBody)) {
  errors.push('buildAgentServerGenerationPrompt must keep promptRenderPlanSummary in CURRENT TURN SNAPSHOT.');
}
if (!/\.\.\.compactGenerationRequestForAgentServer\(request, capabilityBrokerBrief, promptRenderPlanSummary\)/.test(generationBody)) {
  errors.push('buildAgentServerGenerationPrompt must pass promptRenderPlanSummary into compactGenerationRequestForAgentServer.');
}

if (errors.length) fail(errors);

console.log([
  '[ok] agentserver prompt policy prose guard passed',
  ...summaries.map((summary) => `- ${summary}`),
  `- trustedGenerationPolicyProviderSpreads=${trustedGenerationSpreads.length}`,
  `- trustedRepairPolicyProviderSpreads=${trustedRepairSpreads.length}`,
  '- allowed new strategy prose sources: @sciforge-ui/runtime-contract policy lines, packages/skills/runtime-policy, harness promptRenderPlanSummary.renderedEntries',
].join('\n'));

function extractFunctionBody(name: PromptBuilderName) {
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

function fail(messages: string[]): never {
  console.error('[agentserver-prompt-policy-prose] guard failed');
  for (const message of messages) console.error(message);
  process.exit(1);
}
