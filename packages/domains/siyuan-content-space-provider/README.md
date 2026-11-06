# SiYuan Content Space Provider

This package embeds a SiYuan web UI and a Content Space provider as a SciForge-owned domain package. It contributes one `workbench.main-area` page (the Host sidebar entry **思源笔记**) and exposes capabilities for opening, presenting, reading, searching and writing SiYuan documents.

The editor opens in a right dock by default, beside the current Session. Its header can move it to the left, bottom or main area. Dock edges resize with a pointer or arrow keys; position and size are saved locally. Pages sharing an edge use tabs and stay mounted when moved or hidden, so switching position does not reload the editor. These controls come from the generic Host page docking contract.

**Server mode only.** SciForge connects to a SiYuan service you run or subscribe to; the package never starts, bundles or redistributes a SiYuan kernel. Point the page at your service address, or set `SIYUAN_BASE_URL` as the installation default. If that service requires an API token, paste it in the page settings or set `SIYUAN_API_TOKEN`.

## Embedded editor

The page owns everything it renders, including its own settings, so there is no separate settings surface to keep in sync. The editor is **not** an Electron `<webview>`: the Host renderer deliberately does not enable `webviewTag`. Instead the package creates a native `WebContentsView` in the main process, attaches it to the desktop window that hosts the page, and keeps its bounds synchronized with the slot. This is the same mechanism the first-party Browser Preview package uses.

The split is:

- `siyuan.editor.open` (audience `ui`) — resolves the service address (the page's value, else the installation default) and returns it for presentation, or reports a clear error when neither is configured.
- `siyuan.editor.present` (audience `ui`) — the renderer measures its slot in device-independent pixels and reports `{ url, viewport }`. The main process scales the rectangle by the host zoom factor, clamps it to the window content bounds, and shows, hides or detaches the child view. `url: null` detaches it.

A native child view always paints above HTML, so the renderer hides it whenever the page is inactive, the Host opens a dialog or menu over it, or the page scrolls out of its clipping ancestors. This mirrors the Host's own hit testing and is why the page keeps every control outside the editor slot.

The view uses the persisted partition `persist:sciforge-siyuan`, so the SiYuan session survives restarts, and it advertises the Chrome build Electron bundles rather than Electron's default user agent, because SiYuan's frontend does not initialise its editor under the latter. Downloads that SiYuan initiates are redirected to the operating system download folder, and `window.open` targets stay inside the embedded editor.

## Configuration

| Setting | Source | Purpose |
| --- | --- | --- |
| Service address | Page settings, else `SIYUAN_BASE_URL` | The embedded editor and every API call use this one address. |
| API token | Page settings, else `SIYUAN_API_TOKEN` | Sent as the SiYuan API token. Needed only when the service enforces authentication, which is usual for a shared or public deployment. |

The page stores only the address, in renderer local storage under `sciforge.siyuan.editor`. A token pasted into the page never lands in renderer storage: it goes straight to the main process and is written to SciForge's encrypted package secret store through the Host's `packageSecrets` port, so the page, the preload bridge, logs and conversations only ever see whether a token exists. The environment variable stays as the installation-wide default and is used when no token is stored.

Two `ui`-audience capabilities back the settings panel: `siyuan.service.status` (`read`) reports which address and token are in effect and whether the local encrypted store is usable, and `siyuan.service.configure` (`compute`, idempotent) stores or clears the token, returning the same status document. Neither capability ever returns the token value.

Capability failures carry a Chinese, actionable message instead of the transport's generic sanitization: a missing address, an invalid address, a rejected token, an unreachable service, a missing document and an uncertain write each say what to do next. The error also carries a `category` (`rejected` for input and authorization problems, `failed` for transport and outcome problems) and, for an unreachable service, `retryable: true`.

Because a native child view owns the surface, an unreachable service shows the page's own error overlay with **重试** and **打开设置** instead of a blank frame.

## Content Space provider

The package declares its own provider instance (`providerInstanceRef: sciforge-siyuan`, provider kind `siyuan`) and a `main.content-space-provider-factory` contribution, so it composes with the Host's provider-neutral Content Space the same way other providers do. Only notebook discovery is currently advertised; every other operation reports `blocked_by_contract` rather than claiming support it does not have.

## Reading and searching

Two agent-audience capabilities let an Agent use what is already in SiYuan, not only write to it:

- `siyuan.document.search` (`read`) — matches document paths by fragment and returns `id`, `path`, `notebook` and `updated`, so an Agent can find a note before reading it.
- `siyuan.document.read` (`read`) — returns one document's Markdown body. Address it with `id` or with `path` (such as `/SciForge/实验记录`), never both. `maxChars` (default 20 000) bounds a single document, and `truncated` reports whether the body was cut.

Reads use `/api/export/exportMdContent` rather than `getBlockKramdown`: the kramdown export interleaves SiYuan's own block attributes (`{: id="…" }`) into the text, which is noise for a reader, and the exported YAML front matter is stripped for the same reason. Both capabilities are read-only (`effect: 'read'`, `approval: 'none'`) and share the endpoint but not the write path's receipts or queue, so a read never creates a document or a receipt.

## Automatic summaries

Successful top-level Agent turns with a final assistant response are automatically archived in the **SciForge 工作总结** notebook, under `/SciForge`, on the configured service. Each note contains the user request, bounded final response, timestamp and runtime/thread/turn identifiers. Progress-only, failed, cancelled and persistent-child turns are excluded. This first version formats the existing final response; it does not perform a second AI synthesis or claim the entire task is verified as delivered.

All writes use the package's `siyuan.document.create` capability (`external-write`, UI/system audiences) and add no extra model API request. Automatic archiving follows the configured service address, so it works with any deployment the user points the package at.

Pending deliveries are persisted under SciForge user data and retried on the next successful turn or application startup, so a briefly unreachable service does not lose them. Document creation is serialized; durable receipts and SiYuan path lookup prevent duplicates after restarts or lost responses. An uncertain write that cannot be found is retained for reconciliation, never blindly repeated. Failures are logged without blocking the Agent response. Pending summaries and receipts can contain private task content and stay in local user data.

## Verification

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

The Extended Comments plugin consumes this optional bridge, stores a namespaced stable author ID, refreshes identity on account changes and immediately before every mutation, and keeps standalone browser manual signatures. Existing name-only entries are never claimed by matching a cloud display name. This is attribution and client UI ownership, not server-enforced comment authorization; a shared SiYuan workspace still has its original write-access boundary.
