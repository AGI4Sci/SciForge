# Zotero Connector

Read and write Zotero Web API v3 connector with an injected `fetch` and no
shipped credentials. It exists so a trusted package can read or write a user's
own Zotero library without reaching for `globalThis.fetch` and without a
credential being exposed through URLs, errors or result metadata.

## What it does

- `ZoteroClient` reads items and single items over the Zotero Web API v3,
  honoring the 100-item page cap and the `Total-Results`
  pagination header, and creates new bibliography items with a per-index write
  report.
- `normalizeItem` defensively maps raw Zotero JSON to a narrow `ZoteroItem`
  (key, version, itemType, title, creators, date, parsedDate, DOI,
  publicationTitle, abstractNote). Title-less entries are dropped.
- `toLibraryEntry` maps a `ZoteroItem` to a knowledge-net library entry
  (`paperId`, `title`, `authors`, `year`, `doi`) — the only bibliographic fields
  the knowledge net seals.
- `toWritableItem` prepares a library entry for a Zotero write (item type,
  title, creators, date, DOI). Notes, tags, collections and attachments are
  never read or written.

## Security

- The client **never** uses `globalThis.fetch`; the caller injects `fetch`.
- The API key is passed at construction and sent **only** in the
  `Authorization: Bearer` header — never in the URL, never in an error message.
- The base URL is pinned to HTTPS on `api.zotero.org`.
- Write is narrow: bibliography items only, no notes, tags, collections or
  attachments.

## Usage

```ts
import { ZoteroClient } from '@sciforge/zotero-connector'

const client = new ZoteroClient({ fetch, userId, apiKey })
const page = await client.listItems({ start: 0, limit: 100 })
const report = await client.createItems([{ itemType: 'journalArticle', title, creators: [] }], operationId)
```

Writes accept at most 50 entries. Keep the same operationId and ordered payload
for retries. Keys derive from account, operationId and item index; each item uses
`version: 0`, so an existing key fails instead of being updated. This remains
duplicate-safe across client restarts and beyond the 12-hour write-token window.
A lost response leaves outcome unknown: a conflict on retry is not a recovered
success receipt. Never replace the operationId to work around that conflict.
Key collisions fail closed. Deleted remote objects cannot provide a deduplication
record. The Broker additionally rejects changed payloads for a retained invocationId;
keep both invocationId and operationId stable when retrying.

`returned` counts usable bibliography entries, `scanned` counts raw page entries,
and `nextStart` advances by `scanned` (null at the end). An unexpectedly empty
page before Total-Results fails instead of looping. Network and JSON/schema
errors expose fixed messages without underlying causes; per-item server prose
is replaced by a bounded generic rejection. Redirects fail.

## Verification

```sh
npm test --workspace @sciforge/zotero-connector
npm run typecheck --workspace @sciforge/zotero-connector
```

Tests use a fixture fetch and never open a socket.
