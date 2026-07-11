# Design: Anchored comments and GitHub feedback

## Goals

- Make meaningful SciForge content and UI targets precisely commentable.
- Preserve what the user saw even after the application or underlying artifact changes.
- Keep comment-to-conversation attachment explicit and bounded.
- Make GitHub feedback submission a single confirmed action after a one-time account setup.
- Avoid exposing research data or long-lived secrets by default.

## Non-goals

- Multi-user real-time collaboration, mentions, notifications, and CRDT synchronization.
- Automatically executing an AI modification when a comment is created.
- Treating brittle CSS selectors as the canonical target identity.
- Capturing operating-system windows outside the SciForge BrowserWindow.

## Architecture

### Shared anchor and comment model

An `AnchoredCommentThread` owns one `CommentAnchor`, one immutable capture bundle, comment messages, status, and optional GitHub linkage. Anchors prefer domain identity over UI identity:

1. structured research selection or resource identity;
2. stable SciForge component and element identifiers;
3. DOM recovery fingerprint;
4. screenshot-space bounds as the final fallback.

The capture bundle records the application version, route, viewport, full-window screenshot, focused crop, target label, and a content digest. Screenshots are captured when the first comment is created, not when feedback is later submitted.

### Renderer interaction

A global comment-mode overlay uses capture-phase pointer events to inspect elements beneath it. First-party components may expose `data-sciforge-comment-*` attributes. Unregistered elements receive a bounded DOM fingerprint and visual-region anchor. Sensitive targets opt out with a deny attribute.

The user clicks a target, enters a comment, and can later select one or more open comments. Selecting “Add to conversation” creates bounded `CommentContextReference` chips in the composer. Sending resolves current target state and includes the immutable capture metadata without silently adding unrelated comments.

### Screenshot and privacy boundary

The renderer sends target bounds and optional redaction bounds to the main process. The main process captures only the SciForge window, draws a numbered target callout, creates a focused crop, strips image metadata, and persists the approved PNG variants. Known sensitive elements are excluded or redacted automatically. Logs, conversation excerpts, workspace paths, and file metadata default to excluded from product feedback.

### Persistence

Comment records live in application data, partitioned by workspace and target identity. Research comments remain local by default. Visual evidence is content-addressed and garbage-collected only after all referencing comments are deleted. Persisted values pass shared schemas on read and write.

### GitHub feedback gateway

The desktop never receives a GitHub App private key or durable asset-store credential. It submits a sanitized, user-approved feedback packet to a configured HTTPS gateway. The gateway:

- authenticates the caller's GitHub identity or approved SciForge installation session;
- validates packet size and content type;
- uploads immutable screenshots;
- creates one GitHub Issue with an idempotency key;
- returns issue number, URL, author and asset URLs;
- returns the previous result when the same key is retried.

The initial gateway implementation exposes a transport-neutral service with a GitHub REST adapter and a pluggable asset publisher so deployment can use GitHub-hosted release assets or an immutable object store without changing the desktop protocol.

## Comment lifecycle

`open -> attached -> ai_responded -> awaiting_verification -> resolved`

AI output never resolves a comment automatically. The user explicitly resolves or reopens it.

Product feedback submission is orthogonal:

`local -> submitting -> submitted | failed`

## Failure handling

- Screenshot capture failure keeps the textual comment usable and marks visual evidence unavailable.
- Feedback submission uses a stable idempotency key and persists a retryable failed state.
- If an anchor no longer resolves, the immutable screenshot remains visible and the comment is marked `needs_retargeting`.
- Gateway errors never lose the local comment or selected disclosure fields.

## Security and privacy

- Full-window screenshots are visible in a confirmation preview before upload.
- Secrets, password fields, permission prompts, and explicit deny regions cannot be targets and are redacted from surrounding captures.
- Public upload disclosure is mandatory in the confirmation UI.
- Tokens are stored in OS-protected storage; gateway secrets remain server-side.
- Feedback packets include only fields selected by the user.

## Verification

- Shared schema, migration and prompt rendering unit tests.
- Overlay targeting and sensitive-region tests.
- Screenshot callout/crop tests using deterministic images.
- Composer context-reference tests.
- Feedback gateway idempotency, redaction and GitHub payload tests.
- Renderer/main IPC typecheck and focused integration tests.

