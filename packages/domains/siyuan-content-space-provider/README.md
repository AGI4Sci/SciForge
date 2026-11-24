# SciForge Cloud Notes

This SciForge-owned domain package embeds the SiYuan web UI and owns the cloud notes capabilities. It contributes a `workbench.main-area` page (the Host sidebar entry **云服务**) and a `workbench.settings-section` under **File → Settings → 云服务**, and exposes capabilities for opening, presenting, reading, searching and writing SiYuan documents.

The editor opens in a right dock by default, beside the current Session. Its header can move it to the left, bottom or main area. Dock edges resize with a pointer or arrow keys; position and size are saved locally. Pages sharing an edge use tabs and stay mounted when moved or hidden, so switching position does not reload the editor. These controls come from the generic Host page docking contract.

**Managed cloud spaces by default.** Sign in to SciForge to use a private personal space or an explicitly provisioned project space. Personal ownership is derived from the authenticated account; project HTTP and WebSocket access requires active membership. A main-process-only, one-use code is exchanged by POST for a host-only browser session; no token or code is placed in a URL or exposed to the renderer. The editor and managed document APIs share the same account/space cookie jar.

Each account and chat retains its selected space and native editor. Closing the panel hides that editor; returning restores its document and editing state. Explicit refresh reloads the current document, while session renewal and ordinary panel switches do not. Browser-only hosts display a desktop-required message.

Managed document operations require an explicit `spaceId`. Unscoped automatic chat archives are disabled in managed mode. Existing project-space data stays in its associated space; legacy custom-service data is not copied into personal spaces or opened automatically.

## Safe document revision

Document reads use the stored Kramdown body with native block attribute lines
removed, preserving block references and `siyuan://blocks/` links. They do not use
the publication exporter, whose shared preferences can expand cited documents
into footnotes. Fenced and indented code examples retain literal attribute lines.
The returned `updated` comes from the same stored body snapshot, avoiding the
SQL search index's delayed version when preparing the next write.

Use `siyuan.document.patch` for local revisions. It accepts a stable
`operationId`, both `expectedContentHash` and `expectedUpdated` from a complete
read, and an array of changes:

- `text`: exact unique `section` heading and a unique `find` / `replace` fragment
  within a single ordinary body block. Headings, cross-block edits and tables
  cannot be rewritten through this operation.
- `table-cell`: `section`, optional `tableIndex` (default 0), `row` (1 is the first
  data row), zero-based `column`, the original Markdown in `expected`, and `value`.
- `table-append`: `section`, optional `tableIndex`, and `rows` of cell strings.
  Each row must match the existing column count.

The writer validates the entire plan before a single native batch update,
preserves the changed block's attributes and all other blocks' IDs, checks the
snapshot again before dispatch, and verifies the complete resulting body.
Nested container changes that cannot be represented safely are rejected.
The SiYuan service must support `/api/block/batchUpdateBlock`; there is no
sequential, potentially partial fallback.

`<!-- locked -->` … `<!-- /locked -->` regions are protected verbatim on every
body write. Full replacement may append table rows but cannot modify existing
cells or table structure; explicit cell changes use `patch`. Full replacement
still rebuilds body blocks and should be used only for an explicit whole-body
request.

Keep the same `operationId` on retries, including after reading a newer version.
Completed steps do not run twice, and reusing an ID for different content is
rejected. Appends without an ID use a content-derived step identity; to
intentionally append another identical copy, supply a new ID. Receipts persist
across restarts. A lost acknowledgement is reconciled only when the complete
intended body matches; other uncertain outcomes remain fenced.

Body writes require the customized SiYuan kernel to advertise
`conditionalWriteVersion: 1` in its stored-body response. The writer sends that
exact raw document snapshot as `expectedDocument` with append, replace and batch
patch requests. The kernel compares it under its transaction lock after draining
queued transactions; a mismatch returns `document_changed` without applying the
write. Read again before retrying. Services without this capability remain
readable but reject body edits with an explicit service-update message. There is
no fallback to an unguarded body write. Other clients using native unguarded
SiYuan APIs do not acquire this protection automatically.

**Optional custom service.** Choose Custom service explicitly in Cloud Services settings. SciForge connects to a SiYuan service you run or subscribe to; the package never starts, bundles or redistributes a SiYuan kernel. In custom mode, an unconfigured service shows its connection form in place. Save the service address to connect automatically; the same form remains available in **File → Settings → Cloud Services**. You can also set `SIYUAN_BASE_URL` as the installation default. If that service requires an API token, paste it in those settings or set `SIYUAN_API_TOKEN`.

## Embedded editor

The package owns both the editor and its settings contribution. One local configuration store notifies mounted editors when settings are saved; reload revisions belong to individual chats. Connection information, the shared-space identity and token controls are shown only in settings; the editor fills the dock below the Host's title. The editor is **not** an Electron `<webview>`: the Host renderer deliberately does not enable `webviewTag`. Instead the package creates a native `WebContentsView` in the main process, attaches it to the desktop window that hosts the page, and keeps its bounds synchronized with the slot. This is the same mechanism the first-party Browser Preview package uses.

The split is:

- `siyuan.editor.open` (audience `ui`) — authorizes the selected cloud space and exchanges its browser grant, or resolves the explicitly selected custom service; returns only a presentation URL and expiry.
- `siyuan.editor.present` (audience `ui`) — the renderer measures its slot in device-independent pixels and reports `{ sessionId, url, viewport, reloadRevision }`. The main process scales the rectangle by the host zoom factor, clamps it to the window content bounds, and shows, hides or detaches the child view. `url: null` hides the retained per-chat view.

A native child view always paints above HTML, so the renderer hides it whenever the page is inactive, the Host opens a dialog or menu over it, or the page scrolls out of its clipping ancestors. Visible Host and package overlays explicitly mark native-view occlusion through the shared viewport contract; ordinary panels do not infer visibility through pixel hit testing.

The view uses a persisted partition derived from the SiYuan service origin and the stable SciForge user ID. Cookies, local storage and the SiYuan browser unlock session survive restarts for that account; another account gets a separate partition. Renaming an account preserves its partition. Signed-out and unavailable identities have separate partitions. This separates local browser state; server documents retain the chosen space’s owner/member access boundary. The old common partition is not reused, so existing users may need to unlock SiYuan once again.

The view advertises the Chrome build Electron bundles rather than Electron's default user agent, because SiYuan's frontend does not initialise its editor under the latter. Downloads that SiYuan initiates are redirected to the operating system download folder, and `window.open` targets stay inside the embedded editor.

## Custom-service configuration

| Setting | Source | Purpose |
| --- | --- | --- |
| Service address | Main-process package settings, else `SIYUAN_BASE_URL` | The embedded editor and every API call use this one address. |
| API token | Endpoint-scoped encrypted storage, else `SIYUAN_API_TOKEN` for the installation endpoint only | Sent as the SiYuan API token. Needed only when the service enforces authentication, which is usual for a shared or public deployment. |

The main process persists the service address through the owner-scoped `packageSettings` port. Main-chat search, read, writes and automatic summaries resolve it directly after a restart, before the editor or settings UI is mounted. Renderer state is only an in-memory refresh notification, never an independent source of configuration. An unreadable/corrupt saved configuration fails explicitly instead of falling back to a different server.

A token pasted into settings goes to the main process and the encrypted `packageSecrets` port. Each normalized endpoint (including its deployment path) has its own secret key. Switching servers never forwards the previous server's token or the installation token. The environment token applies only to the normalized environment URL. Broken keychain access fails explicitly. Configure operations serialize, validate before saving secrets, and save the address with the settings revision check. If address persistence fails after storing a new endpoint's token, the previous committed address remains active; the UI reports failure.

`siyuan.service.status` (`ui`, `read`) returns configuration sources, credential state and current display identity without a secret. `siyuan.service.configure` (`ui`, `compute`) saves the address and/or stores/clears its token. `siyuan.service.check` (`ui` and `agent`, `read`) actually reads the service version and notebook list using that same configuration. The settings **测试已保存的连接** button calls it; unsaved input is not applied. A successful check proves connectivity and read access, not write access. Status polling never performs a network probe, and polling failures are visible in settings.

Capability failures carry a Chinese, actionable message instead of the transport's generic sanitization: a missing address, an invalid address, a rejected token, an unreachable service, a missing document and an uncertain write each say what to do next. The error also carries a `category` (`rejected` for input and authorization problems, `failed` for transport and outcome problems) and, for an unreachable service, `retryable: true`.

Because a native child view owns the surface, an unreachable service shows the page's own error overlay with **重试** and **打开设置** instead of a blank frame.

## Native AI editing through the local model router

Inside SciForge, SiYuan 3.8.6's original AI writing and selection/block editing
buttons keep their action templates, history, streaming preview, stop/retry, and
insert/replace workflow. The account-partitioned Electron session intercepts
only the native editor model request and returns SiYuan's original SSE contract.
There is no replacement AI menu or AI plugin.

The main process obtains the API-mode text reasoner through the existing SDK
modelAccess port and calls the canonical local model router. Neither the router
credential nor the provider API Key is sent to the remote page or shared SiYuan
service. Missing API-mode configuration fails locally with instructions; it
never falls back to the shared server's model. Coding Plan is not supported by
this SDK port.

The embedded config response displays a key-free **SciForge 本机模型** provider.
The original server configuration is unchanged. Saving AI provider settings
from the embedded page is blocked with directions to SciForge settings. Native
action-template management still uses the original shared server endpoints.
Agent chat, images, embedding, legacy chat endpoints and other model operations
are not connected in this first version; embedded AI endpoints outside the
editor workflow return an explicit unsupported message.

Only a registered editor main frame at the configured origin can initiate a
model operation. Requests have size/concurrency/time bounds, and stop, page
closure, logout or account changes cancel the local stream. This isolation is
local to the embedded session; it does not add server-side document permissions
or change what a standalone browser can do on the shared SiYuan deployment.

Run the isolated real-Electron transport acceptance (two accounts, cookies,
config isolation, SSE, cancellation and no shared model/config writes):

    npm --workspace @sciforge/domain-siyuan-content-space-provider run native-ai:smoke

This test uses fixture model responses, not a live provider or production note
writes. A configured API-mode text model is needed for live model acceptance.

## Independent cloud notes capabilities

Cloud notes uses its package-owned `siyuan.*` capabilities through the standard Host capability broker. It has no dependency on the Content Space domain and contributes no Content Space provider factory or provider instance. Notebook discovery and paginated directory enumeration use `siyuan.notebook.list` and `siyuan.directory.list`; document reads, writes, comments and sharing use the same account- and space-bound resource path.

Managed space ownership and sessions come from the authenticated identity transport and `cloud-spaces-contracts`. Project selection uses the collaboration domain's public contract. These services are independent of Content Space. The existing package and contribution identifiers remain the installation and saved-layout identifiers.

## Reading and searching

The package contributes `main.agent-routing` guidance for cloud spaces and SiYuan. Agents first list accessible spaces, then search or enumerate the chosen space. `siyuan.document.open` binds an ID or path to an immutable resource; `siyuan.document.read` uses that resource, with `maxChars` (default 1,000, maximum 3,000), `nextOffset` and `contentHash` for complete version-checked Unicode-safe reads. A changed body raises `stale_document`; restart from offset zero rather than joining versions. Generic tool-result truncation has its own history-artifact continuation.

Creation uses `siyuan.document.compose`; existing documents use resource-bound replace/append and comment operations. All external writes follow Host governance and verify their results. Service errors never cause a fallback to another space, local port or file scan.

Reads use the stored `/api/block/getBlockKramdown` body, removing native block attribute lines outside fenced or indented code. They preserve literal YAML and block-reference links without applying publication-export preferences. `updated` and content come from the same stored snapshot. Reading and searching are read-only (`effect: 'read'`, `approval: 'none'`) and do not enter the write receipt queue or create documents.

## Automatic summaries

In explicitly configured custom-service mode only, successful top-level Agent turns with a final assistant response are automatically archived in the **SciForge 工作总结** notebook, under `/SciForge`, on the configured service. Each note contains the user request, bounded final response, timestamp and runtime/thread/turn identifiers. Progress-only, failed, cancelled and persistent-child turns are excluded. This first version formats the existing final response; it does not perform a second AI synthesis or claim the entire task is verified as delivered.

All writes use the package's `siyuan.document.create` capability (`external-write`, UI/system audiences) and add no extra model API request. Automatic archiving follows the configured service address, so it works with any deployment the user points the package at.

Pending deliveries are persisted under SciForge user data and retried on the next successful turn or application startup, so a briefly unreachable service does not lose them. Document creation is serialized. Versioned receipts are scoped by server, notebook, path and requested content. Before returning `verified: true`, the writer exports and compares the saved Markdown, comparing parsed GFM structure while ignoring source positions, list spacing and SiYuan caret placeholders beside inline formatting; code, links, tables, task state and hard breaks remain significant. Replays recheck the remote identity and content. A same-path document with different content, ambiguous notebook/path, deleted target or incomplete readback never becomes a false success. Lost replies retain receipts for reconciliation across process/broker restarts; only explicit pre-commit rejections permit a fresh write attempt. These are local receipts and preflight checks, not a server-side cross-client transaction lock. An uncertain write that cannot be found is retained for reconciliation, never blindly repeated. Reads retry transient connection errors once, with a 10-second deadline per attempt; writes never blindly retry. Authentication/schema failures do not retry. Failures are logged without blocking the Agent response. Pending summaries and receipts can contain private task content and stay in local user data.

## Verification

The contract is exported from `@sciforge/domain-siyuan-content-space-provider/contract`. The package routing contribution is the single maintained workflow; no workspace-specific skill or localhost fallback is required.

Automated acceptance uses real HTTP fixtures and the production catalog, registry, broker, opaque Agent operation references, confirmation and bounded model-result delivery:

```powershell
npm --workspace @sciforge/domain-siyuan-content-space-provider test
npx vitest run src/main/modules/siyuan-io.integration.test.ts
```

It covers restart without opening the editor, endpoint credential isolation, full long-document pagination, changed versions, read-after-write verification, conflicts, lost replies, authentication failures, malformed responses and offline services. It does not promise network availability or that an upstream model will always choose/execute a tool.


The `smoke` script talks to a real service using `SIYUAN_BASE_URL` and `SIYUAN_API_TOKEN` (it reads `.env.siyuan` when present):

```powershell
npm --workspace @sciforge/domain-siyuan-content-space-provider run smoke
```

After building SciForge, the Electron smoke drives the real window, the native editor view, the settings panel and the write path:

```powershell
npm --workspace @sciforge/domain-siyuan-content-space-provider run editor:smoke
```

It needs a reachable service in `SIYUAN_SMOKE_URL` (or `SIYUAN_BASE_URL`) and, for the write assertions, a token in `SIYUAN_API_TOKEN`; without a token it reports `write: "skipped"` instead of failing. It uses a throwaway profile, so it never touches real user data.

This smoke drives a real desktop window, so it also needs an ordinary desktop session. Two environment conditions make it impossible to run and surface only as Playwright's opaque `Process failed to launch!`: Electron must not be launched with `ELECTRON_RUN_AS_NODE=1` (which runs it as plain Node, so `import ... from 'electron'` resolves the npm shim instead of the built-in module), and on Windows SciForge's own private-storage ACL enforcement refuses to start when the user data directory is owned by `BUILTIN\Administrators`, which is what an elevated token produces. Check `ELECTRON_RUN_AS_NODE` first when that error appears.

On a machine with UAC disabled there is no non-elevated token at all, so every directory the app creates is owned by `BUILTIN\Administrators`. Drive the smoke through a restricted token instead — it creates user-owned directories and satisfies the check:

```powershell
$script = Join-Path $env:TEMP 'editor-smoke.ps1'
@'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location <repo root>
npm --workspace @sciforge/domain-siyuan-content-space-provider run editor:smoke
'@ | Set-Content $script
runas /trustlevel:0x20000 "powershell -NoProfile -ExecutionPolicy Bypass -File $script"
```
## Comment account attribution

The native editor uses a sandbox preload exposing only sciforgeCommentIdentity.read(). A view-local IPC handler accepts the main frame of the configured HTTP(S) origin and reads Identity's Host-mediated current-user-profile service on every request. It returns only signed-in user ID/display name, signed-out, or unavailable. Other origins, child frames, inactive views, malformed profiles and missing services fail closed. Cross-origin page navigation is blocked; no credentials are supplied to SiYuan. The preload is generated from bundled trusted source into userData, so source and packaged builds use the same implementation.

The Extended Comments plugin consumes this optional bridge, stores a namespaced stable author ID, refreshes identity on account changes and immediately before every mutation, and keeps standalone browser manual signatures. Existing name-only entries are never claimed by matching a cloud display name. On custom services this is attribution and client UI ownership, not server-enforced comment authorization; the service retains its original write-access boundary. Managed spaces instead route comment commands through the authenticated Cloud service, which derives authors and enforces ownership and revisions.

## Custom-service account attribution trial

The page shows the current SciForge cloud account above the shared editor. Both users configure the same SiYuan service address and open the same document. Install **Extended Comments 0.8.0 or later on that SiYuan server** for automatic comment attribution; updating SciForge alone does not install or upgrade the server plugin.

Account changes fence the old page at every bridge read and retire it within the native identity monitor interval (500 ms), including while hidden. The monitor recreates the editor through its normal presentation path with the appropriate account partition. A delayed navigation cannot restore a retired account page. The renderer refreshes its displayed account about once per second. Moving or hiding a page within the same account preserves its native editor and drafts; switching accounts discards the old editor's in-memory drafts.

Local acceptance:

1. Use two SciForge clients with distinct cloud accounts, point them at one SiYuan service, and open one document.
2. Check each client's displayed SciForge name. Have A post a comment and B reply. Both clients should see the thread, with separate stable author IDs even if the display names match.
3. Rename A: existing comments keep their original signature and A retains client-side ownership. Switch to B: B must not gain ownership of A's comments.
4. Sign out: the old page is retired and the managed comment plugin refuses new comments instead of falling back to a cached manual name. The shared editor's original service access remains available.
5. Switch back to A: its local SiYuan browser state is restored. B's browser state remains separate.

For an explicitly configured shared custom service, attribution does not add private notebooks or server-enforced per-document permissions. Managed personal/project spaces instead use separate authorized kernels and a single Cloud comment command path with server-side revision checks. Custom-service comment storage retains its existing block-attribute behavior; simultaneous custom-service writers can overwrite each other. Do not treat displayed identity or custom-service edit controls as an authorization boundary.

Automated account/session acceptance uses a local HTTP fixture and two real sandboxed Electron views, not the production server:

```powershell
npm --workspace @sciforge/domain-siyuan-content-space-provider test
npm --workspace @sciforge/domain-siyuan-content-space-provider run comment-identity:smoke
```

The companion plugin's `tests/author-identity.test.cjs` covers two independent plugin clients making sequential comment/reply writes to one shared document store. It does not establish conflict-free concurrent writes or production deployment.

### Space-bound document and comment tools

`notebook.list` and `directory.list` enumerate an explicitly authorized space, with cursors bound to account, endpoint, space and listing revision. Directory results expose internal tree paths for complete recursive traversal. `document.search` remains title/path discovery. Use `document.open({spaceId,id|path})` to obtain a document resource; subsequent `document.read`, `document.replace`, `document.append` and comment operations target only that immutable resource. Changing the selected space never retargets it. Each operation resolves the current authorized space session again; account or endpoint changes reject the resource.

Reads retain version-checked Unicode-safe paging and user-authored YAML. Replace/append require the returned `contentHash` as `expectedContentHash`. Writes share the existing serialized document writer and durable unknown-outcome receipts; create keeps its existing conflict/read-back safeguards. Whole-body replacement may invalidate old block references and attributes. Comment list/create/reply/update retains Extended Comments v1 and requires `expectedCommentsRevision`. Managed resources use only the public authenticated Cloud comment read/mutate APIs: the server derives authors, performs revision-checked mutations and returns durable operation results. A managed failure never falls back to raw attribute writes. Explicit custom-service resources retain their own serialized attribute writes and unknown-outcome receipts; those client ownership checks do not add a server ACL or cross-device atomicity.

When the editor is visible, its active document is exposed through the Host's existing visible-context contribution. The native view inspects only an unambiguous active document ID, then the same space-authorized document resource handles all content and comment operations. Context refreshes when a chat requests current screen context, within the Host's bounded refresh budget; hidden editors, changed accounts/spaces/chats, ambiguous split panes and timed-out lookups do not expose an old document. Session ownership remains a generic Host registration property, and the existing public chat workspace field scopes resource invocation.


### Personal and project cloud spaces

The managed entry lists authorized cloud spaces and idempotently ensures the current account's single personal space on first entry. Project spaces are explicitly provisioned from the project picker; creating a project does not silently create a cloud space. The server owns the unique personal/project association and lifecycle (`queued`, `provisioning`, `ready`, `failed`). The UI polls provisioning status and offers retry only for an explicitly retryable failure. Every chat retains its own selected space and native document state. Personal spaces remain private to their owner while being usable from any of that owner's chats; project spaces remain restricted to active project members.

The canonical gateway paths are `GET/POST /v1/cloud-spaces` and `POST /v1/cloud-spaces/sessions` with `{spaceId}`. All managed document/catalog capabilities take `spaceId`, and resource bindings include account, space, endpoint and document. A task's `projectId` can only select the matching project entry from `space.list`; it never substitutes for a space or redirects a personal operation. Native SiYuan subdirectories provide the directory hierarchy without another filesystem. The old project-only session contract and route are removed.

### Current-document sharing

The owner of a personal or project space can share the currently visible, unambiguous cloud document. Opening the dialog freezes its existing authorized document resource and shows its title. Comment access is the default; edit access requires an explicit choice. A signed-in link holder joins that document only, without receiving a space editor session. Existing links can be copied or revoked; changing permissions requires revoking and creating a new link. No invitation or email is sent automatically.

The three sharing capabilities are UI-only and resource-scoped; create/revoke require confirmation and invocation idempotency. Source identifiers come from the bound account/space/endpoint/document resource, and Cloud verifies ownership again. Account, chat or space changes close the dialog and fence late responses. Sharing secrets remain in the explicit dialog and are never contributed to Agent visible context. Custom services do not expose managed sharing.

### Agent document pagination

After opening a document, observe its resource and copy the returned invocation
template, keeping `operationRef` and `resourceRef` at the top level. The first read
uses `input: { offset: 0 }`. Every continuation supplies both the previous result's
`nextOffset` as `offset` and its `contentHash`; `nextOffset: null` means completion.
The discovery schema distinguishes first-page and continuation inputs. Missing
version tokens are rejected before provider I/O, and invalid offsets produce a
pagination-specific error rather than suggesting changes to document IDs. If the
content changes, restart at offset zero. Unknown write outcomes still require
readback verification rather than automatic replay.
