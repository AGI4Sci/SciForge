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

type ContentBlock = {
  text: string;
  kind: 'heading' | 'code' | 'paragraph' | 'list' | 'table';
  language?: string;
};

export function splitFinalMessagePresentation(content: string): FinalMessagePresentation {
  const blocks = parseContentBlocks(content);
  const primary: string[] = [];
  const auditSections: FinalMessageAuditSection[] = [];
  let pendingAuditHeading = '';

  for (const block of blocks) {
    const decision = classifyFinalMessageBlock(block, pendingAuditHeading);
    if (decision.fold) {
      auditSections.push({
        label: decision.label,
        text: block.text,
        evidenceType: decision.evidenceType,
        importance: decision.importance,
      });
      if (block.kind !== 'heading') pendingAuditHeading = '';
      continue;
    }
    if (decision.auditHeading) {
      pendingAuditHeading = headingText(block.text);
      continue;
    }
    pendingAuditHeading = '';
    primary.push(block.text);
  }

  if (!primary.join('\n').trim() && auditSections.length) {
    const first = auditSections[0];
    if (first) primary.push(compactAuditFallback(first.text, first.evidenceType));
  }

  return {
    primaryContent: primary.join('\n\n').trim(),
    auditSections,
    summary: auditSectionsSummary(auditSections),
  };
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
  const headingAudit = (block.kind === 'heading' || /^工作过程摘要[:：]\s*$/i.test(text.trim())) && Boolean(auditEvidenceType(haystack));
  const rawJson = looksLikeRawJson(text);
  const logOutput = looksLikeLogOutput(block.language, text);
  const failureDiagnostic = looksLikeFailureDiagnostic(text);
  const structuralEvidenceType = rawJson ? 'raw-json' : logOutput ? 'log-output' : undefined;
  const evidenceType = block.kind === 'code'
    ? structuralEvidenceType ?? auditEvidenceType(haystack) ?? codeEvidenceType(block.language, text)
    : (failureDiagnostic ? 'execution-audit' : undefined) ?? auditEvidenceType(haystack) ?? structuralEvidenceType ?? codeEvidenceType(block.language, text);
  const fold = Boolean(
    pendingAuditHeading
    || (block.kind === 'code' && (evidenceType || rawJson || logOutput))
    || (block.kind !== 'heading' && failureDiagnostic)
    || (block.kind !== 'heading' && evidenceType && text.length > 240)
  );
  return {
    fold,
    auditHeading: headingAudit,
    label: pendingAuditHeading || labelForEvidence(evidenceType ?? (rawJson ? 'raw-json' : logOutput ? 'log-output' : 'tool-output')),
    evidenceType: evidenceType ?? (rawJson ? 'raw-json' : logOutput ? 'log-output' : 'tool-output'),
    importance: evidenceType === 'execution-audit' ? 'diagnostic' : rawJson || logOutput ? 'raw' : 'supporting',
  };
}

function auditEvidenceType(text: string): FinalMessageAuditSection['evidenceType'] | undefined {
  if (/\b(raw trace|trace id|完整 trace|agent trace|reasoning trace)\b/.test(text)) return 'raw-trace';
  if (/\b(execution audit|executionunit|执行审计|执行单元|运行审计|provenance)\b|工作过程摘要|过程记录/.test(text)) return 'execution-audit';
  if (/\b(tool output|tool result|stdout|stderr|terminal output|command output|工具输出|标准输出|错误输出)\b/.test(text)) return 'tool-output';
  return undefined;
}

function codeEvidenceType(language: string | undefined, text: string): FinalMessageAuditSection['evidenceType'] | undefined {
  if (language === 'json' && looksLikeRawJson(text)) return 'raw-json';
  if (language && /^(log|text|stdout|stderr|console|terminal|bash|shell|sh)$/.test(language) && looksLikeLogOutput(language, text)) return 'log-output';
  return undefined;
}

function looksLikeRawJson(text: string) {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  return /"(raw|trace|tool|toolOutput|executionUnits|uiManifest|artifacts|stdout|stderr|auditRefs|recoverActions|failureReason)"\s*:/.test(trimmed);
}

function looksLikeLogOutput(language: string | undefined, text: string) {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 4 && !/stdout|stderr|trace|debug|error/i.test(`${language ?? ''}\n${text}`)) return false;
  const logLines = lines.filter((line) => /^\s*(?:\[[^\]]+\]|(?:debug|info|warn|error|trace)\b|(?:stdout|stderr)\s*:|\$ )/i.test(line));
  return logLines.length >= Math.max(2, Math.ceil(lines.length * 0.4));
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

function stripCodeFence(text: string) {
  return text.replace(/^```[A-Za-z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

function headingText(text: string) {
  return text.replace(/^#{1,6}\s+/, '').trim();
}

function labelForEvidence(evidenceType: FinalMessageAuditSection['evidenceType']) {
  if (evidenceType === 'execution-audit') return '执行审计';
  if (evidenceType === 'raw-trace') return 'Raw trace';
  if (evidenceType === 'raw-json') return 'Raw JSON';
  if (evidenceType === 'log-output') return '日志输出';
  return 'Tool output';
}

function auditSectionsSummary(sections: FinalMessageAuditSection[]) {
  const counts = sections.reduce((memo, section) => {
    memo[section.evidenceType] = (memo[section.evidenceType] ?? 0) + 1;
    return memo;
  }, {} as Record<FinalMessageAuditSection['evidenceType'], number>);
  return [
    counts['execution-audit'] ? `${counts['execution-audit']} 审计` : '',
    counts['tool-output'] ? `${counts['tool-output']} 工具输出` : '',
    counts['raw-json'] ? `${counts['raw-json']} JSON` : '',
    counts['log-output'] ? `${counts['log-output']} 日志` : '',
    counts['raw-trace'] ? `${counts['raw-trace']} trace` : '',
  ].filter(Boolean).join(' · ') || `${sections.length} 条明细`;
}

function compactAuditFallback(text: string, evidenceType: FinalMessageAuditSection['evidenceType']) {
  const compact = stripCodeFence(text).replace(/\s+/g, ' ').trim();
  if (looksLikeFailureDiagnostic(compact)) {
    return '任务未完成，执行诊断、恢复线索和原始输出已折叠在下方，可展开查看后继续追问或重试。';
  }
  return `任务已返回 ${labelForEvidence(evidenceType)}。${compact.slice(0, 220)}${compact.length > 220 ? '...' : ''}`;
}
