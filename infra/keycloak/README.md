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

## SciForge login theme

The Realm imports the `sciforge` login theme from [`themes/sciforge/`](./themes/sciforge/). It keeps Keycloak's upstream v2 templates and adds the SciForge brand mark, research-focused copy, responsive layout, accessible focus states, localized English and Simplified Chinese labels, and a small identity-protection footer. The theme does not add scripts, change OIDC parameters, or collect credentials outside Keycloak.

The local Compose service mounts only `themes/sciforge/` read-only at `/opt/keycloak/themes/sciforge`, leaving Keycloak's built-in themes and common resources untouched. On a fresh local database, `loginTheme` in the Realm import selects it automatically. If the database already exists, Realm import does not overwrite the existing Realm settings: choose `sciforge` under **Realm settings > Themes > Login theme** in the Keycloak Admin Console, then reload the login page.

The shared HTTPS test deployment uses a separate optimized image and an existing PostgreSQL-backed Realm. Its login theme must be packaged into the approved image and selected through the authorized deployment procedure before the public test page changes; a repository restart alone must not be treated as a live configuration update.

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
