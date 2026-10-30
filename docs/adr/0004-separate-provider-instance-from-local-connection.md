---
status: accepted
---

# Separate portable provider identity from local access bindings

A portable resource reference identifies a non-secret Provider Instance Reference and provider resource, while each operation resolves a provider-owned node-local access binding for the current Human Principal. An external Provider may use an enrolled Provider Connection; a first-party Provider may derive access from an existing SciForge Cloud Session. The trusted Provider Instance Directory manages only stable instance identity, Provider Kind, approved endpoint policy, and tenant policy; it contains no access binding or credential. This lets the same reference cross nodes without transferring authority. Missing, ambiguous, or unauthorized access requires Human action rather than another principal, arbitrary default, shared administrator, or Provider fallback.
