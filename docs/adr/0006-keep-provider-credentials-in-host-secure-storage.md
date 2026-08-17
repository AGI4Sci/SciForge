---
status: accepted
reviewed: 2026-08-17
---

# Keep provider credentials in Host secure storage

Provider credentials are bound to a Human Principal and execution node and may be stored only through a generic Host-owned OS secure-credential facility. Browser cookies, administrator passwords, integration keys, renderer state, plaintext settings, public or caller-controlled URLs, prompts, and cross-node messages are not credential transports.

A provider integration MAY serialize a credential into an outbound HTTPS query only when the verified provider contract requires that exact transport. The exception remains inside the owning main-process Connector's bounded credential-use callback, targets only Connector-pinned HTTPS origins and paths, rejects redirects, and never exposes or persists the credential-bearing URL through logs, traces, diagnostics, renderer, Agent, capability output, portable references, or cross-node messages. This exception does not make URLs a general credential transport.

Production remains blocked until OpenContent supplies official per-user issuance, expiry, refresh/renewal, rotation, logout, and revocation contracts and the Host facility passes source and packaged security tests.
