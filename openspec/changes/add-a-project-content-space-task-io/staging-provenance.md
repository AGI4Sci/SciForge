# Isolated staging 910ef7e provenance and candidate disposition

Read-only inspection on 2026-08-24 established the following provenance for the isolated staging project `sciforge-collaboration-portal-stg-910ef7e3`:

- source commit: `910ef7e318bcd5c3306f8e42c38b8cfc624a86f3`
- source tree: `3629bbc0c0fdf57504008381725a429c33ce12c9`
- source parent: `59713927367f65e02e5b5bf8c3652cddf48feff3`
- runtime image ID: `sha256:dfcf2ca924b9b995ed37b8940e25e710b9c221116781e418be6ebb5047a15637`
- runtime `/app/CONTRACT_COMMIT`: exact source commit above
- runtime release manifest SHA-256: `2f61ed399c0b7a2ae697848f0600b68dc34a8f4c059379b13cd0d80f18f014cc`
- application container ID: `639f7c04560d7a3d2864f1f65a4f737837072d3fe564f8a10bc5ef6d1d220c44`
- application state at inspection: healthy, restart count zero
- database runtime: PostgreSQL 17.6 in the same exact isolated Compose project

This provenance is sufficient to identify the running donor, but it does not make it a release candidate. Commit `910ef7e...` is not descended from common base `941dafba5f9b94ecd2afedb4a50a804f10f35dd8`, and its schema v9 is only an admitted input to the forward migration. The instance is therefore withdrawn from candidate eligibility and MUST NOT be promoted or used for public deployment. This branch performs no staging lifecycle mutation.
