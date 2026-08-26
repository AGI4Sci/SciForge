---
status: accepted
supersedes: ADR-0030 static Content Space verification profiles
reviewed: 2026-08-26
---

# Authorize Content Space at runtime and keep Agent skills optional

Content Space no longer composes or evaluates static verification profiles. A
`poc_only` operation may execute when the current invocation has a trusted
Broker audience, an exact current Principal and authority, and a live Provider
Binding Attestation from the pinned Provider. The Provider carries that exact
binding expectation to its Connector, which reauthenticates and recomputes it
immediately before the external business call. The real Provider read check or
write remains the ACL oracle. `blocked_by_contract` is never admitted, and
runtime authorization never promotes an operation to `production_ready`.

This removes the package-time approval object that made a valid user connection
insufficient by itself. It does not make credentials global or weaken
multi-user isolation: every user still needs their own current SciForge
Principal, node-local Provider Connection, exact Broker resource and any Human
confirmation required by the operation. Unbind, credential replacement,
Principal drift, Provider Instance drift, opaque subject drift or binding
revision drift fails closed before dispatch.

The OpenContent Provider integration and the optional `opencontent-base` Agent
skill are separate products. The Provider is discovered and its ordinary and
Team capabilities remain usable without that skill. The skill supplies Agent
instructions and a private CLI for additional convenience; installing or
removing it cannot register a Provider, create a Connection, change readiness,
grant authority or enable a second Content Space path.

Private Agent skills are distributed out of band. SciForge provides one
provider-neutral local ZIP verifier/installer that validates a sender-supplied
SHA-256, bounded regular files, CRC, paths, symlinks, credential absence and a
root `SKILL.md`, then installs atomically into the Workspace's canonical
`.codex/skills/<skill-name>` root with a local receipt. It never executes
package scripts and never publishes private bytes. A recipient supplies their
own runtime credentials locally after installation when the skill needs them.

The canonical paths are therefore:

```text
OpenContent Provider use
  Broker -> Content Space -> pinned Provider -> current user's Connector binding

Optional Agent enhancement
  private ZIP -> generic local verifier/installer -> .codex/skills/<skill-name>
```

Neither path is a prerequisite for the other. Provider deployment
configuration remains a private packaging input, and public releases continue
to reject active configuration marked `publicRelease: forbidden`; that release
boundary is independent of Agent skill installation.

The earlier `opencontent-attachment-assets` overlay cannot be deleted as a
pure verification artifact: an audit shows that ordinary file and Team calls
use the public Connector client and Team-administration ports, while only the
optional `useSupplierTransport` port consumes five package-pinned overlay files
for native-document and supplier-backed extended operations. The overlay may
therefore remain an optional Provider supplier asset. Its absence must leave
Provider discovery, enrollment, ordinary/Team use, Agent/Collaboration startup,
source build and Stage 4 packaging intact. Installing `opencontent-base.zip` as
a Workspace skill does not install or activate that Provider asset.
