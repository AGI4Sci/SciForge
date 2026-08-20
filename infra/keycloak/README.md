# SciForge Keycloak development environment

This directory provides a reproducible local OIDC provider for SciForge identity integration. It uses the official Keycloak image without modifying or vendoring Keycloak source.

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

## Production boundary

Do not run `start-dev` in production. A production deployment must use `start --optimized`, HTTPS, a public hostname, a supported external PostgreSQL database, secret injection, backups, monitoring, and an explicit upgrade process. Enable email verification only after SMTP is configured and tested.

SciForge Cloud owns the mapping from OIDC `issuer + sub` to its stable `userId`. Keycloak owns passwords and login sessions. Zulip remains a separately verified Human Endpoint and must never be linked automatically by matching email.
