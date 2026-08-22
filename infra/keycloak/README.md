# SciForge Keycloak environments

This directory contains two deliberately separate Keycloak configurations:

- The files in this directory are the loopback-only developer environment.
- [`test/`](./test/) is the versioned delivery source for the shared `a-https-oidc-test` environment at `login-test.sciforge.cn`.

Both use official Keycloak artifacts without modifying or vendoring Keycloak source. Do not merge the two Compose files: their trust, networking, registration, and startup semantics are intentionally different.

## Start locally

Requirements: Docker Engine with Docker Compose v2.

```sh
cd infra/keycloak
cp .env.example .env
# Replace both placeholder passwords in .env before continuing.
docker compose up -d
```

Open `http://127.0.0.1:8080/admin/` and sign in with the bootstrap administrator. The imported realm is `SciForge`; its issuer is:

```text
http://127.0.0.1:8080/realms/SciForge
```

Ordinary users register and sign in through the SciForge Realm login page, not the administrator console. With Keycloak running, execute this command from the repository root:

```sh
npm run identity:keycloak:login
```

The command starts the Desktop loopback callback, opens the system browser, and performs Authorization Code + PKCE. A new user chooses **Register** on the Keycloak page. After registration or login, the script exchanges the code, verifies the Access Token signature through JWKS, and checks the frozen `iss`, `sub`, `aud`, and `azp` claims. It never prints or saves the token.

The Keycloak account console is also available at `http://127.0.0.1:8080/realms/SciForge/account/` after login.

The HTTP issuer is deliberately limited to loopback development. The shared SciForge identity contract permits loopback HTTP for local integration and requires HTTPS for every non-loopback issuer.

## Imported clients

| Client | Purpose | Authentication |
| --- | --- | --- |
| `sciforge-desktop` | Native Desktop login | Authorization Code + PKCE, public client |
| `sciforge-web-mobile` | Local Web/PWA development | Authorization Code + PKCE, public client |
| `sciforge-cloud-api` | Access-token audience | Bearer-only resource server |

The Desktop loopback callback is fixed to `http://127.0.0.1:43110/oidc/callback` for the first integration. Production redirect URIs and public Web origins must be exact values approved for the deployed clients.

## Shared test environment

The shared HTTPS issuer, pinned images, production-style startup, database isolation, backup/restore scripts, verifier, rollback procedure, and non-sensitive acceptance evidence live under [`test/`](./test/). That directory is safe to review in Git, but it contains no credentials, Token values, user IDs, device IDs, database dumps, realm exports with users, or private keys.

## Production boundary

Do not use either repository configuration as a production approval. The shared test deployment uses production-style Keycloak controls, but it remains an explicitly test-only environment. A production deployment requires separate capacity, availability, secret-management, mail, monitoring, backup-retention, incident-response, and change-control decisions.

SciForge Cloud owns the mapping from OIDC `issuer + sub` to its stable `userId`. Keycloak owns passwords and login sessions. Zulip remains a separately verified Human Endpoint and must never be linked automatically by matching email.
