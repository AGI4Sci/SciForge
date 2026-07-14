export type TemporalContextInput = {
  nowIso: string
  timeZone: string
  timeSensitiveResearch: boolean
  recoveryAttempted?: boolean
}

const STRONG_TEMPORAL_RESEARCH_RE =
  /\b(?:newly|just|recently)\s+(?:released|launched|announced|published)|\b(?:breaking|latest|recent)\s+news\b|\bnews\s+(?:today|update)\b|\bup[- ]to[- ]date\b|\bas\s+of\s+(?:today|now|\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)\b|\b(?:today|this\s+(?:week|month|year))\b/i

const TEMPORAL_SIGNAL_RE =
  /\b(?:latest|newest|most\s+recent|current|currently|recent|recently|news|release(?:d)?|launch(?:ed)?|announc(?:e|ed|ement))\b/i

const EXTERNAL_RESEARCH_RE =
  /\b(?:research|look\s*up|search|find\s+out|tell\s+me\s+about|what\s+(?:is|are)|who\s+is|which|model|product|version|release|launch|announcement|news|benchmark|price|schedule|law|policy|company|market)\b/i

const LOCAL_WORK_RE =
  /\b(?:file|code|function|class|test|repo(?:sitory)?|workspace|branch|diff|implementation|process|port|runtime|task|blocker|todo)\b/i

const EXTERNAL_TOPIC_RE =
  /\b(?:model|product|version|release|launch|announcement|news|benchmark|price|schedule|law|policy|company|market)\b/i

const STRONG_TEMPORAL_RESEARCH_ZH_RE =
  /最新(?:消息|新闻|发布|版本|进展)?|刚(?:刚)?发布|新近发布|今日|今天|本周|本月|今年|新闻|快讯|截至(?:今天|目前|\d{4}年?)/u

const TEMPORAL_SIGNAL_ZH_RE = /当前|现在|最近|近期|现状|进展|发布|最新/u
const EXTERNAL_RESEARCH_ZH_RE =
  /研究|调研|查(?:找|询|一下)?|搜(?:索|一下)?|了解|介绍|什么|谁|哪(?:个|些)?|发布|模型|产品|版本|新闻|价格|榜单|公司|政策|法规|市场/u
const LOCAL_WORK_ZH_RE = /文件|代码|函数|测试|仓库|工作区|分支|实现|进程|端口|运行时|任务|阻塞|待办/u
const EXTERNAL_TOPIC_ZH_RE = /发布|模型|产品|版本|新闻|价格|榜单|公司|政策|法规|市场/u

/**
 * Identifies requests whose answer can go stale and therefore needs live,
 * cited evidence. The classifier deliberately excludes ordinary local-work
 * status questions such as "current blocker" or "latest test failure".
 */
export function isTimeSensitiveResearchRequest(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  if (STRONG_TEMPORAL_RESEARCH_RE.test(normalized)) {
    return !LOCAL_WORK_RE.test(normalized) || EXTERNAL_TOPIC_RE.test(normalized)
  }
  if (STRONG_TEMPORAL_RESEARCH_ZH_RE.test(normalized)) {
    return !LOCAL_WORK_ZH_RE.test(normalized) || EXTERNAL_TOPIC_ZH_RE.test(normalized)
  }

  const englishMatch = TEMPORAL_SIGNAL_RE.test(normalized) && EXTERNAL_RESEARCH_RE.test(normalized)
  if (englishMatch && (!LOCAL_WORK_RE.test(normalized) || EXTERNAL_TOPIC_RE.test(normalized))) {
    return true
  }
  const chineseMatch = TEMPORAL_SIGNAL_ZH_RE.test(normalized) && EXTERNAL_RESEARCH_ZH_RE.test(normalized)
  return chineseMatch && (!LOCAL_WORK_ZH_RE.test(normalized) || EXTERNAL_TOPIC_ZH_RE.test(normalized))
}

/**
 * A volatile system message that must be sent after the immutable system
 * prefix. Timestamps never belong in `SCIFORGE_RUNTIME_SYSTEM_PROMPT`.
 */
export function buildTemporalContextInstruction(input: TemporalContextInput): string {
  const timeZone = input.timeZone.trim() || 'UTC'
  const localDate = localIsoDate(input.nowIso, timeZone)
  const currentYear = localDate.slice(0, 4)
  const lines = [
    'Volatile temporal context (generated for this model request; not part of the stable cache prefix):',
    `- Current timestamp (ISO 8601): ${input.nowIso}`,
    `- Runtime timezone: ${timeZone}`,
    `- Current local date: ${localDate}`,
    '- Resolve relative dates such as today, latest, and recently against this context. Model-training memory alone is not current evidence.'
  ]

  if (input.timeSensitiveResearch) {
    lines.push(
      '',
      'Time-sensitive research requirements:',
      '- Treat release, product, current-event, status, price, schedule, and news claims as unverified until supported by current tool evidence.',
      `- Include the current date or year (${localDate} / ${currentYear}) in discovery queries when it helps disambiguate freshness.`,
      '- For product releases, make the first query entity-first: organization or vendor + exact product/version + release/announcement + current year. Avoid vague queries such as “new model”.',
      '- Keep discovery bounded: normally use no more than two materially distinct searches and one decisive page fetch before synthesizing.',
      '- For general product, release, or news discovery, prefer the built-in `web_search` tool when it is advertised. Reserve `research_search` for scholarly papers and AI4S literature unless the user explicitly asks for literature.',
      '- Verify the central claim with at least one current primary or official source, then corroborate with another current source when practical. Fetch decisive pages before synthesis.',
      '- Cite the titles and URLs from recorded tool-result `sources` or `citations` metadata. Do not invent a citation from memory.',
      '- A failed tool, an unavailable provider, an empty result set, or not finding a source is absence of evidence, not evidence that an event, release, product, or claim does not exist.',
      '- Never turn “I could not verify this” into a factual denial such as “it was not released.” If current evidence remains unavailable, clearly state what could not be verified and which search/source capability blocked verification.'
    )
  }

  if (input.recoveryAttempted) {
    lines.push(
      '',
      'Temporal evidence recovery (one bounded recovery attempt):',
      '- A proposed final answer was withheld because this time-sensitive request had no usable recorded source or citation evidence.',
      '- Make at most one materially different discovery attempt with an advertised general-web tool. Do not repeat the same failed query or route product/news discovery through scholarly AI4S search.',
      '- If no usable current source is obtained, stop searching and explicitly report that the claim is unverifiable in this run; do not confirm or deny it.'
    )
  }

  return lines.join('\n')
}

export function runtimeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function localIsoDate(nowIso: string, timeZone: string): string {
  const date = new Date(nowIso)
  if (!Number.isFinite(date.getTime())) return nowIso.slice(0, 10) || 'unknown'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const values = new Map(parts.map((part) => [part.type, part.value]))
    const year = values.get('year')
    const month = values.get('month')
    const day = values.get('day')
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // Invalid embedder-provided timezones fall back to the ISO UTC date.
  }
  return nowIso.slice(0, 10)
}
