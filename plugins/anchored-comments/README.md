# Anchored Comments DSH plugin

Anchored Comments is owned by this plugin. Users can access the eight Agent tools
and the plugin-owned sandbox panel discovered from the same installed generation. Runtime
logic, workspace-local state and screenshot assets must not depend on a
built-in domain or host-private implementation.

## Artifact and public contract

- Identity: `@sciforge/plugin-anchored-comments`.
- Manifest: `sciforge.dsh.json`; Cordis patch: `cordis.patch.yml`.
- Runtime entry: independent single-file ESM `dist/main.js`. The approved
  `@deepseek-ai/*` runtime packages remain external; business dependencies are
  bundled. `engines.dsh`: `>=0.2.0-rc.2 <0.3.0 || >=0.2.1-rc.4 <0.2.1`.
  The explicit prerelease range admits the reviewed 0.2.1 release-candidate lane.
- `./contract` exposes plugin-owned source schemas for build-time consumers such
  as feedback-gateway. It is not a second execution entry or a compatibility
  wrapper for a retired domain.

## Declared tools

| Tool | Effect | Approval | Scope |
| --- | --- | --- | --- |
| `anchored_comments_list` | read | none | workspace |
| `anchored_comments_get` | read | none | workspace |
| `anchored_comments_upsert` | workspace-write | none | workspace |
| `anchored_comments_delete` | workspace-write | confirmation | workspace |
| `anchored_comments_read_asset` | read | none | workspace |
| `anchored_comments_capture` | workspace-write | none | workspace |
| `anchored_comments_submit_feedback` | external-write | confirmation | workspace |
| `anchored_comments_feedback_status` | read | none | workspace |

Eight declarations are not a claim of eight model-visible tools. Acceptance
must separately record declared, registered and actual model-visible tools,
including any host-projected openers and unavailable capability reasons.
Manifest metadata is a request, not authority: exact-version grants, caller
workspace and approval are owned by the Host. Delete and external submission
must not lose confirmation through projection. Application acceptance uses a
permission mode that actually requests human confirmation, not automatic
full-access approval.

## State and evidence

A research anchor's optional `contentDigest` is an opaque preview snapshot or
content revision identifier; its contract does not promise raw-file SHA-256.
Preserve it with the canonical target on updates. Exact quote and line ranges
allow independent relocation checks; submitted `anchorResolution` is not a
claim that the plugin ran a document resolver.

The Host binds `workspaceRoot` from its authenticated caller. A model-supplied
root cannot authorize a different workspace. Strict capability inputs exclude
that transport field. All state and assets live in the bound workspace under
`.sciforge/anchored-comments/`, with `comments.json` and content-addressed
`assets/<sha256>.png`. File operations must reject path and symlink escapes.
Thread anchors identify the canonical resource and selection; document tasks
record exact paragraph/quote and content digest for relocation. Updated content
must preserve the existing canonical target and established evidence.

Screenshot capture must call a generic controlled Host proxy for an explicitly
registered task view in this instance and caller workspace. It must apply
sensitive-information redaction before returning bounded PNG data or a managed
resource reference. The plugin verifies bytes and SHA-256 and owns persistence;
no desktop capture, other-application capture, Electron object, function or UI
component crosses the process boundary. Missing authority or capture services
fail closed. Feedback submission is optional; absent gateway configuration is
explicitly refused.

## Tests

```sh
npm run build --workspace @sciforge/plugin-anchored-comments
npm run typecheck --workspace @sciforge/plugin-anchored-comments
npm test --workspace @sciforge/plugin-anchored-comments
```

Core contract and storage tests and real-child Host/Broker regression tests are
supplementary engineering checks. They do not replace a real model selecting
plugin tools inside SciForge. Fixture images are never screenshot acceptance
evidence.

## Current migration status and limits

The owner panel accepts the public SDK `resource-text-selection` snapshot:
select one item in Research Record → Add Annotation → public `openResource` →
automatically prefilled label/quote → enter a note → Save. Discuss Selection still
opens a side-chat draft; copying JSON is an advanced fallback. The resource context
is bounded JSON data and grants no capability. Saving uses the existing
`anchored-comments.upsert` tool (whose receipt is the thread itself); reopening
uses `anchored-comments.list`. No second annotation database exists.

The `./selection` receiver checks the exact resource identity and Host-bound
workspace, runtime and session. Missing Host identity fails closed. Same-frame
activation updates require an explicit keep/replace decision if text is unsaved;
invalid context, changed scope/grants and disposal clear drafts and pending requests.
No screenshot, source revalidation, model call or approval is implied. Existing
threads can still be updated with public tools; the panel does not edit them.

Integration boundary: the production Host supplies workspaceRoot, sessionId and
its owner thread's runtimeId in host.init, and invalidates pending responses on
scope changes. The release policy pins resource-text-selection for version 0.2.0.
The panel still requires installation, enablement and an exact tool grant; context
cannot grant authority. The browser fixture exercises the built iframe, production
resource schema/registry and original owner service with synthetic Host transport.
It does not certify complete installed-application GUI approval.

The old built-in package, renderer overlay and generated registration have been
removed. Feedback Gateway consumes the plugin's public contract export. Workspace
authority, visual capture, image delivery, approved ports and invocation tracing
use generic Host/SDK contracts, with no Anchored Comments exception in the Host.

Earlier plugin-author acceptance reported real yunshu/gpt-6.1-sol
paragraph review, registered-view capture, durable image reading, message update,
explicitly allowed and denied deletion, disable/re-enable, invalid candidate,
foreign-workspace rejection and post-restart read checks. The task evidence report
records actual tool calls and hashes; historical probes and synthetic fixtures
remain engineering evidence only. A capture's validated revision is not an atomic
pixel-frame revision. Asset byte integrity does not independently reauthenticate
stored provenance, and submitted anchor resolution is not a document resolver.

Development application acceptance, standard packaged application acceptance and
publishing are separate gates. Packaging and market installation evidence must
report their own results; a task-local test publisher is not a public release.
This task has no authorization to publish.
