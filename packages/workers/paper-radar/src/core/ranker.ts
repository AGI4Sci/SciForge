import { DEFAULT_PROFILE, ProfileStore } from './profiles.js';
import { PaperStore } from './storage.js';
import type { DigestRequest, RankedPaper, RankRequest, SearchRequest, TopicProfile } from './types.js';

export function rankPapers(store: PaperStore, profiles: ProfileStore, request: RankRequest | DigestRequest): RankedPaper[] {
  const profile = profiles.get(request.profile);
  const keywords = unique([...(profile.keywords ?? []), ...(request.keywords ?? [])]);
  const excludeKeywords = unique([...(profile.excludeKeywords ?? []), ...(request.excludeKeywords ?? [])]);
  const categories = unique([...(profile.arxivCategories ?? []), ...(profile.biorxivSubjects ?? []), ...(request.categories ?? [])]);
  const topK = clampTopK(request.topK);
  const from = request.from ?? daysAgo(request.days ?? 30);
  const query = request.query ?? keywords.join(' ');
  const candidates = store.search({
    query,
    sources: request.sources,
    categories,
    from,
    to: request.to,
    topK: Math.max(100, topK * 8),
  } satisfies SearchRequest);

  return candidates
    .map((paper) => scorePaper(paper, profile, keywords, excludeKeywords))
    .filter((paper) => paper.score > 0)
    .sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, topK);
}

export function profileSyncCategories(profile: TopicProfile): string[] {
  return profile.arxivCategories.length ? profile.arxivCategories : DEFAULT_PROFILE.arxivCategories;
}

function scorePaper(
  paper: RankedPaper,
  profile: TopicProfile,
  keywords: string[],
  excludeKeywords: string[],
): RankedPaper {
  const title = paper.title.toLowerCase();
  const abstract = paper.abstract.toLowerCase();
  const metadata = [...paper.categories, ...paper.subjects].join(' ').toLowerCase();
  const haystack = `${title} ${abstract} ${metadata}`;
  const excluded = excludeKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  if (excluded.length) {
    return { ...paper, score: 0, relevance: 'low', reason: `Excluded by keywords: ${excluded.slice(0, 3).join(', ')}.` };
  }

  const keywordHits = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  const titleHits = keywordHits.filter((keyword) => title.includes(keyword.toLowerCase()));
  const categoryHits = [...profile.arxivCategories, ...profile.biorxivSubjects].filter((category) =>
    metadata.includes(category.toLowerCase()),
  );
  const sourceBonus = paper.source === 'biorxiv' && profile.biorxivSubjects.length > 0 ? 2 : 0;
  const recencyBonus = recencyScore(paper.publishedAt);
  const score = paper.score + keywordHits.length * 4 + titleHits.length * 4 + categoryHits.length * 2 + sourceBonus + recencyBonus;
  const relevance = score >= 16 ? 'high' : score >= 8 ? 'medium' : 'low';
  const reasons: string[] = [];
  if (keywordHits.length) reasons.push(`Matched keywords: ${keywordHits.slice(0, 5).join(', ')}`);
  if (categoryHits.length) reasons.push(`Matched profile categories: ${categoryHits.slice(0, 5).join(', ')}`);
  if (recencyBonus >= 2) reasons.push('Recent paper');
  return {
    ...paper,
    score,
    relevance,
    reason: reasons.length ? `${reasons.join('. ')}.` : 'Matched the profile metadata.',
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampTopK(value?: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.floor(value as number)));
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(1, Math.min(365, Math.floor(days))));
  return date.toISOString().slice(0, 10);
}

function recencyScore(publishedAt: string): number {
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return 0;
  const days = (Date.now() - time) / 86_400_000;
  if (days <= 7) return 4;
  if (days <= 30) return 2;
  if (days <= 90) return 1;
  return 0;
}
