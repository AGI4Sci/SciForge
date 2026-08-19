# `@sciforge/collaboration-provider-zulip`

Zulip adapter for the provider-neutral SciForge Human Endpoint Provider contract.
It owns Zulip authentication, strict HTTP/event validation, stable topic locators,
event cursors, delivery reconciliation, retry policy, self-echo suppression,
topic rename/move operations and external `update_message` reconciliation,
strict private `/bind SF1...` and legacy Topic pairing/HumanAnswer command recognition,
provider-neutral direct-message delivery, notification filtering and
secret-safe diagnostics.

The package does not own users, projects, session projections, Agent execution or
credentials at rest. A caller supplies credentials from its secret manager and a
durable delivery ledger. The adapter never exposes credentials through its public
status or diagnostic values.

## Security invariants

- A topic display name is never a projection or project identifier.
- An inbound location must resolve to exactly one saved locator revision.
- A whole-topic external rename or move preserves the saved opaque topic ID;
  rendering, content-only and partial-topic updates never mutate a binding.
- A HumanAnswer command is accepted only from a uniquely bound locator and
  carries the stable sender/message identity for server-side authorization and deduplication.
- Unknown event and API response fields are rejected.
- A delivery with an uncertain result is reconciled before any retry.
- Provider credentials and challenge values are not logged or serialized.
- Payload, retry, diagnostic and per-sender rate limits are bounded.

Tests use fake HTTP and placeholder credentials only. No live Zulip secret is
required or accepted by the test suite.
