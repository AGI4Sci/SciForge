# `@sciforge/collaboration-identity`

Provider-neutral contracts and clients for mapping OIDC identities and Desktop
devices to one SciForge Cloud user.

## Boundary

This package owns validation, the HTTPS client, the local in-memory adapter, and
device enrollment proofs. It does not store passwords, host Keycloak, implement
the Cloud database, or execute tasks.

## Frozen Cloud endpoints

- `GET /v1/me`
- `POST /v1/device-enrollments`
- `POST /v1/devices`
- `GET /v1/me/devices`
- `DELETE /v1/me/devices/{deviceId}`

Desktop endpoints use an OIDC access token.

## Desktop configuration

- `SCIFORGE_OIDC_ISSUER`: exact Keycloak realm issuer.
- `SCIFORGE_CLOUD_BASE_URL`: SciForge Cloud HTTPS API root.

When `SCIFORGE_CLOUD_BASE_URL` is absent in development, Desktop uses the
in-memory adapter. Packaged builds default to the production Keycloak issuer.
