# @sciforge/full-trace

One secret-safe durable event contract for client-visible model traffic and
normalized Agent runtime events. The store uses append-only, size-rolled JSONL
segments under application user data, outside workspaces.

```ts
import {
  LocalTraceStore,
  deriveTraceId,
  type TraceEventInput
} from '@sciforge/full-trace'

const store = new LocalTraceStore({ userDataDirectory })
await store.append({
  traceId: deriveTraceId({ runtimeId, threadId, turnId }),
  runtimeId,
  threadId,
  turnId,
  source: 'agent-runtime',
  kind: 'agent_event',
  payload: { eventKind: 'tool', event: runtimeEvent }
} satisfies TraceEventInput<'agent_event'>)
```

Model callers should propagate the headers created by
`traceCorrelationHeaders`; receiving processes read them with
`traceCorrelationFromHeaders`. A propagated `traceId` always wins. If no ID
was propagated, every producer derives it with `deriveTraceId` from the same
runtime/thread/turn identifiers. Individual model calls use
`createRequestId`; nested calls also set `parentRequestId`.

`read` returns the durable sanitized events. Streamed model response chunks are
coalesced per append batch into one bounded event: a 2 KiB preview plus chunk
count, byte counts, timestamps, and a SHA-256 digest. The same bounded event is
returned by `read` and `export`, so neither API implies that long-lived trace
storage is a replayable copy of the complete response body.

`requestSummaries` is the primary
request-level view: it groups model events by `requestId`, keeps each
`parentRequestId`, reports nested attempt counts, and supports `scope: 'all'`
or `scope: 'roots'`. `summaries` remains the compatible trajectory-level card
with Agent-event counts; it intentionally uses only root-request status and
usage so failed retries do not make a successful turn look failed or double
count tokens. Both views are derived from the durable events, not a second
capture path. `export` writes a portable owner-only JSONL bundle, and `clear`
removes trace history. `initialize` performs the daily 30-day retention check
automatically. New writes roll at 64 MiB per segment; all managed indexed segments
are capped at 2 GiB in total, including current-day indexed segments. Every
producer sharing the directory uses the same cross-process mutation lease for
segment selection, append/fsync, retention, capacity pruning, and clear. Pre-policy
unindexed daily files remain readable and exportable and are not deleted by the
new capacity policy. All inputs are filtered before persistence, and reads and
exports apply the same filter again.

Readers open a bounded file-descriptor snapshot while holding that lease, then
release the lease before scanning. Capacity pruning and clear can therefore
continue without making an in-flight read/export observe missing files or a
partially appended tail. A live writer lease is never reclaimed solely because
its heartbeat is delayed; contenders fail with `TRACE_LOCK_TIMEOUT` instead of
creating two concurrent writers. Leases owned by dead processes and abandoned
incomplete acquisitions are reclaimed.

Store queries scan JSONL segments one event at a time. Limited reads retain
only the requested ordered events while still reporting exact totals and
corrupt-line counts. Summary queries retain only per-trace and per-request
aggregate fields. Exports scan the store once into an owner-only temporary
spool and retain only a lightweight byte-range sort index before writing the
manifest and timestamp-ordered events. Full payload history is never
accumulated in the main-process heap, and manifest counts match the exported
event stream.

## Scientific semantics

`ScientificTraceCollector` adds a domain-neutral scientific envelope on top of
the same durable store. It records one rooted causal graph with input,
Artifact, Evidence, Human Review, and exactly one completed, failed, or
cancelled terminal event. Domain packages may add lowercase namespaced event
types such as `scientific-compute.job-started`; the trace core does not own a
central domain-event list.

`validateScientificTraceClosure` rejects mixed trace IDs, duplicate event IDs,
multiple roots or terminals, cross-trace parents, cycles, orphan nodes, and a
terminal event that cannot reach the required scientific evidence chain.
Scientific Trace sanitization reuses the store credential filter and also
redacts common PII and Luhn-valid payment-card values before persistence.
