import type {
  ResearchIntent,
  ResearchPaper,
  ResearchWebResult
} from './types.js';

export type ThemeCluster = {
  name: string;
  papers: string[];
  summary: string;
};

export function mergeAndRankPapers(input: {
  papers: ResearchPaper[];
  query: string;
  intent: ResearchIntent;
  maxResults: number;
}): ResearchPaper[] {
  const merged = new Map<string, ResearchPaper>();
  for (const paper of input.papers) {
    if (!paper.title.trim()) continue;
    const key = paperKey(paper);
    const existing = merged.get(key);
    merged.set(key, existing ? mergePaper(existing, paper) : normalizePaper(paper));
  }
  return [...merged.values()]
    .map((paper) => ({
      ...paper,
      relevanceReason: paper.relevanceReason ?? relevanceReason(paper, input.query)
    }))
    .sort((a, b) => scorePaper(b, input.query, input.intent) - scorePaper(a, input.query, input.intent))
    .slice(0, input.maxResults);
}

export function mergeAndRankWebResults(input: {
  webResults: ResearchWebResult[];
  maxResults: number;
}): ResearchWebResult[] {
  const merged = new Map<string, ResearchWebResult>();
  for (const result of input.webResults) {
    if (!result.title.trim() || !result.url.trim()) continue;
    const key = webResultKey(result.url);
    const existing = merged.get(key);
    if (!existing || result.rank < existing.rank) {
      merged.set(key, {
        ...result,
        title: result.title.replace(/\s+/g, ' ').trim(),
        snippet: result.snippet?.replace(/\s+/g, ' ').trim()
      });
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, input.maxResults);
}

export function buildThemeClusters(papers: readonly ResearchPaper[]): ThemeCluster[] {
  const clusters = [
    {
      name: 'Foundation models and representation learning',
      pattern: /\b(foundation|pretrain|pre-train|language model|transformer|embedding|representation)\b/i
    },
    {
      name: 'Generative modeling',
      pattern: /\b(diffusion|generative|generation|inverse design|flow matching|vae|gan)\b/i
    },
    {
      name: 'Simulation and surrogate modeling',
      pattern: /\b(simulation|surrogate|pde|physics-informed|operator learning|neural operator)\b/i
    },
    {
      name: 'Benchmarks, datasets, and evaluation',
      pattern: /\b(benchmark|dataset|evaluation|leaderboard|baseline)\b/i
    }
  ];
  return clusters
    .map((cluster) => {
      const matched = papers
        .filter((paper) => cluster.pattern.test(textForPaper(paper)))
        .slice(0, 6)
        .map((paper) => paper.title);
      return {
        name: cluster.name,
        papers: matched,
        summary: matched.length
          ? `${matched.length} result(s) mention ${cluster.name.toLowerCase()}.`
          : ''
      };
    })
    .filter((cluster) => cluster.papers.length > 0);
}

export function buildInitialGaps(input: {
  papers: readonly ResearchPaper[];
  webResults: readonly ResearchWebResult[];
}): string[] {
  const gaps = [];
  const recentWithoutVenue = input.papers.filter((paper) => !paper.venue && (paper.year ?? 0) >= 2024).length;
  if (recentWithoutVenue > 0) {
    gaps.push('Several recent results are preprints or lack venue metadata; verify peer review status before treating them as established baselines.');
  }
  if (input.papers.length > 0 && input.papers.every((paper) => (paper.citationCount ?? 0) < 50)) {
    gaps.push('Citation signals are still weak for this result set; prioritize method details and benchmark coverage over citation count.');
  }
  if (input.webResults.length === 0) {
    gaps.push('No web results were available; code, project pages, and benchmark sites may require a configured web search provider.');
  }
  return gaps.slice(0, 4);
}

export function buildSuggestedFollowups(input: {
  query: string;
  intent: ResearchIntent;
  papers: readonly ResearchPaper[];
}): string[] {
  const topTerms = keywordCandidates(input.papers).slice(0, 3);
  const followups = [
    `${input.query} benchmark comparison`,
    `${input.query} open source implementation`,
    `${input.query} limitations future work`
  ];
  for (const term of topTerms) {
    followups.push(`${input.query} ${term}`);
  }
  if (input.intent === 'latest') followups.unshift(`${input.query} 2026`);
  return [...new Set(followups)].slice(0, 6);
}

function mergePaper(a: ResearchPaper, b: ResearchPaper): ResearchPaper {
  return normalizePaper({
    ...a,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    year: a.year ?? b.year,
    venue: a.venue ?? b.venue,
    abstract: longer(a.abstract, b.abstract),
    tldr: a.tldr ?? b.tldr,
    arxivId: a.arxivId ?? b.arxivId,
    doi: a.doi ?? b.doi,
    semanticScholarId: a.semanticScholarId ?? b.semanticScholarId,
    citationCount: Math.max(a.citationCount ?? 0, b.citationCount ?? 0) || undefined,
    url: a.url ?? b.url,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    source: [...new Set([...a.source, ...b.source])]
  });
}

function normalizePaper(paper: ResearchPaper): ResearchPaper {
  return {
    ...paper,
    title: normalizeTitle(paper.title),
    authors: paper.authors.map((author) => author.trim()).filter(Boolean),
    source: [...new Set(paper.source)]
  };
}

function paperKey(paper: ResearchPaper): string {
  if (paper.arxivId) return `arxiv:${paper.arxivId.toLowerCase()}`;
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper.semanticScholarId) return `s2:${paper.semanticScholarId}`;
  return `title:${normalizeTitle(paper.title).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function scorePaper(paper: ResearchPaper, query: string, intent: ResearchIntent): number {
  const text = textForPaper(paper).toLowerCase();
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const lexical = terms.reduce((score, term) => score + (text.includes(term) ? 3 : 0), 0);
  const recency = paper.year ? Math.max(0, paper.year - 2019) : 0;
  const citation = Math.log10((paper.citationCount ?? 0) + 1) * 4;
  const venue = paper.venue ? 2 : 0;
  const tldr = paper.tldr ? 1 : 0;
  const intentBoost = intent === 'latest'
    ? recency * 1.5
    : intent === 'baseline' || intent === 'sota'
      ? citation + venue
      : 0;
  return lexical + recency + citation + venue + tldr + intentBoost;
}

function relevanceReason(paper: ResearchPaper, query: string): string {
  const matching = meaningfulTerms(query)
    .filter((term) => textForPaper(paper).toLowerCase().includes(term.toLowerCase()))
    .slice(0, 5);
  return matching.length > 0
    ? `Matches query terms: ${matching.join(', ')}.`
    : 'Retrieved by a configured research source for this query.';
}

function meaningfulTerms(query: string): string[] {
  const stop = new Set([
    'model',
    'models',
    'latest',
    'recent',
    'advance',
    'advances',
    'review',
    'survey',
    '2024',
    '2025',
    '2026',
    'and',
    'for',
    'with',
    'the',
    'science',
    'biology',
    'computational',
    'foundation'
  ]);
  return query.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stop.has(term));
}

function textForPaper(paper: ResearchPaper): string {
  return [paper.title, paper.abstract, paper.tldr, paper.venue].filter(Boolean).join(' ');
}

function longer(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function webResultKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    const normalized = url.toString().replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function keywordCandidates(papers: readonly ResearchPaper[]): string[] {
  const text = papers.map(textForPaper).join(' ').toLowerCase();
  const candidates = [
    'foundation model',
    'diffusion',
    'benchmark',
    'molecular generation',
    'protein design',
    'neural operator',
    'materials discovery'
  ];
  return candidates.filter((candidate) => text.includes(candidate));
}
