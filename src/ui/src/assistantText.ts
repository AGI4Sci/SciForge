export function joinAssistantTextFragments(fragments: string[]): string {
  return normalizeAssistantProseForDisplay(fragments.reduce((joined, fragment) => {
    if (!fragment) return joined;
    if (!joined) return fragment;
    return `${joined}${assistantTextBoundary(joined, fragment)}${fragment}`;
  }, ''));
}

export function normalizeAssistantProseForDisplay(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let inFence = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(joinSoftWrappedProseLines(paragraph));
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flushParagraph();
      output.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      if (output.at(-1) !== '') output.push('');
      continue;
    }
    if (isStandaloneMarkdownBlockLine(line)) {
      flushParagraph();
      output.push(...repairStandaloneMarkdownBlockLine(line));
      continue;
    }
    if (/^\*\*/.test(trimmed) && paragraph.length && /[.!?。！？]$/.test(paragraph.at(-1) ?? '')) {
      flushParagraph();
      if (output.at(-1) !== '') output.push('');
    }
    paragraph.push(trimmed);
  }

  flushParagraph();
  return paragraphizeDenseAssistantText(output.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')).trim();
}

function repairStandaloneMarkdownBlockLine(line: string) {
  return splitDenseInlineNumberedList(line)
    .flatMap(splitDenseSectionCueLine)
    .map(repairSplitLatinIdentifiers);
}

function splitDenseInlineNumberedList(line: string) {
  const trimmed = line.trim();
  if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return [line];
  if (!/[，,；;]\s*(?:\d+[.)]|[一二三四五六七八九十]+[、.)])\s+/.test(line)) return [line];
  const leading = line.match(/^\s*/)?.[0] ?? '';
  return trimmed
    .replace(/[，,；;]\s*((?:\d+[.)]|[一二三四五六七八九十]+[、.)])\s+)/g, '\n$1')
    .split('\n')
    .map((part, index) => index === 0 ? `${leading}${part}` : `${leading}${part.trim()}`)
    .filter(Boolean);
}

function splitDenseSectionCueLine(line: string) {
  const pattern = new RegExp(`([。！？.!?])\\s*(${DENSE_SECTION_CUES.join('|')})(?=\\s*[-:：A-Za-z0-9]|[\\u3400-\\u9fff])`, 'g');
  if (!pattern.test(line)) return [line];
  return line
    .replace(pattern, '$1\n\n$2')
    .split('\n');
}

function joinSoftWrappedProseLines(lines: string[]) {
  const joined = lines.reduce((text, line) => {
    if (!text) return line;
    return `${text}${assistantTextBoundary(text, line)}${line}`;
  }, '');
  return repairSplitLatinIdentifiers(joined);
}

function repairSplitLatinIdentifiers(text: string) {
  let repaired = text;
  for (const [pattern, replacement] of TECHNICAL_IDENTIFIER_REPAIRS) {
    repaired = repaired.replace(pattern, replacement);
  }
  return repaired
    .replace(/\s*(?:\[local path\]|\[local-path\]|\[redacted-path\])\s*/gi, ' ')
    .replace(/\*\*[ \t]+([^*\n][^*\n]*?)[ \t]*\*\*/g, '**$1**')
    .replace(/\*\*([^*\n]*?[^*\n \t])[ \t]+\*\*/g, '**$1**')
    .replace(/__[ \t]+([^_\n][^_\n]*?)[ \t]*__/g, '__$1__')
    .replace(/__([^_\n]*?[^_\n \t])[ \t]+__/g, '__$1__')
    .replace(/\b([A-Za-z]{3,})\s+(ed|ing|tion|sion|ment|ness|able|ible|ally|ization|isation|ality|ility|ance|ence|ative|itive|ored|val)\b/g, '$1$2')
    .replace(/([\u3400-\u9fff])([A-Za-z0-9<])/g, '$1 $2')
    .replace(/([A-Za-z0-9_\]\)>-])([\u3400-\u9fff])/g, '$1 $2');
}

function paragraphizeDenseAssistantText(content: string) {
  const lines = content.split('\n');
  const output: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      output.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || isStandaloneMarkdownBlockLine(line)) {
      output.push(line);
      continue;
    }
    output.push(...repairDenseProseLine(line));
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function repairDenseProseLine(line: string) {
  if (line.length < 120) return [line];
  const repaired = line
    .replace(/([，,。！？.!?])\s*((?:\d+[.)]|[一二三四五六七八九十]+[、.)])\s+)/g, '$1\n\n$2')
    .replace(
      new RegExp(`([。！？.!?])\\s*(${DENSE_SECTION_CUES.join('|')})(?=\\s*[-:：A-Za-z0-9]|[\\u3400-\\u9fff])`, 'g'),
      '$1\n\n$2',
    );
  return repaired.split('\n');
}

const DENSE_SECTION_CUES = [
  '核心理念',
  '独特性',
  '架构特性',
  '典型用途',
  '使用方式',
  '设计原则',
  '注意事项',
  '下一步',
  '总结',
  '结论',
  '答案',
  '要点',
  '验证',
  '实现',
  '风险',
];

const TECHNICAL_IDENTIFIER_REPAIRS: Array<[RegExp, string]> = [
  [/\bSci\s+Forge\b/g, 'SciForge'],
  [/\bSciFor\s+ge\b/g, 'SciForge'],
  [/\bC\s+ursor\b/g, 'Cursor'],
  [/\bG\s+UI\b/g, 'GUI'],
  [/\bT\s+UI\b/g, 'TUI'],
  [/\bCode\s+x\b/g, 'Codex'],
  [/\bCap\s+ability\b/g, 'Capability'],
  [/\bcap\s+ability\b/g, 'capability'],
  [/\bBro\s+ker\b/g, 'Broker'],
  [/\bdis\s+covery\b/g, 'discovery'],
  [/\bc\s+apability\b/g, 'capability'],
  [/\bsub\s*[‑-]\s*agent\b/gi, 'sub-agent'],
  [/\bRun\s+Execution\s*Process\b/g, 'RunExecutionProcess'],
  [/\bCursor\s+Agent\s+Process\b/g, 'CursorAgentProcess'],
  [/\bCursor\s+AgentProcess\s+Group\b/g, 'CursorAgentProcessGroup'],
  [/\bCursorAgent\s+Action\b/g, 'CursorAgentAction'],
  [/\bCursorAgent\s+ActionRow\b/g, 'CursorAgentActionRow'],
  [/\bCurs\s+onAgent\s+ActionRow\b/g, 'CursorAgentActionRow'],
  [/\bcursor\s+AgentProcess\b/g, 'cursorAgentProcess'],
  [/\bbuild\s+CursorAgent\s+Process\b/g, 'buildCursorAgentProcess'],
  [/\bsplit\s*Final\s+Message\s+Presentation\b/g, 'splitFinalMessagePresentation'],
  [/\bsplitFinal\s+Message\s+Presentation\b/g, 'splitFinalMessagePresentation'],
  [/\bfinal\s+Message\s+Presentation\b/g, 'finalMessagePresentation'],
  [/\baudit\s+Sections\b/g, 'auditSections'],
  [/\binit\s+iallyExp\s+anded\b/g, 'initiallyExpanded'],
  [/\bObject\s+Reference\b/g, 'ObjectReference'],
  [/\bobjectReference\s+For\s+CursorAction\b/g, 'objectReferenceForCursorAction'],
  [/\bonObject\s+Focus\b/g, 'onObjectFocus'],
  [/\bfocus\s+Reference\b/g, 'focusReference'],
  [/\bfile\s+Path\b/g, 'filePath'],
  [/\bfile\s+Ref\b/g, 'fileRef'],
  [/\bpresentation\s+Role\b/g, 'presentationRole'],
  [/\bfocus\s*-\s*right\s*-\s*p\s*ane\b/g, 'focus-right-pane'],
  [/\bdata\s*-\s*scif\s*orge\s*-\s*reference\b/g, 'data-sciforge-reference'],
  [/\bdiagn\s+ostic\b/g, 'diagnostic'],
  [/\bche\s+vron\b/g, 'chevron'],
  [/\boperation\s+Kind\b/g, 'operationKind'],
  [/\binitially\s+Expanded\b/g, 'initiallyExpanded'],
  [/\bdiff\s+Ref\b/g, 'diffRef'],
  [/\bexecution\s+log\s+Ref\b/g, 'executionLogRef'],
  [/\bfile\s+Ref\b/g, 'fileRef'],
  [/\bkeep\s*[‑-]\s*al\s*ive\b/gi, 'keep-alive'],
  [/\b([A-Za-z]+)\s+_([A-Za-z]+)\b/g, '$1_$2'],
  [/<([A-Za-z][A-Za-z0-9-]*)\s+>/g, '<$1>'],
  [/\bCursor\s+Agent\b/g, 'Cursor Agent'],
  [/\bfinal\s*-\s*answer\s*-\s*pro\s*se\b/gi, 'final-answer-prose'],
  [/\bfinal\s*-\s*m\s*essage\s*-\s*a\s*udit\s*-\s*fold\b/gi, 'final-message-audit-fold'],
  [/\bworked\s+\/\s*explored\b/gi, 'worked/explored'],
  [/\bcom\s+pleted\b/gi, 'completed'],
  [/\bf\s+ailed\b/gi, 'failed'],
  [/\bAgent\s+Server\b/g, 'AgentServer'],
  [/\bUI\s*Manifest\b/g, 'UIManifest'],
  [/\bDeep\s+Seek\b/g, 'DeepSeek'],
  [/\bOpen\s+AI\b/g, 'OpenAI'],
  [/\bJSON\s+L\b/g, 'JSONL'],
];

function assistantTextBoundary(left: string, right: string) {
  const leftText = left.trimEnd();
  const rightText = right.trimStart();
  if (!leftText || !rightText || /\s$/.test(left) || /^\s/.test(right)) return '';
  if (/^\*\*$/.test(leftText)) return '';
  if (/[\u3400-\u9fff]$/.test(leftText) && /^\*\*/.test(rightText)) return '';
  if (/\*\*$/.test(leftText) && /^[A-Za-z0-9\u3400-\u9fff]/.test(rightText)) return ' ';
  if (/[（【《〈「『([{]$/.test(leftText)) return '';
  if (/^[，。！？；：、）】》〉」』,.!?;:%)\]}]/.test(rightText)) return '';
  if (/[0-9]$/.test(leftText) && /^[–—-]/.test(rightText)) return '';
  if (/[–—-]$/.test(leftText) && /^[0-9]/.test(rightText)) return '';
  if (/[\u3400-\u9fff]$/.test(leftText) || /^[\u3400-\u9fff]/.test(rightText)) return '';
  return ' ';
}

function isStandaloneMarkdownBlockLine(line: string) {
  const trimmed = line.trim();
  return /^#{1,6}\s+/.test(trimmed)
    || /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)
    || /^\s*\|.*\|\s*$/.test(line);
}
