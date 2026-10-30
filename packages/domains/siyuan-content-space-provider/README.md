# SiYuan Content Space Provider

This package embeds a SiYuan web UI and a Content Space provider as a SciForge-owned domain package. It contributes one `workbench.main-area` page (the Host sidebar entry **思源笔记**) and exposes capabilities for opening, presenting and writing to SiYuan.

**Server mode only.** SciForge connects to a SiYuan service you run or subscribe to; the package never starts, bundles or redistributes a SiYuan kernel. Point the page at your service address, or set `SIYUAN_BASE_URL` as the installation default. If that service requires an API token, set `SIYUAN_API_TOKEN`.

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
| API token | `SIYUAN_API_TOKEN` | Sent as the SiYuan API token. Needed only when the service enforces authentication, which is usual for a shared or public deployment. |

The page stores only the address, in renderer local storage under `sciforge.siyuan.editor`. The token stays in the environment and is never written to the renderer profile.

Because a native child view owns the surface, an unreachable service shows the page's own error overlay with **重试** and **打开设置** instead of a blank frame.

## Content Space provider

The package declares its own provider instance (`providerInstanceRef: sciforge-siyuan`, provider kind `siyuan`) and a `main.content-space-provider-factory` contribution, so it composes with the Host's provider-neutral Content Space the same way other providers do. Only notebook discovery is currently advertised; every other operation reports `blocked_by_contract` rather than claiming support it does not have.

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