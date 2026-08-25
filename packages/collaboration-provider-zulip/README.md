# `@sciforge/collaboration-provider-zulip`

Zulip adapter for the provider-neutral SciForge Human Endpoint Provider contract.
It owns Zulip authentication, strict HTTP/event validation, stable topic locators,
event cursors, delivery reconciliation, retry policy, self-echo suppression,
topic rename/move operations and external `update_message` reconciliation,
strict private `/bind SF1...` pairing, ordinary Topic message ingestion,
non-authoritative HumanAnswer candidate recognition,
provider-neutral direct-message delivery, notification filtering and
secret-safe diagnostics.

The package does not own users, projects, session projections or Agent execution.
The server passes only a non-secret secret-file directory and basename references;
the Zulip server runtime validates and reads those private files itself, constructs
the Authorization header, and performs the outbound request without returning key
material through the provider contract. The adapter never exposes credentials
through its public status or diagnostic values.

## Security invariants

- A topic display name is never a projection or project identifier.
- An inbound location must resolve to exactly one saved locator revision.
- A whole-topic external rename or move preserves the saved opaque topic ID;
  rendering, content-only and partial-topic updates never mutate a binding.
- A `sciforge-answer` Topic reply produces only a provider candidate. Cloud must
  resolve its sender to the active verified Human Endpoint already bound to the
  OIDC Project Owner, match the exact Project locator and invoke the same
  canonical HumanAnswer service; raw IM text never creates a HumanAnswer.
- Unknown event and API response fields are rejected.
- A delivery with an uncertain result is reconciled before any retry.
- Provider credentials and challenge values are not logged, serialized, returned to
  the collaboration server, or passed through a provider-service callback.
- Payload, retry, diagnostic and per-sender rate limits are bounded.

Tests use synthetic credentials and a loopback HTTP server only. No live Zulip
secret is required or accepted by the test suite.
