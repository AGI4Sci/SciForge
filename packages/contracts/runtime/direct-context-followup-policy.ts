export interface DirectContextLiteratureReportRowPolicyInput {
  title: string;
  year?: string;
  url?: string;
  evidenceLocation?: string;
  fullTextStatus?: string;
  summary?: string;
}

export function directContextLiteratureNoResultScope(sourceText: string, requestText: string) {
  const text = `${sourceText}\n${requestText}`;
  const source = /\barxiv\b/i.test(text)
    ? 'arXiv'
    : /\bpubmed\b/i.test(text)
      ? 'PubMed'
      : /\bbiorxiv\b/i.test(text)
        ? 'bioRxiv'
        : 'provider';
  const conditionLabel = /\btoday\b|今天|submitted on|提交于/i.test(text) ? '当前日期窗口下' : '请求条件下';
  return {
    conditionLabel,
    sourceEvidenceLabel: source === 'arXiv' ? ' arXiv abs/PDF ' : ` ${source} 论文/PDF `,
    sourceRetryLabel: source === 'provider' ? '相关 provider' : ` ${source}`,
    englishScope: source === 'provider' ? 'the requested provider/query scope' : `the requested ${source} query/date scope`,
    englishEvidenceLabel: source === 'arXiv' ? 'arXiv abs/PDF link' : `${source} paper/PDF link`,
    englishRetryLabel: source === 'provider' ? 'the relevant provider query' : `${source}`,
  };
}

export function directContextTextAsksFullTextEvidenceStatus(text: string) {
  return /(PDF|full[-\s]?text|fulltext|arXiv|全文|全文证据|PDF证据|全文调研|论文全文|原文|读取|阅读|已读|读完|downloaded?|retrieved?|citation verification|引用验证|引文验证|文献验证|证据位置|页码|段落)/i.test(text);
}

export function directContextTextWantsChinese(text: string) {
  return /[一-龥]/.test(text) || /\b(?:answer|write|respond|summari[sz]e|report)\s+in\s+Chinese\b|\bChinese\s+(?:answer|response|summary|report)\b|中文|汉语|普通话/i.test(text);
}

export function directContextSelectedLiteratureReportBasisLines(sourceText: string) {
  return uniqueStrings(sourceText
    .split(/[\n\r]+|(?<=[。.!?；;])\s+/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\s+/g, ' '))
    .filter((line) => /(无可确认|未能确认|最新论文列表|PDF|全文|证据位置|HTTP\s*429|arXiv|provider|diagnostic|局限|limitations?)/i.test(line))
    .filter((line) => line.length > 0 && line.length <= 260))
    .slice(0, 4);
}

export function directContextEvidenceStatusSourceLines(sourceText: string) {
  const lines = sourceText
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => /(provider|metadata|full[-\s]?text|PDF|arXiv|citation|verification|verified|unverified|全文|读取|阅读|验证)/i.test(line))
    .filter((line) => line.length > 0 && line.length <= 260);
  return uniqueStrings(lines).slice(0, 3);
}

export function directContextIsLiteraturePaperRow(row: DirectContextLiteratureReportRowPolicyInput) {
  if (/(provider search|web_search|browser_fetch|source fetch|fetch status|called provider|normalized \d+ candidate|检索通道)/i.test(row.title)) {
    return false;
  }
  if (row.url && !/^https?:\/\//i.test(row.url)) return false;
  if (row.fullTextStatus && !/(PDF|PDF\/full-text|full[-\s]?text|download|reach|extract|unavailable|not confirmed|failed|provider|candidate)/i.test(row.fullTextStatus)) return false;
  const text = `${row.title}\n${row.year ?? ''}\n${row.url ?? ''}\n${row.evidenceLocation ?? ''}\n${row.fullTextStatus ?? ''}\n${row.summary ?? ''}`;
  return /(arxiv|pubmed|doi\b|pmid\b|pdf|full[-\s]?text|published|20\d{2}|论文|文献)/i.test(text);
}

export function directContextLiteratureFullTextStatus(status: string) {
  const pdfUrl = status.match(/https?:\/\/\S+/i)?.[0]?.replace(/[).,;，。]+$/, '');
  if (/candidate link found|candidate URL inferred/i.test(status)) {
    return pdfUrl ? `已发现候选 PDF/全文链接（${pdfUrl}），仍建议做逐篇全文核验。` : '已发现候选 PDF/全文链接，仍建议做逐篇全文核验。';
  }
  if (/likely reachable/i.test(status)) return 'provider URL 显示 PDF/全文大概率可达，但本轮 bounded run 未下载或逐段核验。';
  if (/not confirmed|unavailable|failed|no PDF/i.test(status)) return '本轮未确认 PDF/全文可用性；需后续 PDF 提取或网页抓取验证。';
  return status || '当前 report 未写明 PDF/full-text 状态。';
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
