---
status: accepted
reviewed: 2026-08-27
---

# Keep provider credentials in Host secure storage

Provider credentials are bound to a Human Principal and execution node and may be stored only through a generic Host-owned OS secure-credential facility. Browser cookies, administrator passwords, integration keys, renderer state, plaintext settings, public or caller-controlled URLs, prompts, and cross-node messages are not credential transports.

A provider integration MAY serialize a credential into an outbound HTTPS query only when the verified provider contract requires that exact transport. The exception remains inside the owning main-process Connector's bounded credential-use callback, targets only Connector-pinned HTTPS origins and paths, rejects redirects, and never exposes or persists the credential-bearing URL through logs, traces, diagnostics, renderer, Agent, capability output, portable references, or cross-node messages. This exception does not make URLs a general credential transport.

For the current OpenContent deployment, the package-owned enrollment form sends
the account and password once through the strict UI-only sensitive capability
to Connector main. Connector main authenticates against its fixed HTTPS
deployment configuration, clears those fields immediately, and persists only
the returned Session Token through
`DomainMainHost.packageSecrets.providerCredentials`. Electron `safeStorage`
encrypts the Host record through Keychain on macOS and DPAPI on Windows. The
encrypted record remains bound to the exact node, Principal, Provider Instance,
and Connection. Host API `1.9.0` requires the package to present the complete
expected Principal lease for every credential operation. The Host compares it
with the current Principal inside the encrypted-storage lock and derives the
namespace only from that verified Host Principal, so a Principal transition
cannot redirect a queued write or deletion. Cancellation is checked in the
same lock before a mutation is dispatched. The Connector re-observes the external subject from OpenContent
before it reports connected status or issues a binding attestation. A
secure-storage failure blocks enrollment.

Restart restoration validates the stored Token before treating the connection
as active. Invalid or expired Tokens require reauthentication and are never
replaced from a cache of the account or password. The account and password
exist only in the active form/request. The implementation drops its mutable
references when authentication settles, is cancelled, or the view changes; it
does not claim that immutable JavaScript strings can be memory-zeroized.
Plaintext files, settings, `localStorage`, logs, traces, receipts, cross-node
messages, renderer connection state, Connector-owned credential caches, native
enrollment addons, and compatibility fallbacks are not credential stores; the
Session Token never reaches the renderer. Source and packaged security tests
govern this boundary. The Host keeps Token plaintext in its exact-value
redaction registry only while the bounded credential-use callback is active,
scrubs callback failures before release, and retains no plaintext after
status, replace, use, or remove completes. Platform-contract tests simulate
both supported desktop platforms; a macOS acceptance smoke separately exercises
the actual Electron `safeStorage` source and packaged paths.
