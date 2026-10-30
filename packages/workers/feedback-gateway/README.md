# SciForge Feedback Gateway

This package is the deployable trust boundary for approved SciForge product feedback. It accepts the desktop `ProductFeedbackPacket`, verifies immutable PNG evidence, publishes screenshots to S3-compatible object storage, creates a GitHub Issue, and returns the matching `FeedbackGatewayResult`.

The gateway never receives unselected disclosure fields: the packet schema rejects data whose disclosure flag is false. Screenshot bytes must match the declared byte length, SHA-256 digest, and PNG signature before upload.

## API

- `GET /health` returns service health without credentials.
- `POST /v1/feedback` accepts a JSON `ProductFeedbackPacket`. An `Idempotency-Key` header is optional, but when present it must equal `packet.idempotencyKey`.
- `GET /v1/feedback/:idempotencyKey` returns the previously stored `FeedbackGatewayResult`, or `404`.

Successful POST responses use HTTP `201` and return the result object directly, matching the desktop gateway client. A repeated packet returns the saved result. Reusing a key with changed content returns `409`.

If `SCIFORGE_FEEDBACK_GATEWAY_TOKEN` is set, API routes require `Authorization: Bearer <token>`. In production, set this to a short-lived installation/session credential or put the service behind an authenticating reverse proxy. The static setting is useful for private deployments; do not embed a shared production secret in a public desktop build.

## Configuration

Copy `.env.example` to `.env` for local deployment. Required settings are:

| Variable | Purpose |
| --- | --- |
| `SCIFORGE_FEEDBACK_GITHUB_TOKEN` | GitHub App installation token or fine-grained PAT with Issues write access. |
| `SCIFORGE_FEEDBACK_ALLOWED_REPOSITORIES` | Comma-separated `owner/name` allowlist. Packets cannot create Issues elsewhere. |
| `SCIFORGE_FEEDBACK_S3_BUCKET` | S3-compatible bucket containing public approved evidence. |
| `SCIFORGE_FEEDBACK_ASSET_PUBLIC_BASE_URL` | Public URL prefix that maps to the bucket/key namespace. |

Optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCIFORGE_FEEDBACK_HOST` | `127.0.0.1` | HTTP listen address. |
| `SCIFORGE_FEEDBACK_PORT` | `8787` | HTTP listen port. |
| `SCIFORGE_FEEDBACK_GATEWAY_TOKEN` | unset | Optional bearer credential. |
| `SCIFORGE_FEEDBACK_MAX_BODY_BYTES` | `78643200` | JSON request cap (max 100 MiB). |
| `SCIFORGE_FEEDBACK_GITHUB_API_URL` | `https://api.github.com` | GitHub or GitHub Enterprise REST root. |
| `SCIFORGE_FEEDBACK_GITHUB_RECOVERY_PAGES` | `3` | Recent 100-Issue pages scanned for crash recovery; `0` disables the scan. |
| `SCIFORGE_FEEDBACK_IDEMPOTENCY_DIR` | `./data/idempotency` | Persistent mounted directory for result records. |
| `SCIFORGE_FEEDBACK_S3_REGION` | `auto` | S3 region. |
| `SCIFORGE_FEEDBACK_S3_ENDPOINT` | AWS default | S3-compatible endpoint, such as R2 or MinIO. |
| `SCIFORGE_FEEDBACK_S3_ACCESS_KEY_ID` | SDK chain | Explicit object-store access key. |
| `SCIFORGE_FEEDBACK_S3_SECRET_ACCESS_KEY` | SDK chain | Explicit object-store secret; must be paired with the access key. |
| `SCIFORGE_FEEDBACK_S3_FORCE_PATH_STYLE` | `false` | Enable for path-style services such as some MinIO deployments. |
| `SCIFORGE_FEEDBACK_S3_KEY_PREFIX` | `feedback` | Object namespace prefix. |

GitHub credentials stay server-side. Prefer a GitHub App installation token scoped to Issues write and Metadata read for only the allowlisted repository. The recovery scan checks recent Issues for the gateway's hashed idempotency marker before creating a new Issue; the durable local store remains the primary idempotency record.

## Immutable evidence

Objects are addressed as `<prefix>/<digest-prefix>/<sha256>.png` and written with `If-None-Match: *`. Existing objects are reused after an S3 `412 Precondition Failed`. Configure the bucket so these object keys cannot be overwritten or deleted by the gateway identity; bucket versioning or object lock provides stronger operational protection. Serve the public base URL with `Cache-Control: public, max-age=31536000, immutable` preserved.

The idempotency directory must be a persistent volume. Files are created atomically and mode-restricted. For horizontally scaled deployments, replace `FileFeedbackIdempotencyStore` with a shared store implementing `FeedbackIdempotencyStore`, while retaining a unique constraint on the idempotency key and request digest.

## Run and verify

```bash
npm run feedback-gateway:start
npm run feedback-gateway:test
npm run feedback-gateway:typecheck
```

Terminate TLS at a reverse proxy or load balancer and configure the desktop with its HTTPS gateway URL. The service itself intentionally exposes plain HTTP so deployment platforms can provide certificates and authenticated ingress.
