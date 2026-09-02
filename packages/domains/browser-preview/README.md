# Browser Preview domain

This package owns SciForge's Playwright-backed browser page, its renderer panel,
and the capability resource exposed to UI and agent callers.

Playwright is an implementation detail. Browser operations use the canonical
SciForge capability broker; the package does not register a parallel MCP or IPC
transport.

Each browser surface uses a SciForge-owned persistent Chromium profile under the
application user-data directory. The profile is retained when a panel closes so
the user can keep a site login between panel reopenings and application restarts.
External Edge or Chrome profiles are intentionally not imported: their cookies,
password stores, local storage, and refresh tokens are sensitive, encrypted,
browser-specific data and cannot be safely or portably reused across users or
operating systems. Users authenticate directly in this isolated profile instead.
