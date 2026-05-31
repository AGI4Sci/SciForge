import { resultPresentationTextLooksLikeRawJson } from '@sciforge-ui/runtime-contract';
import { normalizeAssistantProseForDisplay } from '../../assistantText';

export type FinalMessageAuditSection = {
  label: string;
  text: string;
  evidenceType: 'execution-audit' | 'raw-trace' | 'tool-output' | 'raw-json' | 'log-output';
  importance: 'diagnostic' | 'raw' | 'supporting';
};

export type FinalMessagePresentation = {
  primaryContent: string;
  auditSections: FinalMessageAuditSection[];
  summary: string;
};

type ResultPresentationContractLike = {
  answerBlocks?: unknown[];
  keyFindings?: unknown[];
  inlineCitations?: unknown[];
  artifactActions?: unknown[];
  confidenceExplanation?: unknown;
  nextActions?: unknown[];
  processSummary?: unknown;
  diagnosticsRefs?: unknown[];
};

type ContentBlock = {
  text: string;
  kind: 'heading' | 'code' | 'paragraph' | 'list' | 'table';
  language?: string;
};

export function splitFinalMessagePresentation(content: string, resultPresentation?: unknown): FinalMessagePresentation {
  const structured = structuredResultPresentation(resultPresentation);
  if (structured) return presentationFromResultContract(structured, content);
  const displayContent = foldLeadingInlineRawDiagnostic(
    normalizeFinalMessageMarkdownInput(stripLeadingAssistantScratchpad(content)),
  );
  const blocks = parseContentBlocks(displayContent);
  const primary: string[] = [];
  const auditSections: FinalMessageAuditSection[] = [];
  let activeAuditHeading = '';

  for (const block of blocks) {
    const decision = classifyFinalMessageBlock(block, activeAuditHeading);
    if (block.kind === 'heading') {
      if (decision.auditHeading) activeAuditHeading = headingText(block.text);
      else activeAuditHeading = '';
      if (!decision.auditHeading) primary.push(block.text);
      continue;
    }
    if (decision.auditHeading) {
      activeAuditHeading = headingText(block.text).replace(/[:：]\s*$/, '');
      continue;
    }
    if (decision.fold) {
      if (looksLikeRedactedPathPlanningLeak(block.text)) continue;
      auditSections.push({
        label: decision.label,
        text: block.text,
        evidenceType: decision.evidenceType,
        importance: decision.importance,
      });
      continue;
    }
    primary.push(block.text);
  }

  if (!primary.join('\n').trim() && auditSections.length) {
    const first = auditSections[0];
    if (first) primary.push(compactAuditFallback(first.text, first.evidenceType));
  }

  return {
    primaryContent: normalizeAssistantProseForDisplay(primary.join('\n\n')),
    auditSections,
    summary: auditSectionsSummary(auditSections),
  };
}

function normalizeFinalMessageMarkdownInput(content: string) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      output.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    output.push(...repairMarkdownHeadingLine(line));
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function repairMarkdownHeadingLine(line: string) {
  const repaired = line
    .replace(/(^|\n)(#{1,6})(?!#)([^\s#])/g, '$1$2 $3')
    .replace(/([^\s#])\s+(#{1,6})(?!#)\s*([^\s#])/g, '$1\n\n$2 $3')
    .replace(/([。！？.!?；;：:])\s*(#{1,6})(?!#)\s*([^\s#])/g, '$1\n\n$2 $3');
  return repaired.split('\n').flatMap((part) => repairInlineFenceLine(part).flatMap((linePart) => repairRunOnHeadingLine(linePart)));
}

function repairRunOnHeadingLine(line: string) {
  const match = line.match(/^(#{1,6}\s+)(.+)$/);
  if (!match) return [line];
  const marker = match[1];
  const text = match[2].trim();
  const inlineFenceIndex = text.indexOf('```');
  if (inlineFenceIndex > 0) {
    return [
      `${marker}${text.slice(0, inlineFenceIndex).trim()}`,
      ...repairInlineFenceLine(text.slice(inlineFenceIndex)),
    ].filter(Boolean);
  }
  const cue = text.match(new RegExp(`^(${USER_FACING_SECTION_CUES.join('|')})(?:[-:：]?\\s*)?(.{4,})$`));
  if (cue?.[1] && cue[2]) return [`${marker}${cue[1]}`, cue[2].replace(/^[-:：]\s*/, '').trim()];

  const splitIndex = runOnHeadingSplitIndex(text);
  if (splitIndex === undefined) return [`${marker}${text}`];
  return [`${marker}${text.slice(0, splitIndex).trim()}`, text.slice(splitIndex).trim()].filter(Boolean);
}

function runOnHeadingSplitIndex(text: string) {
  const bodyStart = '(?:GUI|T\\s+UI|TUI|UI|API|AgentServer|Computer Use|Cursor|SciForge|它|这|如果|所以|我|你|The|This)';
  const keywordTitle = text.match(new RegExp(`^(.{2,90}?(?:路径|职责|架构图|流程|方案|原因|结论|答案|建议|要点|实现|验证|风险|总结|核心理念|独特性|架构特性|典型用途|使用方式|设计原则|注意事项|下一步))\\s+(?=${bodyStart}\\b)`));
  if (keywordTitle?.[1]) return keywordTitle[1].length;
  const numberedTitle = text.match(new RegExp(`^((?:\\d+\\s*️⃣|\\d+[.)]|[一二三四五六七八九十]+[、.])\\s*.{2,72}?)\\s+(?=${bodyStart}\\b)`));
  if (numberedTitle?.[1]) return numberedTitle[1].length;
  return undefined;
}

function repairInlineFenceLine(line: string): string[] {
  const fenceIndex = line.indexOf('```');
  if (fenceIndex < 0) return [line];
  const before = line.slice(0, fenceIndex).trimEnd();
  const afterOpen = line.slice(fenceIndex + 3);
  const closeIndex = afterOpen.indexOf('```');
  if (closeIndex < 0) return [before, '```', afterOpen.trim()].filter(Boolean);
  const code = afterOpen.slice(0, closeIndex).trim();
  const after = afterOpen.slice(closeIndex + 3).trim();
  return [
    before,
    '```',
    code,
    '```',
    ...repairMarkdownHeadingLine(after),
  ].filter(Boolean);
}

function stripLeadingAssistantScratchpad(content: string) {
  const text = content.replace(/\r\n?/g, '\n').trim();
  if (!looksLikeLeadingScratchpad(text)) return content;
  const cueIndex = firstUserFacingAnswerCueIndex(text);
  if (cueIndex === undefined || cueIndex < 8) return content;
  const candidate = text.slice(cueIndex).replace(/^[\s。！？.!?；;：:，,]+/, '').trim();
  return candidate.length >= 12 ? candidate : content;
}

function foldLeadingInlineRawDiagnostic(content: string) {
  const text = content.trim();
  const split = leadingInlineRawDiagnosticSplit(text);
  if (!split) return content;
  return [split.answer, '## Execution audit', split.diagnostic].filter(Boolean).join('\n\n');
}

function leadingInlineRawDiagnosticSplit(text: string): { diagnostic: string; answer: string } | undefined {
  if (!looksLikeInlineRawDiagnosticPrefix(text)) return undefined;
  const cue = inlineUserFacingAnswerCue(text);
  if (!cue || cue.index < 80) return undefined;
  const diagnostic = text.slice(0, cue.index).trim();
  const answer = text.slice(cue.index).trim();
  if (!diagnostic || answer.length < 4) return undefined;
  return { diagnostic, answer };
}

function looksLikeInlineRawDiagnosticPrefix(text: string) {
  const prefix = text.slice(0, 2400);
  return /"schemaVersion"\s*:|"id"\s*:\s*"session-conflict-|session-conflict-|ordering-conflict|expectedBaseRevision|actualBaseRevision|recoverableActions|conflictingFields/.test(prefix)
    && /[{}[\]"]/.test(prefix);
}

function inlineUserFacingAnswerCue(text: string): { index: number } | undefined {
  const patterns = [
    /(?:[}\]]\s*)(?:否|是)[，,。]/,
    /(?:[}\]]\s*)(?:不需要|应该|可以|结论|答案|建议)[:：，,。]?/,
    /(?:[}\]]\s*)\*\*(?:结论|答案|建议|要点)/,
  ];
  const matches = patterns
    .map((pattern) => {
      const match = pattern.exec(text);
      if (!match) return undefined;
      const leading = match[0].match(/^[}\]\s]+/)?.[0].length ?? 0;
      return { index: match.index + leading };
    })
    .filter((match): match is { index: number } => Boolean(match));
  return matches.sort((left, right) => left.index - right.index)[0];
}

function looksLikeLeadingScratchpad(text: string) {
  return /^(?:让我|我先|先看|我来|先了解|Let me|I(?:'ll| will| need to)|Now let me|Checking|Reading|Searched|Read)\b/i.test(text)
    || /^(?:让我|我先|先看|我来|先了解)/.test(text);
}

function firstUserFacingAnswerCueIndex(text: string) {
  const cues = [
    /好问题[，。,]/,
    /(?:^|[\n。！？.!?]\s*)(?:是|否)[，。,]/,
    /我(?:通读|看完|检查|梳理|确认|理解)了/,
    /(?:^|[\n。！？.!?]\s*)(?:结论|答案|简短结论|建议|要分两种|不需要|应该|可以)\b/,
    /(?:^|[\s\n。！？.!?]\s*)[A-Za-z][A-Za-z0-9_.-]{1,48}\s*(?:是|是一|=|:|：)/,
    /(?:^|[\s\n。！？.!?]\s*)\*\*[A-Za-z][A-Za-z0-9_.-]{1,48}\*\*\s*(?:是|是一|=|:|：)/,
    /(?:^|[\n。！？.!?]\s*)\*\*(?:结论|答案|建议|要点)/,
    /(?:^|[\n。！？.!?]\s*)#{1,6}\s*(?:结论|答案|建议|要点)/,
  ];
  const matches = cues
    .map((pattern) => {
      const match = pattern.exec(text);
      return match ? { index: match.index, text: match[0] } : undefined;
    })
    .filter((match): match is { index: number; text: string } => Boolean(match));
  if (!matches.length) return undefined;
  const first = matches.sort((left, right) => left.index - right.index)[0];
  const leadingPunctuation = first.text.match(/^[\n。！？.!?\s]+/)?.[0].length ?? 0;
  return first.index + leadingPunctuation;
}

const USER_FACING_SECTION_CUES = [
  '结论',
  '答案',
  '建议',
  '要点',
  '流程',
  '原因',
  '改法',
  '实现',
  '验证',
  '风险',
  '总结',
  '核心理念',
  '独特性',
  '架构特性',
  '典型用途',
  '使用方式',
  '设计原则',
  '注意事项',
  '下一步',
];

function structuredResultPresentation(value: unknown): ResultPresentationContractLike | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.answerBlocks) && !Array.isArray(value.keyFindings)) return undefined;
  return value as ResultPresentationContractLike;
}

function presentationFromResultContract(contract: ResultPresentationContractLike, fallbackContent: string): FinalMessagePresentation {
  const primary: string[] = [];
  const answerText = answerBlocksMarkdown(contract.answerBlocks);
  if (answerText) primary.push(answerText);
  const findings = keyFindingsMarkdown(contract.keyFindings);
  if (findings) primary.push(['## Key findings', findings].join('\n\n'));
  const artifactActions = artifactActionsMarkdown(contract.artifactActions);
  if (artifactActions) primary.push(['## Artifacts', artifactActions].join('\n\n'));
  const nextActions = nextActionsMarkdown(contract.nextActions);
  if (nextActions) primary.push(['## Next actions', nextActions].join('\n\n'));
  const confidence = confidenceMarkdown(contract.confidenceExplanation);
  if (confidence) primary.push(['## Confidence', confidence].join('\n\n'));

  const auditSections = structuredAuditSections(contract, fallbackContent);
  if (!primary.join('\n').trim() && fallbackContent.trim()) {
    const fallback = splitFinalMessagePresentation(fallbackContent);
    return {
      primaryContent: fallback.primaryContent,
      auditSections: [...fallback.auditSections, ...auditSections],
      summary: auditSectionsSummary([...fallback.auditSections, ...auditSections]),
    };
  }
  return {
    primaryContent: normalizeAssistantProseForDisplay(primary.join('\n\n')),
    auditSections,
    summary: auditSectionsSummary(auditSections),
  };
}

function answerBlocksMarkdown(blocks: unknown[] | undefined) {
  return recordList(blocks).map((block, index) => {
    const text = stringField(block.text) ?? stringList(block.items).join('\n');
    if (!text) return '';
    const title = stringField(block.title);
    const body = text;
    return title ? `### ${title}\n${body}` : index === 0 ? body : `### Answer ${index + 1}\n${body}`;
  }).filter(Boolean).join('\n\n');
}

function keyFindingsMarkdown(findings: unknown[] | undefined) {
  return recordList(findings).map((finding) => {
    const statement = stringField(finding.statement) ?? stringField(finding.text);
    if (!statement) return '';
    const suffix = '';
    const uncertainty = isRecord(finding.uncertainty) ? stringField(finding.uncertainty.reason) : undefined;
    const state = stringField(finding.verificationState) ?? stringField(finding.status) ?? (uncertainty ? 'unverified' : undefined);
    return `- ${statement}${suffix}${state ? ` (${state})` : ''}${uncertainty ? `: ${uncertainty}` : ''}`;
  }).filter(Boolean).join('\n');
}

function artifactActionsMarkdown(actions: unknown[] | undefined) {
  return recordList(actions).map((action) => {
    const label = stringField(action.label) ?? stringField(action.id);
    return label ? `- ${label}` : '';
  }).filter(Boolean).join('\n');
}

function nextActionsMarkdown(actions: unknown[] | undefined) {
  return recordList(actions).map((action) => {
    const label = stringField(action.label) ?? stringField(action.text);
    return label ? `- ${label}` : '';
  }).filter(Boolean).join('\n');
}

function confidenceMarkdown(value: unknown) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const summary = stringField(value.summary) ?? stringField(value.explanation);
  if (!summary) return undefined;
  const level = stringField(value.level);
  const details = [
    fieldLine('evidenceLevel', stringField(value.evidenceLevel)),
    fieldLine('sourceScore', numberField(value.sourceScore)),
    fieldLine('evidenceDefault', numberField(value.evidenceDefault)),
    fieldLine('evidenceCap', numberField(value.evidenceCap)),
  ].filter(Boolean);
  const penalties = recordList(value.penalties).map((penalty) => {
    const reason = stringField(penalty.reason) ?? stringField(penalty.summary) ?? stringField(penalty.label);
    if (!reason) return '';
    const delta = numberField(penalty.delta);
    return `- ${delta === undefined ? reason : `${reason} (${formatNumber(delta)})`}`;
  }).filter(Boolean);
  return [
    `${level ? `${level}: ` : ''}${summary}`,
    ...details.map((detail) => `- ${detail}`),
    ...penalties,
  ].join('\n');
}

function fieldLine(label: string, value: string | number | undefined) {
  if (value === undefined) return undefined;
  return `${label}: ${typeof value === 'number' ? formatNumber(value) : value}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function structuredAuditSections(contract: ResultPresentationContractLike, fallbackContent: string): FinalMessageAuditSection[] {
  const sections: FinalMessageAuditSection[] = [];
  if (isRecord(contract.processSummary)) {
    const processText = [
      stringField(contract.processSummary.summary),
      ...recordList(contract.processSummary.items).map((item) => [
        stringField(item.label) ?? stringField(item.id),
        stringField(item.status),
        stringList(item.refs).join(', '),
      ].filter(Boolean).join(' · ')),
    ].filter(Boolean).join('\n');
    if (processText) {
      sections.push({
        label: 'Process',
        text: processText,
        evidenceType: 'execution-audit',
        importance: 'diagnostic',
      });
    }
  }
  for (const diagnostic of recordList(contract.diagnosticsRefs)) {
    const text = [
      stringField(diagnostic.summary),
      stringField(diagnostic.ref),
    ].filter(Boolean).join('\n');
    if (!text) continue;
    sections.push({
      label: safeAuditLabel(stringField(diagnostic.label) ?? stringField(diagnostic.kind), diagnosticEvidenceType(stringField(diagnostic.kind))),
      text,
      evidenceType: diagnosticEvidenceType(stringField(diagnostic.kind)),
      importance: 'diagnostic',
    });
  }
  if (fallbackContent.trim() && looksLikeRuntimeMetadataBlock(fallbackContent)) {
    sections.push({
      label: 'Details',
      text: fallbackContent,
      evidenceType: 'tool-output',
      importance: 'supporting',
    });
  }
  return sections;
}

function diagnosticEvidenceType(kind: string | undefined): FinalMessageAuditSection['evidenceType'] {
  if (kind === 'raw-payload') return 'raw-json';
  if (kind === 'stdout' || kind === 'stderr' || kind === 'log') return 'log-output';
  if (kind === 'reasoning-trace' || kind === 'trace') return 'raw-trace';
  return 'execution-audit';
}

function parseContentBlocks(content: string): ContentBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ContentBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const fence = lines[index].match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const body = [lines[index]];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', language: fence[1]?.toLowerCase(), text: body.join('\n') });
      continue;
    }
    const kind = blockKindForLine(lines[index]);
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index])) {
      const nextKind = blockKindForLine(lines[index]);
      if (body.length && (kind === 'heading' || nextKind === 'heading' || nextKind !== kind)) break;
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind, text: body.join('\n') });
  }
  return blocks.length ? blocks : [{ kind: 'paragraph', text: content }];
}

function blockKindForLine(line: string): ContentBlock['kind'] {
  if (/^#{1,6}\s+/.test(line)) return 'heading';
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return 'list';
  if (/^\s*\|.+\|\s*$/.test(line)) return 'table';
  return 'paragraph';
}

function classifyFinalMessageBlock(block: ContentBlock, pendingAuditHeading: string): {
  fold: boolean;
  auditHeading?: boolean;
  label: string;
  evidenceType: FinalMessageAuditSection['evidenceType'];
  importance: FinalMessageAuditSection['importance'];
} {
  const text = stripCodeFence(block.text);
  const haystack = `${pendingAuditHeading}\n${block.language ?? ''}\n${text}`.toLowerCase();
  const explicitAuditHeading = block.kind === 'heading' && Boolean(auditEvidenceType(text.toLowerCase()) ?? auditHeadingEvidenceType(text));
  const headingAudit = explicitAuditHeading || /^工作过程摘要[:：]\s*$/i.test(text.trim());
  const rawJson = looksLikeRawJson(text);
  const logOutput = looksLikeLogOutput(block.language, text);
  const runtimeAuditLog = looksLikeRuntimeAuditLogBlock(text);
  const failureDiagnostic = looksLikeFailureDiagnostic(text) || looksLikeTracebackDiagnostic(text);
  const systemEnvelope = looksLikeSystemEnvelope(text);
  const runtimeMetadata = looksLikeRuntimeMetadataBlock(text);
  const processTranscript = looksLikeProcessTranscript(text);
  const localPathListing = looksLikeLocalPathListing(text);
  const redactedPathPlanningLeak = looksLikeRedactedPathPlanningLeak(text);
  const userFacingPlanningList = looksLikeUserFacingPlanningList(block.kind, text);
  const structuralEvidenceType = rawJson ? 'raw-json' : logOutput || runtimeAuditLog ? 'log-output' : undefined;
  const evidenceType = block.kind === 'code'
    ? structuralEvidenceType ?? auditEvidenceType(haystack) ?? codeEvidenceType(block.language, text)
    : (failureDiagnostic || runtimeMetadata || processTranscript || localPathListing || redactedPathPlanningLeak ? 'execution-audit' : undefined)
      ?? (systemEnvelope ? 'tool-output' : undefined)
      ?? auditEvidenceType(haystack)
      ?? auditHeadingEvidenceType(text)
      ?? structuralEvidenceType
      ?? codeEvidenceType(block.language, text);
  const fold = !userFacingPlanningList && Boolean(
      pendingAuditHeading
      || systemEnvelope
      || runtimeMetadata
      || processTranscript
      || localPathListing
      || redactedPathPlanningLeak
      || runtimeAuditLog
      || (block.kind === 'code' && (evidenceType || rawJson || logOutput))
      || (block.kind !== 'heading' && failureDiagnostic)
      || (block.kind !== 'heading' && evidenceType && text.length > 240)
    );
  return {
    fold,
    auditHeading: headingAudit,
    label: safeAuditLabel(pendingAuditHeading, evidenceType ?? (rawJson ? 'raw-json' : logOutput ? 'log-output' : 'tool-output')),
    evidenceType: evidenceType ?? (rawJson ? 'raw-json' : logOutput ? 'log-output' : 'tool-output'),
    importance: evidenceType === 'execution-audit' ? 'diagnostic' : rawJson || logOutput ? 'raw' : 'supporting',
  };
}

function looksLikeUserFacingPlanningList(kind: ContentBlock['kind'], text: string) {
  if (kind !== 'list') return false;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  const planningLines = lines.filter((line) => /^[-*+]\s+(?:R\d+|Risk \d+|[A-Z][A-Za-z /&-]+|Months? \d+|Month \d+|Updated hard|Original \d+|Any plan step)\b/i.test(line));
  const hasPlanningVocabulary = /\b(?:risk register|mitigation|owner|budget|timeline|month|constraint|invalidated|assumption|contingency|validation|cohort|platform|access)\b/i.test(text);
  const hasRawDiagnostics = /\b(?:stdoutRef|stderrRef|traceRef|toolPayload|executionUnits|raw payload|raw response)\b/i.test(text);
  return !hasRawDiagnostics && hasPlanningVocabulary && planningLines.length >= Math.max(1, Math.ceil(lines.length * 0.5));
}

function auditEvidenceType(text: string): FinalMessageAuditSection['evidenceType'] | undefined {
  if (/\b(raw trace|trace id|完整 trace|agent trace|reasoning trace)\b/.test(text)) return 'raw-trace';
  if (/\b(execution audit|execution details|execution process|executionunit|execution units?|audit trail|provenance|diagnostics?|debug(?:ging)? details|runtime metadata|backend events|route decision|schema validation|执行审计|执行单元|执行明细|执行过程|运行审计|诊断|调试信息|过程记录|中间文件)\b|工作过程摘要/.test(text)) return 'execution-audit';
  if (/\b(tool output|tool result|tool payload|toolpayload|raw payload|raw response|stdout|stderr|terminal output|command output|工具输出|工具结果|原始响应|原始输出|标准输出|错误输出)\b/.test(text)) return 'tool-output';
  if (/\b(plugin manifest|manifest warning|raw jsonl|raw_jsonl|provider sse|cloudflare)\b/.test(text)) return 'tool-output';
  return undefined;
}

function auditHeadingEvidenceType(text: string): FinalMessageAuditSection['evidenceType'] | undefined {
  const normalized = headingText(text).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(?:received|tool\s*payload|toolpayload|raw\s+(?:json|payload|response|output)|stdout|stderr|logs?|terminal output|command output|工具(?:输出|结果)|原始(?:json|payload|响应|输出)|标准输出|错误输出)$/i.test(normalized)) return 'tool-output';
  if (/^(?:execution(?: audit| details| process| trace| units?)?|audit trail|diagnostics?|debug(?:ging)?(?: info| details)?|runtime metadata|backend events|schema validation|route decision|work(?:ing)? process|thoughts?|thinking|reasoning|执行(?:审计|明细|过程|单元)|运行(?:审计|日志)|诊断|调试信息|工作过程摘要|过程记录|中间文件)$/i.test(normalized)) return 'execution-audit';
  if (/^(?:raw trace|agent trace|reasoning trace|完整 trace)$/i.test(normalized)) return 'raw-trace';
  return undefined;
}

function codeEvidenceType(language: string | undefined, text: string): FinalMessageAuditSection['evidenceType'] | undefined {
  if (language === 'json' && looksLikeRawJson(text)) return 'raw-json';
  if (language && /^(log|text|stdout|stderr|console|terminal|bash|shell|sh)$/.test(language) && looksLikeLogOutput(language, text)) return 'log-output';
  return undefined;
}

function looksLikeRawJson(text: string) {
  return resultPresentationTextLooksLikeRawJson(text);
}

function looksLikeLogOutput(language: string | undefined, text: string) {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 4 && !/stdout|stderr|trace|debug|error/i.test(`${language ?? ''}\n${text}`)) return false;
  const logLines = lines.filter((line) => /^\s*(?:\[[^\]]+\]|(?:debug|info|warn|error|trace)\b|(?:stdout|stderr)\s*:|\$ )/i.test(line));
  return logLines.length >= Math.max(2, Math.ceil(lines.length * 0.4));
}

function looksLikeRuntimeAuditLogBlock(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  return /(?:\b(?:plugin manifest|manifest warning|invalid plugin|failed to load plugin|raw jsonl|raw_jsonl|provider sse|stdout|stderr|cloudflare|cf-ray)\b|<!doctype\s+html|<html\b|attention required)/i.test(compact);
}

function looksLikeFailureDiagnostic(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  if (/(?:^|[\s;,{])(?:failureReason|selfHealReason|recoverActions?|nextStep|stderrRef|stdoutRef|traceRef|execution-failed)\s*[:=]/i.test(compact)) return true;
  if (/(?:超时|timed out|timeout)/i.test(compact) && /(?:SciForge project tool|项目工具|流式面板|stream|AgentServer|Workspace Runtime)/i.test(compact)) return true;
  if (/工作过程摘要:/.test(compact) && /(?:超时|timeout|failed|失败|AgentServer|Workspace Runtime|项目工具|后端|stream)/i.test(compact)) return true;
  if (/(?:失败原因|错误输出|标准输出|恢复动作|执行失败|生成请求失败)/.test(compact)
    && /(?:stderr|stdout|trace|recover|retry|execution|AgentServer|workspace|tool|重试|恢复|执行单元)/i.test(compact)) {
    return true;
  }
  return false;
}

function looksLikeTracebackDiagnostic(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  if (/traceback \(most recent call last\):/i.test(compact)
    && /\b(?:file ["'][^"']+["'], line \d+|raise |exception|error|urllib3|requests|http\.client)\b/i.test(compact)) {
    return true;
  }
  if (/^(?:the above exception was the direct cause|during handling of the above exception)/i.test(compact)) return true;
  if (/\b(?:urllib3|requests|http\.client)\.exceptions\.[A-Za-z]+Error\b/i.test(compact)) return true;
  if (/\b(?:MaxRetryError|ProxyError|RemoteDisconnected|ConnectionError|TimeoutError|HTTPError)\b/i.test(compact)
    && /\b(?:Traceback|File ["']|line \d+|exception|request|connection|proxy|http)\b/i.test(compact)) {
    return true;
  }
  return false;
}

function looksLikeSystemEnvelope(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  return /^(?:received|tool\s*payload|toolpayload|raw\s+(?:payload|response|output)|backend event|runtime event)\b\s*[:：-]?/i.test(compact)
    || /\b(?:received|toolpayload|tool payload)\b.*\b(?:claimType|executionUnits|toolOutput|verificationResults|recoverActions)\b/i.test(compact);
}

function looksLikeRuntimeMetadataBlock(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact || hasInlineObjectReference(compact)) return false;
  const metadataMatches = compact.match(/\b(?:confidence|claimType|executionUnit|executionUnits|verification|runId|taskId|backend|model|routeDecision|toolPayload|stdoutRef|stderrRef|traceRef|schema|validation|budget|retry|repair|provenance|defaultExpandedSections|diagnosticsRefs)\b\s*[:=]/gi) ?? [];
  if (metadataMatches.length >= 2) return true;
  return /\b(?:verification|校验|验证)\s*[:：]/i.test(compact) && /\b(?:received|toolpayload|tool payload|confidence|claimType)\b/i.test(compact);
}

function looksLikeProcessTranscript(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3 || hasInlineObjectReference(text)) return false;
  const processLines = lines.filter((line) => /^(?:[-*]\s*)?(?:let me|i need to|i(?:'ll| will) |now i |next i |checking |checked |edited |created |received |调用|检查|读取|创建|编辑|执行|计划[:：])/i.test(line));
  return processLines.length >= Math.max(3, Math.ceil(lines.length * 0.6));
}

function looksLikeLocalPathListing(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length || hasInlineObjectReference(text)) return false;
  const absolutePathLines = lines.filter((line) => /^(?:[-*]\s*)?(?:\/(?:Applications|Users|Volumes|private|var|tmp)\/|[A-Za-z]:\\)/.test(line));
  const pathHeavyLines = lines.filter((line) => /(?:\/(?:Applications|Users|Volumes|private|var|tmp)\/|[A-Za-z]:\\|(?:^|\s)(?:\.{1,2}\/)?(?:[\w .-]+\/){2,}[\w .-]+\.[A-Za-z0-9]{1,12})(?!\w)/.test(line));
  const projectContextPathLines = lines.filter((line) => /\/Applications\/(?:workspace|project context)\//i.test(line));
  if (absolutePathLines.length >= 2 || projectContextPathLines.length >= 2) return true;
  return pathHeavyLines.length >= 4 && pathHeavyLines.length >= Math.ceil(lines.length * 0.6);
}

function looksLikeRedactedPathPlanningLeak(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  const redactedPathCount = compact.match(/\[local path\]/gi)?.length ?? 0;
  return redactedPathCount >= 2 && /\b(?:let me|i(?:'ll| will)|now|check|read|inspect|look|open)\b/i.test(compact);
}

function hasInlineObjectReference(text: string) {
  return /\b(?:artifact|file|verification|claim|view|dataset|table|figure|image|notebook|diff|run|execution-unit)::[^\s),.;]+/i.test(text);
}

function stripCodeFence(text: string) {
  return text.replace(/^```[A-Za-z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

function headingText(text: string) {
  return text.replace(/^#{1,6}\s+/, '').trim();
}

function labelForEvidence(evidenceType: FinalMessageAuditSection['evidenceType']) {
  if (evidenceType === 'execution-audit') return 'Process';
  return 'Details';
}

function auditSectionsSummary(sections: FinalMessageAuditSection[]) {
  const counts = sections.reduce((memo, section) => {
    memo[section.evidenceType] = (memo[section.evidenceType] ?? 0) + 1;
    return memo;
  }, {} as Record<FinalMessageAuditSection['evidenceType'], number>);
  return [
    counts['execution-audit'] ? `${counts['execution-audit']} process` : '',
    counts['tool-output'] ? `${counts['tool-output']} details` : '',
    counts['raw-json'] ? `${counts['raw-json']} details` : '',
    counts['log-output'] ? `${counts['log-output']} details` : '',
    counts['raw-trace'] ? `${counts['raw-trace']} details` : '',
  ].filter(Boolean).join(' · ') || `${sections.length} details`;
}

function compactAuditFallback(text: string, evidenceType: FinalMessageAuditSection['evidenceType']) {
  const compact = stripCodeFence(text).replace(/\s+/g, ' ').trim();
  const humanText = extractHumanTextFromRawPayload(text);
  if (humanText) return humanText;
  if (looksLikeFailureDiagnostic(compact)) {
    return 'The task did not finish. Details and recovery hints are folded below.';
  }
  if (looksLikeTracebackDiagnostic(compact)) {
    return 'The task did not finish. Error details are folded below.';
  }
  if (looksLikeRuntimeAuditLogBlock(compact)) {
    return 'The task returned additional details. Expand below to inspect them.';
  }
  if (looksLikeLocalPathListing(text)) {
    return 'The answer references project context. Details are folded below.';
  }
  return `The task returned ${labelForEvidence(evidenceType)}. ${compact.slice(0, 220)}${compact.length > 220 ? '...' : ''}`;
}

function safeAuditLabel(label: string | undefined, evidenceType: FinalMessageAuditSection['evidenceType']) {
  const compact = (label ?? '').replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
  if (!compact) return labelForEvidence(evidenceType);
  if (/raw|jsonl?|stdout|stderr|tool\s*output|tool\s*payload|payload|trace|debug|audit|provider|runtime|backend|execution\s*units?|executionunit|ConversationProjection|ArtifactDelivery/i.test(compact)) {
    return labelForEvidence(evidenceType);
  }
  if (/执行|过程|验证|恢复|诊断|线索/.test(compact)) return labelForEvidence(evidenceType);
  return labelForEvidence(evidenceType);
}

function extractHumanTextFromRawPayload(text: string) {
  const json = stripCodeFence(text).trim();
  if (!/^[{[]/.test(json)) return '';
  try {
    const parsed = JSON.parse(json) as unknown;
    const candidate = findHumanPayloadText(parsed, 0);
    if (!candidate) return '';
    const compact = candidate.trim();
    if (!compact || looksLikeFailureDiagnostic(compact) || looksLikeSystemEnvelope(compact)) return '';
    return compact;
  } catch {
    return '';
  }
}

function findHumanPayloadText(value: unknown, depth: number): string {
  if (!value || depth > 3) return '';
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findHumanPayloadText(item, depth + 1);
      if (candidate) return candidate;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'answer', 'finalAnswer', 'summary', 'result', 'output', 'content', 'text']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && isHumanPayloadText(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = findHumanPayloadText(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  for (const key of Object.keys(record)) {
    const nested = findHumanPayloadText(record[key], depth + 1);
    if (nested) return nested;
  }
  return '';
}

function isHumanPayloadText(value: string) {
  const compact = value.trim();
  if (compact.length < 12) return false;
  if (/^[{[]/.test(compact)) return false;
  if (/^(?:received|toolpayload|raw payload|stdout|stderr)\b/i.test(compact)) return false;
  return /[A-Za-z\u4e00-\u9fff]/.test(compact);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
