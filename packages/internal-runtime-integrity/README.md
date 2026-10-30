# Internal Runtime Integrity

`@sciforge/internal-runtime-integrity` is the public, Node-only implementation for static validation of optional internal runtime overlays. It verifies canonical installation receipts, complete inventories, per-file SHA-256 digests, path containment, and symlink rejection without importing or executing attachment code.

The CommonJS core is the package's single runtime implementation. Both ESM imports and CommonJS requires resolve to that implementation, with a package-owned declaration file supplying the public TypeScript contract.

The verifier treats the checkout and receipt owner as trusted. It does not replace an external signed release record or defend against an attacker who can rewrite both an installed overlay and its receipt.
