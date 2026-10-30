---
status: accepted
reviewed: 2026-08-27
---

# Keep Provider enrollment with the integration package

The OpenContent integration package owns its Human enrollment UI and
main-process connection lifecycle in one package and version. Content Space
owns only a provider-neutral renderer slot: after the Human selects the
matching Provider Instance, the OpenContent adapter mounts the enrollment view
owned by the Connector package. OpenContent has no standalone workbench or
plugin-configuration surface, and Content Space imports neither the OpenContent
UI nor the Connector.

On macOS and Windows, that view collects an OpenContent account and password in
one bounded form and invokes the single `opencontent.connection.bind`
capability. Its strict input schema and `sensitive-input` classification make
it a one-use UI-only path: the Host validates the input and records only an
idempotency digest, while Connector main authenticates against the fixed HTTPS
deployment origin and immediately discards both credential fields. The
renderer receives no callable Provider transport, Session Token, endpoint
policy, or reusable credential API. There is no native enrollment addon,
platform branch, fallback IPC, or second Connector registration.

Only the returned Session Token may persist. Connector main writes it through
the generic package-scoped
`DomainMainHost.packageSecrets.providerCredentials` contract; Host uses
Electron `safeStorage`, backed by Keychain on macOS and DPAPI on Windows, and
binds the encrypted record to the node, Human Principal, Provider Instance,
and Connection. Host API `1.9.0` re-verifies the package-presented complete
Principal lease inside the encrypted-storage lock before every operation and
checks cancellation before write or deletion dispatch. The Host derives the
storage namespace from its verified current Principal, never from a
package-selected identity. The Connector re-observes the external subject before it
reports connected status or issues a binding attestation. The account and
password exist only in the active form/request. Owned mutable references are
cleared when authentication settles, is cancelled, or the view changes; the
implementation does not claim memory zeroization of immutable JavaScript
strings. They are never saved in settings or `localStorage`, and
account, password, and Token values never enter logs, traces, capability
receipts, or portable references. The Session Token never reaches the renderer.
A valid Token is validated and restored after restart; an invalid or expired
Token changes the connection to reauthentication-required before the UI
collects credentials again. Missing or unavailable secure storage fails closed
and never enables a Connector-owned plaintext or long-lived credential cache.
The Host exact-value redaction registry holds the Token only for the duration
of one bounded `use` callback, scrubs a callback failure before releasing that
lease, and contains no Token after any credential operation completes. The
credential form is also marked as sensitive visible context so account and
password pixels are excluded from retained window captures.

When a trusted Provider Instance is replaced, removed, or temporarily
unavailable, the integration retains cleanup responsibility until the owning
Human Principal can securely delete the credential. Its unavailable enrollment
view exposes that same local unbind only behind explicit Human confirmation;
cleanup performs no Provider business call and never rebinds or reuses the
credential.
