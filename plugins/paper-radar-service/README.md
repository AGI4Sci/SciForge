# SciForge Paper Radar Service

Stage 3 implementation for the arXiv + bioRxiv daily new-knowledge plugin.

This service syncs paper metadata only. It does not mirror arXiv and does not download all PDFs.

## What It Does

- Syncs arXiv metadata through OAI-PMH
- Syncs bioRxiv metadata through the bioRxiv API
- Stores paper metadata in local SQLite
- Supports keyword/date/source/category search
- Stores editable topic profiles for a professor or lab
- Ranks papers by profile keywords, categories, source, and recency
- Generates a daily digest from title, abstract, authors, and categories
- Presents a one-click daily radar workflow in the desktop UI
- Groups digest results by high, medium, and low relevance
- Copies a markdown daily report for sharing with a professor

## Run

Requires Node.js 22.5 or newer because it uses the built-in `node:sqlite` module.

```bash
npm --workspace sciforge-paper-radar-service run start
```

Default URL:

```text
http://127.0.0.1:3901
```

Default database:

```text
~/.sciforge/paper-radar.sqlite
```

Default profile file:

```text
~/.sciforge/paper-radar-profiles.json
```

Override with:

```bash
PAPER_RADAR_DB=/path/to/paper-radar.sqlite
PAPER_RADAR_PROFILES=/path/to/paper-radar-profiles.json
PAPER_RADAR_PORT=3901
```

By default the service runs one sync at startup and then syncs every 24 hours.

Useful sync settings:

```bash
PAPER_RADAR_AUTO_SYNC=0
PAPER_RADAR_SYNC_INTERVAL_HOURS=24
PAPER_RADAR_ARXIV_CATEGORIES=q-bio,cs.LG,stat.ML
PAPER_RADAR_MAX_RECORDS=200
```

## API

### Health

```bash
curl http://127.0.0.1:3901/health
```

### Sync arXiv

```bash
curl -X POST http://127.0.0.1:3901/sync/arxiv \
  -H "content-type: application/json" \
  -d '{"categories":["q-bio","cs.LG","stat.ML"],"since":"2026-06-16","maxRecords":200}'
```

### Sync bioRxiv

```bash
curl -X POST http://127.0.0.1:3901/sync/biorxiv \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-16","to":"2026-06-17","maxRecords":200}'
```

### Search Papers

```bash
curl "http://127.0.0.1:3901/papers/search?q=single-cell%20foundation%20model&source=biorxiv&topK=10"
```

### List Profiles

```bash
curl http://127.0.0.1:3901/profiles
```

### Save Profile

```bash
curl -X POST http://127.0.0.1:3901/profiles \
  -H "content-type: application/json" \
  -d '{"name":"lab_default","keywords":["protein design","single-cell"],"excludeKeywords":["review"],"arxivCategories":["q-bio","cs.LG"],"biorxivSubjects":["bioinformatics"]}'
```

### Rank Papers

```bash
curl -X POST http://127.0.0.1:3901/papers/rank \
  -H "content-type: application/json" \
  -d '{"profile":"lab_default","keywords":["foundation model"],"topK":10}'
```

### Daily Digest

```bash
curl -X POST http://127.0.0.1:3901/digest \
  -H "content-type: application/json" \
  -d '{"profile":"lab_default","keywords":["protein design","single-cell","foundation model"],"excludeKeywords":["review"],"topK":10}'
```

## Desktop Workflow

In the Paper Radar side panel:

1. Set the topic profile keywords, exclusions, arXiv categories, and bioRxiv subjects.
2. Click `Update daily radar` to sync profile-matched metadata and rank the digest.
3. Review high, medium, and low relevance groups.
4. Click the clipboard button to copy a markdown daily report.

## Boundary

This service intentionally avoids:

- bulk PDF downloads
- full arXiv mirroring
- PDF parsing
- vector search
- LLM summarization and reranking

Those belong to later stages.
