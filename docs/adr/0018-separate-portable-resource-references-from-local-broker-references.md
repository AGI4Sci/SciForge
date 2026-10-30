---
status: accepted
---

# Separate portable resource references from local Broker references

SciForge uses a versioned, bounded, non-secret Portable Resource Reference Envelope for durable cross-context and cross-node identity, with registered codecs for live Document, Content Container, Content File, and version-fixed Artifact References. The existing Broker `res_*` and capability handles remain process-local executable bindings and are never persisted or transported. A receiving full SciForge node validates the codec and trusted Provider Instance, resolves the current Human Principal's provider-owned local access binding, reauthorizes with the pinned Provider, and only then materializes a local Broker reference; the reverse export path produces a portable envelope without exposing credentials or endpoints. Provider failure never reinterprets the reference through another Provider: migration is explicit and produces a new reference. This adds generic codec/materialization boundaries but prevents portable identity from becoming authority, fallback routing, SSRF input, or a leaked runtime handle.
