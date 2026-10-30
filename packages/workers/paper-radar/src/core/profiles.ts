import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { TopicProfile } from './types.js';

export const DEFAULT_PROFILE: TopicProfile = {
  name: 'lab_default',
  description: 'Default lab profile for computational biology and ML papers.',
  keywords: ['protein design', 'single-cell', 'gene regulatory network', 'foundation model'],
  excludeKeywords: [],
  arxivCategories: ['q-bio', 'cs.LG', 'stat.ML'],
  biorxivSubjects: ['bioinformatics', 'genomics', 'systems biology'],
};

export interface ProfileStoreOptions {
  persistDefault?: boolean;
}

export class ProfileStore {
  private profiles = new Map<string, TopicProfile>();
  private readonly persistDefault: boolean;

  constructor(private readonly path: string, options: ProfileStoreOptions = {}) {
    this.persistDefault = options.persistDefault ?? true;
    this.load();
  }

  list(): TopicProfile[] {
    return Array.from(this.profiles.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name = DEFAULT_PROFILE.name): TopicProfile {
    return this.profiles.get(name) ?? this.profiles.get(DEFAULT_PROFILE.name) ?? DEFAULT_PROFILE;
  }

  upsert(profile: TopicProfile): TopicProfile {
    const normalized = normalizeTopicProfile(profile);
    this.profiles.set(normalized.name, normalized);
    this.save();
    return normalized;
  }

  private load(): void {
    this.profiles.clear();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      const items = Array.isArray(parsed) ? parsed : [];
      for (const item of items) {
        const profile = parseProfile(item);
        if (profile) this.profiles.set(profile.name, profile);
      }
    } catch {
      // Missing or invalid profile files fall back to the built-in default.
    }
    if (!this.profiles.has(DEFAULT_PROFILE.name)) {
      this.profiles.set(DEFAULT_PROFILE.name, DEFAULT_PROFILE);
      if (this.persistDefault) this.save();
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.list(), null, 2)}\n`, 'utf8');
  }
}

function parseProfile(value: unknown): TopicProfile | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TopicProfile>;
  if (!record.name || typeof record.name !== 'string') return null;
  return normalizeTopicProfile({
    name: record.name,
    description: typeof record.description === 'string' ? record.description : undefined,
    keywords: arrayOfStrings(record.keywords),
    excludeKeywords: arrayOfStrings(record.excludeKeywords),
    arxivCategories: arrayOfStrings(record.arxivCategories),
    biorxivSubjects: arrayOfStrings(record.biorxivSubjects),
  });
}

export function normalizeTopicProfile(profile: TopicProfile): TopicProfile {
  return {
    name: safeName(profile.name),
    ...(profile.description?.trim() ? { description: profile.description.trim() } : {}),
    keywords: unique(profile.keywords),
    excludeKeywords: unique(profile.excludeKeywords),
    arxivCategories: unique(profile.arxivCategories),
    biorxivSubjects: unique(profile.biorxivSubjects),
  };
}

function safeName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || DEFAULT_PROFILE.name;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 100);
}
