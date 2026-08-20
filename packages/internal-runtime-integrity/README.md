# Internal Runtime Integrity

`@sciforge/internal-runtime-integrity` is the public, Node-only implementation for static validation of optional internal runtime overlays. It verifies canonical installation receipts, complete inventories, per-file SHA-256 digests, path containment, and symlink rejection without importing or executing attachment code.

The CommonJS core is the single implementation used by repository scripts. The TypeScript entrypoint only re-exports that core so bundled main-process consumers use the identical verifier.

The verifier treats the checkout and receipt owner as trusted. It does not replace an external signed release record or defend against an attacker who can rewrite both an installed overlay and its receipt.
