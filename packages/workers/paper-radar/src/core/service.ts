import { join } from 'node:path';

import { DEFAULT_PROFILE, normalizeTopicProfile, ProfileStore, type ProfileStoreOptions } from './profiles.js';
import { profileSyncCategories, rankPapers } from './ranker.js';
import { fetchArxivMetadata, fetchBiorxivMetadata, type ArxivSyncRequest, type BiorxivSyncRequest } from './sources.js';
import { PaperStore, type SyncStateRecord } from './storage.js';
import type { DigestRequest, PaperRecord, RankedPaper, RankRequest, SearchRequest, SyncResult, TopicProfile } from './types.js';

export interface PaperRadarCoreServiceOptions {
  dbPath: string;
  profilesPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  profileStoreOptions?: ProfileStoreOptions;
}

export interface PaperRadarProfileSyncRequest {
  profile?: string;
  from?: string;
  to?: string;
  maxRecords?: number;
}

export interface PaperRadarProfileSyncPlan {
  source: 'arxiv' | 'biorxiv';
  from: string;
  to: string;
  maxRecords: number;
  categories?: string[];
  subjects?: string[];
}

export interface PaperRadarProfileSyncPlanResult {
  profile: string;
  from: string;
  to: string;
  maxRecords: number;
  planned: PaperRadarProfileSyncPlan[];
}

export interface PaperRadarCoreSearchResult {
  papers: RankedPaper[];
  count: number;
}

export interface PaperRadarCoreRankResult extends PaperRadarCoreSearchResult {
  profile: string;
}

export interface PaperRadarCoreDigestResult extends PaperRadarCoreRankResult {
  generatedAt: string;
}

export interface PaperRadarCoreProfileSyncResult {
  profile: string;
  from: string;
  to: string;
  maxRecords: number;
  results: SyncResult[];
  fetched: number;
  upserted: number;
  skipped: number;
}

export interface PaperRadarCoreService {
  listProfiles(): TopicProfile[];
  getProfile(name?: string): TopicProfile;
  findProfile(name: string): TopicProfile | undefined;
  saveProfile(profile: TopicProfile): TopicProfile;
  planProfileSync(request: PaperRadarProfileSyncRequest): PaperRadarProfileSyncPlanResult;
  syncProfile(request: PaperRadarProfileSyncRequest): Promise<PaperRadarCoreProfileSyncResult>;
  syncArxiv(request: ArxivSyncRequest): Promise<SyncResult>;
  syncBiorxiv(request: BiorxivSyncRequest): Promise<SyncResult>;
  search(request: SearchRequest): PaperRadarCoreSearchResult;
  rank(request: RankRequest): PaperRadarCoreRankResult;
  digest(request: DigestRequest): PaperRadarCoreDigestResult;
  stats(): { papers: number; arxiv: number; biorxiv: number };
  getSyncState(source: 'arxiv' | 'biorxiv', key: string): string | undefined;
  listSyncState(): SyncStateRecord[];
  getPaper(id: string): RankedPaper | undefined;
  listRecentPapers(limit?: number): RankedPaper[];
  close(): void;
}

export function createPaperRadarCoreService(options: PaperRadarCoreServiceOptions): PaperRadarCoreService {
  return new LocalPaperRadarCoreService(options);
}

class LocalPaperRadarCoreService implements PaperRadarCoreService {
  private readonly store: PaperStore;
  private readonly profiles: ProfileStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: PaperRadarCoreServiceOptions) {
    this.store = new PaperStore(options.dbPath);
    this.profiles = new ProfileStore(
      options.profilesPath ?? join(options.dbPath, '..', 'profiles.json'),
      options.profileStoreOptions,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  listProfiles(): TopicProfile[] {
    return this.profiles.list();
  }

  getProfile(name?: string): TopicProfile {
    return this.profiles.get(name);
  }

  findProfile(name: string): TopicProfile | undefined {
    const normalizedName = profileName(name);
    return this.profiles.list().find((profile) => profile.name === normalizedName);
  }

  saveProfile(profile: TopicProfile): TopicProfile {
    return this.profiles.upsert(profile);
  }

  planProfileSync(request: PaperRadarProfileSyncRequest): PaperRadarProfileSyncPlanResult {
    const profile = this.profiles.get(request.profile);
    const { from, to } = this.resolveSyncWindow(request);
    const maxRecords = request.maxRecords ?? 200;
    return {
      profile: profile.name,
      from,
      to,
      maxRecords,
      planned: [
        {
          source: 'arxiv',
          from,
          to,
          maxRecords,
          categories: profileSyncCategories(profile),
        },
        {
          source: 'biorxiv',
          from,
          to,
          maxRecords,
          subjects: profile.biorxivSubjects,
        },
      ],
    };
  }

  async syncProfile(request: PaperRadarProfileSyncRequest): Promise<PaperRadarCoreProfileSyncResult> {
    const plan = this.planProfileSync(request);
    const profile = this.profiles.get(plan.profile);
    const arxiv = await fetchArxivMetadata(
      { categories: profileSyncCategories(profile), since: plan.from, until: plan.to, maxRecords: plan.maxRecords },
      { fetchImpl: this.fetchImpl, now: this.now },
    );
    this.persistPapers(arxiv.papers);

    const biorxiv = await fetchBiorxivMetadata(
      { from: plan.from, to: plan.to, maxRecords: plan.maxRecords },
      { fetchImpl: this.fetchImpl, now: this.now },
    );
    const biorxivPapers = biorxiv.papers.filter((paper) => matchesBiorxivProfile(profile, paper));
    this.persistPapers(biorxivPapers);

    const checkedAt = this.now().toISOString();
    this.setSourceSyncState('arxiv', checkedAt, plan.to);
    this.setSourceSyncState('biorxiv', checkedAt, plan.to);

    const results: SyncResult[] = [
      { ...arxiv.result, upserted: arxiv.papers.length },
      {
        ...biorxiv.result,
        fetched: biorxiv.papers.length,
        upserted: biorxivPapers.length,
        skipped: biorxiv.papers.length - biorxivPapers.length,
      },
    ];
    return {
      profile: profile.name,
      from: plan.from,
      to: plan.to,
      maxRecords: plan.maxRecords,
      results,
      fetched: sum(results, 'fetched'),
      upserted: sum(results, 'upserted'),
      skipped: sum(results, 'skipped'),
    };
  }

  async syncArxiv(request: ArxivSyncRequest): Promise<SyncResult> {
    const { papers, result } = await fetchArxivMetadata(request, { fetchImpl: this.fetchImpl, now: this.now });
    this.persistPapers(papers);
    this.setSourceSyncState('arxiv', this.now().toISOString(), result.to);
    return { ...result, upserted: papers.length };
  }

  async syncBiorxiv(request: BiorxivSyncRequest): Promise<SyncResult> {
    const { papers, result } = await fetchBiorxivMetadata(request, { fetchImpl: this.fetchImpl, now: this.now });
    this.persistPapers(papers);
    this.setSourceSyncState('biorxiv', this.now().toISOString(), result.to);
    return { ...result, upserted: papers.length };
  }

  search(request: SearchRequest): PaperRadarCoreSearchResult {
    const papers = this.store.search(request);
    return { papers, count: papers.length };
  }

  rank(request: RankRequest): PaperRadarCoreRankResult {
    const profile = this.profiles.get(request.profile);
    const papers = rankPapers(this.store, this.profiles, request);
    return { profile: profile.name, papers, count: papers.length };
  }

  digest(request: DigestRequest): PaperRadarCoreDigestResult {
    const profile = this.profiles.get(request.profile);
    const papers = rankPapers(this.store, this.profiles, { ...request, topK: request.topK ?? 10 });
    return {
      profile: profile.name,
      generatedAt: this.now().toISOString(),
      papers,
      count: papers.length,
    };
  }

  stats(): { papers: number; arxiv: number; biorxiv: number } {
    return this.store.stats();
  }

  getSyncState(source: 'arxiv' | 'biorxiv', key: string): string | undefined {
    return this.store.getSyncState(source, key);
  }

  listSyncState(): SyncStateRecord[] {
    return this.store.listSyncState();
  }

  getPaper(id: string): RankedPaper | undefined {
    return this.store.getPaper(id);
  }

  listRecentPapers(limit = 50): RankedPaper[] {
    return this.store.listRecentPapers(limit);
  }

  close(): void {
    this.store.close();
  }

  private resolveSyncWindow(request: PaperRadarProfileSyncRequest): { from: string; to: string } {
    const to = request.to ?? isoDate(this.now());
    if (request.from) return { from: request.from, to };
    const yesterday = new Date(`${to}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return { from: isoDate(yesterday), to };
  }

  private persistPapers(papers: PaperRecord[]): void {
    for (const paper of papers) this.store.upsertPaper(paper);
  }

  private setSourceSyncState(source: 'arxiv' | 'biorxiv', checkedAt: string, syncDate?: string): void {
    this.store.setSyncState(source, 'last_sync', checkedAt);
    if (syncDate) this.store.setSyncState(source, 'last_sync_date', syncDate);
  }
}

function matchesBiorxivProfile(profile: TopicProfile, paper: PaperRecord): boolean {
  if (!profile.biorxivSubjects.length) return true;
  const metadata = [...paper.categories, ...paper.subjects].join(' ').toLowerCase();
  return profile.biorxivSubjects.some((subject) => metadata.includes(subject.toLowerCase()));
}

function profileName(name: string): string {
  return normalizeTopicProfile({
    name,
    keywords: [],
    excludeKeywords: [],
    arxivCategories: [],
    biorxivSubjects: [],
  }).name;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sum(results: SyncResult[], key: 'fetched' | 'upserted' | 'skipped'): number {
  return results.reduce((total, result) => total + result[key], 0);
}
