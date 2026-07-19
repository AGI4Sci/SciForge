# @sciforge/full-trace

One secret-safe durable event contract for client-visible model traffic and
normalized Agent runtime events. The store uses append-only daily JSONL
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

`read` returns full sanitized events, `summaries` derives diagnostic cards
from those events, `export` writes a portable owner-only JSONL bundle, and
`clear` removes trace history. `initialize` performs the daily 30-day
retention check automatically. All inputs are filtered before persistence,
and reads and exports apply the same filter again.
