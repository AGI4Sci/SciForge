# Web Preview domain

This package owns SciForge's Playwright-backed browser page, its renderer panel,
and the capability resource exposed to UI and agent callers.

Playwright is an implementation detail. Browser operations use the canonical
SciForge capability broker; the package does not register a parallel MCP or IPC
transport.
