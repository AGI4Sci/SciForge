---
status: accepted
reviewed: 2026-08-17
amends: ADR-0015
---

# Authorize external Providers through Principal-owned connections

A `local-selection` Human Principal may own and use one node-local Provider Connection per Provider Instance when the external Provider independently authenticates the account and remains authoritative for every resource permission. Agent and UI operations always use the executing node owner's current connection; a requester, Task, prompt, portable reference, or runtime argument cannot nominate or borrow a connection. This preserves local-first OpenContent use without misrepresenting local selection as cloud authentication.
