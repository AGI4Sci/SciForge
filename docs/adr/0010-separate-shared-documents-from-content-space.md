---
status: accepted
---

# Separate Shared Documents from Content Space

Shared Documents and Content Space ship as separate trusted compile-time domain packages even when one team or vendor supplies both. Shared Documents owns live collaborative-document semantics, structured content, revisions, conditional writes, and provider-native collaboration; Content Space owns provider-space selection, directories, ordinary-file transfers, and fixed Task Artifacts. Each domain owns a separate Provider Contract, catalog, capabilities, readiness, tests, and replacement path. A vendor may share a private Connector beneath two independently registered adapters, but neither domain imports the other or calls a vendor Connector directly.
