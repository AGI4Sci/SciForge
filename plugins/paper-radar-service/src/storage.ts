import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { PaperRecord, PaperSource, RankedPaper, SearchRequest } from './types.js';

export class PaperStore {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsertPaper(paper: PaperRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO papers (
          id, source, external_id, title, authors_json, abstract, categories_json, subjects_json,
          published_at, updated_at, doi, abs_url, pdf_url, created_at, last_seen_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          authors_json = excluded.authors_json,
          abstract = excluded.abstract,
          categories_json = excluded.categories_json,
          subjects_json = excluded.subjects_json,
          published_at = excluded.published_at,
          updated_at = excluded.updated_at,
          doi = excluded.doi,
          abs_url = excluded.abs_url,
          pdf_url = excluded.pdf_url,
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        paper.id,
        paper.source,
        paper.externalId,
        paper.title,
        JSON.stringify(paper.authors),
        paper.abstract,
        JSON.stringify(paper.categories),
        JSON.stringify(paper.subjects),
        paper.publishedAt,
        paper.updatedAt ?? null,
        paper.doi ?? null,
        paper.absUrl,
        paper.pdfUrl ?? null,
        now,
        now,
      );

    this.db.prepare('DELETE FROM papers_fts WHERE id = ?').run(paper.id);
    this.db
      .prepare('INSERT INTO papers_fts(id, title, abstract, authors, categories) VALUES (?, ?, ?, ?, ?)')
      .run(
        paper.id,
        paper.title,
        paper.abstract,
        paper.authors.join(' '),
        [...paper.categories, ...paper.subjects].join(' '),
      );
  }

  search(req: SearchRequest): RankedPaper[] {
    const topK = clampTopK(req.topK);
    const terms = normalizeTerms(req.query);
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    let sql: string;

    if (terms.length > 0) {
      sql = `SELECT p.*, bm25(papers_fts) * -1 AS rank_score
        FROM papers_fts
        JOIN papers p ON p.id = papers_fts.id`;
      clauses.push('papers_fts MATCH ?');
      params.push(terms.map((term) => `"${term}"`).join(' OR '));
    } else {
      sql = 'SELECT p.*, 0 AS rank_score FROM papers p';
    }

    if (req.sources?.length) {
      clauses.push(`p.source IN (${req.sources.map(() => '?').join(', ')})`);
      params.push(...req.sources);
    }
    if (req.from) {
      clauses.push('p.published_at >= ?');
      params.push(req.from);
    }
    if (req.to) {
      clauses.push('p.published_at <= ?');
      params.push(req.to);
    }
    if (req.categories?.length) {
      const categoryClauses = req.categories.map(() => '(p.categories_json LIKE ? OR p.subjects_json LIKE ?)');
      clauses.push(`(${categoryClauses.join(' OR ')})`);
      for (const category of req.categories) {
        params.push(`%${category}%`, `%${category}%`);
      }
    }

    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += terms.length > 0 ? ' ORDER BY rank_score DESC, p.published_at DESC LIMIT ?' : ' ORDER BY p.published_at DESC LIMIT ?';
    params.push(topK);

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => toRankedPaper(row as unknown as PaperRow));
  }

  setSyncState(source: PaperSource, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state(source, key, value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(source, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(source, key, value, new Date().toISOString());
  }

  getSyncState(source: PaperSource, key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE source = ? AND key = ?').get(source, key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  stats(): { papers: number; arxiv: number; biorxiv: number } {
    const count = (source?: PaperSource) => {
      const row = source
        ? (this.db.prepare('SELECT COUNT(*) AS n FROM papers WHERE source = ?').get(source) as { n: number })
        : (this.db.prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number });
      return row.n;
    };
    return { papers: count(), arxiv: count('arxiv'), biorxiv: count('biorxiv') };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        abstract TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        subjects_json TEXT NOT NULL,
        published_at TEXT NOT NULL,
        updated_at TEXT,
        doi TEXT,
        abs_url TEXT NOT NULL,
        pdf_url TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_papers_source_date ON papers(source, published_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
        id UNINDEXED,
        title,
        abstract,
        authors,
        categories
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(source, key)
      );
    `);
  }
}

interface PaperRow {
  id: string;
  source: PaperSource;
  external_id: string;
  title: string;
  authors_json: string;
  abstract: string;
  categories_json: string;
  subjects_json: string;
  published_at: string;
  updated_at: string | null;
  doi: string | null;
  abs_url: string;
  pdf_url: string | null;
  rank_score: number;
}

function toRankedPaper(row: PaperRow): RankedPaper {
  const categories = parseJsonArray(row.categories_json);
  const subjects = parseJsonArray(row.subjects_json);
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    authors: parseJsonArray(row.authors_json),
    abstract: row.abstract,
    categories,
    subjects,
    publishedAt: row.published_at,
    updatedAt: row.updated_at ?? undefined,
    doi: row.doi ?? undefined,
    absUrl: row.abs_url,
    pdfUrl: row.pdf_url ?? undefined,
    score: Number(row.rank_score ?? 0),
    reason: categories.length || subjects.length ? `Matched metadata in ${[...categories, ...subjects].join(', ')}` : 'Matched metadata.',
  };
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function normalizeTerms(query?: string): string[] {
  if (!query) return [];
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? [])).slice(0, 12);
}

function clampTopK(value?: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.floor(value as number)));
}
