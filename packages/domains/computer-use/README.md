# Computer Use domain package

Owns the SciForge Computer Use shared contract, MCP worker binding, trusted
invocation metadata declaration, CDP/Electron adapter lifecycle, runtime status
client, permissions and renderer settings/status surface. The Python GUI-Owl
worker remains in `packages/workers/gui-owl-computer-use` and is bound here.

The remote Windows component is a P6a Host Controller/protocol only. This
package does not contain a Guest Worker, VM image, RDP endpoint, Hyper-V or
Windows Sandbox implementation. Fake transports prove controller semantics,
not the existence of an isolated desktop.

The package contributes MCP trusted-invocation metadata and settings UI through
generic Domain SDK contracts. The host gateway does not special-case the
`gui_owl_computer_use` provider. Runtime status failures retain last-known
resource evidence as stale, and token/proof-bearing service traffic is limited
to credential-free HTTP loopback origins with redirects disabled.
