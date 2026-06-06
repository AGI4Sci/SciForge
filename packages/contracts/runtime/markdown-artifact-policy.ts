export type MarkdownArtifactRewriteConstraints = {
  budgetUsd?: string;
  months?: string;
  roleFtes: Array<{ role: string; fte: string }>;
  noRealPatientData: boolean;
  budgetCategories: string[];
  genericConstraints: Array<{ label: string; value: string }>;
  requestedSections: string[];
  prohibitedTerms: string[];
};

export type MarkdownArtifactMutationIntent = {
  hasArtifactSubject: boolean;
  targetSignal: 'explicit-ref' | 'selected-ref' | 'directory-ref' | 'artifact-subject-only' | 'none';
  operationKind: 'writeback' | 'rewrite' | 'update' | 'replace' | 'none';
  scope: 'single-ref' | 'multi-ref' | 'directory' | 'unknown';
  noWriteConstraint: boolean;
  readonlyOrQuestion: boolean;
  confidence: number;
  permitMutation: boolean;
};

export function markdownReadonlyQuestionPolicy(prompt: string) {
  if (!markdownArtifactTargetPolicy(prompt)) return false;
  if (!explicitMarkdownPathsFromPrompt(prompt).length) return false;
  return markdownReadonlyIntentPolicy(prompt) || (markdownQuestionIntentPolicy(prompt) && !markdownMutationIntentPolicy(prompt));
}

export function markdownArtifactMutationPolicy(prompt: string) {
  return markdownArtifactMutationIntent(prompt).permitMutation;
}

export function markdownArtifactMutationIntent(prompt: string): MarkdownArtifactMutationIntent {
  const explicitRefs = explicitMarkdownPathsFromPrompt(prompt);
  const hasArtifactSubject = markdownArtifactTargetPolicy(prompt);
  const noWriteConstraint = markdownReadonlyOrNoChangePolicy(prompt) || markdownNoWriteConstraintPolicy(prompt);
  const questionOnly = markdownQuestionIntentPolicy(prompt) && markdownDiscussionOnlyPolicy(prompt);
  const operationKind = markdownMutationOperationKind(prompt);
  const targetSignal = markdownMutationTargetSignal(prompt, explicitRefs);
  const scope = markdownMutationScope(prompt, explicitRefs, targetSignal);
  const confidence = markdownMutationConfidence({
    hasArtifactSubject,
    targetSignal,
    operationKind,
    scope,
    noWriteConstraint,
    questionOnly,
  });
  return {
    hasArtifactSubject,
    targetSignal,
    operationKind,
    scope,
    noWriteConstraint,
    readonlyOrQuestion: noWriteConstraint || questionOnly,
    confidence,
    permitMutation: confidence >= 0.72 && operationKind !== 'none' && targetSignal !== 'none' && targetSignal !== 'artifact-subject-only' && !noWriteConstraint && !questionOnly,
  };
}

export function markdownReadonlyBulletPreference(prompt: string) {
  return /\b(?:bullets?|points?)\b|要点|条目/i.test(prompt);
}

export function explicitMarkdownPathsFromPrompt(prompt: string) {
  const rawExplicit = [...prompt.matchAll(/(?:file:)?(?:[\w.-]+\/)+[\w.-]+\.md\b|(?:file:)?[\w.-]+\.md\b/g)]
    .map((match) => normalizeMarkdownRelPath(match[0]))
    .filter((value): value is string => Boolean(value));
  const baseDir = rawExplicit.map((item) => item.split('/').slice(0, -1).join('/')).find(Boolean);
  return uniqueStrings(rawExplicit.map((item) => !item.includes('/') && baseDir ? `${baseDir}/${item}` : item));
}

export function normalizeMarkdownRelPath(value: string) {
  const clean = value.replace(/^file:/i, '').replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean || clean.includes('..') || clean.startsWith('.sciforge/')) return undefined;
  return clean;
}

export function selectedMarkdownTargetRequested(prompt: string) {
  return /(selected|current|this artifact|this file|选中|当前|这个|这份|刚才)/i.test(prompt);
}

export function markdownDirectoryTargetRequested(prompt: string) {
  return /(all|every|package|folder|directory|全部|所有|整套|目录|文件夹|交付包|交付物)/i.test(prompt);
}

export function markdownDirectoryCandidatesFromPrompt(prompt: string) {
  return [...prompt.matchAll(/(?:^|\s)([\w.-]+(?:\/[\w.-]+)+)\/?(?:\s|$|目录|folder|directory)/gi)]
    .map((match) => normalizeMarkdownRelPath(match[1] ?? ''))
    .filter((value): value is string => Boolean(value));
}

export function rewriteConstraintsFromMarkdownPrompt(prompt: string): MarkdownArtifactRewriteConstraints {
  const text = positiveConstraintText(prompt);
  return {
    budgetUsd: preferredConstraintMatch(text, /改为\s*(\d{1,3}(?:,\d{3})*)\s*USD/gi, /(?:总预算|budget)[^。\n;；]*?(\d{1,3}(?:,\d{3})*)\s*USD/gi, /(\d{1,3}(?:,\d{3})*)\s*USD|\$\s*(\d{1,3}(?:,\d{3})*)/gi),
    months: preferredConstraintMatch(text, /改为\s*(\d{1,2})\s*months?\b/gi, /(?:周期|duration|project cycle|timeline)[^。\n;；]*?(\d{1,2})\s*months?\b/gi, /(\d{1,2})\s*months?\b|(\d{1,2})\s*个月/g),
    roleFtes: roleFtesFromPrompt(text),
    noRealPatientData: /(?:no|without|不允许|不要|禁止|无).{0,24}(?:real\s+|真实\s*)?patient data|不能.{0,24}patient data|只能.{0,24}(?:synthetic|公开匿名|anonymous)/i.test(prompt),
    budgetCategories: budgetCategoriesFromPrompt(text),
    genericConstraints: genericConstraintsFromPrompt(text),
    requestedSections: requestedSectionsFromPrompt(prompt),
    prohibitedTerms: prohibitedTermsFromPrompt(prompt),
  };
}

export function requestedMarkdownSectionsFromPrompt(prompt: string, markdown: string) {
  return markdownHeadings(markdown)
    .filter((heading) => heading.level <= 3 && heading.body && promptMentionsHeading(prompt, heading.heading))
    .map((heading) => ({ heading: heading.heading, body: summarizeMarkdownSectionBody(heading.body) }))
    .slice(0, 6);
}

export function prohibitedTermsFromMarkdownPrompt(prompt: string) {
  const lines = prompt.split(/\n|。|；|;/).filter((line) => /do not|remove old|old constraints|不要|移除旧|删除旧/i.test(line));
  return uniqueStrings(lines.flatMap((line) => [
    ...[...line.matchAll(/\$?\s*\d{1,3}(?:,\d{3})+\s*(?:USD)?/gi)].map((match) => normalizeMoneyTerm(match[0])),
    ...[...line.matchAll(/\b\d{1,2}\s*months?\b/gi)].map((match) => normalizePromptTerm(match[0])),
    ...[...line.matchAll(/\b\d+(?:\.\d+)?\s*FTE\b/gi)].map((match) => normalizePromptTerm(match[0])),
    ...arbitraryProhibitedTermsFromLine(line),
  ])).slice(0, 20);
}

export function markdownBudgetTargetPolicy(rel: string, prompt: string) {
  return /budget|预算|cost|spend|finance|funding/i.test(`${rel} ${prompt}`);
}

function markdownArtifactTargetPolicy(prompt: string) {
  return /\.md\b|markdown|artifact|artifacts|deliverable|deliverables|file|files|report|document|产物|交付物|文件|路径|报告|文档/i.test(prompt);
}

function markdownReadonlyIntentPolicy(prompt: string) {
  return /read[-\s]?only|only read|do not (?:write|save|rewrite|update|modify|edit)|without (?:writing|saving|modifying)|no writeback|只读|不要(?:写入|写回|保存|重写|更新|修改|编辑)/i.test(prompt);
}

function markdownReadonlyOrNoChangePolicy(prompt: string) {
  return /(?:read[-\s]?only|only read|do not (?:rewrite|write|modify|edit|save)|no changes)|只读|不要(?:重写|写入|写回|覆盖|保存|修改|更新)/i.test(prompt);
}

function markdownNoWriteConstraintPolicy(prompt: string) {
  return /\b(?:should\s+not|must\s+not|do\s+not|don't|without)\s+(?:write|write\s*back|save|persist|mutate|modify|edit|apply)\b|\b(?:discussion|explanation|policy|guidance)\s+only\b|\bdo\s+not\s+apply\b|不要(?:写入|写回|保存|应用|实际修改)|不(?:要|应|应该)(?:写入|写回|保存|应用|实际修改)/i.test(prompt);
}

function markdownQuestionIntentPolicy(prompt: string) {
  return /\b(?:what|which|whether|does|how|why|summari[sz]e|list|audit|check|explain|state|name)\b|总结|列出|说明|解释|检查|审计|指出|回答/i.test(prompt);
}

function markdownMutationIntentPolicy(prompt: string) {
  return /\b(?:write\s*back|overwrite|persist|save|update|revise|rewrite|edit|modify|replace|regenerate)\b|写回|写入|覆盖|保存|更新|修订|重写|改写|修改|替换|重新生成/i.test(prompt);
}

function markdownMutationOperationKind(prompt: string): MarkdownArtifactMutationIntent['operationKind'] {
  if (/\b(?:write\s*back|persist|save|overwrite)\b|写回|写入|覆盖|保存/i.test(prompt)) return 'writeback';
  if (/\b(?:rewrite|revise|regenerate)\b|重写|改写|修订|重新生成/i.test(prompt)) return 'rewrite';
  if (/\b(?:replace|substitute)\b|替换/i.test(prompt)) return 'replace';
  if (/\b(?:update|edit|modify)\b|更新|修改/i.test(prompt)) return 'update';
  return 'none';
}

function markdownMutationTargetSignal(prompt: string, explicitRefs: string[]): MarkdownArtifactMutationIntent['targetSignal'] {
  if (explicitRefs.length) return 'explicit-ref';
  if (selectedMarkdownTargetRequested(prompt)) return 'selected-ref';
  if (markdownDirectoryTargetRequested(prompt) && markdownDirectoryCandidatesFromPrompt(prompt).length) return 'directory-ref';
  if (markdownArtifactTargetPolicy(prompt)) return 'artifact-subject-only';
  return 'none';
}

function markdownMutationScope(
  prompt: string,
  explicitRefs: string[],
  targetSignal: MarkdownArtifactMutationIntent['targetSignal'],
): MarkdownArtifactMutationIntent['scope'] {
  if (targetSignal === 'directory-ref') return 'directory';
  if (explicitRefs.length > 1 || markdownDirectoryTargetRequested(prompt)) return 'multi-ref';
  if (explicitRefs.length === 1 || targetSignal === 'selected-ref') return 'single-ref';
  return 'unknown';
}

function markdownDiscussionOnlyPolicy(prompt: string) {
  return /\b(?:explain|discuss|describe|audit|check|list|how)\b.{0,80}\b(?:would|could|policy|safely|without applying)\b|只(?:说明|解释|讨论)/i.test(prompt);
}

function markdownMutationConfidence(input: Pick<MarkdownArtifactMutationIntent, 'hasArtifactSubject' | 'targetSignal' | 'operationKind' | 'scope' | 'noWriteConstraint'> & { questionOnly: boolean }) {
  let score = 0;
  if (input.hasArtifactSubject) score += 0.18;
  if (input.targetSignal === 'explicit-ref') score += 0.32;
  if (input.targetSignal === 'selected-ref') score += 0.28;
  if (input.targetSignal === 'directory-ref') score += 0.24;
  if (input.operationKind === 'writeback') score += 0.32;
  else if (input.operationKind !== 'none') score += 0.24;
  if (input.scope !== 'unknown') score += 0.12;
  if (input.noWriteConstraint) score -= 0.48;
  if (input.questionOnly) score -= 0.24;
  return Math.max(0, Math.min(0.98, Number(score.toFixed(2))));
}

function positiveConstraintText(prompt: string) {
  return prompt
    .replace(/(?:do not show|do not restore|must not appear|remove old|old constraints?|不要出现|不要恢复|淘汰旧|替换旧)[^\n。]*?(?:(?<!\d)[.。]|\n|$)/gi, ' ')
    .split(/[\n。]/)
    .flatMap((line) => line.split(/[；;]/))
    .join('\n');
}

function preferredConstraintMatch(text: string, ...patterns: RegExp[]) {
  for (const pattern of patterns) {
    const values = [...text.matchAll(pattern)].map((match) => match[1] ?? match[2]).filter(Boolean);
    if (values.length) return values[values.length - 1];
  }
  return undefined;
}

function roleFtesFromPrompt(text: string) {
  const roles: Array<{ role: string; fte: string }> = [];
  const pattern = /(?:\b\d+\s+)?([A-Za-z][A-Za-z -]{1,40}|[\p{Script=Han}A-Za-z -]{1,40}?)\s*([0-9]+(?:\.[0-9]+)?)\s*FTE/giu;
  for (const match of text.matchAll(pattern)) {
    const role = normalizeRoleLabel(match[1] ?? '');
    const fte = match[2];
    if (role && fte) roles.push({ role, fte });
  }
  return dedupeRoles(roles).slice(0, 12);
}

function normalizeRoleLabel(value: string) {
  const role = value
    .replace(/\b(?:team|团队|改为|为|and|with|one|part[-\s]?time|full[-\s]?time)\b/gi, ' ')
    .replace(/[,，、:：;；()[\]\d.+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[A-Za-z\p{Script=Han}]/u.test(role)) return '';
  if (/^(?:or|and|或|和|与)$/i.test(role)) return '';
  return role;
}

function dedupeRoles(roles: Array<{ role: string; fte: string }>) {
  const map = new Map<string, { role: string; fte: string }>();
  for (const role of roles) map.set(role.role.toLowerCase(), role);
  return [...map.values()];
}

function budgetCategoriesFromPrompt(text: string) {
  const match = text.match(/(?:categories?|类别|类|科目|预算表)[：: ]+([A-Za-z0-9_\-/，、,\s]+?)(?:[.。]|\n|$)/i);
  if (match) {
    return uniqueStrings((match[1] ?? '')
      .split(/[、,，/]+|\s{2,}/)
      .map((item) => item.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter((item) => item.length >= 3))
      .slice(0, 8);
  }
  const canonical = ['personnel', 'compute', 'data-validation', 'contingency'];
  const foundCanonical = canonical.filter((category) => new RegExp(category.replace('-', '[-\\s]?'), 'i').test(text));
  return foundCanonical.length >= 2 ? foundCanonical : [];
}

function prohibitedTermsFromPrompt(prompt: string) {
  const lines = prompt.split(/\n|。|；|;/).filter((line) => /不要出现|不要恢复|do not restore|must not appear|remove old|淘汰旧|替换旧/i.test(line));
  const values = lines.flatMap((line) => [
    ...[...line.matchAll(/\$?\s*\d{1,3}(?:,\d{3})+\s*(?:USD)?/gi)].map((match) => normalizeMoneyTerm(match[0])),
    ...[...line.matchAll(/\b\d{1,2}\s*months?\b/gi)].map((match) => normalizePromptTerm(match[0])),
    ...[...line.matchAll(/\b\d+(?:\.\d+)?\s*FTE\b/gi)].map((match) => normalizePromptTerm(match[0])),
    ...arbitraryProhibitedTermsFromLine(line),
  ]);
  return uniqueStrings(values.filter(Boolean)).slice(0, 20);
}

function arbitraryProhibitedTermsFromLine(line: string) {
  const afterMarker = line.replace(/^.*?(?:old constraints?|stale constraints?|old terms?|remove old|do not show|must not appear|不要出现|不要恢复|淘汰旧|替换旧|移除旧|删除旧)[:：]?\s*/i, '');
  return afterMarker
    .split(/(?<!\d),(?!\d)|，|、|(?:\s+and\s+)|(?:\s+or\s+)|或|和/)
    .map((item) => normalizeArbitraryTerm(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeMoneyTerm(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^\$\s*/, '').replace(/\s*USD$/i, '').trim();
}

function normalizePromptTerm(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeArbitraryTerm(value: string) {
  const term = value
    .replace(/\b(?:old|stale|constraints?|terms?|requested|remove|removed|show|appear)\b/gi, ' ')
    .replace(/[.。]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (term.length < 3 || term.length > 80) return undefined;
  if (/^(?:and|or|或|和|与|old|stale)$/i.test(term)) return undefined;
  return term;
}

function genericConstraintsFromPrompt(text: string) {
  const clauses = text
    .split(/\n|；|;/)
    .flatMap((line) => splitConstraintClauseLine(line))
    .map(parseGenericConstraintClause)
    .filter((item): item is { label: string; value: string } => Boolean(item));
  return dedupeGenericConstraints(clauses).slice(0, 16);
}

function splitConstraintClauseLine(line: string) {
  return line
    .split(/(?<!\d)[.。]\s+(?=[\p{Script=Han}A-Z])/u)
    .flatMap((part) => {
      const normalized = part
        .replace(/^.*?(?:hard requirements?|requirements?|constraints?|effective constraints?|new constraints?|v\d+|新约束|硬性要求|有效约束|要求)[:：]?\s*/i, '')
        .replace(/^v\d+\s*[:：]\s*/i, '')
        .trim();
      if (!normalized || normalized === part.trim() && !/[:：=]|改为|should be|must be|\b[A-Za-z][\w -]{1,32}\s+\S+/i.test(part)) return [];
      return normalized.split(/(?<!\d),(?!\d)|，|、/);
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseGenericConstraintClause(clause: string) {
  const cleaned = clause
    .replace(/^[\-*]\s*/, '')
    .replace(/\b(?:must retain|retain|keep|set|replace|change|保留|设置|替换)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /\.md\b/i.test(cleaned) || /\b(?:write|rewrite|save|update|modify|artifact|file|workspace)\b/i.test(cleaned)) return undefined;
  if (/^(?:include\s+)?(?:sections?|headings?)\b/i.test(cleaned) || /^(?:包含|包括)?(?:章节|小节)\b/i.test(cleaned)) return undefined;
  if (/^(?:scope|acceptance criteria|risks?|methods?|limitations?|background|summary|timeline|budget|范围|验收标准|风险|方法|局限|摘要)$/i.test(cleaned)) return undefined;
  if (/\bFTE\b/i.test(cleaned)) return undefined;
  const transition = cleaned.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 _/-]{1,44}?)\s*从\s*.+?\s*改为\s*(.+)$/u);
  if (transition) return normalizeGenericConstraintItem(transition[1] ?? '', transition[2] ?? '');
  const keyValue = cleaned.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 _/-]{1,44}?)(?:[:：=]| should be | must be | is | 为 )\s*(.+)$/iu);
  if (keyValue) return normalizeGenericConstraintItem(keyValue[1] ?? '', keyValue[2] ?? '');
  const wordTokens = cleaned.split(/\s+/);
  if (wordTokens.length >= 2 && /^(?:runtime|platform|owner|metrics?|privacy|language|dataset|cohort|license|status)$/i.test(wordTokens[0] ?? '')) {
    return normalizeGenericConstraintItem(wordTokens[0] ?? '', wordTokens.slice(1).join(' '));
  }
  if (wordTokens.length >= 3 && !/^\d/.test(wordTokens[1] ?? '') && /^[-+]?[\d$]|^[A-Z0-9]{2,}\b|^(?:synthetic|public|private|none|no|yes|qa|owner|lead)/i.test(wordTokens[2] ?? '')) {
    const label = wordTokens.slice(0, 2).join(' ');
    const value = wordTokens.slice(2).join(' ');
    return normalizeGenericConstraintItem(label, value);
  }
  const compact = cleaned.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 _/-]{1,32}?)\s+(.{2,80})$/u);
  if (!compact) return undefined;
  return normalizeGenericConstraintItem(compact[1] ?? '', compact[2] ?? '');
}

function normalizeGenericConstraintItem(label: string, value: string) {
  const normalizedLabel = titleCase(label.trim().replace(/\s+/g, ' '));
  const normalizedValue = value.trim().replace(/[.。]+$/g, '').replace(/\s+/g, ' ');
  if (normalizedLabel.length < 2 || normalizedValue.length < 2 || normalizedValue.length > 140) return undefined;
  if (/^(?:selected artifact|artifact|file|workspace|main answer|old constraints?)$/i.test(normalizedLabel)) return undefined;
  return { label: normalizedLabel, value: normalizedValue };
}

function dedupeGenericConstraints(items: Array<{ label: string; value: string }>) {
  const map = new Map<string, { label: string; value: string }>();
  for (const item of items) map.set(item.label.toLowerCase(), item);
  return [...map.values()];
}

function requestedSectionsFromPrompt(prompt: string) {
  const match = prompt.match(/(?:include|with|sections?|headings?|包含|包括|章节|小节)[^。\n:：]*[:：]?\s*([A-Za-z0-9 _/\-，、,]+?)(?:[.。]|\n|$)/i);
  if (!match) return [];
  return uniqueStrings((match[1] ?? '')
    .split(/(?<!\d),(?!\d)|，|、|\/|\band\b/i)
    .map((item) => titleCase(item.trim().replace(/\s+/g, ' ')))
    .filter((item) => item.length >= 3 && item.length <= 48 && !/artifact|file|workspace|constraint/i.test(item)))
    .slice(0, 8);
}

function markdownHeadings(markdown: string) {
  const matches = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index ?? markdown.length : markdown.length;
    return {
      level: match[1]?.length ?? 1,
      heading: match[2]?.trim().replace(/#+$/, '').trim() ?? '',
      body: markdown.slice(start, end).trim(),
    };
  }).filter((heading) => heading.heading);
}

function promptMentionsHeading(prompt: string, heading: string) {
  const normalizedHeading = normalizeHeadingText(heading);
  if (!normalizedHeading) return false;
  const normalizedPrompt = normalizeHeadingText(prompt);
  if (normalizedPrompt.includes(normalizedHeading)) return true;
  const compactHeading = normalizedHeading.replace(/\s+/g, '');
  return compactHeading.length >= 4 && normalizedPrompt.replace(/\s+/g, '').includes(compactHeading);
}

function normalizeHeadingText(value: string) {
  return value.toLowerCase().replace(/[`*_#:[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function summarizeMarkdownSectionBody(body: string) {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .map((line) => line.replace(/[.。；;]+$/g, ''))
    .filter(Boolean)
    .filter((line) => !/^[-:| ]+$/.test(line));
  if (!lines.length) return 'section is present but empty.';
  return lines.slice(0, 6).join('; ');
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
