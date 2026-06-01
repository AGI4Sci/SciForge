# Feishu Channel Plugin

Feishu is the first SciForge channel plugin implementation. It converts Feishu CLI, webhook, and mention events into ordinary Agent Host thread messages and keeps channel-specific raw payloads behind `feishu:*`, `artifact:*`, and `audit:*` refs.

The plugin reuses `lark-cli` through `larkCliProvider.ts`; it does not implement or wrap the Feishu SDK. `larkCliProvider.ts` is implementation detail for this package and is not part of the stable public channel contract.

Delivery is refs-first and side-effect guarded. Draft and dry-run paths may run directly, while send/upload/forward operations require Agent Host approval, idempotency, and audit ports.
